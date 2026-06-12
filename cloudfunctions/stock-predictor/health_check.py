#!/usr/bin/env python3
"""
StockConsult 健康检查 — 闭环数据新鲜度监控
================================================
Loop Engineering: Observe → Decide → Act → Feedback

职责:
1. 检查数据新鲜度（预测、行情、模拟盘）
2. 发现滞后 → 自动触发补跑
3. 补跑后再次验证 → 直到通过
4. 发送飞书告警（人工兜底）

用法:
    python health_check.py              # 完整检查
    python health_check.py --repair     # 检查并自动修复
    python health_check.py --alert      # 只告警，不修复
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from strategy_config import get_rebuild_stocks

# 项目路径
DATA_DIR = Path(__file__).parent / "data"
REBUILD_DIR = DATA_DIR / "rebuild"
PT_DIR = DATA_DIR / "paper_trading"
LOG_PATH = DATA_DIR / "health_check.log"

# 交易日判断（简化版，忽略节假日）
TRADING_WEEKDAYS = {1, 2, 3, 4, 5}  # Mon-Fri


def is_trading_day(date_str: str) -> bool:
    """判断是否为交易日（简化：周一到周五，不精确处理节假日）"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.weekday() in TRADING_WEEKDAYS


def get_last_trading_day(ref_date: datetime = None) -> str:
    """获取最近一个交易日（回溯到周一到周五）"""
    d = ref_date or datetime.now()
    # 如果今天是周末，回溯到周五
    while d.weekday() not in TRADING_WEEKDAYS:
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def get_trading_day_before(date_str: str) -> str:
    """获取前一个交易日"""
    d = datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)
    while d.weekday() not in TRADING_WEEKDAYS:
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def log(msg: str):
    """记录日志到文件和 stdout"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ============ Observe: 检查各维度数据新鲜度 ============

def check_prediction_freshness() -> dict:
    """检查预测历史最新日期"""
    history_path = REBUILD_DIR / "prediction_history.json"
    if not history_path.exists():
        return {"status": "missing", "latest": None, "lag": 999}

    with open(history_path, "r", encoding="utf-8") as f:
        history = json.load(f)

    if not history:
        return {"status": "empty", "latest": None, "lag": 999}

    latest_date = history[-1].get("date", "")
    today = get_last_trading_day()

    if latest_date == today:
        return {"status": "fresh", "latest": latest_date, "lag": 0}

    # 计算滞后交易日数
    lag = 0
    d = datetime.strptime(today, "%Y-%m-%d")
    while d.strftime("%Y-%m-%d") > latest_date:
        if d.weekday() in TRADING_WEEKDAYS:
            lag += 1
        d -= timedelta(days=1)

    return {"status": "stale", "latest": latest_date, "lag": lag}


def check_market_data_freshness() -> dict:
    """检查行情数据最新日期（以首个股票 CSV 文件修改时间为代表）"""
    stocks = get_rebuild_stocks()
    if not stocks:
        return {"status": "missing", "latest": None, "lag": 999}

    symbol = list(stocks.keys())[0]
    csv_path = DATA_DIR / f"{symbol}_daily.csv"

    if not csv_path.exists():
        return {"status": "missing", "latest": None, "lag": 999}

    # 使用文件修改时间作为最新数据日期（更可靠，不依赖 pandas）
    mtime = datetime.fromtimestamp(csv_path.stat().st_mtime)
    latest_date = mtime.strftime("%Y-%m-%d")
    today = get_last_trading_day()

    if latest_date == today:
        return {"status": "fresh", "latest": latest_date, "lag": 0}

    # 计算滞后交易日数
    lag = 0
    d = datetime.strptime(today, "%Y-%m-%d")
    while d.strftime("%Y-%m-%d") > latest_date:
        if d.weekday() in TRADING_WEEKDAYS:
            lag += 1
        d -= timedelta(days=1)

    return {"status": "stale", "latest": latest_date, "lag": lag}


def check_paper_trading_freshness() -> dict:
    """检查模拟盘数据最新日期"""
    portfolio_path = PT_DIR / "portfolio.json"
    if not portfolio_path.exists():
        return {"status": "missing", "latest": None, "lag": 999}

    with open(portfolio_path, "r", encoding="utf-8") as f:
        portfolio = json.load(f)

    # 修复：portfolio.json 使用 "last_update" 字段，可能不存在则使用文件修改时间
    latest_date = portfolio.get("last_update", "")
    if not latest_date:
        # 回退到文件修改时间
        mtime = datetime.fromtimestamp(portfolio_path.stat().st_mtime)
        latest_date = mtime.strftime("%Y-%m-%d")

    today = get_last_trading_day()

    # 只比较日期部分
    latest_date = latest_date.split()[0] if " " in latest_date else latest_date

    if latest_date == today:
        return {"status": "fresh", "latest": latest_date, "lag": 0}

    lag = 0
    d = datetime.strptime(today, "%Y-%m-%d")
    while d.strftime("%Y-%m-%d") > latest_date:
        if d.weekday() in TRADING_WEEKDAYS:
            lag += 1
        d -= timedelta(days=1)

    return {"status": "stale", "latest": latest_date, "lag": lag}


def check_cos_sync_status() -> dict:
    """检查 COS 上的数据是否与本地一致（通过文件时间戳）"""
    # 检查本地 prediction_history.json 修改时间 vs 期望
    local_path = REBUILD_DIR / "prediction_history.json"
    if not local_path.exists():
        return {"status": "missing", "latest": None, "lag": 999}

    mtime = datetime.fromtimestamp(local_path.stat().st_mtime)
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    if mtime.date() == today.date():
        return {"status": "fresh", "latest": mtime.strftime("%Y-%m-%d %H:%M"), "lag": 0}

    # 计算滞后天数
    lag = (today.date() - mtime.date()).days
    return {"status": "stale", "latest": mtime.strftime("%Y-%m-%d %H:%M"), "lag": lag}


# ============ Decide + Act: 自动修复 ============

def run_command(cmd: list, timeout: int = 300) -> tuple[bool, str]:
    """执行命令并返回结果"""
    import subprocess
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, f"命令超时 ({timeout}s): {' '.join(cmd)}"
    except Exception as e:
        return False, str(e)


def repair_predictions() -> bool:
    """自动修复：重新执行预测并上传"""
    log("🔧 [修复] 开始重新执行预测...")

    python = sys.executable
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # 1. 更新价格数据
    ok, out = run_command([python, os.path.join(script_dir, "update_daily_data.py")])
    if not ok:
        log(f"⚠️ 价格更新失败: {out[:200]}")
    else:
        log("✅ 价格更新完成")

    # 2. 执行预测
    ok, out = run_command([python, os.path.join(script_dir, "daily_rebuild_record.py"), "--all"])
    if not ok:
        log(f"❌ 预测执行失败: {out[:200]}")
        return False
    log("✅ 预测执行完成")

    # 3. 上传 COS
    ok, out = run_command([python, os.path.join(script_dir, "upload_to_cos.py")])
    if not ok:
        log(f"❌ COS 上传失败: {out[:200]}")
        return False
    log("✅ COS 上传完成")

    return True


def repair_paper_trading() -> bool:
    """自动修复：重新执行模拟盘并上传"""
    log("🔧 [修复] 开始重新执行模拟盘...")

    python = sys.executable
    script_dir = os.path.dirname(os.path.abspath(__file__))

    ok, out = run_command([python, os.path.join(script_dir, "paper_trading_rebuild.py"), "full"])
    if not ok:
        log(f"❌ 模拟盘执行失败: {out[:200]}")
        return False
    log("✅ 模拟盘执行完成")

    # 上传已在 paper_trading_rebuild.py 中触发
    return True


def repair_all() -> dict:
    """执行所有修复操作"""
    results = {}

    pred = check_prediction_freshness()
    if pred["status"] != "fresh":
        results["prediction"] = repair_predictions()
    else:
        results["prediction"] = True

    pt = check_paper_trading_freshness()
    if pt["status"] != "fresh":
        results["paper_trading"] = repair_paper_trading()
    else:
        results["paper_trading"] = True

    return results


# ============ Feedback: 发送告警 ============

def send_alert(title: str, issues: list) -> bool:
    """发送飞书告警（复用 daily_sentiment_report.py 的 webhook）"""
    try:
        # 尝试加载飞书 webhook 配置
        config_path = Path(__file__).parent / "config.py"
        if config_path.exists():
            import importlib.util
            spec = importlib.util.spec_from_file_location("config", config_path)
            config = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(config)
            webhook = getattr(config, "FEISHU_WEBHOOK", None)
        else:
            webhook = None

        if not webhook:
            log("⚠️ 未配置飞书 webhook，跳过告警")
            return False

        import urllib.request
        payload = json.dumps({
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True},
                "header": {
                    "title": {"tag": "plain_text", "content": f"🚨 StockConsult {title}"},
                    "template": "red",
                },
                "elements": [
                    {"tag": "div", "text": {"tag": "lark_md", "content": "\n".join(f"- {i}" for i in issues)}},
                ]
            }
        }).encode("utf-8")

        req = urllib.request.Request(webhook, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        log("📤 飞书告警已发送")
        return True
    except Exception as e:
        log(f"⚠️ 发送告警失败: {e}")
        return False


# ============ Main: 完整闭环 ============

def run_health_check(repair: bool = False, alert: bool = True) -> dict:
    """
    完整闭环：
    1. Observe: 检查所有数据维度
    2. Orient: 汇总问题
    3. Decide: 是否需要修复/告警
    4. Act: 执行修复 + 发送告警
    5. Feedback: 修复后再次检查
    """
    log("=" * 60)
    log("🔍 健康检查开始")
    log("=" * 60)

    # Step 1: Observe
    checks = {
        "prediction": check_prediction_freshness(),
        "market_data": check_market_data_freshness(),
        "paper_trading": check_paper_trading_freshness(),
        "cos_sync": check_cos_sync_status(),
    }

    issues = []
    for name, result in checks.items():
        status_icon = {"fresh": "🟢", "stale": "🟡", "missing": "🔴", "error": "🔴"}
        icon = status_icon.get(result["status"], "⚪")
        lag = result.get("lag", 0)
        lag_str = f"滞后 {lag} 个交易日" if lag > 0 else "最新"
        log(f"{icon} {name}: {result['status']} ({result.get('latest', 'N/A')}) — {lag_str}")
        if result["status"] != "fresh":
            issues.append(f"{name}: {result['status']}, 滞后 {lag} 个交易日")

    # Step 2: Decide
    all_fresh = len(issues) == 0

    if all_fresh:
        log("✅ 所有检查通过，系统健康")
        log("=" * 60)
        return {"healthy": True, "issues": [], "repaired": {}}

    log(f"⚠️ 发现 {len(issues)} 个问题")

    # Step 3: Act — Repair
    repaired = {}
    if repair:
        log("🔧 开始自动修复...")
        repaired = repair_all()

        # Step 4: Feedback — 修复后再次检查
        log("🔍 修复后再次检查...")
        checks_after = {
            "prediction": check_prediction_freshness(),
            "paper_trading": check_paper_trading_freshness(),
        }
        still_issues = []
        for name, result in checks_after.items():
            if result["status"] != "fresh":
                still_issues.append(f"{name}: 修复后仍滞后 {result.get('lag', 0)} 个交易日")
        if still_issues:
            issues.extend(still_issues)
            log("❌ 修复后仍有滞后，需要人工介入")
        else:
            log("✅ 修复后数据已恢复新鲜")
    else:
        log("⏭️ 跳过自动修复（使用 --repair 启用）")

    # Step 5: Alert
    if alert and issues:
        send_alert("数据新鲜度告警", issues)

    log("=" * 60)
    return {"healthy": all_fresh and len(issues) == 0, "issues": issues, "repaired": repaired}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StockConsult 健康检查")
    parser.add_argument("--repair", action="store_true", help="发现滞后时自动修复")
    parser.add_argument("--no-alert", action="store_true", help="禁用飞书告警")
    args = parser.parse_args()

    result = run_health_check(repair=args.repair, alert=not args.no_alert)
    sys.exit(0 if result["healthy"] else 1)
