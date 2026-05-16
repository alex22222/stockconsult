# -*- coding: utf-8 -*-
"""
快速回测 — 前70%训练，后30%测试（无数据泄露）

策略规则：
1. 预测上涨 + 置信度>阈值 → 买入（80%仓位）
2. 预测下跌 + 持仓 → 卖出
3. 止损5% / 止盈10%
4. 最少持有3天（避免过度交易）
5. 纳入交易成本
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
from sklearn.preprocessing import StandardScaler

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# 交易成本
COMMISSION = 0.00025
STAMP_TAX = 0.001
MIN_COMM = 5
SLIPPAGE = 0.001


def backtest(symbol, name, train_ratio=0.7, conf_thresh=0.20, stop_loss=0.05, take_profit=0.10,
             min_hold_days=3, position_pct=0.8):
    """快速回测"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw, symbol)
    
    if X.empty or len(X) < 200:
        return None
    
    # 划分训练/测试
    split = int(len(X) * train_ratio)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]
    
    # 训练
    trainer = ModelTrainer()
    trainer.train_ensemble(X_train, y_train, validation_split=0.2)
    
    # 测试集预测
    X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
    scaler = StandardScaler()
    scaler.fit(X_train.replace([np.inf, -np.inf], 0).fillna(0))
    X_test_scaled = scaler.transform(X_test_clean)
    
    probs, weights = [], []
    for mname, model in trainer.models.items():
        w = trainer.model_weights.get(mname, 0.25)
        p = model.predict_proba(X_test_scaled)[:, 1]
        probs.append(p)
        weights.append(w)
    
    avg_probs = sum(p * w for p, w in zip(probs, weights)) / sum(weights)
    predictions = (avg_probs > 0.5).astype(int)
    confidences = np.abs(avg_probs - 0.5) * 2
    
    # 价格数据
    stock_df = raw['stock_daily'].sort_values('日期').reset_index(drop=True)
    close = stock_df['收盘'].astype(float).values
    dates = stock_df['日期'].astype(str).values
    
    # 对齐：特征少一行
    close = close[split+1:split+1+len(predictions)]
    dates = dates[split+1:split+1+len(predictions)]
    
    # 回测
    capital = 10000.0
    position = 0
    entry_price = 0
    hold_days = 0
    entry_date = ""
    trades = []
    equity = []
    
    for i in range(len(predictions)):
        price = close[i]
        date = dates[i]
        pred = predictions[i]
        conf = confidences[i]
        cur_equity = capital + position * price
        equity.append({'date': date, 'equity': cur_equity, 'price': price, 'pred': pred, 'conf': conf})
        
        # 止损止盈
        if position > 0 and hold_days >= min_hold_days:
            ret = (price - entry_price) / entry_price
            if ret <= -stop_loss:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'STOP_LOSS'})
                position = 0
                hold_days = 0
                continue
            if ret >= take_profit:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'TAKE_PROFIT'})
                position = 0
                hold_days = 0
                continue
        
        # 信号交易（只交易置信度够的）
        if conf < conf_thresh:
            hold_days += 1 if position > 0 else 0
            continue
        
        if pred == 1 and position == 0:
            buy_amt = capital * position_pct
            p_slip = price * (1 + SLIPPAGE)
            shares = int(buy_amt / p_slip / 100) * 100
            if shares >= 100:
                cost = shares * p_slip
                comm = max(cost * COMMISSION, MIN_COMM)
                total = cost + comm
                if total <= capital:
                    capital -= total
                    position = shares
                    entry_price = price
                    hold_days = 0
                    entry_date = date
                    trades.append({'date': date, 'action': 'BUY', 'price': price, 'shares': shares})
        
        elif pred == 0 and position > 0 and hold_days >= min_hold_days:
            revenue = position * price * (1 - SLIPPAGE)
            comm = max(revenue * COMMISSION, MIN_COMM)
            tax = revenue * STAMP_TAX
            capital += revenue - comm - tax
            trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'SIGNAL'})
            position = 0
            hold_days = 0
        
        hold_days += 1 if position > 0 else 0
    
    # 平仓
    if position > 0:
        price = close[-1]
        revenue = position * price * (1 - SLIPPAGE)
        comm = max(revenue * COMMISSION, MIN_COMM)
        tax = revenue * STAMP_TAX
        capital += revenue - comm - tax
        trades.append({'date': dates[-1], 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'FINAL'})
    
    # 计算指标
    df_eq = pd.DataFrame(equity)
    df_eq['return'] = df_eq['equity'].pct_change()
    
    initial = 10000.0
    final = capital
    total_ret = (final - initial) / initial
    n_days = len(df_eq)
    ann_ret = total_ret * 252 / n_days if n_days > 0 else 0
    vol = df_eq['return'].std() * np.sqrt(252) * 100
    sharpe = (ann_ret * 100 - 3) / vol if vol > 0 else 0
    cummax = df_eq['equity'].cummax()
    max_dd = ((cummax - df_eq['equity']) / cummax).max() * 100
    
    # 胜率
    trade_rets = []
    last_buy = None
    for t in trades:
        if t['action'] == 'BUY':
            last_buy = t
        elif t['action'] == 'SELL' and last_buy:
            trade_rets.append((t['price'] - last_buy['price']) / last_buy['price'])
            last_buy = None
    
    win_rate = sum(1 for r in trade_rets if r > 0) / len(trade_rets) * 100 if trade_rets else 0
    avg_ret = np.mean(trade_rets) * 100 if trade_rets else 0
    
    return {
        'symbol': symbol, 'name': name,
        'total_return': total_ret, 'annual': ann_ret,
        'sharpe': sharpe, 'max_dd': max_dd,
        'trades': len([t for t in trades if t['action'] == 'SELL']),
        'win_rate': win_rate, 'avg_trade': avg_ret,
        'final': final, 'days': n_days,
        'equity': df_eq, 'trades_list': trades,
    }


def main():
    symbols = {
        '002617': '露笑科技',
        '601318': '中国平安',
        '300622': '博士眼镜',
        '002896': '中大力德',
    }
    
    print("=" * 95)
    print("快速回测：前70%训练，后30%测试（含止损止盈/低频交易/交易成本）")
    print("=" * 95)
    print(f"{'股票':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8} {'天数':>6}")
    print("-" * 95)
    
    for sym, name in symbols.items():
        r = backtest(sym, name)
        if r:
            print(f"{name:<10} {r['total_return']:>+9.2%} {r['annual']:>+7.1%} {r['sharpe']:>7.2f} {r['max_dd']:>7.1f}% {r['trades']:>5}次 {r['win_rate']:>6.1f}% {r['avg_trade']:>+6.2f}% {r['days']:>5}")
        else:
            print(f"{name:<10} 数据不足")


if __name__ == "__main__":
    main()
