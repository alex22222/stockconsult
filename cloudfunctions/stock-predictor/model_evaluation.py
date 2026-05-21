# -*- coding: utf-8 -*-
"""
模型合理性科学评估体系
======================

评估目标: 验证露笑科技预测模型的真实预测能力，而非伪相关或数据泄露。

评估维度:
1. 统计显著性检验 (二项检验、置换检验)
2. 基准对比评估 (随机基准、买入持有、简单规则)
3. 置信度校准评估 (可靠性图、Brier分数)
4. 过拟合检测 (样本内vs样本外差距)
5. 经济意义评估 (策略收益、风险调整后收益)
6. 模型稳定性评估 (时间稳定性、参数稳定性)
7. 特征合理性检验 (特征重要性一致性)

核心原则:
- 准确率必须统计显著高于50% (p < 0.05)
- 样本外表现必须接近样本内表现 (差距 < 5%)
- 策略收益必须覆盖交易成本
- 模型必须在不同市场环境下稳定
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging
from scipy import stats

logger = logging.getLogger(__name__)


class ModelEvaluator:
    """
    模型合理性科学评估器
    
    对预测模型进行全方位的科学性评估，防止过拟合、伪相关、数据泄露等问题。
    """
    
    def __init__(self):
        self.evaluation_history = []
        logger.info("ModelEvaluator初始化完成")
    
    # ==================== 1. 统计显著性检验 ====================
    
    def binomial_test(self, correct: int, total: int, p_null: float = 0.5) -> Dict:
        """
        二项检验 - 验证准确率是否显著高于随机水平
        
        H0: 准确率 = 0.5 (随机猜测)
        H1: 准确率 > 0.5 (有预测能力)
        
        Args:
            correct: 正确预测次数
            total: 总预测次数
            p_null: 零假设概率
            
        Returns:
            检验结果
        """
        if total == 0:
            return {"significant": False, "p_value": 1.0, "power": 0}
        
        # 二项检验 (scipy >= 1.10 使用 binomtest)
        binom_res = stats.binomtest(correct, total, p_null, alternative='greater')
        p_value = binom_res.pvalue
        
        # 统计功效 (power)
        observed_rate = correct / total
        effect_size = abs(observed_rate - p_null)
        
        # Wilson 置信区间 (手动实现，兼容新版 scipy)
        def wilson_ci(k, n, alpha=0.05):
            if n == 0:
                return 0.0, 1.0
            p_hat = k / n
            z = stats.norm.ppf(1 - alpha / 2)
            denom = 1 + z * z / n
            center = (p_hat + z * z / (2 * n)) / denom
            margin = z * np.sqrt(p_hat * (1 - p_hat) / n + z * z / (4 * n * n)) / denom
            return max(0.0, center - margin), min(1.0, center + margin)
        
        ci_low, ci_high = wilson_ci(correct, total)
        
        return {
            "test": "binomial",
            "correct": correct,
            "total": total,
            "accuracy": observed_rate,
            "p_value": p_value,
            "significant": p_value < 0.05,
            "confidence_level": 0.95,
            "ci_lower": ci_low,
            "ci_upper": ci_high,
            "effect_size": effect_size,
            "min_significant_correct": int(np.ceil(stats.binom.ppf(0.95, total, p_null))),
        }
    
    def permutation_test(self, y_true: np.ndarray, y_prob: np.ndarray,
                         n_permutations: int = 1000, metric: str = "auc") -> Dict:
        """
        置换检验 - 验证模型表现是否显著优于随机排列
        
        原理: 打乱标签后重新计算指标，看真实指标是否在置换分布的极端位置
        
        Args:
            y_true: 真实标签
            y_prob: 预测概率
            n_permutations: 置换次数
            metric: 评估指标
            
        Returns:
            检验结果
        """
        from sklearn.metrics import roc_auc_score, accuracy_score
        
        # 计算真实指标
        y_pred = (y_prob > 0.5).astype(int)
        
        if metric == "auc":
            if len(np.unique(y_true)) < 2:
                return {"significant": False, "p_value": 1.0}
            true_metric = roc_auc_score(y_true, y_prob)
        else:
            true_metric = accuracy_score(y_true, y_pred)
        
        # 置换检验
        permuted_metrics = []
        for _ in range(n_permutations):
            y_shuffled = np.random.permutation(y_true)
            if metric == "auc" and len(np.unique(y_shuffled)) > 1:
                perm_metric = roc_auc_score(y_shuffled, y_prob)
            else:
                perm_metric = accuracy_score(y_shuffled, (y_prob > 0.5).astype(int))
            permuted_metrics.append(perm_metric)
        
        permuted_metrics = np.array(permuted_metrics)
        
        # p值 = 置换分布中 >= 真实指标的比例
        p_value = np.mean(permuted_metrics >= true_metric)
        
        return {
            "test": "permutation",
            "metric": metric,
            "true_metric": true_metric,
            "p_value": p_value,
            "significant": p_value < 0.05,
            "n_permutations": n_permutations,
            "permuted_mean": permuted_metrics.mean(),
            "permuted_std": permuted_metrics.std(),
            "permuted_95th": np.percentile(permuted_metrics, 95),
        }
    
    def runs_test(self, predictions: np.ndarray, actuals: np.ndarray) -> Dict:
        """
        游程检验 - 验证预测错误是否随机分布 (检测模式失效)
        
        如果模型在某些时期系统性失效，错误会集中出现。
        
        Args:
            predictions: 预测标签
            actuals: 真实标签
            
        Returns:
            检验结果
        """
        # 0 = 错误, 1 = 正确
        correct_mask = (predictions == actuals).astype(int)
        
        n = len(correct_mask)
        n1 = correct_mask.sum()  # 正确数
        n0 = n - n1  # 错误数
        
        if n1 == 0 or n0 == 0:
            return {"significant": False, "message": "全部正确或全部错误"}
        
        # 计算游程数
        runs = 1
        for i in range(1, n):
            if correct_mask[i] != correct_mask[i-1]:
                runs += 1
        
        # 期望游程数
        expected_runs = (2 * n0 * n1) / n + 1
        var_runs = (2 * n0 * n1 * (2 * n0 * n1 - n)) / (n**2 * (n - 1))
        
        if var_runs <= 0:
            return {"significant": False, "message": "方差为0"}
        
        # Z统计量
        z = (runs - expected_runs) / np.sqrt(var_runs)
        p_value = 2 * (1 - stats.norm.cdf(abs(z)))
        
        return {
            "test": "runs",
            "runs": runs,
            "expected_runs": expected_runs,
            "z_score": z,
            "p_value": p_value,
            "significant": p_value < 0.05,
            "interpretation": "错误聚集" if runs < expected_runs else "错误分散",
        }
    
    # ==================== 2. 基准对比评估 ====================
    
    def benchmark_comparison(self, returns_strategy: List[float],
                             returns_buyhold: List[float],
                             predictions: List[int],
                             actuals: List[int]) -> Dict:
        """
        多基准对比评估
        
        对比基准:
        1. 随机策略: 随机做多/空仓
        2. 买入持有: 一直持有
        3. 趋势跟随: 基于简单均线规则
        4. 反向策略: 与预测相反操作
        
        Args:
            returns_strategy: 策略日收益率
            returns_buyhold: 买入持有日收益率
            predictions: 预测标签
            actuals: 真实标签
            
        Returns:
            对比结果
        """
        # 对齐长度
        n = min(len(returns_buyhold), len(predictions))
        returns_buyhold = returns_buyhold[:n]
        returns_strategy = returns_strategy[:n]
        predictions = predictions[:n]
        
        # 1. 随机策略 (模拟100次)
        random_returns = []
        for _ in range(100):
            random_signals = np.random.choice([0, 1], size=n)
            rand_ret = []
            for j, signal in enumerate(random_signals):
                if signal == 1:
                    rand_ret.append(returns_buyhold[j])
                else:
                    rand_ret.append(0)
            random_returns.append(np.sum(rand_ret))
        
        random_mean = np.mean(random_returns)
        random_std = np.std(random_returns)
        
        # 2. 买入持有
        total_buyhold = np.sum(returns_buyhold)
        
        # 3. 策略收益
        total_strategy = np.sum(returns_strategy)
        
        # 4. 反向策略
        reverse_signals = [1 - p for p in predictions]
        reverse_returns = []
        for j, signal in enumerate(reverse_signals):
            if signal == 1:
                reverse_returns.append(returns_buyhold[j])
            else:
                reverse_returns.append(0)
        total_reverse = np.sum(reverse_returns)
        
        # 5. 简单均线策略 (5日均线上穿20日均线做多)
        # 这里用简化版: 昨日涨则今日做多
        momentum_signals = [1 if i > 0 and returns_buyhold[i-1] > 0 else 0 
                           for i in range(n)]
        momentum_signals[0] = 1
        momentum_returns = []
        for j, signal in enumerate(momentum_signals):
            if signal == 1:
                momentum_returns.append(returns_buyhold[j])
            else:
                momentum_returns.append(0)
        total_momentum = np.sum(momentum_returns)
        
        return {
            "strategy_return": total_strategy,
            "buyhold_return": total_buyhold,
            "random_mean_return": random_mean,
            "random_std": random_std,
            "reverse_return": total_reverse,
            "momentum_return": total_momentum,
            "beats_random": total_strategy > random_mean + 2 * random_std,
            "beats_buyhold": total_strategy > total_buyhold,
            "beats_momentum": total_strategy > total_momentum,
            "reverse_better": total_reverse > total_strategy,  # 反向更好说明有问题
        }
    
    # ==================== 3. 置信度校准评估 ====================
    
    def calibration_analysis(self, y_true: np.ndarray, y_prob: np.ndarray,
                             n_bins: int = 10) -> Dict:
        """
        置信度校准分析
        
        理想情况下:
        - 预测概率70%的样本中，应该有70%实际为上涨
        - 可靠性图应该接近对角线
        
        Args:
            y_true: 真实标签
            y_prob: 预测上涨概率
            n_bins: 分箱数
            
        Returns:
            校准分析结果
        """
        bin_boundaries = np.linspace(0, 1, n_bins + 1)
        bin_lowers = bin_boundaries[:-1]
        bin_uppers = bin_boundaries[1:]
        
        bin_accuracies = []
        bin_confidences = []
        bin_counts = []
        
        for lower, upper in zip(bin_lowers, bin_uppers):
            mask = (y_prob > lower) & (y_prob <= upper)
            if mask.sum() == 0:
                continue
            
            bin_acc = y_true[mask].mean()
            bin_conf = y_prob[mask].mean()
            
            bin_accuracies.append(bin_acc)
            bin_confidences.append(bin_conf)
            bin_counts.append(mask.sum())
        
        # ECE (Expected Calibration Error)
        ece = 0
        total_samples = sum(bin_counts)
        for acc, conf, count in zip(bin_accuracies, bin_confidences, bin_counts):
            ece += (count / total_samples) * abs(acc - conf)
        
        # Brier Score
        brier = np.mean((y_prob - y_true) ** 2)
        
        # Brier 分解
        # BS = Reliability - Resolution + Uncertainty
        overall_prob = y_true.mean()
        uncertainty = overall_prob * (1 - overall_prob)
        
        reliability = 0
        resolution = 0
        for acc, conf, count in zip(bin_accuracies, bin_confidences, bin_counts):
            reliability += (count / total_samples) * (acc - conf) ** 2
            resolution += (count / total_samples) * (acc - overall_prob) ** 2
        
        return {
            "ece": ece,
            "brier_score": brier,
            "uncertainty": uncertainty,
            "reliability": reliability,
            "resolution": resolution,
            "bin_accuracies": bin_accuracies,
            "bin_confidences": bin_confidences,
            "bin_counts": bin_counts,
            "well_calibrated": ece < 0.1,
            "interpretation": "校准良好" if ece < 0.05 else "中等校准" if ece < 0.1 else "校准差",
        }
    
    # ==================== 4. 过拟合检测 ====================
    
    def overfitting_detection(self, metrics_insample: Dict,
                              metrics_outsample: Dict,
                              threshold: float = 0.05) -> Dict:
        """
        过拟合检测
        
        检测指标:
        - 样本内vs样本外AUC差距
        - 样本内vs样本外准确率差距
        
        Args:
            metrics_insample: 样本内指标
            metrics_outsample: 样本外指标
            threshold: 差距阈值
            
        Returns:
            检测结果
        """
        gaps = {}
        warnings = []
        
        for metric in ["auc", "accuracy", "f1"]:
            in_val = metrics_insample.get(metric, 0)
            out_val = metrics_outsample.get(metric, 0)
            gap = in_val - out_val
            gaps[metric] = {
                "insample": in_val,
                "outsample": out_val,
                "gap": gap,
                "gap_pct": gap / in_val if in_val > 0 else 0,
                "overfit": gap > threshold,
            }
            if gap > threshold:
                warnings.append(f"{metric}: 样本内{in_val:.4f} vs 样本外{out_val:.4f}, 差距{gap:.4f}")
        
        return {
            "gaps": gaps,
            "overfit_detected": len(warnings) > 0,
            "warnings": warnings,
            "severity": "high" if any(g["gap"] > 0.1 for g in gaps.values()) else 
                       "medium" if len(warnings) > 0 else "low",
        }
    
    # ==================== 5. 经济意义评估 ====================
    
    def economic_significance(self, strategy_returns: List[float],
                              buyhold_returns: List[float],
                              transaction_cost: float = 0.001) -> Dict:
        """
        经济意义评估
        
        评估策略的实际可交易性:
        1. 扣除交易成本后的净收益
        2. 信息比率
        3. 盈亏比
        4. 平均持仓时间
        
        Args:
            strategy_returns: 策略收益率序列
            buyhold_returns: 买入持有收益率序列
            transaction_cost: 单次交易成本
            
        Returns:
            经济评估结果
        """
        strategy_returns = np.array(strategy_returns)
        buyhold_returns = np.array(buyhold_returns)
        
        # 总收益
        gross_return = np.prod(1 + strategy_returns) - 1
        
        # 估计交易次数 (假设每次信号变化都交易)
        # 简化: 假设大约每天有一定概率交易
        estimated_trades = len(strategy_returns) * 0.3  # 假设30%的天数有交易
        total_cost = estimated_trades * transaction_cost
        
        net_return = gross_return - total_cost
        
        # 风险调整收益
        strategy_vol = strategy_returns.std() * np.sqrt(252)
        buyhold_vol = buyhold_returns.std() * np.sqrt(252)
        
        # 信息比率 (相对于买入持有)
        excess_return = strategy_returns.mean() - buyhold_returns.mean()
        tracking_error = (strategy_returns - buyhold_returns).std()
        info_ratio = excess_return / tracking_error if tracking_error > 0 else 0
        
        # 盈亏比
        gains = strategy_returns[strategy_returns > 0]
        losses = strategy_returns[strategy_returns < 0]
        profit_factor = abs(gains.sum() / losses.sum()) if losses.sum() != 0 else float('inf')
        
        return {
            "gross_return": gross_return,
            "estimated_costs": total_cost,
            "net_return": net_return,
            "profitable_after_costs": net_return > 0,
            "annualized_volatility": strategy_vol,
            "information_ratio": info_ratio,
            "profit_factor": profit_factor,
            "sharpe_approx": (strategy_returns.mean() * 252) / (strategy_returns.std() * np.sqrt(252)) 
                            if strategy_returns.std() > 0 else 0,
            "economically_meaningful": net_return > 0 and info_ratio > 0.3,
        }
    
    # ==================== 6. 模型稳定性评估 ====================
    
    def stability_analysis(self, rolling_metrics: List[Dict],
                           metric_name: str = "auc") -> Dict:
        """
        模型稳定性分析
        
        评估模型在不同时间段的表现一致性
        
        Args:
            rolling_metrics: 滚动窗口指标列表
            metric_name: 要分析的指标
            
        Returns:
            稳定性分析结果
        """
        values = [m.get(metric_name, 0) for m in rolling_metrics if metric_name in m]
        
        if len(values) < 3:
            return {"stable": False, "reason": "数据不足"}
        
        values = np.array(values)
        
        # 基本统计
        mean_val = values.mean()
        std_val = values.std()
        cv = std_val / mean_val if mean_val > 0 else float('inf')  # 变异系数
        
        # 趋势检测 (线性回归)
        x = np.arange(len(values))
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, values)
        
        # 检测是否有显著下降趋势
        deteriorating = slope < 0 and p_value < 0.1
        
        # 最小值检查
        min_val = values.min()
        
        return {
            "metric": metric_name,
            "mean": mean_val,
            "std": std_val,
            "cv": cv,
            "min": min_val,
            "max": values.max(),
            "trend_slope": slope,
            "trend_pvalue": p_value,
            "deteriorating": deteriorating,
            "stable": cv < 0.15 and not deteriorating and min_val > 0.5,
            "stability_score": max(0, 1 - cv) * (1 if not deteriorating else 0.5),
        }
    
    # ==================== 7. 综合评估报告 ====================
    
    def comprehensive_evaluation(self,
                                  y_true: np.ndarray,
                                  y_prob: np.ndarray,
                                  y_pred: np.ndarray,
                                  predictions_history: List[Dict] = None,
                                  strategy_returns: List[float] = None,
                                  buyhold_returns: List[float] = None,
                                  rolling_metrics: List[Dict] = None,
                                  metrics_insample: Dict = None,
                                  metrics_outsample: Dict = None) -> Dict:
        """
        综合评估 - 生成模型合理性完整报告
        
        这是一个一站式评估函数，调用上述所有评估方法。
        
        Args:
            y_true: 真实标签
            y_prob: 预测概率
            y_pred: 预测标签
            predictions_history: 预测历史
            strategy_returns: 策略收益率
            buyhold_returns: 买入持有收益率
            rolling_metrics: 滚动指标
            metrics_insample: 样本内指标
            metrics_outsample: 样本外指标
            
        Returns:
            综合评估报告
        """
        report = {
            "evaluation_time": datetime.now().isoformat(),
            "sample_size": len(y_true),
            "positive_rate": y_true.mean(),
            "tests": {},
            "overall_score": 0,
            "verdict": "",
        }
        
        scores = []
        
        # 1. 统计显著性
        correct = (y_pred == y_true).sum()
        binom_result = self.binomial_test(correct, len(y_true))
        report["tests"]["binomial_test"] = binom_result
        scores.append(1.0 if binom_result["significant"] else 0.0)
        
        # 置换检验
        perm_result = self.permutation_test(y_true, y_prob, n_permutations=500)
        report["tests"]["permutation_test"] = perm_result
        scores.append(1.0 if perm_result["significant"] else 0.0)
        
        # 游程检验
        runs_result = self.runs_test(y_pred, y_true)
        report["tests"]["runs_test"] = runs_result
        # 游程检验显著说明错误不随机 (有问题)，不显著才是好的
        scores.append(0.0 if runs_result["significant"] else 1.0)
        
        # 2. 置信度校准
        calib_result = self.calibration_analysis(y_true, y_prob)
        report["tests"]["calibration"] = calib_result
        scores.append(1.0 if calib_result["well_calibrated"] else 
                     0.5 if calib_result["ece"] < 0.15 else 0.0)
        
        # 3. 过拟合检测
        if metrics_insample and metrics_outsample:
            overfit_result = self.overfitting_detection(metrics_insample, metrics_outsample)
            report["tests"]["overfitting"] = overfit_result
            scores.append(0.0 if overfit_result["overfit_detected"] else 1.0)
        
        # 4. 基准对比
        if strategy_returns and buyhold_returns and predictions_history:
            bench_result = self.benchmark_comparison(
                strategy_returns, buyhold_returns,
                [p.get("prediction", 0) for p in predictions_history], y_true
            )
            report["tests"]["benchmark"] = bench_result
            scores.append(1.0 if bench_result["beats_random"] else 0.0)
            scores.append(0.0 if bench_result["reverse_better"] else 1.0)
        
        # 5. 经济意义
        if strategy_returns and buyhold_returns:
            econ_result = self.economic_significance(strategy_returns, buyhold_returns)
            report["tests"]["economic_significance"] = econ_result
            scores.append(1.0 if econ_result["economically_meaningful"] else 0.0)
        
        # 6. 稳定性
        if rolling_metrics:
            stab_result = self.stability_analysis(rolling_metrics, "auc")
            report["tests"]["stability"] = stab_result
            scores.append(stab_result["stability_score"])
        
        # 综合评分 (0-100)
        report["overall_score"] = np.mean(scores) * 100 if scores else 0
        
        # 最终裁决
        if report["overall_score"] >= 80:
            report["verdict"] = "模型通过合理性检验，具备预测能力"
            report["verdict_level"] = "pass"
        elif report["overall_score"] >= 60:
            report["verdict"] = "模型基本合理，但存在改进空间"
            report["verdict_level"] = "conditional_pass"
        elif report["overall_score"] >= 40:
            report["verdict"] = "模型合理性存疑，建议深入分析"
            report["verdict_level"] = "warning"
        else:
            report["verdict"] = "模型未通过合理性检验，可能为过拟合或伪相关"
            report["verdict_level"] = "fail"
        
        self.evaluation_history.append(report)
        return report
    
    def print_evaluation_report(self, report: Dict):
        """打印评估报告"""
        print("\n" + "=" * 70)
        print("  模型合理性科学评估报告")
        print("=" * 70)
        print(f"  评估样本量: {report['sample_size']}")
        print(f"  正样本比例: {report['positive_rate']:.4f}")
        print(f"  综合评分: {report['overall_score']:.1f}/100")
        print(f"  最终裁决: {report['verdict']}")
        print("-" * 70)
        
        for test_name, result in report["tests"].items():
            print(f"\n【{test_name}】")
            if "p_value" in result:
                sig = "显著" if result.get("significant") else "不显著"
                print(f"  p值: {result['p_value']:.4f} ({sig})")
            if "accuracy" in result:
                print(f"  准确率: {result['accuracy']:.4f}")
            if "ece" in result:
                print(f"  ECE: {result['ece']:.4f} ({result.get('interpretation', '')})")
            if "overfit_detected" in result:
                print(f"  过拟合: {'是' if result['overfit_detected'] else '否'}")
            if "beats_random" in result:
                print(f"  击败随机: {'是' if result['beats_random'] else '否'}")
            if "stable" in result:
                print(f"  稳定性: {'稳定' if result['stable'] else '不稳定'}")
        
        print("=" * 70)


# ==================== 快捷评估函数 ====================

def quick_evaluate(y_true, y_prob, y_pred) -> Dict:
    """快速评估"""
    evaluator = ModelEvaluator()
    report = evaluator.comprehensive_evaluation(
        y_true=np.array(y_true),
        y_prob=np.array(y_prob),
        y_pred=np.array(y_pred),
    )
    evaluator.print_evaluation_report(report)
    return report


if __name__ == "__main__":
    # 测试评估器
    np.random.seed(42)
    
    # 模拟数据: 略好于随机
    n = 200
    y_true = np.random.choice([0, 1], size=n, p=[0.48, 0.52])
    y_prob = np.clip(y_true * 0.7 + (1 - y_true) * 0.3 + np.random.normal(0, 0.1, n), 0.01, 0.99)
    y_pred = (y_prob > 0.5).astype(int)
    
    report = quick_evaluate(y_true, y_prob, y_pred)
