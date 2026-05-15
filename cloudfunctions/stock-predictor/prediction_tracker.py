# -*- coding: utf-8 -*-
"""
预测跟踪器 — 合并本地模型 + 云模型 + 真实验证
==============================================

功能:
1. 基于本地 CSV 数据计算"云模型"四因子评分预测
2. 合并本地 sklearn 集成模型预测与云模型预测
3. T+1 日数据更新后自动验证前一日预测
4. 输出 JSON 供前端展示

用法:
    from prediction_tracker import track_prediction
    track_prediction(symbol="002617", stock_name="露笑科技", local_pred={...})
"""

import os
import json
import pandas as pd
from datetime import datetime, timedelta


def calculate_cloud_model_prediction(df: pd.DataFrame) -> dict:
    """
    基于本地 CSV 数据计算四因子评分预测（复用云函数逻辑）
    
    CSV 期望列: 日期,开盘,最高,最低,收盘,成交量,成交额,换手率,涨跌幅
    """
    if df.empty or len(df) < 20:
        return {
            "prediction": "平",
            "upProbability": 50,
            "downProbability": 50,
            "confidence": 0,
            "factorScores": {"trend": 50, "momentum": 50, "volume": 50, "technical": 50},
        }

    # 标准化列名（兼容 baostock 输出）
    col_map = {
        "date": "日期", "open": "开盘", "high": "最高", "low": "最低",
        "close": "收盘", "volume": "成交量", "amount": "成交额",
        "turn": "换手率", "pctChg": "涨跌幅",
    }
    for en, cn in col_map.items():
        if en in df.columns and cn not in df.columns:
            df = df.rename(columns={en: cn})

    df = df.sort_values("日期").reset_index(drop=True)
    closes = df["收盘"].astype(float).tolist()
    volumes = df["成交量"].astype(float).tolist()
    
    # 计算日涨跌幅
    daily_changes = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        curr = closes[i]
        daily_changes.append(round((curr - prev) / prev * 100, 2))

    today_change = daily_changes[-1] if daily_changes else 0

    # ========== 四因子评分 ==========
    trend_score = 50
    momentum_score = 50
    volume_score = 50
    tech_score = 50

    if len(closes) >= 20:
        ma5 = sum(closes[-5:]) / 5
        ma10 = sum(closes[-10:]) / 10
        ma20 = sum(closes[-20:]) / 20

        # 趋势分
        if ma5 > ma10 > ma20:
            trend_score = 85
        elif ma5 > ma10:
            trend_score = 65
        elif ma5 < ma10 < ma20:
            trend_score = 15
        elif ma5 < ma10:
            trend_score = 35
        else:
            trend_score = 50

        # 动量分
        recent5_change = sum(daily_changes[-5:]) if len(daily_changes) >= 5 else 0
        momentum_score = min(100, max(0, 50 + recent5_change * 3 + today_change * 0.5))

        # 量能分
        vol5 = sum(volumes[-5:]) / max(1, len(volumes[-5:]))
        vol10 = sum(volumes[-10:]) / max(1, len(volumes[-10:]))
        vol_ratio = vol10 / vol10 if vol10 > 0 else 1
        if today_change > 0 and vol_ratio > 1.1:
            volume_score = 75
        elif today_change > 0 and vol_ratio < 0.9:
            volume_score = 55
        elif today_change < 0 and vol_ratio > 1.1:
            volume_score = 25
        elif today_change < 0 and vol_ratio < 0.9:
            volume_score = 45
        else:
            volume_score = 50

        # 技术分（简化 RSI）
        gains = [c for c in daily_changes if c > 0]
        losses = [c for c in daily_changes if c < 0]
        avg_gain = sum(gains) / len(gains) if gains else 0
        avg_loss = abs(sum(losses) / len(losses)) if losses else 0.001
        rsi = 100 - (100 / (1 + avg_gain / avg_loss))
        tech_score = min(100, max(0, rsi))

    # 综合预测
    weights = {"trend": 0.25, "momentum": 0.25, "volume": 0.20, "tech": 0.30}
    composite = (
        trend_score * weights["trend"]
        + momentum_score * weights["momentum"]
        + volume_score * weights["volume"]
        + tech_score * weights["tech"]
    )

    up_prob = round(composite)
    down_prob = 100 - up_prob
    prediction = "涨" if up_prob > 55 else "跌" if down_prob > 55 else "平"
    confidence = round(abs(up_prob - 50) * 2)

    return {
        "prediction": prediction,
        "upProbability": up_prob,
        "downProbability": down_prob,
        "confidence": confidence,
        "factorScores": {
            "trend": round(trend_score),
            "momentum": round(momentum_score),
            "volume": round(volume_score),
            "technical": round(tech_score),
        },
    }


def verify_previous_predictions(df: pd.DataFrame, history: list) -> list:
    """
    利用最新 CSV 数据验证历史预测记录
    
    Args:
        df: 最新个股日线数据
        history: 已有的预测历史记录列表
    
    Returns:
        更新后的 history（回填 verified / actualResult / actualChangePercent）
    """
    if df.empty or len(df) < 2:
        return history

    df = df.sort_values("日期").reset_index(drop=True)
    
    # 构建日期 -> 收盘价的映射
    date_close = {}
    for _, row in df.iterrows():
        date_str = str(row["日期"]).split()[0]
        date_close[date_str] = float(row["收盘"])

    updated = []
    for record in history:
        if record.get("verified"):
            updated.append(record)
            continue

        predict_date = record.get("predictDate", "")
        # 预测的是 predict_date 的下一个交易日
        # 尝试在 date_close 中找到 predict_date 之后的第一个交易日
        sorted_dates = sorted(date_close.keys())
        predict_idx = -1
        for i, d in enumerate(sorted_dates):
            if d == predict_date:
                predict_idx = i
                break

        if predict_idx >= 0 and predict_idx + 1 < len(sorted_dates):
            next_date = sorted_dates[predict_idx + 1]
            if next_date in date_close and predict_date in date_close:
                prev_close = date_close[predict_date]
                next_close = date_close[next_date]
                if prev_close > 0:
                    change_pct = round((next_close - prev_close) / prev_close * 100, 2)
                    actual_result = "涨" if change_pct > 0 else "跌" if change_pct < 0 else "平"
                    
                    record["verified"] = True
                    record["actualResult"] = actual_result
                    record["actualChangePercent"] = change_pct
                    record["localCorrect"] = (record.get("localModel", {}).get("prediction") == actual_result)
                    record["cloudCorrect"] = (record.get("cloudModel", {}).get("prediction") == actual_result)
                    record["verifiedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        updated.append(record)

    return updated


def track_prediction(symbol: str, stock_name: str, local_pred: dict, df: pd.DataFrame = None):
    """
    主入口：记录一次预测（本地+云），验证历史，输出 JSON
    
    Args:
        symbol: 股票代码，如 "002617"
        stock_name: 股票名称
        local_pred: 本地模型预测结果，格式 {"prediction": "涨"/"跌", "up_probability": 0.72, "confidence": 0.84}
        df: 个股日线 DataFrame（用于计算云模型预测和验证）
    """
    today = datetime.now().strftime("%Y-%m-%d")

    # 1. 计算云模型预测
    cloud_pred = calculate_cloud_model_prediction(df) if df is not None else calculate_cloud_model_prediction(pd.DataFrame())

    # 2. 读取已有记录
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    json_path = os.path.join(project_root, "public", "data", "luxiao_comparison.json")
    
    data = {
        "symbol": symbol,
        "name": stock_name,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "latest": None,
        "history": [],
    }

    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"[Tracker] 读取旧记录失败: {e}")

    # 3. 构建本次记录
    local_model = {
        "prediction": "涨" if local_pred.get("prediction") == 1 else "跌",
        "upProbability": round(local_pred.get("up_probability", 0) * 100, 2),
        "downProbability": round(local_pred.get("down_probability", 0) * 100, 2),
        "confidence": round(local_pred.get("confidence", 0) * 100, 2),
    }

    new_record = {
        "predictDate": today,
        "localModel": local_model,
        "cloudModel": cloud_pred,
        "verified": False,
        "actualResult": None,
        "actualChangePercent": None,
        "localCorrect": None,
        "cloudCorrect": None,
    }

    # 去重：如果今天已有记录则替换
    history = [h for h in data.get("history", []) if h.get("predictDate") != today]
    history.append(new_record)
    history.sort(key=lambda x: x.get("predictDate", ""), reverse=True)

    # 4. 验证历史
    if df is not None and not df.empty:
        history = verify_previous_predictions(df, history)

    # 5. 更新 latest
    latest = history[0] if history else new_record
    verified_count = sum(1 for h in history if h.get("verified"))
    local_correct = sum(1 for h in history if h.get("localCorrect"))
    cloud_correct = sum(1 for h in history if h.get("cloudCorrect"))

    data = {
        "symbol": symbol,
        "name": stock_name,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "latest": latest,
        "stats": {
            "total": len(history),
            "verified": verified_count,
            "localAccuracy": round(local_correct / verified_count * 100, 1) if verified_count > 0 else None,
            "cloudAccuracy": round(cloud_correct / verified_count * 100, 1) if verified_count > 0 else None,
        },
        "history": history,
    }

    # 6. 写入 JSON
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[Tracker] 预测跟踪记录已保存: {json_path}")
    print(f"[Tracker] 本地模型: {local_model['prediction']} (涨{local_model['upProbability']}%)")
    print(f"[Tracker] 云模型:   {cloud_pred['prediction']} (涨{cloud_pred['upProbability']}%)")
    print(f"[Tracker] 历史记录: {len(history)} 条，已验证 {verified_count} 条")

    return data


if __name__ == "__main__":
    # 测试
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    csv_path = os.path.join(os.path.dirname(__file__), "data", "002617_daily.csv")
    df = pd.read_csv(csv_path, encoding="utf-8-sig") if os.path.exists(csv_path) else pd.DataFrame()
    
    result = track_prediction(
        symbol="002617",
        stock_name="露笑科技",
        local_pred={"prediction": 0, "up_probability": 0.22, "down_probability": 0.78, "confidence": 0.78},
        df=df,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
