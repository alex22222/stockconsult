# -*- coding: utf-8 -*-
"""
获取全部历史数据 — 从上市/2000年至今
"""
import os
import pandas as pd
import baostock as bs
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

COLUMN_MAP = {
    'date': '日期', 'code': '股票代码', 'open': '开盘', 'high': '最高',
    'low': '最低', 'close': '收盘', 'volume': '成交量', 'amount': '成交额',
    'turn': '换手率', 'pctChg': '涨跌幅',
}

FIELDS = "date,code,open,high,low,close,volume,amount,turn,pctChg"

STOCKS = [
    {"code": "sz.002617", "name": "露笑科技", "csv": "002617_daily.csv"},
    {"code": "sh.601318", "name": "中国平安", "csv": "601318_daily.csv"},
    {"code": "sz.300622", "name": "博士眼镜", "csv": "300622_daily.csv"},
    {"code": "sz.002896", "name": "中大力德", "csv": "002896_daily.csv"},
]

INDICES = [
    {"code": "sh.000001", "name": "上证指数", "csv": "sh_index_000001.csv"},
    {"code": "sz.399001", "name": "深证成指", "csv": "sz_index_399001.csv"},
    {"code": "sz.399006", "name": "创业板指", "csv": "cy_index_399006.csv"},
]


def fetch_baostock(code: str, start: str, end: str) -> pd.DataFrame:
    """从 baostock 获取历史数据"""
    rs = bs.query_history_k_data_plus(code, FIELDS, start_date=start, end_date=end, frequency='d', adjustflag='3')
    rows = []
    while (rs.error_code == '0') & rs.next():
        rows.append(rs.get_row_data())
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=rs.fields)
    df.rename(columns=COLUMN_MAP, inplace=True)
    # 数值列转换
    numeric_cols = ['开盘', '最高', '最低', '收盘', '成交量', '成交额', '换手率', '涨跌幅']
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df


def update_csv(csv_name: str, new_df: pd.DataFrame):
    """合并新旧数据到 CSV"""
    path = os.path.join(DATA_DIR, csv_name)
    if os.path.exists(path):
        old_df = pd.read_csv(path, encoding='utf-8-sig')
        old_df['日期'] = old_df['日期'].astype(str)
        new_df['日期'] = new_df['日期'].astype(str)
        # 去重合并
        combined = pd.concat([old_df, new_df], ignore_index=True)
        combined = combined.drop_duplicates(subset=['日期'], keep='last')
        combined = combined.sort_values('日期').reset_index(drop=True)
    else:
        combined = new_df.sort_values('日期').reset_index(drop=True)
    combined.to_csv(path, index=False, encoding='utf-8-sig')
    return len(combined)


def main():
    lg = bs.login()
    if lg.error_code != '0':
        logger.error("baostock 登录失败")
        return

    end = datetime.now().strftime("%Y-%m-%d")
    start = "2000-01-01"

    logger.info(f"获取历史数据范围: {start} ~ {end}")

    # 1. 个股
    for stock in STOCKS:
        logger.info(f"获取 {stock['name']}({stock['code']})...")
        df = fetch_baostock(stock['code'], start, end)
        if df.empty:
            logger.warning(f"  获取失败")
            continue
        count = update_csv(stock['csv'], df)
        logger.info(f"  已保存 {count} 条 -> {stock['csv']}")

    # 2. 指数
    for idx in INDICES:
        logger.info(f"获取 {idx['name']}({idx['code']})...")
        df = fetch_baostock(idx['code'], start, end)
        if df.empty:
            logger.warning(f"  获取失败")
            continue
        count = update_csv(idx['csv'], df)
        logger.info(f"  已保存 {count} 条 -> {idx['csv']}")

    bs.logout()
    logger.info("全部历史数据获取完成")


if __name__ == "__main__":
    main()
