# -*- coding: utf-8 -*-
"""
每日数据更新脚本
================

用法:
    python update_daily_data.py           # 更新所有数据
    python update_daily_data.py --check   # 只检查最新数据日期

功能:
    1. 用 baostock 拉取最新行情
    2. 自动追加到本地 CSV（去重）
    3. 支持个股 + 三大指数

可加入 crontab 每日自动执行:
    0 16 * * * cd /path/to/stock-predictor && source venv/bin/activate && python update_daily_data.py >> logs/data_update.log 2>&1
"""

import pandas as pd
import baostock as bs
import os
import argparse
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# baostock 英文列名 → 训练代码期望的中文列名
COLUMN_MAP = {
    'date': '日期',
    'code': '股票代码',
    'open': '开盘',
    'high': '最高',
    'low': '最低',
    'close': '收盘',
    'volume': '成交量',
    'amount': '成交额',
    'turn': '换手率',
    'pctChg': '涨跌幅',
}


def get_last_date(csv_file: str) -> str:
    """获取 CSV 中最新日期"""
    path = os.path.join(DATA_DIR, csv_file)
    if not os.path.exists(path):
        return "2023-01-01"
    df = pd.read_csv(path, encoding='utf-8-sig')
    if df.empty:
        return "2023-01-01"
    date_col = "日期" if "日期" in df.columns else "date"
    last = str(df[date_col].iloc[-1])
    # 统一转为 YYYYMMDD
    return last.replace("-", "")


def append_new_data(code: str, csv_file: str, fields: str):
    """
    下载新数据并追加到 CSV（统一使用中文列名）
    """
    path = os.path.join(DATA_DIR, csv_file)
    
    # 1. 读取现有数据
    if os.path.exists(path):
        existing = pd.read_csv(path, encoding='utf-8-sig')
    else:
        existing = pd.DataFrame()
    
    # 2. 确定起始日期
    last_date = get_last_date(csv_file)
    # baostock 需要 YYYY-MM-DD 格式
    start = (datetime.strptime(last_date, "%Y%m%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")
    
    if start > end:
        print(f"  [{csv_file}] 数据已是最新，无需更新 (最后日期: {last_date})")
        return existing
    
    print(f"  [{csv_file}] 拉取 {start} ~ {end} 的数据...")
    
    # 3. 登录并拉取
    lg = bs.login()
    if lg.error_code != '0':
        print(f"  baostock 登录失败: {lg.error_msg}")
        return existing
    
    rs = bs.query_history_k_data_plus(code, fields,
        start_date=start, end_date=end,
        frequency='d', adjustflag='3')
    
    if rs is None:
        print(f"  [{csv_file}] baostock 返回空，可能今天无交易数据")
        bs.logout()
        return existing
    
    new_rows = []
    while (rs.error_code == '0') & rs.next():
        new_rows.append(rs.get_row_data())
    bs.logout()
    
    if not new_rows:
        print(f"  [{csv_file}] 无新数据（可能今天非交易日或数据未更新）")
        return existing
    
    # 4. 新数据转为中文列名
    new_df = pd.DataFrame(new_rows, columns=rs.fields)
    new_df.rename(columns=COLUMN_MAP, inplace=True)
    print(f"  [{csv_file}] 获取到 {len(new_df)} 条新数据")
    
    # 5. 合并并保存
    if existing.empty:
        combined = new_df
    else:
        combined = pd.concat([existing, new_df], ignore_index=True)
    
    # 去重（按日期）
    combined.drop_duplicates(subset=['日期'], keep='last', inplace=True)
    combined.sort_values('日期', inplace=True)
    combined.reset_index(drop=True, inplace=True)
    
    combined.to_csv(path, index=False, encoding='utf-8-sig')
    print(f"  [{csv_file}] 已保存，共 {len(combined)} 条")
    return combined


def update_all():
    """更新所有数据"""
    print(f"=== 每日数据更新 ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')}) ===")
    
    # 个股
    append_new_data('sz.002617', '002617_daily.csv',
        'date,code,open,high,low,close,volume,amount,turn,pctChg')
    
    # 指数
    for code, fname in [
        ('sh.000001', 'sh_index_000001.csv'),
        ('sz.399001', 'sz_index_399001.csv'),
        ('sz.399006', 'cy_index_399006.csv'),
    ]:
        append_new_data(code, fname, 'date,open,high,low,close,volume,amount,pctChg')
    
    print("=== 更新完成 ===")


def check_status():
    """检查各数据文件的最新日期"""
    print("=== 数据状态检查 ===")
    for fname in ['002617_daily.csv', 'sh_index_000001.csv', 'sz_index_399001.csv', 'cy_index_399006.csv']:
        last = get_last_date(fname)
        path = os.path.join(DATA_DIR, fname)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        print(f"  {fname}: 最新日期 {last} | 文件大小 {size/1024:.1f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="每日数据更新")
    parser.add_argument("--check", action="store_true", help="只检查状态，不更新")
    args = parser.parse_args()
    
    if args.check:
        check_status()
    else:
        update_all()
