import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Wallet, TrendingUp, TrendingDown, Clock, Calendar,
  BarChart3, Target, AlertCircle, CheckCircle2, XCircle, Loader2,
  RefreshCw, ChevronDown, ChevronUp, Activity, PiggyBank
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

interface Signal {
  id: string;
  symbol: string;
  name: string;
  date: string;
  price: number;
  pred: number;
  proba: number;
  threshold: number;
  signal: 'buy' | 'hold';
  top_features: Record<string, number>;
  expected_exit_date: string;
  status: 'pending' | 'settled';
  actual_return?: number;
  actual_exit_price?: number;
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
}

interface Report {
  generated_at: string;
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
  pending_signals: Array<{
    symbol: string;
    name: string;
    entry_date: string;
    entry_price: number;
    expected_exit: string;
  }>;
}

function StatCard({ label, value, unit, icon: Icon, color }: {
  label: string; value: string | number; unit: string;
  icon: typeof Wallet; color: string;
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
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const isBuy = signal.signal === 'buy';
  const isSettled = signal.status === 'settled';
  const [showFeatures, setShowFeatures] = useState(false);

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isBuy ? 'border-red-100 dark:border-red-800/30' : 'border-gray-100 dark:border-gray-800'
    }`}>
      <button
        onClick={() => setShowFeatures(!showFeatures)}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          isBuy ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
        }`} />
        <div className="w-20 shrink-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{signal.name}</div>
          <div className="text-[10px] text-gray-400 font-mono">{signal.symbol}</div>
        </div>
        <div className="w-24 shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">{signal.date}</div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300">¥{signal.price.toFixed(2)}</div>
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
              概率 {(signal.proba * 100).toFixed(1)}% / 阈值 {(signal.threshold * 100).toFixed(0)}%
            </span>
          </div>
          {isBuy && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              预计平仓 {signal.expected_exit_date}
            </div>
          )}
        </div>
        {isSettled && signal.actual_return !== undefined && (
          <div className={`text-sm font-bold shrink-0 ${
            signal.actual_return > 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {signal.actual_return > 0 ? '+' : ''}{signal.actual_return.toFixed(2)}%
          </div>
        )}
        {!isSettled && isBuy && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded shrink-0">
            持仓中
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
      </button>

      {showFeatures && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2.5 bg-gray-50/50 dark:bg-gray-800/30">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">模型Top5因子</div>
          <div className="space-y-1">
            {Object.entries(signal.top_features).map(([name, imp]) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 dark:text-gray-400 w-32 truncate">{name}</span>
                <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(imp / 0.08) * 100}%` }} />
                </div>
                <span className="text-[10px] text-gray-400 w-10 text-right">{(imp * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const isWin = trade.net_return > 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${isWin ? 'bg-red-500' : 'bg-green-500'}`} />
      <div className="w-16 shrink-0 text-xs font-medium text-gray-700 dark:text-gray-300">{trade.name}</div>
      <div className="w-20 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
        {trade.entry_date} → {trade.exit_date}
      </div>
      <div className="flex-1 text-[11px] text-gray-400 dark:text-gray-500">
        ¥{trade.entry_price.toFixed(2)} → ¥{trade.exit_price.toFixed(2)}
      </div>
      <div className={`text-sm font-bold shrink-0 ${isWin ? 'text-red-600' : 'text-green-600'}`}>
        {isWin ? '+' : ''}{trade.net_return.toFixed(2)}%
      </div>
    </div>
  );
}

export function PaperTradingPage() {
  const togglePaperTradingPage = useAppStore((s) => s.togglePaperTradingPage);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'signals' | 'trades'>('overview');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes, rRes] = await Promise.all([
        fetch('/paper-trading/signals.json').then(r => r.json()).catch(() => []),
        fetch('/paper-trading/trades.json').then(r => r.json()).catch(() => []),
        fetch('/paper-trading/report.json').then(r => r.json()).catch(() => null),
      ]);
      setSignals(sRes);
      setTrades(tRes);
      setReport(rRes);
    } catch (e) {
      console.warn('[PaperTrading] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingBuys = signals.filter(s => s.signal === 'buy' && s.status === 'pending');
  const settledSignals = signals.filter(s => s.status === 'settled');

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
            <p className="text-xs text-gray-400 hidden sm:block">5日预测策略实盘跟踪</p>
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

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="累计收益"
          value={report?.total_return ?? 0}
          unit="%"
          icon={Wallet}
          color="bg-emerald-500"
        />
        <StatCard
          label="胜率"
          value={report?.win_rate ?? 0}
          unit="%"
          icon={Target}
          color="bg-blue-500"
        />
        <StatCard
          label="交易次数"
          value={report?.total_trades ?? 0}
          unit="次"
          icon={BarChart3}
          color="bg-violet-500"
        />
        <StatCard
          label="当前持仓"
          value={pendingBuys.length}
          unit="笔"
          icon={Activity}
          color="bg-amber-500"
        />
      </div>

      {/* Tab切换 */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
        {[
          { key: 'overview', label: '概览', icon: Activity },
          { key: 'signals', label: '信号记录', icon: Calendar },
          { key: 'trades', label: '交易记录', icon: BarChart3 },
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

      {/* 概览 */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* 当前持仓 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">当前持仓</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{pendingBuys.length}笔</span>
            </div>
            {pendingBuys.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-200 dark:text-gray-700" />
                当前无持仓，等待买入信号
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {pendingBuys.map((sig) => (
                  <div key={sig.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{sig.name}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">
                        买入 {sig.date} @ ¥{sig.price.toFixed(2)} · 预计 {sig.expected_exit_date} 平仓
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded">
                      持仓中
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 按股票统计 */}
          {report && Object.keys(report.by_symbol).length > 0 && (
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

      {/* 信号记录 */}
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

      {/* 交易记录 */}
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

      {/* 底部说明 */}
      <div className="mt-8 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">模拟盘规则</h3>
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>1. 每天收盘后运行模型，预测未来5日涨跌概率。</p>
          <p>2. 概率 &gt; 阈值 → 买入信号，持有5个交易日后强制平仓。</p>
          <p>3. 概率 ≤ 阈值 → 观望，空仓等待。</p>
          <p>4. 交易成本按0.17%/次计入（佣金+印花税+滑点）。</p>
          <p>5. 数据每天自动更新，本页面手动刷新查看最新结果。</p>
        </div>
      </div>
    </div>
  );
}
