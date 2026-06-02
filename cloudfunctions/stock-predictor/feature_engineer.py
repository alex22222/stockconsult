# -*- coding: utf-8 -*-
"""
特征工程模块 - 多因子特征构建
六大类因子：市场环境、大盘能量、市场情绪、技术指标、板块热度、资金异动
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple
import logging

from config import FEATURE_CONFIG, FACTOR_CATEGORIES

logger = logging.getLogger(__name__)


class FeatureEngineer:
    """
    A股多因子特征工程器
    从原始数据中提取、计算六大类因子特征
    """
    
    def __init__(self):
        self.feature_config = FEATURE_CONFIG
        self.factor_categories = FACTOR_CATEGORIES
        self.feature_names = []
        logger.info("FeatureEngineer初始化完成")
    
    # ==================== 1. 市场环境因子 ====================
    
    def calc_market_environment_factors(self, stock_df: pd.DataFrame, 
                                       sh_index_df: pd.DataFrame,
                                       sz_index_df: pd.DataFrame = None,
                                       cy_index_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算市场环境因子
        
        因子列表:
        - index_trend: 大盘趋势 (上证指数N日均线斜率)
        - market_volatility: 市场波动率 (指数ATR)
        - breadth_indicator: 市场广度 (涨跌比)
        - index_corr: 个股与指数相关性
        """
        factors = pd.DataFrame(index=stock_df.index)
        
        if sh_index_df.empty:
            logger.warning("上证指数数据为空，市场环境因子将使用默认值")
            factors["index_trend"] = 0
            factors["market_volatility"] = 0
            factors["index_corr_5d"] = 0
            factors["index_corr_20d"] = 0
            return factors
        
        # 对齐日期
        sh_index_df = sh_index_df.copy()
        sh_index_df["日期"] = pd.to_datetime(sh_index_df["日期"])
        stock_df_copy = stock_df.copy()
        if "日期" in stock_df_copy.columns:
            stock_df_copy["日期"] = pd.to_datetime(stock_df_copy["日期"])
            merged = pd.merge(stock_df_copy[["日期", "收盘"]], sh_index_df[["日期", "收盘"]], 
                             on="日期", suffixes=("_stock", "_index"), how="left")
        else:
            # 假设索引就是日期
            merged = pd.DataFrame({
                "收盘_stock": stock_df_copy["收盘"].values,
                "收盘_index": sh_index_df["收盘"].reindex(stock_df_copy.index, method="ffill").values
            })
        
        # 1. 大盘趋势 (20日均线斜率)
        merged["index_ma20"] = merged["收盘_index"].rolling(20).mean()
        factors["index_trend"] = (merged["index_ma20"] - merged["index_ma20"].shift(5)) / merged["index_ma20"].shift(5) * 100
        
        # 2. 市场波动率 (14日ATR)
        index_high = sh_index_df["最高"].reindex(stock_df.index, method="ffill") if "最高" in sh_index_df.columns else merged["收盘_index"]
        index_low = sh_index_df["最低"].reindex(stock_df.index, method="ffill") if "最低" in sh_index_df.columns else merged["收盘_index"]
        factors["market_volatility"] = self._calc_atr(index_high, index_low, merged["收盘_index"], 14)
        
        # 3. 个股与指数相关性
        factors["index_corr_5d"] = merged["收盘_stock"].rolling(5).corr(merged["收盘_index"])
        factors["index_corr_20d"] = merged["收盘_stock"].rolling(20).corr(merged["收盘_index"])
        
        # 4. 指数涨跌
        factors["index_return_1d"] = merged["收盘_index"].pct_change() * 100
        factors["index_return_5d"] = merged["收盘_index"].pct_change(5) * 100
        
        # 5. 指数是否创新高/新低
        factors["index_new_high_20d"] = (merged["收盘_index"] >= merged["收盘_index"].rolling(20).max()) * 1.0
        factors["index_new_low_20d"] = (merged["收盘_index"] <= merged["收盘_index"].rolling(20).min()) * 1.0
        
        return factors.fillna(0)
    
    # ==================== 2. 大盘能量因子 ====================
    
    def calc_market_energy_factors(self, stock_df: pd.DataFrame, 
                                  sh_index_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算大盘能量因子
        
        因子列表:
        - volume_energy: 量能能量 (成交量/均量)
        - price_momentum: 价格动量
        - turnover_ratio: 换手率变化
        """
        factors = pd.DataFrame(index=stock_df.index)
        
        # 1. 成交量能量比 (相对于N日均量)
        vol = stock_df["成交量"]
        factors["volume_ratio_5"] = vol / vol.rolling(5).mean()
        factors["volume_ratio_20"] = vol / vol.rolling(20).mean()
        factors["volume_ratio_60"] = vol / vol.rolling(60).mean()
        
        # 2. 成交量趋势
        factors["volume_trend"] = (vol.rolling(5).mean() - vol.rolling(20).mean()) / vol.rolling(20).mean()
        
        # 3. 价格动量
        close = stock_df["收盘"]
        factors["momentum_1d"] = close.pct_change() * 100
        factors["momentum_5d"] = close.pct_change(5) * 100
        factors["momentum_10d"] = close.pct_change(10) * 100
        factors["momentum_20d"] = close.pct_change(20) * 100
        
        # 4. 换手率 (如果有)
        if "换手率" in stock_df.columns:
            turnover = stock_df["换手率"]
            factors["turnover"] = turnover
            factors["turnover_ma5"] = turnover.rolling(5).mean()
            factors["turnover_ratio"] = turnover / turnover.rolling(20).mean()
            factors["turnover_zscore"] = (turnover - turnover.rolling(60).mean()) / turnover.rolling(60).std()
        else:
            # 用成交量估算
            factors["turnover"] = 0
            factors["turnover_ratio"] = factors["volume_ratio_20"]
            factors["turnover_zscore"] = 0
        
        # 5. 量价配合度
        factors["volume_price_corr_5d"] = close.rolling(5).corr(vol)
        factors["volume_price_corr_20d"] = close.rolling(20).corr(vol)
        
        # 6. 成交额能量
        if "成交额" in stock_df.columns:
            amount = stock_df["成交额"]
            factors["amount_ratio_5"] = amount / amount.rolling(5).mean()
            factors["amount_ratio_20"] = amount / amount.rolling(20).mean()
        
        return factors.replace([np.inf, -np.inf], 0).fillna(0)
    
    # ==================== 3. 市场情绪因子 ====================
    
    def calc_market_sentiment_factors(self, stock_df: pd.DataFrame, 
                                     fund_flow_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算市场情绪因子
        
        因子列表:
        - fear_greed_index: 恐惧贪婪指数 (基于波动率+动量)
        - sentiment_momentum: 情绪动量
        """
        factors = pd.DataFrame(index=stock_df.index)
        close = stock_df["收盘"]
        high = stock_df["最高"]
        low = stock_df["最低"]
        
        # 1. 恐惧贪婪指数 (简化版)
        # 基于: 波动率(恐惧) + 动量(贪婪) + 是否在高位
        returns = close.pct_change()
        volatility = returns.rolling(20).std() * np.sqrt(252) * 100
        
        momentum_1m = close.pct_change(20) * 100
        momentum_3m = close.pct_change(60) * 100
        
        # 价格在布林带的位置 (越高越贪婪)
        bb_upper, bb_middle, bb_lower = self._calc_bollinger(close, 20, 2)
        bb_position = (close - bb_lower) / (bb_upper - bb_lower + 1e-10)
        
        # 合成恐惧贪婪指数 (0-100, 越高越贪婪)
        fear_greed = 50 + momentum_1m * 2 - volatility * 5 + (bb_position - 0.5) * 20
        factors["fear_greed_index"] = fear_greed.clip(0, 100)
        
        # 2. 情绪动量 (价格与成交量的背离/确认)
        price_change_5d = close.pct_change(5) * 100
        vol_change_5d = stock_df["成交量"].pct_change(5) * 100
        factors["sentiment_momentum"] = price_change_5d - vol_change_5d * 0.1
        
        # 3. 连续涨跌天数
        factors["consecutive_up"] = self._calc_consecutive_days(close, direction="up")
        factors["consecutive_down"] = self._calc_consecutive_days(close, direction="down")
        
        # 4. 振幅变化
        amplitude = (high - low) / close.shift(1) * 100
        factors["amplitude"] = amplitude
        factors["amplitude_ratio"] = amplitude / amplitude.rolling(20).mean()
        
        # 5. 如果资金流向数据可用
        if fund_flow_df is not None and not fund_flow_df.empty:
            # 合并资金流向数据
            fund_flow_df = fund_flow_df.copy()
            if "日期" in fund_flow_df.columns:
                fund_flow_df["日期"] = pd.to_datetime(fund_flow_df["日期"])
                stock_df_copy = stock_df.copy()
                stock_df_copy["日期"] = pd.to_datetime(stock_df_copy["日期"]) if "日期" in stock_df_copy.columns else stock_df_copy.index
                
                # 获取主力净流入占比
                if "主力净流入-净占比" in fund_flow_df.columns:
                    merged = pd.merge(stock_df_copy[["日期"]], 
                                     fund_flow_df[["日期", "主力净流入-净占比"]], 
                                     on="日期", how="left")
                    factors["main_fund_ratio"] = merged["主力净流入-净占比"].fillna(0)
        
        return factors.replace([np.inf, -np.inf], 0).fillna(0)
    
    # ==================== 4. 技术指标因子 (核心) ====================
    
    def calc_technical_indicators(self, stock_df: pd.DataFrame) -> pd.DataFrame:
        """
        计算技术指标因子 (最核心的一类因子)
        
        包含: MACD, KDJ, RSI, BOLL, 均线系统, OBV等
        """
        factors = pd.DataFrame(index=stock_df.index)
        close = stock_df["收盘"]
        high = stock_df["最高"]
        low = stock_df["最低"]
        volume = stock_df["成交量"]
        
        # ===== MACD =====
        macd_line, signal_line, histogram = self._calc_macd(
            close, 
            self.feature_config["macd"]["fast"],
            self.feature_config["macd"]["slow"],
            self.feature_config["macd"]["signal"]
        )
        factors["macd_line"] = macd_line
        factors["macd_signal"] = signal_line
        factors["macd_histogram"] = histogram
        factors["macd_golden_cross"] = ((macd_line > signal_line) & (macd_line.shift(1) <= signal_line.shift(1))) * 1.0
        factors["macd_death_cross"] = ((macd_line < signal_line) & (macd_line.shift(1) >= signal_line.shift(1))) * 1.0
        factors["macd_above_zero"] = (macd_line > 0) * 1.0
        factors["macd_histogram_change"] = histogram.diff()
        
        # ===== KDJ =====
        k, d, j = self._calc_kdj(
            close, high, low,
            self.feature_config["kdj"]["n"],
            self.feature_config["kdj"]["m1"],
            self.feature_config["kdj"]["m2"]
        )
        factors["kdj_k"] = k
        factors["kdj_d"] = d
        factors["kdj_j"] = j
        factors["kdj_golden_cross"] = ((k > d) & (k.shift(1) <= d.shift(1))) * 1.0
        factors["kdj_overbought"] = (j > 80) * 1.0  # 超买
        factors["kdj_oversold"] = (j < 20) * 1.0    # 超卖
        factors["kdj_j_slope"] = j.diff(3)  # J值斜率
        
        # ===== RSI =====
        rsi = self._calc_rsi(close, self.feature_config["rsi"]["period"])
        factors["rsi_14"] = rsi
        factors["rsi_overbought"] = (rsi > 70) * 1.0
        factors["rsi_oversold"] = (rsi < 30) * 1.0
        factors["rsi_slope"] = rsi.diff(3)
        
        # RSI divergence
        factors["rsi_bull_divergence"] = ((close < close.shift(10)) & (rsi > rsi.shift(10))) * 1.0
        factors["rsi_bear_divergence"] = ((close > close.shift(10)) & (rsi < rsi.shift(10))) * 1.0
        
        # ===== BOLLINGER BANDS =====
        bb_upper, bb_middle, bb_lower = self._calc_bollinger(
            close, 
            self.feature_config["boll"]["period"],
            self.feature_config["boll"]["std_dev"]
        )
        factors["bb_upper"] = bb_upper
        factors["bb_middle"] = bb_middle
        factors["bb_lower"] = bb_lower
        factors["bb_width"] = (bb_upper - bb_lower) / bb_middle * 100  # 带宽
        factors["bb_position"] = (close - bb_lower) / (bb_upper - bb_lower + 1e-10)
        factors["bb_squeeze"] = (factors["bb_width"] < factors["bb_width"].rolling(20).mean() * 0.8) * 1.0  # 缩口
        factors["bb_break_upper"] = (close > bb_upper) * 1.0
        factors["bb_break_lower"] = (close < bb_lower) * 1.0
        
        # ===== 均线系统 =====
        ma_config = self.feature_config["ma"]
        for period_name, period in ma_config.items():
            factors[f"ma_{period}"] = close.rolling(period).mean()
        
        # 均线交叉信号
        factors["ma_golden_cross"] = ((factors["ma_5"] > factors["ma_10"]) & 
                                      (factors["ma_5"].shift(1) <= factors["ma_10"].shift(1))) * 1.0
        factors["ma_death_cross"] = ((factors["ma_5"] < factors["ma_10"]) & 
                                     (factors["ma_5"].shift(1) >= factors["ma_10"].shift(1))) * 1.0
        factors["ma_long_arrangement"] = ((factors["ma_5"] > factors["ma_10"]) & 
                                          (factors["ma_10"] > factors["ma_20"])) * 1.0
        factors["ma_short_arrangement"] = ((factors["ma_5"] < factors["ma_10"]) & 
                                           (factors["ma_10"] < factors["ma_20"])) * 1.0
        
        # 价格与均线关系
        factors["price_vs_ma20"] = (close - factors["ma_20"]) / factors["ma_20"] * 100
        factors["price_vs_ma60"] = (close - factors["ma_60"]) / factors["ma_60"] * 100
        
        # ===== OBV (On Balance Volume) =====
        factors["obv"] = self._calc_obv(close, volume)
        factors["obv_ma"] = factors["obv"].rolling(20).mean()
        factors["obv_trend"] = (factors["obv"] > factors["obv_ma"]) * 1.0
        
        # ===== ATR (Average True Range) =====
        factors["atr_14"] = self._calc_atr(high, low, close, 14)
        factors["atr_ratio"] = factors["atr_14"] / close * 100
        
        # ===== 其他价量特征 =====
        # 实体比例
        factors["body_ratio"] = abs(close - stock_df["开盘"]) / (high - low + 1e-10) * 100
        # 上影线比例
        factors["upper_shadow"] = (high - close.clip(lower=stock_df["开盘"])) / (high - low + 1e-10) * 100
        # 下影线比例
        factors["lower_shadow"] = (close.clip(upper=stock_df["开盘"]) - low) / (high - low + 1e-10) * 100
        
        # ===== 扩展滞后特征 =====
        # T-2/T-3 日的关键指标
        for lag in [2, 3]:
            factors[f"close_chg_lag{lag}"] = close.pct_change(lag).shift(lag) * 100
            factors[f"volume_ratio_lag{lag}"] = volume / volume.rolling(20).mean().shift(lag)
            factors[f"rsi_lag{lag}"] = factors["rsi_14"].shift(lag)
            factors[f"macd_lag{lag}"] = factors["macd_line"].shift(lag)
            factors[f"kdj_j_lag{lag}"] = factors["kdj_j"].shift(lag)
        
        # ===== 波动率特征 =====
        factors["volatility_20d"] = close.pct_change().rolling(20).std() * 100
        factors["volatility_60d"] = close.pct_change().rolling(60).std() * 100
        factors["volatility_ratio"] = factors["volatility_20d"] / (factors["volatility_60d"] + 1e-10)
        factors["volume_volatility_20d"] = volume.pct_change().rolling(20).std() * 100
        
        # ===== 价格分位数特征 =====
        factors["price_pctile_20d"] = close.rolling(20).apply(
            lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
        )
        factors["price_pctile_60d"] = close.rolling(60).apply(
            lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
        )
        factors["volume_pctile_20d"] = volume.rolling(20).apply(
            lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
        )
        
        # ===== 交互特征 =====
        # MACD × RSI（趋势与动量交互）
        factors["macd_rsi_interact"] = (factors["macd_line"] / 10).clip(-5, 5) * (factors["rsi_14"] / 50 - 1)
        # 换手率 × 涨跌幅（量价交互）
        if "换手率" in stock_df.columns:
            factors["turnover_return_interact"] = stock_df["换手率"] * close.pct_change().shift(0) * 100
        # 个股与指数交互
        factors["price_bb_interact"] = factors["price_vs_ma20"] * factors["bb_position"]
        # ATR × 成交量（波动与量能交互）
        volume_ratio_20_local = volume / volume.rolling(20).mean()
        factors["atr_volume_interact"] = factors["atr_ratio"] * volume_ratio_20_local
        
        # ===== 成交量变异系数 =====
        factors["volume_cv_20d"] = volume.rolling(20).std() / (volume.rolling(20).mean() + 1e-10)
        factors["volume_cv_60d"] = volume.rolling(60).std() / (volume.rolling(60).mean() + 1e-10)
        
        # ===== 累积动量特征 =====
        factors["cum_return_3d"] = close.pct_change(3) * 100
        factors["cum_return_10d"] = close.pct_change(10) * 100
        factors["cum_volume_3d"] = volume.rolling(3).sum() / volume.rolling(20).mean()
        
        return factors.replace([np.inf, -np.inf], 0).fillna(0)
    
    # ==================== 5. 板块热度因子 ====================
    
    def calc_sector_heat_factors(self, stock_df: pd.DataFrame,
                                  sector_fund_flow_df: pd.DataFrame = None,
                                  stock_industry: str = "") -> pd.DataFrame:
        """
        计算板块热度因子
        
        因子列表:
        - sector_rank: 所属板块排名
        - sector_fund_flow: 板块资金流向
        - sector_momentum: 板块动量
        """
        factors = pd.DataFrame(index=stock_df.index)
        
        # 1. 个股相对于市场的强弱
        close = stock_df["收盘"]
        factors["relative_strength_5d"] = close.pct_change(5) * 100  # 简化
        factors["relative_strength_20d"] = close.pct_change(20) * 100
        
        # 2. 板块资金流向 (如果可用)
        if sector_fund_flow_df is not None and not sector_fund_flow_df.empty:
            # 计算板块平均涨跌幅
            if "涨跌幅" in sector_fund_flow_df.columns:
                avg_change = sector_fund_flow_df["涨跌幅"].mean()
                factors["sector_avg_change"] = avg_change
            
            # 计算板块资金净流入均值
            fund_col = None
            for col in ["今日主力净流入-净额", "主力净流入-净额", "主力净流入", "净流入额"]:
                if col in sector_fund_flow_df.columns:
                    fund_col = col
                    break
            
            if fund_col:
                avg_fund = sector_fund_flow_df[fund_col].mean()
                factors["sector_avg_fund"] = avg_fund / 1e8  # 转换为亿元
            
            # 如果有行业信息，查找对应行业排名
            if stock_industry and "名称" in sector_fund_flow_df.columns:
                industry_row = sector_fund_flow_df[sector_fund_flow_df["名称"].str.contains(stock_industry, na=False)]
                if not industry_row.empty:
                    rank = industry_row.index[0] + 1
                    total = len(sector_fund_flow_df)
                    factors["sector_rank"] = rank / total if total > 0 else 0.5
        
        # 确保这些列始终存在（避免训练集和预测集特征不一致）
        for col in ["sector_avg_change", "sector_avg_fund", "sector_rank"]:
            if col not in factors.columns:
                factors[col] = 0
        
        # 3. 个股换手率在历史中的分位
        if "换手率" in stock_df.columns:
            turnover = stock_df["换手率"]
            factors["turnover_percentile"] = turnover.rolling(60).apply(
                lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
            )
        
        # 4. 板块轮动指标 (个股相对于不同时间窗口的强弱)
        factors["momentum_vs_sector_5d"] = close.pct_change(5) * 100
        factors["momentum_vs_sector_20d"] = close.pct_change(20) * 100
        
        return factors.fillna(0)
    
    # ==================== 6. 资金异动因子 ====================
    
    def calc_fund_anomaly_factors(self, stock_df: pd.DataFrame,
                                   fund_flow_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算资金异动因子
        
        因子列表:
        - main_fund_flow: 主力资金流向
        - retail_fund_flow: 散户资金流向
        - large_order_ratio: 大单占比
        - fund_divergence: 资金流向与价格背离
        """
        factors = pd.DataFrame(index=stock_df.index)
        close = stock_df["收盘"]
        volume = stock_df["成交量"]
        
        # 1. 成交量的异常放大/缩小
        vol_ma20 = volume.rolling(20).mean()
        factors["volume_spike"] = (volume > vol_ma20 * 2) * 1.0  # 成交量突然放大2倍
        factors["volume_shrink"] = (volume < vol_ma20 * 0.5) * 1.0  # 成交量突然缩小一半
        
        # 2. 价格-成交量背离
        price_change_5d = close.pct_change(5)
        vol_change_5d = volume.pct_change(5)
        factors["price_volume_divergence"] = ((price_change_5d > 0.05) & (vol_change_5d < 0)) * 1.0  # 价涨量缩
        factors["price_volume_confirm"] = ((price_change_5d > 0.05) & (vol_change_5d > 0.5)) * 1.0  # 价涨量增
        
        # 3. 如果资金流向数据可用
        if fund_flow_df is not None and not fund_flow_df.empty:
            fund_flow_df = fund_flow_df.copy()
            
            # 合并数据
            if "日期" in fund_flow_df.columns:
                stock_df_copy = stock_df.copy()
                if "日期" not in stock_df_copy.columns:
                    stock_df_copy = stock_df_copy.reset_index().rename(columns={"index": "日期"})
                stock_df_copy["日期"] = pd.to_datetime(stock_df_copy["日期"])
                fund_flow_df["日期"] = pd.to_datetime(fund_flow_df["日期"])
                
                merged = pd.merge(stock_df_copy[["日期"]], fund_flow_df, on="日期", how="left")
                
                # 主力净流入
                if "主力净流入-净额" in merged.columns:
                    factors["main_fund_flow"] = merged["主力净流入-净额"].fillna(0) / 1e4  # 万元
                    factors["main_fund_ratio"] = merged.get("主力净流入-净占比", 0).fillna(0)
                
                # 超大单
                if "超大单净流入-净额" in merged.columns:
                    factors["super_large_fund"] = merged["超大单净流入-净额"].fillna(0) / 1e4
                
                # 大单
                if "大单净流入-净额" in merged.columns:
                    factors["large_fund"] = merged["大单净流入-净额"].fillna(0) / 1e4
                
                # 散户 (小单)
                if "小单净流入-净额" in merged.columns:
                    factors["retail_fund_flow"] = merged["小单净流入-净额"].fillna(0) / 1e4
                
                # 资金流向与价格背离
                if "main_fund_flow" in factors.columns:
                    fund_ma5 = factors["main_fund_flow"].rolling(5).mean()
                    fund_change = fund_ma5.diff(5)
                    price_change = close.pct_change(5) * 100
                    factors["fund_price_divergence"] = ((fund_change > 0) & (price_change < 0)) * 1.0
        
        # 4. 大单异动指标 (基于成交量分布)
        factors["large_order_estimate"] = volume * close  # 估算成交额
        factors["large_order_ma5"] = factors["large_order_estimate"].rolling(5).mean()
        factors["large_order_spike"] = (factors["large_order_estimate"] > factors["large_order_ma5"] * 1.5) * 1.0
        
        # 5. 资金集中度 (估算)
        factors["fund_concentration"] = volume / volume.rolling(20).mean() * close.pct_change().abs() * 100
        
        return factors.replace([np.inf, -np.inf], 0).fillna(0)

    # ==================== 8. 市场情绪因子（北向资金/涨跌停/国债收益率）====================

    def calc_market_sentiment_factors_v2(self, stock_df: pd.DataFrame,
                                          northbound_df: pd.DataFrame = None,
                                          zt_df: pd.DataFrame = None,
                                          bond_yield_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算扩展市场情绪因子
        
        因子列表:
        - northbound_net_buy: 北向资金当日净流入
        - northbound_net_buy_ma5: 北向资金5日平均净流入
        - northbound_net_buy_cum5: 北向资金5日累计净流入
        - zt_count: 涨停家数
        - dt_count: 跌停家数
        - zt_dt_ratio: 涨停/跌停比
        - zt_ma5: 涨停家数5日平均
        - bond_yield_10y: 10年期国债收益率
        - bond_yield_10y_chg_1d: 10年期国债收益率1日变化
        """
        import os
        
        factors = pd.DataFrame(index=stock_df.index)
        
        # 获取日期列
        if "日期" in stock_df.columns:
            dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d")
        else:
            dates = pd.to_datetime(stock_df.index).strftime("%Y-%m-%d")
        
        # 1. 北向资金因子
        if northbound_df is not None and not northbound_df.empty:
            northbound_df = northbound_df.copy()
            if "日期" in northbound_df.columns:
                northbound_df["date_key"] = pd.to_datetime(northbound_df["日期"]).dt.strftime("%Y-%m-%d")
            elif "date" in northbound_df.columns:
                northbound_df["date_key"] = pd.to_datetime(northbound_df["date"]).dt.strftime("%Y-%m-%d")
            else:
                northbound_df["date_key"] = ""
            
            nb_map = {}
            for _, row in northbound_df.iterrows():
                d = str(row.get("date_key", ""))
                if d:
                    nb_map[d] = row
            
            for col in ["total_net_buy", "net_buy_ma5", "net_buy_cum5", "total_buy", "total_sell"]:
                vals = []
                for d in dates:
                    if d in nb_map and pd.notna(nb_map[d].get(col)):
                        vals.append(float(nb_map[d][col]))
                    else:
                        vals.append(0.0)
                factors[f"northbound_{col}"] = vals
        else:
            # 尝试从本地 CSV 加载
            nb_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "northbound_money.csv")
            if os.path.exists(nb_path):
                try:
                    nb_df = pd.read_csv(nb_path, encoding="utf-8-sig")
                    nb_df["date_key"] = pd.to_datetime(nb_df["日期"]).dt.strftime("%Y-%m-%d")
                    nb_map = {str(r["date_key"]): r for _, r in nb_df.iterrows()}
                    for col in ["total_net_buy", "net_buy_ma5", "net_buy_cum5"]:
                        vals = []
                        for d in dates:
                            vals.append(float(nb_map.get(d, {}).get(col, 0)) if d in nb_map else 0.0)
                        factors[f"northbound_{col}"] = vals
                except Exception:
                    for col in ["total_net_buy", "net_buy_ma5", "net_buy_cum5"]:
                        factors[f"northbound_{col}"] = 0
            else:
                for col in ["total_net_buy", "net_buy_ma5", "net_buy_cum5"]:
                    factors[f"northbound_{col}"] = 0
        
        # 2. 涨跌停因子
        if zt_df is not None and not zt_df.empty:
            zt_df = zt_df.copy()
            if "date" in zt_df.columns:
                zt_df["date_key"] = pd.to_datetime(zt_df["date"]).dt.strftime("%Y-%m-%d")
            zt_map = {str(r["date_key"]): r for _, r in zt_df.iterrows() if pd.notna(r.get("date_key"))}
            
            for col in ["zt_count", "dt_count", "zt_dt_ratio", "zt_ma5", "dt_ma5"]:
                vals = []
                for d in dates:
                    vals.append(float(zt_map.get(d, {}).get(col, 0)) if d in zt_map else 0.0)
                factors[f"market_{col}"] = vals
        else:
            zt_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "zt_pool.csv")
            if os.path.exists(zt_path):
                try:
                    zt_df = pd.read_csv(zt_path, encoding="utf-8-sig")
                    zt_df["date_key"] = pd.to_datetime(zt_df["date"]).dt.strftime("%Y-%m-%d")
                    zt_map = {str(r["date_key"]): r for _, r in zt_df.iterrows()}
                    for col in ["zt_count", "dt_count", "zt_dt_ratio", "zt_ma5"]:
                        vals = []
                        for d in dates:
                            vals.append(float(zt_map.get(d, {}).get(col, 0)) if d in zt_map else 0.0)
                        factors[f"market_{col}"] = vals
                except Exception:
                    for col in ["zt_count", "dt_count", "zt_dt_ratio", "zt_ma5"]:
                        factors[f"market_{col}"] = 0
            else:
                for col in ["zt_count", "dt_count", "zt_dt_ratio", "zt_ma5"]:
                    factors[f"market_{col}"] = 0
        
        # 3. 国债收益率因子
        if bond_yield_df is not None and not bond_yield_df.empty:
            bond_df = bond_yield_df.copy()
            if "日期" in bond_df.columns:
                bond_df["date_key"] = pd.to_datetime(bond_df["日期"]).dt.strftime("%Y-%m-%d")
            bond_map = {str(r["date_key"]): r for _, r in bond_df.iterrows() if pd.notna(r.get("date_key"))}
            
            for col in bond_df.columns:
                if col in ["日期", "date_key"]:
                    continue
                vals = []
                for d in dates:
                    vals.append(float(bond_map.get(d, {}).get(col, 0)) if d in bond_map else 0.0)
                factors[f"bond_{col}"] = vals
        else:
            bond_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "bond_yield.csv")
            if os.path.exists(bond_path):
                try:
                    bond_df = pd.read_csv(bond_path, encoding="utf-8-sig")
                    bond_df["date_key"] = pd.to_datetime(bond_df["日期"]).dt.strftime("%Y-%m-%d")
                    bond_map = {str(r["date_key"]): r for _, r in bond_df.iterrows()}
                    for col in ["中国国债收益率10年", "中国国债收益率10年_chg_1d"]:
                        vals = []
                        for d in dates:
                            vals.append(float(bond_map.get(d, {}).get(col, 0)) if d in bond_map else 0.0)
                        factors[f"bond_{col}"] = vals
                except Exception:
                    factors["bond_中国国债收益率10年"] = 0
                    factors["bond_中国国债收益率10年_chg_1d"] = 0
            else:
                factors["bond_中国国债收益率10年"] = 0
                factors["bond_中国国债收益率10年_chg_1d"] = 0
        
        return factors.fillna(0)
    
    # ==================== 9. 隔夜美股因子 ====================

    def calc_us_market_factors(self, stock_df: pd.DataFrame,
                                us_overnight_df: pd.DataFrame = None) -> pd.DataFrame:
        """
        计算隔夜美股因子

        因子列表:
        - nasdaq_chg: 纳斯达克隔夜涨跌幅
        - dow_chg: 道琼斯隔夜涨跌幅
        - sp500_chg: 标普500隔夜涨跌幅
        - china_chg: 中国金龙指数隔夜涨跌幅
        - us_overnight_score: 综合美股评分 (加权)
        """
        import os
        import json

        factors = pd.DataFrame(index=stock_df.index)

        if us_overnight_df is None or us_overnight_df.empty:
            logger.warning("美股隔夜数据为空，美股因子使用默认值0")
            factors["nasdaq_chg"] = 0
            factors["dow_chg"] = 0
            factors["sp500_chg"] = 0
            factors["china_chg"] = 0
            factors["us_overnight_score"] = 50
            return factors

        # 读取股票代码用于个性化权重
        stock_date_col = "日期" if "日期" in stock_df.columns else stock_df.index.name
        if stock_date_col is None or stock_date_col == 0:
            stock_date_col = "日期"

        # 对齐日期
        stock_df_copy = stock_df.copy()
        if "日期" in stock_df_copy.columns:
            stock_df_copy["日期"] = pd.to_datetime(stock_df_copy["日期"]).dt.strftime("%Y-%m-%d")
            dates = stock_df_copy["日期"]
        else:
            dates = pd.to_datetime(stock_df_copy.index).strftime("%Y-%m-%d")

        us_df = us_overnight_df.copy()
        us_df["date"] = pd.to_datetime(us_df["date"]).dt.strftime("%Y-%m-%d")

        # 创建日期到美股因子的映射
        us_map = {}
        for _, row in us_df.iterrows():
            d = str(row["date"])
            us_map[d] = row

        # 填充每日美股因子
        for col in ["QQQ_chg", "DIA_chg", "SPY_chg", "FXI_chg"]:
            target_col = col.replace("QQQ", "nasdaq").replace("DIA", "dow").replace("SPY", "sp500").replace("FXI", "china")
            vals = []
            for d in dates:
                if d in us_map and pd.notna(us_map[d].get(col)):
                    vals.append(float(us_map[d][col]))
                else:
                    vals.append(0.0)
            factors[target_col] = vals

        # 计算综合美股评分 (50为中性，涨则>50，跌则<50)
        # 使用默认权重（如无个性化权重文件）
        default_weights = {"nasdaq_chg": 0.30, "dow_chg": 0.25, "sp500_chg": 0.25, "china_chg": 0.20}
        weights = default_weights.copy()

        # 尝试读取个性化权重
        weights_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "us_factor_weights.json")
        if os.path.exists(weights_path):
            try:
                with open(weights_path, "r", encoding="utf-8") as f:
                    all_weights = json.load(f)
                # 从股票文件名推断代码 (不够精确但可接受)
                symbol_hint = None
                for key in all_weights:
                    if key in str(stock_df.get("股票代码", "")):
                        symbol_hint = key
                        break
                if symbol_hint:
                    w = all_weights[symbol_hint]
                    weights = {
                        "nasdaq_chg": w.get("QQQ_chg", {}).get("weight", 0.30),
                        "dow_chg": w.get("DIA_chg", {}).get("weight", 0.25),
                        "sp500_chg": w.get("SPY_chg", {}).get("weight", 0.25),
                        "china_chg": w.get("FXI_chg", {}).get("weight", 0.20),
                    }
                    logger.info(f"使用个性化美股权重: {symbol_hint}")
            except Exception as e:
                logger.warning(f"读取美股权重失败: {e}")

        # 综合评分 = 50 + 加权涨跌幅 * 3 (缩放因子)
        score = 50.0
        for col, w in weights.items():
            if col in factors.columns:
                score += factors[col] * w * 3.0
        factors["us_overnight_score"] = score.clip(0, 100)

        return factors.fillna(0)
    
    # ==================== 核心: 构建完整特征集 ====================
    
    def build_features(self, data: Dict[str, pd.DataFrame], symbol: str,
                        target_mode: str = "classification") -> Tuple[pd.DataFrame, pd.Series]:
        """
        构建完整的特征数据集
        
        Args:
            data: 包含所有原始数据的字典
            symbol: 股票代码
            target_mode: "classification" (涨跌标签) 或 "regression" (次日收益率)
            
        Returns:
            X: 特征矩阵
            y: 目标变量
        """
        logger.info("开始构建多因子特征...")
        
        stock_df = data.get("stock_daily", pd.DataFrame())
        if stock_df.empty:
            logger.error("个股数据为空，无法构建特征")
            return pd.DataFrame(), pd.Series()
        
        # 确保日期列存在且为datetime
        if "日期" in stock_df.columns:
            stock_df = stock_df.sort_values("日期").reset_index(drop=True)
        
        # 获取辅助数据
        sh_index_df = data.get("sh_index", pd.DataFrame())
        sz_index_df = data.get("sz_index", pd.DataFrame())
        cy_index_df = data.get("cy_index", pd.DataFrame())
        fund_flow_df = data.get("fund_flow", pd.DataFrame())
        sector_fund_flow_df = data.get("sector_fund_flow", pd.DataFrame())
        
        # 获取个股信息
        stock_info = data.get("stock_info", {})
        stock_industry = stock_info.get("industry", "") if isinstance(stock_info, dict) else ""
        
        # 合并所有因子
        all_factors = []
        
        # 1. 市场环境因子
        logger.info("计算市场环境因子...")
        env_factors = self.calc_market_environment_factors(stock_df, sh_index_df, sz_index_df, cy_index_df)
        all_factors.append(env_factors)
        
        # 2. 大盘能量因子
        logger.info("计算大盘能量因子...")
        energy_factors = self.calc_market_energy_factors(stock_df, sh_index_df)
        all_factors.append(energy_factors)
        
        # 3. 市场情绪因子
        logger.info("计算市场情绪因子...")
        sentiment_factors = self.calc_market_sentiment_factors(stock_df, fund_flow_df)
        all_factors.append(sentiment_factors)
        
        # 4. 技术指标因子 (核心)
        logger.info("计算技术指标因子...")
        tech_factors = self.calc_technical_indicators(stock_df)
        all_factors.append(tech_factors)
        
        # 5. 板块热度因子
        logger.info("计算板块热度因子...")
        sector_factors = self.calc_sector_heat_factors(stock_df, sector_fund_flow_df, stock_industry)
        all_factors.append(sector_factors)
        
        # 6. 资金异动因子
        logger.info("计算资金异动因子...")
        fund_factors = self.calc_fund_anomaly_factors(stock_df, fund_flow_df)
        all_factors.append(fund_factors)
        
        # 7. 隔夜美股因子
        logger.info("计算隔夜美股因子...")
        us_overnight_df = data.get("us_overnight", pd.DataFrame())
        us_factors = self.calc_us_market_factors(stock_df, us_overnight_df)
        all_factors.append(us_factors)
        
        # 8. 扩展市场情绪因子（北向资金/涨跌停/国债收益率）
        logger.info("计算扩展市场情绪因子...")
        northbound_df = data.get("northbound_money", pd.DataFrame())
        zt_df = data.get("zt_pool", pd.DataFrame())
        bond_yield_df = data.get("bond_yield", pd.DataFrame())
        sentiment_v2_factors = self.calc_market_sentiment_factors_v2(stock_df, northbound_df, zt_df, bond_yield_df)
        all_factors.append(sentiment_v2_factors)
        
        # 合并所有特征
        X = pd.concat(all_factors, axis=1)
        
        # 移除重复列
        X = X.loc[:, ~X.columns.duplicated()]
        
        # 构建目标变量
        close = stock_df["收盘"]
        if target_mode == "regression":
            # 次日收益率 (百分比)
            y = close.pct_change().shift(-1) * 100
        else:
            # 默认: 分类 — 明日涨跌 (1=涨, 0=跌)
            y = (close.shift(-1) > close).astype(int)
        
        # 移除最后一天（没有明日数据）
        X = X.iloc[:-1]
        y = y.iloc[:-1]
        
        # 保存特征名
        self.feature_names = X.columns.tolist()
        
        logger.info(f"特征构建完成: X.shape={X.shape}, y.shape={y.shape}")
        logger.info(f"特征列表: {self.feature_names}")
        
        return X, y
    
    def build_compact_features(self, data: Dict[str, pd.DataFrame], symbol: str,
                                target_mode: str = "classification",
                                predict_horizon: int = 1,
                                ic_filter: bool = False) -> Tuple[pd.DataFrame, pd.Series]:
        """
        构建精简核心特征集 (~16个)，删除同源冗余，降低噪声与共线性。
        
        Args:
            ic_filter: 如果为 True，只保留经 IC 验证有效的 8 个核心特征，
                      避免低质量宏观因子稀释有效信号。
        
        保留逻辑:
        - 动量: 1d/5d/20d 收益
        - 波动率: 5d/20d 标准差
        - 量能: 成交量比 5d/20d 均值
        - 技术位置: 距MA20距离、20d价格分位、ATR/价格
        - 趋势状态: MA5>MA20、连续涨跌天数
        - 大盘相对: 指数1d收益、个股-指数5d相关性
        - 形态: 振幅、实体比例
        - 跨市场: 美股隔夜评分、汇率、原油、黄金
        """
        logger.info("开始构建精简特征...")
        stock_df = data.get("stock_daily", pd.DataFrame())
        if stock_df.empty:
            logger.error("个股数据为空")
            return pd.DataFrame(), pd.Series()
        if "日期" in stock_df.columns:
            stock_df = stock_df.sort_values("日期").reset_index(drop=True)
        
        close = stock_df["收盘"].astype(float)
        volume = stock_df["成交量"].astype(float)
        high = stock_df["最高"].astype(float)
        low = stock_df["最低"].astype(float)
        open_ = stock_df["开盘"].astype(float)
        
        f = pd.DataFrame(index=stock_df.index)
        
        # 1. 动量 (3)
        f["mom_1d"] = close.pct_change() * 100
        f["mom_5d"] = close.pct_change(5) * 100
        f["mom_20d"] = close.pct_change(20) * 100
        
        # 2. 波动率 (2)
        f["vol_5d"] = close.pct_change().rolling(5).std() * 100
        f["vol_20d"] = close.pct_change().rolling(20).std() * 100
        
        # 3. 量能 (2)
        f["vol_ratio_5"] = volume / volume.rolling(5).mean()
        f["vol_ratio_20"] = volume / volume.rolling(20).mean()
        
        # 4. 技术位置 (3)
        ma20 = close.rolling(20).mean()
        f["price_vs_ma20"] = (close - ma20) / ma20 * 100
        f["price_pctile_20d"] = close.rolling(20).apply(
            lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min() + 1e-10) * 100 if x.max() != x.min() else 50
        )
        tr1 = high - low
        tr2 = abs(high - close.shift(1))
        tr3 = abs(low - close.shift(1))
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr14 = tr.rolling(14).mean()
        f["atr_14_ratio"] = atr14 / close * 100
        
        # 5. 趋势状态 (3)
        ma5 = close.rolling(5).mean()
        f["ma5_above_ma20"] = (ma5 > ma20).astype(int)
        f["consecutive_up"] = self._calc_consecutive_days(close, "up")
        f["consecutive_down"] = self._calc_consecutive_days(close, "down")
        
        # 6. 大盘相对 (2)
        sh_index_df = data.get("sh_index", pd.DataFrame())
        if not sh_index_df.empty and "日期" in sh_index_df.columns and "收盘" in sh_index_df.columns:
            sh_merged = pd.merge(
                stock_df[["日期", "收盘"]].rename(columns={"收盘": "close_stock"}),
                sh_index_df[["日期", "收盘"]].rename(columns={"收盘": "close_index"}),
                on="日期", how="left"
            )
            sh_close = sh_merged["close_index"].ffill()
            f["index_return_1d"] = sh_close.pct_change() * 100
            f["index_corr_5d"] = sh_merged["close_stock"].rolling(5).corr(sh_close)
        else:
            f["index_return_1d"] = 0.0
            f["index_corr_5d"] = 0.0
        
        # 7. 形态 (2)
        f["amplitude"] = (high - low) / close.shift(1) * 100
        f["body_ratio"] = abs(close - open_) / (high - low + 1e-10) * 100
        
        # 8. 非价格情绪/宏观特征（新补充的历史数据）
        if "日期" in stock_df.columns:
            stock_dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d")
        else:
            stock_dates = pd.to_datetime(stock_df.index).strftime("%Y-%m-%d")
        
        # 8.1 北向资金
        nb_df = data.get("northbound_money", pd.DataFrame())
        if not nb_df.empty and "日期" in nb_df.columns:
            nb_df = nb_df.copy()
            nb_df["date_key"] = pd.to_datetime(nb_df["日期"]).dt.strftime("%Y-%m-%d")
            nb_map = {str(r["date_key"]): r for _, r in nb_df.iterrows() if pd.notna(r.get("date_key"))}
            f["northbound_net"] = [float(nb_map.get(d, {}).get("total_net_buy", 0)) / 1e8 for d in stock_dates]
            f["northbound_cum5"] = [float(nb_map.get(d, {}).get("net_buy_cum5", 0)) / 1e8 for d in stock_dates]
        else:
            f["northbound_net"] = 0.0
            f["northbound_cum5"] = 0.0
        
        # 8.2 美股隔夜
        us_df = data.get("us_overnight", pd.DataFrame())
        if not us_df.empty and "date" in us_df.columns:
            us_df = us_df.copy()
            us_df["date_key"] = pd.to_datetime(us_df["date"]).dt.strftime("%Y-%m-%d")
            us_map = {str(r["date_key"]): r for _, r in us_df.iterrows() if pd.notna(r.get("date_key"))}
            f["us_overnight_score"] = [float(us_map.get(d, {}).get("us_overnight_score", 0)) for d in stock_dates]
        else:
            f["us_overnight_score"] = 0.0
        
        # 8.3 涨跌停比
        zt_df = data.get("zt_pool", pd.DataFrame())
        if not zt_df.empty and "date" in zt_df.columns:
            zt_df = zt_df.copy()
            zt_df["date_key"] = pd.to_datetime(zt_df["date"]).dt.strftime("%Y-%m-%d")
            zt_map = {str(r["date_key"]): r for _, r in zt_df.iterrows() if pd.notna(r.get("date_key"))}
            f["zt_dt_ratio"] = [float(zt_map.get(d, {}).get("zt_dt_ratio", 1.0)) for d in stock_dates]
        else:
            f["zt_dt_ratio"] = 1.0
        
        # 8.4 国债收益率变化
        bond_df = data.get("bond_yield", pd.DataFrame())
        if not bond_df.empty and "日期" in bond_df.columns:
            bond_df = bond_df.copy()
            bond_df["date_key"] = pd.to_datetime(bond_df["日期"]).dt.strftime("%Y-%m-%d")
            bond_map = {str(r["date_key"]): r for _, r in bond_df.iterrows() if pd.notna(r.get("date_key"))}
            chg_col = "中国国债收益率10年_chg_1d"
            f["bond_yield_10y_chg"] = [float(bond_map.get(d, {}).get(chg_col, 0)) for d in stock_dates]
        else:
            f["bond_yield_10y_chg"] = 0.0
        
        # 8.5-8.7 汇率/原油/黄金（已验证为低IC噪声，暂不注入模型，保留数据文件供后续研究）
        # fx_df = data.get("fx_usdcny", pd.DataFrame())
        # wti_df = data.get("commodity_wti", pd.DataFrame())
        # gold_df = data.get("commodity_gold", pd.DataFrame())
        
        # 清洗
        X = f.replace([np.inf, -np.inf], 0).fillna(0)
        
        # 目标变量（支持可变预测周期）
        if target_mode == "regression":
            y = (close.shift(-predict_horizon) / close - 1) * 100
        else:
            y = (close.shift(-predict_horizon) > close).astype(int)
        
        # IC 预筛选：只保留经 walk-forward 验证有效的特征，避免噪声稀释信号
        if ic_filter:
            ic_whitelist = [
                "mom_20d", "price_vs_ma20", "us_overnight_score",
                "price_pctile_20d", "consecutive_down", "ma5_above_ma20",
                "mom_5d", "consecutive_up",
            ]
            available = [c for c in ic_whitelist if c in X.columns]
            X = X[available]
            logger.info(f"IC 过滤后保留 {len(available)} 个特征: {available}")
        
        # 移除最后 predict_horizon 天（没有未来数据）
        X = X.iloc[:-predict_horizon]
        y = y.iloc[:-predict_horizon]
        self.feature_names = X.columns.tolist()
        logger.info(f"精简特征构建完成: X.shape={X.shape}, features={self.feature_names}")
        return X, y
    
    # ==================== 辅助计算函数 ====================
    
    def _calc_macd(self, close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """计算MACD指标"""
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram
    
    def _calc_kdj(self, close: pd.Series, high: pd.Series, low: pd.Series, 
                  n: int = 9, m1: int = 3, m2: int = 3) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """计算KDJ指标"""
        lowest_low = low.rolling(window=n).min()
        highest_high = high.rolling(window=n).max()
        rsv = (close - lowest_low) / (highest_high - lowest_low + 1e-10) * 100
        
        k = pd.Series(index=close.index, dtype=float)
        d = pd.Series(index=close.index, dtype=float)
        
        k.iloc[0] = 50
        d.iloc[0] = 50
        
        for i in range(1, len(close)):
            if pd.isna(rsv.iloc[i]):
                k.iloc[i] = 50
                d.iloc[i] = 50
            else:
                k.iloc[i] = (2/3) * k.iloc[i-1] + (1/3) * rsv.iloc[i]
                d.iloc[i] = (2/3) * d.iloc[i-1] + (1/3) * k.iloc[i]
        
        j = 3 * k - 2 * d
        return k, d, j
    
    def _calc_rsi(self, close: pd.Series, period: int = 14) -> pd.Series:
        """计算RSI指标"""
        delta = close.diff()
        gain = delta.where(delta > 0, 0)
        loss = (-delta).where(delta < 0, 0)
        
        avg_gain = gain.rolling(window=period).mean()
        avg_loss = loss.rolling(window=period).mean()
        
        rs = avg_gain / (avg_loss + 1e-10)
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _calc_bollinger(self, close: pd.Series, period: int = 20, std_dev: float = 2.0) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """计算布林带"""
        middle = close.rolling(window=period).mean()
        std = close.rolling(window=period).std()
        upper = middle + std_dev * std
        lower = middle - std_dev * std
        return upper, middle, lower
    
    def _calc_atr(self, high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
        """计算ATR (Average True Range)"""
        tr1 = high - low
        tr2 = abs(high - close.shift(1))
        tr3 = abs(low - close.shift(1))
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(window=period).mean()
        return atr
    
    def _calc_obv(self, close: pd.Series, volume: pd.Series) -> pd.Series:
        """计算OBV (On Balance Volume)"""
        obv = pd.Series(index=close.index, dtype=float)
        obv.iloc[0] = volume.iloc[0] if not pd.isna(volume.iloc[0]) else 0
        
        for i in range(1, len(close)):
            if close.iloc[i] > close.iloc[i-1]:
                obv.iloc[i] = obv.iloc[i-1] + volume.iloc[i]
            elif close.iloc[i] < close.iloc[i-1]:
                obv.iloc[i] = obv.iloc[i-1] - volume.iloc[i]
            else:
                obv.iloc[i] = obv.iloc[i-1]
        
        return obv
    
    def _calc_consecutive_days(self, close: pd.Series, direction: str = "up") -> pd.Series:
        """计算连续涨跌天数"""
        if direction == "up":
            signals = (close > close.shift(1)).astype(int)
        else:
            signals = (close < close.shift(1)).astype(int)
        
        consecutive = pd.Series(index=close.index, dtype=int)
        count = 0
        
        for i in range(len(signals)):
            if signals.iloc[i] == 1:
                count += 1
            else:
                count = 0
            consecutive.iloc[i] = count
        
        return consecutive
    
    def get_feature_importance_by_category(self, feature_importance: Dict[str, float]) -> Dict[str, float]:
        """
        按因子类别聚合特征重要性
        
        Args:
            feature_importance: {特征名: 重要性}
            
        Returns:
            {因子类别: 平均重要性}
        """
        category_importance = {cat: [] for cat in self.factor_categories.keys()}
        
        for feat_name, importance in feature_importance.items():
            # 根据特征名前缀判断所属类别
            if any(kw in feat_name.lower() for kw in ["index", "market"]):
                category_importance["market_environment"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["volume", "energy", "turnover"]):
                category_importance["market_energy"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["sentiment", "fear", "greed", "consecutive"]):
                category_importance["market_sentiment"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["macd", "kdj", "rsi", "bb_", "ma_", "obv", "atr", "body", "shadow"]):
                category_importance["technical_indicators"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["sector", "industry"]):
                category_importance["sector_heat"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["fund", "order", "retail", "main_fund"]):
                category_importance["fund_anomaly"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["nasdaq", "dow", "sp500", "china", "us_overnight"]):
                category_importance["us_market"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["northbound", "market_zt", "market_dt", "bond_"]):
                category_importance["market_sentiment_v2"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["volatility", "volume_cv"]):
                category_importance["volatility"].append(importance)
            elif any(kw in feat_name.lower() for kw in ["pctile", "percentile"]):
                category_importance["percentile"].append(importance)
            elif "interact" in feat_name.lower():
                category_importance["interaction"].append(importance)
            elif "lag" in feat_name.lower():
                category_importance["lag_features"].append(importance)
        
        # 计算每类平均重要性
        result = {}
        for cat, values in category_importance.items():
            result[cat] = np.mean(values) if values else 0
        
        return result


if __name__ == "__main__":
    # 测试特征工程
    from data_fetcher import DataFetcher
    
    fetcher = DataFetcher()
    engineer = FeatureEngineer()
    
    # 获取数据
    data = fetcher.get_all_data_for_stock("600519", days=120)
    
    # 构建特征
    X, y = engineer.build_features(data, "600519")
    
    print(f"\n特征矩阵: X.shape = {X.shape}")
    print(f"目标变量: y.shape = {y.shape}")
    print(f"\n特征列名: {X.columns.tolist()}")
    print(f"\n特征统计:")
    print(X.describe())
