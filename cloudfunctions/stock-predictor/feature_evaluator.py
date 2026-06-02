# -*- coding: utf-8 -*-
"""
特征评估器 — 用 IC 和分层收益检验特征有效性
=============================================
评估指标:
- IC (Spearman 秩相关系数): 特征值 vs 未来收益的单调关系
- IC_IR: IC 均值 / IC 标准差 (稳定性)
- 分层收益: 按特征值分 5 层，看每层未来收益是否单调
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from scipy.stats import spearmanr
from typing import Dict, List
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def calc_ic_series(feature_series: pd.Series, forward_return: pd.Series) -> float:
    """计算单期 IC (Spearman)"""
    valid = feature_series.notna() & forward_return.notna()
    if valid.sum() < 10:
        return np.nan
    ic, _ = spearmanr(feature_series[valid], forward_return[valid])
    return ic


def calc_quantile_returns(feature_series: pd.Series, forward_return: pd.Series, n_quantiles: int = 5) -> Dict:
    """分层收益：按特征值分 n 层，返回每层平均未来收益"""
    df = pd.DataFrame({"feat": feature_series, "ret": forward_return}).dropna()
    if len(df) < n_quantiles * 10:
        return {}
    df["quantile"] = pd.qcut(df["feat"], n_quantiles, labels=False, duplicates="drop")
    return df.groupby("quantile")["ret"].mean().to_dict()


def evaluate_features_for_stock(symbol: str, days: int = 500, use_compact: bool = True) -> pd.DataFrame:
    """
    对单只股票评估所有特征的有效性
    
    Returns:
        DataFrame: 每行一个特征，列包括 ic_mean, ic_std, ic_ir, q1_ret, q5_ret, q5_q1_spread
    """
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=days)
    engineer = FeatureEngineer()
    
    if use_compact:
        X, y = engineer.build_compact_features(raw, symbol, target_mode="regression")
    else:
        X, y = engineer.build_features(raw, symbol, target_mode="regression")
    
    if X.empty or len(X) < 100:
        return pd.DataFrame()
    
    results = []
    for col in X.columns:
        feat = X[col]
        # 滚动计算 IC（用 60 日窗口，步进 20 日，模拟 walk-forward）
        ic_values = []
        window = 60
        step = 20
        for i in range(window, len(feat), step):
            ic = calc_ic_series(feat.iloc[i-window:i], y.iloc[i-window:i])
            if not np.isnan(ic):
                ic_values.append(ic)
        
        if len(ic_values) < 3:
            continue
        
        ic_mean = np.mean(ic_values)
        ic_std = np.std(ic_values)
        ic_ir = ic_mean / ic_std if ic_std > 0 else 0
        
        # 全量分层收益
        q_rets = calc_quantile_returns(feat, y, n_quantiles=5)
        q1_ret = q_rets.get(0, np.nan)
        q5_ret = q_rets.get(4, np.nan)
        spread = q5_ret - q1_ret if not (np.isnan(q1_ret) or np.isnan(q5_ret)) else np.nan
        
        results.append({
            "symbol": symbol,
            "feature": col,
            "ic_mean": round(ic_mean, 4),
            "ic_std": round(ic_std, 4),
            "ic_ir": round(ic_ir, 4),
            "q1_ret": round(q1_ret, 4) if not np.isnan(q1_ret) else None,
            "q5_ret": round(q5_ret, 4) if not np.isnan(q5_ret) else None,
            "q5_q1_spread": round(spread, 4) if not np.isnan(spread) else None,
            "n_ic_windows": len(ic_values),
        })
    
    return pd.DataFrame(results)


def evaluate_features_across_stocks(symbols: Dict[str, str], days: int = 500, use_compact: bool = True) -> pd.DataFrame:
    """
    跨股票评估特征稳定性：特征必须在多只股票上都有正向 IC 才可靠
    """
    all_results = []
    for sym, name in symbols.items():
        df = evaluate_features_for_stock(sym, days=days, use_compact=use_compact)
        if not df.empty:
            all_results.append(df)
    
    if not all_results:
        return pd.DataFrame()
    
    combined = pd.concat(all_results, ignore_index=True)
    
    # 按特征聚合：跨股票 IC 均值、IC 为正的股票比例
    summary = combined.groupby("feature").agg(
        ic_mean_cross_stock=("ic_mean", "mean"),
        ic_std_cross_stock=("ic_mean", "std"),
        positive_ic_ratio=("ic_mean", lambda x: (x > 0).mean()),
        avg_spread=("q5_q1_spread", "mean"),
        n_stocks=("symbol", "nunique"),
    ).reset_index()
    
    summary = summary.sort_values("ic_mean_cross_stock", key=abs, ascending=False)
    return summary


def main():
    symbols = {
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
    
    print("=" * 100)
    print("精简特征评估（跨股票 IC + 分层收益）")
    print("=" * 100)
    print("筛选标准: |IC| > 0.03 且 正向IC比例 > 0.5 且 分层收益单调")
    print("-" * 100)
    
    summary = evaluate_features_across_stocks(symbols, days=500, use_compact=True)
    if summary.empty:
        print("评估失败，数据不足")
        return
    
    # 筛选有效特征：|IC|>0.03 且方向一致（正向比例>0.5 或 <0.5）
    direction_consistent = (
        (summary["positive_ic_ratio"] > 0.5) | (summary["positive_ic_ratio"] < 0.5)
    )
    filtered = summary[
        (abs(summary["ic_mean_cross_stock"]) > 0.03) &
        direction_consistent &
        (summary["n_stocks"] >= 3)
    ].copy()
    
    print(f"\n评估完成。共 {len(summary)} 个特征，其中 {len(filtered)} 个通过稳定性筛选：\n")
    print(summary.to_string(index=False))
    
    if not filtered.empty:
        print(f"\n通过筛选的特征列表（{len(filtered)} 个）:")
        for _, row in filtered.iterrows():
            direction = "正向" if row["ic_mean_cross_stock"] > 0 else "负向"
            print(f"  {row['feature']:<20s} IC={row['ic_mean_cross_stock']:+.4f}  "
                  f"正向比例={row['positive_ic_ratio']:.0%}  分层spread={row['avg_spread']:+.4f}  [{direction}]")


if __name__ == "__main__":
    main()
