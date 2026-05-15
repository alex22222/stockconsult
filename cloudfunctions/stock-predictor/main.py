# -*- coding: utf-8 -*-
"""
A股个股涨跌预测引擎 - 主控入口
===========================
整合六大模块:
1. 数据获取 (DataFetcher)
2. 特征工程 (FeatureEngineer)
3. 模型训练 (ModelTrainer)
4. 进化优化 (EvolutionEngine)
5. 回测评估 (BacktestEvaluator)
6. 可视化 (Visualizer)

支持: 每日自动运行、滚动训练、因子权重进化、模型权重优化
"""

import pandas as pd
import numpy as np
import logging
import sys
import os
from datetime import datetime
from typing import Dict, Optional
import traceback

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import (
    LOG_CONFIG, DATA_CONFIG, DEMO_STOCK, MODEL_CONFIG, 
    EVOLUTION_CONFIG, FACTOR_CATEGORIES, MODEL_DIR
)
from data_fetcher import DataFetcher
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
from evolution_engine import EvolutionEngine
from backtest_evaluator import BacktestEvaluator
from visualizer import Visualizer

# ==================== 日志配置 ====================
logging.basicConfig(
    level=getattr(logging, LOG_CONFIG["level"]),
    format=LOG_CONFIG["format"],
    handlers=[
        logging.FileHandler(LOG_CONFIG["file"], encoding='utf-8'),
        logging.StreamHandler(sys.stdout) if LOG_CONFIG["console"] else logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

logger.info("=" * 70)
logger.info(" A股个股涨跌预测引擎启动")
logger.info("=" * 70)


class StockPredictionEngine:
    """
    A股个股涨跌预测引擎 (主控类)
    
    核心能力:
    - 每日自动获取多维度市场数据
    - 六大类因子特征工程
    - 集成模型训练与预测
    - 因子权重自适应进化
    - 回测评估与可视化
    """
    
    def __init__(self, symbol: str = None, stock_name: str = None):
        """
        初始化预测引擎
        
        Args:
            symbol: 股票代码 (如 "600519")
            stock_name: 股票名称 (如 "贵州茅台")
        """
        self.symbol = symbol or DEMO_STOCK["code"]
        self.stock_name = stock_name or DEMO_STOCK["name"]
        
        logger.info(f"初始化引擎: {self.stock_name} ({self.symbol})")
        
        # 初始化各模块
        self.fetcher = DataFetcher()
        self.engineer = FeatureEngineer()
        self.trainer = ModelTrainer()
        self.evolution = EvolutionEngine()
        self.backtest = BacktestEvaluator()
        self.visualizer = Visualizer()
        
        # 数据存储
        self.raw_data = {}
        self.features = pd.DataFrame()
        self.target = pd.Series()
        self.latest_prediction = {}
        
        # 尝试加载已有模型
        self._load_existing_models()
    
    @property
    def symbol_model_dir(self) -> str:
        """当前股票对应的模型子目录"""
        return os.path.join(MODEL_DIR, self.symbol)

    def _load_existing_models(self):
        """加载已有模型和进化状态（按股票代码隔离）"""
        model_dir = self.symbol_model_dir
        os.makedirs(model_dir, exist_ok=True)
        
        # 查找最新的模型文件
        model_files = [f for f in os.listdir(model_dir) if f.startswith("models_") and f.endswith(".joblib")]
        if model_files:
            latest_model = sorted(model_files)[-1]
            model_path = os.path.join(model_dir, latest_model)
            self.trainer.load_models(model_path)
            logger.info(f"已加载历史模型: {latest_model}")
        
        # 加载进化状态
        state_files = [f for f in os.listdir(model_dir) if f.startswith("evolution_state_") and f.endswith(".json")]
        if state_files:
            latest_state = sorted(state_files)[-1]
            state_path = os.path.join(model_dir, latest_state)
            self.evolution.load_evolution_state(state_path)
    
    def fetch_data(self, days: int = 252) -> Dict[str, pd.DataFrame]:
        """
        获取全维度数据
        
        Args:
            days: 历史数据天数
            
        Returns:
            原始数据字典
        """
        logger.info(f"开始获取 {self.symbol} 的全维度数据 ({days}天)...")
        
        self.raw_data = self.fetcher.get_all_data_for_stock(self.symbol, days)
        
        # 添加个股信息
        self.raw_data["stock_info"] = self.fetcher.get_stock_info(self.symbol)
        self.stock_name = self.raw_data["stock_info"].get("name", self.stock_name)
        
        logger.info("数据获取完成")
        return self.raw_data
    
    def build_features(self) -> tuple:
        """
        构建特征工程
        
        Returns:
            (X, y) 特征矩阵和目标变量
        """
        logger.info("开始构建多因子特征...")
        
        if not self.raw_data:
            logger.error("请先获取数据 (fetch_data)")
            return pd.DataFrame(), pd.Series()
        
        self.features, self.target = self.engineer.build_features(self.raw_data, self.symbol)
        
        logger.info(f"特征构建完成: {self.features.shape}")
        return self.features, self.target
    
    def train_models(self, use_rolling: bool = False) -> Dict:
        """
        训练预测模型
        
        Args:
            use_rolling: 是否使用滚动训练
            
        Returns:
            训练结果
        """
        logger.info("开始训练模型...")
        
        if self.features.empty or self.target.empty:
            logger.error("特征或目标为空，请先构建特征 (build_features)")
            return {}
        
        if use_rolling and len(self.features) >= MODEL_CONFIG["train_window"] * 2:
            # 滚动训练
            results = self.trainer.rolling_train(self.features, self.target)
        else:
            # 普通训练
            results = self.trainer.train_ensemble(self.features, self.target)
        
        # 保存模型（按股票代码隔离）
        model_path = os.path.join(self.symbol_model_dir, f"models_{datetime.now().strftime('%Y%m%d_%H%M%S')}.joblib")
        os.makedirs(self.symbol_model_dir, exist_ok=True)
        self.trainer.save_models(model_path)
        
        return results
    
    def predict(self) -> Dict:
        """
        预测明日涨跌
        
        Returns:
            预测结果字典
        """
        logger.info("开始预测明日涨跌...")
        
        if not self.trainer.models:
            logger.warning("模型未训练，尝试训练...")
            if self.features.empty:
                self.fetch_data()
                self.build_features()
            self.train_models()
        
        if self.features.empty:
            logger.error("无法预测：特征为空")
            return {"error": "特征为空"}
        
        # 使用最新特征进行预测
        self.latest_prediction = self.trainer.predict(self.features)
        
        # 记录预测结果 (用于进化)
        self.evolution.record_prediction_result(
            self.latest_prediction, 
            actual=None,  # 实际结果未知，待明日验证
            features=self.features
        )
        
        logger.info(f"预测完成: {self.latest_prediction.get('prediction_label', '未知')} "
                   f"(置信度: {self.latest_prediction.get('confidence', 0)*100:.2f}%)")
        
        return self.latest_prediction
    
    def run_evolution(self) -> Dict:
        """
        运行进化优化
        
        根据最近的回测表现，调整因子权重和模型权重
        
        Returns:
            进化结果
        """
        logger.info("检查是否需要进化...")
        
        # 检查触发条件
        recent_accuracy = self.evolution.get_recent_accuracy(10)
        
        if not self.evolution.should_evolve(recent_accuracy):
            logger.info("暂不需要进化")
            return {"status": "skipped", "reason": "触发条件不满足"}
        
        logger.info("触发进化优化!")
        
        # 1. 获取特征重要性
        feature_importance_df = self.trainer.get_feature_importance_df(self.engineer.feature_names)
        feature_importance = {}
        if not feature_importance_df.empty:
            feature_importance = dict(zip(feature_importance_df["feature"], feature_importance_df["importance"]))
        
        # 2. 进化因子权重
        new_factor_weights = self.evolution.evolve_factor_weights(feature_importance)
        
        # 3. 进化模型权重
        model_performances = {}
        if self.trainer.training_history:
            latest_results = self.trainer.training_history[-1].get("results", {})
            for model_name, result in latest_results.items():
                if result.get("status") == "success":
                    model_performances[model_name] = result["metrics"].get("auc", 0.5)
        
        if model_performances:
            new_model_weights = self.evolution.evolve_model_weights(model_performances)
        
        # 4. 特征选择进化
        if not feature_importance_df.empty:
            selected_features = self.evolution.select_features(self.features, feature_importance_df)
        
        # 保存进化状态
        self.evolution.save_evolution_state()
        
        logger.info("进化优化完成")
        
        return {
            "status": "completed",
            "factor_weights": new_factor_weights,
            "evolution_count": self.evolution.evolution_count,
        }
    
    def run_backtest(self, window_days: int = 60) -> Dict:
        """
        运行回测
        
        Args:
            window_days: 回测窗口天数
            
        Returns:
            回测结果
        """
        logger.info(f"开始回测 (最近{window_days}天)...")
        
        if self.features.empty or len(self.features) < window_days:
            logger.error("数据不足，无法回测")
            return {}
        
        # 使用最近window_days的数据进行回测
        test_X = self.features.iloc[-window_days:]
        test_y = self.target.iloc[-window_days:]
        stock_df = self.raw_data.get("stock_daily", pd.DataFrame()).iloc[-window_days:]
        
        # 逐日预测
        predictions = []
        for i in range(len(test_X)):
            X_slice = self.features.iloc[:-(window_days-i)] if i < window_days else self.features
            if len(X_slice) < 10:
                continue
            pred = self.trainer.predict(X_slice)
            predictions.append(pred)
        
        if not predictions or stock_df.empty:
            logger.error("回测数据不足")
            return {}
        
        # 运行回测
        results = self.backtest.run_backtest(stock_df, predictions)
        
        logger.info("回测完成")
        return results
    
    def generate_report(self, backtest_results: Dict = None) -> str:
        """
        生成预测报告
        
        Args:
            backtest_results: 回测结果
            
        Returns:
            报告文件路径
        """
        logger.info("生成预测报告...")
        
        evolution_state = {
            "current_factor_weights": self.evolution.factor_weights,
            "performance_report": self.evolution.get_performance_report(),
        }
        
        feature_importance = self.trainer.get_feature_importance_df(self.engineer.feature_names)
        
        # 生成文本报告
        text_path = self.visualizer.save_text_report(
            self.symbol, self.stock_name, self.latest_prediction,
            backtest_results, evolution_state
        )
        
        # 生成可视化报告
        viz_path = self.visualizer.generate_full_report(
            self.symbol, self.stock_name, self.latest_prediction,
            backtest_results, evolution_state, feature_importance,
            self.raw_data.get("stock_daily")
        )
        
        # 生成预测摘要图
        summary_path = self.visualizer.plot_prediction_summary(
            self.latest_prediction, self.stock_name
        )
        
        logger.info(f"报告已生成:")
        logger.info(f"  文本报告: {text_path}")
        logger.info(f"  可视化报告: {viz_path}")
        logger.info(f"  摘要图: {summary_path}")
        
        return text_path
    
    def run_daily_pipeline(self, auto_train: bool = True, auto_evolve: bool = True) -> Dict:
        """
        运行每日完整流程
        
        Pipeline:
        1. 获取最新数据
        2. 构建特征
        3. (可选) 训练/滚动训练模型
        4. 预测明日涨跌
        5. (可选) 运行进化优化
        6. 生成报告
        
        Args:
            auto_train: 是否自动训练
            auto_evolve: 是否自动进化
            
        Returns:
            完整结果
        """
        logger.info("=" * 70)
        logger.info(f"开始每日预测流程: {self.stock_name} ({self.symbol})")
        logger.info("=" * 70)
        
        try:
            # Step 1: 获取数据
            self.fetch_data(days=252)
            
            # Step 2: 构建特征
            self.build_features()
            
            if self.features.empty:
                return {"error": "特征构建失败"}
            
            # Step 3: 训练模型
            if auto_train or not self.trainer.models:
                self.train_models(use_rolling=False)
            
            # Step 4: 预测
            prediction = self.predict()
            
            # Step 5: 回测
            backtest_results = self.run_backtest(window_days=60)
            
            # Step 6: 进化优化
            evolution_result = {}
            if auto_evolve:
                evolution_result = self.run_evolution()
            
            # Step 7: 生成报告
            report_path = self.generate_report(backtest_results)
            
            # 汇总结果
            result = {
                "status": "success",
                "symbol": self.symbol,
                "stock_name": self.stock_name,
                "prediction": prediction,
                "backtest": {
                    "total_return": backtest_results.get("total_return_pct", 0) if backtest_results else 0,
                    "sharpe_ratio": backtest_results.get("sharpe_ratio", 0) if backtest_results else 0,
                    "max_drawdown": backtest_results.get("max_drawdown_pct", 0) if backtest_results else 0,
                } if backtest_results else None,
                "evolution": evolution_result,
                "report_path": report_path,
                "timestamp": datetime.now().isoformat(),
            }
            
            logger.info("=" * 70)
            logger.info("每日预测流程完成")
            logger.info("=" * 70)
            
            return result
            
        except Exception as e:
            logger.error(f"每日流程执行失败: {str(e)}")
            logger.error(traceback.format_exc())
            return {
                "status": "error",
                "error": str(e),
                "traceback": traceback.format_exc(),
            }
    
    def print_prediction_summary(self):
        """打印预测摘要"""
        pred = self.latest_prediction
        if not pred or "error" in pred:
            print("暂无预测结果")
            return
        
        print("\n" + "=" * 60)
        print(f"  {self.stock_name} ({self.symbol}) - 明日涨跌预测")
        print("=" * 60)
        print(f"  预测结果: {'涨' if pred.get('prediction') == 1 else '跌'}")
        print(f"  上涨概率: {pred.get('up_probability', 0)*100:.2f}%")
        print(f"  下跌概率: {pred.get('down_probability', 0)*100:.2f}%")
        print(f"  预测置信度: {pred.get('confidence', 0)*100:.2f}%")
        print("")
        print("  各模型预测:")
        individual = pred.get("individual_predictions", {})
        for model_name, model_pred in individual.items():
            weight = pred.get("model_weights", {}).get(model_name, 0)
            print(f"    {model_name:15s}: {'涨' if model_pred == 1 else '跌'} (权重: {weight:.2f})")
        print("=" * 60)


# ==================== 快捷函数 ====================

def predict_stock(symbol: str, stock_name: str = None, auto_train: bool = True) -> Dict:
    """
    快捷预测函数 - 预测单股明日涨跌
    
    Usage:
        result = predict_stock("600519", "贵州茅台")
        print(result["prediction"])
    
    Args:
        symbol: 股票代码
        stock_name: 股票名称 (可选)
        auto_train: 是否自动训练
        
    Returns:
        预测结果字典
    """
    engine = StockPredictionEngine(symbol=symbol, stock_name=stock_name)
    result = engine.run_daily_pipeline(auto_train=auto_train, auto_evolve=True)
    engine.print_prediction_summary()
    return result


def train_and_save(symbol: str, stock_name: str = None, days: int = 500):
    """
    训练模型并保存（按股票代码隔离）
    
    Args:
        symbol: 股票代码
        stock_name: 股票名称
        days: 训练数据天数
    """
    engine = StockPredictionEngine(symbol=symbol, stock_name=stock_name or symbol)
    engine.fetch_data(days=days)
    engine.build_features()
    engine.train_models(use_rolling=True)
    print(f"模型已训练并保存: {symbol} -> {engine.symbol_model_dir}")


# ==================== 主入口 ====================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="A股个股涨跌预测引擎")
    parser.add_argument("--symbol", type=str, default=DEMO_STOCK["code"], 
                       help="股票代码 (如 600519)")
    parser.add_argument("--name", type=str, default=DEMO_STOCK["name"],
                       help="股票名称")
    parser.add_argument("--train", action="store_true", 
                       help="仅训练模型")
    parser.add_argument("--predict", action="store_true", 
                       help="仅预测 (不训练)")
    parser.add_argument("--days", type=int, default=252,
                       help="历史数据天数")
    
    args = parser.parse_args()
    
    if args.train:
        # 仅训练
        train_and_save(args.symbol, args.days)
    elif args.predict:
        # 仅预测
        result = predict_stock(args.symbol, args.name, auto_train=False)
    else:
        # 完整流程
        result = predict_stock(args.symbol, args.name, auto_train=True)
        print(f"\n完整结果:\n{result}")
