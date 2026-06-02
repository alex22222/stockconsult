#!/usr/bin/env python3
"""
更新本地价格数据
================
从 investoday API 获取最新行情数据，更新本地 CSV 文件。
"""
import ssl
import json
import urllib.request
import pandas as pd
from datetime import datetime, timedelta
import os

ssl._create_default_https_context = ssl._create_unverified_context

API_KEY = "cae27125ca0746c4b6ede2d77cd2dd11"
API_BASE = "https://data-api.investoday.net"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

STOCKS = {
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
    "002617": "露笑科技",
}


def fetch_quotes(symbol: str) -> list:
    """从 investoday 获取复权行情数据"""
    url = f"{API_BASE}/data/mcp/preset?apiKey={API_KEY}"
    begin = (datetime.now() - timedelta(days=730)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "method": "tools/call",
        "params": {
            "name": "list_stock_adjusted_quotes",
            "arguments": {
                "stockCode": symbol,
                "beginDate": begin,
                "endDate": end,
            }
        }
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            text = data.get("result", {}).get("content", [{}])[0].get("text", "")
            parsed = json.loads(text)
            if parsed.get("code") in ("Success", 0, "0"):
                result = parsed.get("data", {})
                if isinstance(result, list):
                    return result
                elif isinstance(result, dict) and "data" in result:
                    return result["data"]
    except Exception as e:
        print(f"  ❌ {symbol} API 错误: {e}")
    return []


def update_csv(symbol: str, name: str) -> bool:
    """更新单只股票的 CSV 数据"""
    print(f"\n📊 {name} ({symbol})")
    
    # 获取 investoday 数据
    quotes = fetch_quotes(symbol)
    if not quotes:
        print(f"  ❌ 无数据")
        return False
    
    print(f"  获取到 {len(quotes)} 条记录")
    
    # 转换为 DataFrame
    df = pd.DataFrame(quotes)
    
    # 字段映射
    df["日期"] = pd.to_datetime(df["tradeDate"]).dt.strftime("%Y-%m-%d")
    df["开盘"] = df["openPrice"]
    df["收盘"] = df["closePrice"]
    df["最高"] = df["highPrice"]
    df["最低"] = df["lowPrice"]
    df["成交量"] = df["volume"]
    df["成交额"] = df["amount"]
    df["振幅"] = (df["highPrice"] - df["lowPrice"]) / df["prevClosePrice"] * 100
    df["涨跌幅"] = df["changePct"] * 100
    df["涨跌额"] = df["closePrice"] - df["prevClosePrice"]
    df["换手率"] = df["turnover"] * 100
    
    # 保留需要的列
    df = df[["日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额", "振幅", "涨跌幅", "涨跌额", "换手率"]]
    df = df.sort_values("日期")
    
    # 保存
    csv_path = os.path.join(DATA_DIR, f"{symbol}_daily.csv")
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    
    print(f"  ✅ 已更新: {csv_path}")
    print(f"  日期范围: {df['日期'].min()} ~ {df['日期'].max()} ({len(df)}行)")
    
    return True


def main():
    print("=" * 60)
    print("更新价格数据")
    print("=" * 60)
    
    success = 0
    for sym, name in STOCKS.items():
        if update_csv(sym, name):
            success += 1
    
    print(f"\n{'=' * 60}")
    print(f"✅ 更新完成: {success}/{len(STOCKS)} 只股票")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
