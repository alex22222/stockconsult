# -*- coding: utf-8 -*-
"""
回测评估模块 - 模拟实盘验证预测效果
支持多种评估维度和风险指标计算
"""

import pandas as pd
import numpy as np
import logging
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class BacktestEvaluator:
    """
    回测评估器
    
    评估维度:
    - 预测准确率 (整体、上涨、下跌)
    - 策略收益率 (按预测信号模拟交易)
    - 风险指标 (夏普比率、最大回撤、波动率)
    - 置信度校准度
    - 与基准的对比
    """
    
    def __init__(self):
        self.results_history = []
        logger.info("BacktestEvaluator初始化完成")
    
    def run_backtest(self, stock_df: pd.DataFrame, predictions: List[Dict],
                     initial_capital: float = 100000,
                     commission_rate: float = 0.001,
                     use_confidence_threshold: bool = True,
                     confidence_threshold: float = 0.6) -> Dict:
        """
        运行回测
        
        回测逻辑:
        - 预测上涨 -> 买入/持有
        - 预测下跌 -> 卖出/空仓
        - 可设置置信度阈值，低置信度时不操作
        
        Args:
            stock_df: 股票日线数据
            predictions: 预测结果列表
            initial_capital: 初始资金
            commission_rate: 手续费率
            use_confidence_threshold: 是否使用置信度阈值
            confidence_threshold: 置信度阈值
            
        Returns:
            回测结果字典
        """
        if stock_df.empty or not predictions:
            return {"error": "数据不足"}
        
        close_prices = stock_df["收盘"].values
        dates = stock_df["日期"].values if "日期" in stock_df.columns else list(range(len(stock_df)))
        
        n = min(len(close_prices) - 1, len(predictions))
        
        capital = initial_capital
        position = 0  # 持仓股数
        trades = []
        daily_values = []
        
        for i in range(n):
            current_price = close_prices[i]
            next_price = close_prices[i + 1] if i + 1 < len(close_prices) else current_price
            pred = predictions[i]
            
            # 解析预测结果
            prediction = pred.get("prediction", 0)
            confidence = pred.get("confidence", 0.5)
            
            # 当前持仓市值
            current_value = capital + position * current_price
            daily_values.append({
                "date": dates[i],
                "value": current_value,
                "price": current_price,
                "prediction": prediction,
                "confidence": confidence,
            })
            
            # 决策
            should_trade = True
            if use_confidence_threshold and confidence < confidence_threshold:
                should_trade = False  # 低置信度，不操作
            
            if should_trade:
                if prediction == 1 and position == 0:
                    # 预测上涨，买入
                    buy_amount = capital * 0.95  # 留5%现金
                    shares = int(buy_amount / current_price)
                    if shares > 0:
                        cost = shares * current_price * (1 + commission_rate)
                        if cost <= capital:
                            capital -= cost
                            position += shares
                            trades.append({
                                "type": "buy",
                                "date": dates[i],
                                "price": current_price,
                                "shares": shares,
                                "cost": cost,
                            })
                
                elif prediction == 0 and position > 0:
                    # 预测下跌，卖出
                    sell_value = position * current_price * (1 - commission_rate)
                    capital += sell_value
                    trades.append({
                        "type": "sell",
                        "date": dates[i],
                        "price": current_price,
                        "shares": position,
                        "value": sell_value,
                    })
                    position = 0
        
        # 最终市值
        final_price = close_prices[-1]
        final_value = capital + position * final_price
        
        # 计算收益率
        total_return = (final_value - initial_capital) / initial_capital
        
        # 买入持有策略对比
        buy_hold_return = (final_price - close_prices[0]) / close_prices[0]
        
        # 计算每日收益率序列
        values = [d["value"] for d in daily_values]
        returns = []
        for i in range(1, len(values)):
            if values[i-1] > 0:
                returns.append((values[i] - values[i-1]) / values[i-1])
        
        # 风险指标
        risk_metrics = self._calc_risk_metrics(returns)
        
        # 预测准确率统计
        pred_stats = self._calc_prediction_stats(predictions[:n], close_prices[:n+1])
        
        result = {
            "initial_capital": initial_capital,
            "final_value": final_value,
            "total_return_pct": total_return * 100,
            "buy_hold_return_pct": buy_hold_return * 100,
            "excess_return_pct": (total_return - buy_hold_return) * 100,
            "trade_count": len(trades),
            "win_rate": risk_metrics.get("win_rate", 0),
            "sharpe_ratio": risk_metrics.get("sharpe_ratio", 0),
            "max_drawdown_pct": risk_metrics.get("max_drawdown", 0) * 100,
            "volatility_annual": risk_metrics.get("volatility", 0) * 100,
            "prediction_accuracy": pred_stats.get("accuracy", 0),
            "up_prediction_accuracy": pred_stats.get("up_accuracy", 0),
            "down_prediction_accuracy": pred_stats.get("down_accuracy", 0),
            "confidence_calibration": pred_stats.get("calibration", {}),
            "daily_values": daily_values,
            "trades": trades,
        }
        
        self.results_history.append(result)
        
        logger.info(f"回测完成: 总收益={total_return*100:.2f}%, 夏普={risk_metrics.get('sharpe_ratio', 0):.4f}")
        
        return result
    
    def _calc_risk_metrics(self, returns: List[float]) -> Dict:
        """计算风险指标"""
        if not returns:
            return {
                "sharpe_ratio": 0,
                "max_drawdown": 0,
                "volatility": 0,
                "win_rate": 0,
            }
        
        returns = np.array(returns)
        
        # 夏普比率 (假设无风险利率为2%)
        rf_daily = 0.02 / 252
        excess_returns = returns - rf_daily
        if len(excess_returns) > 1 and excess_returns.std() > 0:
            sharpe = np.sqrt(252) * excess_returns.mean() / excess_returns.std()
        else:
            sharpe = 0
        
        # 最大回撤
        cumulative = np.cumprod(1 + returns)
        peak = np.maximum.accumulate(cumulative)
        drawdown = (cumulative - peak) / peak
        max_drawdown = drawdown.min() if len(drawdown) > 0 else 0
        
        # 年化波动率
        volatility = returns.std() * np.sqrt(252) if len(returns) > 1 else 0
        
        # 胜率
        win_rate = (returns > 0).mean() if len(returns) > 0 else 0
        
        return {
            "sharpe_ratio": sharpe,
            "max_drawdown": max_drawdown,
            "volatility": volatility,
            "win_rate": win_rate,
        }
    
    def _calc_prediction_stats(self, predictions: List[Dict], prices: np.ndarray) -> Dict:
        """计算预测统计"""
        n = min(len(predictions), len(prices) - 1)
        
        correct = 0
        up_correct = 0
        up_total = 0
        down_correct = 0
        down_total = 0
        
        confidence_buckets = {}
        
        for i in range(n):
            pred = predictions[i]
            prediction = pred.get("prediction", 0)
            confidence = pred.get("confidence", 0.5)
            
            actual = 1 if prices[i + 1] > prices[i] else 0
            
            is_correct = prediction == actual
            if is_correct:
                correct += 1
            
            if prediction == 1:
                up_total += 1
                if is_correct:
                    up_correct += 1
            else:
                down_total += 1
                if is_correct:
                    down_correct += 1
            
            # 置信度校准
            bucket = round(confidence, 1)
            if bucket not in confidence_buckets:
                confidence_buckets[bucket] = {"total": 0, "correct": 0}
            confidence_buckets[bucket]["total"] += 1
            if is_correct:
                confidence_buckets[bucket]["correct"] += 1
        
        total = n
        accuracy = correct / total if total > 0 else 0
        up_accuracy = up_correct / up_total if up_total > 0 else 0
        down_accuracy = down_correct / down_total if down_total > 0 else 0
        
        calibration = {}
        for bucket, stats in sorted(confidence_buckets.items()):
            if stats["total"] >= 3:
                calibration[str(bucket)] = {
                    "predicted_confidence": bucket,
                    "actual_accuracy": stats["correct"] / stats["total"],
                    "count": stats["total"],
                }
        
        return {
            "accuracy": accuracy,
            "up_accuracy": up_accuracy,
            "down_accuracy": down_accuracy,
            "total": total,
            "calibration": calibration,
        }
    
    def compare_strategies(self, results_list: List[Dict]) -> pd.DataFrame:
        """
        比较多个策略的回测结果
        
        Args:
            results_list: 多个回测结果
            
        Returns:
            对比DataFrame
        """
        comparison = []
        for i, result in enumerate(results_list):
            comparison.append({
                "strategy": f"Strategy_{i+1}",
                "total_return_pct": result.get("total_return_pct", 0),
                "sharpe_ratio": result.get("sharpe_ratio", 0),
                "max_drawdown_pct": result.get("max_drawdown_pct", 0),
                "prediction_accuracy": result.get("prediction_accuracy", 0),
                "trade_count": result.get("trade_count", 0),
            })
        
        return pd.DataFrame(comparison)
