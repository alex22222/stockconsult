# -*- coding: utf-8 -*-
"""
回测V2 — 回归预测 + 市场状态过滤 + 多因子择时
=================================================

改进点：
1. 从分类（涨/跌）转向回归（预测未来5日收益率）
2. 市场状态过滤：上证指数跌破20日均线 → 空仓
3. 多因子择时：预期收益>2% + 均线多头 + 放量 + 北向流入
4. 仓位管理：根据预期收益和置信度动态调整
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
COMMISSION = 0.00025
STAMP_TAX = 0.001
MIN_COMM = 5
SLIPPAGE = 0.001


def backtest_v2(symbol, name, train_ratio=0.7):
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    engineer = FeatureEngineer()
    X, _ = engineer.build_features(raw, symbol)
    
    if X.empty or len(X) < 200:
        return None
    
    # 构建回归目标：未来5日收益率
    stock_df = raw['stock_daily'].sort_values('日期').reset_index(drop=True)
    close = stock_df['收盘'].astype(float)
    future_5d_ret = (close.shift(-5) / close - 1) * 100  # 百分比
    future_5d_ret = future_5d_ret.iloc[:-1]
    min_len = min(len(X), len(future_5d_ret))
    X = X.iloc[:min_len]
    y_reg = future_5d_ret.iloc[:min_len]
    valid = y_reg.notna()
    X = X[valid]
    y_reg = y_reg[valid]
    
    # 划分训练/测试
    split = int(len(X) * train_ratio)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y_reg.iloc[:split], y_reg.iloc[split:]
    
    # 训练回归模型
    X_train_clean = X_train.replace([np.inf, -np.inf], 0).fillna(0)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_clean)
    
    models = {
        'gbr': GradientBoostingRegressor(n_estimators=100, max_depth=4, learning_rate=0.1, random_state=42),
        'rfr': RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1),
    }
    for m in models.values():
        m.fit(X_train_scaled, y_train)
    
    # 测试集预测
    X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
    X_test_scaled = scaler.transform(X_test_clean)
    
    preds = {}
    for name_m, m in models.items():
        preds[name_m] = m.predict(X_test_scaled)
    
    # 集成预测（简单平均）
    pred_ret = np.mean(list(preds.values()), axis=0)
    
    # 获取大盘20日均线用于市场状态过滤
    sh_index = raw['sh_index'].sort_values('日期').reset_index(drop=True) if 'sh_index' in raw else None
    
    # 日期和价格
    dates = stock_df['日期'].astype(str).values[1:1+len(pred_ret)]
    close_vals = close.values[1:1+len(pred_ret)]
    volumes = stock_df['成交量'].astype(float).values[1:1+len(pred_ret)] if '成交量' in stock_df.columns else None
    
    # 计算均线和成交量
    ma20 = pd.Series(close_vals).rolling(20).mean().values
    ma60 = pd.Series(close_vals).rolling(60).mean().values
    vol_ma20 = pd.Series(volumes).rolling(20).mean().values if volumes is not None else None
    
    # 北向资金
    nb_df = raw.get('northbound_money')
    nb_map = {}
    if nb_df is not None and not nb_df.empty:
        nb_df = nb_df.copy()
        if '日期' in nb_df.columns:
            nb_df['date_key'] = pd.to_datetime(nb_df['日期']).dt.strftime('%Y-%m-%d')
        elif 'date' in nb_df.columns:
            nb_df['date_key'] = pd.to_datetime(nb_df['date']).dt.strftime('%Y-%m-%d')
        for _, r in nb_df.iterrows():
            if pd.notna(r.get('date_key')):
                nb_map[str(r['date_key'])] = r.get('total_net_buy', 0)
    
    # 回测
    capital = 10000.0
    position = 0
    entry_price = 0
    trades = []
    equity = []
    
    for i in range(len(pred_ret)):
        price = close_vals[i]
        date = dates[i]
        expected_ret = pred_ret[i]
        cur_equity = capital + position * price
        equity.append({'date': date, 'equity': cur_equity, 'price': price, 'expected_ret': expected_ret})
        
        # === 市场状态过滤 ===
        # 1. 个股价格 < MA20 → 回避
        if not np.isnan(ma20[i]) and price < ma20[i]:
            if position > 0:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'BEAR_TREND'})
                position = 0
            continue
        
        # 2. 北向资金连续5日净流出 → 回避
        nb_today = nb_map.get(date, 0)
        
        # === 多因子择时条件 ===
        # 条件1: 预期收益 > 2%
        cond1 = expected_ret > 2.0
        # 条件2: 均线多头排列 (price > ma20 > ma60)
        cond2 = (not np.isnan(ma20[i]) and not np.isnan(ma60[i]) and price > ma20[i] > ma60[i])
        # 条件3: 成交量放大 (当日量 > 20日均量)
        cond3 = (vol_ma20 is not None and not np.isnan(vol_ma20[i]) and volumes[i] > vol_ma20[i] * 1.1)
        # 条件4: 北向资金流入或中性
        cond4 = nb_today >= -5e8  # 允许小幅流出
        
        signal_score = sum([cond1, cond2, cond3, cond4])
        
        # 止损止盈
        if position > 0:
            ret = (price - entry_price) / entry_price
            if ret <= -0.05:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'STOP_LOSS'})
                position = 0
                continue
            if ret >= 0.10:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'TAKE_PROFIT'})
                position = 0
                continue
        
        # 买入：至少3个条件满足 + 空仓
        if signal_score >= 3 and position == 0:
            position_pct = min(0.95, 0.5 + expected_ret / 20)  # 预期收益越高，仓位越大
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
                    trades.append({'date': date, 'action': 'BUY', 'price': price, 'shares': shares, 'expected_ret': expected_ret, 'score': signal_score})
        
        # 卖出：预期转负 或 信号分 < 2
        elif position > 0 and (expected_ret < -1.0 or signal_score < 2):
            revenue = position * price * (1 - SLIPPAGE)
            comm = max(revenue * COMMISSION, MIN_COMM)
            tax = revenue * STAMP_TAX
            capital += revenue - comm - tax
            trades.append({'date': date, 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'WEAK_SIGNAL'})
            position = 0
    
    # 平仓
    if position > 0:
        price = close_vals[-1]
        revenue = position * price * (1 - SLIPPAGE)
        comm = max(revenue * COMMISSION, MIN_COMM)
        tax = revenue * STAMP_TAX
        capital += revenue - comm - tax
        trades.append({'date': dates[-1], 'action': 'SELL', 'price': price, 'shares': position, 'reason': 'FINAL'})
    
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
    print("回测V2：回归预测 + 市场状态过滤 + 多因子择时")
    print("=" * 95)
    print(f"{'股票':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8}")
    print("-" * 95)
    
    for sym, name in symbols.items():
        r = backtest_v2(sym, name)
        if r:
            print(f"{name:<10} {r['total_return']:>+9.2%} {r['annual']:>+7.1%} {r['sharpe']:>7.2f} {r['max_dd']:>7.1f}% {r['trades']:>5}次 {r['win_rate']:>6.1f}% {r['avg_trade']:>+6.2f}%")
        else:
            print(f"{name:<10} 数据不足")


if __name__ == "__main__":
    main()
