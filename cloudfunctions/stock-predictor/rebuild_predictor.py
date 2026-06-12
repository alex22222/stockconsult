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
PREDICT_HORIZON = 5  # 5日收益率（与最优配置一致）
ANOMALY_HORIZON = 5  # 异常检测用5日窗口
ANOMALY_THRESHOLD = 2.0  # |收益率| > 2% 视为异常


def build_compact_features(stock_df: pd.DataFrame, sh_index_df: pd.DataFrame = None) -> pd.DataFrame:
    """
    构建精简的核心价格特征 (~16个，对齐 feature_engineer.py 的 compact set)
    
    所有特征严格使用历史数据，无未来信息：
    - mom_*: 使用 t-N 到 t 的收盘价
    - vol_*: 使用过去 N 日收益率的标准差
    - vol_ratio_*: 当日成交量 / 过去 N 日均量
    - price_vs_ma20/ma5_above_ma20: 使用过去 5/20 日均价
    - price_pctile_20d: 过去 20 日价格分位数
    - atr_14_ratio: 过去 14 日 ATR / 当日收盘
    - index_return_1d: 前 1 日指数收益率
    - index_corr_5d: 过去 5 日个股-指数相关性
    - amplitude/body_ratio: 当日高低开收
    """
    close = stock_df["收盘"].astype(float)
    volume = stock_df["成交量"].astype(float)
    high = stock_df["最高"].astype(float)
    low = stock_df["最低"].astype(float)
    open_ = stock_df["开盘"].astype(float)
    
    f = pd.DataFrame(index=stock_df.index)
    
    # 1. 动量 (3) — 只使用历史收盘价
    f["mom_1d"] = close.pct_change() * 100           # (t-1, t]
    f["mom_5d"] = close.pct_change(5) * 100          # (t-5, t]
    f["mom_20d"] = close.pct_change(20) * 100        # (t-20, t]
    
    # 2. 波动率 (2) — 过去 N 日收益率标准差
    f["vol_5d"] = close.pct_change().rolling(5).std() * 100   # [t-4, t]
    f["vol_20d"] = close.pct_change().rolling(20).std() * 100 # [t-19, t]
    
    # 3. 量能 (2) — 当日 / 过去 N 日均量
    f["vol_ratio_5"] = volume / volume.rolling(5).mean()     # [t-4, t]
    f["vol_ratio_20"] = volume / volume.rolling(20).mean()   # [t-19, t]
    
    # 4. 技术位置 (3)
    ma5 = close.rolling(5).mean()                     # [t-4, t]
    ma20 = close.rolling(20).mean()                   # [t-19, t]
    f["price_vs_ma20"] = (close - ma20) / ma20 * 100
    f["price_pctile_20d"] = close.rolling(20).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
    )                                                 # [t-19, t]
    atr14 = _calc_atr(high, low, close, 14)          # [t-13, t]
    f["atr_14_ratio"] = atr14 / close * 100
    
    # 5. 趋势状态 (1)
    f["ma5_above_ma20"] = (ma5 > ma20).astype(int)   # [t-4, t] vs [t-19, t]
    
    # 6. 大盘相对 (2) — 指数数据同样只使用历史
    if sh_index_df is not None and not sh_index_df.empty and "收盘" in sh_index_df.columns:
        sh_close = sh_index_df["收盘"].astype(float).reindex(stock_df.index, method="ffill")
        f["index_return_1d"] = sh_close.pct_change() * 100     # (t-1, t]
        f["index_corr_5d"] = close.rolling(5).corr(sh_close)   # [t-4, t]
    else:
        f["index_return_1d"] = 0.0
        f["index_corr_5d"] = 0.0
    
    # 7. 形态 (2) — 当日数据
    f["amplitude"] = (high - low) / close.shift(1) * 100      # t 日高低 / t-1 日收盘
    f["body_ratio"] = abs(close - open_) / (high - low + 1e-10) * 100  # t 日开收/高低
    
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


def build_full_features(symbol: str, stock_df: pd.DataFrame, sh_index_df: pd.DataFrame = None,
                          use_nonprice: bool = True,
                          us_overnight_df: pd.DataFrame = None) -> pd.DataFrame:
    """合并价格特征 + 非价格特征（us_overnight_score + investoday 独立信号源）
    
    Args:
        use_nonprice: 是否加载 investoday 非价格特征。训练时若数据不足会自动禁用。
        us_overnight_df: 外部传入的 us_overnight 数据（避免内部重新获取导致数据范围不一致）。
                         若为 None，则从本地加载全部可用数据。
    
    安全保证：
    - 所有价格特征由 build_compact_features 计算，只使用历史数据
    - us_overnight_score 是美股 T-1 收盘数据，A股 T 日开盘前可用
    - 非价格特征按日期左连接，不会引入未来日期的数据
    """
    price_feats = build_compact_features(stock_df, sh_index_df)
    
    # 添加日期列用于 merge
    if "日期" in stock_df.columns:
        price_feats["date"] = pd.to_datetime(stock_df["日期"])
    else:
        price_feats["date"] = pd.to_datetime(stock_df.index)
    
    # 1. 加载 us_overnight_score（唯一被验证有效的跨市场 alpha）
    # 优先使用外部传入的数据（确保 walk-forward 中数据范围一致）
    if us_overnight_df is not None and not us_overnight_df.empty:
        us_df = us_overnight_df.copy()
    else:
        local = LocalDataProvider(DATA_DIR)
        raw = local.get_all_data_for_stock(symbol, days=120)
        us_df = raw.get("us_overnight", pd.DataFrame())
    
    if not us_df.empty and "date" in us_df.columns and "us_overnight_score" in us_df.columns:
        us_df = us_df[["date", "us_overnight_score"]].copy()
        us_df["date"] = pd.to_datetime(us_df["date"])
        # 左连接：只合并 stock_df 中已存在的日期，不会引入未来日期
        price_feats = pd.merge(price_feats, us_df, on="date", how="left")
        price_feats["us_overnight_score"] = price_feats["us_overnight_score"].fillna(0)
    
    # 2. 加载 investoday 非价格特征（独立 alpha 来源）
    # 只有当数据覆盖率达到阈值时才启用，避免大量缺失值污染训练
    nonprice = load_nonprice_features(symbol)
    if use_nonprice and not nonprice.empty and "date" in nonprice.columns:
        nonprice["date"] = pd.to_datetime(nonprice["date"])
        # 计算覆盖率：有非零 score 的日期占比
        if "score" in nonprice.columns:
            coverage = nonprice["score"].notna().sum() / len(price_feats)
        else:
            coverage = len(nonprice) / len(price_feats)
        
        # 覆盖率 >= 10% 才使用 investoday 特征（约 90 天数据）
        if coverage >= 0.10:
            core_cols = ["date", "score", "skillScore", "emotionScore", "financeScore",
                         "industryScore", "scoreAvg", "news_count", "news_sentiment_mean"]
            available = [c for c in core_cols if c in nonprice.columns]
            if len(available) > 1:
                np_core = nonprice[available].copy()
                # 左连接：只合并 stock_df 中已存在的日期
                price_feats = pd.merge(price_feats, np_core, on="date", how="left")
                for col in available:
                    if col != "date":
                        price_feats[col] = price_feats[col].astype(float)
                        price_feats[col] = price_feats[col].ffill().fillna(0)
        else:
            # 数据不足，标记但不在特征中使用
            pass
    
    return price_feats


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
    sh_index_df = raw.get("sh_index", pd.DataFrame())
    
    if len(stock_df) < 100:
        return {"error": "数据不足"}
    
    # 构建特征
    feats = build_full_features(symbol, stock_df, sh_index_df)
    
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
    
    # 训练回归模型（Ridge 为主 + GBR 为辅，去掉表现不稳定的 RF）
    models = {
        "gbr": GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42),
        "ridge": Ridge(alpha=1.0, random_state=42),
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
    
    # 集成预测 (Ridge 0.6 + GBR 0.4，Ridge 在 walk-forward 上更稳健)
    ensemble_pred = preds["ridge"] * 0.6 + preds["gbr"] * 0.4
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
    预测最新一天的未来收益率（horizon 由 PREDICT_HORIZON 决定）
    """
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=120)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    sh_index_df = raw.get("sh_index", pd.DataFrame())
    
    feats = build_full_features(symbol, stock_df, sh_index_df)
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
    
    # 集成 (Ridge 0.6 + GBR 0.4)
    ensemble = float(individual.get("ridge", 0) * 0.6 + individual.get("gbr", 0) * 0.4)
    
    # 异常检测: 预测次日收益率 > 1% 或 < -1% 视为短期异常信号
    is_anomaly = abs(ensemble) > 1.0
    anomaly_direction = "UP" if ensemble > 1 else "DOWN" if ensemble < -1 else "NEUTRAL"
    
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "symbol": symbol,
        f"predicted_return_{PREDICT_HORIZON}d": round(ensemble, 4),
        "individual_predictions": individual,
        "is_anomaly": is_anomaly,
        "anomaly_direction": anomaly_direction,
        "signal_strength": round(abs(ensemble) / 5, 4),  # 信号强度: |预测|/5 (非校准置信度)
        "feature_count": len(model_bundle["feature_cols"]),
        "selected_features": model_bundle["feature_cols"],
    }


def save_prediction_record(record: Dict):
    """保存预测记录到 rebuild 目录（自动去重：同一天+同一只股票保留最新）"""
    path = os.path.join(REBUILD_DIR, "prediction_history.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            history = json.load(f)
    else:
        history = []
    
    # 去重：同一天+同一只股票只保留最新
    sym = record.get("symbol")
    date = record.get("date")
    history = [r for r in history if not (r.get("symbol") == sym and r.get("date") == date)]
    history.append(record)
    
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def save_nonprice_features(symbol: str, date_str: str, features: Dict):
    """保存非价格特征到 CSV（自动去重，同一天保留最新）"""
    path = os.path.join(REBUILD_DIR, f"{symbol}_nonprice.csv")
    record = {"date": date_str, **features}
    
    if os.path.exists(path):
        df = pd.read_csv(path, encoding="utf-8-sig")
        # 删除同一天的旧记录，避免重复
        df = df[df["date"] != date_str]
    else:
        df = pd.DataFrame()
    
    new_row = pd.DataFrame([record])
    df = pd.concat([df, new_row], ignore_index=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    from strategy_config import get_rebuild_stocks

    # 测试
    for sym in get_rebuild_stocks().keys():
        print(f"\n训练 {sym} 回归模型...")
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
