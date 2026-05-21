#!/usr/bin/env python3
"""
策略重建 — 每日执行记录
=======================
从今天开始，每日自动执行：
1. 获取非价格特征 (stock_score, news sentiment)
2. 训练回归模型
3. 预测未来5日收益率
4. 保存记录（用于5日后验证）

用法:
    python daily_rebuild_record.py --symbols 601318,300622,002896,002617
    python daily_rebuild_record.py --all
"""
import sys
import os
import json
import argparse
import warnings
from datetime import datetime, timedelta
import ssl

warnings.filterwarnings('ignore')
# 绕过 investoday API SSL 证书问题
ssl._create_default_https_context = ssl._create_unverified_context

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rebuild_predictor import (
    train_regression_model, predict_next_return,
    save_prediction_record, save_nonprice_features, load_nonprice_features,
    REBUILD_DIR, DATA_DIR, PREDICT_HORIZON,
)
from akshare_nonprice_provider import get_all_nonprice_features_ak

# API 配置 (本地直接调用 investoday API)
API_KEY = "cae27125ca0746c4b6ede2d77cd2dd11"
API_BASE = "https://data-api.investoday.net"

STOCKS = {
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
    "002617": "露笑科技",
}


def _call_api(tool_name: str, arguments: dict) -> dict:
    """通用 API 调用"""
    import urllib.request
    url = f"{API_BASE}/data/mcp/preset?apiKey={API_KEY}"
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments}
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            text = data.get("result", {}).get("content", [{}])[0].get("text", "")
            parsed = json.loads(text)
            if parsed.get("code") in ("Success", 0, "0"):
                return parsed.get("data", {})
    except Exception as e:
        print(f"  ⚠️ {tool_name} 失败: {e}")
    return {}


def fetch_stock_score(symbol: str) -> dict:
    """获取股票综合得分"""
    d = _call_api("get_stock_score", {"stockCode": symbol})
    if not d:
        return {}
    return {
        "score": float(d.get("score", 0)),
        "skillScore": float(d.get("skillScore", 0)),
        "emotionScore": float(d.get("emotionScore", 0)),
        "financeScore": float(d.get("financeScore", 0)),
        "industryScore": float(d.get("industryScore", 0)),
        "scoreAvg": float(d.get("scoreAvg", 0)),
    }


def fetch_news_sentiment(symbol: str, days: int = 7) -> dict:
    """获取股票相关新闻情绪"""
    end_date = datetime.now()
    begin_date = end_date - timedelta(days=days)
    d = _call_api("list_entity_related_news", {
        "stockCode": symbol,
        "beginDate": begin_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d"),
        "pageSize": 50,
    })
    if isinstance(d, list):
        items = d
    elif isinstance(d, dict):
        items = d.get("items", d.get("data", []))
    else:
        items = []
    if not items:
        return {}
    scores = [item.get("sentimentScore", 0) for item in items if item.get("sentimentScore") is not None]
    return {
        "news_count": len(items),
        "news_sentiment_mean": round(sum(scores) / len(scores), 4) if scores else 0,
        "news_sentiment_std": round((sum((s - sum(scores)/len(scores))**2 for s in scores) / len(scores)) ** 0.5, 4) if scores else 0,
        "news_sentiment_max": max(scores) if scores else 0,
        "news_sentiment_min": min(scores) if scores else 0,
    }


def fetch_valuation_ranks(symbol: str) -> dict:
    """获取估值指标的行业排名"""
    d = _call_api("get_stock_finance_valuation", {"stockCode": symbol})
    if not d:
        return {}
    # 提取所有 Rk 和 RkHist 字段
    ranks = {}
    for k, v in d.items():
        if k.endswith("Rk") and v is not None:
            ranks[f"val_{k}"] = float(v)
        if k.endswith("RkHist") and v is not None:
            ranks[f"val_{k}"] = float(v)
    return ranks


def fetch_profit_ranks(symbol: str) -> dict:
    """获取盈利能力指标的行业排名"""
    d = _call_api("get_stock_finance_profit_ability", {"stockCode": symbol})
    if not d:
        return {}
    ranks = {}
    for k, v in d.items():
        if k.endswith("Rk") and v is not None:
            ranks[f"prof_{k}"] = float(v)
        if k.endswith("RkHist") and v is not None:
            ranks[f"prof_{k}"] = float(v)
    return ranks


def fetch_performance_metrics(symbol: str) -> dict:
    """获取最新表现指标"""
    d = _call_api("list_stock_performance_metrics", {
        "stockCode": symbol,
        "beginDate": (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d"),
        "endDate": datetime.now().strftime("%Y-%m-%d"),
    })
    if isinstance(d, list) and len(d) > 0:
        latest = d[-1]
    elif isinstance(d, dict) and "data" in d:
        items = d["data"]
        latest = items[-1] if isinstance(items, list) and len(items) > 0 else {}
    else:
        latest = {}
    if not latest:
        return {}
    return {
        "perf_consecutive_days": float(latest.get("consecutiveChangeDays", 0)),
        "perf_consecutive_limit": float(latest.get("consecutiveLimitDays", 0)),
        "perf_is_hist_highlow": float(latest.get("isHistoricalHighLow", 0)),
        "perf_is_ytd_highlow": float(latest.get("isYtdHighLow", 0)),
        "perf_is_mtd_highlow": float(latest.get("isMtdHighLow", 0)),
        "perf_is_wtd_highlow": float(latest.get("isWtdHighLow", 0)),
    }


def daily_record(symbols: list):
    """每日执行主流程"""
    today = datetime.now().strftime("%Y-%m-%d")
    print("=" * 80)
    print(f"  策略重建 — 每日执行记录 | {today}")
    print("=" * 80)
    
    records = []
    
    for sym in symbols:
        name = STOCKS.get(sym, sym)
        print(f"\n📊 {name} ({sym})")
        
        # Step 1: 获取非价格特征（API失败时降级使用旧数据）
        print("  1. 获取非价格特征...")
        score = fetch_stock_score(sym)
        news = fetch_news_sentiment(sym)
        val_ranks = fetch_valuation_ranks(sym)
        prof_ranks = fetch_profit_ranks(sym)
        perf = fetch_performance_metrics(sym)
        
        nonprice = {**score, **news, **val_ranks, **prof_ranks, **perf}
        source = "investoday"
        
        if not nonprice:
            # investoday API 失败，尝试 AKShare 免费替代
            nonprice = get_all_nonprice_features_ak(sym)
            if nonprice:
                source = "akshare"
        
        if not nonprice:
            # 全部失败，尝试加载最近一次的非价格特征
            old = load_nonprice_features(sym)
            if not old.empty:
                last = old.iloc[[-1]].to_dict('records')[0]
                last.pop('date', None)
                nonprice = last
                source = "cached"
                print(f"     ⚠️ 所有数据源均失败，使用最近一次缓存的非价格特征 ({len(nonprice)}个)")
            else:
                print("     ⚠️ 非价格特征获取失败且无缓存")
        
        if nonprice and source != "cached":
            save_nonprice_features(sym, today, nonprice)
            feat_count = len(nonprice)
            print(f"     来源={source} score={nonprice.get('score','N/A')} emotion={nonprice.get('emotionScore','N/A')} finance={nonprice.get('financeScore','N/A')} news={nonprice.get('news_count',0)}条 | 总特征={feat_count}")
        
        # Step 2: 训练模型
        print("  2. 训练回归模型...")
        bundle = train_regression_model(sym)
        if "error" in bundle:
            print(f"     ❌ {bundle['error']}")
            continue
        
        print(f"     训练{bundle['train_size']}条 测试{bundle['test_size']}条 | 方向准确率={bundle['metrics']['ensemble']['direction_acc']:.1%}")
        
        # Step 3: 预测
        print("  3. 预测未来5日收益率...")
        pred = predict_next_return(sym, bundle)
        pred["name"] = name
        pred["recorded_at"] = datetime.now().isoformat()
        pred["nonprice_features"] = nonprice
        pred["model_metrics"] = bundle["metrics"]["ensemble"]
        pred["predict_horizon"] = PREDICT_HORIZON
        pred["verify_date"] = (datetime.now() + timedelta(days=PREDICT_HORIZON)).strftime("%Y-%m-%d")
        pred["verified"] = False
        pred["actual_return"] = None
        
        # 保存
        save_prediction_record(pred)
        
        action = "📈" if pred["anomaly_direction"] == "UP" else "📉" if pred["anomaly_direction"] == "DOWN" else "➖"
        horizon_label = "次日" if PREDICT_HORIZON == 1 else f"{PREDICT_HORIZON}日"
        print(f"     {action} 预测{horizon_label}收益率: {pred['predicted_return_5d']:+.2f}% | 异常检测: {pred['anomaly_direction']} | 置信度: {pred['confidence']:.2f}")
        
        records.append(pred)
    
    # 保存今日汇总
    summary_path = os.path.join(REBUILD_DIR, f"daily_summary_{today}.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({
            "date": today,
            "recorded_at": datetime.now().isoformat(),
            "predictions": records,
        }, f, ensure_ascii=False, indent=2)
    
    print("\n" + "=" * 80)
    print(f"✅ 已保存 {len(records)} 条预测记录")
    print(f"   历史记录: {os.path.join(REBUILD_DIR, 'prediction_history.json')}")
    print(f"   今日汇总: {summary_path}")
    print("=" * 80)
    return records


def verify_predictions():
    """验证过去已到期的预测"""
    history_path = os.path.join(REBUILD_DIR, "prediction_history.json")
    if not os.path.exists(history_path):
        return
    
    with open(history_path, "r", encoding="utf-8") as f:
        history = json.load(f)
    
    today = datetime.now().strftime("%Y-%m-%d")
    verified_count = 0
    
    for record in history:
        if record.get("verified") or not record.get("verify_date"):
            continue
        
        if today < record["verify_date"]:
            continue
        
        sym = record["symbol"]
        predict_date = record["date"]
        
        # 加载股价数据计算实际5日收益率
        import pandas as pd
        stock_path = os.path.join(DATA_DIR, f"{sym}_daily.csv")
        if not os.path.exists(stock_path):
            continue
        
        df = pd.read_csv(stock_path)
        df["日期"] = pd.to_datetime(df["日期"])
        
        pred_row = df[df["日期"] == pd.to_datetime(predict_date)]
        if pred_row.empty:
            continue
        
        pred_idx = pred_row.index[0]
        horizon = record.get("predict_horizon", PREDICT_HORIZON)
        if pred_idx + horizon >= len(df):
            continue
        
        pred_price = float(pred_row.iloc[0]["收盘"])
        actual_price = float(df.iloc[pred_idx + horizon]["收盘"])
        actual_return = (actual_price / pred_price - 1) * 100
        
        record["verified"] = True
        record["actual_return"] = round(actual_return, 4)
        record["prediction_error"] = round(record["predicted_return_5d"] - actual_return, 4)
        record["direction_correct"] = (record["predicted_return_5d"] > 0) == (actual_return > 0)
        
        verified_count += 1
    
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    
    if verified_count > 0:
        print(f"\n✅ 已验证 {verified_count} 条历史预测")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="策略重建每日执行记录")
    parser.add_argument("--symbols", type=str, default=",".join(STOCKS.keys()), help="股票代码，逗号分隔")
    parser.add_argument("--all", action="store_true", help="处理所有股票")
    parser.add_argument("--verify", action="store_true", help="只验证历史预测")
    
    args = parser.parse_args()
    
    if args.verify:
        verify_predictions()
    else:
        symbols = args.symbols.split(",") if args.symbols else list(STOCKS.keys())
        daily_record(symbols)
        verify_predictions()
