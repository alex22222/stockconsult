# -*- coding: utf-8 -*-
"""
AKShare 非价格特征提供者
========================
作为 investoday API 额度耗尽时的免费替代方案。
从 AKShare 获取类似特征：机构评级、新闻情绪、财务指标、市场表现。
"""
import warnings
warnings.filterwarnings('ignore')
import json
import re
from datetime import datetime, timedelta
from typing import Dict

import akshare as ak
import pandas as pd
import numpy as np


def _safe_get(df: pd.DataFrame, col: str, default=0):
    """安全获取 DataFrame 列值"""
    if col in df.columns and len(df) > 0:
        v = df[col].iloc[0]
        if pd.notna(v):
            try:
                return float(v)
            except:
                pass
    return default


def _sentiment_from_text(text: str) -> float:
    """基于关键词的简单情绪打分 (-1 ~ +1)"""
    if not text:
        return 0.0
    text = str(text)
    positive = ['涨', '升', '突破', '利好', '增持', '买入', '推荐', '盈利', '增长', '上升', '强势', '反弹', '创新高']
    negative = ['跌', '降', '下跌', '利空', '减持', '卖出', '回避', '亏损', '下降', '弱势', '跌破', '创新低', '暴跌']
    score = 0
    for p in positive:
        score += text.count(p) * 0.3
    for n in negative:
        score -= text.count(n) * 0.3
    return max(-1.0, min(1.0, score))


def fetch_stock_score_ak(symbol: str) -> Dict:
    """
    从 AKShare 获取机构评级综合评分，映射到 investoday 的 score 格式。
    """
    try:
        # 使用机构评级汇总
        df = ak.stock_institute_recommend_detail(symbol=symbol)
        if df is None or df.empty:
            return {}
        
        # 取最近 30 天的评级
        df['评级日期'] = pd.to_datetime(df['评级日期'], errors='coerce')
        recent = df[df['评级日期'] >= datetime.now() - timedelta(days=30)]
        if recent.empty:
            recent = df.head(20)
        
        # 评级映射: 买入=1, 增持=0.7, 中性=0.3, 减持=-0.5, 卖出=-1
        rating_map = {
            '买入': 1.0, '强烈推荐': 1.0, '推荐': 0.8,
            '增持': 0.7, '持有': 0.3, '中性': 0.3,
            '减持': -0.5, '卖出': -1.0, '回避': -0.8,
        }
        scores = []
        for r in recent['评级'].astype(str):
            matched = False
            for key, val in rating_map.items():
                if key in r:
                    scores.append(val)
                    matched = True
                    break
            if not matched:
                scores.append(0.3)
        
        avg_score = sum(scores) / len(scores) if scores else 0.5
        
        # 映射到 0-100 分制
        return {
            "score": round((avg_score + 1) / 2 * 100, 2),
            "skillScore": round((avg_score + 1) / 2 * 100, 2),
            "emotionScore": round((avg_score + 1) / 2 * 100, 2),
            "financeScore": round(_safe_get(recent, '评级', 50), 2),
            "industryScore": 50.0,
            "scoreAvg": round((avg_score + 1) / 2 * 100, 2),
        }
    except Exception as e:
        return {}


def fetch_news_sentiment_ak(symbol: str, days: int = 7) -> Dict:
    """
    从 AKShare 获取个股新闻并计算情绪得分。
    """
    try:
        df = ak.stock_news_em(symbol=symbol)
        if df is None or df.empty:
            return {}
        
        df['发布时间'] = pd.to_datetime(df['发布时间'], errors='coerce')
        cutoff = datetime.now() - timedelta(days=days)
        recent = df[df['发布时间'] >= cutoff]
        if recent.empty:
            recent = df.head(20)
        
        sentiments = []
        for _, row in recent.iterrows():
            title = str(row.get('新闻标题', ''))
            content = str(row.get('新闻内容', ''))
            s = _sentiment_from_text(title + ' ' + content)
            sentiments.append(s)
        
        return {
            "news_count": len(recent),
            "news_sentiment_mean": round(sum(sentiments) / len(sentiments), 4) if sentiments else 0,
            "news_sentiment_std": round(np.std(sentiments), 4) if len(sentiments) > 1 else 0,
            "news_sentiment_max": round(max(sentiments), 4) if sentiments else 0,
            "news_sentiment_min": round(min(sentiments), 4) if sentiments else 0,
        }
    except Exception as e:
        return {}


def fetch_valuation_ranks_ak(symbol: str) -> Dict:
    """
    从 AKShare 获取个股估值指标，计算百分位排名替代 investoday 的行业排名。
    """
    try:
        # 获取个股财务指标
        df = ak.stock_financial_analysis_indicator(symbol=symbol)
        if df is None or df.empty:
            return {}
        
        latest = df.iloc[0]
        
        # 尝试提取常见估值指标
        ranks = {}
        pe = _safe_get(df, '市盈率')
        pb = _safe_get(df, '市净率')
        ps = _safe_get(df, '市销率')
        
        # 使用反向映射：低估值 = 高分（排名靠前）
        # 用 100 - min(PE/50*100, 100) 作为粗糙的排名替代
        if pe > 0:
            ranks["val_pe_ttm_Rk"] = max(0, min(100, 100 - pe / 50 * 100))
        if pb > 0:
            ranks["val_pb_Rk"] = max(0, min(100, 100 - pb / 5 * 100))
        if ps > 0:
            ranks["val_ps_Rk"] = max(0, min(100, 100 - ps / 10 * 100))
        
        # 如果有 ROE，也加入
        roe = _safe_get(df, '净资产收益率')
        if roe != 0:
            ranks["val_roe_Rk"] = max(0, min(100, roe))
        
        return ranks
    except Exception as e:
        return {}


def fetch_profit_ranks_ak(symbol: str) -> Dict:
    """
    从 AKShare 获取盈利能力指标。
    """
    try:
        df = ak.stock_financial_analysis_indicator(symbol=symbol)
        if df is None or df.empty:
            return {}
        
        latest = df.iloc[0]
        ranks = {}
        
        # 提取盈利能力指标并映射为 0-100 排名
        roe = _safe_get(df, '净资产收益率')
        if roe > 0:
            ranks["prof_roe_Rk"] = max(0, min(100, roe * 2.5))  # ROE 40% ≈ 100分
        
        gross = _safe_get(df, '销售毛利率')
        if gross > 0:
            ranks["prof_gross_Rk"] = max(0, min(100, gross))
        
        net = _safe_get(df, '销售净利率')
        if net > 0:
            ranks["prof_net_Rk"] = max(0, min(100, net * 3))  # 净利率 33% ≈ 100分
        
        eps = _safe_get(df, '每股收益')
        if eps != 0:
            ranks["prof_eps_Rk"] = max(0, min(100, eps * 20))  # EPS 5 ≈ 100分
        
        return ranks
    except Exception as e:
        return {}


def fetch_performance_metrics_ak(symbol: str) -> Dict:
    """
    从 AKShare 获取近期股价表现指标。
    """
    try:
        # 获取近期日线
        df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=(datetime.now() - timedelta(days=30)).strftime("%Y%m%d"), adjust="")
        if df is None or df.empty or len(df) < 5:
            return {}
        
        df['日期'] = pd.to_datetime(df['日期'])
        df = df.sort_values('日期')
        
        close = df['收盘'].astype(float)
        
        # 计算连续涨跌天数
        changes = close.pct_change().dropna()
        consecutive_up = 0
        consecutive_down = 0
        for c in changes.iloc[::-1]:
            if c > 0:
                consecutive_up += 1
                consecutive_down = 0
            elif c < 0:
                consecutive_down += 1
                consecutive_up = 0
            else:
                break
        
        # 是否近期新高/新低
        recent_high = close.iloc[-5:].max()
        recent_low = close.iloc[-5:].min()
        all_high = close.max()
        all_low = close.min()
        
        ytd_start = datetime(datetime.now().year, 1, 1)
        ytd_df = df[df['日期'] >= ytd_start]
        ytd_high = ytd_df['收盘'].max() if not ytd_df.empty else close.iloc[0]
        ytd_low = ytd_df['收盘'].min() if not ytd_df.empty else close.iloc[0]
        
        return {
            "perf_consecutive_days": float(consecutive_up if consecutive_up > 0 else -consecutive_down),
            "perf_consecutive_limit": 0.0,
            "perf_is_hist_highlow": 1.0 if close.iloc[-1] >= all_high * 0.99 else (-1.0 if close.iloc[-1] <= all_low * 1.01 else 0.0),
            "perf_is_ytd_highlow": 1.0 if close.iloc[-1] >= ytd_high * 0.99 else (-1.0 if close.iloc[-1] <= ytd_low * 1.01 else 0.0),
            "perf_is_mtd_highlow": 1.0 if close.iloc[-1] >= recent_high * 0.99 else (-1.0 if close.iloc[-1] <= recent_low * 1.01 else 0.0),
            "perf_is_wtd_highlow": 0.0,
        }
    except Exception as e:
        return {}


def get_all_nonprice_features_ak(symbol: str) -> Dict:
    """
    从 AKShare 获取全部非价格特征，作为 investoday 的替代。
    返回格式与 investoday 兼容。
    """
    print(f"     🔄 尝试 AKShare 替代方案...")
    
    score = fetch_stock_score_ak(symbol)
    news = fetch_news_sentiment_ak(symbol)
    val = fetch_valuation_ranks_ak(symbol)
    prof = fetch_profit_ranks_ak(symbol)
    perf = fetch_performance_metrics_ak(symbol)
    
    result = {**score, **news, **val, **prof, **perf}
    
    if result:
        print(f"     ✅ AKShare 获取 {len(result)} 个特征")
    else:
        print(f"     ⚠️ AKShare 也无法获取特征")
    
    return result


if __name__ == "__main__":
    # 测试
    sym = "601318"
    feats = get_all_nonprice_features_ak(sym)
    print(f"\n{sym} 非价格特征:")
    for k, v in sorted(feats.items()):
        print(f"  {k}: {v}")
