# -*- coding: utf-8 -*-
"""
本地数据供给模块
==============

当网络不稳定或需要完全离线训练时，从本地 CSV 文件加载数据。

数据目录结构:
    data/
      ├── {symbol}_daily.csv          # 个股日线
      ├── {symbol}_fund_flow.csv      # 个股资金流向
      ├── sh_index_000001.csv         # 上证指数
      ├── sz_index_399001.csv         # 深证成指
      ├── cy_index_399006.csv         # 创业板指
      └── sector_fund_flow.csv        # 板块资金流向

CSV 格式要求:
    个股日线: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
    指数日线: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额
    资金流向: 日期,主力净流入-净额,主力净流入-净占比,超大单净流入-净额,大单净流入-净额,小单净流入-净额
"""

import pandas as pd
import numpy as np
import os
from typing import Dict, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class LocalDataProvider:
    """本地数据供给器"""

    def __init__(self, data_dir: str = None):
        self.data_dir = data_dir or DATA_DIR
        os.makedirs(self.data_dir, exist_ok=True)
        logger.info(f"LocalDataProvider 初始化完成，数据目录: {self.data_dir}")

    def _load_csv(self, filename: str) -> pd.DataFrame:
        """加载本地 CSV"""
        filepath = os.path.join(self.data_dir, filename)
        if not os.path.exists(filepath):
            return pd.DataFrame()
        try:
            df = pd.read_csv(filepath, encoding='utf-8-sig')
            # 标准化列名
            df.columns = [c.strip() for c in df.columns]
            if '日期' in df.columns:
                df['日期'] = pd.to_datetime(df['日期'])
            return df
        except Exception as e:
            logger.warning(f"加载 {filename} 失败: {e}")
            return pd.DataFrame()

    def get_stock_daily(self, symbol: str) -> pd.DataFrame:
        """获取个股日线"""
        df = self._load_csv(f"{symbol}_daily.csv")
        if not df.empty:
            logger.info(f"从本地加载个股 {symbol}: {len(df)} 条")
        return df

    def get_index_daily(self, index_symbol: str = "000001") -> pd.DataFrame:
        """获取指数日线"""
        name_map = {
            "000001": "sh_index_000001",
            "399001": "sz_index_399001",
            "399006": "cy_index_399006",
        }
        filename = f"{name_map.get(index_symbol, index_symbol)}.csv"
        df = self._load_csv(filename)
        if not df.empty:
            logger.info(f"从本地加载指数 {index_symbol}: {len(df)} 条")
        return df

    def get_stock_fund_flow(self, symbol: str) -> pd.DataFrame:
        """获取个股资金流向"""
        df = self._load_csv(f"{symbol}_fund_flow.csv")
        if not df.empty:
            logger.info(f"从本地加载资金流向 {symbol}: {len(df)} 条")
        return df

    def get_sector_fund_flow(self) -> pd.DataFrame:
        """获取板块资金流向"""
        return self._load_csv("sector_fund_flow.csv")

    def get_us_overnight(self) -> pd.DataFrame:
        """获取隔夜美股数据"""
        return self._load_csv("us_overnight.csv")

    def get_northbound_money(self) -> pd.DataFrame:
        """获取北向资金数据"""
        return self._load_csv("northbound_money.csv")

    def get_zt_pool(self) -> pd.DataFrame:
        """获取涨跌停家数数据"""
        return self._load_csv("zt_pool.csv")

    def get_bond_yield(self) -> pd.DataFrame:
        """获取国债收益率数据"""
        return self._load_csv("bond_yield.csv")

    def get_all_data_for_stock(self, symbol: str, days: int = 252) -> Dict[str, pd.DataFrame]:
        """获取单股全维度数据（本地版）"""
        data = {}
        data["stock_daily"] = self.get_stock_daily(symbol)
        data["sh_index"] = self.get_index_daily("000001")
        data["sz_index"] = self.get_index_daily("399001")
        data["cy_index"] = self.get_index_daily("399006")
        data["fund_flow"] = self.get_stock_fund_flow(symbol)
        data["sector_fund_flow"] = self.get_sector_fund_flow()
        data["market_breadth"] = {}
        data["us_overnight"] = self.get_us_overnight()
        data["northbound_money"] = self.get_northbound_money()
        data["zt_pool"] = self.get_zt_pool()
        data["bond_yield"] = self.get_bond_yield()
        return data


def generate_mock_data(symbol: str = "002617", days: int = 300, seed: int = 42) -> pd.DataFrame:
    """
    生成模拟 K 线数据（用于测试）
    
    模拟露笑科技风格：高波动、中小盘特征
    """
    np.random.seed(seed)
    
    end_date = datetime.now()
    # 生成连续的日期，不需要严格匹配交易日（模拟数据）
    dates = pd.date_range(end=end_date, periods=days, freq='D')
    
    # 起始价格约 7.5 元（接近露笑科技近期价格）
    price = 7.5
    opens, closes, highs, lows, volumes = [], [], [], [], []
    
    for i in range(days):
        # 日内波动 2-5%
        daily_vol = np.random.uniform(0.02, 0.05)
        # 趋势偏移（轻微随机游走）
        trend = np.random.normal(0, 0.008)
        
        open_p = price * (1 + np.random.normal(0, 0.005))
        close_p = open_p * (1 + trend + np.random.normal(0, 0.01))
        high_p = max(open_p, close_p) * (1 + abs(np.random.normal(0, daily_vol / 2)))
        low_p = min(open_p, close_p) * (1 - abs(np.random.normal(0, daily_vol / 2)))
        
        # 成交量与波动正相关
        vol = int(np.random.uniform(50, 200) * 1e6 * (1 + abs(trend) * 10))
        
        opens.append(round(open_p, 2))
        closes.append(round(close_p, 2))
        highs.append(round(high_p, 2))
        lows.append(round(low_p, 2))
        volumes.append(vol)
        
        price = close_p
    
    df = pd.DataFrame({
        '日期': dates.strftime('%Y-%m-%d').values,
        '股票代码': symbol,
        '开盘': opens,
        '收盘': closes,
        '最高': highs,
        '最低': lows,
        '成交量': volumes,
        '成交额': [round(v * c, 2) for v, c in zip(volumes, closes)],
        '振幅': [round((h - l) / l * 100, 2) for h, l in zip(highs, lows)],
        '涨跌幅': [round((c - o) / o * 100, 2) for c, o in zip(closes, opens)],
        '涨跌额': [round(c - o, 2) for c, o in zip(closes, opens)],
        '换手率': [round(np.random.uniform(3, 15), 2) for _ in range(days)],
    })
    
    return df


def generate_mock_index(index_symbol: str = "000001", days: int = 300, seed: int = 43) -> pd.DataFrame:
    """生成模拟指数数据"""
    np.random.seed(seed)
    
    end_date = datetime.now()
    dates = pd.date_range(end=end_date, periods=days, freq='D')
    
    price = 3200 if index_symbol == "000001" else 10000 if index_symbol == "399001" else 2000
    opens, closes, highs, lows, volumes = [], [], [], [], []
    
    for i in range(days):
        trend = np.random.normal(0, 0.005)
        open_p = price * (1 + np.random.normal(0, 0.003))
        close_p = open_p * (1 + trend)
        high_p = max(open_p, close_p) * (1 + abs(np.random.normal(0, 0.008)))
        low_p = min(open_p, close_p) * (1 - abs(np.random.normal(0, 0.008)))
        
        opens.append(round(open_p, 2))
        closes.append(round(close_p, 2))
        highs.append(round(high_p, 2))
        lows.append(round(low_p, 2))
        volumes.append(int(np.random.uniform(100, 500) * 1e8))
        
        price = close_p
    
    return pd.DataFrame({
        '日期': dates.strftime('%Y-%m-%d').values,
        '开盘': opens,
        '收盘': closes,
        '最高': highs,
        '最低': lows,
        '成交量': volumes,
        '成交额': [round(v * c, 2) for v, c in zip(volumes, closes)],
        '振幅': [round((h - l) / l * 100, 2) for h, l in zip(highs, lows)],
        '涨跌幅': [round((c - o) / o * 100, 2) for c, o in zip(closes, opens)],
        '涨跌额': [round(c - o, 2) for c, o in zip(closes, opens)],
    })


def prepare_local_mock_data(symbol: str = "002617", days: int = 300):
    """
    准备本地模拟数据（用于离线测试）
    
    Usage:
        from local_data_provider import prepare_local_mock_data
        prepare_local_mock_data("002617", 300)
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # 个股数据
    stock_df = generate_mock_data(symbol, days)
    stock_df.to_csv(os.path.join(DATA_DIR, f"{symbol}_daily.csv"), index=False, encoding='utf-8-sig')
    print(f"生成模拟个股数据: {len(stock_df)} 条 -> {symbol}_daily.csv")
    
    # 指数数据
    for idx, name in [("000001", "sh_index_000001"), ("399001", "sz_index_399001"), ("399006", "cy_index_399006")]:
        idx_df = generate_mock_index(idx, days, seed=43 + int(idx))
        idx_df.to_csv(os.path.join(DATA_DIR, f"{name}.csv"), index=False, encoding='utf-8-sig')
        print(f"生成模拟指数数据: {len(idx_df)} 条 -> {name}.csv")
    
    print(f"\n所有模拟数据已保存到: {DATA_DIR}")
    print("现在可以使用 LocalDataProvider 进行离线训练")


if __name__ == "__main__":
    prepare_local_mock_data("002617", 300)
