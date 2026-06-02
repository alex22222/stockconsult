# -*- coding: utf-8 -*-
"""
模型训练模块 - 集成学习 + 滚动训练
支持 XGBoost, LightGBM, CatBoost, RandomForest
具备在线学习、模型权重动态调整能力
"""

import pandas as pd
import numpy as np
from typing import Dict, Tuple, List, Optional
import logging
import joblib
import os
from datetime import datetime

from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, classification_report

# 导入各模型 (纯 sklearn，跨平台兼容)
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, ExtraTreesClassifier, AdaBoostClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier

from config import MODEL_CONFIG, MODEL_DIR, EVOLUTION_CONFIG

logger = logging.getLogger(__name__)


class ModelTrainer:
    """
    A股涨跌预测模型训练器
    支持多模型集成、滚动训练、在线学习
    """
    
    def __init__(self):
        self.config = MODEL_CONFIG
        self.models = {}           # 存储训练好的模型
        self.scalers = {}          # 存储标准化器
        self.selectors = {}        # 存储特征选择器
        self.selected_features = {}  # 存储每模型选中的特征名
        self.model_weights = self.config["model_weights"].copy()  # 模型权重
        self.training_history = []  # 训练历史
        self.feature_importance = {}  # 特征重要性
        self.cv_scores = {}        # 交叉验证得分
        logger.info("ModelTrainer初始化完成")
    
    def _get_model_instance(self, model_name: str):
        """获取模型实例"""
        model_config = self.config["models"][model_name]
        params = model_config["params"].copy()
        
        if model_name == "gradient_boosting":
            return GradientBoostingClassifier(**params)
        elif model_name == "random_forest":
            return RandomForestClassifier(**params)
        elif model_name == "extra_trees":
            return ExtraTreesClassifier(**params)
        elif model_name == "logistic_regression":
            return LogisticRegression(**params)
        elif model_name == "ada_boost":
            return AdaBoostClassifier(**params)
        elif model_name == "svm_rbf":
            return SVC(**params)
        elif model_name == "mlp":
            return MLPClassifier(**params)
        else:
            raise ValueError(f"未知模型: {model_name}")
    
    def _select_features(self, model_name: str, X: pd.DataFrame, y: pd.Series = None,
                         fit: bool = True) -> pd.DataFrame:
        """
        特征选择 - 只保留最重要的 K 个特征
        
        Args:
            model_name: 模型名称
            X: 特征矩阵
            y: 目标变量 (fit=True时需要)
            fit: 是否拟合选择器
            
        Returns:
            选择后的特征矩阵
        """
        k = min(EVOLUTION_CONFIG["feature_select_topk"], X.shape[1])
        
        if fit:
            X_clean = X.replace([np.inf, -np.inf], 0).fillna(0)
            y_clean = y.fillna(0) if y is not None else pd.Series([0] * len(X))
            selector = SelectKBest(score_func=f_classif, k=k)
            selector.fit(X_clean, y_clean)
            self.selectors[model_name] = selector
            mask = selector.get_support()
            self.selected_features[model_name] = [X.columns[i] for i in range(len(X.columns)) if mask[i]]
            logger.info(f"模型 {model_name}: 从 {X.shape[1]} 个特征中选择了 {k} 个")
        
        selected_cols = self.selected_features.get(model_name, X.columns.tolist())
        # 确保所有选中的列都存在于 X 中
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
        """
        数据预处理
        
        Args:
            X: 特征矩阵
            y: 目标变量
            fit_scaler: 是否拟合标准化器
            model_name: 模型名称（用于特征选择）
            
        Returns:
            X_scaled, y_array
        """
        # 移除无穷值和NaN
        X_clean = X.replace([np.inf, -np.inf], 0).fillna(0)
        y_clean = y.fillna(0)
        
        # 标准化
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
        """
        训练单个模型（含特征选择）
        
        修复: 特征选择和标准化严格只在训练集 fit，避免数据泄露。
        
        Args:
            model_name: 模型名称
            X: 特征矩阵
            y: 目标变量
            validation_split: 验证集比例
            
        Returns:
            训练结果字典
        """
        logger.info(f"开始训练模型: {model_name}")
        
        # 1. 先按时间切分训练/验证集（防止信息前置）
        split_idx = int(len(X) * (1 - validation_split))
        X_train_raw, X_val_raw = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train_raw, y_val_raw = y.iloc[:split_idx], y.iloc[split_idx:]
        
        if len(X_val_raw) == 0:
            logger.warning("验证集为空，使用训练集作为验证集")
            X_val_raw, y_val_raw = X_train_raw, y_train_raw
        
        # 2. 特征选择：只在训练集 fit
        X_train_selected = self._select_features(model_name, X_train_raw, y_train_raw, fit=True)
        X_val_selected = self._select_features(model_name, X_val_raw, fit=False)
        
        # 3. 标准化：只在训练集 fit
        X_train_scaled, y_train_array = self._prepare_data(X_train_selected, y_train_raw, fit_scaler=True, model_name=model_name)
        X_val_scaled, y_val_array = self._prepare_data(X_val_selected, y_val_raw, fit_scaler=False, model_name=model_name)
        
        # 创建并训练模型
        model = self._get_model_instance(model_name)
        
        try:
            model.fit(X_train_scaled, y_train_array)
            
            # 验证集预测
            y_pred = model.predict(X_val_scaled)
            y_prob = model.predict_proba(X_val_scaled)[:, 1]
            
            # 计算评估指标
            metrics = {
                "accuracy": accuracy_score(y_val_array, y_pred),
                "precision": precision_score(y_val_array, y_pred, zero_division=0),
                "recall": recall_score(y_val_array, y_pred, zero_division=0),
                "f1": f1_score(y_val_array, y_pred, zero_division=0),
                "auc": roc_auc_score(y_val_array, y_prob) if len(np.unique(y_val_array)) > 1 else 0.5,
            }
            
            # 保存模型
            self.models[model_name] = model
            
            # 获取特征重要性（基于选中特征）
            if hasattr(model, "feature_importances_"):
                selected_cols = self.selected_features.get(model_name, X.columns.tolist())
                # 扩展回原始特征维度（未选中的为0）
                full_importance = np.zeros(len(X.columns))
                col_map = {c: i for i, c in enumerate(X.columns)}
                for feat_name, imp in zip(selected_cols, model.feature_importances_):
                    if feat_name in col_map:
                        full_importance[col_map[feat_name]] = imp
                self.feature_importance[model_name] = full_importance
            
            logger.info(f"模型 {model_name} 训练完成: accuracy={metrics['accuracy']:.4f}, auc={metrics['auc']:.4f}")
            
            return {
                "model_name": model_name,
                "metrics": metrics,
                "val_size": len(y_val_array),
                "train_size": len(y_train_array),
                "status": "success"
            }
            
        except Exception as e:
            logger.error(f"模型 {model_name} 训练失败: {str(e)}")
            return {
                "model_name": model_name,
                "error": str(e),
                "status": "failed"
            }
    
    def train_ensemble(self, X: pd.DataFrame, y: pd.Series,
                      validation_split: float = 0.2) -> Dict[str, Dict]:
        """
        训练集成模型 (所有启用的模型)
        
        Args:
            X: 特征矩阵
            y: 目标变量
            validation_split: 验证集比例
            
        Returns:
            各模型训练结果
        """
        logger.info("=" * 60)
        logger.info("开始集成模型训练...")
        logger.info(f"数据量: X={X.shape}, y={y.shape}")
        
        results = {}
        
        for model_name, model_config in self.config["models"].items():
            if not model_config.get("enabled", False):
                logger.info(f"模型 {model_name} 已禁用，跳过")
                continue
            
            result = self.train_single_model(model_name, X, y, validation_split)
            results[model_name] = result
            
            # 记录验证集表现，但不基于单次验证直接改写权重
            # 原因: 单次验证 AUC 受噪声影响大，动态权重容易追逐最近一次噪声
            if result["status"] == "success":
                logger.info(f"模型 {model_name} 验证AUC: {result['metrics']['auc']:.4f} (仅记录，不更新权重)")
        
        # 保持配置中的原始权重（等权重或预设权重比单次验证更稳健）
        total_weight = sum(self.model_weights.values())
        if total_weight > 0:
            self.model_weights = {k: v / total_weight for k, v in self.model_weights.items()}
        
        logger.info(f"当前模型权重 (未因单次验证调整): {self.model_weights}")
        
        # 记录训练历史
        self.training_history.append({
            "timestamp": datetime.now().isoformat(),
            "results": results,
            "model_weights": self.model_weights.copy()
        })
        
        logger.info("集成模型训练完成")
        logger.info("=" * 60)
        
        return results
    
    def rolling_train(self, X: pd.DataFrame, y: pd.Series,
                     window_size: int = None, step_size: int = 20) -> List[Dict]:
        """
        滚动训练 (Walk-forward Analysis)
        
        模拟实盘场景：用过去N天数据训练，预测未来M天
        
        Args:
            X: 特征矩阵 (时间序列)
            y: 目标变量
            window_size: 训练窗口大小
            step_size: 滚动步长
            
        Returns:
            每次滚动的评估结果
        """
        window_size = window_size or self.config["train_window"]
        
        logger.info(f"开始滚动训练: window={window_size}, step={step_size}")
        
        rolling_results = []
        n_samples = len(X)
        
        if n_samples < window_size + step_size:
            logger.warning("数据量不足，无法进行滚动训练，使用全部数据训练")
            self.train_ensemble(X, y)
            return []
        
        # 时间序列交叉验证
        n_splits = (n_samples - window_size) // step_size
        
        for i in range(n_splits):
            start_idx = i * step_size
            mid_idx = start_idx + window_size
            end_idx = min(mid_idx + step_size, n_samples)
            
            if mid_idx >= n_samples:
                break
            
            X_train = X.iloc[start_idx:mid_idx]
            y_train = y.iloc[start_idx:mid_idx]
            X_test = X.iloc[mid_idx:end_idx]
            y_test = y.iloc[mid_idx:end_idx]
            
            if len(X_test) == 0:
                continue
            
            logger.info(f"滚动窗口 {i+1}/{n_splits}: train=[{start_idx}:{mid_idx}], test=[{mid_idx}:{end_idx}]")
            
            # 训练所有模型
            self.train_ensemble(X_train, y_train, validation_split=0.2)
            
            # 在测试集上评估
            test_result = self.evaluate(X_test, y_test)
            test_result["window"] = i + 1
            test_result["date_range"] = f"{X.index[start_idx]} ~ {X.index[end_idx-1]}"
            
            rolling_results.append(test_result)
        
        # 最终用全部数据重新训练
        logger.info("使用全部数据重新训练最终模型...")
        self.train_ensemble(X, y)
        
        return rolling_results
    
    def predict(self, X: pd.DataFrame, use_ensemble: bool = True) -> Dict:
        """
        预测明日涨跌
        
        Args:
            X: 特征矩阵 (最后一行即为最新数据)
            use_ensemble: 是否使用集成预测
            
        Returns:
            预测结果字典
        """
        if not self.models:
            logger.error("模型未训练，无法预测")
            return {"error": "模型未训练"}
        
        # 取最后一行作为最新数据
        X_latest = X.iloc[-1:]
        
        predictions = {}
        probabilities = {}
        
        # 各模型预测（使用各自选中的特征）
        for model_name, model in self.models.items():
            try:
                X_selected = self._select_features(model_name, X_latest, fit=False)
                X_scaled, _ = self._prepare_data(X_selected, pd.Series([0]), fit_scaler=False, model_name=model_name)
        
                pred = model.predict(X_scaled)[0]
                prob = model.predict_proba(X_scaled)[0]
                
                predictions[model_name] = int(pred)
                probabilities[model_name] = {
                    "up_prob": float(prob[1]),    # 上涨概率
                    "down_prob": float(prob[0]),  # 下跌概率
                }
            except Exception as e:
                logger.warning(f"模型 {model_name} 预测失败: {e}")
                continue
        
        if not predictions:
            return {"error": "所有模型预测失败"}
        
        # 集成预测
        if use_ensemble and len(predictions) > 1:
            # 加权投票
            weighted_prob_up = sum(
                probabilities[m]["up_prob"] * self.model_weights.get(m, 0.25)
                for m in predictions.keys()
            )
            weighted_prob_down = 1 - weighted_prob_up
            
            ensemble_pred = 1 if weighted_prob_up > 0.5 else 0
            # WARNING: 这是未校准的"模型一致性分数"（离0.5的距离），
            # 不是真实命中率。如需用于仓位管理，必须先走 calibration。
            confidence = max(weighted_prob_up, weighted_prob_down)
        else:
            # 单模型预测
            first_model = list(predictions.keys())[0]
            ensemble_pred = predictions[first_model]
            weighted_prob_up = probabilities[first_model]["up_prob"]
            confidence = weighted_prob_up if ensemble_pred == 1 else (1 - weighted_prob_up)
        
        result = {
            "prediction": ensemble_pred,  # 1=涨, 0=跌
            "prediction_label": "上涨" if ensemble_pred == 1 else "下跌",
            "up_probability": weighted_prob_up,
            "down_probability": 1 - weighted_prob_up,
            "confidence": confidence,
            "individual_predictions": predictions,
            "individual_probabilities": probabilities,
            "model_weights": self.model_weights,
        }
        
        return result
    
    def evaluate(self, X: pd.DataFrame, y: pd.Series) -> Dict:
        """
        评估模型性能
        
        修复: 每个模型必须走各自的特征选择器和标准化器，
        不能拿统一 X_scaled 硬喂，否则维度不匹配或被静默吞掉。
        
        Args:
            X: 特征矩阵
            y: 真实标签
            
        Returns:
            评估指标字典
        """
        result = self.predict(X, use_ensemble=True)
        
        if "error" in result:
            return result
        
        y_array = y.fillna(0).values
        all_predictions = []
        all_probs = []
        
        for model_name, model in self.models.items():
            try:
                # 必须对每个模型分别做特征选择 + 标准化
                X_selected = self._select_features(model_name, X, fit=False)
                X_scaled, _ = self._prepare_data(X_selected, y, fit_scaler=False, model_name=model_name)
                preds = model.predict(X_scaled)
                probs = model.predict_proba(X_scaled)[:, 1]
                all_predictions.append(preds)
                all_probs.append(probs)
            except Exception as e:
                logger.warning(f"模型 {model_name} 评估失败: {e}")
                continue
        
        if not all_predictions:
            return {"error": "无法评估"}
        
        # 集成预测（按模型权重加权平均概率）
        weighted_probs = np.zeros(len(y_array))
        total_weight = 0.0
        for probs, model_name in zip(all_probs, self.models.keys()):
            w = self.model_weights.get(model_name, 0.0)
            weighted_probs += probs * w
            total_weight += w
        if total_weight > 0:
            weighted_probs /= total_weight
        else:
            weighted_probs = np.mean(all_probs, axis=0)
        
        ensemble_preds = (weighted_probs > 0.5).astype(int)
        
        metrics = {
            "accuracy": accuracy_score(y_array, ensemble_preds),
            "precision": precision_score(y_array, ensemble_preds, zero_division=0),
            "recall": recall_score(y_array, ensemble_preds, zero_division=0),
            "f1": f1_score(y_array, ensemble_preds, zero_division=0),
            "auc": roc_auc_score(y_array, weighted_probs) if len(np.unique(y_array)) > 1 else 0.5,
        }
        
        # 计算涨跌准确率分别
        up_mask = y_array == 1
        down_mask = y_array == 0
        
        if up_mask.sum() > 0:
            metrics["up_accuracy"] = (ensemble_preds[up_mask] == y_array[up_mask]).mean()
        if down_mask.sum() > 0:
            metrics["down_accuracy"] = (ensemble_preds[down_mask] == y_array[down_mask]).mean()
        
        metrics["prediction"] = result
        
        return metrics
    
    def cross_validate(self, X: pd.DataFrame, y: pd.Series, n_splits: int = 5) -> Dict:
        """
        时间序列交叉验证
        
        修复: 每个 fold 的 scaler 必须只在训练段 fit，
        严禁先对全量数据标准化再做 TimeSeriesSplit。
        
        Args:
            X: 特征矩阵
            y: 目标变量
            n_splits: 交叉验证折数
            
        Returns:
            交叉验证结果
        """
        logger.info(f"开始{n_splits}折时间序列交叉验证...")
        
        tscv = TimeSeriesSplit(n_splits=n_splits)
        y_array = y.fillna(0).values
        
        cv_results = []
        
        for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
            X_train_raw, X_val_raw = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y_array[train_idx], y_array[val_idx]
            
            logger.info(f"Fold {fold+1}: train={len(train_idx)}, val={len(val_idx)}")
            
            # 每个 fold 单独 fit scaler（防止数据泄露）
            scaler = StandardScaler()
            X_train = scaler.fit_transform(X_train_raw.replace([np.inf, -np.inf], 0).fillna(0))
            X_val = scaler.transform(X_val_raw.replace([np.inf, -np.inf], 0).fillna(0))
            
            fold_metrics = {}
            for model_name in self.config["models"].keys():
                if not self.config["models"][model_name].get("enabled", False):
                    continue
                
                model = self._get_model_instance(model_name)
                model.fit(X_train, y_train)
                
                y_pred = model.predict(X_val)
                y_prob = model.predict_proba(X_val)[:, 1]
                
                fold_metrics[model_name] = {
                    "accuracy": accuracy_score(y_val, y_pred),
                    "precision": precision_score(y_val, y_pred, zero_division=0),
                    "recall": recall_score(y_val, y_pred, zero_division=0),
                    "f1": f1_score(y_val, y_pred, zero_division=0),
                    "auc": roc_auc_score(y_val, y_prob) if len(np.unique(y_val)) > 1 else 0.5,
                }
            
            cv_results.append(fold_metrics)
        
        # 汇总结果
        summary = {}
        for model_name in cv_results[0].keys():
            summary[model_name] = {
                metric: np.mean([fold[model_name][metric] for fold in cv_results])
                for metric in ["accuracy", "precision", "recall", "f1", "auc"]
            }
        
        self.cv_scores = summary
        logger.info("交叉验证完成")
        
        return summary
    
    def save_models(self, filepath: str = None):
        """保存模型到本地"""
        if filepath is None:
            os.makedirs(MODEL_DIR, exist_ok=True)
            filepath = os.path.join(MODEL_DIR, f"models_{datetime.now().strftime('%Y%m%d_%H%M%S')}.joblib")
        
        save_data = {
            "models": self.models,
            "scalers": self.scalers,
            "model_weights": self.model_weights,
            "feature_importance": self.feature_importance,
            "training_history": self.training_history,
            "cv_scores": self.cv_scores,
        }
        
        joblib.dump(save_data, filepath)
        logger.info(f"模型已保存到: {filepath}")
        return filepath
    
    def load_models(self, filepath: str):
        """从本地加载模型"""
        if not os.path.exists(filepath):
            logger.error(f"模型文件不存在: {filepath}")
            return False
        
        save_data = joblib.load(filepath)
        
        self.models = save_data.get("models", {})
        self.scalers = save_data.get("scalers", {})
        self.model_weights = save_data.get("model_weights", self.model_weights)
        self.feature_importance = save_data.get("feature_importance", {})
        self.training_history = save_data.get("training_history", [])
        self.cv_scores = save_data.get("cv_scores", {})
        
        logger.info(f"模型已从 {filepath} 加载")
        return True
    
    def get_feature_importance_df(self, feature_names: List[str]) -> pd.DataFrame:
        """
        获取特征重要性DataFrame
        
        Args:
            feature_names: 特征名称列表
            
        Returns:
            DataFrame with feature importance
        """
        importance_data = []
        
        for model_name, importance in self.feature_importance.items():
            if len(importance) == len(feature_names):
                for feat_name, imp in zip(feature_names, importance):
                    importance_data.append({
                        "model": model_name,
                        "feature": feat_name,
                        "importance": imp
                    })
        
        df = pd.DataFrame(importance_data)
        if not df.empty:
            # 计算平均重要性
            avg_importance = df.groupby("feature")["importance"].mean().sort_values(ascending=False)
            return avg_importance.reset_index()
        
        return pd.DataFrame()


if __name__ == "__main__":
    # 测试模型训练
    from data_fetcher import DataFetcher
    from feature_engineer import FeatureEngineer
    
    # 获取数据
    fetcher = DataFetcher()
    engineer = FeatureEngineer()
    
    data = fetcher.get_all_data_for_stock("600519", days=120)
    X, y = engineer.build_features(data, "600519")
    
    if not X.empty:
        # 训练模型
        trainer = ModelTrainer()
        results = trainer.train_ensemble(X, y)
        
        # 预测
        prediction = trainer.predict(X)
        print(f"\n预测结果: {prediction}")
        
        # 保存模型
        trainer.save_models()
