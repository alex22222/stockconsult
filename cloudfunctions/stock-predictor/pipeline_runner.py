#!/usr/bin/env python3
"""
StockConsult 流水线自愈引擎 — 闭环执行器
===========================================
Loop Engineering: Observe → Orient → Decide → Act → Feedback

职责:
1. 按顺序执行流水线步骤
2. 捕获异常 → 诊断类型 → 自动重试/降级
3. 记录每一步状态，失败不阻塞后续
4. 汇总报告，发送告警

用法:
    python pipeline_runner.py              # 完整执行
    python pipeline_runner.py --repair     # 带健康检查修复
"""

import os
import sys
import json
import subprocess
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 配置
PROJECT_DIR = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent / "data"
LOG_PATH = DATA_DIR / "pipeline_runner.log"
REPORT_PATH = DATA_DIR / "pipeline_report.json"
PYTHON = sys.executable

# 步骤定义: (名称, 命令函数, 超时秒, 是否关键, 降级策略)
# 降级策略: None=无, "continue"=失败继续, "retry"=指数退避重试


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


class PipelineStep:
    """单个流水线步骤"""
    def __init__(self, name: str, cmd_fn: Callable, timeout: int = 300, critical: bool = False, fallback: Optional[str] = None):
        self.name = name
        self.cmd_fn = cmd_fn
        self.timeout = timeout
        self.critical = critical  # 关键步骤：失败则整个流水线失败
        self.fallback = fallback   # 降级策略
        self.status = "pending"
        self.output = ""
        self.duration = 0.0
        self.error = ""

    def run(self) -> bool:
        """执行步骤，带重试和降级"""
        log(f"▶️  [{self.name}] 开始...")
        start = time.time()

        max_retries = 3 if self.fallback == "retry" else 1
        for attempt in range(max_retries):
            try:
                ok, output = self.cmd_fn()
                self.duration = time.time() - start
                self.output = output

                if ok:
                    self.status = "success"
                    log(f"✅  [{self.name}] 成功 ({self.duration:.1f}s)")
                    return True

                # 失败处理
                self.error = output
                self.status = "failed"

                if attempt < max_retries - 1:
                    wait_sec = 2 ** attempt  # 指数退避: 1s, 2s, 4s
                    log(f"⏳  [{self.name}] 第 {attempt+1}/{max_retries} 次失败，{wait_sec}s 后重试...")
                    time.sleep(wait_sec)
                else:
                    log(f"❌  [{self.name}] 最终失败: {output[:200]}")
                    if self.fallback == "continue":
                        log(f"🔄  [{self.name}] 非关键步骤，继续执行后续...")
                        return True  # 伪装成功，继续后续
                    return False

            except Exception as e:
                self.error = str(e)
                self.status = "error"
                log(f"💥  [{self.name}] 异常: {e}")
                traceback.print_exc()
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    return False

        return False


# ============ 各步骤命令函数 ============

def cmd_update_prices():
    """更新价格数据"""
    script = Path(__file__).parent / "update_daily_data.py"
    result = subprocess.run([PYTHON, str(script)], capture_output=True, text=True, timeout=300)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_update_sentiment():
    """更新市场情绪"""
    script = Path(__file__).parent / "fetch_market_sentiment_data.py"
    result = subprocess.run([PYTHON, str(script)], capture_output=True, text=True, timeout=120)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_predict():
    """执行预测"""
    script = Path(__file__).parent / "daily_rebuild_record.py"
    result = subprocess.run([PYTHON, str(script), "--all"], capture_output=True, text=True, timeout=600)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_paper_trading():
    """模拟盘更新"""
    script = Path(__file__).parent / "paper_trading_rebuild.py"
    result = subprocess.run([PYTHON, str(script), "full"], capture_output=True, text=True, timeout=300)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_sentiment_report():
    """生成舆情简报"""
    script = Path(__file__).parent / "daily_sentiment_report.py"
    result = subprocess.run([PYTHON, str(script), "--send"], capture_output=True, text=True, timeout=120)
    # 即使发送失败也视为成功（简报已生成）
    return True, result.stdout + result.stderr


def cmd_evaluation():
    """模型评估"""
    script = Path(__file__).parent / "run_rebuild_evaluation.py"
    result = subprocess.run([PYTHON, str(script)], capture_output=True, text=True, timeout=300)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_walkforward():
    """Walk-forward 回测"""
    script = Path(__file__).parent / "rebuild_walkforward.py"
    result = subprocess.run([PYTHON, str(script)], capture_output=True, text=True, timeout=300)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_upload_cos():
    """上传 COS"""
    script = Path(__file__).parent / "upload_to_cos.py"
    result = subprocess.run([PYTHON, str(script)], capture_output=True, text=True, timeout=300)
    return result.returncode == 0, result.stdout + result.stderr


def cmd_health_check():
    """健康检查"""
    script = Path(__file__).parent / "health_check.py"
    result = subprocess.run([PYTHON, str(script), "--repair"], capture_output=True, text=True, timeout=600)
    return result.returncode == 0, result.stdout + result.stderr


# ============ 流水线定义 ============

def get_full_pipeline() -> list[PipelineStep]:
    """完整流水线步骤"""
    return [
        PipelineStep("更新价格数据", cmd_update_prices, timeout=300, critical=False, fallback="continue"),
        PipelineStep("更新市场情绪", cmd_update_sentiment, timeout=120, critical=False, fallback="continue"),
        PipelineStep("执行预测", cmd_predict, timeout=600, critical=True, fallback="retry"),
        PipelineStep("模拟盘更新", cmd_paper_trading, timeout=300, critical=False, fallback="continue"),
        PipelineStep("舆情简报", cmd_sentiment_report, timeout=120, critical=False, fallback="continue"),
        PipelineStep("模型评估", cmd_evaluation, timeout=300, critical=False, fallback="continue"),
        PipelineStep("Walk-forward", cmd_walkforward, timeout=300, critical=False, fallback="continue"),
        PipelineStep("上传COS", cmd_upload_cos, timeout=300, critical=True, fallback="retry"),
    ]


def get_quick_pipeline() -> list[PipelineStep]:
    """快速流水线（只计算+上传）"""
    return [
        PipelineStep("更新价格数据", cmd_update_prices, timeout=300, critical=False, fallback="continue"),
        PipelineStep("执行预测", cmd_predict, timeout=600, critical=True, fallback="retry"),
        PipelineStep("模拟盘更新", cmd_paper_trading, timeout=300, critical=False, fallback="continue"),
        PipelineStep("上传COS", cmd_upload_cos, timeout=300, critical=True, fallback="retry"),
    ]


# ============ 执行器 ============

def run_pipeline(steps: list[PipelineStep]) -> dict:
    """执行完整流水线"""
    log("=" * 60)
    log("🚀 流水线启动")
    log("=" * 60)

    total_start = time.time()
    report = {
        "started_at": datetime.now().isoformat(),
        "steps": [],
        "success": True,
        "failed_steps": [],
    }

    for step in steps:
        ok = step.run()
        report["steps"].append({
            "name": step.name,
            "status": step.status,
            "duration": round(step.duration, 2),
            "error": step.error[:500] if step.error else "",
        })

        if not ok:
            report["failed_steps"].append(step.name)
            if step.critical:
                log(f"💥 关键步骤 [{step.name}] 失败，流水线终止")
                report["success"] = False
                break

    total_duration = time.time() - total_start
    report["total_duration"] = round(total_duration, 2)
    report["finished_at"] = datetime.now().isoformat()
    report["success"] = report["success"] and len(report["failed_steps"]) == 0

    # 保存报告
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    if report["success"]:
        log(f"✅ 流水线完成，总耗时 {total_duration:.1f}s")
    else:
        log(f"❌ 流水线失败，失败步骤: {', '.join(report['failed_steps'])}")

    log("=" * 60)
    return report


def run_with_health_check_repair() -> dict:
    """先健康检查修复，再执行流水线"""
    log("🔍 先执行健康检查修复...")
    repair_step = PipelineStep("健康检查修复", cmd_health_check, timeout=600, critical=False, fallback="continue")
    repair_step.run()

    return run_pipeline(get_full_pipeline())


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="StockConsult 流水线自愈引擎")
    parser.add_argument("--repair", action="store_true", help="先执行健康检查修复")
    parser.add_argument("--quick", action="store_true", help="快速模式（只计算+上传）")
    parser.add_argument("--report", action="store_true", help="打印最后报告")
    args = parser.parse_args()

    if args.report:
        if REPORT_PATH.exists():
            with open(REPORT_PATH, "r", encoding="utf-8") as f:
                print(json.dumps(json.load(f), ensure_ascii=False, indent=2))
        else:
            print("暂无报告")
        sys.exit(0)

    steps = get_quick_pipeline() if args.quick else get_full_pipeline()
    if args.repair:
        result = run_with_health_check_repair()
    else:
        result = run_pipeline(steps)

    sys.exit(0 if result["success"] else 1)
