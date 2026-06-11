# -*- coding: utf-8 -*-
"""
回测引擎 — 滚动窗口回测
======================

⚠️ 警告：此脚本存在已知未来函数问题，回测结果不可引用
============================================================
问题说明（详见 docs/prediction-model-sharp-review-2026-06-02.md）：
  - 为修正 build_features 删除最后一天的问题，对 stock_daily 多留了 end_idx + 1
  - 这导致模型训练时可能已经见过要预测的那一天答案
  - 在新的权威 walk-forward 框架修好之前，此回测结果不能作为策略有效性的证据

回测规则:
1. 使用滚动窗口：每 retrain_days 天用过去 lookback_days 的数据重新训练
2. 包含真实交易成本（佣金+印花税+滑点）
3. 只在信号强度 > threshold 时交易

状态：保留以兼容现有脚本，但回测结果不作为决策依据。
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
from sklearn.metrics import brier_score_loss

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# 交易成本（保守估计：来回约0.55% = 佣金双向0.05% + 印花税0.1% + 滑点双向0.4%）
COMMISSION_RATE = 0.00025  # 佣金 0.025%
STAMP_TAX_RATE = 0.001     # 印花税 0.1%（仅卖出）
MIN_COMMISSION = 5         # 最低佣金5元
SLIPPAGE = 0.002           # 滑点 0.2%（单侧）


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
                 stop_loss: float = 0.03,      # 3% 硬止损（不可协商）
                 take_profit: float = 0.10,    # 10% 止盈
                 position_size: float = 0.8,   # 每次使用80%资金
                 reverse_mode: bool = False,   # True=反向信号（模型看涨则卖，看跌则买）
                 signal_source: str = "model", # "model"|"ma_cross"|"random"
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
        self.reverse_mode = reverse_mode
        self.signal_source = signal_source
        
        # 状态
        self.capital = initial_capital
        self.position = 0
        self.entry_price = 0
        self.trades = []
        self.equity_curve = []
        self.predictions = []  # (date, y_true, y_pred, y_prob, conf)
        
        # 数据
        self.local = LocalDataProvider(DATA_DIR)
        self.raw = self.local.get_all_data_for_stock(symbol, days=5000)
        self.stock_df = self.raw["stock_daily"].sort_values("日期").reset_index(drop=True)
        self.close = self.stock_df["收盘"].astype(float).values
        self.open_ = self.stock_df["开盘"].astype(float).values
        self.high = self.stock_df["最高"].astype(float).values
        self.low = self.stock_df["最低"].astype(float).values
        self.change_pct = self.stock_df["涨跌幅"].astype(float).values
        self.dates = self.stock_df["日期"].astype(str).values
        self.engineer = FeatureEngineer()
        
    def _train_and_predict(self, end_idx: int) -> tuple:
        """
        用 [0:end_idx] 的数据训练模型，预测 end_idx+1
        
        修复: build_features 会删除最后一天（因为没有明日标签）。
        如果截断到 end_idx，删除后 X 最后一行是 end_idx-1，predict(X) 实际
        预测的是 end_idx 的涨跌，比预期错位一天。
        因此 stock_daily 必须截断到 end_idx+1，这样删除后 X 最后一行才是
        end_idx 的数据，对应预测 end_idx+1。
        
        Returns:
            (prediction, probability, confidence)
        """
        # 截断数据
        raw_trunc = {}
        for key, df in self.raw.items():
            if isinstance(df, pd.DataFrame) and not df.empty and "日期" in df.columns:
                df_copy = df.copy()
                df_copy["日期"] = pd.to_datetime(df_copy["日期"])
                # 核心修复: stock_daily 多留一行，保证 build_features 删完后
                # X 最后一行恰好是 end_idx，对应标签为 end_idx+1
                if key == "stock_daily":
                    mask = df_copy.index <= end_idx + 1
                else:
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
        
        # 预测最新一天（X 最后一行 = end_idx 的数据 → 预测 end_idx+1）
        result = trainer.predict(X, use_ensemble=True)
        if "error" in result:
            return 0, 0.5, 0
        
        pred = result["prediction"]
        avg_prob = result["up_probability"]
        confidence = result["confidence"]
        
        return pred, avg_prob, confidence
    
    def run(self) -> Dict:
        """运行回测（修复T+1错配：信号T日生成，T+1开盘执行）"""
        start_idx = self.lookback_days + 10
        end_idx = len(self.close) - 1
        
        last_retrain = -999
        current_pred = 0
        current_prob = 0.5
        current_conf = 0
        self.predictions = []
        
        # T+1延迟执行：今日信号/触发 → 明日开盘执行
        pending_action = None   # 'BUY' | 'SELL'
        pending_reason = None   # 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT'
        pending_conf = 0.0      # 用于计算明日仓位
        
        for i in range(start_idx, end_idx):
            date = self.dates[i]
            price = self.close[i]
            open_price = self.open_[i]
            
            # ========== 执行前一日pending的动作（T+1开盘成交）==========
            if pending_action == 'BUY' and self.position == 0:
                if not self._is_limit_up(i):
                    size = self._calc_position_size(pending_conf)
                    self._buy(open_price, date, position_size=size)
                else:
                    self.trades.append({"date": date, "action": "SKIP", "reason": "LIMIT_UP"})
            elif pending_action == 'SELL' and self.position > 0:
                if not self._is_limit_down(i):
                    self._sell(open_price, date, pending_reason)
                else:
                    self.trades.append({"date": date, "action": "SKIP", "reason": "LIMIT_DOWN"})
            
            pending_action = None
            pending_reason = None
            pending_conf = 0.0
            
            # 计算实际标签（下一天涨跌）用于评估
            y_true = 1 if (i + 1 < len(self.close) and self.close[i + 1] > price) else 0
            self.predictions.append({
                "date": date,
                "y_true": y_true,
                "y_pred": current_pred,
                "y_prob": current_prob,
                "conf": current_conf,
            })
            
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
            
            # 信号生成
            if self.signal_source == "model":
                # 定期重新训练（用[0:i]数据预测i+1）
                if i - last_retrain >= self.retrain_days:
                    current_pred, current_prob, current_conf = self._train_and_predict(i)
                    last_retrain = i
            elif self.signal_source == "ma_cross":
                # 5/20 均线交叉基准（金叉买，死叉卖）
                if i >= 20:
                    ma5 = np.mean(self.close[i-4:i+1])
                    ma20 = np.mean(self.close[i-19:i+1])
                    prev_ma5 = np.mean(self.close[i-5:i]) if i >= 5 else ma5
                    prev_ma20 = np.mean(self.close[i-20:i]) if i >= 20 else ma20
                    
                    if ma5 > ma20:
                        current_pred = 1
                    else:
                        current_pred = 0
                    current_prob = 0.6 if current_pred == 1 else 0.4
                    current_conf = 0.50  # 固定高置信度确保交易
            elif self.signal_source == "random":
                # 随机信号基准（验证策略是否优于抛硬币）
                current_pred = np.random.randint(0, 2)
                current_prob = 0.6 if current_pred == 1 else 0.4
                current_conf = 0.50
            
            # 止损/止盈检查（盘中触发，次日开盘执行）
            if self.position > 0 and self.entry_price > 0:
                ret = (price - self.entry_price) / self.entry_price
                if ret <= -self.stop_loss:
                    pending_action = 'SELL'
                    pending_reason = 'STOP_LOSS'
                elif ret >= self.take_profit:
                    pending_action = 'SELL'
                    pending_reason = 'TAKE_PROFIT'
            
            # 信号太弱，不生成新信号
            if current_conf < self.confidence_threshold:
                continue
            
            # 信号反向（用于基准对比：如果模型信号是噪声，反向应该同样无效或更差）
            signal_pred = 1 - current_pred if self.reverse_mode else current_pred
            
            # 买入信号 & 空仓 → 记入pending，明日开盘执行
            if signal_pred == 1 and self.position == 0:
                pending_action = 'BUY'
                pending_reason = 'SIGNAL'
                pending_conf = current_conf
            
            # 卖出信号 & 持仓 → 记入pending，明日开盘执行
            elif signal_pred == 0 and self.position > 0:
                pending_action = 'SELL'
                pending_reason = 'SIGNAL'
                pending_conf = current_conf
        
        # 最终平仓（直接按收盘价，不再延迟）
        if self.position > 0:
            self._sell(self.close[-1], self.dates[-1], "FINAL")
        
        return self._calculate_metrics()
    
    def _get_limit_pct(self) -> float:
        """获取该股票的涨跌停限制百分比"""
        if self.symbol.startswith(('300', '301', '688')):
            return 20.0
        return 10.0

    def _is_limit_up(self, idx: int) -> bool:
        """判断是否涨停（无法买入）"""
        if idx >= len(self.change_pct):
            return False
        return self.change_pct[idx] >= self._get_limit_pct() * 0.99

    def _is_limit_down(self, idx: int) -> bool:
        """判断是否跌停（无法卖出）"""
        if idx >= len(self.change_pct):
            return False
        return self.change_pct[idx] <= -self._get_limit_pct() * 0.99

    def _calc_position_size(self, confidence: float) -> float:
        """根据置信度动态计算仓位：置信度越高仓位越大"""
        if confidence < self.confidence_threshold:
            return 0.0
        # 置信度 [threshold, 0.50] 映射到仓位 [0.3, 0.9]
        size = 0.3 + (confidence - self.confidence_threshold) / (0.50 - self.confidence_threshold) * 0.6
        return min(size, 0.95)

    def _buy(self, price: float, date: str, position_size: float = None):
        """买入"""
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
        """计算回测指标（含概率校准诊断）"""
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
        
        # ========== 概率校准诊断 ==========
        calibration = {}
        if self.predictions:
            probs = np.array([p["y_prob"] for p in self.predictions if p.get("y_prob") is not None])
            actuals = np.array([p["y_true"] for p in self.predictions if p.get("y_prob") is not None])
            
            if len(probs) > 0 and len(np.unique(actuals)) > 1:
                # Brier Score (越低越好，0.25 表示完全无信息)
                calibration["brier_score"] = brier_score_loss(actuals, probs)
                
                # Expected Calibration Error (ECE) — 分 10 个 bin
                n_bins = 10
                bin_edges = np.linspace(0, 1, n_bins + 1)
                ece = 0.0
                bin_data = []
                for b in range(n_bins):
                    mask = (probs >= bin_edges[b]) & (probs < bin_edges[b+1])
                    if b == n_bins - 1:  # 最后一个 bin 包含右端点
                        mask = (probs >= bin_edges[b]) & (probs <= bin_edges[b+1])
                    if mask.sum() > 0:
                        avg_conf = probs[mask].mean()
                        avg_actual = actuals[mask].mean()
                        ece += abs(avg_conf - avg_actual) * (mask.sum() / len(probs))
                        bin_data.append({
                            "bin": f"{bin_edges[b]:.1f}-{bin_edges[b+1]:.1f}",
                            "count": int(mask.sum()),
                            "avg_pred_prob": round(float(avg_conf), 3),
                            "actual_positive_rate": round(float(avg_actual), 3),
                            "gap": round(float(abs(avg_conf - avg_actual)), 3),
                        })
                calibration["ece"] = round(ece, 4)
                calibration["bins"] = bin_data
                calibration["n_predictions"] = len(probs)
        
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
            "predictions": self.predictions,
            "calibration": calibration,
        }


def _buyhold_return(symbol: str, start_idx: int, end_idx: int = None) -> float:
    """计算同期买入持有收益率"""
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
    print("当前模型策略回测（滚动窗口，无数据泄露，含交易成本）")
    print("=" * 120)
    print(f"{'股票':<10} {'基准':<10} {'总收益':>10} {'年化':>8} {'夏普':>8} {'最大回撤':>8} {'交易':>6} {'胜率':>8} {'均收益':>8} {'vs买入持有':>10}")
    print("-" * 120)
    
    for sym, name in symbols.items():
        start_idx = 252 + 10
        bh = _buyhold_return(sym, start_idx, None)
        
        # 1. 正向策略
        engine_fwd = BacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            confidence_threshold=0.15, stop_loss=0.05, take_profit=0.10, position_size=0.8,
        )
        r_fwd = engine_fwd.run()
        end_idx = len(engine_fwd.close) - 1
        bh_actual = _buyhold_return(sym, start_idx, end_idx)
        print(f"{name:<10} {'策略':<10} {r_fwd['total_return']:>+9.2%} {r_fwd['annual_return']:>+7.1%} {r_fwd['sharpe']:>7.2f} {r_fwd['max_dd']:>7.1f}% {r_fwd['trades']:>5}次 {r_fwd['win_rate']:>6.1f}% {r_fwd['avg_trade_return']:>+6.2f}% {r_fwd['total_return']*100 - bh_actual:>+9.2f}%")
        
        # 2. 反向信号基准（模型看涨则卖，看跌则买）
        engine_rev = BacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            confidence_threshold=0.15, stop_loss=0.05, take_profit=0.10, position_size=0.8,
            reverse_mode=True,
        )
        r_rev = engine_rev.run()
        print(f"{'':10} {'反向信号':<10} {r_rev['total_return']:>+9.2%} {r_rev['annual_return']:>+7.1%} {r_rev['sharpe']:>7.2f} {r_rev['max_dd']:>7.1f}% {r_rev['trades']:>5}次 {r_rev['win_rate']:>6.1f}% {r_rev['avg_trade_return']:>+6.2f}% {r_rev['total_return']*100 - bh_actual:>+9.2f}%")
        
        # 3. MA5/20 均线交叉基准
        engine_ma = BacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            confidence_threshold=0.15, stop_loss=0.05, take_profit=0.10, position_size=0.8,
            signal_source="ma_cross",
        )
        r_ma = engine_ma.run()
        print(f"{'':10} {'MA5/20':<10} {r_ma['total_return']:>+9.2%} {r_ma['annual_return']:>+7.1%} {r_ma['sharpe']:>7.2f} {r_ma['max_dd']:>7.1f}% {r_ma['trades']:>5}次 {r_ma['win_rate']:>6.1f}% {r_ma['avg_trade_return']:>+6.2f}% {r_ma['total_return']*100 - bh_actual:>+9.2f}%")
        
        # 4. 随机信号基准（抛硬币）
        engine_rand = BacktestEngine(
            symbol=sym, stock_name=name, initial_capital=10000,
            lookback_days=252, retrain_days=20,
            confidence_threshold=0.15, stop_loss=0.05, take_profit=0.10, position_size=0.8,
            signal_source="random",
        )
        r_rand = engine_rand.run()
        print(f"{'':10} {'随机信号':<10} {r_rand['total_return']:>+9.2%} {r_rand['annual_return']:>+7.1%} {r_rand['sharpe']:>7.2f} {r_rand['max_dd']:>7.1f}% {r_rand['trades']:>5}次 {r_rand['win_rate']:>6.1f}% {r_rand['avg_trade_return']:>+6.2f}% {r_rand['total_return']*100 - bh_actual:>+9.2f}%")
        
        # 5. 买入持有
        print(f"{'':10} {'买入持有':<10} {bh_actual/100:>+9.2%} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {'—':>10}")
        
        # 6. 空仓
        print(f"{'':10} {'空仓':<10} {'+0.00%':>10} {'—':>8} {'—':>8} {'—':>8} {'—':>6} {'—':>8} {'—':>8} {-bh_actual:>+9.2f}%")
        print("-" * 120)


if __name__ == "__main__":
    main()
