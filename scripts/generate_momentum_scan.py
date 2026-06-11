#!/usr/bin/env python3
"""
基于本地真实 CSV 数据生成「爆破力扫描」结果
供前端 MomentumScanPage 展示

数据来源：cloudfunctions/stock-predictor/data/*_daily.csv
输出：public/data/momentum_scan.json
"""

import os
import json
import math
from pathlib import Path
import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[1] / "cloudfunctions" / "stock-predictor" / "data"
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

STOCKS = {
    "601318": {"name": "中国平安", "exchange": "SSE"},
    "002617": {"name": "露笑科技", "exchange": "SZSE"},
    "300622": {"name": "博士眼镜", "exchange": "SZSE"},
    "002896": {"name": "中大力德", "exchange": "SZSE"},
}


def load_stock(symbol: str) -> pd.DataFrame:
    path = DATA_DIR / f"{symbol}_daily.csv"
    df = pd.read_csv(path, encoding="utf-8-sig")
    df["日期"] = pd.to_datetime(df["日期"])
    df = df.sort_values("日期").reset_index(drop=True)
    return df


def calc_rsi(close: pd.Series, period: int = 6) -> pd.Series:
    delta = close.diff()
    gain = delta.where(delta > 0, 0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
    rs = gain / (loss + 1e-10)
    return 100 - 100 / (1 + rs)


def calc_macd(close: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast).mean()
    ema_slow = close.ewm(span=slow).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal).mean()
    hist = dif - dea
    return dif, dea, hist


def calc_bollinger(close: pd.Series, period=20, std_mult=2):
    ma = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = ma + std_mult * std
    lower = ma - std_mult * std
    width = (upper - lower) / (ma + 1e-10) * 100
    return upper, lower, ma, width


def calc_atr(high, low, close, period=14):
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def score_volume_price(df: pd.DataFrame) -> tuple:
    """量价脉冲：0-100"""
    close = df["收盘"]
    volume = df["成交量"]

    vol_20d = volume.rolling(20).mean()
    vol_ratio = volume / (vol_20d + 1e-10)
    latest_vol_ratio = vol_ratio.iloc[-1]

    ret_3d = (close.iloc[-1] / close.iloc[-4] - 1) * 100 if len(close) >= 4 else 0

    # 成交量得分
    if latest_vol_ratio >= 3.0:
        vol_score = 100
    elif latest_vol_ratio >= 2.0:
        vol_score = 85
    elif latest_vol_ratio >= 1.5:
        vol_score = 70
    elif latest_vol_ratio >= 1.2:
        vol_score = 55
    else:
        vol_score = 40

    # 涨幅得分（有涨幅但不透支）
    if 8 <= ret_3d <= 18:
        ret_score = 90
    elif 5 <= ret_3d < 8:
        ret_score = 80
    elif 2 <= ret_3d < 5:
        ret_score = 65
    elif 0 <= ret_3d < 2:
        ret_score = 50
    elif ret_3d < 0:
        ret_score = 35
    else:  # > 18 透支
        ret_score = 60

    score = int(vol_score * 0.6 + ret_score * 0.4)

    details = []
    details.append(f"近3日成交量为20日均量的 {latest_vol_ratio:.1f} 倍")
    details.append(f"近3日累计涨幅 {ret_3d:+.2f}%")
    if latest_vol_ratio >= 1.5 and ret_3d >= 5:
        details.append("量价齐升，资金介入迹象明显")
    elif latest_vol_ratio >= 1.5:
        details.append("放量但涨幅温和，筹码交换充分")
    else:
        details.append("量能一般，等待放量确认")

    return score, details


def score_technical(df: pd.DataFrame) -> tuple:
    """技术突破：0-100"""
    close = df["收盘"]
    high = df["最高"]
    latest_close = close.iloc[-1]

    # 20日/60日高点
    high_20 = high.rolling(20).max().iloc[-1]
    high_60 = high.rolling(60).max().iloc[-1]

    breakout_20 = latest_close >= high_20 * 0.995
    breakout_60 = latest_close >= high_60 * 0.995

    # RSI
    rsi = calc_rsi(close, 6).iloc[-1]
    rsi_score = 0
    if pd.notna(rsi):
        if 55 <= rsi <= 75:
            rsi_score = 90
        elif 50 <= rsi < 55:
            rsi_score = 75
        elif 40 <= rsi < 50:
            rsi_score = 55
        elif rsi > 75:
            rsi_score = 65  # 超买
        else:
            rsi_score = 40

    # MACD
    dif, dea, hist = calc_macd(close)
    latest_hist = hist.iloc[-1]
    latest_dif = dif.iloc[-1]
    latest_dea = dea.iloc[-1]
    macd_bull = latest_dif > latest_dea and latest_hist > 0
    macd_expanding = False
    if len(hist) >= 3 and pd.notna(hist.iloc[-1]) and pd.notna(hist.iloc[-2]):
        macd_expanding = hist.iloc[-1] > hist.iloc[-2]

    macd_score = 0
    if macd_bull and macd_expanding:
        macd_score = 90
    elif macd_bull:
        macd_score = 75
    else:
        macd_score = 45

    # 综合
    breakout_score = 0
    if breakout_60:
        breakout_score = 95
    elif breakout_20:
        breakout_score = 80
    else:
        breakout_score = 50

    score = int(breakout_score * 0.4 + rsi_score * 0.3 + macd_score * 0.3)

    details = []
    if breakout_60:
        details.append("收盘价突破近60日高点，中期趋势强势")
    elif breakout_20:
        details.append("收盘价突破近20日高点，短期趋势向上")
    else:
        details.append("尚未突破近期高点，处于盘整或回调中")

    if pd.notna(rsi):
        details.append(f"RSI(6) 位于 {rsi:.1f}，{'强势区间' if rsi >= 50 else '弱势区间'}")
    if macd_bull and macd_expanding:
        details.append("MACD 红柱连续放大，动能增强")
    elif macd_bull:
        details.append("MACD 金叉维持，但红柱未明显扩大")
    else:
        details.append("MACD 尚未形成明确多头信号")

    return score, details


def score_capital(df: pd.DataFrame) -> tuple:
    """资金涌入：0-100（用换手率替代主力资金）"""
    turnover = df["换手率"]
    volume = df["成交量"]

    latest_turnover = turnover.iloc[-1]
    turnover_20d = turnover.rolling(20).mean().iloc[-1]
    turnover_ratio = latest_turnover / (turnover_20d + 1e-10)

    vol_5d = volume.rolling(5).sum().iloc[-1]
    vol_20d = volume.rolling(20).mean().iloc[-1] * 5
    vol_inflow_ratio = vol_5d / (vol_20d + 1e-10)

    if turnover_ratio >= 2.5:
        score = 95
    elif turnover_ratio >= 2.0:
        score = 85
    elif turnover_ratio >= 1.5:
        score = 75
    elif turnover_ratio >= 1.2:
        score = 60
    else:
        score = 45

    details = []
    details.append(f"最新换手率 {latest_turnover:.2f}%，20日均值 {turnover_20d:.2f}%")
    details.append(f"换手率倍数 {turnover_ratio:.1f}x")
    if turnover_ratio >= 1.5:
        details.append("交易活跃度显著提升，资金关注度增加")
    else:
        details.append("换手相对平稳，未出现明显资金异动")

    return score, details


def score_sentiment(df: pd.DataFrame, symbol: str) -> tuple:
    """情绪催化：0-100（本地无公告数据，基于价格行为推断 + 静态信息）"""
    close = df["收盘"]
    change_pct = df["涨跌幅"]

    # 近5日阳线数量
    recent_5 = change_pct.tail(5)
    yang_count = (recent_5 > 0).sum()

    # 近3日是否有涨停（涨幅>9.5%）
    has_limit_up = (change_pct.tail(3) > 9.5).any()

    score = 50
    if has_limit_up:
        score += 25
    if yang_count >= 4:
        score += 15
    elif yang_count >= 3:
        score += 8
    elif yang_count <= 1:
        score -= 10

    # 个股特定逻辑
    catalysts = {
        "601318": ["保险行业估值修复预期", "险资配置权益资产比例提升"],
        "002617": ["碳化硅衬底业务进展", "第三代半导体产业政策催化"],
        "300622": ["眼镜零售渠道扩张", "消费复苏带动线下客流"],
        "002896": ["精密减速器国产替代", "人形机器人产业链热度"],
    }

    details = []
    if yang_count >= 3:
        details.append(f"近5日 {yang_count} 天收阳，市场情绪偏乐观")
    else:
        details.append(f"近5日 {yang_count} 天收阳，情绪中性")
    if has_limit_up:
        details.append("近3日出现涨停，短期情绪高涨")

    for cat in catalysts.get(symbol, []):
        details.append(f"潜在催化：{cat}")

    return min(100, max(30, score)), details


def score_volatility(df: pd.DataFrame) -> tuple:
    """波动释放：0-100"""
    close = df["收盘"]
    high = df["最高"]
    low = df["最低"]

    upper, lower, ma, bb_width = calc_bollinger(close)
    atr = calc_atr(high, low, close)

    latest_bb_width = bb_width.iloc[-1]
    bb_width_20d = bb_width.rolling(20).mean().iloc[-1]
    bb_squeeze = latest_bb_width < bb_width_20d * 0.9 if pd.notna(bb_width_20d) else False

    latest_atr = atr.iloc[-1]
    atr_20d = atr.rolling(20).mean().iloc[-1]
    atr_ratio = latest_atr / (atr_20d + 1e-10)

    # 突破布林带上轨
    latest_close = close.iloc[-1]
    latest_upper = upper.iloc[-1]
    breakout_bb = latest_close > latest_upper * 0.995 if pd.notna(latest_upper) else False

    score = 50
    if breakout_bb and not bb_squeeze:
        score = 85
    elif breakout_bb:
        score = 75
    elif atr_ratio >= 1.3:
        score = 70
    elif bb_squeeze:
        score = 60  # 压缩后待释放
    else:
        score = 45

    details = []
    if pd.notna(latest_bb_width):
        details.append(f"布林带宽度 {latest_bb_width:.2f}%")
    if bb_squeeze:
        details.append("布林带收窄，波动压缩，关注突破方向")
    if breakout_bb:
        details.append("收盘价突破布林带上轨，波动向上释放")
    if pd.notna(atr_ratio):
        details.append(f"ATR(14) 为20日均值的 {atr_ratio:.1f} 倍")

    return score, details


def build_entry_plan(df: pd.DataFrame, total: int, dimensions: list) -> dict:
    close = df["收盘"]
    high = df["最高"]
    volume = df["成交量"]
    latest_close = float(close.iloc[-1])
    latest_change = float(df["涨跌幅"].iloc[-1])

    high_20 = float(high.rolling(20).max().iloc[-1])
    high_60 = float(high.rolling(60).max().iloc[-1])
    latest_vol_ratio = float(volume.iloc[-1] / (volume.rolling(20).mean().iloc[-1] + 1e-10))
    latest_rsi = float(calc_rsi(close, 6).iloc[-1])
    ret_3d = float((close.iloc[-1] / close.iloc[-4] - 1) * 100) if len(close) >= 4 else 0.0

    breakout_20 = latest_close >= high_20 * 0.995
    breakout_60 = latest_close >= high_60 * 0.995
    breakout_level = high_60 if breakout_60 else high_20
    technical = next((d["score"] for d in dimensions if d["name"] == "技术突破"), 50)
    capital = next((d["score"] for d in dimensions if d["name"] == "资金涌入"), 50)
    is_overheated = latest_rsi > 78 or ret_3d > 12 or latest_change > 7
    has_breakout = breakout_20 or breakout_60
    near_breakout = latest_close >= high_20 * 0.97
    stop_price = min(latest_close * 0.95, breakout_level * 0.97)

    if total < 55 or technical < 55:
        return {
            "type": "wait",
            "label": "等待确认",
            "trigger": f"放量站上 {high_20:.2f} 后再观察",
            "invalidation": f"收盘跌破 {stop_price:.2f}",
            "note": "当前只是通过扫描，不等于出现可执行买点。",
        }

    if has_breakout and is_overheated:
        return {
            "type": "pullback",
            "label": "回踩低吸",
            "trigger": f"回踩 {breakout_level:.2f} 附近不破且缩量企稳",
            "invalidation": f"收盘跌破 {stop_price:.2f}",
            "note": "已上破但短线偏热，不建议把“通过扫描”理解为直接追高。",
        }

    if has_breakout and latest_vol_ratio >= 1.2 and capital >= 60:
        return {
            "type": "breakout",
            "label": "上破追击",
            "trigger": f"放量站稳 {breakout_level:.2f}，且分时不快速跌回",
            "invalidation": f"收盘跌破 {stop_price:.2f}",
            "note": "偏突破确认买点，适合小仓位试错并严格止损。",
        }

    if near_breakout and technical >= 65:
        return {
            "type": "breakout",
            "label": "等上破确认",
            "trigger": f"有效突破 {high_20:.2f} 且成交量继续放大",
            "invalidation": f"收盘跌破 {stop_price:.2f}",
            "note": "还没真正突破，优先等上破，不是下跌途中接刀。",
        }

    return {
        "type": "pullback",
        "label": "回踩低吸",
        "trigger": f"回踩 {min(latest_close * 0.98, high_20):.2f} 附近企稳",
        "invalidation": f"收盘跌破 {stop_price:.2f}",
        "note": "动能够看，但买点不清晰，等价格给出更好的风险收益比。",
    }


def analyze_stock(symbol: str, info: dict) -> dict:
    df = load_stock(symbol)
    if len(df) < 60:
        return None

    close = df["收盘"]
    latest_close = close.iloc[-1]
    latest_change = df["涨跌幅"].iloc[-1]

    s1, d1 = score_volume_price(df)
    s2, d2 = score_technical(df)
    s3, d3 = score_capital(df)
    s4, d4 = score_sentiment(df, symbol)
    s5, d5 = score_volatility(df)

    weights = [0.30, 0.25, 0.20, 0.15, 0.10]
    scores = [s1, s2, s3, s4, s5]
    total = int(sum(s * w for s, w in zip(scores, weights)))

    level = "extreme" if total >= 85 else "high" if total >= 70 else "medium" if total >= 55 else "low"

    dimensions = [
        {"name": "量价脉冲", "score": s1, "weight": 0.30, "details": d1},
        {"name": "技术突破", "score": s2, "weight": 0.25, "details": d2},
        {"name": "资金涌入", "score": s3, "weight": 0.20, "details": d3},
        {"name": "情绪催化", "score": s4, "weight": 0.15, "details": d4},
        {"name": "波动释放", "score": s5, "weight": 0.10, "details": d5},
    ]

    # 生成 summary
    best_dim = max(dimensions, key=lambda x: x["score"])
    summaries = {
        "量价脉冲": f"{info['name']} 近期量能显著放大，{d1[0].split('，')[0]}，短期动能充沛。",
        "技术突破": f"{info['name']} 技术形态向好，{d2[0].split('，')[0]}，关注突破后的持续性。",
        "资金涌入": f"{info['name']} 交易活跃度提升，{d3[0].split('，')[0]}，资金关注度增加。",
        "情绪催化": f"{info['name']} 所属板块有催化，{d4[-1] if d4 else '关注消息面变化'}。",
        "波动释放": f"{info['name']} 波动率出现变化，{d5[0].split('，')[0]}，方向选择中。",
    }
    summary = summaries.get(best_dim["name"], f"{info['name']} 综合爆破力指数 {total} 分，值得关注。")

    risk_warnings = []
    if total > 80:
        risk_warnings.append("短期涨幅较大，需警惕获利回吐压力")
        risk_warnings.append("建议设置止损位，控制单笔亏损不超过 5%")
    elif total > 65:
        risk_warnings.append("板块轮动较快，需关注热点持续性")
        risk_warnings.append("建议设置止损位，控制单笔亏损不超过 5%")
    else:
        risk_warnings.append("信号强度一般，建议观察等待")
        risk_warnings.append("大盘环境可能影响个股表现")

    return {
        "rank": 0,
        "stock": {
            "code": symbol,
            "name": info["name"],
            "exchange": info["exchange"],
            "industry": "",  # 可以从其他数据源补充
        },
        "price": round(float(latest_close), 2),
        "changePercent": round(float(latest_change), 2),
        "score": total,
        "level": level,
        "dimensions": dimensions,
        "summary": summary,
        "entryPlan": build_entry_plan(df, total, dimensions),
        "holdingPeriod": "1-3 个交易日" if total >= 80 else "3-5 个交易日" if total >= 65 else "5 个交易日以内",
        "riskWarning": risk_warnings,
        "updatedAt": df["日期"].iloc[-1].strftime("%Y-%m-%d"),
    }


def main():
    print("=" * 60)
    print("「爆破力扫描」— 基于真实 CSV 数据生成")
    print("=" * 60)

    picks = []
    for symbol, info in STOCKS.items():
        print(f"\n分析 {info['name']}({symbol})...", end=" ")
        result = analyze_stock(symbol, info)
        if result:
            picks.append(result)
            print(f"爆破力 {result['score']} 分")
        else:
            print("数据不足")

    picks.sort(key=lambda x: x["score"], reverse=True)
    for i, p in enumerate(picks):
        p["rank"] = i + 1

    output = {
        "picks": picks,
        "scanTime": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        "marketSentiment": "bullish" if picks and picks[0]["score"] >= 70 else "neutral",
        "totalScanned": len(STOCKS),
    }

    out_path = OUTPUT_DIR / "momentum_scan.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print("扫描结果：")
    print(f"{'=' * 60}")
    for p in picks:
        print(f"  {p['rank']}. {p['stock']['name']}({p['stock']['code']}): {p['score']}分 [{p['level']}]")
    print(f"\n💾 已保存: {out_path}")


if __name__ == "__main__":
    main()
