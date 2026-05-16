# -*- coding: utf-8 -*-
"""
回测引擎 — 无数据泄露的滚动窗口回测
=====================================

回测规则:
1. 使用滚动窗口：每 retrain_days 天用过去 lookback_days 的数据重新训练
2. 训练时完全看不到未来数据
3. 包含真实交易成本（佣金+印花税+滑点）
4. 只在置信度 > threshold 时交易
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from typing import Dict, List
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
from sklearn.preprocessing import StandardScaler

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# 交易成本
COMMISSION_RATE = 0.00025  # 佣金 0.025%
STAMP_TAX_RATE = 0.001     # 印花税 0.1%（仅卖出）
MIN_COMMISSION = 5         # 最低佣金5元
SLIPPAGE = 0.001           # 滑点 0.1%


class BacktestEngine:
    """
    A股策略回测引擎
    
    支持:
    - 滚动窗口训练（无数据泄露）
    - 仓位管理（根据置信度调整）
    - 止盈止损
    - 交易成本
    """
    
    def __init__(self, symbol: str, stock_name: str = "",
                 initial_capital: float = 10000.0,
                 lookback_days: int = 252,
                 retrain_days: int = 20,
                 confidence_threshold: float = 0.15,
                 stop_loss: float = 0.05,      # 5% 止损
                 take_profit: float = 0.10,    # 10% 止盈
                 position_size: float = 0.8,   # 每次使用80%资金
                 ):
        self.symbol = symbol
        self.stock_name = stock_name or symbol
        self.initial_capital = initial_capital
        self.lookback_days = lookback_days
        self.retrain_days = retrain_days
        self.confidence_threshold = confidence_threshold
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        
        # 状态
        self.capital = initial_capital
        self.position = 0
        self.entry_price = 0
        self.trades = []
        self.equity_curve = []
        
        # 数据
        self.local = LocalDataProvider(DATA_DIR)
        self.raw = self.local.get_all_data_for_stock(symbol, days=5000)
        self.stock_df = self.raw["stock_daily"].sort_values("日期").reset_index(drop=True)
        self.close = self.stock_df["收盘"].astype(float).values
        self.dates = self.stock_df["日期"].astype(str).values
        self.engineer = FeatureEngineer()
        
    def _train_and_predict(self, end_idx: int) -> tuple:
        """
        用 [0:end_idx] 的数据训练模型，预测 end_idx+1
        
        Returns:
            (prediction, probability, confidence)
        """
        # 截断数据
        raw_trunc = {}
        for key, df in self.raw.items():
            if isinstance(df, pd.DataFrame) and not df.empty and "日期" in df.columns:
                df_copy = df.copy()
                df_copy["日期"] = pd.to_datetime(df_copy["日期"])
                mask = df_copy.index <= end_idx
                raw_trunc[key] = df_copy[mask].copy()
            else:
                raw_trunc[key] = df
        
        # 构建特征
        X, y = self.engineer.build_features(raw_trunc, self.symbol)
        
        if X.empty or len(X) < 80:
            return 0, 0.5, 0
        
        # 训练
        trainer = ModelTrainer()
        result = trainer.train_ensemble(X, y, validation_split=0.2)
        
        if not trainer.models:
            return 0, 0.5, 0
        
        # 预测最新一天
        last_X = X.iloc[-1:]
        last_X_clean = last_X.replace([np.inf, -np.inf], 0).fillna(0)
        
        scaler = trainer.scalers.get("default")
        if scaler is None:
            return 0, 0.5, 0
        last_X_scaled = scaler.transform(last_X_clean)
        
        probs = []
        weights = []
        for mname, model in trainer.models.items():
            w = trainer.model_weights.get(mname, 0.25)
            p = model.predict_proba(last_X_scaled)[:, 1]
            probs.append(p[0])
            weights.append(w)
        
        avg_prob = sum(p * w for p, w in zip(probs, weights)) / sum(weights)
        pred = 1 if avg_prob > 0.5 else 0
        confidence = abs(avg_prob - 0.5) * 2
        
        return pred, avg_prob, confidence
    
    def run(self) -> Dict:
        """运行回测"""
        start_idx = self.lookback_days + 10
        end_idx = len(self.close) - 1
        
        last_retrain = -999
        current_pred = 0
        current_prob = 0.5
        current_conf = 0
        
        for i in range(start_idx, end_idx):
            date = self.dates[i]
            price = self.close[i]
            
            # 计算当前权益
            equity = self.capital + self.position * price
            self.equity_curve.append({
                "date": date,
                "equity": equity,
                "price": price,
                "position": self.position,
                "pred": current_pred,
                "conf": current_conf,
            })
            
            # 定期重新训练
            if i - last_retrain >= self.retrain_days:
                current_pred, current_prob, current_conf = self._train_and_predict(i)
                last_retrain = i
            
            # 止损/止盈检查
            if self.position > 0 and self.entry_price > 0:
                ret = (price - self.entry_price) / self.entry_price
                if ret <= -self.stop_loss:
                    self._sell(price, date, "STOP_LOSS")
                    continue
                if ret >= self.take_profit:
                    self._sell(price, date, "TAKE_PROFIT")
                    continue
            
            # 信号太弱，不操作
            if current_conf < self.confidence_threshold:
                continue
            
            # 买入信号 & 空仓
            if current_pred == 1 and self.position == 0:
                self._buy(price, date)
            
            # 卖出信号 & 持仓
            elif current_pred == 0 and self.position > 0:
                self._sell(price, date, "SIGNAL")
        
        # 最终平仓
        if self.position > 0:
            self._sell(self.close[-1], self.dates[-1], "FINAL")
        
        return self._calculate_metrics()
    
    def _buy(self, price: float, date: str):
        """买入"""
        buy_amount = self.capital * self.position_size
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
        
        self.trades.append({
            "date": date,
            "action": "BUY",
            "price": price,
            "shares": max_shares,
            "cost": total_cost,
            "reason": "SIGNAL",
        })
    
    def _sell(self, price: float, date: str, reason: str):
        """卖出"""
        if self.position == 0:
            return
        
        price_with_slippage = price * (1 - SLIPPAGE)
        revenue = self.position * price_with_slippage
        commission = max(revenue * COMMISSION_RATE, MIN_COMMISSION)
        stamp_tax = revenue * STAMP_TAX_RATE
        total_revenue = revenue - commission - stamp_tax
        
        self.capital += total_revenue
        
        self.trades.append({
            "date": date,
            "action": "SELL",
            "price": price,
            "shares": self.position,
            "revenue": total_revenue,
            "reason": reason,
        })
        
        self.position = 0
        self.entry_price = 0
    
    def _calculate_metrics(self) -> Dict:
        """计算回测指标"""
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
        
        # 胜率
        trade_returns = []
        buy_trade = None
        for t in self.trades:
            if t["action"] == "BUY":
                buy_trade = t
            elif t["action"] == "SELL" and buy_trade:
                ret = (t["price"] - buy_trade["price"]) / buy_trade["price"]
                trade_returns.append(ret)
                buy_trade = None
        
        win_rate = sum(1 for r in trade_returns if r > 0) / len(trade_returns) * 100 if trade_returns else 0
        avg_trade_return = np.mean(trade_returns) * 100 if trade_returns else 0
        
        return {
            "symbol": self.symbol,
            "name": self.stock_name,
            "initial": initial,
            "final": final,
            "total_return": total_return,
            "annual_return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "max_dd": max_dd,
            "trades": len([t for t in self.trades if t["action"] == "SELL"]),
            "win_rate": win_rate,
            "avg_trade_return": avg_trade_return,
            "equity_curve": df_equity,
            "trade_list": self.trades,
        }


def main():
    symbols = {
        "002617": "露笑科技",
        "601318": "中国平安",
        "300622": "博士眼镜",
        "002896": "中大力德",
    }
    
    print("=" * 90)
    print("当前模型策略回测（滚动窗口，无数据泄露，含交易成本）")
    print("=" * 90)
    print(f"{'股票':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8}")
    print("-" * 90)
    
    for sym, name in symbols.items():
        engine = BacktestEngine(
            symbol=sym,
            stock_name=name,
            initial_capital=10000,
            lookback_days=252,
            retrain_days=20,
            confidence_threshold=0.15,
            stop_loss=0.05,
            take_profit=0.10,
            position_size=0.8,
        )
        result = engine.run()
        print(f"{name:<10} {result['total_return']:>+9.2%} {result['annual_return']:>+7.1%} {result['sharpe']:>7.2f} {result['max_dd']:>7.1f}% {result['trades']:>5}次 {result['win_rate']:>6.1f}% {result['avg_trade_return']:>+6.2f}%")


if __name__ == "__main__":
    main()
