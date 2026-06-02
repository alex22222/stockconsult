# -*- coding: utf-8 -*-
"""
Rebuild Predictor Walk-Forward 回测
===================================
使用 rebuild_predictor 的精简特征集，在历史数据上做 walk-forward 验证。
输出标准化回测报告 JSON 供前端展示。
"""
import os
import json
import warnings
import numpy as np
import pandas as pd
from typing import Dict, List
from datetime import datetime

from rebuild_predictor import build_full_features, PREDICT_HORIZON
from local_data_provider import LocalDataProvider
from sklearn.linear_model import Ridge
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, mutual_info_regression

warnings.filterwarnings('ignore')

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
REBUILD_DIR = os.path.join(DATA_DIR, "rebuild")

# 回测参数
LOOKBACK_DAYS = 252  # 训练窗口
RETRAIN_DAYS = 20    # 每20天重新训练
MIN_TRAIN_SIZE = 80


STOCKS = {
    "600519": "贵州茅台",
    "601398": "工商银行",
    "601857": "中国石油",
    "601288": "农业银行",
    "601988": "中国银行",
    "601628": "中国人寿",
    "600036": "招商银行",
    "601088": "中国神华",
    "600900": "长江电力",
    "601318": "中国平安",
}


def walkforward_backtest(symbol: str, days: int = 500) -> Dict:
    """Walk-forward 回测：滚动训练，预测未来5日收益"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=days + LOOKBACK_DAYS + 50)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    sh_index_df = raw.get("sh_index", pd.DataFrame())
    
    if len(stock_df) < LOOKBACK_DAYS + MIN_TRAIN_SIZE:
        return {"error": "数据不足"}
    
    close = stock_df["收盘"].astype(float)
    future_return = (close.shift(-PREDICT_HORIZON) / close - 1) * 100
    
    # 构建全部特征（一次性）
    feats = build_full_features(symbol, stock_df, sh_index_df, use_nonprice=False)
    feats["target"] = future_return.values
    feats = feats.dropna(subset=["target"])
    
    if "date" not in feats.columns:
        return {"error": "缺少日期列"}
    
    dates = feats["date"].values
    y_all = feats["target"].values
    X_all = feats.drop(columns=["target", "date"], errors="ignore")
    
    # Walk-forward
    predictions = []
    start_idx = LOOKBACK_DAYS
    end_idx = len(X_all) - PREDICT_HORIZON  # 确保能验证
    
    last_model = None
    last_scaler = None
    last_selector = None
    last_cols = None
    
    for i in range(start_idx, end_idx):
        # 每 RETRAIN_DAYS 天重新训练
        if (i - start_idx) % RETRAIN_DAYS == 0 or last_model is None:
            train_X = X_all.iloc[:i]
            train_y = y_all[:i]
            
            if len(train_X) < MIN_TRAIN_SIZE:
                continue
            
            k = min(15, train_X.shape[1])
            selector = SelectKBest(score_func=mutual_info_regression, k=k)
            X_train_s = selector.fit_transform(train_X, train_y)
            selected_cols = train_X.columns[selector.get_support()].tolist()
            
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train_s)
            
            models = {
                "ridge": Ridge(alpha=1.0, random_state=42),
                "gbr": GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42),
            }
            for m in models.values():
                m.fit(X_train_scaled, train_y)
            
            last_model = models
            last_scaler = scaler
            last_selector = selector
            last_all_cols = list(train_X.columns)  # 所有训练时的列名
        
        # 预测
        X_latest = X_all.iloc[[i]]
        for c in last_all_cols:
            if c not in X_latest.columns:
                X_latest[c] = 0
        X_latest_s = last_selector.transform(X_latest[last_all_cols].values)
        X_latest_scaled = last_scaler.transform(X_latest_s)
        
        pred_ridge = last_model["ridge"].predict(X_latest_scaled)[0]
        pred_gbr = last_model["gbr"].predict(X_latest_scaled)[0]
        pred_ensemble = pred_ridge * 0.6 + pred_gbr * 0.4
        
        actual = y_all[i]
        
        predictions.append({
            "date": str(dates[i])[:10] if hasattr(dates[i], "__len__") else str(dates[i]),
            "predicted": round(float(pred_ensemble), 4),
            "actual": round(float(actual), 4),
            "direction_correct": (pred_ensemble > 0) == (actual > 0),
        })
    
    if not predictions:
        return {"error": "无有效预测"}
    
    # 统计
    pred_vals = np.array([p["predicted"] for p in predictions])
    actual_vals = np.array([p["actual"] for p in predictions])
    
    direction_correct = sum(p["direction_correct"] for p in predictions)
    n = len(predictions)
    
    mae = np.mean(np.abs(pred_vals - actual_vals))
    rmse = np.sqrt(np.mean((pred_vals - actual_vals) ** 2))
    corr = np.corrcoef(pred_vals, actual_vals)[0, 1] if n > 1 else 0
    
    # 简单策略：预测涨则买入持有5天（不重叠周期，每5天决策一次）
    # 由于 predictions 是每天的，取每第5条作为独立决策点
    strategy_period_returns = []
    reverse_period_returns = []
    for i in range(0, len(predictions), PREDICT_HORIZON):
        p = predictions[i]
        if p["predicted"] > 0:
            strategy_period_returns.append(p["actual"] / 100)
        else:
            strategy_period_returns.append(0)
        if p["predicted"] < 0:
            reverse_period_returns.append(p["actual"] / 100)
        else:
            reverse_period_returns.append(0)
    
    total_strategy = sum(strategy_period_returns) * 100
    total_reverse = sum(reverse_period_returns) * 100
    
    # 买入持有收益用首尾价格计算（避免重叠周期复利错误）
    start_price = float(stock_df.iloc[start_idx]["收盘"])
    end_price = float(stock_df.iloc[min(end_idx + PREDICT_HORIZON - 1, len(stock_df) - 1)]["收盘"])
    total_buyhold = (end_price / start_price - 1) * 100
    
    return {
        "symbol": symbol,
        "name": STOCKS.get(symbol, symbol),
        "n_predictions": n,
        "direction_accuracy": round(direction_correct / n, 4),
        "direction_correct": int(direction_correct),
        "mae": round(float(mae), 4),
        "rmse": round(float(rmse), 4),
        "correlation": round(float(corr), 4),
        "strategy_return_pct": round(float(total_strategy), 2),
        "buyhold_return_pct": round(float(total_buyhold), 2),
        "reverse_return_pct": round(float(total_reverse), 2),
        "excess_return_pct": round(float(total_strategy - total_buyhold), 2),
        "reverse_better": bool(total_reverse > total_strategy),
        "predictions": predictions,
    }


def main():
    print("=" * 80)
    print("Rebuild Predictor Walk-Forward 回测")
    print("=" * 80)
    
    all_results = {}
    for sym in STOCKS.keys():
        print(f"\n📊 {STOCKS[sym]} ({sym}) ...")
        result = walkforward_backtest(sym)
        if "error" in result:
            print(f"   ❌ {result['error']}")
        else:
            print(f"   预测数: {result['n_predictions']} | "
                  f"方向准确率: {result['direction_accuracy']:.1%} | "
                  f"MAE: {result['mae']:.2f}% | "
                  f"相关系数: {result['correlation']:+.3f}")
            print(f"   策略收益: {result['strategy_return_pct']:+.2f}% | "
                  f"买入持有: {result['buyhold_return_pct']:+.2f}% | "
                  f"反向策略: {result['reverse_return_pct']:+.2f}%")
            if result['reverse_better']:
                print(f"   ⚠️ 反向策略更好！当前模型可能没有有效alpha")
        all_results[sym] = result
    
    def _convert(obj):
        if isinstance(obj, dict):
            return {k: _convert(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_convert(v) for v in obj]
        elif isinstance(obj, (np.bool_,)):
            return bool(obj)
        elif isinstance(obj, (np.integer,)):
            return int(obj)
        elif isinstance(obj, (np.floating,)):
            return float(obj)
        return obj
    
    # 保存
    output = {
        "generated_at": datetime.now().isoformat(),
        "method": "walkforward_rebuild_predictor",
        "params": {
            "lookback_days": LOOKBACK_DAYS,
            "retrain_days": RETRAIN_DAYS,
            "predict_horizon": PREDICT_HORIZON,
            "models": "Ridge(0.6)+GBR(0.4)",
            "features": "compact_price + us_overnight_score",
        },
        "stocks": _convert(all_results),
    }
    
    output_path = os.path.join(REBUILD_DIR, "walkforward_report.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Walk-forward 报告已保存: {output_path}")
    return output


if __name__ == "__main__":
    main()
