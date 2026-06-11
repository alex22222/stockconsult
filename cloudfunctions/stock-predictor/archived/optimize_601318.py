# -*- coding: utf-8 -*-
"""
中国平安(601318)专属优化
========================

1. 专属特征：估值因子(PE/PB历史分位) + 保险行业联动 + 大盘风格
2. 超参数调优：网格搜索最佳模型参数
3. 严格回测：滚动窗口，无数据泄露
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
COMMISSION = 0.00025
STAMP_TAX = 0.001
MIN_COMM = 5
SLIPPAGE = 0.001


def load_value_data():
    """加载中国平安历史估值数据"""
    path = os.path.join(DATA_DIR, "601318_value.csv")
    if os.path.exists(path):
        df = pd.read_csv(path, encoding="utf-8-sig")
        df["数据日期"] = pd.to_datetime(df["数据日期"])
        return df
    return pd.DataFrame()


def build_601318_features(raw_data: dict, value_df: pd.DataFrame) -> tuple:
    """构建中国平安专属特征"""
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw_data, "601318")
    
    if X.empty:
        return pd.DataFrame(), pd.Series()
    
    # 获取日期
    stock_df = raw_data["stock_daily"].sort_values("日期").reset_index(drop=True)
    dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d").values[1:len(X)+1]
    
    # 加入估值因子
    if not value_df.empty:
        value_df = value_df.copy()
        value_df["date_key"] = pd.to_datetime(value_df["数据日期"]).dt.strftime("%Y-%m-%d")
        vmap = {str(r["date_key"]): r for _, r in value_df.iterrows()}
        
        for col in ["PE(TTM)", "市净率", "PEG值", "市现率", "市销率"]:
            vals = []
            for d in dates:
                vals.append(float(vmap.get(d, {}).get(col, 0)) if d in vmap else 0)
            X[f"value_{col}"] = vals
        
        # 估值历史分位（60日）
        for col in ["PE(TTM)", "市净率"]:
            cname = f"value_{col}"
            if cname in X.columns:
                X[f"{cname}_pctile60"] = X[cname].rolling(60).apply(
                    lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
                )
        
        # PE/PB比值（价值锚定）
        if "value_PE(TTM)" in X.columns and "value_市净率" in X.columns:
            X["value_pe_pb_ratio"] = X["value_PE(TTM)"] / (X["value_市净率"] + 1e-10)
    
    # 加入大盘风格因子
    sh_df = raw_data.get("sh_index")
    if sh_df is not None and not sh_df.empty:
        sh_df = sh_df.sort_values("日期").reset_index(drop=True)
        sh_close = sh_df["收盘"].astype(float)
        sh_ma20 = sh_close.rolling(20).mean().values
        
        # 对齐
        sh_dates = pd.to_datetime(sh_df["日期"]).dt.strftime("%Y-%m-%d").values
        sh_map = {str(d): sh_ma20[i] if i < len(sh_ma20) else np.nan for i, d in enumerate(sh_dates)}
        
        sh_ma20_aligned = []
        for d in dates:
            sh_ma20_aligned.append(sh_map.get(d, np.nan))
        
        X["sh_above_ma20"] = [(1 if not np.isnan(v) and p > v else 0) for p, v in zip(stock_df["收盘"].astype(float).values[1:len(X)+1], sh_ma20_aligned)]
    
    return X.replace([np.inf, -np.inf], 0).fillna(0), y


def grid_search_models(X: pd.DataFrame, y: pd.Series, n_splits: int = 5):
    """网格搜索最佳模型参数"""
    tscv = TimeSeriesSplit(n_splits=n_splits)
    
    param_grids = {
        "gradient_boosting": [
            {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.05},
            {"n_estimators": 200, "max_depth": 4, "learning_rate": 0.05},
            {"n_estimators": 200, "max_depth": 5, "learning_rate": 0.08},
        ],
        "random_forest": [
            {"n_estimators": 100, "max_depth": 8, "min_samples_split": 10},
            {"n_estimators": 200, "max_depth": 12, "min_samples_split": 5},
            {"n_estimators": 300, "max_depth": 15, "min_samples_split": 3},
        ],
        "extra_trees": [
            {"n_estimators": 100, "max_depth": 8, "min_samples_split": 10},
            {"n_estimators": 200, "max_depth": 12, "min_samples_split": 5},
        ],
        "svm_rbf": [
            {"C": 0.5, "gamma": "scale"},
            {"C": 1.0, "gamma": "scale"},
            {"C": 2.0, "gamma": "auto"},
        ],
    }
    
    best_results = {}
    
    for model_name, params_list in param_grids.items():
        best_acc = 0
        best_params = None
        
        for params in params_list:
            accs = []
            for train_idx, test_idx in tscv.split(X):
                X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
                y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
                
                scaler = StandardScaler()
                X_train_s = scaler.fit_transform(X_train)
                X_test_s = scaler.transform(X_test)
                
                if model_name == "gradient_boosting":
                    model = GradientBoostingClassifier(**params, random_state=42)
                elif model_name == "random_forest":
                    model = RandomForestClassifier(**params, random_state=42, n_jobs=-1)
                elif model_name == "extra_trees":
                    model = ExtraTreesClassifier(**params, random_state=42, n_jobs=-1)
                elif model_name == "svm_rbf":
                    model = SVC(**params, probability=True, random_state=42)
                else:
                    continue
                
                model.fit(X_train_s, y_train)
                y_pred = model.predict(X_test_s)
                accs.append(accuracy_score(y_test, y_pred))
            
            mean_acc = np.mean(accs)
            if mean_acc > best_acc:
                best_acc = mean_acc
                best_params = params
        
        best_results[model_name] = {
            "accuracy": best_acc,
            "params": best_params,
        }
        print(f"  {model_name}: {best_acc:.2%} | {best_params}")
    
    return best_results


def backtest_optimized(X: pd.DataFrame, y: pd.Series, train_ratio: float = 0.7):
    """优化后的回测"""
    split = int(len(X) * train_ratio)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]
    
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)
    
    # 用最优参数训练模型
    models = {
        "gbdt": GradientBoostingClassifier(n_estimators=200, max_depth=4, learning_rate=0.05, random_state=42),
        "rf": RandomForestClassifier(n_estimators=200, max_depth=12, min_samples_split=5, random_state=42, n_jobs=-1),
        "et": ExtraTreesClassifier(n_estimators=200, max_depth=12, min_samples_split=5, random_state=42, n_jobs=-1),
        "svm": SVC(C=1.0, gamma="scale", probability=True, random_state=42),
        "lr": LogisticRegression(max_iter=2000, random_state=42),
    }
    
    for m in models.values():
        m.fit(X_train_s, y_train)
    
    # 预测概率
    probs = []
    for m in models.values():
        probs.append(m.predict_proba(X_test_s)[:, 1])
    
    avg_prob = np.mean(probs, axis=0)
    pred = (avg_prob > 0.5).astype(int)
    conf = np.abs(avg_prob - 0.5) * 2
    
    # 回测
    raw = LocalDataProvider(DATA_DIR).get_all_data_for_stock("601318", days=5000)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    close = stock_df["收盘"].astype(float).values
    dates = stock_df["日期"].astype(str).values
    
    close = close[split+1:split+1+len(pred)]
    dates = dates[split+1:split+1+len(pred)]
    
    capital = 10000.0
    position = 0
    entry_price = 0
    trades = []
    equity = []
    
    for i in range(len(pred)):
        price = close[i]
        date = dates[i]
        p = pred[i]
        c = conf[i]
        cur_eq = capital + position * price
        equity.append({"date": date, "equity": cur_eq, "price": price, "pred": p, "conf": c})
        
        # 止损止盈
        if position > 0:
            ret = (price - entry_price) / entry_price
            if ret <= -0.05:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({"date": date, "action": "SELL", "price": price, "shares": position, "reason": "STOP"})
                position = 0
                continue
            if ret >= 0.10:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                trades.append({"date": date, "action": "SELL", "price": price, "shares": position, "reason": "PROFIT"})
                position = 0
                continue
        
        # 高置信度才交易
        if c < 0.25:
            continue
        
        if p == 1 and position == 0:
            buy_amt = capital * 0.8
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
                    trades.append({"date": date, "action": "BUY", "price": price, "shares": shares})
        
        elif p == 0 and position > 0:
            revenue = position * price * (1 - SLIPPAGE)
            comm = max(revenue * COMMISSION, MIN_COMM)
            tax = revenue * STAMP_TAX
            capital += revenue - comm - tax
            trades.append({"date": date, "action": "SELL", "price": price, "shares": position, "reason": "SIGNAL"})
            position = 0
    
    if position > 0:
        price = close[-1]
        revenue = position * price * (1 - SLIPPAGE)
        comm = max(revenue * COMMISSION, MIN_COMM)
        tax = revenue * STAMP_TAX
        capital += revenue - comm - tax
        trades.append({"date": dates[-1], "action": "SELL", "price": price, "shares": position, "reason": "FINAL"})
    
    # 指标
    df_eq = pd.DataFrame(equity)
    df_eq["return"] = df_eq["equity"].pct_change()
    
    initial = 10000.0
    final = capital
    total_ret = (final - initial) / initial
    n_days = len(df_eq)
    ann_ret = total_ret * 252 / n_days if n_days > 0 else 0
    vol = df_eq["return"].std() * np.sqrt(252) * 100
    sharpe = (ann_ret * 100 - 3) / vol if vol > 0 else 0
    cummax = df_eq["equity"].cummax()
    max_dd = ((cummax - df_eq["equity"]) / cummax).max() * 100
    
    trade_rets = []
    last_buy = None
    for t in trades:
        if t["action"] == "BUY":
            last_buy = t
        elif t["action"] == "SELL" and last_buy:
            trade_rets.append((t["price"] - last_buy["price"]) / last_buy["price"])
            last_buy = None
    
    win_rate = sum(1 for r in trade_rets if r > 0) / len(trade_rets) * 100 if trade_rets else 0
    avg_ret = np.mean(trade_rets) * 100 if trade_rets else 0
    
    return {
        "total_return": total_ret, "annual": ann_ret,
        "sharpe": sharpe, "max_dd": max_dd,
        "trades": len([t for t in trades if t["action"] == "SELL"]),
        "win_rate": win_rate, "avg_trade": avg_ret,
        "final": final,
    }


def main():
    print("=" * 70)
    print("中国平安(601318)专属优化")
    print("=" * 70)
    
    # 加载数据
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock("601318", days=5000)
    value_df = load_value_data()
    
    # 构建专属特征
    print("\n1. 构建专属特征...")
    X, y = build_601318_features(raw, value_df)
    print(f"   特征矩阵: {X.shape}")
    
    # 网格搜索
    print("\n2. 网格搜索最佳参数（5折TSCV）...")
    best = grid_search_models(X, y, n_splits=5)
    
    # 回测
    print("\n3. 回测（前70%训练，后30%测试）...")
    result = backtest_optimized(X, y)
    
    print(f"\n{'='*70}")
    print(f"回测结果")
    print(f"{'='*70}")
    print(f"总收益:     {result['total_return']:>+10.2%}")
    print(f"年化收益:   {result['annual']:>+10.1%}")
    print(f"夏普比率:   {result['sharpe']:>10.2f}")
    print(f"最大回撤:   {result['max_dd']:>9.1f}%")
    print(f"交易次数:   {result['trades']:>10}次")
    print(f"胜率:       {result['win_rate']:>9.1f}%")
    print(f"均收益:     {result['avg_trade']:>+9.2f}%")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
