#!/usr/bin/env python3
#
# ⚠️ 警告：此脚本依赖的回测引擎存在未来函数问题
# ==================================================
# 详见 docs/prediction-model-sharp-review-2026-06-02.md
# 回测结果不可引用，不能作为策略有效性的证据
# 状态：保留以兼容现有流程，但不作为决策依据
#
"""
样本外测试 (Out-of-Sample Test)
===============================
用 2022.06-2024.12 的数据训练，用 2025.01-2025.05 的数据做 OOS 回测。
验证模型在未见过的新数据上的表现。
"""
import json
import sys
import os
import pandas as pd

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREDICTOR_DIR = os.path.join(PROJECT_ROOT, "cloudfunctions", "stock-predictor")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "public", "paper-trading")
os.makedirs(OUTPUT_DIR, exist_ok=True)

sys.path.insert(0, PREDICTOR_DIR)

from backtest_engine import BacktestEngine

STOCKS = {
    "002617": "露笑科技",
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
}

OOS_CUTOFF = "2025-01-01"  # 样本外起始日期

print("=" * 90)
print("样本外测试 (OOS) — 训练: 2022.06-2024.12 | 测试: 2025.01-2025.05")
print("=" * 90)

oos_results = []

for sym, name in STOCKS.items():
    # 先跑全量回测获取 equity_curve
    engine = BacktestEngine(
        symbol=sym, stock_name=name,
        initial_capital=10000,
        lookback_days=252, retrain_days=20,
        confidence_threshold=0.15,
        stop_loss=0.03, take_profit=0.10,
        position_size=0.8,
    )
    result = engine.run()
    
    equity = result["equity_curve"]
    if equity.empty:
        continue
    
    # 分割 IS / OOS
    equity["date"] = pd.to_datetime(equity["date"])
    is_mask = equity["date"] < OOS_CUTOFF
    oos_mask = equity["date"] >= OOS_CUTOFF
    
    is_equity = equity[is_mask]
    oos_equity = equity[oos_mask]
    
    def calc_metrics(df, initial):
        if df.empty:
            return {}
        final = df["equity"].iloc[-1]
        ret = (final - initial) / initial
        n_days = len(df)
        daily_rets = df["equity"].pct_change().dropna()
        vol = daily_rets.std() * (252 ** 0.5) * 100 if len(daily_rets) > 1 else 0
        sharpe = (ret * 252 / n_days * 100 - 3) / vol if vol > 0 else 0
        cummax = df["equity"].cummax()
        dd = ((cummax - df["equity"]) / cummax).max() * 100
        return {"total_return": ret, "days": n_days, "sharpe": sharpe, "max_dd": dd, "final": final}
    
    is_metrics = calc_metrics(is_equity, result["initial"])
    oos_metrics = calc_metrics(oos_equity, is_metrics.get("final", result["initial"]) if is_metrics else result["initial"])
    
    # 统计 OOS 期内的交易
    oos_trades = []
    buy_trade = None
    for t in result.get("trade_list", []):
        if pd.to_datetime(t["date"]) >= pd.to_datetime(OOS_CUTOFF):
            if t["action"] == "BUY":
                buy_trade = t
            elif t["action"] == "SELL" and buy_trade:
                oos_trades.append((buy_trade, t))
                buy_trade = None
    
    trade_returns = [(s["price"] - b["price"]) / b["price"] for b, s in oos_trades]
    win_rate = sum(1 for r in trade_returns if r > 0) / len(trade_returns) * 100 if trade_returns else 0
    
    oos_results.append({
        "symbol": sym,
        "name": name,
        "is_return": round(is_metrics.get("total_return", 0) * 100, 2),
        "is_sharpe": round(is_metrics.get("sharpe", 0), 2),
        "is_max_dd": round(is_metrics.get("max_dd", 0), 2),
        "oos_return": round(oos_metrics.get("total_return", 0) * 100, 2),
        "oos_sharpe": round(oos_metrics.get("sharpe", 0), 2),
        "oos_max_dd": round(oos_metrics.get("max_dd", 0), 2),
        "oos_trades": len(oos_trades),
        "oos_win_rate": round(win_rate, 1),
    })
    
    print(f"{name:<10} IS收益={is_metrics.get('total_return', 0):>+7.2%} IS夏普={is_metrics.get('sharpe', 0):>5.2f} | OOS收益={oos_metrics.get('total_return', 0):>+7.2%} OOS夏普={oos_metrics.get('sharpe', 0):>5.2f} OOS交易={len(oos_trades)}次")

# 保存
with open(os.path.join(OUTPUT_DIR, "oos_test.json"), "w", encoding="utf-8") as f:
    json.dump({
        "generated_at": "2026-05-17",
        "oos_cutoff": OOS_CUTOFF,
        "stocks": oos_results,
    }, f, ensure_ascii=False, indent=2)

print("\n" + "=" * 90)
print("✅ OOS 测试结果已保存到 public/paper-trading/oos_test.json")
print("=" * 90)
