# -*- coding: utf-8 -*-
"""
可视化模块 - 生成预测报告和图表
支持文本报告、图表可视化
"""

import pandas as pd
import numpy as np
import logging
import os
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# 尝试导入matplotlib，如果不存在则使用文本报告
try:
    import matplotlib
    matplotlib.use('Agg')  # 非交互式后端
    import matplotlib.pyplot as plt
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    logger.warning("matplotlib不可用，将只生成文本报告")


class Visualizer:
    """
    预测结果可视化器
    
    生成内容:
    - 文本预测报告
    - 回测收益曲线
    - 特征重要性图
    - 预测准确率趋势
    """
    
    def __init__(self):
        self.reports_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
        os.makedirs(self.reports_dir, exist_ok=True)
        logger.info("Visualizer初始化完成")
    
    def save_text_report(self, symbol: str, stock_name: str,
                         prediction: Dict, backtest: Dict,
                         evolution_state: Dict, filepath: str = None) -> str:
        """
        保存文本预测报告
        
        Args:
            symbol: 股票代码
            stock_name: 股票名称
            prediction: 预测结果
            backtest: 回测结果
            evolution_state: 进化状态
            filepath: 报告路径
            
        Returns:
            报告文件路径
        """
        if filepath is None:
            filepath = os.path.join(self.reports_dir, 
                f"report_{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
        
        lines = []
        lines.append("=" * 70)
        lines.append(f"  股票涨跌预测报告 - {stock_name} ({symbol})")
        lines.append(f"  生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append("=" * 70)
        lines.append("")
        
        # 预测结果
        if prediction and "error" not in prediction:
            lines.append("【预测结果】")
            lines.append(f"  明日预测: {'上涨' if prediction.get('prediction') == 1 else '下跌'}")
            lines.append(f"  上涨概率: {prediction.get('up_probability', 0)*100:.2f}%")
            lines.append(f"  下跌概率: {prediction.get('down_probability', 0)*100:.2f}%")
            lines.append(f"  置信度: {prediction.get('confidence', 0)*100:.2f}%")
            lines.append("")
            
            # 各模型预测
            individual = prediction.get("individual_predictions", {})
            weights = prediction.get("model_weights", {})
            lines.append("【模型投票】")
            for model_name, pred in individual.items():
                w = weights.get(model_name, 0)
                lines.append(f"  {model_name:20s}: {'涨' if pred == 1 else '跌'} (权重: {w:.2f})")
            lines.append("")
        
        # 回测结果
        if backtest:
            lines.append("【回测表现】")
            lines.append(f"  策略总收益: {backtest.get('total_return_pct', 0):.2f}%")
            lines.append(f"  买入持有收益: {backtest.get('buy_hold_return_pct', 0):.2f}%")
            lines.append(f"  超额收益: {backtest.get('excess_return_pct', 0):.2f}%")
            lines.append(f"  夏普比率: {backtest.get('sharpe_ratio', 0):.4f}")
            lines.append(f"  最大回撤: {backtest.get('max_drawdown_pct', 0):.2f}%")
            lines.append(f"  预测准确率: {backtest.get('prediction_accuracy', 0)*100:.2f}%")
            lines.append(f"  交易次数: {backtest.get('trade_count', 0)}")
            lines.append("")
        
        # 进化状态
        if evolution_state:
            lines.append("【因子权重】")
            factor_weights = evolution_state.get("current_factor_weights", {})
            for cat, w in factor_weights.items():
                lines.append(f"  {cat:25s}: {w:.4f}")
            lines.append("")
            
            perf = evolution_state.get("performance_report", {})
            if perf:
                lines.append("【进化性能】")
                lines.append(f"  总预测次数: {perf.get('total_predictions', 0)}")
                lines.append(f"  已验证次数: {perf.get('verified_predictions', 0)}")
                lines.append(f"  总体准确率: {perf.get('overall_accuracy', 0)*100:.2f}%")
                lines.append(f"  进化次数: {perf.get('evolution_count', 0)}")
                lines.append("")
        
        lines.append("=" * 70)
        lines.append("  免责声明: 本报告仅供研究参考，不构成投资建议")
        lines.append("=" * 70)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines))
        
        logger.info(f"文本报告已保存: {filepath}")
        return filepath
    
    def generate_full_report(self, symbol: str, stock_name: str,
                             prediction: Dict, backtest: Dict,
                             evolution_state: Dict,
                             feature_importance: pd.DataFrame,
                             stock_df: pd.DataFrame = None,
                             filepath: str = None) -> str:
        """
        生成完整可视化报告
        
        Args:
            symbol: 股票代码
            stock_name: 股票名称
            prediction: 预测结果
            backtest: 回测结果
            evolution_state: 进化状态
            feature_importance: 特征重要性
            stock_df: 股票数据
            filepath: 保存路径
            
        Returns:
            报告文件路径
        """
        if not MATPLOTLIB_AVAILABLE:
            return self.save_text_report(symbol, stock_name, prediction, backtest, evolution_state)
        
        if filepath is None:
            filepath = os.path.join(self.reports_dir,
                f"report_viz_{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
        
        try:
            fig = plt.figure(figsize=(16, 12))
            
            # 子图1: 价格走势 + 预测点
            if stock_df is not None and not stock_df.empty:
                ax1 = plt.subplot(2, 2, 1)
                dates = stock_df["日期"].values if "日期" in stock_df.columns else range(len(stock_df))
                prices = stock_df["收盘"].values
                ax1.plot(dates[-60:], prices[-60:], label="收盘价", color='blue')
                ax1.set_title(f"{stock_name} 近期走势")
                ax1.set_xlabel("日期")
                ax1.set_ylabel("价格")
                ax1.legend()
                ax1.tick_params(axis='x', rotation=45)
            
            # 子图2: 特征重要性Top15
            if not feature_importance.empty:
                ax2 = plt.subplot(2, 2, 2)
                top_features = feature_importance.head(15).sort_values("importance")
                ax2.barh(top_features["feature"], top_features["importance"], color='green')
                ax2.set_title("Top 15 重要特征")
                ax2.set_xlabel("重要性")
            
            # 子图3: 回测收益曲线
            if backtest and "daily_values" in backtest:
                ax3 = plt.subplot(2, 2, 3)
                daily_values = backtest["daily_values"]
                values = [d["value"] for d in daily_values]
                ax3.plot(values, label="策略净值", color='purple')
                ax3.axhline(y=backtest.get("initial_capital", 100000), color='gray', linestyle='--', label="初始资金")
                ax3.set_title("回测收益曲线")
                ax3.set_xlabel("交易日")
                ax3.set_ylabel("资金")
                ax3.legend()
            
            # 子图4: 因子权重饼图
            if evolution_state and "current_factor_weights" in evolution_state:
                ax4 = plt.subplot(2, 2, 4)
                weights = evolution_state["current_factor_weights"]
                labels = list(weights.keys())
                sizes = list(weights.values())
                ax4.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90)
                ax4.set_title("因子权重分布")
            
            plt.tight_layout()
            plt.savefig(filepath, dpi=150, bbox_inches='tight')
            plt.close(fig)
            
            logger.info(f"可视化报告已保存: {filepath}")
            return filepath
        
        except Exception as e:
            logger.error(f"生成可视化报告失败: {e}")
            return self.save_text_report(symbol, stock_name, prediction, backtest, evolution_state)
    
    def plot_prediction_summary(self, prediction: Dict, stock_name: str,
                                filepath: str = None) -> str:
        """
        生成预测摘要图
        
        Args:
            prediction: 预测结果
            stock_name: 股票名称
            filepath: 保存路径
            
        Returns:
            文件路径
        """
        if not MATPLOTLIB_AVAILABLE:
            return ""
        
        if filepath is None:
            filepath = os.path.join(self.reports_dir,
                f"summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
        
        try:
            fig, ax = plt.subplots(figsize=(8, 6))
            
            up_prob = prediction.get("up_probability", 0.5)
            down_prob = prediction.get("down_probability", 0.5)
            confidence = prediction.get("confidence", 0.5)
            
            colors = ['#ff4444' if up_prob > 0.5 else '#44ff44', '#cccccc']
            labels = [f"上涨 {up_prob*100:.1f}%", f"下跌 {down_prob*100:.1f}%"]
            sizes = [up_prob, down_prob]
            
            wedges, texts, autotexts = ax.pie(sizes, labels=labels, colors=colors,
                                               autopct='', startangle=90,
                                               wedgeprops=dict(width=0.5))
            
            ax.set_title(f"{stock_name} 明日预测\n置信度: {confidence*100:.1f}%")
            
            plt.tight_layout()
            plt.savefig(filepath, dpi=120, bbox_inches='tight')
            plt.close(fig)
            
            return filepath
        except Exception as e:
            logger.error(f"生成摘要图失败: {e}")
            return ""
