import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Wallet, Clock, Calendar,
  BarChart3, Target, AlertCircle, Loader2,
  RefreshCw, Activity, PiggyBank, TrendingUp,
  ClipboardList, Play, RotateCcw, Landmark,
  Package, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

interface Signal {
  id: string;
  symbol: string;
  name: string;
  date: string;
  entry_price: number | null;
  predicted_return_5d: number;
  threshold: number;
  signal: 'buy' | 'hold';
  expected_exit_date: string;
  status: 'pending' | 'settled';
  actual_return?: number;
  direction_correct?: boolean;
  actual_exit_date?: string;
}

interface Trade {
  id: string;
  symbol: string;
  name: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  gross_return: number;
  net_return: number;
  holding_days: number;
  type?: string;
  exit_reason?: string;
  exit_rules?: ExitRules;
}

interface FocusPoolItem {
  rank: number;
  symbol: string;
  name: string;
  predicted_return_5d: number;
  signal: string;
  confidence: number;
  reason: string;
  sector?: string;
}

interface ExitRules {
  take_profit_pct: number;
  stop_loss_pct: number;
  trailing_stop_pct: number;
  max_holding_days: number;
  reasoning: string;
}

interface Position {
  symbol: string;
  name: string;
  sector?: string;
  entry_date: string;
  entry_price: number;
  latest_price: number;
  prev_close: number;
  shares: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  status: 'holding' | 'closed';
  expected_exit_date: string;
  exit_rules?: ExitRules;
  highest_price?: number;
  lowest_price?: number;
}

interface Portfolio {
  initial_capital: number;
  current_cash: number;
  total_assets: number;
  total_market_value: number;
  total_return_pct: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  nav: number;
  positions: Position[];
  updated_at: string;
}

interface PortfolioHistoryItem {
  date: string;
  cash: number;
  market_value: number;
  total_assets: number;
  nav: number;
  return_pct: number;
  daily_return_pct: number;
}

interface Report {
  generated_at: string;
  focus_pool: FocusPoolItem[];
  focus_date: string;
  initial_capital: number;
  current_cash: number;
  total_assets: number;
  total_market_value: number;
  nav: number;
  total_return_pct: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  holding_positions: Position[];
  total_signals: number;
  buy_signals: number;
  settled_signals: number;
  pending_signals: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_return: number;
  total_return: number;
  by_symbol: Record<string, {
    name: string;
    trades: number;
    win_rate: number;
    avg_return: number;
    total_return: number;
  }>;
  pending_list: Array<{
    symbol: string;
    name: string;
    entry_date: string;
    predicted_return: number;
    expected_exit: string;
  }>;
  portfolio_history: PortfolioHistoryItem[];
}

function StatCard({ label, value, unit, icon: Icon, color, subtext }: {
  label: string; value: string | number; unit: string;
  icon: typeof Wallet; color: string; subtext?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {typeof value === 'number' ? value.toFixed(unit === '%' ? 2 : 0) : value}{unit}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">{label}</div>
        {subtext && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{subtext}</div>}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const isBuy = signal.signal === 'buy';
  const isSettled = signal.status === 'settled';

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isBuy ? 'border-red-100 dark:border-red-800/30' : 'border-gray-100 dark:border-gray-800'
    }`}>
      <div className="w-full px-3 py-2.5 flex items-center gap-3 text-left">
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          isBuy ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
        }`} />
        <div className="w-20 shrink-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{signal.name}</div>
          <div className="text-[10px] text-gray-400 font-mono">{signal.symbol}</div>
        </div>
        <div className="w-24 shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">{signal.date}</div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {signal.entry_price ? `¥${signal.entry_price.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              isBuy
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}>
              {isBuy ? '买入' : '观望'}
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              预测 {(signal.predicted_return_5d >= 0 ? '+' : '') + signal.predicted_return_5d.toFixed(2)}% / 阈值 {signal.threshold}%
            </span>
          </div>
          {isBuy && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              预计平仓 {signal.expected_exit_date}
            </div>
          )}
        </div>
        {isSettled && signal.actual_return !== undefined && (
          <div className={`flex items-center gap-1.5 shrink-0 ${
            signal.direction_correct ? 'text-red-600' : 'text-green-600'
          }`}>
            <span className="text-xs font-bold">
              {signal.actual_return > 0 ? '+' : ''}{signal.actual_return.toFixed(2)}%
            </span>
            <span className={`text-[10px] px-1 py-0.5 rounded ${
              signal.direction_correct
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600'
                : 'bg-green-50 dark:bg-green-900/20 text-green-600'
            }`}>
              {signal.direction_correct ? '✓' : '✗'}
            </span>
          </div>
        )}
        {!isSettled && isBuy && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded shrink-0">
            持仓中
          </span>
        )}
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isWin = trade.net_return > 0;
  const typeLabels: Record<string, { label: string; color: string }> = {
    stop_loss: { label: '止损', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    take_profit: { label: '止盈', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    trailing_stop: { label: '跟踪', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    expiration: { label: '到期', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  };
  const typeInfo = trade.type ? typeLabels[trade.type] : null;

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isWin ? 'bg-red-500' : 'bg-green-500'}`} />
        <div className="w-16 shrink-0 text-xs font-medium text-gray-700 dark:text-gray-300">{trade.name}</div>
        <div className="w-20 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
          {trade.entry_date} → {trade.exit_date}
        </div>
        <div className="flex-1 text-[11px] text-gray-400 dark:text-gray-500">
          ¥{trade.entry_price.toFixed(2)} → ¥{trade.exit_price.toFixed(2)}
        </div>
        {typeInfo && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
        )}
        <div className={`text-sm font-bold shrink-0 ${isWin ? 'text-red-600' : 'text-green-600'}`}>
          {isWin ? '+' : ''}{trade.net_return.toFixed(2)}%
        </div>
      </div>
      {trade.exit_reason && (
        <div className="px-3 pb-2 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="font-medium">平仓原因:</span> {trade.exit_reason}
        </div>
      )}
    </div>
  );
}

export function PaperTradingPage() {
  const togglePaperTradingPage = useAppStore((s) => s.togglePaperTradingPage);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [focusPool, setFocusPool] = useState<FocusPoolItem[]>([]);
  const [focusDate, setFocusDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'overview' | 'signals' | 'trades' | 'ops'>('positions');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes, rRes, pRes, fRes] = await Promise.all([
        fetch('/paper-trading/signals.json').then(r => r.json()).catch(() => []),
        fetch('/paper-trading/trades.json').then(r => r.json()).catch(() => []),
        fetch('/paper-trading/report.json').then(r => r.json()).catch(() => null),
        fetch('/paper-trading/portfolio.json').then(r => r.json()).catch(() => null),
        fetch('/paper-trading/rebuild_focus_pool.json').then(r => r.json()).catch(() => null),
      ]);
      setSignals(sRes);
      setTrades(tRes);
      setReport(rRes);
      setPortfolio(pRes);
      if (fRes && fRes.focus) {
        setFocusPool(fRes.focus);
        setFocusDate(fRes.date || '');
      }
    } catch (e) {
      console.warn('[PaperTrading] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const holdings = portfolio?.positions?.filter(p => p.status === 'holding') ?? [];
  const totalUnrealized = holdings.reduce((sum, p) => sum + p.unrealized_pnl, 0);
  const totalDailyPnl = holdings.reduce((sum, p) => sum + p.daily_pnl, 0);
  const totalMarketValue = portfolio?.total_market_value ?? report?.total_market_value ?? holdings.reduce((sum, p) => sum + p.market_value, 0);
  const totalAssets = portfolio?.total_assets ?? report?.total_assets ?? 0;
  const currentCash = portfolio?.current_cash ?? report?.current_cash ?? 0;
  const dailyPnl = portfolio?.daily_pnl ?? report?.daily_pnl ?? totalDailyPnl;
  const dailyPnlPct = portfolio?.daily_pnl_pct ?? report?.daily_pnl_pct ?? (totalAssets > 0 ? (dailyPnl / totalAssets) * 100 : 0);
  const totalReturnPct = portfolio?.total_return_pct ?? report?.total_return_pct ?? 0;
  const nav = portfolio?.nav ?? report?.nav ?? 1;

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 dark:text-gray-100">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => togglePaperTradingPage(false)}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all hover:scale-105"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <PiggyBank className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">模拟盘</h1>
            <p className="text-xs text-gray-400 hidden sm:block">Ridge+GBR 回归策略实盘跟踪</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-50 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-xl transition-all hover:shadow-md disabled:opacity-50 active:scale-95"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          刷新
        </button>
      </div>

      {/* Tab切换 */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
        {[
          { key: 'positions', label: '持仓', icon: Package },
          { key: 'overview', label: '概览', icon: Activity },
          { key: 'signals', label: '信号记录', icon: Calendar },
          { key: 'trades', label: '交易记录', icon: BarChart3 },
          { key: 'ops', label: '每日运维', icon: ClipboardList },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== 持仓 Tab ===== */}
      {activeTab === 'positions' && (
        <div className="space-y-4">
          {/* 顶部资金栏 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="总资产"
              value={totalAssets}
              unit="元"
              icon={Landmark}
              color="bg-emerald-500"
              subtext={`初始 ¥${(portfolio?.initial_capital ?? 10000).toFixed(0)}`}
            />
            <StatCard
              label="总市值"
              value={totalMarketValue}
              unit="元"
              icon={Package}
              color="bg-blue-500"
              subtext={`${holdings.length}只持仓`}
            />
            <StatCard
              label="当日盈亏"
              value={dailyPnl}
              unit="元"
              icon={dailyPnl >= 0 ? ArrowUpRight : ArrowDownRight}
              color={dailyPnl >= 0 ? 'bg-red-500' : 'bg-green-500'}
              subtext={`${dailyPnl >= 0 ? '+' : ''}${dailyPnlPct.toFixed(2)}%`}
            />
            <StatCard
              label="可用资金"
              value={currentCash}
              unit="元"
              icon={Wallet}
              color="bg-amber-500"
            />
          </div>

          {/* 当前实验信号 */}
          {focusPool.length > 0 && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">当前实验信号</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">{focusDate} 更新 · 实验性质，不构成投资建议</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {focusPool.map((f) => (
                  <div key={f.symbol} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-indigo-100 dark:border-indigo-800/30 rounded-lg px-3 py-1.5">
                    <span className={`text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold ${
                      f.rank === 1
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {f.rank}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{f.symbol}</span>
                    {f.sector && (
                      <span className="text-[9px] px-1 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded">
                        {f.sector}
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      f.signal === '买入'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {f.signal}
                    </span>
                    <span className="text-xs text-red-600 dark:text-red-400 font-bold">+{f.predicted_return_5d.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 持仓表格 - 券商风格 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">持仓明细</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-gray-400 dark:text-gray-500">
                  浮动盈亏 <span className={totalUnrealized >= 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}>
                    {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toFixed(2)}
                  </span>
                </span>
                <span className="text-gray-400 dark:text-gray-500">
                  当日盈亏 <span className={dailyPnl >= 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}>
                    {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>

            {holdings.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-200 dark:text-gray-700" />
                当前无持仓，等待实验信号买入触发
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* 表头 */}
                <div className="grid grid-cols-[minmax(100px,1fr)_60px_80px_80px_80px_80px_90px_80px] gap-0 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-500 text-center">
                  <div className="text-left">股票名称</div>
                  <div>数量</div>
                  <div>成本价</div>
                  <div>现价</div>
                  <div>市值</div>
                  <div>盈亏</div>
                  <div>盈亏比</div>
                  <div>当日盈亏</div>
                </div>
                {/* 表体 */}
                {holdings.map((pos) => {
                  const pnlPct = pos.cost_basis > 0 ? (pos.unrealized_pnl / pos.cost_basis) * 100 : 0;
                  return (
                    <div key={pos.symbol} className="grid grid-cols-[minmax(100px,1fr)_60px_80px_80px_80px_80px_90px_80px] gap-0 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 items-center text-center hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      {/* 股票名称 + 板块 + 止盈止损规则 */}
                      <div className="text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{pos.name}</span>
                          {pos.sector && (
                            <span className="text-[9px] px-1 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded">
                              {pos.sector}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono">{pos.symbol}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {pos.exit_rules && (
                            <>
                              <span className="text-[9px] px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded">
                                止盈 {pos.exit_rules.take_profit_pct >= 0 ? '+' : ''}{pos.exit_rules.take_profit_pct.toFixed(2)}%
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded">
                                止损 {pos.exit_rules.stop_loss_pct.toFixed(0)}%
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded">
                                跟踪 {pos.exit_rules.trailing_stop_pct.toFixed(0)}%
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
                                {pos.exit_rules.max_holding_days}天
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {/* 数量 */}
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{pos.shares}</div>
                      {/* 成本价 */}
                      <div className="text-xs text-gray-600 dark:text-gray-400">¥{pos.entry_price.toFixed(2)}</div>
                      {/* 现价 */}
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        ¥{pos.latest_price.toFixed(2)}
                        <span className={`text-[10px] ml-1 ${pos.daily_pnl_pct >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {pos.daily_pnl_pct >= 0 ? '+' : ''}{pos.daily_pnl_pct.toFixed(2)}%
                        </span>
                      </div>
                      {/* 市值 */}
                      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">¥{pos.market_value.toFixed(0)}</div>
                      {/* 盈亏 */}
                      <div className={`text-sm font-bold ${pos.unrealized_pnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {pos.unrealized_pnl >= 0 ? '+' : ''}{pos.unrealized_pnl.toFixed(2)}
                      </div>
                      {/* 盈亏比 */}
                      <div className={`text-xs font-bold ${pnlPct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                      </div>
                      {/* 当日盈亏 */}
                      <div className={`text-xs font-bold ${pos.daily_pnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {pos.daily_pnl >= 0 ? '+' : ''}{pos.daily_pnl.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
                {/* 汇总行 */}
                {holdings.length > 0 && (
                  <div className="grid grid-cols-[minmax(100px,1fr)_60px_80px_80px_80px_80px_90px_80px] gap-0 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 items-center text-center font-bold">
                    <div className="text-left text-sm text-gray-700 dark:text-gray-300">合计</div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">—</div>
                    <div className="text-xs text-gray-500">—</div>
                    <div className="text-xs text-gray-500">—</div>
                    <div className="text-sm text-gray-900 dark:text-gray-100">¥{totalMarketValue.toFixed(0)}</div>
                    <div className={`text-sm ${totalUnrealized >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toFixed(2)}
                    </div>
                    <div className={`text-xs ${totalUnrealized >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {totalMarketValue > 0 ? (totalUnrealized / (totalMarketValue - totalUnrealized) * 100 >= 0 ? '+' : '') + (totalMarketValue > totalUnrealized ? (totalUnrealized / (totalMarketValue - totalUnrealized) * 100).toFixed(2) : '0.00') : '0.00'}%
                    </div>
                    <div className={`text-xs ${dailyPnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 交易计划详情 */}
          {holdings.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">交易计划详情</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">每笔买入时自动制定，严格执行</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {holdings.map((pos) => (
                  <div key={pos.symbol} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{pos.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{pos.symbol}</span>
                    </div>
                    {pos.exit_rules ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-red-400" />
                            <span className="text-gray-500">目标止盈:</span>
                            <span className="font-bold text-red-600">+{pos.exit_rules.take_profit_pct.toFixed(2)}%</span>
                            <span className="text-gray-400">(收盘价≥¥{(pos.entry_price * (1 + pos.exit_rules.take_profit_pct / 100)).toFixed(2)}触发)</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            <span className="text-gray-500">硬止损:</span>
                            <span className="font-bold text-green-600">{pos.exit_rules.stop_loss_pct.toFixed(0)}%</span>
                            <span className="text-gray-400">(最低价≤¥{(pos.entry_price * (1 + pos.exit_rules.stop_loss_pct / 100)).toFixed(2)}触发)</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            <span className="text-gray-500">跟踪止盈:</span>
                            <span className="font-bold text-blue-600">回撤{Math.abs(pos.exit_rules.trailing_stop_pct).toFixed(0)}%</span>
                            <span className="text-gray-400">(从最高价回撤触发)</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-gray-400" />
                            <span className="text-gray-500">时间止损:</span>
                            <span className="font-bold text-gray-600">{pos.exit_rules.max_holding_days}天</span>
                            <span className="text-gray-400">(预计{pos.expected_exit_date}到期)</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5">
                          <span className="font-medium">规则逻辑:</span> {pos.exit_rules.reasoning}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400">暂无止盈止损规则记录</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 底部资金汇总 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">资金状况</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-4 py-4">
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">¥{totalAssets.toFixed(2)}</div>
                <div className="text-[10px] text-gray-400">总资产</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">¥{totalMarketValue.toFixed(2)}</div>
                <div className="text-[10px] text-gray-400">总市值</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">¥{currentCash.toFixed(2)}</div>
                <div className="text-[10px] text-gray-400">可用资金</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${totalReturnPct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                </div>
                <div className="text-[10px] text-gray-400">累计收益</div>
              </div>
            </div>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
              <span>净值: <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{nav.toFixed(4)}</span></span>
              <span>更新于 {portfolio?.updated_at ?? report?.generated_at ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* ===== 概览 Tab ===== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* 资金统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="初始资金"
              value={portfolio?.initial_capital ?? report?.initial_capital ?? 10000}
              unit="元"
              icon={Wallet}
              color="bg-gray-500"
            />
            <StatCard
              label="总资产"
              value={totalAssets}
              unit="元"
              icon={PiggyBank}
              color="bg-emerald-500"
            />
            <StatCard
              label="累计收益"
              value={totalReturnPct}
              unit="%"
              icon={TrendingUp}
              color={totalReturnPct >= 0 ? 'bg-red-500' : 'bg-green-500'}
            />
            <StatCard
              label="可用现金"
              value={currentCash}
              unit="元"
              icon={Activity}
              color="bg-amber-500"
            />
          </div>

          {/* 净值曲线 */}
          {report?.portfolio_history && report.portfolio_history.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">净值曲线</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">初始净值 1.0000</span>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-end gap-1 h-24">
                  {report.portfolio_history.map((h) => {
                    const height = Math.max(5, Math.min(100, (h.nav / 1.0) * 50));
                    const isPositive = h.daily_return_pct >= 0;
                    const sign = h.daily_return_pct >= 0 ? '+' : '';
                    const titleText = `${h.date} 净值${h.nav.toFixed(4)} 日收益${sign}${h.daily_return_pct.toFixed(2)}%`;
                    return (
                      <div key={h.date} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className={`w-full rounded-t ${isPositive ? 'bg-red-400' : 'bg-green-400'}`}
                          style={{ height: `${height}%` }}
                          title={titleText}
                        />
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">{h.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 按股票统计 */}
          {report?.by_symbol && Object.keys(report.by_symbol).length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">按股票统计</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {Object.entries(report.by_symbol).map(([sym, s]) => (
                  <div key={sym} className="px-4 py-3 flex items-center gap-4">
                    <div className="w-20 text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</div>
                    <div className="flex-1 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <div className="text-xs font-bold text-gray-700 dark:text-gray-300">{s.trades}次</div>
                        <div className="text-[10px] text-gray-400">交易</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700 dark:text-gray-300">{s.win_rate}%</div>
                        <div className="text-[10px] text-gray-400">胜率</div>
                      </div>
                      <div>
                        <div className={`text-xs font-bold ${s.avg_return >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {s.avg_return >= 0 ? '+' : ''}{s.avg_return.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-gray-400">均收益</div>
                      </div>
                      <div>
                        <div className={`text-xs font-bold ${s.total_return >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {s.total_return >= 0 ? '+' : ''}{s.total_return.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-gray-400">累计</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 信号记录 Tab ===== */}
      {activeTab === 'signals' && (
        <div className="space-y-2">
          {signals.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400 dark:text-gray-500">
              <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-200 dark:text-gray-700" />
              暂无信号记录
            </div>
          ) : (
            signals.slice().reverse().map((sig) => (
              <SignalRow key={sig.id} signal={sig} />
            ))
          )}
        </div>
      )}

      {/* ===== 交易记录 Tab ===== */}
      {activeTab === 'trades' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          {trades.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 text-gray-200 dark:text-gray-700" />
              暂无交易记录
            </div>
          ) : (
            <div>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
                <div className="w-4" />
                <div className="w-16">股票</div>
                <div className="w-20">日期</div>
                <div className="flex-1">价格</div>
                <div className="w-16 text-right">收益</div>
              </div>
              {trades.slice().reverse().map((trade) => (
                <TradeRow key={trade.id} trade={trade} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 每日运维 Tab ===== */}
      {activeTab === 'ops' && (
        <div className="space-y-4">
          {/* 每日必做 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <Play className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">每日必做（收盘后）</span>
            </div>
            <div className="px-4 py-3 space-y-3">
              {[
                { step: 1, title: '运行每日预测管道', cmd: 'bash scripts/daily_pipeline.sh', desc: '获取非价格特征 → 训练模型 → 生成预测 → 验证历史' },
                { step: 2, title: '更新模拟盘数据', cmd: 'python3 cloudfunctions/stock-predictor/paper_trading_rebuild.py full', desc: '从预测历史生成信号 → 结算到期持仓 → 生成报告 → 同步到前端' },
                { step: 3, title: '重新构建部署', cmd: 'npm run build && bash scripts/deploy.sh', desc: '前端重新打包，确保 public 目录数据被包含' },
                { step: 4, title: '刷新页面验证', cmd: '刷新浏览器', desc: '确认模拟盘页面显示最新信号和持仓' },
              ].map((item) => (
                <div key={item.step} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {item.step}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</div>
                    <div className="mt-1 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
                      <code className="text-xs font-mono text-gray-600 dark:text-gray-400">{item.cmd}</code>
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 策略参数 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <RotateCcw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">策略参数</span>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {[
                { label: '模型', value: 'Ridge(0.6) + GBR(0.4) 回归集成' },
                { label: '股票池', value: '10只A股市值股（茅台/工行/中石油/农行/中行/中国人寿/招行/神华/长电/平安）' },
                { label: '买入条件', value: '预测5日收益 > 0.5%' },
                { label: '持有周期', value: '5个交易日' },
                { label: '交易成本', value: '0.4% 来回' },
                { label: '硬止损', value: '3%' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0">{item.label}</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 异常处理 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">异常处理清单</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[
                { level: '低', text: '某天 akshare 连不上 → 跳过当天，第二天补跑' },
                { level: '中', text: '模型连续5天方向准确率 < 50% → 检查数据是否更新' },
                { level: '中', text: '某只股票连续3次亏损 → 检查特征是否有异常' },
                { level: '高', text: '3个月累计收益为负 → 暂停交易，评估策略有效性' },
                { level: '高', text: '单只股票回撤 > 50% → 立即停止该股票交易' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${
                    item.level === '低' ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                    item.level === '中' ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' :
                    'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    {item.level}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 底部说明 */}
      <div className="mt-8 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">模拟盘规则与免责声明</h3>
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>1. 每天收盘后运行 Ridge+GBR 回归模型，预测未来5日收益率。</p>
          <p>2. 预测5日收益 &gt; 0.5% → 买入信号，持有5个交易日后强制平仓。</p>
          <p>3. 预测5日收益 ≤ 0.5% → 观望，空仓等待。</p>
          <p>4. 交易成本按 0.4%/次计入（佣金+印花税+滑点）。</p>
          <p>5. 运行中若触发 3% 硬止损，当日收盘后强制平仓。</p>
          <p>6. 数据每天自动更新，本页面手动刷新查看最新结果。</p>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-[11px] text-amber-600 dark:text-amber-400">
          <p className="font-medium">⚠️ 重要提示：本模拟盘处于研究实验阶段，当前 walk-forward 验证显示模型方向准确率约 50%，尚未证明存在稳定 alpha。</p>
          <p>模拟盘仅供观察模型在真实市场环境中的表现，不构成任何投资建议。在模型积累至少 100 条验证记录并证明统计显著性之前，请勿用于真实资金交易。</p>
        </div>
      </div>
    </div>
  );
}
