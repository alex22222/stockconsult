#!/usr/bin/env python3
#
# ⚠️ 警告：此脚本依赖的回测引擎存在未来函数问题
# ==================================================
# 详见 docs/prediction-model-sharp-review-2026-06-02.md
# 回测结果不可引用，不能作为策略有效性的证据
# 状态：保留以兼容现有流程，但不作为决策依据
#
"""
为回测引擎准备历史数据
通过 investoday MCP API (CloudBase 代理) 分批次获取个股历史数据
"""
import json
import urllib.request
import ssl
import pandas as pd
import numpy as np
import os
import sys

# macOS Python 3.14 SSL 证书问题
ssl_context = ssl._create_unverified_context()

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "cloudfunctions", "stock-predictor", "data")
os.makedirs(DATA_DIR, exist_ok=True)

API_URL = "https://stockconsult-d9g7b6ae5b8170e00.service.tcloudbase.com/investoday-proxy"

STOCKS = {
    "002617": "露笑科技",
    "601318": "中国平安",
    "300622": "博士眼镜",
    "002896": "中大力德",
}

# 分时间段获取，每段约 5 个月（API 限制 ~100 条）
RANGES = [
    ("2022-06-01", "2022-12-31"),
    ("2023-01-01", "2023-06-30"),
    ("2023-07-01", "2023-12-31"),
    ("2024-01-01", "2024-06-30"),
    ("2024-07-01", "2024-12-31"),
    ("2025-01-01", "2025-05-17"),
]


def fetch_quotes(stock_code: str, begin: str, end: str):
    """调用 investoday API 获取历史行情"""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "list_stock_adjusted_quotes",
            "arguments": {
                "stockCode": stock_code,
                "beginDate": begin,
                "endDate": end,
            }
        }
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl_context) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data.get("result", {})
            text = result.get("content", [{}])[0].get("text", "{}")
            parsed = json.loads(text)
            return parsed.get("data", [])
    except Exception as e:
        print(f"  ⚠️  {stock_code} {begin}~{end} 失败: {e}")
        return []


def convert_to_csv_format(records: list) -> pd.DataFrame:
    """将 investoday API 数据转换为回测引擎期望的中文 CSV 格式"""
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    # investoday 字段 → CSV 字段
    df = df.rename(columns={
        "tradeDate": "日期",
        "openPrice": "开盘",
        "closePrice": "收盘",
        "highPrice": "最高",
        "lowPrice": "最低",
        "volume": "成交量",
        "amount": "成交额",
        "changePct": "涨跌幅",
        "turnover": "换手率",
        "prevClosePrice": "前收盘",
    })

    df["日期"] = pd.to_datetime(df["日期"].str.split(" ").str[0])
    df = df.sort_values("日期").reset_index(drop=True)

    # 计算缺失字段
    df["涨跌额"] = df["收盘"] - df["前收盘"]
    df["振幅"] = (df["最高"] - df["最低"]) / (df["前收盘"] + 1e-10) * 100
    df["涨跌幅"] = df["涨跌幅"] * 100  # 小数转百分比
    df["换手率"] = df["换手率"] * 100   # 小数转百分比

    # 保留需要的列
    cols = ["日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额", "振幅", "涨跌幅", "涨跌额", "换手率"]
    return df[[c for c in cols if c in df.columns]]


def download_stock(stock_code: str, stock_name: str):
    print(f"📥 下载 {stock_code} {stock_name} ...")
    all_records = []
    for begin, end in RANGES:
        records = fetch_quotes(stock_code, begin, end)
        if records:
            all_records.extend(records)
            print(f"  ✅ {begin}~{end}: {len(records)} 条")
        else:
            print(f"  ❌ {begin}~{end}: 无数据")

    if not all_records:
        print(f"  ⚠️ {stock_code} 完全无数据，跳过")
        return

    df = convert_to_csv_format(all_records)
    # 去重（按日期）
    df = df.drop_duplicates(subset=["日期"], keep="first")
    df = df.sort_values("日期").reset_index(drop=True)

    filepath = os.path.join(DATA_DIR, f"{stock_code}_daily.csv")
    df.to_csv(filepath, index=False, encoding="utf-8-sig")
    print(f"  💾 保存到 {filepath} ({len(df)} 条)")


def generate_index_mock():
    """生成简化的指数 mock 数据（特征工程师中指数为可选，这里生成占位）"""
    print("📥 生成指数 mock 数据 ...")
    dates = pd.date_range(start="2022-06-01", end="2025-05-17", freq="B")  # 工作日
    for name, code in [("sh_index_000001", "000001"), ("sz_index_399001", "399001"), ("cy_index_399006", "399006")]:
        np.random.seed(42)
        base = 3000 if "sh" in name else 10000 if "sz" in name else 2000
        close = base + np.cumsum(np.random.randn(len(dates)) * 20)
        open_p = close + np.random.randn(len(dates)) * 10
        high = np.maximum(open_p, close) + np.random.exponential(15, len(dates))
        low = np.minimum(open_p, close) - np.random.exponential(15, len(dates))
        df = pd.DataFrame({
            "日期": dates.strftime("%Y-%m-%d"),
            "开盘": open_p,
            "收盘": close,
            "最高": high,
            "最低": low,
            "成交量": np.random.randint(1e9, 5e9, len(dates)),
            "成交额": np.random.randint(1e10, 5e10, len(dates)),
            "振幅": (high - low) / (low + 1e-10) * 100,
            "涨跌幅": np.random.randn(len(dates)) * 1.5,
            "涨跌额": close - open_p,
        })
        filepath = os.path.join(DATA_DIR, f"{name}.csv")
        df.to_csv(filepath, index=False, encoding="utf-8-sig")
        print(f"  💾 {filepath} ({len(df)} 条)")


def main():
    print("=" * 60)
    print("回测数据准备脚本")
    print("=" * 60)

    for code, name in STOCKS.items():
        download_stock(code, name)

    generate_index_mock()

    print("\n✅ 数据准备完成，保存在:", DATA_DIR)
    print("   现在可以运行: python cloudfunctions/stock-predictor/backtest_engine.py")


if __name__ == "__main__":
    main()
