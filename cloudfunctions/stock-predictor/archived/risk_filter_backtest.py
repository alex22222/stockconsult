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
风控守门员策略 — 模型作为减仓过滤器
====================================
核心思想：接受"跑不赢买入持有"的现实，让模型只做一件事——
在预测未来5日收益为显著负值时减仓避险，其他时间保持基准仓位。

基准: 始终 50% 仓位（半仓买入持有）
过滤: 预测 5日收益 < -2% → 减仓到 10%（空仓或极轻仓）
      预测 5日收益 > +2% → 加仓到 90%（重仓）
      -2% ~ +2% 之间 → 维持 50%
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


class RiskFilterBacktestEngine:
    """风控守门员回测引擎"""

    def __init__(self, symbol: str, stock_name: str = "",
                 initial_capital: float = 10000.0,
                 lookback_days: int = 252,
                 retrain_days: int = 20,
                 risk_threshold: float = -2.0,   # 预测 < -2% 视为风险信号
                 opportunity_threshold: float = 2.0,  # 预测 > +2% 视为机会信号
                 base_position: float = 0.5,     # 基准仓位 50%
                 defensive_position: float = 0.1,  # 防御仓位 10%
                 aggressive_position: float = 0.9,  # 进攻仓位 90%
                 stop_loss: float = 0.08,
                 take_profit: float = 0.15,
                 ):
        self.symbol = symbol
        self.stock_name = stock_name or symbol
        self.initial_capital = initial_capital
        self.lookback_days = lookback_days
        self.retrain_days = retrain_days
        self.risk_threshold = risk_threshold
        self.opportunity_threshold = opportunity_threshold
        self.base_position = base_position
        self.defensive_position = defensive_position
        self.aggressive_position = aggressive_position
        self.stop_loss = stop_loss
        self.take_profit = take_profit

        self.capital = initial_capital
        self.position = 0
        self.entry_price = 0
        self.trades = []
        self.equity_curve = []
        self.signals = []

        self.local = LocalDataProvider(DATA_DIR)
        self.raw = self.local.get_all_data_for_stock(symbol, days=5000)
        self.stock_df = self.raw["stock_daily"].sort_values("日期").reset_index(drop=True)
        self.close = self.stock_df["收盘"].astype(float).values
        self.open_ = self.stock_df["开盘"].astype(float).values
        self.dates = self.stock_df["日期"].astype(str).values
        self.engineer = FeatureEngineer()

    def _train_and_predict(self, end_idx: int) -> tuple:
        raw_trunc = {}
        for key, df in self.raw.items():
            if isinstance(df, pd.DataFrame) and not df.empty and "日期" in df.columns:
                df_copy = df.copy()
                df_copy["日期"] = pd.to_datetime(df_copy["日期"])
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

    def _target_shares(self, target_pct: float, price: float) -> int:
        """计算目标持仓股数（100股整数倍）"""
        target_value = self.capital * target_pct + self.position * price
        target_shares = int(target_value / price / 100) * 100
        return max(0, target_shares)

    def run(self) -> Dict:
        start_idx = self.lookback_days + 10
        end_idx = len(self.close) - 1
        last_retrain = -999
        current_pred_ret = 0.0
        current_conf = 0.0
        self.signals = []

        for i in range(start_idx, end_idx):
            date = self.dates[i]
            price = self.close[i]
            open_price = self.open_[i]

            # 计算当前权益
            equity = self.capital + self.position * price
            self.equity_curve.append({"date": date, "equity": equity, "price": price, "position": self.position})

            # 信号生成
            if i - last_retrain >= self.retrain_days:
                current_pred_ret, current_conf = self._train_and_predict(i)
                last_retrain = i

            # 风控逻辑：根据预测收益决定目标仓位
            if current_pred_ret < self.risk_threshold:
                target_pct = self.defensive_position
                signal_label = "DEFENSE"
            elif current_pred_ret > self.opportunity_threshold:
                target_pct = self.aggressive_position
                signal_label = "AGGRESSIVE"
            else:
                target_pct = self.base_position
                signal_label = "BASE"

            self.signals.append({
                "date": date,
                "predicted_ret_5d": current_pred_ret,
                "target_pct": target_pct,
                "signal": signal_label,
            })

            # 止损止盈检查（盘中）
            if self.position > 0 and self.entry_price > 0:
                ret = (price - self.entry_price) / self.entry_price
                if ret <= -self.stop_loss:
                    self._sell(open_price, date, "STOP_LOSS")
                    continue
                elif ret >= self.take_profit:
                    self._sell(open_price, date, "TAKE_PROFIT")
                    continue

            # 调整仓位至目标（T+1 开盘执行，简化处理用开盘价）
            current_pct = (self.position * price) / equity if equity > 0 else 0
            target_shares = self._target_shares(target_pct, open_price)
            delta = target_shares - self.position

            if delta > 100:  # 需要加仓
                buy_amount = delta * open_price * (1 + SLIPPAGE)
                commission = max(buy_amount * COMMISSION_RATE, MIN_COMMISSION)
                total_cost = buy_amount + commission
                if total_cost <= self.capital:
                    self.capital -= total_cost
                    self.position = target_shares
                    self.entry_price = open_price
                    self.trades.append({"date": date, "action": "BUY", "price": open_price, "shares": delta, "cost": total_cost, "reason": signal_label})
            elif delta < -100:  # 需要减仓
                sell_shares = abs(delta)
                revenue = sell_shares * open_price * (1 - SLIPPAGE)
                commission = max(revenue * COMMISSION_RATE, MIN_COMMISSION)
                stamp_tax = revenue * STAMP_TAX_RATE
                total_revenue = revenue - commission - stamp_tax
                self.capital += total_revenue
                self.position -= sell_shares
                if self.position == 0:
                    self.entry_price = 0
                self.trades.append({"date": date, "action": "SELL", "price": open_price, "shares": sell_shares, "revenue": total_revenue, "reason": signal_label})

        # 最终平仓
        if self.position > 0:
            self._sell(self.close[-1], self.dates[-1], "FINAL")
        return self._calculate_metrics()

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
            "signals": self.signals,
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
    print("=" * 120)
    print("风控守门员策略：50%基准仓位，预测<-2%防御，预测>+2%进攻，之间保持基准")
    print("=" * 120)
    print(f"{'股票':<10} {'策略':<12} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8} {'vs半仓BH':>10}")
    print("-" * 120)

    for sym, name in symbols.items():
        start_idx = 252 + 10
        bh_full = _buyhold_return(sym, start_idx, None)
        bh_half = bh_full * 0.5  # 半仓买入持有收益（近似）

        # 风控守门员
        engine = RiskFilterBacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            risk_threshold=-2.0, opportunity_threshold=2.0,
            base_position=0.5, defensive_position=0.1, aggressive_position=0.9,
            stop_loss=0.08, take_profit=0.15,
        )
        r = engine.run()
        print(f"{name:<10} {'风控守门员':<12} {r['total_return']:>+9.2%} {r['annual_return']:>+7.1%} {r['sharpe']:>7.2f} {r['max_dd']:>7.1f}% {r['trades']:>5}次 {r['win_rate']:>6.1f}% {r['avg_trade_return']:>+6.2f}% {r['total_return']*100 - bh_half:>+9.2f}%")

        # 半仓买入持有基准
        print(f"{'':10} {'半仓BH':<12} {bh_half/100:>+9.2%} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {'—':>10}")
        # 全仓买入持有
        print(f"{'':10} {'全仓BH':<12} {bh_full/100:>+9.2%} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {'—':>10}")
        print("-" * 120)


if __name__ == "__main__":
    main()
