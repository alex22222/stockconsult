# -*- coding: utf-8 -*-
"""
美股市场数据获取器
==================

数据源:
- akshare stock_us_daily: QQQ/DIA/SPY/FXI 历史数据
- 新浪 hq.sinajs.cn: 实时行情（用于每日更新）

用途:
- 计算隔夜美股涨跌幅因子（A股开盘前美股已收盘）
- QQQ ≈ 纳斯达克, DIA ≈ 道琼斯, SPY ≈ 标普500, FXI ≈ 中国金龙

用法:
    from us_market_fetcher import download_us_history, fetch_us_realtime, calc_overnight_changes
    download_us_history()  # 下载/更新历史数据
    df = fetch_us_realtime()  # 获取实时行情
"""

import os
import pandas as pd
import numpy as np
import urllib.request
import ssl
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# 美股ETF映射（代码 -> 含义）
US_ETFS = {
    "QQQ": {"name": "纳斯达克100", "proxy_for": "纳斯达克", "weight": 0.35},
    "DIA": {"name": "道琼斯", "proxy_for": "道琼斯", "weight": 0.25},
    "SPY": {"name": "标普500", "proxy_for": "标普500", "weight": 0.25},
    "FXI": {"name": "中国大盘股", "proxy_for": "中国金龙", "weight": 0.15},
}

US_HISTORY_CSV = os.path.join(DATA_DIR, "us_overnight.csv")


def download_us_history(force=False):
    """
    下载美股ETF历史数据并计算隔夜涨跌幅
    
    Args:
        force: 是否强制重新下载
    """
    if os.path.exists(US_HISTORY_CSV) and not force:
        df = pd.read_csv(US_HISTORY_CSV, encoding="utf-8-sig")
        last_date = df["date"].iloc[-1] if len(df) > 0 else ""
        if last_date >= (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d"):
            print(f"[USMarket] 美股数据已是最新 ({last_date})，跳过下载")
            return df

    print("[USMarket] 正在下载美股ETF历史数据...")
    all_data = {}

    for symbol in US_ETFS:
        try:
            import akshare as ak
            df = ak.stock_us_daily(symbol=symbol, adjust="qfq")
            df = df[["date", "close"]].copy()
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
            df.rename(columns={"close": f"{symbol}_close"}, inplace=True)
            all_data[symbol] = df
            print(f"  {symbol}: {len(df)} 条 ({df['date'].iloc[0]} ~ {df['date'].iloc[-1]})")
        except Exception as e:
            print(f"  ⚠ {symbol} 下载失败: {e}")

    if not all_data:
        print("[USMarket] 所有数据源均失败")
        return pd.DataFrame()

    # 合并所有ETF数据
    merged = None
    for symbol, df in all_data.items():
        if merged is None:
            merged = df
        else:
            merged = merged.merge(df, on="date", how="outer")

    merged = merged.sort_values("date").reset_index(drop=True)

    # 计算隔夜涨跌幅（当日收盘 vs 前日收盘）
    for symbol in US_ETFS:
        col = f"{symbol}_close"
        if col in merged.columns:
            merged[f"{symbol}_chg"] = merged[col].pct_change() * 100

    # 计算综合隔夜情绪得分（加权平均）
    chg_cols = [f"{s}_chg" for s in US_ETFS if f"{s}_chg" in merged.columns]
    if chg_cols:
        # 使用默认权重（后续可通过 calc_us_factor_weights.py 优化）
        weights = [US_ETFS[s]["weight"] for s in US_ETFS if f"{s}_chg" in merged.columns]
        total_w = sum(weights)
        weights = [w / total_w for w in weights]
        merged["us_overnight_score"] = merged[[c for c in chg_cols if c in merged.columns]].fillna(0).values @ weights

    merged.to_csv(US_HISTORY_CSV, index=False, encoding="utf-8-sig")
    print(f"[USMarket] 已保存: {US_HISTORY_CSV} ({len(merged)} 条)")
    return merged


def fetch_us_realtime() -> pd.DataFrame:
    """
    通过新浪API获取美股实时行情（涨跌幅）
    
    Returns:
        DataFrame with columns: symbol, name, close, change_pct
    """
    codes = ["gb_ixic", "gb_dji", "gb_inx", "gb_hxc"]
    names = {"gb_ixic": "纳斯达克", "gb_dji": "道琼斯", "gb_inx": "标普500", "gb_hxc": "中国金龙"}
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)

    try:
        ctx = ssl._create_unverified_context()
        req = urllib.request.Request(
            url,
            headers={"Referer": "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0"},
        )
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        text = resp.read().decode("gbk")

        rows = []
        for line in text.strip().split(";"):
            if not line.strip():
                continue
            parts = line.split('="')
            if len(parts) < 2:
                continue
            code = parts[0].split("_")[-1]
            data = parts[1].strip('"').split(",")
            if len(data) >= 3:
                rows.append({
                    "code": code,
                    "name": names.get("gb_" + code, code),
                    "close": float(data[1]) if data[1] else 0,
                    "change_pct": float(data[2]) if data[2] else 0,
                    "time": data[3] if len(data) > 3 else "",
                })
        return pd.DataFrame(rows)
    except Exception as e:
        print(f"[USMarket] 实时行情获取失败: {e}")
        return pd.DataFrame()


def calc_overnight_changes() -> dict:
    """
    计算最新隔夜美股涨跌幅（用于预测时获取）
    
    Returns:
        dict with keys: nasdaq_chg, dow_chg, sp500_chg, china_chg, us_overnight_score
    """
    # 优先从本地历史数据获取
    if os.path.exists(US_HISTORY_CSV):
        df = pd.read_csv(US_HISTORY_CSV, encoding="utf-8-sig")
        if len(df) > 0:
            last = df.iloc[-1]
            return {
                "nasdaq_chg": last.get("QQQ_chg", 0),
                "dow_chg": last.get("DIA_chg", 0),
                "sp500_chg": last.get("SPY_chg", 0),
                "china_chg": last.get("FXI_chg", 0),
                "us_overnight_score": last.get("us_overnight_score", 0),
                "source": "history",
                "date": last.get("date", ""),
            }

    # 降级到实时API
    rt = fetch_us_realtime()
    if rt.empty:
        return {}

    mapping = {"ixic": "nasdaq_chg", "dji": "dow_chg", "inx": "sp500_chg", "hxc": "china_chg"}
    result = {"source": "realtime", "date": datetime.now().strftime("%Y-%m-%d")}
    score = 0
    total_w = 0
    for _, row in rt.iterrows():
        key = mapping.get(row["code"])
        if key:
            result[key] = row["change_pct"]
            # 使用默认权重计算综合得分
            etf_key = {"nasdaq_chg": "QQQ", "dow_chg": "DIA", "sp500_chg": "SPY", "china_chg": "FXI"}[key]
            w = US_ETFS[etf_key]["weight"]
            score += row["change_pct"] * w
            total_w += w
    result["us_overnight_score"] = score / total_w if total_w > 0 else 0
    return result


if __name__ == "__main__":
    # 测试
    df = download_us_history()
    print("\n最新隔夜数据:")
    print(calc_overnight_changes())
    print("\n实时行情:")
    print(fetch_us_realtime())
