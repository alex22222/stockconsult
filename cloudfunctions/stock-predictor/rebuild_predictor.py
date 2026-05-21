# -*- coding: utf-8 -*-
"""
策略重建 — 回归预测引擎
======================
目标: 预测未来5日收益率 (回归) + 识别异常波动机会 (分类)
特征: 精简价格特征(15个) + 每日积累的非价格特征(score/news/研报情绪)
模型: GradientBoostingRegressor + Ridge (正则化)
"""
import warnings
warnings.filterwarnings('ignore')
import os
import json
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple
from datetime import datetime, timedelta

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, f_regression, mutual_info_regression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
REBUILD_DIR = os.path.join(DATA_DIR, "rebuild")
os.makedirs(REBUILD_DIR, exist_ok=True)

# 预测目标天数
PREDICT_HORIZON = 1  # 次日收益率（噪声更小）
ANOMALY_HORIZON = 5  # 异常检测用5日窗口
ANOMALY_THRESHOLD = 2.0  # |收益率| > 2% 视为异常


def build_compact_features(stock_df: pd.DataFrame) -> pd.DataFrame:
    """
    构建精简的核心价格特征 (15个，避免维度灾难)
    """
    close = stock_df["收盘"].astype(float)
    volume = stock_df["成交量"].astype(float)
    high = stock_df["最高"].astype(float)
    low = stock_df["最低"].astype(float)
    
    f = pd.DataFrame(index=stock_df.index)
    
    # 1. 动量 (3)
    f["mom_1d"] = close.pct_change() * 100
    f["mom_5d"] = close.pct_change(5) * 100
    f["mom_20d"] = close.pct_change(20) * 100
    
    # 2. 波动率 (2)
    f["vol_5d"] = close.pct_change().rolling(5).std() * 100
    f["vol_20d"] = close.pct_change().rolling(20).std() * 100
    
    # 3. 量能 (3)
    f["vol_ratio_5"] = volume / volume.rolling(5).mean()
    f["vol_ratio_20"] = volume / volume.rolling(20).mean()
    f["vol_price_corr_5"] = close.rolling(5).corr(volume)
    
    # 4. 技术位置 (3)
    ma20 = close.rolling(20).mean()
    f["price_vs_ma20"] = (close - ma20) / ma20 * 100
    f["price_pctile_20d"] = close.rolling(20).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
    )
    f["atr_14"] = _calc_atr(high, low, close, 14) / close * 100
    
    # 5. 反转/连续信号 (2)
    f["consecutive_up"] = _consecutive(close, "up")
    f["consecutive_down"] = _consecutive(close, "down")
    
    # 6. 振幅/实体 (2)
    f["amplitude"] = (high - low) / close.shift(1) * 100
    f["body_ratio"] = abs(close - stock_df["开盘"]) / (high - low + 1e-10) * 100
    
    return f.replace([np.inf, -np.inf], 0).fillna(0)


def _calc_atr(high, low, close, period=14):
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.rolling(window=period).mean()


def _consecutive(close, direction):
    sig = (close > close.shift(1)).astype(int) if direction == "up" else (close < close.shift(1)).astype(int)
    cons = pd.Series(index=close.index, dtype=int)
    cnt = 0
    for i in range(len(sig)):
        cnt = cnt + 1 if sig.iloc[i] == 1 else 0
        cons.iloc[i] = cnt
    return cons


def load_nonprice_features(symbol: str) -> pd.DataFrame:
    """加载已积累的非价格特征（score, news sentiment等）"""
    path = os.path.join(REBUILD_DIR, f"{symbol}_nonprice.csv")
    if os.path.exists(path):
        df = pd.read_csv(path, encoding="utf-8-sig")
        df["date"] = pd.to_datetime(df["date"])
        return df.sort_values("date").reset_index(drop=True)
    return pd.DataFrame()


def build_full_features(symbol: str, stock_df: pd.DataFrame) -> pd.DataFrame:
    """合并价格特征 + 非价格特征"""
    price_feats = build_compact_features(stock_df)
    
    # 添加日期列用于 merge
    if "日期" in stock_df.columns:
        price_feats["date"] = pd.to_datetime(stock_df["日期"])
    else:
        price_feats["date"] = pd.to_datetime(stock_df.index)
    
    nonprice = load_nonprice_features(symbol)
    if nonprice.empty:
        return price_feats
    
    merged = pd.merge(price_feats, nonprice, on="date", how="left")
    # 非价格特征缺失时前向填充（当天的score适用于次日预测）
    nonprice_cols = [c for c in nonprice.columns if c != "date"]
    merged[nonprice_cols] = merged[nonprice_cols].ffill().fillna(0)
    return merged


def train_regression_model(symbol: str, days: int = 500) -> Dict:
    """
    训练回归模型，预测未来PREDICT_HORIZON日收益率
    
    Returns:
        {
            "models": {model_name: model},
            "scalers": {model_name: scaler},
            "selectors": {model_name: selector},
            "feature_cols": list,
            "metrics": dict,
        }
    """
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=days)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    if len(stock_df) < 100:
        return {"error": "数据不足"}
    
    # 构建特征
    feats = build_full_features(symbol, stock_df)
    
    # 目标1: 次日收益率 (回归主目标)
    close = stock_df["收盘"].astype(float)
    future_return = (close.shift(-PREDICT_HORIZON) / close - 1) * 100
    
    # 目标2: 5日异常波动标签 (分类辅助目标)
    anomaly_return = (close.shift(-ANOMALY_HORIZON) / close - 1) * 100
    y_anomaly = ((anomaly_return.abs() > ANOMALY_THRESHOLD)).astype(int)
    
    # 对齐
    feats["target"] = future_return.values
    feats = feats.dropna(subset=["target"])
    
    # 移除 target 和 date 列
    y = feats["target"].values
    X_df = feats.drop(columns=["target", "date"], errors="ignore")
    
    if len(X_df) < 80:
        return {"error": "有效样本不足"}
    
    # 时间序列分割: 前80%训练，后20%测试
    split = int(len(X_df) * 0.8)
    X_train, X_test = X_df.iloc[:split], X_df.iloc[split:]
    y_train, y_test = y[:split], y[split:]
    
    # 特征选择 (最多15个，先用mutual_info捕捉非线性关系)
    k = min(15, X_train.shape[1])
    selector = SelectKBest(score_func=mutual_info_regression, k=k)
    X_train_s = selector.fit_transform(X_train, y_train)
    X_test_s = selector.transform(X_test)
    selected_cols = X_train.columns[selector.get_support()].tolist()
    
    # 标准化
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_s)
    X_test_scaled = scaler.transform(X_test_s)
    
    # 训练多个回归模型
    models = {
        "gbr": GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42),
        "ridge": Ridge(alpha=1.0, random_state=42),
        "rf": RandomForestRegressor(n_estimators=100, max_depth=6, min_samples_leaf=5, random_state=42, n_jobs=-1),
    }
    
    results = {}
    preds = {}
    for name, model in models.items():
        model.fit(X_train_scaled, y_train)
        pred = model.predict(X_test_scaled)
        preds[name] = pred
        
        # 方向准确率
        direction_acc = np.mean((pred > 0) == (y_test > 0))
        
        results[name] = {
            "r2": r2_score(y_test, pred),
            "mae": mean_absolute_error(y_test, pred),
            "rmse": np.sqrt(mean_squared_error(y_test, pred)),
            "direction_acc": direction_acc,
        }
    
    # 集成预测 (简单平均)
    ensemble_pred = np.mean(list(preds.values()), axis=0)
    ensemble_metrics = {
        "r2": r2_score(y_test, ensemble_pred),
        "mae": mean_absolute_error(y_test, ensemble_pred),
        "rmse": np.sqrt(mean_squared_error(y_test, ensemble_pred)),
        "direction_acc": np.mean((ensemble_pred > 0) == (y_test > 0)),
    }
    results["ensemble"] = ensemble_metrics
    
    return {
        "models": models,
        "scalers": {"default": scaler},
        "selectors": {"default": selector},
        "feature_cols": selected_cols,
        "all_feature_cols": X_train.columns.tolist(),  # 保存完整列名用于预测时补齐
        "metrics": results,
        "train_size": len(X_train),
        "test_size": len(X_test),
    }


def predict_next_return(symbol: str, model_bundle: Dict) -> Dict:
    """
    预测最新一天的未来5日收益率
    """
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=120)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    feats = build_full_features(symbol, stock_df)
    X_df = feats.drop(columns=["date"], errors="ignore")
    
    # 取最新一行
    X_latest = X_df.iloc[[-1]]
    
    # 特征选择
    selector = model_bundle["selectors"]["default"]
    all_cols = model_bundle["all_feature_cols"]
    # 确保所有训练时的列都存在
    for c in all_cols:
        if c not in X_latest.columns:
            X_latest[c] = 0
    # 用 numpy array 避免 sklearn feature name 检查
    X_latest_s = selector.transform(X_latest[all_cols].values)
    
    # 标准化
    scaler = model_bundle["scalers"]["default"]
    X_latest_scaled = scaler.transform(X_latest_s)
    
    # 各模型预测
    individual = {}
    for name, model in model_bundle["models"].items():
        pred = model.predict(X_latest_scaled)[0]
        individual[name] = float(pred)
    
    # 集成
    ensemble = float(np.mean(list(individual.values())))
    
    # 异常检测: 预测次日收益率 > 1% 或 < -1% 视为短期异常信号
    is_anomaly = abs(ensemble) > 1.0
    anomaly_direction = "UP" if ensemble > 1 else "DOWN" if ensemble < -1 else "NEUTRAL"
    
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "symbol": symbol,
        "predicted_return_5d": round(ensemble, 4),
        "individual_predictions": individual,
        "is_anomaly": is_anomaly,
        "anomaly_direction": anomaly_direction,
        "confidence": round(abs(ensemble) / 5, 4),  # 简单置信度: |预测|/5
        "feature_count": len(model_bundle["feature_cols"]),
        "selected_features": model_bundle["feature_cols"],
    }


def save_prediction_record(record: Dict):
    """保存预测记录到 rebuild 目录"""
    path = os.path.join(REBUILD_DIR, "prediction_history.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            history = json.load(f)
    else:
        history = []
    history.append(record)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def save_nonprice_features(symbol: str, date_str: str, features: Dict):
    """保存非价格特征到 CSV"""
    path = os.path.join(REBUILD_DIR, f"{symbol}_nonprice.csv")
    record = {"date": date_str, **features}
    
    if os.path.exists(path):
        df = pd.read_csv(path, encoding="utf-8-sig")
    else:
        df = pd.DataFrame()
    
    new_row = pd.DataFrame([record])
    df = pd.concat([df, new_row], ignore_index=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    # 测试
    sym = "601318"
    print(f"训练 {sym} 回归模型...")
    bundle = train_regression_model(sym)
    if "error" in bundle:
        print(f"错误: {bundle['error']}")
    else:
        print(f"训练样本: {bundle['train_size']}, 测试样本: {bundle['test_size']}")
        print(f"选中特征: {bundle['feature_cols']}")
        print("\n测试集指标:")
        for name, m in bundle["metrics"].items():
            print(f"  {name:10s}: R²={m['r2']:+.4f} MAE={m['mae']:.4f} 方向准确率={m['direction_acc']:.1%}")
        
        print("\n预测最新一天...")
        pred = predict_next_return(sym, bundle)
        print(json.dumps(pred, ensure_ascii=False, indent=2))
