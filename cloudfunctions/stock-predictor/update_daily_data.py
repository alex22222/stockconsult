# -*- coding: utf-8 -*-
"""
每日数据更新脚本（增强版）
多数据源 + 多通道 + 自动重试 + 失败降级
"""

import pandas as pd
import baostock as bs
import akshare as ak
import os
import argparse
from datetime import datetime, timedelta
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

COLUMN_MAP = {
    'date': '日期', 'open': '开盘', 'high': '最高',
    'low': '最低', 'close': '收盘', 'volume': '成交量', 'amount': '成交额',
    'turn': '换手率', 'pctChg': '涨跌幅',
}

UPDATE_FAIL_FLAG = os.path.join(DATA_DIR, "update_failed.flag")


def set_update_failed(reason: str = ""):
    with open(UPDATE_FAIL_FLAG, 'w', encoding='utf-8') as f:
        f.write(f"{datetime.now().isoformat()}\n{reason}")
    logger.warning(f"标记今日数据更新失败: {reason}")


def clear_update_failed():
    if os.path.exists(UPDATE_FAIL_FLAG):
        os.remove(UPDATE_FAIL_FLAG)


def is_update_failed() -> bool:
    if not os.path.exists(UPDATE_FAIL_FLAG):
        return False
    with open(UPDATE_FAIL_FLAG, 'r', encoding='utf-8') as f:
        lines = f.read().strip().split('\n')
    if lines:
        fail_time = datetime.fromisoformat(lines[0])
        if fail_time.date() == datetime.now().date():
            return True
    return False


def get_last_date(csv_file: str) -> str:
    path = os.path.join(DATA_DIR, csv_file)
    if not os.path.exists(path):
        return "20230101"
    df = pd.read_csv(path, encoding='utf-8-sig')
    if df.empty:
        return "20230101"
    date_col = "日期" if "日期" in df.columns else "date"
    last = str(df[date_col].iloc[-1])
    return last.replace("-", "")


def get_next_date(csv_file: str) -> tuple:
    last_date = get_last_date(csv_file)
    next_date = (datetime.strptime(last_date, "%Y%m%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")
    return next_date, today


def fetch_from_baostock(code: str, start: str, end: str, fields: str, max_retries: int = 3) -> pd.DataFrame:
    for attempt in range(1, max_retries + 1):
        try:
            lg = bs.login()
            if lg.error_code != '0':
                logger.warning(f"baostock 登录失败 (尝试 {attempt}/{max_retries})")
                time.sleep(2)
                continue
            rs = bs.query_history_k_data_plus(code, fields, start_date=start, end_date=end, frequency='d', adjustflag='2')
            if rs is None:
                bs.logout()
                logger.warning(f"baostock 返回空 (尝试 {attempt}/{max_retries})")
                time.sleep(2)
                continue
            rows = []
            while (rs.error_code == '0') & rs.next():
                rows.append(rs.get_row_data())
            bs.logout()
            if not rows:
                return pd.DataFrame()
            df = pd.DataFrame(rows, columns=rs.fields)
            # 计算振幅和涨跌额
            df['preclose'] = df['preclose'].astype(float)
            df['open'] = df['open'].astype(float)
            df['high'] = df['high'].astype(float)
            df['low'] = df['low'].astype(float)
            df['close'] = df['close'].astype(float)
            df['volume'] = df['volume'].astype(float)
            df['amount'] = df['amount'].astype(float)
            if 'turn' in df.columns:
                df['turn'] = df['turn'].astype(float)
            df['pctChg'] = df['pctChg'].astype(float)
            df['amplitude'] = (df['high'] - df['low']) / df['preclose'] * 100
            df['change'] = df['close'] - df['preclose']
            # 重命名并选择标准列
            rename_map = {**COLUMN_MAP, 'amplitude': '振幅', 'change': '涨跌额'}
            df = df.rename(columns=rename_map)
            std_cols = ['日期', '开盘', '收盘', '最高', '最低', '成交量', '成交额', '振幅', '涨跌幅', '涨跌额', '换手率']
            df = df[[c for c in std_cols if c in df.columns]]
            logger.info(f"baostock 成功获取 {len(df)} 条")
            return df
        except Exception as e:
            logger.warning(f"baostock 异常 (尝试 {attempt}/{max_retries}): {e}")
            try:
                bs.logout()
            except:
                pass
            time.sleep(2)
    return pd.DataFrame()


def fetch_from_akshare_stock(symbol: str, start: str, end: str, max_retries: int = 3) -> pd.DataFrame:
    for attempt in range(1, max_retries + 1):
        try:
            df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start.replace("-", ""),
                                     end_date=end.replace("-", ""), adjust="qfq")
            if df is not None and not df.empty:
                logger.info(f"akshare 个股成功获取 {len(df)} 条")
                return df
        except Exception as e:
            logger.warning(f"akshare 个股异常 (尝试 {attempt}/{max_retries}): {str(e)[:80]}")
            time.sleep(2)
    return pd.DataFrame()


def fetch_from_akshare_index(index_symbol: str, start: str, end: str, max_retries: int = 3) -> pd.DataFrame:
    for attempt in range(1, max_retries + 1):
        try:
            df = ak.index_zh_a_hist(symbol=index_symbol, period="daily",
                                     start_date=start.replace("-", ""),
                                     end_date=end.replace("-", ""))
            if df is not None and not df.empty:
                logger.info(f"akshare 指数 {index_symbol} 成功获取 {len(df)} 条")
                return df
        except Exception as e:
            logger.warning(f"akshare 指数异常 (尝试 {attempt}/{max_retries}): {str(e)[:80]}")
            time.sleep(2)
    return pd.DataFrame()


def update_single_file(config: dict, global_attempt: int) -> tuple:
    csv_file = config['csv']
    path = os.path.join(DATA_DIR, csv_file)
    next_date, today = get_next_date(csv_file)

    if next_date > today:
        logger.info(f"[{csv_file}] 已是最新 ({get_last_date(csv_file)})")
        if os.path.exists(path):
            return pd.read_csv(path, encoding='utf-8-sig'), 0, True
        return pd.DataFrame(), 0, True

    if os.path.exists(path):
        existing = pd.read_csv(path, encoding='utf-8-sig')
    else:
        existing = pd.DataFrame()

    logger.info(f"[{csv_file}] 尝试 baostock: {next_date} ~ {today}")
    df = fetch_from_baostock(config['baostock_code'], next_date, today, config['fields'], max_retries=3)
    attempts = 3

    if not df.empty:
        pass
    elif next_date == today:
        logger.info(f"[{csv_file}] 今日数据尚未更新，跳过")
        return existing, attempts, True
    elif global_attempt + attempts < 10:
        logger.info(f"[{csv_file}] baostock 无数据，尝试 akshare...")
        if config.get('akshare_func'):
            df = config['akshare_func'](config['akshare_symbol'], next_date, today, max_retries=3)
            attempts += 3

    if df.empty:
        logger.warning(f"[{csv_file}] 所有数据源均失败 (累计尝试 {attempts} 次)")
        return existing, attempts, False

    combined = pd.concat([existing, df], ignore_index=True) if not existing.empty else df
    date_col = "日期" if "日期" in combined.columns else "date"
    combined.drop_duplicates(subset=[date_col], keep='last', inplace=True)
    combined.sort_values(date_col, inplace=True)
    combined.reset_index(drop=True, inplace=True)
    combined.to_csv(path, index=False, encoding='utf-8-sig')
    logger.info(f"[{csv_file}] 已保存，共 {len(combined)} 条")
    return combined, attempts, True


# 股票配置：个股代码 + 指数代码（指数是共用的）
STOCK_CONFIGS = [
    # 露笑科技
    {'csv': '002617_daily.csv', 'baostock_code': 'sz.002617',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '002617'},
    # 中国平安
    {'csv': '601318_daily.csv', 'baostock_code': 'sh.601318',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601318'},
    # 博士眼镜
    {'csv': '300622_daily.csv', 'baostock_code': 'sz.300622',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '300622'},
    # 中大力德
    {'csv': '002896_daily.csv', 'baostock_code': 'sz.002896',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '002896'},
    # === 模拟盘股票池（10只大市值股）===
    {'csv': '600519_daily.csv', 'baostock_code': 'sh.600519',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '600519'},
    {'csv': '601398_daily.csv', 'baostock_code': 'sh.601398',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601398'},
    {'csv': '601857_daily.csv', 'baostock_code': 'sh.601857',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601857'},
    {'csv': '601288_daily.csv', 'baostock_code': 'sh.601288',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601288'},
    {'csv': '601988_daily.csv', 'baostock_code': 'sh.601988',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601988'},
    {'csv': '601628_daily.csv', 'baostock_code': 'sh.601628',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601628'},
    {'csv': '600036_daily.csv', 'baostock_code': 'sh.600036',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '600036'},
    {'csv': '601088_daily.csv', 'baostock_code': 'sh.601088',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '601088'},
    {'csv': '600900_daily.csv', 'baostock_code': 'sh.600900',
     'fields': 'date,open,high,low,close,preclose,volume,amount,turn,pctChg',
     'akshare_func': fetch_from_akshare_stock, 'akshare_symbol': '600900'},
]

INDEX_CONFIGS = [
    {'csv': 'sh_index_000001.csv', 'baostock_code': 'sh.000001',
     'fields': 'date,open,high,low,close,preclose,volume,amount,pctChg',
     'akshare_func': fetch_from_akshare_index, 'akshare_symbol': '000001'},
    {'csv': 'sz_index_399001.csv', 'baostock_code': 'sz.399001',
     'fields': 'date,open,high,low,close,preclose,volume,amount,pctChg',
     'akshare_func': fetch_from_akshare_index, 'akshare_symbol': '399001'},
    {'csv': 'cy_index_399006.csv', 'baostock_code': 'sz.399006',
     'fields': 'date,open,high,low,close,preclose,volume,amount,pctChg',
     'akshare_func': fetch_from_akshare_index, 'akshare_symbol': '399006'},
]

CONFIGS = STOCK_CONFIGS + INDEX_CONFIGS


def update_all() -> bool:
    print(f"\n{'='*60}")
    print(f"  每日数据更新 ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})")
    print(f"{'='*60}\n")

    clear_update_failed()
    total_attempts = 0
    stock_success = False

    stock_cfgs = [c for c in CONFIGS if c.get('akshare_func') == fetch_from_akshare_stock]
    for cfg in CONFIGS:
        if total_attempts >= 50:
            logger.error(f"累计尝试已达 {total_attempts} 次上限，终止更新")
            break
        _, attempts, success = update_single_file(cfg, total_attempts)
        total_attempts += attempts
        # 任意一个个股数据更新成功即算成功
        if cfg in stock_cfgs and success:
            stock_success = True

    print(f"\n{'='*60}")
    if stock_success:
        print(f"  数据更新完成 (累计尝试 {total_attempts} 次)")
        print(f"{'='*60}\n")
        return True
    else:
        reason = f"个股数据更新失败，累计尝试 {total_attempts} 次，所有数据源均不可用"
        set_update_failed(reason)
        print(f"  ✗ {reason}")
        print(f"  今日数据更新失败，无法预测")
        print(f"{'='*60}\n")
        return False


def check_status():
    print("=== 数据状态检查 ===")
    for cfg in CONFIGS:
        fname = cfg['csv']
        last = get_last_date(fname)
        path = os.path.join(DATA_DIR, fname)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        print(f"  {fname}: 最新日期 {last} | 大小 {size/1024:.1f} KB")
    if is_update_failed():
        print(f"\n  ⚠ 今日更新失败标记存在")
        with open(UPDATE_FAIL_FLAG, 'r') as f:
            print(f"    {f.read().strip()}")
    else:
        print(f"\n  ✓ 今日无更新失败标记")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="每日数据更新（增强版）")
    parser.add_argument("--check", action="store_true", help="只检查状态，不更新")
    args = parser.parse_args()
    if args.check:
        check_status()
    else:
        success = update_all()
        exit(0 if success else 1)
