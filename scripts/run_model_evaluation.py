#!/usr/bin/env python3
"""
运行模型综合评估 (model_evaluation)
基于回测引擎的预测历史，进行统计显著性、校准、过拟合等全方位评估
"""
import json
import sys
import os
import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREDICTOR_DIR = os.path.join(PROJECT_ROOT, "cloudfunctions", "stock-predictor")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "public", "paper-trading")
os.makedirs(OUTPUT_DIR, exist_ok=True)

sys.path.insert(0, PREDICTOR_DIR)

from backtest_engine import BacktestEngine
from model_evaluation import ModelEvaluator

STOCKS = {
    "002617": "露笑科技",
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
}

print("=" * 90)
print("模型综合评估 (model_evaluation)")
print("=" * 90)

evaluator = ModelEvaluator()
all_reports = {}

for sym, name in STOCKS.items():
    print(f"\n📊 {name} ({sym})")
    engine = BacktestEngine(
        symbol=sym, stock_name=name,
        initial_capital=10000,
        lookback_days=252, retrain_days=20,
        confidence_threshold=0.15,
        stop_loss=0.05, take_profit=0.10,
        position_size=0.8,
    )
    result = engine.run()

    preds = result.get("predictions", [])
    if len(preds) < 30:
        print(f"  ⚠️ 预测样本不足 ({len(preds)}), 跳过评估")
        continue

    y_true = np.array([p["y_true"] for p in preds])
    y_pred = np.array([p["y_pred"] for p in preds])
    y_prob = np.array([p["y_prob"] for p in preds])

    # 过滤掉置信度为0的（模型未初始化时的预测）
    mask = y_prob > 0.01
    y_true_f = y_true[mask]
    y_pred_f = y_pred[mask]
    y_prob_f = y_prob[mask]

    if len(y_true_f) < 20:
        print(f"  ⚠️ 有效预测样本不足 ({len(y_true_f)}), 跳过评估")
        continue

    # 计算策略日收益率和买入持有日收益率（仅在有预测信号的天数）
    equity = result["equity_curve"]
    if not equity.empty:
        strategy_returns = equity["equity"].pct_change().dropna().tolist()
        price_series = equity["price"]
        buyhold_returns = price_series.pct_change().dropna().tolist()
        # 对齐长度
        min_len = min(len(strategy_returns), len(buyhold_returns), len(y_true_f))
        strategy_returns = strategy_returns[:min_len]
        buyhold_returns = buyhold_returns[:min_len]
    else:
        strategy_returns = None
        buyhold_returns = None

    # 构建预测历史列表
    pred_history = [{"prediction": int(y_pred_f[i])} for i in range(len(y_pred_f))]

    report = evaluator.comprehensive_evaluation(
        y_true=y_true_f,
        y_prob=y_prob_f,
        y_pred=y_pred_f,
        predictions_history=pred_history,
        strategy_returns=strategy_returns,
        buyhold_returns=buyhold_returns,
    )

    evaluator.print_evaluation_report(report)
    all_reports[sym] = {
        "name": name,
        "sample_size": int(report["sample_size"]),
        "positive_rate": float(report["positive_rate"]),
        "overall_score": float(report["overall_score"]),
        "verdict": report["verdict"],
        "verdict_level": report["verdict_level"],
        "tests": {k: v for k, v in report["tests"].items()},
    }

# 保存评估报告
report_path = os.path.join(OUTPUT_DIR, "evaluation.json")
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(all_reports, f, ensure_ascii=False, indent=2, default=str)

print("\n" + "=" * 90)
print("✅ 评估报告已保存到 public/paper-trading/evaluation.json")
print("=" * 90)

# 汇总
for sym, r in all_reports.items():
    verdict_emoji = {"pass": "✅", "conditional_pass": "⚠️", "warning": "❗", "fail": "❌"}.get(r["verdict_level"], "?")
    print(f"  {verdict_emoji} {r['name']} ({sym}): 评分 {r['overall_score']:.1f}/100 — {r['verdict']}")
