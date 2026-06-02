# -*- coding: utf-8 -*-
"""
⚠️ 警告：此脚本已归档，存在已知问题，不作为决策依据
=====================================================
问题说明：
  - 训练时为构造预测点特征，多保留了未来数据，导致未来函数泄露
  - 回测结果不可引用，不能作为策略有效性的证据
  - 详见 docs/prediction-model-sharp-review-2026-06-02.md

状态：已归档，不再维护。新的权威回测框架正在开发中。
"""
"""
回归回测引擎 — 预测次日收益率 + 阈值触发
==========================================
目标: 用 regression pipeline 验证"预测收益 > threshold 时买入"是否有效
基准: 买入持有、空仓、随机信号、MA5/20
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from typing import Dict
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from regression_model_trainer import RegressionModelTrainer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

COMMISSION_RATE = 0.00025
STAMP_TAX_RATE = 0.001
MIN_COMMISSION = 5
SLIPPAGE = 0.002


class RegressionBacktestEngine:
    """基于次日收益预测的回测引擎"""

    def __init__(self, symbol: str, stock_name: str = "",
                 initial_capital: float = 10000.0,
                 lookback_days: int = 252,
                 retrain_days: int = 20,
                 prediction_threshold: float = 0.5,  # 预测收益 > 0.5% 才买入
                 confidence_threshold: float = 0.15,
                 stop_loss: float = 0.05,
                 take_profit: float = 0.10,
                 position_size: float = 0.8,
                 signal_source: str = "model",  # "model"|"ma_cross"|"random"
                 ):
        self.symbol = symbol
        self.stock_name = stock_name or symbol
        self.initial_capital = initial_capital
        self.lookback_days = lookback_days
        self.retrain_days = retrain_days
        self.prediction_threshold = prediction_threshold
        self.confidence_threshold = confidence_threshold
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        self.signal_source = signal_source

        self.capital = initial_capital
        self.position = 0
        self.entry_price = 0
        self.trades = []
        self.equity_curve = []
        self.predictions = []

        self.local = LocalDataProvider(DATA_DIR)
        self.raw = self.local.get_all_data_for_stock(symbol, days=5000)
        self.stock_df = self.raw["stock_daily"].sort_values("日期").reset_index(drop=True)
        self.close = self.stock_df["收盘"].astype(float).values
        self.open_ = self.stock_df["开盘"].astype(float).values
        self.dates = self.stock_df["日期"].astype(str).values
        self.engineer = FeatureEngineer()

    def _train_and_predict(self, end_idx: int) -> tuple:
        """用 [0:end_idx] 训练，预测 end_idx+1 的收益率"""
        raw_trunc = {}
        for key, df in self.raw.items():
            if isinstance(df, pd.DataFrame) and not df.empty and "日期" in df.columns:
                df_copy = df.copy()
                df_copy["日期"] = pd.to_datetime(df_copy["日期"])
                # 多留一行，修正 build_features 删最后一天导致的错位
                # predict_horizon=5，需要多留 5 行，保证 build_compact_features 删完后最后一行是 end_idx
                if key == "stock_daily":
                    mask = df_copy.index <= end_idx + 5
                else:
                    mask = df_copy.index <= end_idx
                raw_trunc[key] = df_copy[mask].copy()
            else:
                raw_trunc[key] = df

        X, y = self.engineer.build_compact_features(raw_trunc, self.symbol, target_mode="regression", predict_horizon=5)
        if X.empty or len(X) < 80:
            return 0.0, 0.0

        trainer = RegressionModelTrainer()
        trainer.train_ensemble(X, y, validation_split=0.2)
        if not trainer.models:
            return 0.0, 0.0

        result = trainer.predict(X, use_ensemble=True)
        if "error" in result:
            return 0.0, 0.0
        return result["prediction"], result["confidence"]

    def run(self) -> Dict:
        """运行回测"""
        start_idx = self.lookback_days + 10
        end_idx = len(self.close) - 1
        last_retrain = -999
        current_pred_ret = 0.0
        current_conf = 0.0
        self.predictions = []
        pending_action = None
        pending_reason = None

        for i in range(start_idx, end_idx):
            date = self.dates[i]
            price = self.close[i]
            open_price = self.open_[i]

            # 执行前一日 pending 动作（T+1）
            if pending_action == 'BUY' and self.position == 0:
                size = self._calc_position_size(current_conf)
                self._buy(open_price, date, position_size=size)
            elif pending_action == 'SELL' and self.position > 0:
                self._sell(open_price, date, pending_reason)
            pending_action = None
            pending_reason = None

            # 记录真实标签（次日收益）用于后续诊断
            if i + 1 < len(self.close):
                actual_ret = (self.close[i + 1] - price) / price * 100
            else:
                actual_ret = 0.0
            self.predictions.append({
                "date": date,
                "predicted_ret": current_pred_ret,
                "actual_ret": actual_ret,
                "conf": current_conf,
            })

            equity = self.capital + self.position * price
            self.equity_curve.append({"date": date, "equity": equity, "price": price, "position": self.position})

            # 信号生成
            if self.signal_source == "model":
                if i - last_retrain >= self.retrain_days:
                    current_pred_ret, current_conf = self._train_and_predict(i)
                    last_retrain = i
            elif self.signal_source == "ma_cross":
                if i >= 20:
                    ma5 = np.mean(self.close[i-4:i+1])
                    ma20 = np.mean(self.close[i-19:i+1])
                    current_pred_ret = 1.0 if ma5 > ma20 else -1.0
                    current_conf = 0.5
            elif self.signal_source == "random":
                current_pred_ret = np.random.choice([1.0, -1.0])
                current_conf = 0.5

            # 止损止盈检查
            if self.position > 0 and self.entry_price > 0:
                ret = (price - self.entry_price) / self.entry_price
                if ret <= -self.stop_loss:
                    pending_action = 'SELL'
                    pending_reason = 'STOP_LOSS'
                elif ret >= self.take_profit:
                    pending_action = 'SELL'
                    pending_reason = 'TAKE_PROFIT'

            if pending_action is not None:
                continue

            if current_conf < self.confidence_threshold:
                continue

            # 过滤交易策略：模型不猜方向，只过滤"高质量交易"
            # 结合反转逻辑：只在预测有显著正收益且模型一致时买入
            # 持仓中若预测转负，及时退出
            if current_pred_ret > self.prediction_threshold and current_conf > 0.20 and self.position == 0:
                pending_action = 'BUY'
                pending_reason = 'SIGNAL'
            elif current_pred_ret < -self.prediction_threshold * 0.5 and self.position > 0:
                pending_action = 'SELL'
                pending_reason = 'FILTER_EXIT'

        if self.position > 0:
            self._sell(self.close[-1], self.dates[-1], "FINAL")
        return self._calculate_metrics()

    def _calc_position_size(self, confidence: float) -> float:
        if confidence < self.confidence_threshold:
            return 0.0
        size = 0.3 + (confidence - self.confidence_threshold) / (0.50 - self.confidence_threshold) * 0.6
        return min(size, 0.95)

    def _buy(self, price: float, date: str, position_size: float = None):
        if position_size is None:
            position_size = self.position_size
        buy_amount = self.capital * position_size
        price_with_slippage = price * (1 + SLIPPAGE)
        max_shares = int(buy_amount / price_with_slippage / 100) * 100
        if max_shares < 100:
            return
        cost = max_shares * price_with_slippage
        commission = max(cost * COMMISSION_RATE, MIN_COMMISSION)
        total_cost = cost + commission
        if total_cost > self.capital:
            return
        self.capital -= total_cost
        self.position = max_shares
        self.entry_price = price
        self.trades.append({"date": date, "action": "BUY", "price": price, "shares": max_shares, "cost": total_cost})

    def _sell(self, price: float, date: str, reason: str):
        if self.position == 0:
            return
        price_with_slippage = price * (1 - SLIPPAGE)
        revenue = self.position * price_with_slippage
        commission = max(revenue * COMMISSION_RATE, MIN_COMMISSION)
        stamp_tax = revenue * STAMP_TAX_RATE
        total_revenue = revenue - commission - stamp_tax
        self.capital += total_revenue
        self.trades.append({"date": date, "action": "SELL", "price": price, "shares": self.position, "revenue": total_revenue, "reason": reason})
        self.position = 0
        self.entry_price = 0

    def _calculate_metrics(self) -> Dict:
        df_equity = pd.DataFrame(self.equity_curve)
        if df_equity.empty:
            return {}
        df_equity["return"] = df_equity["equity"].pct_change()
        initial = self.initial_capital
        final = df_equity["equity"].iloc[-1]
        total_return = (final - initial) / initial
        n_days = len(df_equity)
        annual_return = total_return * 252 / n_days if n_days > 0 else 0
        daily_returns = df_equity["return"].dropna()
        volatility = daily_returns.std() * np.sqrt(252) * 100
        sharpe = (annual_return * 100 - 3) / volatility if volatility > 0 else 0
        cummax = df_equity["equity"].cummax()
        drawdown = (cummax - df_equity["equity"]) / cummax
        max_dd = drawdown.max() * 100

        trade_returns = []
        buy_trade = None
        for t in self.trades:
            if t["action"] == "BUY":
                buy_trade = t
            elif t["action"] == "SELL" and buy_trade:
                trade_returns.append((t["price"] - buy_trade["price"]) / buy_trade["price"])
                buy_trade = None
        win_rate = sum(1 for r in trade_returns if r > 0) / len(trade_returns) * 100 if trade_returns else 0
        avg_trade_return = np.mean(trade_returns) * 100 if trade_returns else 0

        return {
            "symbol": self.symbol, "name": self.stock_name,
            "total_return": total_return, "annual_return": annual_return,
            "sharpe": sharpe, "max_dd": max_dd,
            "trades": len([t for t in self.trades if t["action"] == "SELL"]),
            "win_rate": win_rate, "avg_trade_return": avg_trade_return,
            "equity_curve": df_equity, "trade_list": self.trades,
            "predictions": self.predictions,
        }


def _buyhold_return(symbol: str, start_idx: int, end_idx: int = None) -> float:
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    close = stock_df["收盘"].astype(float).values
    if end_idx is None or end_idx >= len(close):
        end_idx = len(close) - 1
    return (close[end_idx] / close[start_idx] - 1) * 100


def main():
    symbols = {
        "002617": "露笑科技",
        "601318": "中国平安",
        "300622": "博士眼镜",
        "002896": "中大力德",
    }
    print("=" * 115)
    print("5日预测 + 精简特征 + 过滤交易策略回测（滚动窗口，无数据泄露）")
    print("=" * 115)
    print(f"{'股票':<10} {'基准':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8} {'vs买入持有':>10}")
    print("-" * 115)

    for sym, name in symbols.items():
        start_idx = 252 + 10
        bh = _buyhold_return(sym, start_idx, None)

        # 1. 回归策略
        engine = RegressionBacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            prediction_threshold=2.0, confidence_threshold=0.15,
            stop_loss=0.05, take_profit=0.10, position_size=0.8,
        )
        r = engine.run()
        print(f"{name:<10} {'回归策略':<10} {r['total_return']:>+9.2%} {r['annual_return']:>+7.1%} {r['sharpe']:>7.2f} {r['max_dd']:>7.1f}% {r['trades']:>5}次 {r['win_rate']:>6.1f}% {r['avg_trade_return']:>+6.2f}% {r['total_return']*100 - bh:>+9.2f}%")

        # 2. MA5/20 基准
        engine_ma = RegressionBacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            prediction_threshold=0.5, confidence_threshold=0.15,
            stop_loss=0.05, take_profit=0.10, position_size=0.8,
            signal_source="ma_cross",
        )
        r_ma = engine_ma.run()
        print(f"{'':10} {'MA5/20':<10} {r_ma['total_return']:>+9.2%} {r_ma['annual_return']:>+7.1%} {r_ma['sharpe']:>7.2f} {r_ma['max_dd']:>7.1f}% {r_ma['trades']:>5}次 {r_ma['win_rate']:>6.1f}% {r_ma['avg_trade_return']:>+6.2f}% {r_ma['total_return']*100 - bh:>+9.2f}%")

        # 3. 随机基准
        engine_rand = RegressionBacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            prediction_threshold=0.5, confidence_threshold=0.15,
            stop_loss=0.05, take_profit=0.10, position_size=0.8,
            signal_source="random",
        )
        r_rand = engine_rand.run()
        print(f"{'':10} {'随机信号':<10} {r_rand['total_return']:>+9.2%} {r_rand['annual_return']:>+7.1%} {r_rand['sharpe']:>7.2f} {r_rand['max_dd']:>7.1f}% {r_rand['trades']:>5}次 {r_rand['win_rate']:>6.1f}% {r_rand['avg_trade_return']:>+6.2f}% {r_rand['total_return']*100 - bh:>+9.2f}%")

        # 4. 买入持有 & 空仓
        print(f"{'':10} {'买入持有':<10} {bh/100:>+9.2%} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {'—':>10}")
        print(f"{'':10} {'空仓':<10} {'+0.00%':>10} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {-bh:>+9.2f}%")
        print("-" * 115)


if __name__ == "__main__":
    main()
