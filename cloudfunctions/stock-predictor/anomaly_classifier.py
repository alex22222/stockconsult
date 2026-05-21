# -*- coding: utf-8 -*-
"""
异常波动分类器
=============
目标: 预测未来5日是否出现异常波动 (|收益率| > 2%)
类别: 1=大涨(>2%), -1=大跌(<-2%), 0=中性
特征: 价格 + 非价格 (mutual_info选择)
模型: GradientBoostingClassifier + RandomForest
"""
import warnings
warnings.filterwarnings('ignore')
import os
import json
import numpy as np
import pandas as pd
from typing import Dict

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, mutual_info_classif
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix

from rebuild_predictor import build_full_features, DATA_DIR
from local_data_provider import LocalDataProvider

# 异常阈值
UP_THRESHOLD = 2.0    # > 2% 视为大涨
DOWN_THRESHOLD = -2.0 # < -2% 视为大跌
ANOMALY_HORIZON = 5   # 5日窗口


def build_anomaly_labels(close: pd.Series) -> pd.Series:
    """
    构建异常波动标签:
    2 = 大涨 (> UP_THRESHOLD)
    1 = 微涨 (0 ~ UP_THRESHOLD)
    0 = 中性 (DOWN_THRESHOLD ~ 0)
    -1 = 大跌 (< DOWN_THRESHOLD)
    """
    future_ret = (close.shift(-ANOMALY_HORIZON) / close - 1) * 100
    labels = pd.Series(index=close.index, dtype=int)
    labels[future_ret > UP_THRESHOLD] = 2
    labels[(future_ret > 0) & (future_ret <= UP_THRESHOLD)] = 1
    labels[(future_ret >= DOWN_THRESHOLD) & (future_ret <= 0)] = 0
    labels[future_ret < DOWN_THRESHOLD] = -1
    return labels


def train_anomaly_classifier(symbol: str, days: int = 500) -> Dict:
    """训练异常波动分类器"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=days)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    if len(stock_df) < 100:
        return {"error": "数据不足"}
    
    feats = build_full_features(symbol, stock_df)
    close = stock_df["收盘"].astype(float)
    labels = build_anomaly_labels(close)
    
    # 只保留有标签的样本
    feats["target"] = labels.values
    feats = feats.dropna(subset=["target"])
    
    y = feats["target"].values
    X_df = feats.drop(columns=["target", "date"], errors="ignore")
    
    if len(X_df) < 80:
        return {"error": "有效样本不足"}
    
    # 标签分布
    label_dist = pd.Series(y).value_counts().sort_index().to_dict()
    
    # 时间序列分割
    split = int(len(X_df) * 0.8)
    X_train, X_test = X_df.iloc[:split], X_df.iloc[split:]
    y_train, y_test = y[:split], y[split:]
    
    # 特征选择
    k = min(15, X_train.shape[1])
    selector = SelectKBest(score_func=mutual_info_classif, k=k)
    X_train_s = selector.fit_transform(X_train, y_train)
    X_test_s = selector.transform(X_test)
    selected_cols = X_train.columns[selector.get_support()].tolist()
    
    # 标准化
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_s)
    X_test_scaled = scaler.transform(X_test_s)
    
    # 训练分类器
    models = {
        "gbc": GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42),
        "rf": RandomForestClassifier(n_estimators=100, max_depth=6, min_samples_leaf=5, random_state=42, n_jobs=-1, class_weight='balanced'),
        "lr": LogisticRegression(max_iter=2000, random_state=42, class_weight='balanced'),
    }
    
    results = {}
    preds = {}
    for name, model in models.items():
        model.fit(X_train_scaled, y_train)
        pred = model.predict(X_test_scaled)
        preds[name] = pred
        
        # 异常检测准确率 (只关心大涨/大跌的识别)
        anomaly_mask = (y_test == 2) | (y_test == -1)
        anomaly_acc = np.mean(pred[anomaly_mask] == y_test[anomaly_mask]) if anomaly_mask.sum() > 0 else 0
        
        results[name] = {
            "accuracy": accuracy_score(y_test, pred),
            "f1_macro": f1_score(y_test, pred, average='macro', zero_division=0),
            "anomaly_accuracy": anomaly_acc,
            "confusion": confusion_matrix(y_test, pred).tolist(),
        }
    
    # 集成投票
    ensemble_pred = np.apply_along_axis(lambda x: np.bincount((x + 1).astype(int)).argmax() - 1, axis=0, arr=np.array(list(preds.values())))
    ensemble_metrics = {
        "accuracy": accuracy_score(y_test, ensemble_pred),
        "f1_macro": f1_score(y_test, ensemble_pred, average='macro', zero_division=0),
        "anomaly_accuracy": np.mean(ensemble_pred[anomaly_mask] == y_test[anomaly_mask]) if anomaly_mask.sum() > 0 else 0,
        "confusion": confusion_matrix(y_test, ensemble_pred).tolist(),
    }
    results["ensemble"] = ensemble_metrics
    
    return {
        "models": models,
        "scalers": {"default": scaler},
        "selectors": {"default": selector},
        "feature_cols": selected_cols,
        "all_feature_cols": X_train.columns.tolist(),
        "metrics": results,
        "label_distribution": label_dist,
        "train_size": len(X_train),
        "test_size": len(X_test),
    }


def predict_anomaly(symbol: str, bundle: Dict) -> Dict:
    """预测最新一天的异常波动概率"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=120)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    
    feats = build_full_features(symbol, stock_df)
    X_df = feats.drop(columns=["date"], errors="ignore")
    X_latest = X_df.iloc[[-1]]
    
    selector = bundle["selectors"]["default"]
    all_cols = bundle["all_feature_cols"]
    for c in all_cols:
        if c not in X_latest.columns:
            X_latest[c] = 0
    
    X_latest_s = selector.transform(X_latest[all_cols].values)
    scaler = bundle["scalers"]["default"]
    X_latest_scaled = scaler.transform(X_latest_s)
    
    # 各模型预测
    votes = {}
    probs = {}
    for name, model in bundle["models"].items():
        pred = model.predict(X_latest_scaled)[0]
        proba = model.predict_proba(X_latest_scaled)[0]
        votes[name] = int(pred)
        # 映射类别到概率
        classes = model.classes_.tolist()
        probs[name] = {int(c): float(p) for c, p in zip(classes, proba)}
    
    # 集成投票
    ensemble_vote = np.bincount(np.array(list(votes.values())) + 1).argmax() - 1
    
    # 计算大涨/大跌的概率
    up_prob = np.mean([p.get(2, 0) for p in probs.values()])
    down_prob = np.mean([p.get(-1, 0) for p in probs.values()])
    neutral_prob = np.mean([p.get(0, 0) + p.get(1, 0) for p in probs.values()])
    
    label_map = {2: "UP", 1: "UP_SMALL", 0: "NEUTRAL", -1: "DOWN"}
    
    return {
        "anomaly_prediction": label_map.get(int(ensemble_vote), "UNKNOWN"),
        "anomaly_class": int(ensemble_vote),
        "up_probability": round(up_prob, 4),
        "down_probability": round(down_prob, 4),
        "neutral_probability": round(neutral_prob, 4),
        "individual_votes": votes,
        "is_anomaly": ensemble_vote in [2, -1],
        "anomaly_direction": "UP" if ensemble_vote == 2 else "DOWN" if ensemble_vote == -1 else "NEUTRAL",
    }


if __name__ == "__main__":
    sym = "601318"
    print(f"训练 {sym} 异常波动分类器...")
    bundle = train_anomaly_classifier(sym)
    if "error" in bundle:
        print(f"错误: {bundle['error']}")
    else:
        print(f"标签分布: {bundle['label_distribution']}")
        print(f"训练: {bundle['train_size']}, 测试: {bundle['test_size']}")
        print("\n测试集指标:")
        for name, m in bundle["metrics"].items():
            print(f"  {name:10s}: 准确率={m['accuracy']:.1%} F1-macro={m['f1_macro']:.3f} 异常识别率={m['anomaly_accuracy']:.1%}")
        
        print("\n预测最新一天...")
        pred = predict_anomaly(sym, bundle)
        print(json.dumps(pred, ensure_ascii=False, indent=2))
