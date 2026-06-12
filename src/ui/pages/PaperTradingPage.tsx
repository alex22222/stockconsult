import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Wallet, Calendar,
  BarChart3, Target, Loader2,
  RefreshCw, Activity, PiggyBank, TrendingUp,
  ClipboardList, Landmark,
  Package, Cloud, Server
} from 'lucide-react';
import { useAppStore } from '../store/app-store';
import { cosDataUrl } from '../../core/data/cos-data-client';

// SCF API 配置
const SCF_API_URL = 'https://stockconsult-d9g7b6ae5b8170e00.service.tcloudbase.com/stock-predictor';

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
  signal_strength: number;
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

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  status: string;
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
  _liveUpdated?: boolean;
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

interface WalkforwardStock {
  symbol: string;
  name: string;
  n_predictions: number;
  direction_accuracy: number;
  correlation: number;
  strategy_return_pct: number;
  buyhold_return_pct: number;
  reverse_better: boolean;
}

interface WalkforwardReport {
  generated_at: string;
  method: string;
  params: Record<string, unknown>;
  stocks: Record<string, WalkforwardStock>;
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

function DataFreshnessBadge({ updatedAt }: { updatedAt: string | undefined }) {
  if (!updatedAt) return null;
  const updated = new Date(updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - updated.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const isToday = updated.toDateString() === now.toDateString();

  if (isToday && diffHours < 2) {
    return (
      <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-medium">
        数据新鲜 · {updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </span>
    );
  }
  if (isToday && diffHours < 24) {
    return (
      <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full font-medium">
        数据 {Math.round(diffHours)}小时前 · {updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 bg-red-50 text-red-600 rounded-full font-medium">
      ⚠ 数据非当天 · {updated.toLocaleDateString('zh-CN')} {updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
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
  const isPending = signal.status === 'pending';
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded ${isBuy ? 'bg-rose-50 text-rose-600' : 'bg-gray-100 text-gray-500'}`}>
          {isBuy ? '买入' : '持有'}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{signal.name}</span>
        <span className="text-xs text-gray-400">{signal.symbol}</span>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold ${signal.predicted_return_5d > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
          {signal.predicted_return_5d > 0 ? '+' : ''}{signal.predicted_return_5d.toFixed(2)}%
        </div>
        <div className="text-[10px] text-gray-400">
          {isPending ? `预计 ${signal.expected_exit_date}` : `实际 ${signal.actual_return?.toFixed(2)}%`}
        </div>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isWin = trade.net_return > 0;
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded ${isWin ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          {isWin ? '盈利' : '亏损'}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{trade.name}</span>
        <span className="text-xs text-gray-400">{trade.symbol}</span>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
          {isWin ? '+' : ''}{trade.net_return.toFixed(2)}%
        </div>
        <div className="text-[10px] text-gray-400">
          {trade.holding_days}天 · {trade.entry_date} → {trade.exit_date}
        </div>
      </div>
    </div>
  );
}

function PositionRow({ position }: { position: Position }) {
  const isHolding = position.status === 'holding';
  const pnlColor = position.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-rose-500';
  const dailyColor = position.daily_pnl >= 0 ? 'text-emerald-500' : 'text-rose-500';
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded ${isHolding ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
          {isHolding ? '持仓' : '已平仓'}
        </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{position.name}</span>
        <span className="text-xs text-gray-400">{position.symbol}</span>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold ${pnlColor}`}>
          {position.unrealized_pnl >= 0 ? '+' : ''}{position.unrealized_pnl.toFixed(0)}元
        </div>
        <div className={`text-[10px] ${dailyColor}`}>
          今日 {position.daily_pnl >= 0 ? '+' : ''}{position.daily_pnl.toFixed(0)}元 ({position.daily_pnl_pct >= 0 ? '+' : ''}{position.daily_pnl_pct.toFixed(2)}%)
        </div>
      </div>
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
  const [walkforwardReport, setWalkforwardReport] = useState<WalkforwardReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'overview' | 'signals' | 'trades' | 'ops'>('positions');
  const [dataSource, setDataSource] = useState<'local' | 'scf'>('local');
  const [, setScfLoading] = useState(false);

  // 用实时行情更新 portfolio 中的持仓价格
  const updatePortfolioWithLiveQuotes = useCallback(async (pf: Portfolio | null) => {
    if (!pf || !pf.positions || pf.positions.length === 0) return pf;
    const holdingSymbols = pf.positions
      .filter(p => p.status === 'holding')
      .map(p => p.symbol)
      .join(',');
    if (!holdingSymbols) return pf;

    const API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';
    if (!API_URL) return pf;

    try {
      const res = await fetch(`${API_URL}/stock-quotes?symbols=${holdingSymbols}`);
      const data = await res.json();
      if (!data.success || !data.quotes) return pf;

      const quoteMap = new Map((data.quotes as StockQuote[]).map(q => [q.symbol, q]));
      const updatedPositions = pf.positions.map(p => {
        if (p.status !== 'holding') return p;
        const q = quoteMap.get(p.symbol);
        if (!q || q.price <= 0) return p;
        const latestPrice = q.price;
        const prevClose = q.prevClose || p.prev_close;
        const marketValue = p.shares * latestPrice;
        const unrealizedPnl = marketValue - p.cost_basis;
        const dailyPnl = p.shares * (latestPrice - prevClose);
        const dailyPnlPct = prevClose > 0 ? (latestPrice - prevClose) / prevClose * 100 : 0;
        return {
          ...p,
          latest_price: latestPrice,
          prev_close: prevClose,
          market_value: marketValue,
          unrealized_pnl: unrealizedPnl,
          daily_pnl: dailyPnl,
          daily_pnl_pct: dailyPnlPct,
        };
      });

      const totalMarketValue = updatedPositions
        .filter(p => p.status === 'holding')
        .reduce((sum, p) => sum + p.market_value, 0);
      const totalDailyPnl = updatedPositions
        .filter(p => p.status === 'holding')
        .reduce((sum, p) => sum + p.daily_pnl, 0);
      const totalAssets = pf.current_cash + totalMarketValue;
      const totalReturnPct = (totalAssets - pf.initial_capital) / pf.initial_capital * 100;
      const nav = totalAssets / pf.initial_capital;

      return {
        ...pf,
        positions: updatedPositions,
        total_market_value: totalMarketValue,
        total_assets: totalAssets,
        daily_pnl: totalDailyPnl,
        daily_pnl_pct: pf.initial_capital > 0 ? totalDailyPnl / pf.initial_capital * 100 : 0,
        total_return_pct: totalReturnPct,
        nav,
        _liveUpdated: true,
      };
    } catch (e) {
      console.warn('[PaperTrading] live quotes failed:', e);
      return pf;
    }
  }, []);

  // 从 SCF 云函数获取 focus_pool
  const fetchSCFFocusPool = useCallback(async () => {
    try {
      setScfLoading(true);
      const res = await fetch(`${SCF_API_URL}/predict-all?t=${Date.now()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`SCF API error: ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.report && data.report.focus_pool) {
        const scfFocusPool = data.report.focus_pool.map((item: any, index: number) => ({
          rank: index + 1,
          symbol: item.symbol,
          name: item.name,
          predicted_return_5d: item.predicted_return_5d,
          signal: item.signal,
          signal_strength: item.signal_strength || item.confidence || 0.7,
          reason: item.reason || `${item.name}(${item.symbol}) ${item.signal}信号 预期${item.predicted_return_5d > 0 ? '+' : ''}${item.predicted_return_5d.toFixed(2)}%`,
        }));
        setFocusPool(scfFocusPool);
        setFocusDate(data.report.date || new Date().toISOString().split('T')[0]);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[PaperTrading] SCF fetch failed:', e);
      return false;
    } finally {
      setScfLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 防缓存：每次请求加时间戳
      const ts = Date.now();
      const [sRes, tRes, rRes, pRes, fRes, wRes] = await Promise.all([
        fetch(cosDataUrl('paper-trading/signals.json', ts)).then(r => r.json()).catch(() => []),
        fetch(cosDataUrl('paper-trading/trades.json', ts)).then(r => r.json()).catch(() => []),
        fetch(cosDataUrl('paper-trading/report.json', ts)).then(r => r.json()).catch(() => null),
        fetch(cosDataUrl('paper-trading/portfolio.json', ts)).then(r => r.json()).catch(() => null),
        fetch(cosDataUrl('paper-trading/rebuild_focus_pool.json', ts)).then(r => r.json()).catch(() => null),
        fetch(cosDataUrl('paper-trading/rebuild_walkforward_report.json', ts)).then(r => r.json()).catch(() => null),
      ]);
      setSignals(sRes);
      setTrades(tRes);
      setReport(rRes);
      const updatedPf = await updatePortfolioWithLiveQuotes(pRes);
      setPortfolio(updatedPf);
      setWalkforwardReport(wRes);
      if (fRes && fRes.focus) {
        setFocusPool(fRes.focus);
        setFocusDate(fRes.date || '');
      }

      // 如果数据源是 SCF，尝试从 SCF 获取 focus_pool
      if (dataSource === 'scf') {
        await fetchSCFFocusPool();
      }
    } catch (e) {
      console.warn('[PaperTrading] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [updatePortfolioWithLiveQuotes, dataSource, fetchSCFFocusPool]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 定时刷新：每60秒自动刷新一次数据（交易时段）
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const holdings = portfolio?.positions?.filter(p => p.status === 'holding') ?? [];
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
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-400 hidden sm:block">Ridge+GBR 回归策略实验跟踪</p>
              <DataFreshnessBadge updatedAt={portfolio?.updated_at ?? report?.generated_at} />
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* 数据源切换 */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            <button
              onClick={() => setDataSource('local')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
                dataSource === 'local'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Server className="w-3 h-3" />
              本地
            </button>
            <button
              onClick={() => setDataSource('scf')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
                dataSource === 'scf'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Cloud className="w-3 h-3" />
              SCF
            </button>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-50 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-xl transition-all hover:shadow-md disabled:opacity-50 active:scale-95"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            刷新
          </button>
        </div>
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
              subtext={`现金 ¥${currentCash.toFixed(0)}`}
            />
            <StatCard
              label="今日盈亏"
              value={dailyPnl}
              unit="元"
              icon={TrendingUp}
              color={dailyPnl >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}
              subtext={`${dailyPnl >= 0 ? '+' : ''}${dailyPnlPct.toFixed(2)}%`}
            />
            <StatCard
              label="累计收益"
              value={totalReturnPct}
              unit="%"
              icon={Target}
              color={totalReturnPct >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}
              subtext={`NAV ${nav.toFixed(4)}`}
            />
          </div>

          {/* 持仓列表 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">当前持仓</h3>
              <span className="text-xs text-gray-400">{holdings.length} 只</span>
            </div>
            {holdings.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">暂无持仓</div>
            ) : (
              <div className="space-y-1">
                {holdings.map(p => (
                  <PositionRow key={p.symbol} position={p} />
                ))}
              </div>
            )}
          </div>

          {/* Focus Pool */}
          {focusPool.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  今日实验信号池
                  {dataSource === 'scf' && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                      SCF云函数
                    </span>
                  )}
                </h3>
                <span className="text-xs text-gray-400">{focusDate}</span>
              </div>
              <div className="space-y-2">
                {focusPool.map((f) => (
                  <div key={f.symbol} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-400 w-4">{f.rank}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${f.signal === 'buy' ? 'bg-rose-50 text-rose-600' : 'bg-gray-100 text-gray-500'}`}>
                        {f.signal === 'buy' ? '买入' : '持有'}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.name}</span>
                      <span className="text-xs text-gray-400">{f.symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${f.predicted_return_5d > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {f.predicted_return_5d > 0 ? '+' : ''}{f.predicted_return_5d.toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-gray-400">预测强度 {(f.signal_strength * 100).toFixed(0)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 概览 Tab ===== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">策略表现</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-2xl font-bold text-emerald-500">{totalReturnPct.toFixed(2)}%</div>
                <div className="text-xs text-gray-400 mt-1">累计收益率</div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-2xl font-bold text-blue-500">{nav.toFixed(4)}</div>
                <div className="text-xs text-gray-400 mt-1">单位净值</div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{trades.length}</div>
                <div className="text-xs text-gray-400 mt-1">总交易次数</div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {trades.length > 0 ? (trades.filter(t => t.net_return > 0).length / trades.length * 100).toFixed(1) : 0}%
                </div>
                <div className="text-xs text-gray-400 mt-1">胜率</div>
              </div>
            </div>
          </div>

          {walkforwardReport && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Walkforward 分析</h3>
              <div className="space-y-2">
                {Object.entries(walkforwardReport.stocks).map(([symbol, stock]) => (
                  <div key={symbol} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{stock.name}</span>
                      <span className="text-xs text-gray-400">{symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        方向准确率 {stock.direction_accuracy.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-gray-400">
                        策略收益 {stock.strategy_return_pct.toFixed(2)}% · 买入持有 {stock.buyhold_return_pct.toFixed(2)}%
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
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">信号记录</h3>
            <span className="text-xs text-gray-400">{signals.length} 条</span>
          </div>
          {signals.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">暂无信号</div>
          ) : (
            <div className="space-y-1">
              {signals.map(s => (
                <SignalRow key={s.id} signal={s} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 交易记录 Tab ===== */}
      {activeTab === 'trades' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">交易记录</h3>
            <span className="text-xs text-gray-400">{trades.length} 笔</span>
          </div>
          {trades.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">暂无交易</div>
          ) : (
            <div className="space-y-1">
              {trades.map(t => (
                <TradeRow key={t.id} trade={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 每日运维 Tab ===== */}
      {activeTab === 'ops' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">每日运维</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-400">数据更新</span>
                <span className="text-xs text-gray-400">每日 16:07 自动执行</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-400">SCF 定时预测</span>
                <span className="text-xs text-gray-400">每日 15:30 自动执行</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-400">前端部署</span>
                <span className="text-xs text-gray-400">数据更新后自动部署</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">数据源状态</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">本地实验模型 (Ridge+GBR)</span>
                </div>
                <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">运行中</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">SCF 轻量规则评分器 (技术指标)</span>
                </div>
                <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">运行中</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
