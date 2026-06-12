#!/usr/bin/env python3
"""
StockConsult COS 数据上传助手
使用腾讯云 Python SDK 直接上传，避免 tcb CLI 登录过期问题
"""

import os
import sys
from pathlib import Path

# 腾讯云 COS 配置
SECRET_ID = os.getenv("TENCENTCLOUD_SECRET_ID", "")
SECRET_KEY = os.getenv("TENCENTCLOUD_SECRET_KEY", "")
REGION = "ap-shanghai"
BUCKET = "7374-stockconsult-d9g7b6ae5b8170e00-1328081868"

# 项目根目录
PROJECT_DIR = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_DIR / "cloudfunctions" / "stock-predictor" / "data"

# 需要同步的目录映射: (本地路径, COS 路径)
SYNC_DIRS = [
    ("rebuild", "rebuild"),
    ("paper_trading", "paper-trading"),
    ("reports", "reports"),
    ("market_sentiment", "market"),
]

REBUILD_COMPAT_FILES = {
    "prediction_history.json": "rebuild_prediction_history.json",
    "evaluation_report.json": "rebuild_evaluation_report.json",
    "walkforward_report.json": "rebuild_walkforward_report.json",
    "focus_pool.json": "rebuild_focus_pool.json",
    "backtest.json": "rebuild_backtest.json",
    "model_accuracy.json": "rebuild_model_accuracy.json",
}


def get_client():
    if not SECRET_ID or not SECRET_KEY:
        print("❌ 缺少 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY 环境变量")
        sys.exit(1)
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError:
        print("❌ 未安装 cos-python-sdk-v5，请运行: pip install cos-python-sdk-v5")
        sys.exit(1)
    config = CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)
    return CosS3Client(config)


def upload_file(client, local_path: str, cos_key: str, verify: bool = True) -> bool:
    """上传单个文件到 COS，可选校验"""
    try:
        client.put_object_from_local_file(
            Bucket=BUCKET,
            LocalFilePath=local_path,
            Key=cos_key,
        )

        if verify:
            # 闭环校验：对比本地和 COS 的 md5
            local_md5 = _md5(local_path)
            cos_md5 = _get_cos_md5(client, cos_key)
            if local_md5 != cos_md5:
                print(f"  ⚠ {cos_key} md5 不匹配，重新上传...")
                client.put_object_from_local_file(
                    Bucket=BUCKET,
                    LocalFilePath=local_path,
                    Key=cos_key,
                )
                cos_md5 = _get_cos_md5(client, cos_key)
                if local_md5 != cos_md5:
                    print(f"  ✗ {cos_key} 两次上传 md5 均不匹配")
                    return False
        
        print(f"  ✓ {cos_key}")
        return True
    except Exception as e:
        print(f"  ✗ {cos_key}: {e}")
        return False


def _md5(path: str) -> str:
    import hashlib
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_cos_md5(client, cos_key: str) -> str:
    """获取 COS 对象的 ETag (md5)"""
    try:
        resp = client.head_object(Bucket=BUCKET, Key=cos_key)
        return resp.get("ETag", "").strip('"')
    except Exception:
        return ""


def upload_dir(client, local_dir: Path, cos_prefix: str) -> tuple[int, int]:
    """上传整个目录到 COS，返回 (成功数, 总数)"""
    if not local_dir.exists():
        print(f"  目录不存在: {local_dir}")
        return 0, 0

    success = 0
    total = 0
    for file_path in local_dir.rglob("*"):
        if file_path.is_file():
            rel_path = file_path.relative_to(local_dir)
            cos_key = f"{cos_prefix}/{rel_path}"
            total += 1
            if upload_file(client, str(file_path), cos_key, verify=True):
                success += 1

    return success, total


def sync_all() -> bool:
    """同步所有数据目录到 COS"""
    client = get_client()
    print("=" * 50)
    print("[COS 同步] 开始上传数据...")
    print("=" * 50)

    all_success = True
    for local_name, cos_prefix in SYNC_DIRS:
        local_dir = DATA_DIR / local_name
        print(f"\n📁 {local_name} -> {cos_prefix}/")
        success, total = upload_dir(client, local_dir, cos_prefix)
        print(f"   结果: {success}/{total} 文件上传成功")
        if success < total:
            all_success = False

    print("\n📁 rebuild -> paper-trading/ compatibility aliases")
    alias_success, alias_total = upload_rebuild_compat_aliases(client)
    print(f"   结果: {alias_success}/{alias_total} 文件上传成功")
    if alias_success < alias_total:
        all_success = False

    print("\n" + "=" * 50)
    if all_success:
        print("[COS 同步] ✓ 全部上传成功")
    else:
        print("[COS 同步] ⚠ 部分上传失败")
    print("=" * 50)

    return all_success


def upload_rebuild_compat_aliases(client) -> tuple[int, int]:
    """兼容旧前端读取的 paper-trading/rebuild_*.json 路径。"""
    rebuild_dir = DATA_DIR / "rebuild"
    if not rebuild_dir.exists():
        print(f"  目录不存在: {rebuild_dir}")
        return 0, 0

    aliases = []
    for src_name, dst_name in REBUILD_COMPAT_FILES.items():
        src = rebuild_dir / src_name
        if src.exists():
            aliases.append((src, f"paper-trading/{dst_name}"))

    for src in rebuild_dir.glob("daily_summary_*.json"):
        aliases.append((src, f"paper-trading/rebuild_{src.name}"))

    success = 0
    for src, cos_key in aliases:
        if upload_file(client, str(src), cos_key):
            success += 1
    return success, len(aliases)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        target = sys.argv[1]
        if target in ("compat", "aliases", "paper-trading-compat"):
            client = get_client()
            success, total = upload_rebuild_compat_aliases(client)
            print(f"结果: {success}/{total} 文件上传成功")
            sys.exit(0 if success == total else 1)

        found = False
        for local_name, cos_prefix in SYNC_DIRS:
            if local_name == target or cos_prefix == target:
                found = True
                client = get_client()
                local_dir = DATA_DIR / local_name
                print(f"📁 {local_name} -> {cos_prefix}/")
                success, total = upload_dir(client, local_dir, cos_prefix)
                print(f"结果: {success}/{total} 文件上传成功")
                sys.exit(0 if success == total else 1)
        if not found:
            print(f"未知目录: {target}")
            print(f"可用: {[d[0] for d in SYNC_DIRS]}")
            sys.exit(1)
    else:
        ok = sync_all()
        sys.exit(0 if ok else 1)
