#!/usr/bin/env python3
"""
从 baostock 获取完整历史数据
=============================
覆盖 2022-08-01 至今的完整数据，替代 investoday 的短数据。
"""
import baostock as bs
import pandas as pd
import os
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

STOCKS = {
    "601318": ("sh.601318", "中国平安"),
    "300622": ("sz.300622", "博士眼镜"),
    "002896": ("sz.002896", "中大力德"),
    "002617": ("sz.002617", "露笑科技"),
}


def fetch_baostock(code: str, start: str, end: str) -> pd.DataFrame:
    """从 baostock 获取历史数据"""
    rs = bs.query_history_k_data_plus(code,
        "date,code,open,high,low,close,preclose,volume,amount,turn,pctChg",
        start_date=start, end_date=end, frequency="d", adjustflag="2")
    
    data_list = []
    while (rs.error_code == "0") & rs.next():
        data_list.append(rs.get_row_data())
    
    if not data_list:
        return pd.DataFrame()
    
    df = pd.DataFrame(data_list, columns=rs.fields)
    return df


def process_and_save(symbol: str, baostock_code: str, name: str) -> bool:
    """获取、处理并保存数据"""
    print(f"\n📊 {name} ({symbol})")
    
    df = fetch_baostock(baostock_code, "2022-08-01", datetime.now().strftime("%Y-%m-%d"))
    if df.empty:
        print(f"  ❌ 无数据")
        return False
    
    # 转换数据类型
    df["open"] = df["open"].astype(float)
    df["close"] = df["close"].astype(float)
    df["high"] = df["high"].astype(float)
    df["low"] = df["low"].astype(float)
    df["preclose"] = df["preclose"].astype(float)
    df["volume"] = df["volume"].astype(float)
    df["amount"] = df["amount"].astype(float)
    df["turn"] = df["turn"].astype(float)
    df["pctChg"] = df["pctChg"].astype(float)
    
    # 计算振幅和涨跌额
    df["amplitude"] = (df["high"] - df["low"]) / df["preclose"] * 100
    df["change"] = df["close"] - df["preclose"]
    
    # 映射到标准格式
    result = pd.DataFrame({
        "日期": df["date"],
        "开盘": df["open"],
        "收盘": df["close"],
        "最高": df["high"],
        "最低": df["low"],
        "成交量": df["volume"],
        "成交额": df["amount"],
        "振幅": df["amplitude"],
        "涨跌幅": df["pctChg"],
        "涨跌额": df["change"],
        "换手率": df["turn"],
    })
    
    # 保存
    csv_path = os.path.join(DATA_DIR, f"{symbol}_daily.csv")
    result.to_csv(csv_path, index=False, encoding="utf-8-sig")
    
    print(f"  ✅ 已保存: {csv_path}")
    print(f"  日期范围: {result['日期'].min()} ~ {result['日期'].max()} ({len(result)}行)")
    
    return True


def main():
    print("=" * 60)
    print("从 baostock 获取完整历史数据")
    print("=" * 60)
    
    lg = bs.login()
    if lg.error_code != "0":
        print(f"❌ baostock 登录失败: {lg.error_msg}")
        return
    
    print("baostock 登录成功")
    
    success = 0
    for sym, (bs_code, name) in STOCKS.items():
        if process_and_save(sym, bs_code, name):
            success += 1
    
    bs.logout()
    
    print(f"\n{'=' * 60}")
    print(f"✅ 更新完成: {success}/{len(STOCKS)} 只股票")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
