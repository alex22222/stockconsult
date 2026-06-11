#!/usr/bin/env python3
"""
每日舆情简报生成器
================
从 investoday API 获取持仓股票的新闻、评分、估值等数据，
生成每日舆情简报，支持发送到飞书。

用法:
    python daily_sentiment_report.py              # 生成本地简报
    python daily_sentiment_report.py --send       # 发送到飞书（需配置 WEBHOOK_URL）
    python daily_sentiment_report.py --webhook <url>  # 指定 webhook 发送
"""
import sys
import os
import json
import ssl
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

ssl._create_default_https_context = ssl._create_unverified_context

# ============ 配置 ============
API_KEY = "cae27125ca0746c4b6ede2d77cd2dd11"
API_BASE = "https://data-api.investoday.net"

STOCKS = {
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
    "002617": "露笑科技",
}

# 飞书配置（开放平台 API 方式）
FEISHU_APP_ID = os.environ.get("FEISHU_APP_ID", "cli_a97a5a0eb2385bb4")
FEISHU_APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "aOvQuzQv7LCp4HibMEWTMd0tvQICue0a")
FEISHU_CHAT_ID = os.environ.get("FEISHU_CHAT_ID", "oc_30d5acfaae4ea1eb5b66fc767d20399c")

# 情绪阈值
NEGATIVE_THRESHOLD = -0.3   # sentiment < -0.3 视为负面
POSITIVE_THRESHOLD = 0.3    # sentiment > 0.3 视为正面
SCORE_DROP_THRESHOLD = 10   # 评分下降超过 10 分预警


# ============ investoday API ============
def _call_api(tool_name: str, arguments: dict) -> dict:
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


def fetch_news(symbol: str, days: int = 1) -> List[dict]:
    end = datetime.now()
    begin = end - timedelta(days=days)
    d = _call_api("list_entity_related_news", {
        "stockCode": symbol,
        "beginDate": begin.strftime("%Y-%m-%d"),
        "endDate": end.strftime("%Y-%m-%d"),
        "pageSize": 20,
    })
    if isinstance(d, list):
        return d
    elif isinstance(d, dict):
        return d.get("items", d.get("data", []))
    return []


def fetch_valuation(symbol: str) -> dict:
    d = _call_api("get_stock_finance_valuation", {"stockCode": symbol})
    return d or {}


def fetch_performance(symbol: str) -> dict:
    d = _call_api("list_stock_performance_metrics", {
        "stockCode": symbol,
        "beginDate": (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d"),
        "endDate": datetime.now().strftime("%Y-%m-%d"),
    })
    if isinstance(d, list) and len(d) > 0:
        return d[-1]
    elif isinstance(d, dict) and "data" in d:
        items = d["data"]
        return items[-1] if isinstance(items, list) and len(items) > 0 else {}
    return {}


# ============ 简报生成 ============
def analyze_sentiment(news_items: List[dict]) -> Tuple[float, str, List[dict]]:
    """分析新闻情绪，返回 (mean_sentiment, sentiment_label, negative_items)"""
    scores = [float(item.get("sentimentScore", 0)) for item in news_items if item.get("sentimentScore") is not None]
    if not scores:
        return 0.0, "无数据", []
    mean = sum(scores) / len(scores)
    negative = [item for item in news_items if float(item.get("sentimentScore", 0)) < NEGATIVE_THRESHOLD]
    if mean < NEGATIVE_THRESHOLD:
        label = "🔴 负面"
    elif mean > POSITIVE_THRESHOLD:
        label = "🟢 正面"
    else:
        label = "🟡 中性"
    return round(mean, 3), label, negative


def score_grade(score: float) -> str:
    if score >= 80:
        return "🟢 优秀"
    elif score >= 60:
        return "🟡 良好"
    elif score >= 40:
        return "🟠 一般"
    else:
        return "🔴 偏弱"


def generate_report() -> dict:
    """生成每日舆情简报"""
    today = datetime.now().strftime("%Y-%m-%d")
    report = {
        "date": today,
        "generated_at": datetime.now().isoformat(),
        "stocks": [],
        "warnings": [],
        "market_sentiment": {"score": 0, "label": ""},
    }
    
    total_score = 0
    total_emotion = 0
    
    for sym, name in STOCKS.items():
        print(f"  📊 获取 {name} ({sym}) 数据...")
        
        # 获取数据
        score_data = fetch_stock_score(sym)
        news_items = fetch_news(sym, days=1)
        perf = fetch_performance(sym)
        
        # 分析情绪
        sentiment_mean, sentiment_label, negative_news = analyze_sentiment(news_items)
        
        # 构建个股报告
        stock_report = {
            "symbol": sym,
            "name": name,
            "score": score_data.get("score", 0),
            "score_grade": score_grade(score_data.get("score", 0)),
            "emotionScore": score_data.get("emotionScore", 0),
            "financeScore": score_data.get("financeScore", 0),
            "industryScore": score_data.get("industryScore", 0),
            "news_count": len(news_items),
            "sentiment_mean": sentiment_mean,
            "sentiment_label": sentiment_label,
            "negative_news": negative_news[:3],  # 最多3条负面
            "consecutive_days": int(perf.get("consecutiveChangeDays", 0)),
            "is_hist_high": perf.get("isHistoricalHighLow", 0) == 1,
            "is_hist_low": perf.get("isHistoricalHighLow", 0) == -1,
        }
        
        report["stocks"].append(stock_report)
        
        # 累计市场情绪
        total_score += score_data.get("score", 0)
        total_emotion += sentiment_mean
        
        # 预警
        if sentiment_mean < NEGATIVE_THRESHOLD:
            report["warnings"].append({
                "type": "情绪负面",
                "symbol": sym,
                "name": name,
                "value": sentiment_mean,
                "detail": f"新闻情绪 {sentiment_mean}，{len(negative_news)} 条负面新闻",
            })
        if score_data.get("financeScore", 50) < 40:
            report["warnings"].append({
                "type": "财务偏弱",
                "symbol": sym,
                "name": name,
                "value": score_data.get("financeScore", 0),
                "detail": f"财务评分 {score_data.get('financeScore', 0)}，低于行业平均",
            })
        if stock_report["is_hist_high"]:
            report["warnings"].append({
                "type": "历史新高",
                "symbol": sym,
                "name": name,
                "value": 0,
                "detail": "今日创历史新高，注意获利了结",
            })
        if stock_report["is_hist_low"]:
            report["warnings"].append({
                "type": "历史新低",
                "symbol": sym,
                "name": name,
                "value": 0,
                "detail": "今日创历史新低，注意止损",
            })
    
    # 市场情绪
    avg_score = total_score / len(STOCKS) if STOCKS else 0
    avg_emotion = total_emotion / len(STOCKS) if STOCKS else 0
    if avg_emotion < NEGATIVE_THRESHOLD:
        market_label = "🔴 偏空"
    elif avg_emotion > POSITIVE_THRESHOLD:
        market_label = "🟢 偏多"
    else:
        market_label = "🟡 中性"
    report["market_sentiment"] = {"score": round(avg_score, 1), "emotion": round(avg_emotion, 2), "label": market_label}
    
    return report


# ============ 格式化输出 ============
def format_text_report(report: dict) -> str:
    """格式化为文本简报"""
    lines = []
    lines.append("=" * 60)
    lines.append(f"📰 每日舆情简报 | {report['date']}")
    lines.append("=" * 60)
    lines.append("")
    
    # 市场情绪
    ms = report["market_sentiment"]
    lines.append(f"🌡️ 市场情绪: {ms['label']} | 综合评分: {ms['score']:.1f} | 情绪均值: {ms['emotion']:+.2f}")
    lines.append("")
    
    # 预警区
    if report["warnings"]:
        lines.append("⚠️ 今日预警")
        lines.append("-" * 40)
        for w in report["warnings"]:
            lines.append(f"  [{w['type']}] {w['name']} ({w['symbol']})")
            lines.append(f"    → {w['detail']}")
        lines.append("")
    
    # 个股详情
    for s in report["stocks"]:
        lines.append(f"📊 {s['name']} ({s['symbol']})")
        lines.append(f"  综合评分: {s['score']:.1f} {s['score_grade']}")
        lines.append(f"  情绪面: {s['emotionScore']:.1f} | 财务面: {s['financeScore']:.1f} | 行业面: {s['industryScore']:.1f}")
        lines.append(f"  新闻: {s['news_count']}条 | 情绪: {s['sentiment_label']} ({s['sentiment_mean']:+.2f})")
        if s["negative_news"]:
            lines.append("  🔴 负面新闻:")
            for news in s["negative_news"]:
                title = news.get("title", news.get("newsTitle", "未知标题"))[:40]
                sc = float(news.get("sentimentScore", 0))
                lines.append(f"    • {title}... (情绪:{sc:+.2f})")
        if s["is_hist_high"]:
            lines.append("  ⚠️ 今日创历史新高")
        if s["is_hist_low"]:
            lines.append("  ⚠️ 今日创历史新低")
        if s["consecutive_days"] > 0:
            lines.append(f"  📈 连续上涨 {s['consecutive_days']} 天")
        elif s["consecutive_days"] < 0:
            lines.append(f"  📉 连续下跌 {abs(s['consecutive_days'])} 天")
        lines.append("")
    
    lines.append("=" * 60)
    lines.append("💡 免责声明: 本简报仅供参考，不构成投资建议")
    lines.append("=" * 60)
    
    return "\n".join(lines)


def build_feishu_card(report: dict) -> dict:
    """构建飞书卡片消息"""
    ms = report["market_sentiment"]
    
    # 预警元素
    warning_elements = []
    if report["warnings"]:
        warning_text = "\n".join([f"• [{w['type']}] {w['name']}: {w['detail']}" for w in report["warnings"]])
        warning_elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": f"**⚠️ 今日预警 ({len(report['warnings'])}条)**\n{warning_text}"}
        })
        warning_elements.append({"tag": "hr"})
    
    # 个股元素
    stock_elements = []
    for s in report["stocks"]:
        # 情绪颜色
        if s["sentiment_mean"] < NEGATIVE_THRESHOLD:
            sentiment_color = "red"
        elif s["sentiment_mean"] > POSITIVE_THRESHOLD:
            sentiment_color = "green"
        else:
            sentiment_color = "grey"
        
        content = (
            f"**{s['name']}** ({s['symbol']})  {s['score_grade']}\n"
            f"评分: {s['score']:.1f} | 情绪: {s['emotionScore']:.1f} | 财务: {s['financeScore']:.1f}\n"
            f"新闻: {s['news_count']}条 | 情绪均值: <font color='{sentiment_color}'>{s['sentiment_mean']:+.2f}</font> {s['sentiment_label']}"
        )
        
        if s["negative_news"]:
            titles = [n.get("title", n.get("newsTitle", ""))[:25] + "..." for n in s["negative_news"][:2]]
            content += f"\n🔴 负面: {' / '.join(titles)}"
        if s["is_hist_high"]:
            content += "\n⚠️ 历史新高"
        if s["is_hist_low"]:
            content += "\n⚠️ 历史新低"
        if s["consecutive_days"] > 2:
            content += f"\n📈 连涨 {s['consecutive_days']} 天"
        elif s["consecutive_days"] < -2:
            content += f"\n📉 连跌 {abs(s['consecutive_days'])} 天"
        
        stock_elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": content}
        })
        stock_elements.append({"tag": "hr"})
    
    # 移除最后一个 hr
    if stock_elements and stock_elements[-1].get("tag") == "hr":
        stock_elements.pop()
    
    card = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": f"📰 每日舆情简报 | {report['date']}"},
                "template": "blue"
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"**🌡️ 市场情绪: {ms['label']}**\n综合评分: {ms['score']:.1f} | 情绪均值: {ms['emotion']:+.2f}"
                    }
                },
                {"tag": "hr"},
            ] + warning_elements + stock_elements + [
                {"tag": "hr"},
                {
                    "tag": "note",
                    "elements": [{"tag": "plain_text", "content": "💡 免责声明: 本简报仅供参考，不构成投资建议"}]
                }
            ]
        }
    }
    return card


# ============ 发送 ============
def _get_feishu_token() -> str:
    """获取飞书 tenant_access_token"""
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    payload = json.dumps({"app_id": FEISHU_APP_ID, "app_secret": FEISHU_APP_SECRET}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("tenant_access_token", "")
    except Exception as e:
        print(f"❌ 获取飞书 token 失败: {e}")
        return ""


def send_to_feishu(report: dict) -> bool:
    """通过飞书开放平台 API 发送简报"""
    token = _get_feishu_token()
    if not token:
        return False
    
    # 构建文本内容
    stocks_content = []
    for s in report["stocks"]:
        emoji = "🟢" if s["sentiment_mean"] > 0.3 else "🔴" if s["sentiment_mean"] < -0.3 else "🟡"
        warn = ""
        if s.get("is_hist_high"):
            warn += " ⚠️新高"
        if s.get("is_hist_low"):
            warn += " ⚠️新低"
        if s.get("consecutive_days", 0) > 2:
            warn += f" 📈连涨{s['consecutive_days']}天"
        elif s.get("consecutive_days", 0) < -2:
            warn += f" 📉连跌{abs(s['consecutive_days'])}天"
        
        stocks_content.append(
            f"**{s['name']}** ({s['symbol']}){warn}\n"
            f"评分: {s['score']:.1f} | 情绪: {s['emotionScore']:.1f} | 财务: {s['financeScore']:.1f}\n"
            f"新闻: {s['news_count']}条 | 情绪均值: {emoji} {s['sentiment_mean']:+.2f} {s['sentiment_label']}"
        )
    
    warnings_text = ""
    if report["warnings"]:
        warnings_text = "**⚠️ 今日预警**\n" + "\n".join([f"• [{w['type']}] {w['name']}: {w['detail']}" for w in report["warnings"]]) + "\n\n"
    
    ms = report["market_sentiment"]
    stocks_text = "\n\n".join(stocks_content)
    content = (
        f"📰 **每日舆情简报 | {report['date']}**\n\n"
        f"🌡️ **市场情绪: {ms['label']}** | 综合评分: {ms['score']:.1f} | 情绪均值: {ms['emotion']:+.2f}\n\n"
        f"{warnings_text}"
        f"{stocks_text}\n\n"
        f"💡 免责声明: 本简报仅供参考，不构成投资建议"
    )
    
    msg_url = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
    msg_payload = json.dumps({
        "receive_id": FEISHU_CHAT_ID,
        "msg_type": "text",
        "content": json.dumps({"text": content})
    }).encode("utf-8")
    req = urllib.request.Request(msg_url, data=msg_payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("code") == 0:
                print("✅ 简报已发送到飞书")
                return True
            else:
                print(f"❌ 飞书发送失败: {result}")
                return False
    except Exception as e:
        print(f"❌ 发送异常: {e}")
        return False


def save_report(report: dict):
    """保存报告到本地"""
    report_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "reports")
    os.makedirs(report_dir, exist_ok=True)
    path = os.path.join(report_dir, f"sentiment_report_{report['date']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    text_path = os.path.join(report_dir, f"sentiment_report_{report['date']}.txt")
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(format_text_report(report))
    
    print(f"\n📁 报告已保存:")
    print(f"   JSON: {path}")
    print(f"   TXT:  {text_path}")


# ============ 主入口 ============
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="每日舆情简报")
    parser.add_argument("--send", action="store_true", help="发送到飞书")
    parser.add_argument("--no-send", action="store_true", help="只生成本地简报，不发送")
    args = parser.parse_args()
    
    print("=" * 60)
    print("📰 生成每日舆情简报...")
    print("=" * 60)
    
    report = generate_report()
    save_report(report)
    
    # 打印文本版
    print("\n" + format_text_report(report))
    
    # 发送飞书
    if args.send and not args.no_send:
        print("\n📤 正在发送到飞书...")
        send_to_feishu(report)
    
    # 同步到 COS
    print("\n" + "="*50)
    print("[COS] 同步舆情报告到云端...")
    print("="*50)
    import subprocess
    upload_script = os.path.join(os.path.dirname(__file__), "upload_to_cos.py")
    result = subprocess.run([sys.executable, upload_script, "reports"], capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(f"[COS] 同步失败: {result.stderr}")
