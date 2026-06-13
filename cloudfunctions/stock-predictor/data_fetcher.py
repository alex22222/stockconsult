# -*- coding: utf-8 -*-
"""
数据获取模块 - 多因子数据采集
使用AKShare作为主要数据源，Tushare作为备用
覆盖：个股行情、大盘指数、资金流向、板块数据、技术指标等
"""

import akshare as ak
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List
import logging
import os
import pickle
import time

# Tushare为可选依赖
try:
    import tushare as ts
    TUSHARE_AVAILABLE = True
except ImportError:
    TUSHARE_AVAILABLE = False
    ts = None

from config import DATA_CONFIG, INDEX_CODES, DEMO_STOCK
from local_data_provider import LocalDataProvider

logger = logging.getLogger(__name__)


class DataFetcher:
    """
    A股多因子数据获取器
    支持个股行情、大盘环境、资金流向、板块热度等全维度数据获取
    """
    
    def __init__(self, token: str = None):
        self.token = token or DATA_CONFIG["tushare_token"]
        self.pro = None
        if self.token and TUSHARE_AVAILABLE and ts is not None:
            try:
                ts.set_token(self.token)
                self.pro = ts.pro_api()
            except Exception as e:
                logger.warning(f"Tushare初始化失败: {e}")
                self.pro = None
            
        self.cache = {}
        self.cache_time = {}
        logger.info("DataFetcher初始化完成")
    
    def _safe_call(self, func, max_retries: int = 3, *args, **kwargs):
        """安全调用AKShare接口，带重试"""
        for attempt in range(max_retries):
            try:
                result = func(*args, **kwargs)
                if result is not None and (isinstance(result, pd.DataFrame) and not result.empty):
                    return result
                elif isinstance(result, dict) and result:
                    return result
            except Exception as e:
                logger.warning(f"调用失败 (尝试 {attempt+1}/{max_retries}): {str(e)[:100]}")
                if attempt < max_retries - 1:
                    time.sleep(1)
        return None
    
    # ==================== 1. 个股基础行情数据 ====================
    
    def get_stock_daily(self, symbol: str, start_date: str = None, end_date: str = None, 
                       adjust: str = "qfq") -> pd.DataFrame:
        """获取个股日线行情数据"""
        if end_date is None:
            end_date = datetime.now().strftime("%Y%m%d")
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=DATA_CONFIG["history_years"] * 365)).strftime("%Y%m%d")
        
        result = self._safe_call(
            ak.stock_zh_a_hist,
            3,
            symbol=symbol, period="daily", start_date=start_date, 
            end_date=end_date, adjust=adjust
        )
        
        if result is not None:
            result.columns = [col.strip() if isinstance(col, str) else col for col in result.columns]
            return result
        
        return pd.DataFrame()
    
    # ==================== 2. 大盘市场环境数据 ====================
    
    def get_index_daily(self, index_symbol: str = "000001", start_date: str = None, 
                       end_date: str = None) -> pd.DataFrame:
        """获取大盘指数日线数据"""
        if end_date is None:
            end_date = datetime.now().strftime("%Y%m%d")
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=DATA_CONFIG["history_years"] * 365)).strftime("%Y%m%d")
        
        result = self._safe_call(
            ak.index_zh_a_hist,
            3,
            symbol=index_symbol, period="daily", start_date=start_date, end_date=end_date
        )
        
        return result if result is not None else pd.DataFrame()
    
    def get_market_breadth(self) -> Dict:
        """获取市场广度指标"""
        result = self._safe_call(ak.stock_zh_a_spot_em, 3)
        
        if result is not None and not result.empty:
            df = result
            up_count = len(df[df["涨跌幅"] > 0]) if "涨跌幅" in df.columns else 0
            down_count = len(df[df["涨跌幅"] < 0]) if "涨跌幅" in df.columns else 0
            flat_count = len(df[df["涨跌幅"] == 0]) if "涨跌幅" in df.columns else 0
            total = len(df)
            
            limit_up = len(df[df["涨跌幅"] >= 9.5]) if "涨跌幅" in df.columns else 0
            limit_down = len(df[df["涨跌幅"] <= -9.5]) if "涨跌幅" in df.columns else 0
            
            return {
                "up_count": up_count,
                "down_count": down_count,
                "flat_count": flat_count,
                "total": total,
                "up_ratio": up_count / total if total > 0 else 0,
                "down_ratio": down_count / total if total > 0 else 0,
                "limit_up": limit_up,
                "limit_down": limit_down,
                "breadth_indicator": (up_count - down_count) / total if total > 0 else 0,
            }
        
        return {}
    
    # ==================== 3. 资金流向数据 ====================
    
    def get_stock_fund_flow(self, symbol: str) -> pd.DataFrame:
        """获取个股历史资金流向数据"""
        market = "sh" if str(symbol).startswith("6") else "sz"
        result = self._safe_call(ak.stock_individual_fund_flow, 3, stock=symbol, market=market)
        return result if result is not None else pd.DataFrame()
    
    def get_sector_fund_flow(self, sector_type: str = "行业资金流", 
                            indicator: str = "今日") -> pd.DataFrame:
        """获取板块资金流向"""
        result = self._safe_call(ak.stock_sector_fund_flow_rank, 3, 
                                indicator=indicator, sector_type=sector_type)
        return result if result is not None else pd.DataFrame()
    
    def get_us_overnight_data(self) -> pd.DataFrame:
        """获取隔夜美股数据（从本地 CSV）"""
        import os
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "us_overnight.csv")
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path, encoding="utf-8-sig")
            df["date"] = pd.to_datetime(df["date"])
            return df
        return pd.DataFrame()
    
    # ==================== 4. 综合数据获取接口 ====================
    
    def get_stock_info(self, symbol: str) -> Dict:
        """获取个股基本信息"""
        try:
            result = self._safe_call(ak.stock_individual_info_em, 3, symbol=symbol)
            if result is not None and not result.empty:
                info = {}
                for _, row in result.iterrows():
                    key = row.get('item', '')
                    val = row.get('value', '')
                    if key and val:
                        info[key] = val
                return {
                    "name": info.get('股票简称', symbol),
                    "industry": info.get('行业', ''),
                    "market": "sh" if str(symbol).startswith('6') else "sz",
                }
        except Exception as e:
            logger.warning(f"获取个股信息失败: {e}")
        return {"name": symbol, "industry": "", "market": "sh" if str(symbol).startswith('6') else "sz"}

    def get_all_data_for_stock(self, symbol: str, days: int = 252) -> Dict[str, pd.DataFrame]:
        """获取单股全维度数据（核心接口）
        
        优先从网络获取，失败时自动回退到本地数据
        """
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
        
        logger.info(f"开始获取股票 {symbol} 的全维度数据...")
        
        data = {}
        
        # 1. 个股行情
        data["stock_daily"] = self.get_stock_daily(symbol, start_date, end_date)
        logger.info(f"个股行情: {len(data['stock_daily'])} 条")
        
        # 2. 上证指数
        data["sh_index"] = self.get_index_daily("000001", start_date, end_date)
        logger.info(f"上证指数: {len(data['sh_index'])} 条")
        
        # 3. 深证成指
        data["sz_index"] = self.get_index_daily("399001", start_date, end_date)
        logger.info(f"深证成指: {len(data['sz_index'])} 条")
        
        # 4. 创业板指
        data["cy_index"] = self.get_index_daily("399006", start_date, end_date)
        logger.info(f"创业板指: {len(data['cy_index'])} 条")
        
        # 5. 个股资金流向
        data["fund_flow"] = self.get_stock_fund_flow(symbol)
        logger.info(f"资金流向: {len(data['fund_flow'])} 条")
        
        # 6. 市场广度
        data["market_breadth"] = self.get_market_breadth()
        logger.info(f"市场广度: {data['market_breadth']}")
        
        # 7. 板块资金流向
        data["sector_fund_flow"] = self.get_sector_fund_flow("行业资金流", "今日")
        logger.info(f"板块资金流向: {len(data['sector_fund_flow'])} 条")

        # 8. 隔夜美股数据
        data["us_overnight"] = self.get_us_overnight_data()
        logger.info(f"美股隔夜数据: {len(data['us_overnight'])} 条")

        # 9. 对每项数据，网络为空时回退到本地
        local = LocalDataProvider()

        # 10. 市场情绪数据（北向资金/涨跌停/国债收益率）
        data["northbound_money"] = local.get_northbound_money()
        data["zt_pool"] = local.get_zt_pool()
        data["bond_yield"] = local.get_bond_yield()
        logger.info(f"北向资金: {len(data['northbound_money'])} 条, 涨跌停: {len(data['zt_pool'])} 条, 国债: {len(data['bond_yield'])} 条")
        
        if isinstance(data.get("sh_index"), pd.DataFrame) and data["sh_index"].empty:
            df = local.get_index_daily("000001")
            if not df.empty:
                data["sh_index"] = df
                logger.info(f"从本地补充 sh_index: {len(df)} 条")
        
        if isinstance(data.get("sz_index"), pd.DataFrame) and data["sz_index"].empty:
            df = local.get_index_daily("399001")
            if not df.empty:
                data["sz_index"] = df
                logger.info(f"从本地补充 sz_index: {len(df)} 条")
        
        if isinstance(data.get("cy_index"), pd.DataFrame) and data["cy_index"].empty:
            df = local.get_index_daily("399006")
            if not df.empty:
                data["cy_index"] = df
                logger.info(f"从本地补充 cy_index: {len(df)} 条")
        
        if isinstance(data.get("stock_daily"), pd.DataFrame) and data["stock_daily"].empty:
            df = local.get_stock_daily(symbol)
            if not df.empty:
                data["stock_daily"] = df
                logger.info(f"从本地补充 stock_daily: {len(df)} 条")
        
        return data


# ==================== 快捷函数 ====================

def fetch_stock_data(symbol: str, days: int = 252) -> Dict[str, pd.DataFrame]:
    """快捷获取单股全维度数据"""
    fetcher = DataFetcher()
    return fetcher.get_all_data_for_stock(symbol, days)


if __name__ == "__main__":
    fetcher = DataFetcher()
    symbol = DEMO_STOCK["code"]
    
    print(f"\n===== 测试获取 {symbol} 数据 =====")
    
    df_daily = fetcher.get_stock_daily(symbol, start_date="20250101")
    print(f"\n日线数据样例 ({len(df_daily)} 条):")
    print(df_daily.head() if not df_daily.empty else "无数据")
    
    df_sh = fetcher.get_index_daily("000001", start_date="20250101")
    print(f"\n上证指数样例 ({len(df_sh)} 条):")
    print(df_sh.head() if not df_sh.empty else "无数据")
    
    df_fund = fetcher.get_stock_fund_flow(symbol)
    print(f"\n资金流向样例 ({len(df_fund)} 条):")
    print(df_fund.head() if not df_fund.empty else "无数据")
