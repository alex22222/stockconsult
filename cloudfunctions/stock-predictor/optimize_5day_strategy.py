#!/usr/bin/env python3
"""
5日策略深度优化 + 多股票验证

功能：
1. Walk-forward滚动交叉验证（避免前瞻偏差）
2. 置信度阈值网格搜索 [0.50, 0.55, 0.60, 0.65, 0.70]
3. 多模型共识模式（GBDT+RF都预测涨才交易）
4. 特征重要性排序 + Top-K选择（20/30/50/全部）
5. 4只股票统一验证
"""

import sys
import os
import json
import warnings
import numpy as np
import pandas as pd
from datetime import datetime

warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, roc_auc_score

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineer import FeatureEngineer

# ============ 配置 ============
LABEL_DAYS = 5
COST_PER_TRADE = 0.0017
INIT_CAPITAL = 10000.0

STOCKS = {
    "601318": {"name": "中国平安", "baostock": "sh.601318"},
    "002617": {"name": "露笑科技", "baostock": "sz.002617"},
    "300622": {"name": "博士眼镜", "baostock": "sz.300622"},
    "002896": {"name": "中大力德", "baostock": "sz.002896"},
}

THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70]
TOP_K_FEATURES = [20, 30, 50, 9999]  # 9999 = all


def load_all_data(symbol):
    """加载所有数据"""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    def load_csv(path, date_col):
        df = pd.read_csv(path)
        df[date_col] = pd.to_datetime(df[date_col])
        return df.sort_values(date_col).reset_index(drop=True)
    
    stock = load_csv(os.path.join(data_dir, f"{symbol}_daily.csv"), "日期")
    sh_index = load_csv(os.path.join(data_dir, "sh_index_000001.csv"), "日期")
    sz_index = load_csv(os.path.join(data_dir, "sz_index_399001.csv"), "日期")
    cy_index = load_csv(os.path.join(data_dir, "cy_index_399006.csv"), "日期")
    us = load_csv(os.path.join(data_dir, "us_overnight.csv"), "date")
    nb = load_csv(os.path.join(data_dir, "northbound_money.csv"), "日期")
    zt = load_csv(os.path.join(data_dir, "zt_pool.csv"), "date")
    bond = load_csv(os.path.join(data_dir, "bond_yield.csv"), "日期")
    
    value_path = os.path.join(data_dir, f"{symbol}_value.csv")
    value = pd.DataFrame()
    if os.path.exists(value_path):
        value = load_csv(value_path, "数据日期")
        value = value.rename(columns={"数据日期": "日期"})
    
    return {
        "stock_daily": stock, "sh_index": sh_index, "sz_index": sz_index,
        "cy_index": cy_index, "us_overnight": us, "northbound_money": nb,
        "zt_pool": zt, "bond_yield": bond, "value": value,
    }


def build_features(data, symbol):
    """构建5日策略特征"""
    fe = FeatureEngineer()
    stock_df = data["stock_daily"]
    all_factors = []
    
    all_factors.append(fe.calc_market_environment_factors(stock_df, data["sh_index"], data["sz_index"], data["cy_index"]))
    all_factors.append(fe.calc_market_energy_factors(stock_df, data["sh_index"]))
    all_factors.append(fe.calc_market_sentiment_factors(stock_df, pd.DataFrame()))
    all_factors.append(fe.calc_technical_indicators(stock_df))
    all_factors.append(fe.calc_sector_heat_factors(stock_df, pd.DataFrame(), ""))
    all_factors.append(fe.calc_fund_anomaly_factors(stock_df, pd.DataFrame()))
    all_factors.append(fe.calc_us_market_factors(stock_df, data["us_overnight"]))
    all_factors.append(fe.calc_market_sentiment_factors_v2(stock_df, data["northbound_money"], data["zt_pool"], data["bond_yield"]))
    
    # 估值因子
    value_df = data["value"]
    if not value_df.empty:
        vf = pd.DataFrame(index=stock_df.index)
        dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d")
        vd = value_df["日期"].dt.strftime("%Y-%m-%d")
        vm = dict(zip(vd, value_df.to_dict("records")))
        for col in ["PE(TTM)", "PE(静)", "市净率", "PEG值", "市现率", "市销率"]:
            vf[f"value_{col}"] = dates.map(lambda d: vm.get(d, {}).get(col, np.nan))
        for col in ["PE(TTM)", "市净率", "PEG值", "市现率", "市销率"]:
            c = f"value_{col}"
            vf[f"{c}_pctile"] = vf[c].rolling(250).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100 if len(x)>0 else 50)
        all_factors.append(vf)
    else:
        all_factors.append(pd.DataFrame(index=stock_df.index))
    
    features = pd.concat(all_factors, axis=1)
    
    # 5日特有特征
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
    features["price_pctile_5d"] = close.rolling(5).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    features["price_pctile_10d"] = close.rolling(10).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    features["price_pctile_20d"] = close.rolling(20).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    delta = close.diff()
    gain_5 = delta.where(delta > 0, 0).rolling(5).mean()
    loss_5 = (-delta.where(delta < 0, 0)).rolling(5).mean()
    features["rsi_5"] = 100 - 100 / (1 + gain_5 / (loss_5 + 1e-10))
    features["max_drawdown_5d"] = (close.rolling(5).min() / close - 1) * 100
    features["max_runup_5d"] = (close.rolling(5).max() / close - 1) * 100
    features["range_5d"] = (close.rolling(5).max() - close.rolling(5).min()) / close * 100
    features["volume_chg_5d"] = (volume / volume.shift(5) - 1) * 100
    ema5 = close.ewm(span=5).mean()
    ema10 = close.ewm(span=10).mean()
    features["macd_5_10"] = (ema5 - ema10) / close * 100
    
    return features.replace([np.inf, -np.inf], 0).fillna(0)


def prepare_data(stock_df, features, label_days=5):
    """每5日采样"""
    close = stock_df["收盘"].values
    dates = stock_df["日期"].values
    future_return = pd.Series(close).shift(-label_days) / pd.Series(close) - 1
    y = (future_return > 0).astype(int)
    indices = list(range(0, len(stock_df), label_days))
    valid_mask = ~features.isnull().any(axis=1) & ~y.isnull()
    valid_indices = [i for i in indices if valid_mask.iloc[i] and i >= 60]
    return features.iloc[valid_indices], y.iloc[valid_indices], dates[valid_indices], close[valid_indices]


def train_models(X_train, y_train):
    """训练多个模型"""
    scaler = StandardScaler()
    X_s = scaler.fit_transform(X_train)
    
    models = {}
    models["gbdt"] = GradientBoostingClassifier(
        n_estimators=150, max_depth=4, learning_rate=0.08,
        min_samples_split=20, min_samples_leaf=10, random_state=42
    ).fit(X_s, y_train)
    models["rf"] = RandomForestClassifier(
        n_estimators=100, max_depth=8, min_samples_split=15,
        min_samples_leaf=8, random_state=42, n_jobs=-1
    ).fit(X_s, y_train)
    models["et"] = ExtraTreesClassifier(
        n_estimators=100, max_depth=8, min_samples_split=15,
        min_samples_leaf=8, random_state=42, n_jobs=-1
    ).fit(X_s, y_train)
    models["lr"] = LogisticRegression(max_iter=2000, C=0.5, random_state=42).fit(X_s, y_train)
    
    # 特征重要性（GBDT）
    importance = pd.Series(models["gbdt"].feature_importances_, index=X_train.columns)
    
    return models, scaler, importance


def predict_models(models, scaler, X):
    """多模型预测"""
    X_s = scaler.transform(X)
    preds = {}
    probas = {}
    for name, model in models.items():
        preds[name] = model.predict(X_s)
        probas[name] = model.predict_proba(X_s)[:, 1]
    return preds, probas


def backtest_5day(dates, close, pred, proba, threshold=0.55):
    """5日回测"""
    n = len(dates)
    cash = INIT_CAPITAL
    equity = []
    trades = []
    in_position = False
    entry_price = 0
    holding_days = 0
    
    for i in range(n):
        price = close[i]
        
        if in_position:
            holding_days += 1
            if holding_days >= LABEL_DAYS or i == n - 1:
                gross = (price / entry_price - 1)
                net = gross - COST_PER_TRADE
                cash *= (1 + net)
                trades.append({"net": net * 100})
                in_position = False
                entry_price = 0
                holding_days = 0
        
        if not in_position and i < n - LABEL_DAYS:
            if pred[i] == 1 and proba[i] > threshold:
                in_position = True
                entry_price = price
                holding_days = 0
        
        eq = cash
        if in_position:
            eq = cash * (price / entry_price)
        equity.append(eq)
    
    if in_position:
        price = close[-1]
        gross = (price / entry_price - 1)
        net = gross - COST_PER_TRADE
        cash *= (1 + net)
        trades.append({"net": net * 100})
    
    trades_df = pd.DataFrame(trades)
    if len(trades_df) == 0:
        return None
    
    total_ret = (cash / INIT_CAPITAL - 1) * 100
    bh = (close[-1] / close[0] - 1) * 100
    win_rate = (trades_df["net"] > 0).mean() * 100
    rets = trades_df["net"].values / 100
    sharpe = (rets.mean() / (rets.std() + 1e-10)) * np.sqrt(52 / LABEL_DAYS)
    eq_arr = np.array(equity)
    peak = np.maximum.accumulate(eq_arr)
    max_dd = ((peak - eq_arr) / peak).max() * 100
    
    return {
        "return": total_ret, "excess": total_ret - bh, "sharpe": sharpe,
        "max_dd": max_dd, "win_rate": win_rate, "trades": len(trades_df),
        "avg_ret": trades_df["net"].mean(),
    }


def walk_forward_cv(X, y, dates, close, window_size=200, step_size=50):
    """
    Walk-forward交叉验证
    每次用 window_size 个样本训练，预测接下来 step_size 个样本
    """
    n = len(X)
    all_preds = {name: np.zeros(n) for name in ["gbdt", "rf", "et", "lr"]}
    all_probas = {name: np.zeros(n) for name in ["gbdt", "rf", "et", "lr"]}
    
    fold_results = []
    
    for start in range(window_size, n - step_size, step_size):
        train_idx = range(start - window_size, start)
        test_idx = range(start, min(start + step_size, n))
        
        X_train, X_test = X.iloc[list(train_idx)], X.iloc[list(test_idx)]
        y_train = y.iloc[list(train_idx)]
        
        models, scaler, _ = train_models(X_train, y_train)
        preds, probas = predict_models(models, scaler, X_test)
        
        for name in preds:
            for j, idx in enumerate(test_idx):
                all_preds[name][idx] = preds[name][j]
                all_probas[name][idx] = probas[name][j]
        
        # 该fold的准确率
        for name in preds:
            acc = accuracy_score(y.iloc[list(test_idx)], preds[name])
            auc = roc_auc_score(y.iloc[list(test_idx)], probas[name])
            fold_results.append({"fold": start, "model": name, "acc": acc, "auc": auc})
    
    return all_preds, all_probas, pd.DataFrame(fold_results)


def evaluate_strategy(X, y, dates, close, feature_names, importance, symbol_info):
    """
    全面评估：阈值搜索 + 特征选择 + 共识模式
    """
    print(f"\n{'='*70}")
    print(f"📊 {symbol_info['name']}({symbol_info['baostock']}) - 5日策略深度优化")
    print(f"{'='*70}")
    print(f"总样本: {len(X)} | 特征维度: {X.shape[1]}")
    
    # ========== 1. Walk-forward CV 获取预测 ==========
    print(f"\n🔁 Walk-forward交叉验证 (窗口={200}, 步长={50})...")
    all_preds, all_probas, fold_df = walk_forward_cv(X, y, dates, close, window_size=200, step_size=50)
    
    print(f"  完成 {len(fold_df)//4} 个folds")
    
    # CV平均性能
    cv_summary = fold_df.groupby("model").agg({"acc": "mean", "auc": "mean"}).reset_index()
    print(f"\n📈 CV平均性能:")
    for _, row in cv_summary.iterrows():
        print(f"  {row['model']:<8}: 准确率={row['acc']*100:.2f}%, AUC={row['auc']:.4f}")
    
    results = []
    
    # ========== 2. 阈值搜索（GBDT单模型）==========
    print(f"\n🔍 GBDT单模型 - 置信度阈值搜索:")
    for thresh in THRESHOLDS:
        bt = backtest_5day(dates, close, all_preds["gbdt"], all_probas["gbdt"], thresh)
        if bt:
            print(f"  阈值{thresh:.2f}: 收益={bt['return']:+.2f}% 夏普={bt['sharpe']:.2f} 交易={bt['trades']}次 胜率={bt['win_rate']:.1f}%")
            results.append({"mode": f"GBDT_t{thresh}", **bt, "cv_acc": fold_df[fold_df["model"]=="gbdt"]["acc"].mean()})
    
    # ========== 3. 多模型共识（GBDT+RF）==========
    print(f"\n🤝 多模型共识 (GBDT+RF都预测涨):")
    consensus_pred = ((all_preds["gbdt"] == 1) & (all_preds["rf"] == 1)).astype(int)
    consensus_proba = (all_probas["gbdt"] + all_probas["rf"]) / 2
    for thresh in THRESHOLDS:
        bt = backtest_5day(dates, close, consensus_pred, consensus_proba, thresh)
        if bt:
            print(f"  阈值{thresh:.2f}: 收益={bt['return']:+.2f}% 夏普={bt['sharpe']:.2f} 交易={bt['trades']}次 胜率={bt['win_rate']:.1f}%")
            results.append({"mode": f"Consensus_t{thresh}", **bt, "cv_acc": None})
    
    # ========== 4. 特征选择 + Top-K GBDT ==========
    print(f"\n✂️ 特征选择 (GBDT + 阈值0.60):")
    for top_k in TOP_K_FEATURES:
        k = min(top_k, len(feature_names))
        top_features = importance.nlargest(k).index.tolist()
        X_selected = X[top_features]
        
        # 重新做walk-forward
        preds_sel, probas_sel, _ = walk_forward_cv(X_selected, y, dates, close, window_size=200, step_size=50)
        bt = backtest_5day(dates, close, preds_sel["gbdt"], probas_sel["gbdt"], 0.60)
        if bt:
            print(f"  Top-{k:>4}: 收益={bt['return']:+.2f}% 夏普={bt['sharpe']:.2f} 交易={bt['trades']}次")
            results.append({"mode": f"GBDT_top{k}_t0.60", **bt, "cv_acc": None})
    
    # ========== 5. 最优结果汇总 ==========
    print(f"\n{'='*70}")
    print("🏆 最优配置汇总")
    print(f"{'='*70}")
    best_sharpe = max(results, key=lambda x: x["sharpe"])
    best_return = max(results, key=lambda x: x["return"])
    safest = max(results, key=lambda x: x["win_rate"] if x["trades"] >= 10 else 0)
    
    print(f"  最高夏普:   {best_sharpe['mode']} → 夏普{best_sharpe['sharpe']:.2f}, 收益{best_sharpe['return']:+.2f}%")
    print(f"  最高收益:   {best_return['mode']} → 收益{best_return['return']:+.2f}%, 夏普{best_return['sharpe']:.2f}")
    print(f"  最高胜率:   {safest['mode']} → 胜率{safest['win_rate']:.1f}%, 收益{safest['return']:+.2f}%")
    
    return {
        "symbol": symbol_info["name"],
        "best_sharpe": best_sharpe,
        "best_return": best_return,
        "safest": safest,
        "all_results": results,
        "cv_summary": cv_summary,
        "importance": importance,
    }


def main():
    print("=" * 70)
    print("5日策略深度优化 + 多股票验证")
    print("=" * 70)
    
    all_stock_results = {}
    
    for symbol, info in STOCKS.items():
        print(f"\n\n{'#'*70}")
        print(f"# 处理: {info['name']} ({symbol})")
        print(f"{'#'*70}")
        
        # 加载数据
        data = load_all_data(symbol)
        stock_df = data["stock_daily"]
        print(f"数据: {len(stock_df)}条 ({stock_df['日期'].min().date()} ~ {stock_df['日期'].max().date()})")
        
        # 构建特征
        features = build_features(data, symbol)
        print(f"特征: {features.shape[1]}维")
        
        # 准备数据
        X, y, dates, close = prepare_data(stock_df, features, LABEL_DAYS)
        print(f"样本: {len(X)}个 (上涨{y.sum()}/{len(y)}={y.mean()*100:.1f}%)")
        
        if len(X) < 300:
            print(f"⚠️ 样本不足，跳过")
            continue
        
        # 训练获取特征重要性
        split = int(len(X) * 0.7)
        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X.iloc[:split])
        gbdt = GradientBoostingClassifier(n_estimators=150, max_depth=4, learning_rate=0.08,
                                          min_samples_split=20, min_samples_leaf=10, random_state=42)
        gbdt.fit(X_train_s, y.iloc[:split])
        importance = pd.Series(gbdt.feature_importances_, index=X.columns)
        
        # 全面评估
        result = evaluate_strategy(X, y, dates, close, X.columns, importance, info)
        all_stock_results[symbol] = result
    
    # ========== 最终汇总 ==========
    print(f"\n\n{'='*70}")
    print("📋 4只股票策略对比")
    print(f"{'='*70}")
    print(f"{'股票':<10} {'最优模式':<20} {'收益':>8} {'夏普':>8} {'回撤':>8} {'胜率':>8} {'交易':>6}")
    print("-" * 70)
    for sym, res in all_stock_results.items():
        b = res["best_sharpe"]
        print(f"{STOCKS[sym]['name']:<8} {b['mode']:<20} {b['return']:>+7.2f}% {b['sharpe']:>8.2f} {b['max_dd']:>7.1f}% {b['win_rate']:>7.1f}% {b['trades']:>6}次")
    
    # 保存结果JSON
    output = {}
    for sym, res in all_stock_results.items():
        output[sym] = {
            "name": STOCKS[sym]["name"],
            "best_sharpe_mode": res["best_sharpe"]["mode"],
            "best_sharpe": res["best_sharpe"]["sharpe"],
            "best_return": res["best_sharpe"]["return"],
            "max_dd": res["best_sharpe"]["max_dd"],
            "win_rate": res["best_sharpe"]["win_rate"],
            "trades": res["best_sharpe"]["trades"],
            "top_features": res["importance"].nlargest(10).to_dict(),
        }
    
    out_path = os.path.join(os.path.dirname(__file__), "data", "strategy_5day_results.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n💾 结果已保存: {out_path}")


if __name__ == "__main__":
    main()
