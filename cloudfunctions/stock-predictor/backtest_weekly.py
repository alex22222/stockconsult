# -*- coding: utf-8 -*-
"""
周度策略回测 — 降低交易频率，提高信号质量

策略规则：
1. 每周五收盘后生成信号
2. 预测下周5日累计收益 > 0 且 置信度高 → 买入
3. 持有到下一个周五，或触发止损/止盈
4. 交易成本纳入
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
COMMISSION = 0.00025
STAMP_TAX = 0.001
MIN_COMM = 5
SLIPPAGE = 0.001


def backtest_weekly(symbol, name, train_ratio=0.7, conf_thresh=0.30,
                    stop_loss=0.05, take_profit=0.10, position_pct=0.8):
    """周度回测"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw, symbol)
    
    if X.empty or len(X) < 200:
        return None
    
    # 构建周度目标：未来5日累计收益 > 0
    stock_df = raw['stock_daily'].sort_values('日期').reset_index(drop=True)
    close = stock_df['收盘'].astype(float)
    future_5d = close.shift(-5) / close - 1
    y_weekly = (future_5d > 0).astype(int)
    y_weekly = y_weekly.iloc[:-1]
    min_len = min(len(X), len(y_weekly))
    X = X.iloc[:min_len]
    y_weekly = y_weekly.iloc[:min_len]
    valid = y_weekly.notna()
    X = X[valid]
    y_weekly = y_weekly[valid]
    
    # 划分训练/测试
    split = int(len(X) * train_ratio)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y_weekly.iloc[:split], y_weekly.iloc[split:]
    
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
    
    # 获取日期和价格
    dates = stock_df['日期'].astype(str).values[1:1+len(predictions)]
    close = close.values[1:1+len(predictions)]
    
    # 只取周五的信号（简化：每隔5个交易日交易一次）
    weekly_idx = list(range(0, len(predictions), 5))
    
    capital = 10000.0
    position = 0
    entry_price = 0
    trades = []
    equity = []
    
    for idx in weekly_idx:
        if idx >= len(predictions):
            break
        
        price = close[idx]
        date = dates[idx]
        pred = predictions[idx]
        conf = confidences[idx]
        cur_equity = capital + position * price
        equity.append({'date': date, 'equity': cur_equity, 'price': price, 'pred': pred, 'conf': conf})
        
        # 持仓中：检查止损止盈
        if position > 0:
            ret = (price - entry_price) / entry_price
            if ret <= -stop_loss or ret >= take_profit:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                reason = 'STOP_LOSS' if ret <= -stop_loss else 'TAKE_PROFIT'
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': reason})
                position = 0
                continue
        
        # 信号太弱，不操作
        if conf < conf_thresh:
            continue
        
        # 买入
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
                    trades.append({'date': date, 'action': 'BUY', 'price': price, 'shares': shares})
        
        # 卖出
        elif pred == 0 and position > 0:
            revenue = position * price * (1 - SLIPPAGE)
            comm = max(revenue * COMMISSION, MIN_COMM)
            tax = revenue * STAMP_TAX
            capital += revenue - comm - tax
            trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'SIGNAL'})
            position = 0
    
    # 平仓
    if position > 0:
        idx = min(weekly_idx[-1] + 5, len(close) - 1)
        price = close[idx]
        revenue = position * price * (1 - SLIPPAGE)
        comm = max(revenue * COMMISSION, MIN_COMM)
        tax = revenue * STAMP_TAX
        capital += revenue - comm - tax
        trades.append({'date': dates[idx], 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'FINAL'})
    
    # 指标
    df_eq = pd.DataFrame(equity)
    if df_eq.empty:
        return None
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
        'final': final,
    }


def main():
    symbols = {
        '002617': '露笑科技',
        '601318': '中国平安',
        '300622': '博士眼镜',
        '002896': '中大力德',
    }
    
    print("=" * 95)
    print("周度策略回测：前70%训练，后30%测试（置信度>0.30，5%止损/10%止盈）")
    print("=" * 95)
    print(f"{'股票':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8}")
    print("-" * 95)
    
    for sym, name in symbols.items():
        r = backtest_weekly(sym, name)
        if r:
            print(f"{name:<10} {r['total_return']:>+9.2%} {r['annual']:>+7.1%} {r['sharpe']:>7.2f} {r['max_dd']:>7.1f}% {r['trades']:>5}次 {r['win_rate']:>6.1f}% {r['avg_trade']:>+6.2f}%")
        else:
            print(f"{name:<10} 数据不足")


if __name__ == "__main__":
    main()
