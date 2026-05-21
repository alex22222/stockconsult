import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Wallet, Clock, Calendar,
  BarChart3, Target, AlertCircle, Loader2,
  RefreshCw, ChevronDown, Activity, PiggyBank,
  ClipboardList, Play, RotateCcw, BookOpen, Terminal, GitCommit
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
  const [activeTab, setActiveTab] = useState<'overview' | 'signals' | 'trades' | 'ops'>('overview');

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

      {/* 每日运维 */}
      {activeTab === 'ops' && (
        <div className="space-y-4">
          {/* 每日必做 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <Play className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">每日必做（收盘后 17:30）</span>
            </div>
            <div className="px-4 py-3 space-y-3">
              {[
                { step: 1, title: '进入项目目录', cmd: 'cd /Users/henry/projects/stockconsult/cloudfunctions/stock-predictor', desc: '确保在正确的Python环境中' },
                { step: 2, title: '运行模拟盘脚本', cmd: 'python3 paper_trading_5day.py full', desc: '自动生成信号 + 结算持仓 + 生成周报' },
                { step: 3, title: '同步数据到前端', cmd: 'cp paper_trading/*.json ../../public/paper-trading/', desc: '把最新数据复制到前端可访问目录' },
                { step: 4, title: 'Git提交记录', cmd: 'git add -A && git commit -m "paper: 2026-05-19 模拟盘记录"', desc: '每日一提交，形成完整历史链' },
                { step: 5, title: '刷新页面查看', cmd: '刷新浏览器或重新部署', desc: '查看最新信号和持仓状态' },
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

          {/* 每周必做 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <RotateCcw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">每周必做（周日晚上）</span>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {[
                { title: '重新跑优化脚本', cmd: 'python3 optimize_5day_strategy.py', desc: 'Walk-forward验证，检查阈值和特征是否需要调整' },
                { title: '对比回测 vs 模拟盘', cmd: '对比报告中的实际收益与回测预期', desc: '如果偏差>20%，说明模型可能失效' },
                { title: '更新策略配置', cmd: '修改 paper_trading_5day.py 中的 STOCK_CONFIG', desc: '根据最新优化结果调整阈值和Top-K' },
                { title: '生成周报分析', cmd: 'python3 paper_trading_5day.py report', desc: '胜率/收益/回撤，评估策略健康度' },
              ].map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    W{i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</div>
                    <div className="mt-0.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg px-3 py-1.5">
                      <code className="text-xs font-mono text-blue-700 dark:text-blue-300">{item.cmd}</code>
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 每月必做 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">每月必做（月底）</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[
                '更新历史数据：运行 fetch_stock_data.py 获取最新日线',
                '全量模型重训练：用所有历史数据重新训练GBDT模型',
                '评估策略有效性：如果3个月累计收益为负，考虑暂停',
                '检查股票池：是否有新股需要加入，或旧股需要移除',
                '备份数据：git tag 标记月度里程碑',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 数据来源 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
                <Terminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">数据来源</span>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { source: '个股日线', lib: 'akshare / baostock', path: 'data/{code}_daily.csv' },
                  { source: '上证指数', lib: 'akshare', path: 'data/sh_index_000001.csv' },
                  { source: '隔夜美股', lib: 'yfinance', path: 'data/us_overnight.csv' },
                  { source: '北向资金', lib: 'akshare', path: 'data/northbound_money.csv' },
                  { source: '国债收益率', lib: 'akshare', path: 'data/bond_yield.csv' },
                  { source: '估值数据', lib: 'akshare', path: 'data/{code}_value.csv' },
                ].map((item) => (
                  <div key={item.source} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <span className="text-gray-500 dark:text-gray-400 w-16 shrink-0">{item.source}</span>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <code className="text-gray-600 dark:text-gray-400 font-mono text-[10px]">{item.path}</code>
                  </div>
                ))}
              </div>
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
                { level: '低', text: '某天akshare连不上 → 跳过当天，第二天补跑' },
                { level: '中', text: '模型连续5天给出相同信号 → 检查数据是否更新' },
                { level: '中', text: '某只股票连续3次亏损 → 暂停该股票，重新优化参数' },
                { level: '高', text: '3个月累计收益为负 → 暂停所有交易，重新评估策略' },
                { level: '高', text: '单只股票回撤>50% → 立即停止该股票交易' },
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

          {/* Git提交规范 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <GitCommit className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
              </div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Git提交规范</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <code className="text-xs font-mono text-gray-600 dark:text-gray-400 block">
                  paper: 2026-05-19 模拟盘记录
                  <br />- 601318: HOLD 概率24.2%
                  <br />- 300622: HOLD 概率16.9%
                  <br />- 002896: HOLD 概率9.5%
                </code>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                每日提交格式：<code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">paper: YYYY-MM-DD 模拟盘记录</code><br/>
                包含当天所有股票的信号和任何持仓变化。
              </p>
            </div>
          </div>
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
