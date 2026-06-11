# -*- coding: utf-8 -*-
"""
露笑科技 (002617) 专用预测模型演进训练计划
============================================

股票特点:
- 代码: 002617 (深交所中小板)
- 主业: 碳化硅衬底材料 + 光伏发电 + 电磁线
- 行业属性: 半导体材料(第三代) / 光伏设备 / 电力设备
- 波动特征: 高Beta, 高波动, 政策敏感
- 关联因素: 新能源汽车销量、光伏装机量、半导体政策、稀土价格

训练目标:
通过多阶段渐进式训练，使模型准确率从随机基线(50%)逐步提升至可交易水平(>55%)，
并建立科学评估体系验证模型的真实预测能力。
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import json
import os
import logging

from main import StockPredictionEngine
from data_fetcher import DataFetcher
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
from evolution_engine import EvolutionEngine
from backtest_evaluator import BacktestEvaluator
from config import MODEL_DIR

logger = logging.getLogger(__name__)

# ==================== 露笑科技专用配置 ====================

LUXIAO_CONFIG = {
    "symbol": "002617",
    "name": "露笑科技",
    "market": "sz",
    "industry": "半导体材料/光伏设备",
    
    # 关联指数与板块 (用于外部环境监测)
    "related_indices": {
        "光伏产业": "931151",      # 中证光伏产业指数
        "半导体": "H30184",        # 中证半导体指数
        "新能源车": "930997",      # 中证新能源汽车指数
        "创业板指": "399006",      # 创业板指 (同市场风格)
    },
    
    # 关联个股 (产业链上下游)
    "related_stocks": {
        " upstream_原材料": ["600111", "000831"],  # 北方稀土、五矿稀土 (稀土)
        "downstream_客户": ["002594", "300750"],  # 比亚迪、宁德时代 (新能源)
        "同业竞争": ["600703", "300046"],         # 三安光电、台基股份
    },
    
    # 宏观敏感指标
    "macro_indicators": [
        "光伏装机量月度数据",
        "新能源汽车月度销量",
        "半导体设备进口额",
        "美国对华半导体制裁政策事件",
        "硅料/硅片价格",
        "碳化硅衬底价格指数",
    ],
    
    # 训练阶段配置
    "training_phases": [
        {
            "phase": 1,
            "name": "基础模型冷启动",
            "description": "使用2年历史数据训练基线模型，验证特征有效性",
            "data_days": 500,
            "train_mode": "ensemble",
            "target_metric": "auc > 0.52",
            "duration_days": 7,
        },
        {
            "phase": 2,
            "name": "滚动回测验证",
            "description": "Walk-forward验证模型在不同时期的稳定性",
            "data_days": 500,
            "train_mode": "rolling",
            "window_size": 120,
            "step_size": 20,
            "target_metric": "滚动AUC均值 > 0.53, 标准差 < 0.08",
            "duration_days": 14,
        },
        {
            "phase": 3,
            "name": "外部环境因子注入",
            "description": "加入板块指数、关联个股、宏观数据作为外部特征",
            "data_days": 500,
            "train_mode": "ensemble",
            "target_metric": "auc > 0.54",
            "duration_days": 14,
        },
        {
            "phase": 4,
            "name": "在线学习与滚动训练",
            "description": "每日获取新数据，滚动窗口重新训练",
            "data_days": 252,
            "train_mode": "rolling_daily",
            "window_size": 120,
            "target_metric": "近20日准确率 > 52%",
            "duration_days": 30,
        },
        {
            "phase": 5,
            "name": "进化优化与超参搜索",
            "description": "触发进化引擎，优化因子权重和模型超参",
            "data_days": 500,
            "train_mode": "ensemble_with_evolution",
            "target_metric": "auc > 0.55, 夏普 > 0.5",
            "duration_days": 21,
        },
        {
            "phase": 6,
            "name": "实盘模拟与持续监控",
            "description": "每日预测+次日验证，持续监控模型衰减",
            "data_days": 252,
            "train_mode": "online",
            "target_metric": "近60日准确率 > 55%, 最大回撤 < 15%",
            "duration_days": 90,
        },
    ],
}


class LuxiaoTrainingPlan:
    """
    露笑科技专用训练计划执行器
    """
    
    def __init__(self):
        self.config = LUXIAO_CONFIG
        self.symbol = self.config["symbol"]
        self.name = self.config["name"]
        self.engine = None
        self.results_history = []
        
        # 专用报告目录
        self.report_dir = os.path.join(MODEL_DIR, "luxiao_reports")
        os.makedirs(self.report_dir, exist_ok=True)
        
        logger.info(f"露笑科技训练计划初始化完成: {self.name} ({self.symbol})")
    
    # ==================== Phase 1: 基础模型冷启动 ====================
    
    def phase1_baseline_training(self) -> Dict:
        """
        阶段1: 基础模型冷启动
        
        步骤:
        1. 获取500日历史数据
        2. 构建六大类因子特征
        3. 训练集成模型
        4. 交叉验证评估
        5. 输出基线指标
        
        成功标准:
        - AUC > 0.52 (高于随机)
        - 各模型训练成功
        - 特征重要性合理分布
        """
        logger.info("=" * 70)
        logger.info("Phase 1: 基础模型冷启动")
        logger.info("=" * 70)
        
        self.engine = StockPredictionEngine(symbol=self.symbol, stock_name=self.name)
        
        # 1. 获取数据
        self.engine.fetch_data(days=self.config["training_phases"][0]["data_days"])
        
        # 2. 构建特征
        X, y = self.engine.build_features()
        
        if X.empty:
            return {"status": "failed", "phase": 1, "error": "特征构建失败"}
        
        # 3. 交叉验证
        cv_results = self.engine.trainer.cross_validate(X, y, n_splits=5)
        
        # 4. 训练最终模型
        train_results = self.engine.train_models(use_rolling=False)
        
        # 5. 评估
        avg_auc = np.mean([r["auc"] for r in cv_results.values()]) if cv_results else 0.5
        
        result = {
            "phase": 1,
            "status": "success" if avg_auc > 0.52 else "warning",
            "samples": len(X),
            "features": X.shape[1],
            "cv_auc_mean": avg_auc,
            "cv_results": cv_results,
            "train_results": train_results,
            "feature_importance": self.engine.trainer.get_feature_importance_df(
                self.engine.engineer.feature_names
            ).to_dict() if not self.engine.trainer.get_feature_importance_df(
                self.engine.engineer.feature_names
            ).empty else {},
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 1 完成: CV AUC={avg_auc:.4f}")
        return result
    
    # ==================== Phase 2: 滚动回测验证 ====================
    
    def phase2_rolling_validation(self) -> Dict:
        """
        阶段2: 滚动回测验证
        
        步骤:
        1. 使用Walk-forward分析
        2. 训练窗口120日，预测窗口20日
        3. 评估模型在不同时期的稳定性
        
        成功标准:
        - 滚动AUC均值 > 0.53
        - AUC标准差 < 0.08 (稳定性)
        - 无明显的性能衰减趋势
        """
        logger.info("=" * 70)
        logger.info("Phase 2: 滚动回测验证")
        logger.info("=" * 70)
        
        if self.engine is None or self.engine.features.empty:
            self.phase1_baseline_training()
        
        X, y = self.engine.features, self.engine.target
        
        # 滚动训练
        rolling_results = self.engine.trainer.rolling_train(
            X, y,
            window_size=self.config["training_phases"][1]["window_size"],
            step_size=self.config["training_phases"][1]["step_size"]
        )
        
        if not rolling_results:
            return {"status": "failed", "phase": 2, "error": "滚动训练失败"}
        
        # 统计
        aucs = [r["auc"] for r in rolling_results if "auc" in r]
        accuracies = [r["accuracy"] for r in rolling_results if "accuracy" in r]
        
        result = {
            "phase": 2,
            "status": "success" if (np.mean(aucs) > 0.53 and np.std(aucs) < 0.08) else "warning",
            "rolling_windows": len(rolling_results),
            "auc_mean": np.mean(aucs) if aucs else 0.5,
            "auc_std": np.std(aucs) if aucs else 0,
            "accuracy_mean": np.mean(accuracies) if accuracies else 0.5,
            "accuracy_std": np.std(accuracies) if accuracies else 0,
            "rolling_results": rolling_results,
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 2 完成: AUC均值={result['auc_mean']:.4f}, 标准差={result['auc_std']:.4f}")
        return result
    
    # ==================== Phase 3: 外部环境因子注入 ====================
    
    def phase3_external_factors(self) -> Dict:
        """
        阶段3: 外部环境因子注入
        
        针对露笑科技特点，增加以下外部因子:
        1. 关联板块指数走势 (光伏、半导体、新能源车)
        2. 上下游关联个股价格变动
        3. 行业资金流向
        4. 宏观政策事件标记
        
        成功标准:
        - 加入外部因子后 AUC > 0.54
        - 外部因子在特征重要性中有显著占比
        """
        logger.info("=" * 70)
        logger.info("Phase 3: 外部环境因子注入")
        logger.info("=" * 70)
        
        # 获取外部数据
        external_data = self._fetch_external_data()
        
        # 构建扩展特征 (在原特征基础上加入外部因子)
        # 这里使用engineer的扩展方法
        X_base, y = self.engine.features, self.engine.target
        X_external = self._build_external_features(external_data, len(X_base))
        
        if not X_external.empty:
            X_combined = pd.concat([X_base.reset_index(drop=True), 
                                     X_external.reset_index(drop=True)], axis=1)
        else:
            X_combined = X_base
        
        # 重新训练
        train_results = self.engine.trainer.train_ensemble(X_combined, y)
        
        # 评估
        final_eval = self.engine.trainer.evaluate(X_combined, y)
        
        result = {
            "phase": 3,
            "status": "success" if final_eval.get("auc", 0.5) > 0.54 else "warning",
            "original_features": X_base.shape[1],
            "external_features": X_external.shape[1] if not X_external.empty else 0,
            "total_features": X_combined.shape[1],
            "auc": final_eval.get("auc", 0.5),
            "accuracy": final_eval.get("accuracy", 0.5),
            "external_factor_importance": self._analyze_external_importance(
                self.engine.trainer.get_feature_importance_df(X_combined.columns.tolist())
            ),
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 3 完成: AUC={result['auc']:.4f}, 外部特征={result['external_features']}个")
        return result
    
    def _fetch_external_data(self) -> Dict:
        """获取露笑科技相关的外部数据"""
        fetcher = DataFetcher()
        external = {}
        
        # 1. 关联板块指数
        for name, code in self.config["related_indices"].items():
            try:
                df = fetcher.get_index_daily(code, days=500)
                external[f"index_{name}"] = df
                logger.info(f"获取关联指数 {name}: {len(df)} 条")
            except Exception as e:
                logger.warning(f"获取指数 {name} 失败: {e}")
        
        # 2. 关联个股
        for category, symbols in self.config["related_stocks"].items():
            for sym in symbols:
                try:
                    df = fetcher.get_stock_daily(sym, days=500)
                    external[f"stock_{sym}"] = df
                    logger.info(f"获取关联个股 {sym}: {len(df)} 条")
                except Exception as e:
                    logger.warning(f"获取个股 {sym} 失败: {e}")
        
        return external
    
    def _build_external_features(self, external_data: Dict, target_len: int) -> pd.DataFrame:
        """构建外部特征"""
        features_list = []
        
        for key, df in external_data.items():
            if df.empty or "收盘" not in df.columns:
                continue
            
            close = df["收盘"]
            prefix = key.replace("index_", "").replace("stock_", "")
            
            f = pd.DataFrame(index=range(target_len))
            
            # 收益率特征
            f[f"{prefix}_ret_1d"] = close.pct_change().values[-target_len:] if len(close) >= target_len else [0] * target_len
            f[f"{prefix}_ret_5d"] = close.pct_change(5).values[-target_len:] if len(close) >= target_len else [0] * target_len
            f[f"{prefix}_ret_20d"] = close.pct_change(20).values[-target_len:] if len(close) >= target_len else [0] * target_len
            
            # 趋势特征
            ma5 = close.rolling(5).mean()
            ma20 = close.rolling(20).mean()
            f[f"{prefix}_ma5_above_ma20"] = ((ma5 > ma20).astype(int).values[-target_len:] if len(ma5) >= target_len else [0] * target_len)
            
            # 波动特征
            f[f"{prefix}_volatility"] = close.pct_change().rolling(20).std().values[-target_len:] if len(close) >= target_len else [0] * target_len
            
            features_list.append(f)
        
        if features_list:
            return pd.concat(features_list, axis=1).fillna(0)
        return pd.DataFrame()
    
    def _analyze_external_importance(self, importance_df: pd.DataFrame) -> Dict:
        """分析外部因子在特征重要性中的占比"""
        if importance_df.empty:
            return {}
        
        external_prefixes = list(self.config["related_indices"].keys()) + \
                            [s for stocks in self.config["related_stocks"].values() for s in stocks]
        
        total_importance = importance_df["importance"].sum()
        external_importance = 0
        
        for _, row in importance_df.iterrows():
            feat = row["feature"]
            if any(str(p) in feat for p in external_prefixes):
                external_importance += row["importance"]
        
        return {
            "external_ratio": external_importance / total_importance if total_importance > 0 else 0,
            "total_importance": total_importance,
            "external_importance": external_importance,
        }
    
    # ==================== Phase 4: 在线学习与滚动训练 ====================
    
    def phase4_online_learning(self, days: int = 30) -> Dict:
        """
        阶段4: 在线学习与滚动训练
        
        模拟每日流程:
        1. 获取最新数据
        2. 用最近120日数据重新训练
        3. 预测次日涨跌
        4. 记录预测，次日验证
        5. 积累30日验证数据
        
        成功标准:
        - 近20日预测准确率 > 52%
        - 预测置信度与实际准确率正相关
        """
        logger.info("=" * 70)
        logger.info(f"Phase 4: 在线学习模拟 ({days}天)")
        logger.info("=" * 70)
        
        # 使用历史数据进行模拟
        self.engine.fetch_data(days=500)
        self.engine.build_features()
        
        X, y = self.engine.features, self.engine.target
        window_size = self.config["training_phases"][3]["window_size"]
        
        predictions = []
        actuals = []
        
        # 模拟每日在线学习 (从第window_size天开始)
        start_idx = window_size
        end_idx = min(start_idx + days, len(X))
        
        for i in range(start_idx, end_idx):
            # 用前i天数据训练
            X_train = X.iloc[i-window_size:i]
            y_train = y.iloc[i-window_size:i]
            X_test = X.iloc[i:i+1]
            y_test = y.iloc[i:i+1]
            
            # 训练
            self.engine.trainer.train_ensemble(X_train, y_train)
            
            # 预测
            pred = self.engine.trainer.predict(X_test)
            
            # 记录
            predictions.append(pred)
            actuals.append(y_test.values[0])
            
            # 记录到进化引擎
            self.engine.evolution.record_prediction_result(pred, actual=y_test.values[0])
        
        # 统计准确率
        correct = sum(1 for p, a in zip(predictions, actuals) 
                      if p.get("prediction") == a)
        accuracy = correct / len(predictions) if predictions else 0
        
        # 分窗口统计
        window_acc = {}
        for w in [5, 10, 20]:
            if len(predictions) >= w:
                recent_correct = sum(1 for p, a in zip(predictions[-w:], actuals[-w:])
                                     if p.get("prediction") == a)
                window_acc[f"last_{w}d"] = recent_correct / w
        
        result = {
            "phase": 4,
            "status": "success" if accuracy > 0.52 else "warning",
            "simulated_days": len(predictions),
            "overall_accuracy": accuracy,
            "window_accuracies": window_acc,
            "evolution_state": self.engine.evolution.get_performance_report(),
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 4 完成: 总体准确率={accuracy:.4f}, 近20日={window_acc.get('last_20d', 0):.4f}")
        return result
    
    # ==================== Phase 5: 进化优化 ====================
    
    def phase5_evolution_optimization(self) -> Dict:
        """
        阶段5: 进化优化与超参搜索
        
        步骤:
        1. 基于Phase 4的预测历史触发进化
        2. 优化因子权重
        3. 优化模型权重
        4. 特征选择进化
        5. 简单网格搜索优化超参
        
        成功标准:
        - 进化后AUC > 0.55
        - 回测夏普比率 > 0.5
        - 因子权重分布合理
        """
        logger.info("=" * 70)
        logger.info("Phase 5: 进化优化")
        logger.info("=" * 70)
        
        # 确保有预测历史
        if len(self.engine.evolution.prediction_history) < 20:
            self.phase4_online_learning(days=60)
        
        # 触发进化
        evolution_result = self.engine.run_evolution()
        
        # 重新训练
        self.engine.train_models(use_rolling=False)
        
        # 回测
        backtest = self.engine.run_backtest(window_days=60)
        
        # 评估
        eval_result = self.engine.trainer.evaluate(self.engine.features, self.engine.target)
        
        result = {
            "phase": 5,
            "status": "success" if eval_result.get("auc", 0.5) > 0.55 else "warning",
            "evolution_result": evolution_result,
            "factor_weights": self.engine.evolution.factor_weights,
            "model_weights": self.engine.trainer.model_weights,
            "auc": eval_result.get("auc", 0.5),
            "sharpe": backtest.get("sharpe_ratio", 0),
            "max_drawdown": backtest.get("max_drawdown_pct", 0),
            "backtest_return": backtest.get("total_return_pct", 0),
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 5 完成: AUC={result['auc']:.4f}, 夏普={result['sharpe']:.4f}")
        return result
    
    # ==================== Phase 6: 实盘模拟 ====================
    
    def phase6_live_simulation(self, days: int = 90) -> Dict:
        """
        阶段6: 实盘模拟与持续监控
        
        模拟完整的每日流程:
        1. 每日收盘后获取数据
        2. 滚动训练
        3. 预测次日涨跌
        4. 次日验证并记录
        5. 定期触发进化
        6. 监控模型衰减信号
        
        衰减信号:
        - 连续10日准确率 < 45%
        - AUC下降超过0.05
        - 夏普比率转负
        
        成功标准:
        - 近60日准确率 > 55%
        - 最大回撤 < 15%
        - 无严重模型衰减
        """
        logger.info("=" * 70)
        logger.info(f"Phase 6: 实盘模拟 ({days}天)")
        logger.info("=" * 70)
        
        # 这里使用历史数据末尾进行模拟
        self.engine.fetch_data(days=500)
        self.engine.build_features()
        
        X, y = self.engine.features, self.engine.target
        
        # 用最后days天模拟实盘
        sim_days = min(days, len(X) - 120)
        start_idx = len(X) - sim_days
        
        predictions = []
        actuals = []
        daily_pnl = []
        
        decay_signals = []
        
        for i in range(start_idx, len(X)):
            X_train = X.iloc[i-120:i]
            y_train = y.iloc[i-120:i]
            X_test = X.iloc[i:i+1]
            y_test = y.iloc[i:i+1]
            
            self.engine.trainer.train_ensemble(X_train, y_train)
            pred = self.engine.trainer.predict(X_test)
            
            predictions.append(pred)
            actuals.append(y_test.values[0])
            
            # 模拟P&L (预测涨则做多，预测跌则空仓)
            if pred.get("prediction") == 1:
                pnl = 1 if y_test.values[0] == 1 else -1
            else:
                pnl = 0  # 空仓
            daily_pnl.append(pnl)
            
            # 检查衰减信号 (每20天检查一次)
            if len(predictions) >= 20 and len(predictions) % 20 == 0:
                recent_acc = sum(1 for p, a in zip(predictions[-20:], actuals[-20:])
                                if p.get("prediction") == a) / 20
                if recent_acc < 0.45:
                    decay_signals.append({
                        "day": i - start_idx,
                        "type": "accuracy_drop",
                        "recent_accuracy": recent_acc,
                    })
                    logger.warning(f"衰减信号: 近20日准确率={recent_acc:.4f}")
        
        # 汇总统计
        correct = sum(1 for p, a in zip(predictions, actuals) if p.get("prediction") == a)
        overall_acc = correct / len(predictions) if predictions else 0
        
        window_stats = {}
        for w in [20, 40, 60]:
            if len(predictions) >= w:
                recent_correct = sum(1 for p, a in zip(predictions[-w:], actuals[-w:])
                                     if p.get("prediction") == a)
                window_stats[f"last_{w}d"] = recent_correct / w
        
        # 累计收益
        cumulative_pnl = np.cumsum(daily_pnl)
        max_dd = 0
        peak = 0
        for cp in cumulative_pnl:
            if cp > peak:
                peak = cp
            dd = peak - cp
            if dd > max_dd:
                max_dd = dd
        
        result = {
            "phase": 6,
            "status": "success" if overall_acc > 0.55 and max_dd < 15 else "warning",
            "simulated_days": len(predictions),
            "overall_accuracy": overall_acc,
            "window_accuracies": window_stats,
            "cumulative_pnl": cumulative_pnl[-1] if len(cumulative_pnl) > 0 else 0,
            "max_drawdown_days": max_dd,
            "decay_signals": decay_signals,
            "decay_count": len(decay_signals),
        }
        
        self.results_history.append(result)
        self._save_phase_report(result)
        
        logger.info(f"Phase 6 完成: 准确率={overall_acc:.4f}, 最大回撤={max_dd}天")
        return result
    
    # ==================== 全阶段执行 ====================
    
    def run_full_plan(self, phases: List[int] = None) -> Dict:
        """
        执行完整训练计划
        
        Args:
            phases: 指定执行的阶段，None表示全部
            
        Returns:
            完整结果汇总
        """
        phases = phases or [1, 2, 3, 4, 5, 6]
        
        logger.info("=" * 70)
        logger.info(f"开始执行露笑科技训练计划: {self.name} ({self.symbol})")
        logger.info("=" * 70)
        
        all_results = {}
        
        if 1 in phases:
            all_results["phase1"] = self.phase1_baseline_training()
        
        if 2 in phases:
            all_results["phase2"] = self.phase2_rolling_validation()
        
        if 3 in phases:
            all_results["phase3"] = self.phase3_external_factors()
        
        if 4 in phases:
            all_results["phase4"] = self.phase4_online_learning(days=60)
        
        if 5 in phases:
            all_results["phase5"] = self.phase5_evolution_optimization()
        
        if 6 in phases:
            all_results["phase6"] = self.phase6_live_simulation(days=90)
        
        # 生成最终汇总报告
        summary = self._generate_final_summary(all_results)
        all_results["summary"] = summary
        
        # 保存完整报告
        summary_path = os.path.join(self.report_dir, 
            f"training_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(all_results, f, ensure_ascii=False, indent=2, default=str)
        
        logger.info(f"训练计划完成，报告保存至: {summary_path}")
        return all_results
    
    def _generate_final_summary(self, all_results: Dict) -> Dict:
        """生成最终汇总"""
        summary = {
            "stock": f"{self.name} ({self.symbol})",
            "training_date": datetime.now().isoformat(),
            "phases_completed": len(all_results),
            "final_metrics": {},
            "improvement_trajectory": [],
        }
        
        # 收集各阶段关键指标
        for phase_name, result in all_results.items():
            if isinstance(result, dict):
                phase_num = result.get("phase", 0)
                if phase_num > 0:
                    summary["improvement_trajectory"].append({
                        "phase": phase_num,
                        "auc": result.get("auc", result.get("cv_auc_mean", 0.5)),
                        "accuracy": result.get("accuracy", result.get("overall_accuracy", 0.5)),
                        "status": result.get("status", "unknown"),
                    })
        
        # 最终指标
        if "phase6" in all_results:
            summary["final_metrics"] = {
                "accuracy": all_results["phase6"].get("overall_accuracy", 0),
                "last_60d_accuracy": all_results["phase6"].get("window_accuracies", {}).get("last_60d", 0),
                "max_drawdown": all_results["phase6"].get("max_drawdown_days", 0),
            }
        elif "phase5" in all_results:
            summary["final_metrics"] = {
                "auc": all_results["phase5"].get("auc", 0),
                "sharpe": all_results["phase5"].get("sharpe", 0),
            }
        
        return summary
    
    def _save_phase_report(self, result: Dict):
        """保存阶段报告"""
        phase = result.get("phase", 0)
        filepath = os.path.join(self.report_dir, f"phase{phase}_report.json")
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2, default=str)


# ==================== 快捷入口 ====================

def run_luxiao_training(phases: List[int] = None):
    """
    执行露笑科技训练计划
    
    Usage:
        results = run_luxiao_training()
    """
    plan = LuxiaoTrainingPlan()
    return plan.run_full_plan(phases)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="露笑科技训练计划")
    parser.add_argument("--phases", type=str, default="1,2,3,4,5,6",
                       help="执行阶段，如: 1,2,3")
    parser.add_argument("--phase", type=int, default=None,
                       help="单独执行某一阶段")
    
    args = parser.parse_args()
    
    if args.phase:
        phases = [args.phase]
    else:
        phases = [int(p) for p in args.phases.split(",")]
    
    results = run_luxiao_training(phases)
    print("\n训练计划完成!")
    print(json.dumps(results.get("summary", {}), ensure_ascii=False, indent=2))
