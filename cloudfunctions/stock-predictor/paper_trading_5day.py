#!/usr/bin/env python3
"""
5日策略模拟盘系统

用法：
  python paper_trading_5day.py generate   # 生成今日信号
  python paper_trading_5day.py settle     # 结算到期持仓
  python paper_trading_5day.py report     # 生成周报
  python paper_trading_5day.py full       # 生成+结算+报告

数据文件：
  paper_trading/signals.json  - 每日信号记录
  paper_trading/trades.json   - 交易记录（含实际盈亏）
  paper_trading/report.json   - 最新周报
"""

import sys
import os
import json
import warnings
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"

from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineer import FeatureEngineer

# ============ 模拟盘配置 ============
PT_DIR = os.path.join(os.path.dirname(__file__), "paper_trading")
LABEL_DAYS = 5
COST_PER_TRADE = 0.004   # 来回成本 0.4%（保守估计）
STOP_LOSS_PCT = 0.03     # 3% 硬止损
INIT_CAPITAL = 10000.0

# 每只股票的最优配置（来自optimize_5day_strategy.py）
STOCK_CONFIG = {
    "601318": {
        "name": "中国平安",
        "baostock": "sh.601318",
        "threshold": 0.50,
        "top_k": 9999,  # 全特征
        "enabled": True,
    },
    "002617": {
        "name": "露笑科技",
        "baostock": "sz.002617",
        "threshold": 0.70,
        "top_k": 9999,
        "enabled": False,  # 回测负收益，暂不模拟
    },
    "300622": {
        "name": "博士眼镜",
        "baostock": "sz.300622",
        "threshold": 0.60,
        "top_k": 20,
        "enabled": True,
    },
    "002896": {
        "name": "中大力德",
        "baostock": "sz.002896",
        "threshold": 0.60,
        "top_k": 20,
        "enabled": True,
    },
}


def ensure_files():
    """确保数据文件存在"""
    os.makedirs(PT_DIR, exist_ok=True)
    for fname in ["signals.json", "trades.json", "report.json"]:
        path = os.path.join(PT_DIR, fname)
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as f:
                json.dump([] if fname != "report.json" else {}, f, ensure_ascii=False, indent=2)


def load_json(fname):
    path = os.path.join(PT_DIR, fname)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(fname, data):
    path = os.path.join(PT_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_stock_data(symbol):
    """加载单只股票数据"""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    def load_csv(path, date_col):
        df = pd.read_csv(path)
        df[date_col] = pd.to_datetime(df[date_col])
        return df.sort_values(date_col).reset_index(drop=True)
    
    stock = load_csv(os.path.join(data_dir, f"{symbol}_daily.csv"), "日期")
    sh_index = load_csv(os.path.join(data_dir, "sh_index_000001.csv"), "日期")
    sz_index = load_csv(os.path.join(data_dir, "sz_index_399001.csv"), "日期")
    cy_index = load_csv(os.path.join(data_dir, "cy_index_399006.csv"), "日期")
    us = load_csv(os.path.join(data_dir, "us_overnight.csv"), "date")
    nb = load_csv(os.path.join(data_dir, "northbound_money.csv"), "日期")
    zt = load_csv(os.path.join(data_dir, "zt_pool.csv"), "date")
    bond = load_csv(os.path.join(data_dir, "bond_yield.csv"), "日期")
    
    value_path = os.path.join(data_dir, f"{symbol}_value.csv")
    value = pd.DataFrame()
    if os.path.exists(value_path):
        value = load_csv(value_path, "数据日期")
        value = value.rename(columns={"数据日期": "日期"})
    
    return {
        "stock_daily": stock, "sh_index": sh_index, "sz_index": sz_index,
        "cy_index": cy_index, "us_overnight": us, "northbound_money": nb,
        "zt_pool": zt, "bond_yield": bond, "value": value,
    }


def build_features(data, symbol):
    """构建特征"""
    fe = FeatureEngineer()
    stock_df = data["stock_daily"]
    all_factors = []
    
    all_factors.append(fe.calc_market_environment_factors(stock_df, data["sh_index"], data["sz_index"], data["cy_index"]))
    all_factors.append(fe.calc_market_energy_factors(stock_df, data["sh_index"]))
    all_factors.append(fe.calc_market_sentiment_factors(stock_df, pd.DataFrame()))
    all_factors.append(fe.calc_technical_indicators(stock_df))
    all_factors.append(fe.calc_sector_heat_factors(stock_df, pd.DataFrame(), ""))
    all_factors.append(fe.calc_fund_anomaly_factors(stock_df, pd.DataFrame()))
    all_factors.append(fe.calc_us_market_factors(stock_df, data["us_overnight"]))
    all_factors.append(fe.calc_market_sentiment_factors_v2(stock_df, data["northbound_money"], data["zt_pool"], data["bond_yield"]))
    
    value_df = data["value"]
    if not value_df.empty:
        vf = pd.DataFrame(index=stock_df.index)
        dates = pd.to_datetime(stock_df["日期"]).dt.strftime("%Y-%m-%d")
        vd = value_df["日期"].dt.strftime("%Y-%m-%d")
        vm = dict(zip(vd, value_df.to_dict("records")))
        for col in ["PE(TTM)", "PE(静)", "市净率", "PEG值", "市现率", "市销率"]:
            vf[f"value_{col}"] = dates.map(lambda d: vm.get(d, {}).get(col, np.nan))
        for col in ["PE(TTM)", "市净率", "PEG值", "市现率", "市销率"]:
            c = f"value_{col}"
            vf[f"{c}_pctile"] = vf[c].rolling(250).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100 if len(x)>0 else 50)
        all_factors.append(vf)
    else:
        all_factors.append(pd.DataFrame(index=stock_df.index))
    
    features = pd.concat(all_factors, axis=1)
    
    # 5日特有特征
    close = stock_df["收盘"]
    volume = stock_df["成交量"]
    features["momentum_5d"] = close.pct_change(5) * 100
    features["momentum_10d"] = close.pct_change(10) * 100
    features["momentum_20d"] = close.pct_change(20) * 100
    features["momentum_60d"] = close.pct_change(60) * 100
    features["volatility_5d"] = close.pct_change().rolling(5).std() * 100 * np.sqrt(5)
    features["volatility_10d"] = close.pct_change().rolling(10).std() * 100 * np.sqrt(10)
    features["volatility_20d"] = close.pct_change().rolling(20).std() * 100 * np.sqrt(20)
    features["volume_ma5_ratio"] = volume / volume.rolling(5).mean()
    features["volume_ma10_ratio"] = volume / volume.rolling(10).mean()
    features["volume_ma20_ratio"] = volume / volume.rolling(20).mean()
    features["price_pctile_5d"] = close.rolling(5).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    features["price_pctile_10d"] = close.rolling(10).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    features["price_pctile_20d"] = close.rolling(20).apply(lambda x: (x.iloc[-1]-x.min())/(x.max()-x.min()+1e-10)*100)
    delta = close.diff()
    gain_5 = delta.where(delta > 0, 0).rolling(5).mean()
    loss_5 = (-delta.where(delta < 0, 0)).rolling(5).mean()
    features["rsi_5"] = 100 - 100 / (1 + gain_5 / (loss_5 + 1e-10))
    features["max_drawdown_5d"] = (close.rolling(5).min() / close - 1) * 100
    features["max_runup_5d"] = (close.rolling(5).max() / close - 1) * 100
    features["range_5d"] = (close.rolling(5).max() - close.rolling(5).min()) / close * 100
    features["volume_chg_5d"] = (volume / volume.shift(5) - 1) * 100
    ema5 = close.ewm(span=5).mean()
    ema10 = close.ewm(span=10).mean()
    features["macd_5_10"] = (ema5 - ema10) / close * 100
    
    return features.replace([np.inf, -np.inf], 0).fillna(0)


def train_and_predict(symbol, config):
    """
    训练模型并预测最新信号
    
    返回: {
        "date": 最新日期,
        "price": 最新收盘价,
        "pred": 0/1,
        "proba": 概率,
        "signal": "buy" / "hold",
        "top_features": {特征名: 重要性}
    }
    """
    data = load_stock_data(symbol)
    stock_df = data["stock_daily"]
    features = build_features(data, symbol)
    
    # 准备5日标签（用于训练）
    close = stock_df["收盘"].values
    future_return = pd.Series(close).shift(-LABEL_DAYS) / pd.Series(close) - 1
    y = (future_return > 0).astype(int)
    
    # 每5日采样
    indices = list(range(0, len(stock_df), LABEL_DAYS))
    valid_mask = ~features.isnull().any(axis=1) & ~y.isnull()
    valid_indices = [i for i in indices if valid_mask.iloc[i] and i >= 60]
    
    X = features.iloc[valid_indices]
    y = y.iloc[valid_indices]
    
    if len(X) < 100:
        return None
    
    # 特征选择
    if config["top_k"] < len(X.columns):
        # 先用全特征训练获取重要性
        scaler_temp = StandardScaler()
        X_temp = scaler_temp.fit_transform(X)
        gbdt_temp = GradientBoostingClassifier(
            n_estimators=150, max_depth=4, learning_rate=0.08,
            min_samples_split=20, min_samples_leaf=10, random_state=42
        )
        gbdt_temp.fit(X_temp, y)
        importance = pd.Series(gbdt_temp.feature_importances_, index=X.columns)
        top_features = importance.nlargest(config["top_k"]).index.tolist()
        X = X[top_features]
    
    # 训练最终模型（排除最后一个样本，防止数据泄露）
    scaler = StandardScaler()
    X_s = scaler.fit_transform(X)
    gbdt = GradientBoostingClassifier(
        n_estimators=150, max_depth=4, learning_rate=0.08,
        min_samples_split=20, min_samples_leaf=10, random_state=42
    )
    gbdt.fit(X_s[:-1], y.iloc[:-1])
    
    # 获取特征重要性
    importance = pd.Series(gbdt.feature_importances_, index=X.columns)
    
    # 预测最新一天（取全部数据的最后一行，不是训练集的最后一行）
    latest_feature = features[X.columns].iloc[[-1]]
    X_latest_s = scaler.transform(latest_feature)
    pred = gbdt.predict(X_latest_s)[0]
    proba = gbdt.predict_proba(X_latest_s)[0, 1]
    
    latest_date = stock_df.iloc[-1]["日期"]
    latest_price = stock_df.iloc[-1]["收盘"]
    
    return {
        "date": pd.to_datetime(latest_date).strftime("%Y-%m-%d"),
        "price": float(latest_price),
        "pred": int(pred),
        "proba": float(proba),
        "signal": "buy" if pred == 1 and proba > config["threshold"] else "hold",
        "threshold": config["threshold"],
        "top_features": importance.nlargest(5).to_dict(),
    }


def generate_signals():
    """生成今日信号"""
    print("=" * 60)
    print(f"📡 生成模拟盘信号 - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    
    signals = load_json("signals.json")
    today = datetime.now().strftime("%Y-%m-%d")
    
    for symbol, config in STOCK_CONFIG.items():
        if not config["enabled"]:
            continue
        
        print(f"\n🔍 {config['name']}({symbol})...", end=" ")
        result = train_and_predict(symbol, config)
        if result is None:
            print("数据不足，跳过")
            continue
        
        # 检查今天是否已经生成过
        existing = [s for s in signals if s["symbol"] == symbol and s["date"] == result["date"]]
        if existing:
            print(f"[{result['date']}] 已存在，跳过")
            continue
        
        record = {
            "id": f"{symbol}_{result['date']}",
            "symbol": symbol,
            "name": config["name"],
            "date": result["date"],
            "price": result["price"],
            "pred": result["pred"],
            "proba": round(result["proba"], 4),
            "threshold": result["threshold"],
            "signal": result["signal"],
            "top_features": {k: round(v, 6) for k, v in result["top_features"].items()},
            "expected_exit_date": (pd.to_datetime(result["date"]) + timedelta(days=LABEL_DAYS)).strftime("%Y-%m-%d"),
            "status": "pending",  # pending / settled
            "actual_return": None,
            "actual_exit_price": None,
        }
        
        signals.append(record)
        
        emoji = "🟢" if result["signal"] == "buy" else "⚪"
        print(f"[{result['date']}] {emoji} {result['signal'].upper()} 概率={result['proba']:.3f}")
    
    save_json("signals.json", signals)
    print(f"\n💾 已保存 {len(signals)} 条信号记录")
    return signals


def _check_stop_loss(sig, stock_df):
    """
    检查是否触发3%硬止损。
    返回 (triggered, exit_date, exit_price, reason) 或 (False, None, None, None)
    """
    entry_date = sig["date"]
    entry_price = sig["price"]
    
    # 找到买入日之后的所有交易日
    entry_idx = stock_df[stock_df["日期"] >= entry_date].index
    if len(entry_idx) == 0:
        return False, None, None, None
    
    post_entry = stock_df.loc[entry_idx[0]:]
    # 跳过买入日当天，从次日开始检查
    post_entry = post_entry.iloc[1:]
    
    stop_price = entry_price * (1 - STOP_LOSS_PCT)
    
    for _, row in post_entry.iterrows():
        if row["收盘"] <= stop_price:
            return True, row["日期"], float(row["收盘"]), "STOP_LOSS"
    
    return False, None, None, None


def settle_positions():
    """结算到期持仓（含3%硬止损检查）"""
    print("\n" + "=" * 60)
    print("💰 结算到期持仓（含-3%硬止损）")
    print("=" * 60)
    
    signals = load_json("signals.json")
    trades = load_json("trades.json")
    today = datetime.now().strftime("%Y-%m-%d")
    
    settled_count = 0
    
    for sig in signals:
        if sig["status"] != "pending" or sig["signal"] != "buy":
            continue
        
        symbol = sig["symbol"]
        config = STOCK_CONFIG[symbol]
        entry_date = sig["date"]
        entry_price = sig["price"]
        
        # 加载实际数据
        data = load_stock_data(symbol)
        stock_df = data["stock_daily"]
        
        # ========== 优先检查止损 ==========
        sl_triggered, sl_date, sl_price, sl_reason = _check_stop_loss(sig, stock_df)
        if sl_triggered and pd.to_datetime(sl_date) <= pd.to_datetime(today):
            gross_return = (sl_price / entry_price - 1)
            net_return = gross_return - COST_PER_TRADE
            
            sig["status"] = "settled"
            sig["actual_exit_date"] = pd.to_datetime(sl_date).strftime("%Y-%m-%d")
            sig["actual_exit_price"] = sl_price
            sig["actual_return"] = round(net_return * 100, 4)
            sig["gross_return"] = round(gross_return * 100, 4)
            sig["stop_loss_triggered"] = True
            
            trade = {
                "id": sig["id"],
                "symbol": symbol,
                "name": config["name"],
                "entry_date": entry_date,
                "exit_date": pd.to_datetime(sl_date).strftime("%Y-%m-%d"),
                "entry_price": entry_price,
                "exit_price": sl_price,
                "gross_return": round(gross_return * 100, 4),
                "net_return": round(net_return * 100, 4),
                "holding_days": LABEL_DAYS,
                "reason": "STOP_LOSS",
            }
            
            existing_trade = [t for t in trades if t["id"] == trade["id"]]
            if not existing_trade:
                trades.append(trade)
                settled_count += 1
                print(f"  🛑 {config['name']}: 买入{entry_date}@{entry_price:.2f} → 止损{sl_date}@{sl_price:.2f} | 净收益={net_return*100:+.2f}%")
            continue
        
        # ========== 再检查是否到了平仓日 ==========
        exit_date = sig.get("expected_exit_date")
        if not exit_date:
            continue
        
        if pd.to_datetime(today) < pd.to_datetime(exit_date):
            continue
        
        # 找到平仓日或之后第一个交易日的收盘价
        exit_df = stock_df[stock_df["日期"] >= exit_date]
        if exit_df.empty:
            print(f"  {config['name']}: 平仓日({exit_date})无数据，跳过")
            continue
        
        exit_price = float(exit_df.iloc[0]["收盘"])
        exit_actual_date = pd.to_datetime(exit_df.iloc[0]["日期"]).strftime("%Y-%m-%d")
        
        gross_return = (exit_price / entry_price - 1)
        net_return = gross_return - COST_PER_TRADE
        
        # 更新信号记录
        sig["status"] = "settled"
        sig["actual_exit_date"] = exit_actual_date
        sig["actual_exit_price"] = exit_price
        sig["actual_return"] = round(net_return * 100, 4)
        sig["gross_return"] = round(gross_return * 100, 4)
        
        # 添加到交易记录
        trade = {
            "id": sig["id"],
            "symbol": symbol,
            "name": config["name"],
            "entry_date": entry_date,
            "exit_date": exit_actual_date,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "gross_return": round(gross_return * 100, 4),
            "net_return": round(net_return * 100, 4),
            "holding_days": LABEL_DAYS,
            "reason": "EXPIRE",
        }
        
        # 避免重复记录
        existing_trade = [t for t in trades if t["id"] == trade["id"]]
        if not existing_trade:
            trades.append(trade)
            settled_count += 1
            emoji = "✅" if net_return > 0 else "❌"
            print(f"  {emoji} {config['name']}: 买入{entry_date}@{entry_price:.2f} → 卖出{exit_actual_date}@{exit_price:.2f} | 净收益={net_return*100:+.2f}%")
    
    save_json("signals.json", signals)
    save_json("trades.json", trades)
    
    if settled_count == 0:
        print("  无到期持仓")
    else:
        print(f"\n💾 已结算 {settled_count} 笔交易")
    
    return trades


def generate_report():
    """生成周报"""
    print("\n" + "=" * 60)
    print("📊 生成模拟盘周报")
    print("=" * 60)
    
    trades = load_json("trades.json")
    signals = load_json("signals.json")
    
    if not trades:
        print("  暂无交易记录")
        return
    
    # 按股票分组统计
    by_symbol = {}
    for t in trades:
        sym = t["symbol"]
        if sym not in by_symbol:
            by_symbol[sym] = []
        by_symbol[sym].append(t)
    
    report = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_trades": len(trades),
        "winning_trades": sum(1 for t in trades if t["net_return"] > 0),
        "losing_trades": sum(1 for t in trades if t["net_return"] <= 0),
        "win_rate": round(sum(1 for t in trades if t["net_return"] > 0) / len(trades) * 100, 2),
        "avg_return": round(sum(t["net_return"] for t in trades) / len(trades), 4),
        "total_return": round(sum(t["net_return"] for t in trades), 4),
        "by_symbol": {},
        "pending_signals": [],
    }
    
    for sym, sym_trades in by_symbol.items():
        report["by_symbol"][sym] = {
            "name": STOCK_CONFIG[sym]["name"],
            "trades": len(sym_trades),
            "win_rate": round(sum(1 for t in sym_trades if t["net_return"] > 0) / len(sym_trades) * 100, 2),
            "avg_return": round(sum(t["net_return"] for t in sym_trades) / len(sym_trades), 4),
            "total_return": round(sum(t["net_return"] for t in sym_trades), 4),
        }
    
    # 待结算信号
    for sig in signals:
        if sig["status"] == "pending" and sig["signal"] == "buy":
            report["pending_signals"].append({
                "symbol": sig["symbol"],
                "name": sig["name"],
                "entry_date": sig["date"],
                "entry_price": sig["price"],
                "expected_exit": sig["expected_exit_date"],
            })
    
    save_json("report.json", report)
    
    print(f"\n  总交易: {report['total_trades']}次")
    print(f"  胜率: {report['win_rate']:.1f}% ({report['winning_trades']}赢/{report['losing_trades']}亏)")
    print(f"  均收益: {report['avg_return']:+.2f}%")
    print(f"  累计收益: {report['total_return']:+.2f}%")
    print(f"\n  按股票:")
    for sym, s in report["by_symbol"].items():
        print(f"    {s['name']}: {s['trades']}次, 胜率{s['win_rate']:.1f}%, 累计{s['total_return']:+.2f}%")
    
    if report["pending_signals"]:
        print(f"\n  待平仓持仓:")
        for p in report["pending_signals"]:
            print(f"    {p['name']}: 买入{p['entry_date']}@{p['entry_price']:.2f}, 预计平仓{p['expected_exit']}")
    
    return report


def main():
    ensure_files()
    
    if len(sys.argv) < 2:
        cmd = "full"
    else:
        cmd = sys.argv[1]
    
    if cmd == "generate":
        generate_signals()
    elif cmd == "settle":
        settle_positions()
    elif cmd == "report":
        generate_report()
    elif cmd == "full":
        generate_signals()
        settle_positions()
        generate_report()
    else:
        print(f"未知命令: {cmd}")
        print("用法: python paper_trading_5day.py [generate|settle|report|full]")


if __name__ == "__main__":
    main()
