# -*- coding: utf-8 -*-
"""
策略重建 — Walk-Forward 回测引擎
=================================
规则:
1. 滚动窗口训练（无数据泄露）
2. T+1开盘执行（预测今日，明日开盘交易）
3. 成本: 来回0.4%（佣金+印花税+滑点）
4. 止损: -3%硬止损（盘中触发，次日开盘执行）
5. 仓位: 根据预测收益率绝对值动态调整 |pred|∈[0,2%]→size∈[0.3,0.9]
6. 只做多: pred>0买入, pred<0空仓
"""
import warnings
warnings.filterwarnings('ignore')
import os
import sys
import pandas as pd
import numpy as np

from rebuild_predictor import (
    build_full_features, train_regression_model,
    DATA_DIR, PREDICT_HORIZON
)
from local_data_provider import LocalDataProvider

# 交易成本
COST_PER_TRADE = 0.004  # 来回 0.4%
STOP_LOSS = 0.03        # 3% 硬止损
INIT_CAPITAL = 10000.0

STOCKS = {
    "002617": "露笑科技",
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
}


def run_walkforward_backtest(symbol: str, stock_name: str,
                              lookback: int = 252, retrain: int = 20):
    """Walk-forward 回测"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    if len(stock_df) < lookback + 100:
        return {"error": "数据不足"}
    
    close = stock_df["收盘"].astype(float).values
    open_ = stock_df["开盘"].astype(float).values
    high = stock_df["最高"].astype(float).values
    low = stock_df["最低"].astype(float).values
    dates = stock_df["日期"].astype(str).values
    
    capital = INIT_CAPITAL
    position = 0
    entry_price = 0
    trades = []
    equity_curve = []
    
    start_idx = lookback + 10
    end_idx = len(close) - 1
    
    last_retrain = -999
    model_bundle = None
    
    for i in range(start_idx, end_idx):
        date = dates[i]
        price = close[i]
        open_price = open_[i]
        
        # ========== 执行前一日pending动作（T+1开盘成交）==========
        # 这里简化: 信号在i日收盘生成，i+1日开盘执行
        # 但我们在循环中先处理i日的持仓和权益
        
        # 计算当前权益
        equity = capital + position * price
        equity_curve.append({"date": date, "equity": equity, "price": price, "position": position})
        
        # 定期重新训练
        if i - last_retrain >= retrain or model_bundle is None:
            # 用 [0:i] 的数据训练
            model_bundle = train_regression_model_for_backtest(symbol, i)
            last_retrain = i
        
        if model_bundle is None or "error" in model_bundle:
            continue
        
        # 预测 i+1 日收益率
        pred_return = predict_next_return_for_backtest(symbol, stock_df, i, model_bundle)
        
        # 止损检查（盘中触发，次日开盘执行）
        if position > 0 and entry_price > 0:
            ret = (price - entry_price) / entry_price
            if ret <= -STOP_LOSS:
                # 次日开盘卖出
                if i + 1 < len(open_):
                    sell_price = open_[i + 1] * (1 - 0.002)  # 滑点
                    revenue = position * sell_price * (1 - COST_PER_TRADE)
                    capital += revenue
                    trades.append({"date": dates[i+1], "action": "SELL", "price": sell_price, "reason": "STOP_LOSS", "return": ret})
                    position = 0
                    entry_price = 0
                continue
        
        # 交易决策
        if pred_return > 0 and position == 0:
            # 买入信号
            if i + 1 < len(open_):
                buy_price = open_[i + 1] * (1 + 0.002)  # 滑点
                size = 0.3 + min(abs(pred_return) / 2.0, 1.0) * 0.6  # |pred|∈[0,2]→size∈[0.3,0.9]
                size = min(size, 0.95)
                
                buy_amount = capital * size
                max_shares = int(buy_amount / buy_price / 100) * 100
                if max_shares >= 100:
                    cost = max_shares * buy_price * (1 + COST_PER_TRADE / 2)
                    if cost <= capital:
                        capital -= cost
                        position = max_shares
                        entry_price = buy_price
                        trades.append({"date": dates[i+1], "action": "BUY", "price": buy_price, "shares": max_shares, "reason": "SIGNAL", "pred": pred_return})
        
        elif pred_return <= 0 and position > 0:
            # 卖出信号
            if i + 1 < len(open_):
                sell_price = open_[i + 1] * (1 - 0.002)
                revenue = position * sell_price * (1 - COST_PER_TRADE / 2)
                capital += revenue
                ret = (sell_price - entry_price) / entry_price
                trades.append({"date": dates[i+1], "action": "SELL", "price": sell_price, "reason": "SIGNAL", "return": ret})
                position = 0
                entry_price = 0
    
    # 最终平仓
    if position > 0:
        final_price = close[-1] * (1 - 0.002)
        revenue = position * final_price * (1 - COST_PER_TRADE / 2)
        capital += revenue
        ret = (final_price - entry_price) / entry_price
        trades.append({"date": dates[-1], "action": "SELL", "price": final_price, "reason": "FINAL", "return": ret})
    
    return calculate_metrics(symbol, stock_name, equity_curve, trades, close, dates)


def train_regression_model_for_backtest(symbol: str, end_idx: int):
    """为回测训练模型（用[0:end_idx]数据）"""
    from rebuild_predictor import build_compact_features, StandardScaler, SelectKBest, mutual_info_regression
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import Ridge
    
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    if end_idx >= len(stock_df):
        end_idx = len(stock_df) - 1
    stock_df = stock_df.iloc[:end_idx + 1]
    
    if len(stock_df) < 80:
        return {"error": "数据不足"}
    
    feats = build_full_features(symbol, stock_df)
    close = stock_df["收盘"].astype(float)
    future_return = (close.shift(-1) / close - 1) * 100
    
    feats["target"] = future_return.values
    feats = feats.dropna(subset=["target"])
    
    y = feats["target"].values
    X_df = feats.drop(columns=["target", "date"], errors="ignore")
    
    if len(X_df) < 60:
        return {"error": "有效样本不足"}
    
    # 时间序列分割
    split = int(len(X_df) * 0.85)
    X_train, X_test = X_df.iloc[:split], X_df.iloc[split:]
    y_train, y_test = y[:split], y[split:]
    
    k = min(15, X_train.shape[1])
    selector = SelectKBest(score_func=mutual_info_regression, k=k)
    X_train_s = selector.fit_transform(X_train, y_train)
    
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_s)
    
    models = {
        "gbr": GradientBoostingRegressor(n_estimators=80, max_depth=3, learning_rate=0.05, random_state=42),
        "ridge": Ridge(alpha=1.0, random_state=42),
        "rf": RandomForestRegressor(n_estimators=80, max_depth=5, min_samples_leaf=5, random_state=42, n_jobs=-1),
    }
    
    for name, model in models.items():
        model.fit(X_train_scaled, y_train)
    
    return {
        "models": models,
        "scalers": {"default": scaler},
        "selectors": {"default": selector},
        "all_feature_cols": X_train.columns.tolist(),
    }


def predict_next_return_for_backtest(symbol: str, stock_df: pd.DataFrame, end_idx: int, model_bundle: dict):
    """为回测预测下一个收益率"""
    from rebuild_predictor import build_full_features
    
    stock_df = stock_df.iloc[:end_idx + 1]
    feats = build_full_features(symbol, stock_df)
    X_df = feats.drop(columns=["date"], errors="ignore")
    X_latest = X_df.iloc[[-1]]
    
    selector = model_bundle["selectors"]["default"]
    all_cols = model_bundle["all_feature_cols"]
    for c in all_cols:
        if c not in X_latest.columns:
            X_latest[c] = 0
    
    X_latest_s = selector.transform(X_latest[all_cols].values)
    scaler = model_bundle["scalers"]["default"]
    X_latest_scaled = scaler.transform(X_latest_s)
    
    preds = []
    for name, model in model_bundle["models"].items():
        preds.append(model.predict(X_latest_scaled)[0])
    
    return float(np.mean(preds))


def calculate_metrics(symbol: str, stock_name: str, equity_curve, trades, close, dates):
    """计算回测指标"""
    df_equity = pd.DataFrame(equity_curve)
    if df_equity.empty:
        return {}
    
    df_equity["return"] = df_equity["equity"].pct_change()
    
    initial = INIT_CAPITAL
    final = df_equity["equity"].iloc[-1]
    total_return = (final - initial) / initial
    n_days = len(df_equity)
    annual_return = total_return * 252 / n_days if n_days > 0 else 0
    daily_returns = df_equity["return"].dropna()
    volatility = daily_returns.std() * np.sqrt(252) * 100
    sharpe = (annual_return * 100 - 3) / volatility if volatility > 0 else 0
    cummax = df_equity["equity"].cummax()
    drawdown = (cummax - df_equity["equity"]) / cummax
    max_dd = drawdown.max() * 100
    
    # 胜率
    trade_returns = []
    buy_trade = None
    for t in trades:
        if t["action"] == "BUY":
            buy_trade = t
        elif t["action"] == "SELL" and buy_trade:
            ret = (t["price"] - buy_trade["price"]) / buy_trade["price"]
            trade_returns.append(ret)
            buy_trade = None
    
    win_rate = sum(1 for r in trade_returns if r > 0) / len(trade_returns) * 100 if trade_returns else 0
    avg_trade_return = np.mean(trade_returns) * 100 if trade_returns else 0
    
    # Buy & Hold 基准
    bh_start = close[len(close) - len(df_equity)]
    bh_end = close[-1]
    bh_return = (bh_end - bh_start) / bh_start
    
    return {
        "symbol": symbol,
        "name": stock_name,
        "initial": initial,
        "final": final,
        "total_return": total_return,
        "annual_return": annual_return,
        "volatility": volatility,
        "sharpe": sharpe,
        "max_dd": max_dd,
        "trades": len(trade_returns),
        "win_rate": win_rate,
        "avg_trade_return": avg_trade_return,
        "buyhold_return": bh_return,
        "excess_return": total_return - bh_return,
        "equity_curve": df_equity,
        "trade_list": trades,
    }


if __name__ == "__main__":
    print("=" * 100)
    print("策略重建 — Walk-Forward 回测（次日预测 + 非价格特征 + mutual_info 选择）")
    print("=" * 100)
    print(f"{'股票':<10} {'策略收益':>10} {'BuyHold':>10} {'超额':>10} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8}")
    print("-" * 100)
    
    for sym, name in STOCKS.items():
        result = run_walkforward_backtest(sym, name)
        if "error" in result:
            print(f"{name:<10} {result['error']}")
            continue
        print(f"{name:<10} {result['total_return']:>+9.2%} {result['buyhold_return']:>+9.2%} {result['excess_return']:>+9.2%} {result['sharpe']:>7.2f} {result['max_dd']:>7.1f}% {result['trades']:>5}次 {result['win_rate']:>6.1f}% {result['avg_trade_return']:>+6.2f}%")
