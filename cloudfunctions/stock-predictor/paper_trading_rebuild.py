#!/usr/bin/env python3
"""
策略重建模拟盘系统 v4 — 资金管理 + 精选池联动 + 止盈止损
=========================================================
初始资金 10,000 元，精选池 2 只，等额分配，真实交易逻辑。
每次买入时预先制定止盈止损规则，严格执行并记录。

规则：
  1. 初始资金 10,000 元
  2. 精选池每日更新（Top 2 BUY 信号）
  3. 每只精选股票分配等额资金（现金 / N）
  4. 买入时扣除单边成本 0.2%，卖出再扣 0.2%（来回 0.4%）
  5. A股最小交易单位 100 股，向下取整
  6. 已有持仓的股票不再重复买入（去重）
  7. 每次买入时制定止盈止损规则：
     - 目标止盈 = 预测收益 × 0.7（封顶5%，保底1%）
     - 硬止损 = -3%
     - 跟踪止盈 = 从最高价回撤 -2%
     - 时间止损 = 5个交易日强制平仓
  8. 每日收盘后检查是否触发止盈/止损，严格执行
  9. 每日收盘后更新持仓市值和总资产净值

用法：
  python paper_trading_rebuild.py full   # 全流程
"""
import sys
import os
import json
import pandas as pd
from datetime import datetime, timedelta

REBUILD_DIR = os.path.join(os.path.dirname(__file__), "data", "rebuild")
PT_DIR = os.path.join(os.path.dirname(__file__), "data", "paper_trading")
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

LABEL_DAYS = 5
COST_RATE = 0.002          # 单边成本 0.2%
STOP_LOSS_PCT = 0.03       # 3% 硬止损
TRAILING_STOP_PCT = 0.02   # 2% 跟踪止盈回撤
TP_MAX = 5.0               # 目标止盈封顶 5%
TP_MIN = 1.0               # 目标止盈保底 1%
TP_FACTOR = 0.7            # 目标止盈 = 预测收益 × 0.7
BUY_THRESHOLD = 0.5        # 预测5日收益 > 0.5% 视为买入信号
MIN_LOT = 100              # A股最小交易单位
INITIAL_CAPITAL = 10000.0

STOCKS = {
    "600519": "贵州茅台", "601398": "工商银行", "601857": "中国石油",
    "601288": "农业银行", "601988": "中国银行", "601628": "中国人寿",
    "600036": "招商银行", "601088": "中国神华", "600900": "长江电力",
    "601318": "中国平安",
}

# 板块映射（用于持仓分散）
SYMBOL_SECTOR = {
    "600519": "食品饮料",
    "601398": "银行",
    "601857": "石油石化",
    "601288": "银行",
    "601988": "银行",
    "601628": "非银金融",
    "600036": "银行",
    "601088": "煤炭",
    "600900": "电力",
    "601318": "非银金融",
}

def get_sector(symbol: str) -> str:
    return SYMBOL_SECTOR.get(symbol, "其他")


def ensure_dir():
    os.makedirs(PT_DIR, exist_ok=True)
    for fname in ["signals.json", "trades.json", "report.json", "portfolio.json", "portfolio_history.json"]:
        path = os.path.join(PT_DIR, fname)
        if not os.path.exists(path):
            default = [] if fname in ["signals.json", "trades.json", "portfolio_history.json"] else {}
            if fname == "portfolio.json":
                default = {
                    "initial_capital": INITIAL_CAPITAL,
                    "current_cash": INITIAL_CAPITAL,
                    "total_assets": INITIAL_CAPITAL,
                    "total_return_pct": 0.0,
                    "nav": 1.0,
                    "positions": [],
                    "updated_at": datetime.now().isoformat(),
                }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(default, f, ensure_ascii=False, indent=2)


def load_json(fname):
    path = os.path.join(PT_DIR, fname)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(fname, data):
    path = os.path.join(PT_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_focus_pool():
    path = os.path.join(REBUILD_DIR, "focus_pool.json")
    if not os.path.exists(path):
        return {"date": "", "focus": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_prediction_history():
    path = os.path.join(REBUILD_DIR, "prediction_history.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_stock_daily(symbol):
    path = os.path.join(DATA_DIR, f"{symbol}_daily.csv")
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_csv(path)
    df["日期"] = pd.to_datetime(df["日期"])
    return df.sort_values("日期").reset_index(drop=True)


def get_latest_price(symbol, date=None):
    """获取某只股票最新可用收盘价"""
    df = load_stock_daily(symbol)
    if df.empty:
        return None
    if date:
        row = df[df["日期"] == pd.to_datetime(date)]
        if not row.empty:
            return float(row.iloc[0]["收盘"])
    return float(df.iloc[-1]["收盘"])


def get_prev_close(symbol):
    """获取某只股票昨日收盘价（倒数第二行）"""
    df = load_stock_daily(symbol)
    if df.empty or len(df) < 2:
        return None
    return float(df.iloc[-2]["收盘"])


def compute_exit_rules(predicted_return):
    """根据预测收益制定止盈止损规则"""
    # 目标止盈 = 预测收益 × 0.7，封顶5%保底1%
    tp = predicted_return * TP_FACTOR
    tp = max(TP_MIN, min(TP_MAX, tp))
    reasoning = (
        f"预测5日收益{predicted_return:+.2f}%，"
        f"目标止盈取{TP_FACTOR*100:.0f}%={tp:.2f}%（封顶{TP_MAX}%保底{TP_MIN}%），"
        f"硬止损-{STOP_LOSS_PCT*100:.0f}%，跟踪止盈回撤-{TRAILING_STOP_PCT*100:.0f}%，"
        f"时间止损{LABEL_DAYS}个交易日"
    )
    return {
        "take_profit_pct": round(tp, 2),
        "stop_loss_pct": round(-STOP_LOSS_PCT * 100, 2),
        "trailing_stop_pct": round(-TRAILING_STOP_PCT * 100, 2),
        "max_holding_days": LABEL_DAYS,
        "reasoning": reasoning,
    }


def allocate_and_buy(portfolio, focus_items):
    """为精选池股票分配资金并买入，同时制定止盈止损规则"""
    cash = portfolio["current_cash"]
    if cash < 1000:
        print("  ⚠️ 现金不足 ¥1000，跳过买入")
        return portfolio

    # 只买入 signal == '买入' 的股票
    buy_items = [f for f in focus_items if f.get("signal") == "买入"]
    if not buy_items:
        print("  ⚠️ 精选池无买入信号，空仓等待")
        return portfolio

    n = len(buy_items)
    capital_per_stock = cash / n

    # 收集当前持仓的板块
    holding_sectors = {get_sector(p["symbol"]) for p in portfolio["positions"] if p["status"] == "holding"}

    for item in buy_items:
        symbol = item["symbol"]
        name = item["name"]
        predicted_return = item.get("predicted_return_5d", 0)
        sector = get_sector(symbol)

        # 检查是否已有持仓
        existing = [p for p in portfolio["positions"] if p["symbol"] == symbol and p["status"] == "holding"]
        if existing:
            print(f"  ⏭ {name}({symbol}): 已有持仓，去重跳过")
            continue

        # 检查是否已有同板块持仓
        if sector in holding_sectors:
            print(f"  ⏭ {name}({symbol}): 同板块'{sector}'已有持仓，分散跳过")
            continue

        # 获取买入价格
        price = get_latest_price(symbol)
        if price is None or price <= 0:
            print(f"  ⚠️ {name}({symbol}): 无价格数据，跳过")
            continue

        # 计算可买股数（扣除成本后，向下取整到100股整数倍）
        net_amount = capital_per_stock / (1 + COST_RATE)
        shares = int(net_amount / price / MIN_LOT) * MIN_LOT

        if shares == 0:
            print(f"  ⚠️ {name}({symbol}): 资金不足以买1手（¥{price:.2f}/股），跳过")
            continue

        actual_cost = shares * price
        commission = actual_cost * COST_RATE
        total_deduction = actual_cost + commission

        if total_deduction > cash:
            shares = int((cash / (1 + COST_RATE) / price / MIN_LOT)) * MIN_LOT
            if shares == 0:
                continue
            actual_cost = shares * price
            commission = actual_cost * COST_RATE
            total_deduction = actual_cost + commission

        today = datetime.now().strftime("%Y-%m-%d")

        # 制定止盈止损规则
        exit_rules = compute_exit_rules(predicted_return)

        position = {
            "symbol": symbol,
            "name": name,
            "sector": sector,
            "entry_date": today,
            "entry_price": round(price, 2),
            "latest_price": round(price, 2),
            "shares": shares,
            "market_value": round(actual_cost, 2),
            "cost_basis": round(total_deduction, 2),
            "unrealized_pnl": round(-commission, 2),
            "status": "holding",
            "expected_exit_date": (datetime.now() + timedelta(days=LABEL_DAYS)).strftime("%Y-%m-%d"),
            "exit_rules": exit_rules,
            "highest_price": round(price, 2),     # 持仓期间最高价（用于跟踪止盈）
            "lowest_price": round(price, 2),      # 持仓期间最低价
        }

        portfolio["positions"].append(position)
        cash -= total_deduction
        portfolio["current_cash"] = round(cash, 2)

        print(f"  🟢 买入 {name}({symbol}): {shares}股 @ ¥{price:.2f} = ¥{actual_cost:.2f} 佣金¥{commission:.2f} 总扣款¥{total_deduction:.2f}")
        print(f"     📋 止盈止损规则: 目标止盈{exit_rules['take_profit_pct']:+.2f}% | 硬止损{exit_rules['stop_loss_pct']:.2f}% | 跟踪止盈回撤{exit_rules['trailing_stop_pct']:.2f}% | 时间止损{LABEL_DAYS}天")

    return portfolio


def settle_positions():
    """结算持仓：按优先级检查止盈止损规则，严格执行"""
    portfolio = load_json("portfolio.json")
    trades = load_json("trades.json")
    today = datetime.now().strftime("%Y-%m-%d")

    settled_count = 0
    for pos in portfolio["positions"]:
        if pos["status"] != "holding":
            continue

        sym = pos["symbol"]
        entry_date = pos["entry_date"]
        entry_price = pos["entry_price"]
        rules = pos.get("exit_rules", {})
        tp_pct = rules.get("take_profit_pct", 2.0) / 100      # 目标止盈比例
        sl_pct = abs(rules.get("stop_loss_pct", -3.0)) / 100  # 硬止损比例（正数）
        ts_pct = abs(rules.get("trailing_stop_pct", -2.0)) / 100  # 跟踪止盈回撤比例
        max_days = rules.get("max_holding_days", LABEL_DAYS)

        df = load_stock_daily(sym)
        if df.empty:
            continue

        entry_row = df[df["日期"] == pd.to_datetime(entry_date)]
        if entry_row.empty:
            continue

        entry_idx = entry_row.index[0]
        if entry_idx + 1 >= len(df):
            continue  # 买入后无后续数据，不结算

        post_entry = df.iloc[entry_idx + 1:]

        # 逐日检查止盈止损（优先级：硬止损 > 目标止盈 > 跟踪止盈 > 时间止损）
        exit_triggered = False
        exit_price = None
        exit_date = None
        exit_type = None
        exit_reason = None
        highest_price = pos.get("highest_price", entry_price)
        lowest_price = pos.get("lowest_price", entry_price)

        for _, row in post_entry.iterrows():
            day_close = float(row["收盘"])
            day_high = float(row.get("最高", day_close))
            day_low = float(row.get("最低", day_close))
            day_date = str(row["日期"]).split()[0]

            # 更新持仓期间最高/最低价
            highest_price = max(highest_price, day_high)
            lowest_price = min(lowest_price, day_low)

            days_held = (pd.to_datetime(day_date) - pd.to_datetime(entry_date)).days

            # 1. 硬止损：盘中最低价触发（最高优先级）
            if day_low <= entry_price * (1 - sl_pct):
                exit_triggered = True
                exit_price = day_close  # 以收盘价结算（保守）
                exit_date = day_date
                exit_type = "stop_loss"
                exit_reason = f"硬止损触发：最低价¥{day_low:.2f} ≤ 止损线¥{entry_price * (1 - sl_pct):.2f} (-{sl_pct*100:.0f}%)"
                break

            # 2. 目标止盈：收盘价达到目标
            if day_close >= entry_price * (1 + tp_pct):
                exit_triggered = True
                exit_price = day_close
                exit_date = day_date
                exit_type = "take_profit"
                exit_reason = f"目标止盈触发：收盘价¥{day_close:.2f} ≥ 止盈线¥{entry_price * (1 + tp_pct):.2f} (+{tp_pct*100:.2f}%)"
                break

            # 3. 跟踪止盈：从最高价回撤触发
            if day_close <= highest_price * (1 - ts_pct):
                exit_triggered = True
                exit_price = day_close
                exit_date = day_date
                exit_type = "trailing_stop"
                exit_reason = f"跟踪止盈触发：收盘价¥{day_close:.2f} ≤ 回撤线¥{highest_price * (1 - ts_pct):.2f} (最高¥{highest_price:.2f} 回撤{ts_pct*100:.0f}%)"
                break

            # 4. 时间止损：持有期满
            if days_held >= max_days:
                exit_triggered = True
                exit_price = day_close
                exit_date = day_date
                exit_type = "expiration"
                exit_reason = f"时间止损触发：持有{days_held}天达到上限{max_days}天"
                break

        # 更新持仓期间最高/最低价记录
        pos["highest_price"] = round(highest_price, 2)
        pos["lowest_price"] = round(lowest_price, 2)

        if exit_triggered:
            sell_amount = pos["shares"] * exit_price
            commission = sell_amount * COST_RATE
            net_proceeds = sell_amount - commission
            pnl = net_proceeds - pos["cost_basis"]

            portfolio["current_cash"] = round(portfolio["current_cash"] + net_proceeds, 2)
            pos["status"] = "closed"
            pos["exit_date"] = exit_date
            pos["exit_price"] = round(exit_price, 2)
            pos["realized_pnl"] = round(pnl, 2)
            pos["exit_type"] = exit_type
            pos["exit_reason"] = exit_reason

            trades.append({
                "id": f"{sym}_{entry_date}",
                "symbol": sym,
                "name": pos["name"],
                "entry_date": entry_date,
                "exit_date": exit_date,
                "entry_price": pos["entry_price"],
                "exit_price": round(exit_price, 2),
                "shares": pos["shares"],
                "gross_return": round((exit_price / pos["entry_price"] - 1) * 100, 4),
                "net_return": round(pnl / pos["cost_basis"] * 100, 4),
                "pnl": round(pnl, 2),
                "holding_days": (pd.to_datetime(exit_date) - pd.to_datetime(entry_date)).days,
                "type": exit_type,
                "exit_reason": exit_reason,
                "exit_rules": rules,
            })

            emoji = {"stop_loss": "🛑", "take_profit": "🎯", "trailing_stop": "📉", "expiration": "✅"}
            print(f"  {emoji.get(exit_type, '✅')} {pos['name']}({sym}) {exit_type}平仓 @ {exit_date} ¥{exit_price:.2f} 盈亏={pnl:+.2f}")
            print(f"     📋 {exit_reason}")
            settled_count += 1

    save_json("portfolio.json", portfolio)
    save_json("trades.json", trades)
    print(f"\n💾 已结算 {settled_count} 笔持仓")
    return trades


def update_portfolio():
    """更新持仓市值和总资产净值（含当日盈亏），补全缺失的止盈止损规则"""
    portfolio = load_json("portfolio.json")
    total_market_value = 0.0
    total_daily_pnl = 0.0
    total_prev_market_value = 0.0

    for pos in portfolio["positions"]:
        if pos["status"] != "holding":
            continue
        price = get_latest_price(pos["symbol"])
        prev = get_prev_close(pos["symbol"])
        if price:
            pos["latest_price"] = round(price, 2)
            pos["market_value"] = round(pos["shares"] * price, 2)
            pos["unrealized_pnl"] = round(pos["market_value"] - pos["cost_basis"], 2)

            # 补全缺失的字段（兼容旧数据）
            if "sector" not in pos:
                pos["sector"] = get_sector(pos["symbol"])
            if "exit_rules" not in pos:
                # 从信号记录中查找预测收益（日期可能差1天）
                signals = load_json("signals.json")
                pred = 0
                entry_dt = pd.to_datetime(pos.get("entry_date", ""))
                for s in signals:
                    if s.get("symbol") == pos["symbol"]:
                        sig_dt = pd.to_datetime(s.get("date", ""))
                        # 信号日期在买入日期当天或前3天内
                        if abs((sig_dt - entry_dt).days) <= 3:
                            pred = s.get("predicted_return_5d", 0)
                            break
                pos["exit_rules"] = compute_exit_rules(pred)
                pos["highest_price"] = pos.get("highest_price", pos["entry_price"])
                pos["lowest_price"] = pos.get("lowest_price", pos["entry_price"])

            # 更新持仓期间最高/最低价（用于跟踪止盈）
            if price > pos.get("highest_price", pos["entry_price"]):
                pos["highest_price"] = round(price, 2)
            if price < pos.get("lowest_price", pos["entry_price"]):
                pos["lowest_price"] = round(price, 2)

            if prev:
                pos["prev_close"] = round(prev, 2)
                pos["daily_pnl"] = round((price - prev) * pos["shares"], 2)
                pos["daily_pnl_pct"] = round((price / prev - 1) * 100, 2)
                total_daily_pnl += pos["daily_pnl"]
                total_prev_market_value += prev * pos["shares"]
            else:
                pos["daily_pnl"] = 0.0
                pos["daily_pnl_pct"] = 0.0
            total_market_value += pos["market_value"]

    portfolio["total_assets"] = round(portfolio["current_cash"] + total_market_value, 2)
    portfolio["total_return_pct"] = round((portfolio["total_assets"] / portfolio["initial_capital"] - 1) * 100, 4)
    portfolio["nav"] = round(portfolio["total_assets"] / portfolio["initial_capital"], 4)
    portfolio["daily_pnl"] = round(total_daily_pnl, 2)
    portfolio["daily_pnl_pct"] = round((total_daily_pnl / total_prev_market_value) * 100, 4) if total_prev_market_value > 0 else 0.0
    portfolio["updated_at"] = datetime.now().isoformat()

    save_json("portfolio.json", portfolio)

    # 记录净值历史
    history_path = os.path.join(PT_DIR, "portfolio_history.json")
    history = load_json("portfolio_history.json") if os.path.exists(history_path) else []
    today = datetime.now().strftime("%Y-%m-%d")
    history = [h for h in history if h["date"] != today]

    # 计算当日收益
    prev_nav = 1.0
    if len(history) > 0:
        prev_nav = history[-1]["nav"]
    daily_return = round((portfolio["nav"] / prev_nav - 1) * 100, 4) if prev_nav > 0 else 0

    history.append({
        "date": today,
        "cash": portfolio["current_cash"],
        "market_value": round(total_market_value, 2),
        "total_assets": portfolio["total_assets"],
        "nav": portfolio["nav"],
        "return_pct": portfolio["total_return_pct"],
        "daily_return_pct": daily_return,
        "daily_pnl": portfolio["daily_pnl"],
    })

    save_json("portfolio_history.json", history)

    print(f"\n💰 资产更新")
    print(f"   初始资金: ¥{portfolio['initial_capital']:.2f}")
    print(f"   现金: ¥{portfolio['current_cash']:.2f} | 持仓市值: ¥{total_market_value:.2f}")
    print(f"   总资产: ¥{portfolio['total_assets']:.2f}")
    print(f"   当日盈亏: ¥{portfolio['daily_pnl']:.2f} ({portfolio['daily_pnl_pct']:+.2f}%)")
    print(f"   净值: {portfolio['nav']:.4f} | 累计收益: {portfolio['total_return_pct']:+.2f}% | 日收益: {daily_return:+.2f}%")
    return portfolio


def generate_signals():
    """根据精选池生成买入信号（资金管理版）"""
    print("=" * 60)
    print(f"📡 生成模拟盘信号 - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    focus_pool = load_focus_pool()
    focus_items = focus_pool.get("focus", [])
    focus_date = focus_pool.get("date", "")

    print(f"\n🎯 今日精选池 ({focus_date}):")
    for f in focus_items:
        print(f"   #{f['rank']} {f['name']}({f['symbol']}) {f['signal']} 预测{f['predicted_return_5d']:+.2f}%")

    portfolio = load_json("portfolio.json")

    # 去重：检查已有持仓
    holding_symbols = {p["symbol"] for p in portfolio["positions"] if p["status"] == "holding"}
    if holding_symbols:
        print(f"📊 当前持仓: {', '.join(holding_symbols)}")
    else:
        print(f"📊 当前持仓: 无")

    # 分配资金并买入
    portfolio = allocate_and_buy(portfolio, focus_items)
    save_json("portfolio.json", portfolio)

    # 同时生成传统信号记录（兼容前端）
    signals = load_json("signals.json")
    existing_ids = {s["id"] for s in signals}

    for f in focus_items:
        sym = f["symbol"]
        date = focus_date
        record_id = f"{sym}_{date}"
        if record_id in existing_ids:
            continue
        pred = f.get("predicted_return_5d", 0)
        signal_type = "buy" if f.get("signal") == "买入" else "hold"
        price = get_latest_price(sym, date)

        signals.append({
            "id": record_id,
            "symbol": sym,
            "name": f["name"],
            "date": date,
            "predicted_return_5d": round(pred, 4),
            "signal": signal_type,
            "threshold": BUY_THRESHOLD,
            "status": "pending" if signal_type == "buy" else "settled",
            "entry_price": round(price, 2) if price else None,
            "expected_exit_date": (pd.to_datetime(date) + timedelta(days=LABEL_DAYS)).strftime("%Y-%m-%d"),
            "source": "focus_pool",
        })

    save_json("signals.json", signals)
    return signals


def generate_report():
    """生成模拟盘报告"""
    print("\n" + "=" * 60)
    print("📈 生成模拟盘报告")
    print("=" * 60)

    portfolio = load_json("portfolio.json")
    trades = load_json("trades.json")
    focus_pool = load_focus_pool()
    history = load_json("portfolio_history.json")

    positions = portfolio.get("positions", [])
    holding = [p for p in positions if p["status"] == "holding"]
    closed = [p for p in positions if p["status"] == "closed"]

    winning_trades = [t for t in trades if t.get("pnl", 0) > 0]
    losing_trades = [t for t in trades if t.get("pnl", 0) <= 0]

    total_trades = len(trades)
    win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
    total_pnl = sum(t.get("pnl", 0) for t in trades)

    by_symbol = {}
    for t in trades:
        sym = t["symbol"]
        if sym not in by_symbol:
            by_symbol[sym] = {"name": t["name"], "trades": 0, "wins": 0, "total_pnl": 0}
        by_symbol[sym]["trades"] += 1
        by_symbol[sym]["total_pnl"] += t.get("pnl", 0)
        if t.get("pnl", 0) > 0:
            by_symbol[sym]["wins"] += 1

    for sym, s in by_symbol.items():
        s["win_rate"] = round(s["wins"] / s["trades"] * 100, 1)
        s["avg_return"] = round(s["total_pnl"] / s["trades"], 2)
        s["total_return"] = round(s["total_pnl"], 2)
        del s["wins"]

    report = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "initial_capital": portfolio["initial_capital"],
        "current_cash": portfolio["current_cash"],
        "total_assets": portfolio["total_assets"],
        "nav": portfolio["nav"],
        "total_return_pct": portfolio["total_return_pct"],
        "focus_pool": focus_pool.get("focus", []),
        "focus_date": focus_pool.get("date", ""),
        "holding_positions": holding,
        "closed_positions": closed,
        "total_trades": total_trades,
        "winning_trades": len(winning_trades),
        "losing_trades": len(losing_trades),
        "win_rate": round(win_rate, 1),
        "total_pnl": round(total_pnl, 2),
        "by_symbol": by_symbol,
        "portfolio_history": history,
    }

    save_json("report.json", report)
    print(f"  总资产: ¥{portfolio['total_assets']:.2f} | 净值: {portfolio['nav']:.4f} | 累计收益: {portfolio['total_return_pct']:+.2f}%")
    print(f"  交易: {total_trades}笔 | 胜: {len(winning_trades)} | 负: {len(losing_trades)} | 胜率: {win_rate:.1f}%")
    print(f"  持仓: {len(holding)}只 | 现金: ¥{portfolio['current_cash']:.2f}")
    return report


def sync_to_public():
    """同步到前端 public 目录"""
    import shutil
    src_dir = PT_DIR
    dst_dir = os.path.join(os.path.dirname(__file__), "..", "..", "public", "paper-trading")
    os.makedirs(dst_dir, exist_ok=True)
    for fname in ["signals.json", "trades.json", "report.json", "portfolio.json", "portfolio_history.json"]:
        src = os.path.join(src_dir, fname)
        dst = os.path.join(dst_dir, fname)
        if os.path.exists(src):
            shutil.copy2(src, dst)
    focus_src = os.path.join(REBUILD_DIR, "focus_pool.json")
    focus_dst = os.path.join(dst_dir, "rebuild_focus_pool.json")
    if os.path.exists(focus_src):
        shutil.copy2(focus_src, focus_dst)
    print(f"\n🔄 已同步到 {dst_dir}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "full"
    ensure_dir()

    if cmd == "generate":
        generate_signals()
    elif cmd == "settle":
        settle_positions()
    elif cmd == "update":
        update_portfolio()
    elif cmd == "report":
        generate_report()
    elif cmd == "full":
        generate_signals()
        settle_positions()
        update_portfolio()
        generate_report()
        sync_to_public()
    else:
        print(f"未知命令: {cmd}")
        print("用法: generate | settle | update | report | full")
