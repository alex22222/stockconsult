# -*- coding: utf-8 -*-
"""
进化引擎模块 - 自适应因子权重与模型权重优化
基于遗传算法思想的渐进式进化策略
"""

import pandas as pd
import numpy as np
import json
import os
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

from config import EVOLUTION_CONFIG, FACTOR_CATEGORIES, MODEL_DIR

logger = logging.getLogger(__name__)


class EvolutionEngine:
    """
    预测模型进化引擎
    
    核心能力:
    - 记录每日预测结果与实际 outcome
    - 基于近期表现触发进化
    - 因子权重自适应调整
    - 模型权重动态优化
    - 特征选择进化
    """
    
    def __init__(self):
        self.config = EVOLUTION_CONFIG
        self.factor_weights = {cat: info["weight"] for cat, info in FACTOR_CATEGORIES.items()}
        self.model_weights = {}
        self.prediction_history = []  # 预测历史记录
        self.evolution_count = 0      # 进化次数
        self.accuracy_history = []    # 准确率历史
        self.feature_selection_history = []  # 特征选择历史
        
        logger.info("EvolutionEngine初始化完成")
    
    def record_prediction_result(self, prediction: Dict, actual: Optional[int] = None,
                                  features: pd.DataFrame = None):
        """
        记录预测结果
        
        Args:
            prediction: 预测结果字典
            actual: 实际结果 (1=涨, 0=跌), None表示尚未知
            features: 当日特征
        """
        record = {
            "timestamp": datetime.now().isoformat(),
            "prediction": prediction.get("prediction"),
            "confidence": prediction.get("confidence"),
            "up_probability": prediction.get("up_probability"),
            "individual_predictions": prediction.get("individual_predictions", {}),
            "model_weights": prediction.get("model_weights", {}),
            "actual": actual,
            "verified": actual is not None,
        }
        
        self.prediction_history.append(record)
        
        # 只保留最近N条记录
        max_history = self.config.get("max_history", 500)
        if len(self.prediction_history) > max_history:
            self.prediction_history = self.prediction_history[-max_history:]
        
        logger.info(f"记录预测结果: 预测={record['prediction']}, 置信度={record['confidence']:.4f}")
    
    def update_actual_result(self, actual: int, timestamp: str = None):
        """
        更新预测的实际结果 (次日开盘后调用)
        
        Args:
            actual: 实际涨跌 (1=涨, 0=跌)
            timestamp: 对应预测的时间戳
        """
        if timestamp:
            for record in self.prediction_history:
                if record["timestamp"] == timestamp and not record["verified"]:
                    record["actual"] = actual
                    record["verified"] = True
                    break
        else:
            # 更新最新一条未验证的记录
            for record in reversed(self.prediction_history):
                if not record["verified"]:
                    record["actual"] = actual
                    record["verified"] = True
                    break
        
        # 重新计算准确率历史
        self._update_accuracy_history()
    
    def _update_accuracy_history(self):
        """更新准确率历史"""
        verified = [r for r in self.prediction_history if r["verified"]]
        if len(verified) >= 5:
            # 滑动窗口计算准确率
            window_size = self.config.get("accuracy_window", 20)
            for i in range(len(verified) - window_size + 1):
                window = verified[i:i+window_size]
                correct = sum(1 for r in window if r["prediction"] == r["actual"])
                accuracy = correct / len(window)
                self.accuracy_history.append({
                    "window_end": i + window_size,
                    "accuracy": accuracy,
                    "count": len(window)
                })
    
    def get_recent_accuracy(self, n: int = 10) -> float:
        """
        获取最近N天的预测准确率
        
        Args:
            n: 最近N天
            
        Returns:
            准确率 (0-1)
        """
        verified = [r for r in self.prediction_history if r["verified"]]
        if len(verified) < n:
            return 0.5  # 数据不足，返回随机水平
        
        recent = verified[-n:]
        correct = sum(1 for r in recent if r["prediction"] == r["actual"])
        return correct / len(recent)
    
    def should_evolve(self, recent_accuracy: float = None) -> bool:
        """
        判断是否应该触发进化
        
        触发条件:
        1. 积累足够的新数据
        2. 近期准确率低于阈值
        3. 达到一定时间间隔
        
        Args:
            recent_accuracy: 近期准确率
            
        Returns:
            是否触发进化
        """
        verified_count = sum(1 for r in self.prediction_history if r["verified"])
        
        # 条件1: 最少验证样本数
        min_samples = self.config.get("min_samples_for_evolution", 30)
        if verified_count < min_samples:
            return False
        
        # 条件2: 近期准确率低于阈值
        accuracy_threshold = self.config.get("accuracy_threshold", 0.55)
        if recent_accuracy is not None and recent_accuracy < accuracy_threshold:
            logger.info(f"近期准确率 {recent_accuracy:.4f} 低于阈值 {accuracy_threshold}，触发进化")
            return True
        
        # 条件3: 时间间隔
        min_interval = self.config.get("min_evolution_interval_days", 7)
        if self.prediction_history:
            last_evolution = self.prediction_history[-1].get("evolution_triggered", False)
            # 简化: 每积累一定新数据就触发
            if verified_count % min_interval == 0:
                return True
        
        return False
    
    def evolve_factor_weights(self, feature_importance: Dict[str, float]) -> Dict[str, float]:
        """
        进化因子权重
        
        策略:
        1. 根据特征重要性调整各类因子权重
        2. 引入动量: 表现好的因子权重增加
        3. 引入惩罚: 表现差的因子权重减少
        4. 保持权重总和为1
        
        Args:
            feature_importance: 特征重要性字典
            
        Returns:
            新的因子权重
        """
        if not feature_importance:
            return self.factor_weights
        
        # 1. 计算每类因子的平均重要性
        category_scores = {cat: [] for cat in self.factor_weights.keys()}
        
        for feat_name, importance in feature_importance.items():
            feat_lower = feat_name.lower()
            if any(kw in feat_lower for kw in ["index", "market_vol", "corr"]):
                category_scores["market_environment"].append(importance)
            elif any(kw in feat_lower for kw in ["volume", "energy", "turnover", "momentum", "amount"]):
                category_scores["market_energy"].append(importance)
            elif any(kw in feat_lower for kw in ["sentiment", "fear", "greed", "consecutive", "amplitude"]):
                category_scores["market_sentiment"].append(importance)
            elif any(kw in feat_lower for kw in ["macd", "kdj", "rsi", "bb_", "ma_", "obv", "atr", "body", "shadow"]):
                category_scores["technical_indicators"].append(importance)
            elif any(kw in feat_lower for kw in ["sector", "industry", "relative_strength"]):
                category_scores["sector_heat"].append(importance)
            elif any(kw in feat_lower for kw in ["fund", "order", "retail", "main_fund", "spike", "divergence"]):
                category_scores["fund_anomaly"].append(importance)
        
        # 2. 计算每类得分
        category_avg = {}
        for cat, scores in category_scores.items():
            category_avg[cat] = np.mean(scores) if scores else 0.01
        
        # 3. 结合近期预测准确率进行微调
        recent_accuracy = self.get_recent_accuracy(20)
        
        # 4. 进化公式: 新权重 = 旧权重 * (1 + 学习率 * (类别得分 - 平均得分))
        learning_rate = self.config.get("factor_learning_rate", 0.1)
        
        avg_score = np.mean(list(category_avg.values())) if category_avg else 0.01
        
        new_weights = {}
        for cat, old_weight in self.factor_weights.items():
            score = category_avg.get(cat, avg_score)
            # 根据准确率调整学习率: 准确率低时更激进
            adaptive_lr = learning_rate * (1 + max(0, 0.6 - recent_accuracy))
            adjustment = 1 + adaptive_lr * (score - avg_score) / (avg_score + 1e-10)
            new_weights[cat] = old_weight * adjustment
        
        # 5. 归一化
        total = sum(new_weights.values())
        if total > 0:
            new_weights = {k: v / total for k, v in new_weights.items()}
        
        # 6. 添加噪声（探索）
        noise_level = self.config.get("exploration_noise", 0.02)
        if noise_level > 0:
            noise = {k: np.random.normal(0, noise_level) for k in new_weights}
            new_weights = {k: max(0.05, v + noise[k]) for k, v in new_weights.items()}
            total = sum(new_weights.values())
            new_weights = {k: v / total for k, v in new_weights.items()}
        
        self.factor_weights = new_weights
        self.evolution_count += 1
        
        logger.info(f"因子权重进化完成 (第{self.evolution_count}次):")
        for cat, w in new_weights.items():
            logger.info(f"  {cat}: {w:.4f}")
        
        return new_weights
    
    def evolve_model_weights(self, model_performances: Dict[str, float]) -> Dict[str, float]:
        """
        进化模型权重
        
        策略:
        1. 基于各模型近期AUC表现调整权重
        2. 表现好的模型权重增加
        3. 引入温度参数控制调整幅度
        
        Args:
            model_performances: {模型名: AUC得分}
            
        Returns:
            新的模型权重
        """
        if not model_performances:
            return self.model_weights
        
        temperature = self.config.get("model_temperature", 2.0)
        
        # Softmax 归一化
        exp_scores = {}
        for model_name, score in model_performances.items():
            # 使用AUC作为得分，减去0.5基准
            adjusted_score = max(0, score - 0.5)
            exp_scores[model_name] = np.exp(adjusted_score * temperature)
        
        total = sum(exp_scores.values())
        if total > 0:
            new_weights = {k: v / total for k, v in exp_scores.items()}
        else:
            # 均等权重
            n = len(model_performances)
            new_weights = {k: 1.0 / n for k in model_performances}
        
        self.model_weights = new_weights
        
        logger.info(f"模型权重进化完成:")
        for model_name, w in new_weights.items():
            logger.info(f"  {model_name}: {w:.4f}")
        
        return new_weights
    
    def select_features(self, features: pd.DataFrame, 
                        feature_importance_df: pd.DataFrame,
                        top_k: int = None) -> List[str]:
        """
        进化特征选择
        
        策略:
        1. 保留重要性top K特征
        2. 保留每个类别至少N个特征（多样性保护）
        3. 周期性轮换特征集（防止过拟合）
        
        Args:
            features: 特征DataFrame
            feature_importance_df: 特征重要性DataFrame
            top_k: 保留的特征数
            
        Returns:
            选择的特征名列表
        """
        if feature_importance_df.empty:
            return features.columns.tolist()
        
        top_k = top_k or self.config.get("feature_select_topk", 50)
        min_per_category = self.config.get("min_features_per_category", 3)
        
        # 按重要性排序
        sorted_features = feature_importance_df.sort_values("importance", ascending=False)
        
        selected = set()
        
        # 1. 每类至少保留min_per_category个
        category_features = {
            "market_environment": [],
            "market_energy": [],
            "market_sentiment": [],
            "technical_indicators": [],
            "sector_heat": [],
            "fund_anomaly": [],
        }
        
        for _, row in sorted_features.iterrows():
            feat_name = row["feature"]
            feat_lower = feat_name.lower()
            
            if any(kw in feat_lower for kw in ["index", "market_vol", "corr"]):
                category_features["market_environment"].append((feat_name, row["importance"]))
            elif any(kw in feat_lower for kw in ["volume", "energy", "turnover", "momentum", "amount"]):
                category_features["market_energy"].append((feat_name, row["importance"]))
            elif any(kw in feat_lower for kw in ["sentiment", "fear", "greed", "consecutive", "amplitude"]):
                category_features["market_sentiment"].append((feat_name, row["importance"]))
            elif any(kw in feat_lower for kw in ["macd", "kdj", "rsi", "bb_", "ma_", "obv", "atr", "body", "shadow"]):
                category_features["technical_indicators"].append((feat_name, row["importance"]))
            elif any(kw in feat_lower for kw in ["sector", "industry", "relative_strength"]):
                category_features["sector_heat"].append((feat_name, row["importance"]))
            elif any(kw in feat_lower for kw in ["fund", "order", "retail", "main_fund", "spike", "divergence"]):
                category_features["fund_anomaly"].append((feat_name, row["importance"]))
        
        for cat, feats in category_features.items():
            # 排序并取前min_per_category
            feats_sorted = sorted(feats, key=lambda x: x[1], reverse=True)
            for feat_name, _ in feats_sorted[:min_per_category]:
                selected.add(feat_name)
        
        # 2. 全局top_k
        for _, row in sorted_features.iterrows():
            selected.add(row["feature"])
            if len(selected) >= top_k:
                break
        
        selected_list = list(selected)
        
        # 记录特征选择历史
        self.feature_selection_history.append({
            "timestamp": datetime.now().isoformat(),
            "selected_features": selected_list,
            "count": len(selected_list)
        })
        
        logger.info(f"特征选择完成: 从{len(features.columns)}个特征中选择了{len(selected_list)}个")
        
        return selected_list
    
    def get_performance_report(self) -> Dict:
        """
        获取进化性能报告
        
        Returns:
            性能报告字典
        """
        verified = [r for r in self.prediction_history if r["verified"]]
        
        if not verified:
            return {"status": "no_data", "message": "暂无验证数据"}
        
        # 计算总体准确率
        correct = sum(1 for r in verified if r["prediction"] == r["actual"])
        total_accuracy = correct / len(verified)
        
        # 分时段准确率
        windows = [5, 10, 20, 60]
        window_accuracies = {}
        for w in windows:
            if len(verified) >= w:
                recent = verified[-w:]
                acc = sum(1 for r in recent if r["prediction"] == r["actual"]) / len(recent)
                window_accuracies[f"last_{w}d"] = acc
        
        # 置信度校准分析
        confidence_buckets = {}
        for r in verified:
            conf = r["confidence"]
            bucket = int(conf * 10) / 10  # 0.5, 0.6, 0.7, ...
            if bucket not in confidence_buckets:
                confidence_buckets[bucket] = {"total": 0, "correct": 0}
            confidence_buckets[bucket]["total"] += 1
            if r["prediction"] == r["actual"]:
                confidence_buckets[bucket]["correct"] += 1
        
        calibration = {}
        for bucket, stats in sorted(confidence_buckets.items()):
            if stats["total"] >= 3:
                calibration[f"{bucket:.1f}"] = {
                    "accuracy": stats["correct"] / stats["total"],
                    "count": stats["total"]
                }
        
        return {
            "total_predictions": len(self.prediction_history),
            "verified_predictions": len(verified),
            "overall_accuracy": total_accuracy,
            "window_accuracies": window_accuracies,
            "evolution_count": self.evolution_count,
            "current_factor_weights": self.factor_weights,
            "confidence_calibration": calibration,
            "accuracy_trend": self.accuracy_history[-20:] if self.accuracy_history else [],
        }
    
    def save_evolution_state(self, filepath: str = None):
        """保存进化状态"""
        if filepath is None:
            filepath = os.path.join(MODEL_DIR, f"evolution_state_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        
        state = {
            "factor_weights": self.factor_weights,
            "model_weights": self.model_weights,
            "prediction_history": self.prediction_history,
            "evolution_count": self.evolution_count,
            "accuracy_history": self.accuracy_history,
            "feature_selection_history": self.feature_selection_history,
            "timestamp": datetime.now().isoformat(),
        }
        
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2, default=str)
        
        logger.info(f"进化状态已保存: {filepath}")
        return filepath
    
    def load_evolution_state(self, filepath: str):
        """加载进化状态"""
        if not os.path.exists(filepath):
            logger.warning(f"进化状态文件不存在: {filepath}")
            return False
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                state = json.load(f)
            
            self.factor_weights = state.get("factor_weights", self.factor_weights)
            self.model_weights = state.get("model_weights", {})
            self.prediction_history = state.get("prediction_history", [])
            self.evolution_count = state.get("evolution_count", 0)
            self.accuracy_history = state.get("accuracy_history", [])
            self.feature_selection_history = state.get("feature_selection_history", [])
            
            logger.info(f"进化状态已加载: {filepath}")
            return True
        except Exception as e:
            logger.error(f"加载进化状态失败: {e}")
            return False
