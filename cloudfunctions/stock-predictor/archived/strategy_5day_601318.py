#!/usr/bin/env python3
"""
5日持仓策略原型 - 中国平安(601318)

核心逻辑：
1. 标签 = 未来5日收益率是否 > 0
2. 每5个交易日采样一次（避免标签重叠）
3. 预测涨 + 置信度>阈值 → 买入持有5天
4. 预测跌 → 空仓等待
5. 固定5天后强制平仓
"""

import sys
import os
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, roc_auc_score
import joblib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineer import FeatureEngineer

# ============ 配置 ============
STOCK_CODE = "sh.601318"
SYMBOL = "601318"
LABEL_DAYS = 5
COST_PER_TRADE = 0.0017  # 0.17% 每次完整交易

MODELS = {
    "gbdt": GradientBoostingClassifier(
        n_estimators=150, max_depth=4, learning_rate=0.08,
        min_samples_split=20, min_samples_leaf=10, random_state=42
    ),
    "rf": RandomForestClassifier(
        n_estimators=100, max_depth=8, min_samples_split=15,
        min_samples_leaf=8, random_state=42, n_jobs=-1
    ),
    "et": ExtraTreesClassifier(
        n_estimators=100, max_depth=8, min_samples_split=15,
        min_samples_leaf=8, random_state=42, n_jobs=-1
    ),
    "lr": LogisticRegression(max_iter=2000, C=0.5, random_state=42),
    "svm": SVC(C=1.0, kernel="rbf", probability=True, random_state=42),
}


def load_all_data(symbol):
    """加载所有数据，返回字典格式（兼容 feature_engineer.py）"""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    # 个股日线
    stock = pd.read_csv(os.path.join(data_dir, f"{symbol}_daily.csv"))
    stock["日期"] = pd.to_datetime(stock["日期"])
    stock = stock.sort_values("日期").reset_index(drop=True)
    
    # 上证指数
    sh_index = pd.read_csv(os.path.join(data_dir, "sh_index_000001.csv"))
    sh_index["日期"] = pd.to_datetime(sh_index["日期"])
    sh_index = sh_index.sort_values("日期").reset_index(drop=True)
    
    # 深证成指
    sz_index = pd.read_csv(os.path.join(data_dir, "sz_index_399001.csv"))
    sz_index["日期"] = pd.to_datetime(sz_index["日期"])
    sz_index = sz_index.sort_values("日期").reset_index(drop=True)
    
    # 创业板指
    cy_index = pd.read_csv(os.path.join(data_dir, "cy_index_399006.csv"))
    cy_index["日期"] = pd.to_datetime(cy_index["日期"])
    cy_index = cy_index.sort_values("日期").reset_index(drop=True)
    
    # 隔夜美股
    us = pd.read_csv(os.path.join(data_dir, "us_overnight.csv"))
    us["date"] = pd.to_datetime(us["date"])
    us = us.sort_values("date").reset_index(drop=True)
    
    # 北向资金
    nb = pd.read_csv(os.path.join(data_dir, "northbound_money.csv"))
    nb["日期"] = pd.to_datetime(nb["日期"])
    nb = nb.sort_values("日期").reset_index(drop=True)
    
    # 涨跌停
    zt = pd.read_csv(os.path.join(data_dir, "zt_pool.csv"))
    zt["date"] = pd.to_datetime(zt["date"])
    zt = zt.sort_values("date").reset_index(drop=True)
    
    # 国债收益率
    bond = pd.read_csv(os.path.join(data_dir, "bond_yield.csv"))
    bond["日期"] = pd.to_datetime(bond["日期"])
    bond = bond.sort_values("日期").reset_index(drop=True)
    
    # 估值数据
    value_path = os.path.join(data_dir, f"{symbol}_value.csv")
    value = pd.read_csv(value_path) if os.path.exists(value_path) else pd.DataFrame()
    if not value.empty:
        value["日期"] = pd.to_datetime(value["数据日期"])
        value = value.sort_values("日期").reset_index(drop=True)
    
    return {
        "stock_daily": stock,
        "sh_index": sh_index,
        "sz_index": sz_index,
        "cy_index": cy_index,
        "us_overnight": us,
        "northbound_money": nb,
        "zt_pool": zt,
        "bond_yield": bond,
        "value": value,
    }


def build_5day_features(data, symbol):
    """构建5日策略特征"""
    fe = FeatureEngineer()
    
    # 调用父类构建基础特征（151维+）
    stock_df = data["stock_daily"]
    
    # 手动调用各个因子计算（因为 build_features 返回的是 (X, y)）
    all_factors = []
    
    # 1. 市场环境
    env = fe.calc_market_environment_factors(stock_df, data["sh_index"], data["sz_index"], data["cy_index"])
    all_factors.append(env)
    
    # 2. 大盘能量
    energy = fe.calc_market_energy_factors(stock_df, data["sh_index"])
    all_factors.append(energy)
    
    # 3. 市场情绪
    sentiment = fe.calc_market_sentiment_factors(stock_df, pd.DataFrame())
    all_factors.append(sentiment)
    
    # 4. 技术指标
    tech = fe.calc_technical_indicators(stock_df)
    all_factors.append(tech)
    
    # 5. 板块热度
    sector = fe.calc_sector_heat_factors(stock_df, pd.DataFrame(), "")
    all_factors.append(sector)
    
    # 6. 资金异动
    fund = fe.calc_fund_anomaly_factors(stock_df, pd.DataFrame())
    all_factors.append(fund)
    
    # 7. 美股
    us = fe.calc_us_market_factors(stock_df, data["us_overnight"])
    all_factors.append(us)
    
    # 8. 市场情绪v2
    sentiment_v2 = fe.calc_market_sentiment_factors_v2(
        stock_df, data["northbound_money"], data["zt_pool"], data["bond_yield"]
    )
    all_factors.append(sentiment_v2)
    
    # 9. 估值因子（内联实现）
    value_df = data["value"]
    if not value_df.empty:
        value_factors = pd.DataFrame(index=stock_df.index)
        dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d")
        value_dates = value_df["日期"].dt.strftime("%Y-%m-%d")
        value_map = dict(zip(value_dates, value_df.to_dict("records")))
        
        for col in ["PE(TTM)", "PE(静)", "市净率", "PEG值", "市现率", "市销率"]:
            value_factors[f"value_{col}"] = dates.map(lambda d: value_map.get(d, {}).get(col, np.nan))
        
        # 估值分位数（250日滚动）
        for col in ["PE(TTM)", "市净率", "PEG值", "市现率", "市销率"]:
            c = f"value_{col}"
            if c in value_factors.columns:
                value_factors[f"{c}_pctile"] = value_factors[c].rolling(250).apply(
                    lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if len(x) > 0 else 50
                )
        
        all_factors.append(value_factors)
    else:
        all_factors.append(pd.DataFrame(index=stock_df.index))
    
    # 合并
    features = pd.concat(all_factors, axis=1)
    
    # ========== 5日特有特征 ==========
    close = stock_df["收盘"]
    volume = stock_df["成交量"]
    
    features["momentum_5d"] = close.pct_change(5) * 100
    features["momentum_10d"] = close.pct_change(10) * 100
    features["momentum_20d"] = close.pct_change(20) * 100
    features["momentum_60d"] = close.pct_change(60) * 100
    
    features["volatility_5d"] = close.pct_change().rolling(5).std() * 100 * np.sqrt(5)
    features["volatility_10d"] = close.pct_change().rolling(10).std() * 100 * np.sqrt(10)
    features["volatility_20d"] = close.pct_change().rolling(20).std() * 100 * np.sqrt(20)
    
    features["volume_ma5_ratio"] = volume / volume.rolling(5).mean()
    features["volume_ma10_ratio"] = volume / volume.rolling(10).mean()
    features["volume_ma20_ratio"] = volume / volume.rolling(20).mean()
    
    features["price_pctile_5d"] = close.rolling(5).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100
    )
    features["price_pctile_10d"] = close.rolling(10).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100
    )
    features["price_pctile_20d"] = close.rolling(20).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100
    )
    
    # 5日RSI
    delta = close.diff()
    gain_5 = delta.where(delta > 0, 0).rolling(5).mean()
    loss_5 = (-delta.where(delta < 0, 0)).rolling(5).mean()
    features["rsi_5"] = 100 - 100 / (1 + gain_5 / (loss_5 + 1e-10))
    
    # 5日价格形态
    features["max_drawdown_5d"] = (close.rolling(5).min() / close - 1) * 100
    features["max_runup_5d"] = (close.rolling(5).max() / close - 1) * 100
    features["range_5d"] = (close.rolling(5).max() - close.rolling(5).min()) / close * 100
    
    # 5日成交量变化
    features["volume_chg_5d"] = (volume / volume.shift(5) - 1) * 100
    
    # 5日MACD近似
    ema5 = close.ewm(span=5).mean()
    ema10 = close.ewm(span=10).mean()
    features["macd_5_10"] = (ema5 - ema10) / close * 100
    
    features = features.replace([np.inf, -np.inf], 0).fillna(0)
    return features


def prepare_data(stock_df, features, label_days=5):
    """准备5日预测数据，每5日采样一次避免标签重叠"""
    close = stock_df["收盘"].values
    dates = stock_df["日期"].values
    
    # 未来5日收益率
    future_return = pd.Series(close).shift(-label_days) / pd.Series(close) - 1
    y = (future_return > 0).astype(int)
    
    # 每5个交易日采样
    indices = list(range(0, len(stock_df), label_days))
    
    # 过滤无效数据
    valid_mask = ~features.isnull().any(axis=1) & ~y.isnull()
    valid_indices = [i for i in indices if valid_mask.iloc[i] and i >= 60]
    
    X = features.iloc[valid_indices]
    y = y.iloc[valid_indices]
    dates_sel = dates[valid_indices]
    close_sel = close[valid_indices]
    
    return X, y, dates_sel, close_sel


def train_and_backtest(X, y, dates, close, model_name="gbdt"):
    """训练 + 时间序列回测"""
    split_idx = int(len(X) * 0.7)
    
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    dates_test = dates[split_idx:]
    close_test = close[split_idx:]
    
    print(f"\n{'='*60}")
    print(f"5日策略 - {model_name.upper()}")
    print(f"{'='*60}")
    print(f"训练: {len(X_train)}个样本 | 测试: {len(X_test)}个样本")
    print(f"训练期: {pd.to_datetime(dates[0]).strftime('%Y-%m-%d')} ~ {pd.to_datetime(dates[split_idx-1]).strftime('%Y-%m-%d')}")
    print(f"测试期: {pd.to_datetime(dates[split_idx]).strftime('%Y-%m-%d')} ~ {pd.to_datetime(dates[-1]).strftime('%Y-%m-%d')}")
    
    # 标准化
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)
    
    # 训练
    model = MODELS[model_name]
    model.fit(X_train_s, y_train)
    
    # 预测
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)[:, 1]
    
    acc = accuracy_score(y_test, y_pred)
    auc = roc_auc_score(y_test, y_proba)
    
    print(f"\n📊 预测性能:")
    print(f"  准确率: {acc*100:.2f}%")
    print(f"  AUC:    {auc:.4f}")
    print(f"  基准涨占比: {y_test.mean()*100:.1f}%")
    
    # Top特征
    if hasattr(model, "feature_importances_"):
        imp = pd.Series(model.feature_importances_, index=X.columns)
        print(f"\n🔝 Top 5 特征:")
        for feat, v in imp.nlargest(5).items():
            print(f"  {feat}: {v:.4f}")
    
    # 回测
    return backtest_5day(dates_test, close_test, y_pred, y_proba, acc, auc, model_name)


def backtest_5day(dates, close, pred, proba, acc, auc, model_name):
    """5日持仓回测"""
    n = len(dates)
    cash = 10000.0
    equity = []
    trades = []
    in_position = False
    entry_price = 0
    entry_date = None
    holding_days = 0
    
    for i in range(n):
        date = pd.to_datetime(dates[i])
        price = close[i]
        
        if in_position:
            holding_days += 1
            # 5天后平仓
            if holding_days >= LABEL_DAYS or i == n - 1:
                gross = (price / entry_price - 1)
                net = gross - COST_PER_TRADE
                cash *= (1 + net)
                trades.append({
                    "entry": entry_date.strftime("%Y-%m-%d"),
                    "exit": date.strftime("%Y-%m-%d"),
                    "gross": gross * 100,
                    "net": net * 100,
                })
                in_position = False
                entry_price = 0
                holding_days = 0
        
        # 开仓（空仓时）
        if not in_position and i < n - LABEL_DAYS:
            if pred[i] == 1 and proba[i] > 0.55:
                in_position = True
                entry_price = price
                entry_date = date
                holding_days = 0
        
        # 记录净值
        if in_position:
            unrealized = (price / entry_price - 1)
            equity.append(cash * (1 + unrealized))
        else:
            equity.append(cash)
    
    # 强制平仓
    if in_position:
        price = close[-1]
        gross = (price / entry_price - 1)
        net = gross - COST_PER_TRADE
        cash *= (1 + net)
        trades.append({
            "entry": entry_date.strftime("%Y-%m-%d"),
            "exit": pd.to_datetime(dates[-1]).strftime("%Y-%m-%d"),
            "gross": gross * 100,
            "net": net * 100,
        })
    
    trades_df = pd.DataFrame(trades)
    
    if len(trades_df) == 0:
        print("⚠️ 无交易")
        return None
    
    total_ret = (cash / 10000 - 1) * 100
    win_rate = (trades_df["net"] > 0).mean() * 100
    avg_ret = trades_df["net"].mean()
    
    # 最大回撤
    eq = np.array(equity)
    peak = np.maximum.accumulate(eq)
    dd = (peak - eq) / peak
    max_dd = dd.max() * 100
    
    # 夏普（简化）
    rets = trades_df["net"].values / 100
    sharpe = (rets.mean() / (rets.std() + 1e-10)) * np.sqrt(52 / LABEL_DAYS)
    
    # 买入持有基准
    bh = (close[-1] / close[0] - 1) * 100
    
    print(f"\n📈 回测结果:")
    print(f"  策略收益:   {total_ret:+.2f}%")
    print(f"  买入持有:   {bh:+.2f}%")
    print(f"  超额收益:   {total_ret - bh:+.2f}%")
    print(f"  夏普比率:   {sharpe:.2f}")
    print(f"  最大回撤:   {max_dd:.1f}%")
    print(f"  交易次数:   {len(trades_df)}次")
    print(f"  胜率:       {win_rate:.1f}%")
    print(f"  均收益:     {avg_ret:+.2f}%")
    
    return {
        "model": model_name,
        "accuracy": acc,
        "auc": auc,
        "return": total_ret,
        "excess": total_ret - bh,
        "sharpe": sharpe,
        "max_dd": max_dd,
        "win_rate": win_rate,
        "trades": len(trades_df),
    }


def main():
    print("=" * 70)
    print("5日持仓策略 - 中国平安(601318)")
    print("=" * 70)
    
    # 加载数据
    print("\n📦 加载数据...")
    data = load_all_data(SYMBOL)
    stock_df = data["stock_daily"]
    print(f"  股票: {len(stock_df)}条 ({stock_df['日期'].min().date()} ~ {stock_df['日期'].max().date()})")
    
    # 构建特征
    print("\n🔧 构建特征...")
    features = build_5day_features(data, SYMBOL)
    print(f"  特征维度: {features.shape[1]}维")
    
    # 准备数据
    X, y, dates, close = prepare_data(stock_df, features, LABEL_DAYS)
    print(f"  5日样本: {len(X)}个 (每{LABEL_DAYS}日采样)")
    print(f"  上涨样本: {y.sum()} ({y.mean()*100:.1f}%)")
    
    # 测试所有模型
    results = []
    for name in MODELS:
        result = train_and_backtest(X, y, dates, close, name)
        if result:
            results.append(result)
    
    # 汇总
    if results:
        print(f"\n{'='*70}")
        print("📋 模型对比")
        print(f"{'='*70}")
        print(f"{'模型':<8} {'准确率':>8} {'AUC':>8} {'收益':>8} {'超额':>8} {'夏普':>8} {'回撤':>8} {'胜率':>8} {'交易':>6}")
        print("-" * 78)
        for r in results:
            print(f"{r['model']:<8} {r['accuracy']*100:>7.1f}% {r['auc']:>8.3f} {r['return']:>+7.2f}% {r['excess']:>+7.2f}% {r['sharpe']:>8.2f} {r['max_dd']:>7.1f}% {r['win_rate']:>7.1f}% {r['trades']:>6}次")
        
        best = max(results, key=lambda x: x["sharpe"])
        print(f"\n🏆 最佳模型: {best['model'].upper()} (夏普 {best['sharpe']:.2f}, 收益 {best['return']:+.2f}%)")


if __name__ == "__main__":
    main()
