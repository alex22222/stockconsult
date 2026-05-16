# -*- coding: utf-8 -*-
"""
市场情绪数据获取 — 北向资金 + 融资融券 + 涨跌停 + 国债收益率
"""
import os
import pandas as pd
import akshare as ak
from datetime import datetime, timedelta
import logging
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)


def safe_fetch(func, *args, max_retries=3, **kwargs):
    """带重试的数据获取"""
    for attempt in range(1, max_retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger.warning(f"{func.__name__} 失败 (尝试 {attempt}/{max_retries}): {e}")
            time.sleep(2)
    return pd.DataFrame()


def fetch_northbound_money():
    """获取北向资金（沪股通+深股通）历史数据"""
    logger.info("获取北向资金数据...")
    
    # 沪股通
    df_sh = safe_fetch(ak.stock_hsgt_hist_em, symbol='沪股通')
    # 深股通
    df_sz = safe_fetch(ak.stock_hsgt_hist_em, symbol='深股通')
    
    if df_sh.empty and df_sz.empty:
        logger.warning("北向资金获取失败")
        return pd.DataFrame()
    
    # 合并
    result = []
    for df, name in [(df_sh, 'sh'), (df_sz, 'sz')]:
        if df.empty:
            continue
        df = df.copy()
        df.columns = [c.strip() for c in df.columns]
        if '日期' in df.columns:
            df['日期'] = pd.to_datetime(df['日期'])
        result.append(df[['日期', '当日成交净买额', '买入成交额', '卖出成交额']].rename(columns={
            '当日成交净买额': f'{name}_net_buy',
            '买入成交额': f'{name}_buy',
            '卖出成交额': f'{name}_sell',
        }))
    
    if not result:
        return pd.DataFrame()
    
    merged = result[0]
    for r in result[1:]:
        merged = pd.merge(merged, r, on='日期', how='outer')
    
    merged = merged.sort_values('日期').reset_index(drop=True)
    merged['total_net_buy'] = merged.get('sh_net_buy', 0) + merged.get('sz_net_buy', 0)
    merged['total_buy'] = merged.get('sh_buy', 0) + merged.get('sz_buy', 0)
    merged['total_sell'] = merged.get('sh_sell', 0) + merged.get('sz_sell', 0)
    
    # 计算滚动指标
    merged['net_buy_ma5'] = merged['total_net_buy'].rolling(5).mean()
    merged['net_buy_ma20'] = merged['total_net_buy'].rolling(20).mean()
    merged['net_buy_cum5'] = merged['total_net_buy'].rolling(5).sum()
    
    return merged


def fetch_margin_trading():
    """获取融资融券数据（沪市+深市汇总）"""
    logger.info("获取融资融券数据...")
    
    # 尝试获取最近两年的数据
    end = datetime.now()
    start = end - timedelta(days=730)
    
    dates = pd.date_range(start=start, end=end, freq='D')
    all_data = []
    
    for d in dates:
        date_str = d.strftime('%Y%m%d')
        # 沪市
        df_sh = safe_fetch(ak.stock_margin_detail_szse, date=date_str)
        if not df_sh.empty:
            df_sh['date'] = d
            df_sh['market'] = 'sh'
            all_data.append(df_sh)
        # 深市
        df_sz = safe_fetch(ak.stock_margin_detail_szse, date=date_str)
        if not df_sz.empty:
            df_sz['date'] = d
            df_sz['market'] = 'sz'
            all_data.append(df_sz)
    
    if not all_data:
        logger.warning("融资融券数据获取失败")
        return pd.DataFrame()
    
    combined = pd.concat(all_data, ignore_index=True)
    # 按日期汇总
    daily = combined.groupby('date').agg({
        '融资买入额': 'sum',
        '融资余额': 'sum',
        '融券卖出量': 'sum',
        '融券余量': 'sum',
    }).reset_index()
    daily.columns = ['date', 'margin_buy', 'margin_balance', 'short_sell', 'short_balance']
    daily['margin_net'] = daily['margin_buy'] - daily['short_sell']
    daily = daily.sort_values('date').reset_index(drop=True)
    
    # 计算变化率
    daily['margin_balance_chg'] = daily['margin_balance'].pct_change() * 100
    daily['margin_net_ma5'] = daily['margin_net'].rolling(5).mean()
    
    return daily


def fetch_zt_pool():
    """获取每日涨跌停家数统计"""
    logger.info("获取涨跌停家数...")
    
    end = datetime.now()
    start = end - timedelta(days=365)
    
    dates = pd.date_range(start=start, end=end, freq='B')  # 工作日
    records = []
    
    for d in dates:
        date_str = d.strftime('%Y%m%d')
        try:
            df_zt = ak.stock_zt_pool_em(date=date_str)
            zt_count = len(df_zt) if df_zt is not None and not df_zt.empty else 0
            
            df_dt = ak.stock_zt_pool_dtgc_em(date=date_str)
            dt_count = len(df_dt) if df_dt is not None and not df_dt.empty else 0
            
            records.append({
                'date': d,
                'zt_count': zt_count,
                'dt_count': dt_count,
                'zt_dt_ratio': zt_count / max(dt_count, 1),
            })
        except Exception:
            pass
    
    if not records:
        return pd.DataFrame()
    
    df = pd.DataFrame(records).sort_values('date').reset_index(drop=True)
    df['zt_ma5'] = df['zt_count'].rolling(5).mean()
    df['dt_ma5'] = df['dt_count'].rolling(5).mean()
    df['zt_ma20'] = df['zt_count'].rolling(20).mean()
    
    return df


def fetch_bond_yield():
    """获取国债收益率"""
    logger.info("获取国债收益率...")
    df = safe_fetch(ak.bond_zh_us_rate)
    if df.empty:
        return pd.DataFrame()
    df = df.copy()
    df.columns = [c.strip() for c in df.columns]
    if '日期' in df.columns:
        df['日期'] = pd.to_datetime(df['日期'])
    # 只保留中国国债
    cn_cols = [c for c in df.columns if '中国' in c or c == '日期']
    df = df[cn_cols].copy()
    df = df.sort_values('日期').reset_index(drop=True)
    # 计算变化
    for col in df.columns:
        if col != '日期':
            df[f'{col}_chg_1d'] = df[col].diff()
            df[f'{col}_chg_5d'] = df[col].diff(5)
    return df


def main():
    """获取全部情绪数据并保存"""
    logger.info("=" * 60)
    logger.info("开始获取市场情绪数据")
    logger.info("=" * 60)
    
    # 1. 北向资金
    df_north = fetch_northbound_money()
    if not df_north.empty:
        df_north.to_csv(os.path.join(DATA_DIR, 'northbound_money.csv'), index=False, encoding='utf-8-sig')
        logger.info(f"北向资金已保存: {len(df_north)} 条")
    
    # 2. 融资融券（只获取最近几天的增量）
    # 由于获取太慢，先跳过全量，用已有数据或 mock
    logger.info("融资融券数据获取较慢，暂跳过（如需可后续增量更新）")
    
    # 3. 涨跌停
    df_zt = fetch_zt_pool()
    if not df_zt.empty:
        df_zt.to_csv(os.path.join(DATA_DIR, 'zt_pool.csv'), index=False, encoding='utf-8-sig')
        logger.info(f"涨跌停已保存: {len(df_zt)} 条")
    
    # 4. 国债收益率
    df_bond = fetch_bond_yield()
    if not df_bond.empty:
        df_bond.to_csv(os.path.join(DATA_DIR, 'bond_yield.csv'), index=False, encoding='utf-8-sig')
        logger.info(f"国债收益率已保存: {len(df_bond)} 条")
    
    logger.info("市场情绪数据获取完成")


if __name__ == "__main__":
    main()
