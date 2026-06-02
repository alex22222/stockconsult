# -*- coding: utf-8 -*-
"""
回归预测模型综合评估
====================
基于 prediction_history.json 中的已验证记录，运行 model_evaluation 的统计检验。
输出标准化 JSON 报告供前端展示。

文档建议 (Phase 0): 证明或证伪模型预测能力
"""
import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List

from model_evaluation import ModelEvaluator

REBUILD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rebuild")


def load_verified_records() -> List[Dict]:
    """加载已验证的预测记录"""
    path = os.path.join(REBUILD_DIR, "prediction_history.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        history = json.load(f)
    return [r for r in history if r.get("verified") and r.get("actual_return") is not None]


def evaluate_symbol(records: List[Dict], symbol: str) -> Dict:
    """对单只股票运行综合评估"""
    sym_records = [r for r in records if r.get("symbol") == symbol]
    if len(sym_records) < 10:
        return {"error": f"样本不足 ({len(sym_records)} < 10)"}
    
    # 提取预测值和实际值
    pred_returns = np.array([r.get("predicted_return_5d", 0) or 0 for r in sym_records])
    actual_returns = np.array([r.get("actual_return", 0) or 0 for r in sym_records])
    
    # 方向标签
    pred_direction = (pred_returns > 0).astype(int)
    actual_direction = (actual_returns > 0).astype(int)
    
    evaluator = ModelEvaluator()
    
    # 1. 二项检验（方向准确率是否显著高于50%）
    correct = int((pred_direction == actual_direction).sum())
    total = len(sym_records)
    binom = evaluator.binomial_test(correct, total, p_null=0.5)
    
    # 2. 置换检验（需要概率，回归没有概率，用 |预测值|/max 近似）
    # 将预测值映射为 0-1 概率
    max_pred = max(abs(pred_returns).max(), 1.0)
    y_prob = np.clip(0.5 + pred_returns / max_pred * 0.4, 0.1, 0.9)
    perm = evaluator.permutation_test(actual_direction, y_prob, n_permutations=500, metric="accuracy")
    
    # 3. 游程检验
    runs = evaluator.runs_test(pred_direction, actual_direction)
    
    # 4. 置信度校准（将预测值分箱）
    # 按预测强度分箱，检查每个箱内的实际正例比例
    calib = _calibration_regression(actual_returns, pred_returns, n_bins=5)
    
    # 5. 经济意义：模拟简单策略收益
    strategy_returns = []
    buyhold_returns = []
    for r in sym_records:
        actual = r.get("actual_return", 0) or 0
        pred = r.get("predicted_return_5d", 0) or 0
        # 策略：预测涨则持有多头（赚 actual），预测跌则空仓（赚0）
        strat_ret = actual / 100 if pred > 0 else 0
        strategy_returns.append(strat_ret)
        buyhold_returns.append(actual / 100)
    
    econ = evaluator.economic_significance(
        strategy_returns, buyhold_returns, transaction_cost=0.004
    )
    
    # 6. 综合评分（简化版）
    scores = []
    scores.append(1.0 if binom["significant"] and binom["accuracy"] > 0.5 else 0.0)
    scores.append(1.0 if perm["significant"] else 0.0)
    scores.append(0.0 if runs["significant"] else 1.0)  # 游程不显著才是好的
    scores.append(1.0 if calib["well_calibrated"] else 0.5)
    scores.append(1.0 if econ.get("profitable_after_costs", False) else 0.0)
    
    overall_score = np.mean(scores) * 100 if scores else 0
    
    # 7. 基础统计
    mae = np.mean(np.abs(pred_returns - actual_returns))
    rmse = np.sqrt(np.mean((pred_returns - actual_returns) ** 2))
    correlation = np.corrcoef(pred_returns, actual_returns)[0, 1] if len(pred_returns) > 1 else 0
    
    return {
        "symbol": symbol,
        "sample_size": total,
        "direction_accuracy": binom["accuracy"],
        "direction_correct": correct,
        "binom_pvalue": binom["p_value"],
        "binom_significant": bool(binom["significant"]),
        "perm_pvalue": perm["p_value"],
        "perm_significant": bool(perm["significant"]),
        "runs_pvalue": runs.get("p_value", 1.0),
        "runs_significant": bool(runs.get("significant", False)),
        "mae": round(float(mae), 4),
        "rmse": round(float(rmse), 4),
        "correlation": round(float(correlation), 4),
        "calibration": calib,
        "economic": {
            "gross_return": round(float(econ["gross_return"]) * 100, 2),
            "net_return": round(float(econ["net_return"]) * 100, 2),
            "profit_factor": round(float(econ["profit_factor"]), 2),
            "sharpe_approx": round(float(econ["sharpe_approx"]), 2),
            "profitable_after_costs": bool(econ.get("profitable_after_costs", False)) if econ.get("profitable_after_costs") is not None else False,
        },
        "overall_score": round(float(overall_score), 1),
        "verdict": _verdict(overall_score),
        "records": [
            {"date": r["date"], "pred": round(r.get("predicted_return_5d", 0) or 0, 2),
             "actual": round(r.get("actual_return", 0) or 0, 2),
             "correct": (r.get("predicted_return_5d", 0) or 0) > 0 == (r.get("actual_return", 0) or 0) > 0}
            for r in sym_records
        ]
    }


def _calibration_regression(actuals: np.ndarray, preds: np.ndarray, n_bins: int = 5) -> Dict:
    """回归预测的校准分析：按预测强度分箱，检查每个箱内的平均实际收益"""
    # 按预测值分箱
    pred_min, pred_max = preds.min(), preds.max()
    if pred_min == pred_max:
        return {"well_calibrated": False, "ece": 1.0, "bins": []}
    
    bins = np.linspace(pred_min, pred_max, n_bins + 1)
    bin_preds = []
    bin_actuals = []
    bin_counts = []
    
    for i in range(n_bins):
        mask = (preds >= bins[i]) & (preds < bins[i + 1]) if i < n_bins - 1 else (preds >= bins[i]) & (preds <= bins[i + 1])
        if mask.sum() == 0:
            continue
        bin_preds.append(preds[mask].mean())
        bin_actuals.append(actuals[mask].mean())
        bin_counts.append(int(mask.sum()))
    
    # ECE: 预测均值与实际均值的加权绝对差
    total = sum(bin_counts)
    ece = sum(abs(bp - ba) * c / total for bp, ba, c in zip(bin_preds, bin_actuals, bin_counts)) if total > 0 else 1.0
    
    return {
        "well_calibrated": ece < 2.0,  # 回归ECE阈值放宽（单位是%）
        "ece": round(float(ece), 4),
        "bins": [
            {"pred_mean": round(float(bp), 2), "actual_mean": round(float(ba), 2), "count": c}
            for bp, ba, c in zip(bin_preds, bin_actuals, bin_counts)
        ]
    }


def _verdict(score: float) -> str:
    if score >= 60:
        return "模型基本合理，但需更多样本验证"
    elif score >= 40:
        return "模型合理性存疑，建议深入分析"
    else:
        return "模型未通过检验：当前特征集可能不包含有效alpha"


def main():
    records = load_verified_records()
    print(f"已验证记录总数: {len(records)}")
    
    if len(records) < 20:
        print("⚠️ 已验证样本不足，无法做可靠的统计检验")
        print("   建议：继续运行 daily_pipeline.sh 积累至少30个交易日的验证数据")
    
    symbols = sorted(set(r.get("symbol") for r in records))
    results = {}
    
    for sym in symbols:
        print(f"\n📊 {sym} 评估中...")
        result = evaluate_symbol(records, sym)
        results[sym] = result
        if "error" in result:
            print(f"   ⚠️ {result['error']}")
        else:
            print(f"   样本: {result['sample_size']} | 方向准确率: {result['direction_accuracy']:.1%} | "
                  f"二项检验 p={result['binom_pvalue']:.3f} | 综合评分: {result['overall_score']:.0f}")
            print(f"   裁决: {result['verdict']}")
            print(f"   MAE: {result['mae']:.2f}% | 相关系数: {result['correlation']:+.3f}")
    
    # 保存报告
    report = {
        "generated_at": datetime.now().isoformat(),
        "total_verified": len(records),
        "symbols_evaluated": list(results.keys()),
        "per_symbol": results,
        "summary": {
            "avg_direction_accuracy": round(
                np.mean([r["direction_accuracy"] for r in results.values() if "direction_accuracy" in r]), 4
            ) if results else 0,
            "avg_score": round(
                np.mean([r["overall_score"] for r in results.values() if "overall_score" in r]), 1
            ) if results else 0,
            "overall_verdict": "样本量不足，待积累" if len(records) < 30 else _verdict(
                np.mean([r["overall_score"] for r in results.values() if "overall_score" in r])
            ),
        }
    }
    
    def _convert(obj):
        if isinstance(obj, dict):
            return {k: _convert(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_convert(v) for v in obj]
        elif isinstance(obj, (np.bool_,)):
            return bool(obj)
        elif isinstance(obj, (np.integer,)):
            return int(obj)
        elif isinstance(obj, (np.floating,)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj
    
    report = _convert(report)
    
    output_path = os.path.join(REBUILD_DIR, "evaluation_report.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 评估报告已保存: {output_path}")
    return report


if __name__ == "__main__":
    main()
