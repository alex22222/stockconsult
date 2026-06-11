#!/usr/bin/env python3
"""
StockConsult COS 数据上传助手
在本地计算完成后，将结果同步到腾讯云 COS
"""

import os
import subprocess
import sys
from pathlib import Path

# 项目根目录
PROJECT_DIR = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_DIR / "cloudfunctions" / "stock-predictor" / "data"
ENV_ID = "stockconsult-d9g7b6ae5b8170e00"

# 需要同步的目录映射: (本地路径, COS 路径)
SYNC_DIRS = [
    ("rebuild", "rebuild"),
    ("paper_trading", "paper-trading"),
    ("reports", "reports"),
    ("market_sentiment", "market"),
]


def upload_file(local_path: str, cos_key: str) -> bool:
    """上传单个文件到 COS"""
    cmd = [
        "tcb", "storage", "upload",
        local_path,
        cos_key,
        "-e", ENV_ID,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            print(f"  ✓ {cos_key}")
            return True
        else:
            print(f"  ✗ {cos_key}: {result.stderr[:100]}")
            return False
    except Exception as e:
        print(f"  ✗ {cos_key}: {e}")
        return False


def upload_dir(local_dir: Path, cos_prefix: str) -> tuple[int, int]:
    """上传整个目录到 COS，返回 (成功数, 总数)"""
    if not local_dir.exists():
        print(f"  目录不存在: {local_dir}")
        return 0, 0

    success = 0
    total = 0
    for file_path in local_dir.rglob("*"):
        if file_path.is_file():
            # 计算相对路径作为 COS key
            rel_path = file_path.relative_to(local_dir)
            cos_key = f"{cos_prefix}/{rel_path}"
            total += 1
            if upload_file(str(file_path), cos_key):
                success += 1

    return success, total


def sync_all() -> bool:
    """同步所有数据目录到 COS"""
    print("=" * 50)
    print("[COS 同步] 开始上传数据...")
    print("=" * 50)

    all_success = True
    for local_name, cos_prefix in SYNC_DIRS:
        local_dir = DATA_DIR / local_name
        print(f"\n📁 {local_name} -> {cos_prefix}/")
        success, total = upload_dir(local_dir, cos_prefix)
        print(f"   结果: {success}/{total} 文件上传成功")
        if success < total:
            all_success = False

    print("\n" + "=" * 50)
    if all_success:
        print("[COS 同步] ✓ 全部上传成功")
    else:
        print("[COS 同步] ⚠ 部分上传失败")
    print("=" * 50)

    return all_success


if __name__ == "__main__":
    # 支持命令行参数: upload_to_cos.py [dir_name]
    if len(sys.argv) > 1:
        target = sys.argv[1]
        found = False
        for local_name, cos_prefix in SYNC_DIRS:
            if local_name == target or cos_prefix == target:
                found = True
                local_dir = DATA_DIR / local_name
                print(f"📁 {local_name} -> {cos_prefix}/")
                success, total = upload_dir(local_dir, cos_prefix)
                print(f"结果: {success}/{total} 文件上传成功")
                sys.exit(0 if success == total else 1)
        if not found:
            print(f"未知目录: {target}")
            print(f"可用: {[d[0] for d in SYNC_DIRS]}")
            sys.exit(1)
    else:
        ok = sync_all()
        sys.exit(0 if ok else 1)
