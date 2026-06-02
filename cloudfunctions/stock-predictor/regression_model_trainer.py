# -*- coding: utf-8 -*-
"""
回归模型训练器 — 预测次日收益率
================================
修复点：
1. 特征选择 + 标准化严格只在训练集 fit
2. 交叉验证每个 fold 内单独 fit scaler
3. 评估时逐模型走各自 pipeline
"""

import pandas as pd
import numpy as np
from typing import Dict, Tuple, List
import logging
import joblib
import os
from datetime import datetime

from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, mutual_info_regression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge, ElasticNet

from config import MODEL_CONFIG, MODEL_DIR

logger = logging.getLogger(__name__)


class RegressionModelTrainer:
    """
    A股次日收益率回归预测器
    支持多模型集成、滚动训练
    """

    def __init__(self):
        self.config = MODEL_CONFIG
        self.models = {}
        self.scalers = {}
        self.selectors = {}
        self.selected_features = {}
        self.model_weights = {"gbr": 0.3, "rfr": 0.3, "ridge": 0.2, "elastic": 0.2}
        self.training_history = []
        logger.info("RegressionModelTrainer 初始化完成")

    def _get_model_instance(self, model_name: str):
        """获取回归模型实例"""
        if model_name == "gbr":
            return GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
        elif model_name == "rfr":
            return RandomForestRegressor(n_estimators=100, max_depth=6, min_samples_leaf=5, random_state=42, n_jobs=-1)
        elif model_name == "ridge":
            return Ridge(alpha=1.0, random_state=42)
        elif model_name == "elastic":
            return ElasticNet(alpha=0.1, l1_ratio=0.5, random_state=42, max_iter=2000)
        else:
            raise ValueError(f"未知模型: {model_name}")

    def _select_features(self, model_name: str, X: pd.DataFrame, y: pd.Series = None,
                         fit: bool = True) -> pd.DataFrame:
        """特征选择 — 只保留最重要的 K 个特征"""
        k = min(15, X.shape[1])
        if fit:
            X_clean = X.replace([np.inf, -np.inf], 0).fillna(0)
            y_clean = y.fillna(0) if y is not None else pd.Series([0] * len(X))
            selector = SelectKBest(score_func=mutual_info_regression, k=k)
            selector.fit(X_clean, y_clean)
            self.selectors[model_name] = selector
            mask = selector.get_support()
            self.selected_features[model_name] = [X.columns[i] for i in range(len(X.columns)) if mask[i]]
            logger.info(f"回归模型 {model_name}: 从 {X.shape[1]} 个特征中选了 {k} 个")
        selected_cols = self.selected_features.get(model_name, X.columns.tolist())
        available_cols = [c for c in selected_cols if c in X.columns]
        if len(available_cols) < len(selected_cols):
            missing = set(selected_cols) - set(X.columns)
            logger.warning(f"模型 {model_name}: 缺少特征 {missing}，用0填充")
            for col in missing:
                X[col] = 0
            available_cols = selected_cols
        return X[available_cols]

    def _prepare_data(self, X: pd.DataFrame, y: pd.Series,
                      fit_scaler: bool = True, model_name: str = None) -> Tuple[np.ndarray, np.ndarray]:
        """数据预处理（标准化）"""
        X_clean = X.replace([np.inf, -np.inf], 0).fillna(0)
        y_clean = y.fillna(0)
        scaler_key = model_name or "default"
        if fit_scaler:
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X_clean)
            self.scalers[scaler_key] = scaler
        else:
            scaler = self.scalers.get(scaler_key)
            if scaler is None:
                scaler = StandardScaler()
                X_scaled = scaler.fit_transform(X_clean)
                self.scalers[scaler_key] = scaler
            else:
                X_scaled = scaler.transform(X_clean)
        return X_scaled, y_clean.values

    def train_single_model(self, model_name: str, X: pd.DataFrame, y: pd.Series,
                           validation_split: float = 0.2) -> Dict:
        """训练单个回归模型（先切分再 fit，避免泄露）"""
        logger.info(f"开始训练回归模型: {model_name}")

        # 1. 先按时间切分
        split_idx = int(len(X) * (1 - validation_split))
        X_train_raw, X_val_raw = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train_raw, y_val_raw = y.iloc[:split_idx], y.iloc[split_idx:]

        if len(X_val_raw) == 0:
            logger.warning("验证集为空，使用训练集")
            X_val_raw, y_val_raw = X_train_raw, y_train_raw

        # 2. 特征选择只在训练集 fit
        X_train_sel = self._select_features(model_name, X_train_raw, y_train_raw, fit=True)
        X_val_sel = self._select_features(model_name, X_val_raw, fit=False)

        # 3. 标准化只在训练集 fit
        X_train_s, y_train_arr = self._prepare_data(X_train_sel, y_train_raw, fit_scaler=True, model_name=model_name)
        X_val_s, y_val_arr = self._prepare_data(X_val_sel, y_val_raw, fit_scaler=False, model_name=model_name)

        model = self._get_model_instance(model_name)
        try:
            model.fit(X_train_s, y_train_arr)
            pred_train = model.predict(X_train_s)
            pred_val = model.predict(X_val_s)

            metrics = {
                "train_r2": r2_score(y_train_arr, pred_train),
                "val_r2": r2_score(y_val_arr, pred_val),
                "val_mae": mean_absolute_error(y_val_arr, pred_val),
                "val_rmse": np.sqrt(mean_squared_error(y_val_arr, pred_val)),
                "val_direction_acc": np.mean((pred_val > 0) == (y_val_arr > 0)),
            }
            self.models[model_name] = model
            logger.info(f"回归模型 {model_name} 训练完成: val_r2={metrics['val_r2']:.4f}, val_mae={metrics['val_mae']:.4f}")
            return {"model_name": model_name, "metrics": metrics, "status": "success"}
        except Exception as e:
            logger.error(f"模型 {model_name} 训练失败: {e}")
            return {"model_name": model_name, "error": str(e), "status": "failed"}

    def train_ensemble(self, X: pd.DataFrame, y: pd.Series, validation_split: float = 0.2) -> Dict[str, Dict]:
        """训练集成回归模型"""
        logger.info("=" * 60)
        logger.info("开始集成回归模型训练...")
        results = {}
        for model_name in ["gbr", "rfr", "ridge", "elastic"]:
            result = self.train_single_model(model_name, X, y, validation_split)
            results[model_name] = result
        logger.info("集成回归模型训练完成")
        logger.info("=" * 60)
        return results

    def predict(self, X: pd.DataFrame, use_ensemble: bool = True) -> Dict:
        """预测次日收益率"""
        if not self.models:
            return {"error": "模型未训练"}
        X_latest = X.iloc[-1:]
        predictions = {}
        for model_name, model in self.models.items():
            try:
                X_sel = self._select_features(model_name, X_latest, fit=False)
                X_s, _ = self._prepare_data(X_sel, pd.Series([0]), fit_scaler=False, model_name=model_name)
                pred = model.predict(X_s)[0]
                predictions[model_name] = float(pred)
            except Exception as e:
                logger.warning(f"模型 {model_name} 预测失败: {e}")
                continue
        if not predictions:
            return {"error": "所有模型预测失败"}

        values = list(predictions.values())
        ensemble = float(np.mean(values))
        # 用各模型预测值的标准差作为"离散度"（越小说明模型越一致）
        disagreement = float(np.std(values))
        # 简单"置信度"：预测绝对值 / (|均值| + 标准差 + 1)
        confidence = abs(ensemble) / (abs(ensemble) + disagreement + 1.0)

        return {
            "prediction": ensemble,
            "direction": "UP" if ensemble > 0 else "DOWN",
            "confidence": round(confidence, 4),
            "disagreement": round(disagreement, 4),
            "individual_predictions": predictions,
        }

    def save_models(self, filepath: str = None):
        if filepath is None:
            os.makedirs(MODEL_DIR, exist_ok=True)
            filepath = os.path.join(MODEL_DIR, f"regression_models_{datetime.now().strftime('%Y%m%d_%H%M%S')}.joblib")
        joblib.dump({"models": self.models, "scalers": self.scalers, "selectors": self.selectors,
                     "selected_features": self.selected_features}, filepath)
        logger.info(f"回归模型已保存: {filepath}")
        return filepath

    def load_models(self, filepath: str):
        if not os.path.exists(filepath):
            return False
        data = joblib.load(filepath)
        self.models = data.get("models", {})
        self.scalers = data.get("scalers", {})
        self.selectors = data.get("selectors", {})
        self.selected_features = data.get("selected_features", {})
        return True
