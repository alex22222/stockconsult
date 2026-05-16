# -*- coding: utf-8 -*-
"""
隔夜美股因子权重科学计算
=========================

方法:
1. 读取A股历史数据（次日涨跌作为目标变量）
2. 读取美股隔夜数据（T-1日美股涨跌幅作为因子）
3. 对齐日期，计算信息系数（IC = 因子与目标的皮尔逊相关系数）
4. 根据IC绝对值分配权重
5. 支持按股票分别计算（不同A股对美股敏感度不同）

用法:
    python calc_us_factor_weights.py --symbol 002617
    python calc_us_factor_weights.py --all
"""

import os
import sys
import pandas as pd
import numpy as np
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# 美股因子定义
US_FACTORS = {
    "QQQ_chg": {"name": "纳斯达克", "default_weight": 0.35},
    "DIA_chg": {"name": "道琼斯", "default_weight": 0.25},
    "SPY_chg": {"name": "标普500", "default_weight": 0.25},
    "FXI_chg": {"name": "中国金龙", "default_weight": 0.15},
}


def calc_ic(factor: pd.Series, target: pd.Series) -> float:
    """计算信息系数（皮尔逊相关系数）"""
    valid = factor.notna() & target.notna()
    if valid.sum() < 10:
        return 0.0
    return np.corrcoef(factor[valid], target[valid])[0, 1]


def calc_weights_for_stock(symbol: str) -> dict:
    """
    为指定A股计算隔夜美股因子权重
    
    Returns:
        {
            "nasdaq_chg": {"ic": 0.12, "weight": 0.30},
            "dow_chg": {"ic": 0.08, "weight": 0.25},
            ...
        }
    """
    stock_csv = os.path.join(DATA_DIR, f"{symbol}_daily.csv")
    us_csv = os.path.join(DATA_DIR, "us_overnight.csv")

    if not os.path.exists(stock_csv):
        print(f"  ⚠ 股票数据不存在: {stock_csv}")
        return {}
    if not os.path.exists(us_csv):
        print(f"  ⚠ 美股数据不存在: {us_csv}")
        return {}

    stock_df = pd.read_csv(stock_csv, encoding="utf-8-sig")
    us_df = pd.read_csv(us_csv, encoding="utf-8-sig")

    # 标准化日期列名
    date_col = "日期" if "日期" in stock_df.columns else "date"
    close_col = "收盘" if "收盘" in stock_df.columns else "close"

    stock_df[date_col] = pd.to_datetime(stock_df[date_col]).dt.strftime("%Y-%m-%d")
    us_df["date"] = pd.to_datetime(us_df["date"]).dt.strftime("%Y-%m-%d")

    # 计算A股次日涨跌（T日收盘 vs T-1日收盘）
    stock_df["a_chg"] = stock_df[close_col].pct_change().shift(-1) * 100

    # 合并数据：美股T-1日涨跌幅 对齐 A股T日涨跌
    # 美股date = T-1，A股date = T
    merged = stock_df[[date_col, "a_chg"]].merge(
        us_df[["date"] + list(US_FACTORS.keys())],
        left_on=date_col,
        right_on="date",
        how="inner",
    )

    if len(merged) < 30:
        print(f"  ⚠ 对齐后样本不足 ({len(merged)} 条)，使用默认权重")
        return {k: {"ic": 0, "weight": v["default_weight"]} for k, v in US_FACTORS.items()}

    # 计算每个因子的IC
    ics = {}
    for factor_key in US_FACTORS:
        if factor_key in merged.columns:
            ic = calc_ic(merged[factor_key], merged["a_chg"])
            ics[factor_key] = ic

    if not ics:
        return {k: {"ic": 0, "weight": v["default_weight"]} for k, v in US_FACTORS.items()}

    # 根据IC绝对值分配权重（IC绝对值越大，权重越高）
    abs_ics = {k: abs(v) for k, v in ics.items()}
    total_ic = sum(abs_ics.values())

    if total_ic < 0.01:
        # IC都接近0，使用默认权重
        weights = {k: v["default_weight"] for k, v in US_FACTORS.items()}
    else:
        # 基于IC绝对值的比例分配，同时保证最小权重5%
        raw_weights = {k: max(v, 0.05) for k, v in abs_ics.items()}
        total_raw = sum(raw_weights.values())
        weights = {k: round(v / total_raw, 4) for k, v in raw_weights.items()}
        # 归一化
        total_w = sum(weights.values())
        weights = {k: round(v / total_w, 4) for k, v in weights.items()}

    result = {}
    for k in US_FACTORS:
        result[k] = {
            "ic": round(ics.get(k, 0), 4),
            "weight": weights.get(k, US_FACTORS[k]["default_weight"]),
        }

    return result


def print_weights(symbol: str, weights: dict):
    """打印权重结果"""
    print(f"\n【{symbol} 隔夜美股因子权重】")
    print(f"{'因子':<12} {'IC':>8} {'权重':>8}")
    print("-" * 32)
    total_w = 0
    for k, info in weights.items():
        name = US_FACTORS[k]["name"]
        print(f"{name:<12} {info['ic']:>+8.4f} {info['weight']:>8.2%}")
        total_w += info["weight"]
    print("-" * 32)
    print(f"{'合计':<12} {'':>8} {total_w:>8.2%}")


def save_weights(weights_dict: dict):
    """保存权重到JSON"""
    import json
    path = os.path.join(DATA_DIR, "us_factor_weights.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(weights_dict, f, ensure_ascii=False, indent=2)
    print(f"\n权重已保存: {path}")


def main():
    parser = argparse.ArgumentParser(description="隔夜美股因子权重科学计算")
    parser.add_argument("--symbol", type=str, help="股票代码 (如 002617)")
    parser.add_argument("--all", action="store_true", help="计算所有已下载股票的权重")
    args = parser.parse_args()

    symbols = []
    if args.all:
        for f in os.listdir(DATA_DIR):
            if f.endswith("_daily.csv") and not f.startswith("us_") and not f.startswith("sh_") and not f.startswith("sz_") and not f.startswith("cy_"):
                symbols.append(f.replace("_daily.csv", ""))
    elif args.symbol:
        symbols = [args.symbol]
    else:
        symbols = ["002617"]  # 默认

    all_weights = {}
    for symbol in symbols:
        weights = calc_weights_for_stock(symbol)
        if weights:
            print_weights(symbol, weights)
            all_weights[symbol] = {k: {"ic": v["ic"], "weight": v["weight"]} for k, v in weights.items()}

    if all_weights:
        save_weights(all_weights)


if __name__ == "__main__":
    main()
