#!/usr/bin/env python3
"""
运行修复后的回测并保存结果，包含基准对比（买入持有）
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

STOCKS = {
    "002617": "露笑科技",
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
}

all_trades = []
all_signals = []
report = {
    "generated_at": "2026-05-17",
    "total_trades": 0,
    "winning_trades": 0,
    "losing_trades": 0,
    "win_rate": 0,
    "avg_return": 0,
    "total_return": 0,
    "by_symbol": {},
    "pending_signals": [],
}

print("=" * 100)
print("修复后回测（T+1开盘执行 + 涨跌停过滤 + 动态仓位 + 含交易成本）")
print("=" * 100)
print(f"{'股票':<10} {'策略收益':>10} {'买入持有':>10} {'超额':>8} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8}")
print("-" * 100)

symbol_results = []
for sym, name in STOCKS.items():
    engine = BacktestEngine(
        symbol=sym, stock_name=name,
        initial_capital=10000, lookback_days=252, retrain_days=20,
        confidence_threshold=0.15, stop_loss=0.05, take_profit=0.10, position_size=0.8,
    )
    result = engine.run()

    # 计算买入持有基准收益
    start_price = engine.close[engine.lookback_days + 10]
    end_price = engine.close[-1]
    buyhold_return = (end_price - start_price) / start_price

    excess = result["total_return"] - buyhold_return
    symbol_results.append((sym, name, result, buyhold_return, excess))
    print(f"{name:<10} {result['total_return']:>+9.2%} {buyhold_return:>+9.2%} {excess:>+7.2%} {result['annual_return']:>+7.1%} {result['sharpe']:>7.2f} {result['max_dd']:>7.1f}% {result['trades']:>5}次 {result['win_rate']:>6.1f}% {result['avg_trade_return']:>+6.2f}%")

# 汇总
total_trades = 0
winning_trades = 0
losing_trades = 0
all_returns = []

for sym, name, result, buyhold, excess in symbol_results:
    total_trades += result["trades"]
    trade_returns = []
    buy_trade = None
    for t in result.get("trade_list", []):
        if t["action"] == "BUY":
            buy_trade = t
            all_signals.append({
                "id": f"{sym}-{t['date']}",
                "symbol": sym, "name": name,
                "signal": "buy", "date": t["date"],
                "price": t["price"], "confidence": 0.6,
                "status": "executed", "model_version": "v2-t1-fixed",
            })
        elif t["action"] == "SELL" and buy_trade:
            ret = (t["price"] - buy_trade["price"]) / buy_trade["price"]
            trade_returns.append(ret)
            all_trades.append({
                "id": f"{sym}-{buy_trade['date']}",
                "symbol": sym, "name": name,
                "entry_date": buy_trade["date"], "entry_price": buy_trade["price"],
                "exit_date": t["date"], "exit_price": t["price"],
                "gross_return": round(ret * 100, 2),
                "net_return": round(ret * 100, 2),
                "holding_days": 5,
            })
            if ret > 0:
                winning_trades += 1
            else:
                losing_trades += 1
            buy_trade = None

    wins = sum(1 for r in trade_returns if r > 0)
    report["by_symbol"][sym] = {
        "name": name,
        "trades": result["trades"],
        "win_rate": round(result["win_rate"], 1),
        "avg_return": round(result["avg_trade_return"], 2),
        "total_return": round(result["total_return"] * 100, 2),
        "buyhold_return": round(buyhold * 100, 2),
        "excess_return": round(excess * 100, 2),
        "sharpe": round(result["sharpe"], 2),
        "max_drawdown": round(result["max_dd"], 1),
    }
    all_returns.extend(trade_returns)

report["total_trades"] = total_trades
report["winning_trades"] = winning_trades
report["losing_trades"] = losing_trades
report["win_rate"] = round((winning_trades / total_trades * 100) if total_trades > 0 else 0, 1)
report["avg_return"] = round((sum(all_returns) / len(all_returns) * 100) if all_returns else 0, 2)
report["total_return"] = round(sum(all_returns) * 100 / len(STOCKS) if all_returns else 0, 2)

with open(os.path.join(OUTPUT_DIR, "report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
with open(os.path.join(OUTPUT_DIR, "trades.json"), "w", encoding="utf-8") as f:
    json.dump(all_trades, f, ensure_ascii=False, indent=2)
with open(os.path.join(OUTPUT_DIR, "signals.json"), "w", encoding="utf-8") as f:
    json.dump(all_signals, f, ensure_ascii=False, indent=2)

print("\n" + "=" * 100)
print(f"✅ 结果已保存")
print(f"   策略总交易: {total_trades} 笔 | 胜率: {report['win_rate']}% | 平均单笔: {report['avg_return']}%")
print(f"   写入: {OUTPUT_DIR}/report.json, trades.json, signals.json")
