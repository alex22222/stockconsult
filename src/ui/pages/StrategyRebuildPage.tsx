import { useState, useEffect } from 'react';
import {
  FlaskConical, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  Clock, BarChart3, BrainCircuit, Activity, FileText, ShieldAlert,
  Zap, XCircle, ChevronRight, Sparkles, HelpCircle, Target, Sword,
  LayoutDashboard, PiggyBank, ArrowRight
} from 'lucide-react';
import { useAppStore } from '../store/app-store';
import { fetchFirstCosJson } from '../../core/data/cos-data-client';

function getShanghaiDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function signalStrength(item: { confidence?: number; signal_strength?: number }) {
  return item.confidence ?? item.signal_strength ?? 0;
}


/* =================== 类型定义 =================== */
interface PredictionRecord {
  date: string;
  symbol: string;
  name: string;
  predicted_return_5d: number;
  anomaly_direction: string;
  confidence: number;
  signal_strength?: number;
  nonprice_features: {
    score?: number;
    emotionScore?: number;
    financeScore?: number;
    industryScore?: number;
    news_count?: number;
    news_sentiment_mean?: number;
  };
  model_metrics?: {
    r2: number;
    mae: number;
    direction_acc: number;
  };
  verify_date: string;
  verified: boolean;
  actual_return?: number | null;
  direction_correct?: boolean;
}

interface FocusPoolItem {
  rank: number;
  symbol: string;
  name: string;
  predicted_return_5d: number;
  signal: string;
  confidence: number;
  signal_strength?: number;
  reason: string;
  sector?: string;
}

interface FocusPool {
  date: string;
  pool_size: number;
  focus: FocusPoolItem[];
}

interface DailySummary {
  date: string;
  predictions: PredictionRecord[];
}

interface BacktestResult {
  name: string;
  total_return: number;
  buyhold_return: number;
  excess_return: number;
  sharpe: number;
  max_dd: number;
  trades: number;
  win_rate: number;
}

interface EvalReport {
  generated_at: string;
  total_verified: number;
  summary: {
    avg_direction_accuracy: number;
    avg_score: number;
    overall_verdict: string;
  };
  per_symbol: Record<string, {
    error?: string;
    sample_size?: number;
    direction_accuracy?: number;
    binom_pvalue?: number;
    mae?: number;
    correlation?: number;
    overall_score?: number;
    verdict?: string;
    economic?: {
      net_return: number;
      sharpe_approx: number;
    };
  }>;
}

interface WalkforwardStock {
  name: string;
  n_predictions: number;
  direction_accuracy: number;
  mae: number;
  correlation: number;
  strategy_return_pct: number;
  buyhold_return_pct: number;
  reverse_return_pct: number;
  reverse_better: boolean;
}

/* =================== 信号配置 =================== */
const SIGNAL_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; icon: typeof CheckCircle2 }> = {
  '强烈买入': { label: '强烈买入', bg: 'bg-red-500', text: 'text-white', border: 'border-red-500', icon: Zap },
  '买入': { label: '买入', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', icon: TrendingUp },
  '观望': { label: '观望', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', icon: Clock },
  '回避': { label: '回避', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', icon: XCircle },
};

function getSignal(pred: number): string {
  if (pred > 1.5) return '强烈买入';
  if (pred > 0.5) return '买入';
  if (pred < -0.5) return '回避';
  return '观望';
}

function SignalBadge({ signal }: { signal: string }) {
  const config = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG['观望'];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${config.bg} ${config.text} ${config.border}`}>
      <Icon className="w-4 h-4" />
      {config.label}
    </span>
  );
}

function MetricCard({ label, value, unit, positiveIsGood }: { label: string; value: number; unit: string; positiveIsGood?: boolean }) {
  const isPositive = value >= 0;
  const colorClass = positiveIsGood === undefined
    ? 'text-gray-700 dark:text-gray-300'
    : (isPositive === positiveIsGood ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400');
  return (
    <div className="flex flex-col items-center px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`text-sm font-bold ${colorClass}`}>
        {value > 0 && isPositive ? '+' : ''}{value.toFixed(unit === '%' ? 2 : 2)}{unit}
      </span>
    </div>
  );
}

/* =================== 主页面 =================== */
export function StrategyRebuildPage() {
  const [activeTab, setActiveTab] = useState<'signals' | 'lab'>('signals');
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);
  const [focusPool, setFocusPool] = useState<FocusPool | null>(null);
  const [backtest, setBacktest] = useState<Record<string, BacktestResult>>({});
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [wfReport, setWfReport] = useState<Record<string, WalkforwardStock>>({});
  const [paperTradingReport, setPaperTradingReport] = useState<{ nav: number; total_return_pct: number; total_trades: number; holding_positions: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [dataFreshness, setDataFreshness] = useState<{ status: 'fresh' | 'stale' | 'unknown'; latestDate: string; lagDays: number }>({ status: 'unknown', latestDate: '', lagDays: 0 });
  const navigateTo = useAppStore((s) => s.navigateTo);

  useEffect(() => {
    async function loadData() {
      try {
        const today = getShanghaiDateString();
        const [hist, summary, focus, bt, evalReportData, wf, pt] = await Promise.all([
          fetchFirstCosJson<PredictionRecord[]>([
            'rebuild/prediction_history.json',
            'paper-trading/rebuild_prediction_history.json',
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<DailySummary & { focus_pool?: FocusPoolItem[] }>([
            `rebuild/daily_summary_${today}.json`,
            `paper-trading/rebuild_daily_summary_${today}.json`,
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<FocusPool>([
            'rebuild/focus_pool.json',
            'paper-trading/rebuild_focus_pool.json',
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<{ stocks?: Record<string, BacktestResult> }>([
            'rebuild/backtest.json',
            'paper-trading/rebuild_backtest.json',
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<EvalReport>([
            'rebuild/evaluation_report.json',
            'paper-trading/rebuild_evaluation_report.json',
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<{ stocks?: Record<string, WalkforwardStock> }>([
            'rebuild/walkforward_report.json',
            'paper-trading/rebuild_walkforward_report.json',
          ], { logPrefix: 'StrategyRebuild' }),
          fetchFirstCosJson<{ nav?: number; total_return_pct?: number; total_trades?: number; holding_positions?: unknown[] }>([
            'paper-trading/report.json',
          ], { logPrefix: 'StrategyRebuild' }),
        ]);

        if (hist) {
          const arr = Array.isArray(hist) ? hist : [];
          setHistory(arr.reverse());
          // 闭环：计算数据新鲜度
          if (arr.length > 0) {
            const latestDate = arr[arr.length - 1]?.date || '';
            const today = getShanghaiDateString();
            const lag = latestDate ? Math.max(0, Math.floor((new Date(today).getTime() - new Date(latestDate).getTime()) / (86400000))) : 0;
            const status = latestDate === today ? 'fresh' : (lag > 0 ? 'stale' : 'unknown');
            setDataFreshness({ status, latestDate, lagDays: lag });
          }
        }
        if (summary) {
          setTodaySummary(summary);
          if (!focus && summary.focus_pool && summary.focus_pool.length > 0) {
            setFocusPool({
              date: summary.date,
              pool_size: summary.focus_pool.length,
              focus: summary.focus_pool,
            });
          }
        }
        if (focus) {
          setFocusPool(focus);
        }
        if (bt) {
          setBacktest(bt.stocks || {});
        }
        if (evalReportData) {
          setEvalReport(evalReportData);
        }
        if (wf) {
          setWfReport(wf.stocks || {});
        }
        if (pt) {
          setPaperTradingReport({
            nav: pt.nav ?? 1,
            total_return_pct: pt.total_return_pct ?? 0,
            total_trades: pt.total_trades ?? 0,
            holding_positions: (pt.holding_positions || []).length,
          });
        }
      } catch (e) {
        console.warn('[StrategyRebuild] load failed:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  /* ---------- 派生数据 ---------- */
  const todayPreds = todaySummary?.predictions || [];
  const sortedPreds = [...todayPreds].sort((a, b) => {
    const sa = getSignal(a.predicted_return_5d || 0);
    const sb = getSignal(b.predicted_return_5d || 0);
    const order = ['强烈买入', '买入', '观望', '回避'];
    return order.indexOf(sa) - order.indexOf(sb);
  });
  const signalCounts = {
    buy: sortedPreds.filter(p => getSignal(p.predicted_return_5d || 0) === '强烈买入' || getSignal(p.predicted_return_5d || 0) === '买入').length,
    hold: sortedPreds.filter(p => getSignal(p.predicted_return_5d || 0) === '观望').length,
    avoid: sortedPreds.filter(p => getSignal(p.predicted_return_5d || 0) === '回避').length,
  };
  const avgWfAccuracy = Object.values(wfReport).length > 0
    ? Object.values(wfReport).reduce((a, s) => a + s.direction_accuracy, 0) / Object.values(wfReport).length
    : 0;

  const verifiedRecords = history.filter((r) => r.verified);
  const directionAccuracy = verifiedRecords.length > 0
    ? verifiedRecords.filter((r) => r.direction_correct).length / verifiedRecords.length
    : 0;
  const avgError = verifiedRecords.length > 0
    ? verifiedRecords.reduce((s, r) => s + Math.abs((r.predicted_return_5d || 0) - (r.actual_return || 0)), 0) / verifiedRecords.length
    : 0;

  if (loading) {
    return (
      <div className="flex-1 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Activity className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* ---------- 标题 + Tab ---------- */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-7 h-7 text-indigo-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">策略重建实验室</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                回归目标 + 非价格特征 | 从今天开始积累数据
              </p>
            </div>
            {/* 闭环：数据新鲜度指示器 */}
            {dataFreshness.status !== 'unknown' && (
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                dataFreshness.status === 'fresh'
                  ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400'
                  : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  dataFreshness.status === 'fresh' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                }`} />
                {dataFreshness.status === 'fresh'
                  ? `数据最新 ${dataFreshness.latestDate}`
                  : `数据滞后 ${dataFreshness.lagDays} 天`
                }
              </div>
            )}
          </div>
          <div className="flex bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1">
            <button
              onClick={() => setActiveTab('signals')}
              className={`text-xs px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                activeTab === 'signals'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              <Sword className="w-3.5 h-3.5" />
              今日信号
            </button>
            <button
              onClick={() => setActiveTab('lab')}
              className={`text-xs px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                activeTab === 'lab'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              验证实验室
            </button>
          </div>
        </div>

        {/* ==================== 今日信号 Tab ==================== */}
        {activeTab === 'signals' && (
          <div className="space-y-6">
            {/* 概览统计 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '跟踪股票', value: sortedPreds.length, unit: '只', icon: Target },
                { label: '买入信号', value: signalCounts.buy, unit: '个', icon: TrendingUp, color: 'text-red-600' },
                { label: '平均方向准确率', value: (avgWfAccuracy * 100).toFixed(1), unit: '%', icon: Activity },
                { label: '持仓周期', value: '5', unit: '天', icon: Clock },
              ].map((item) => (
                <div key={item.label} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center">
                    <item.icon className={`w-4 h-4 ${item.color || 'text-gray-500 dark:text-gray-400'}`} />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{item.value}{item.unit}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">{item.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* 今日实验信号 */}
            {focusPool && focusPool.focus.length > 0 && (
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-2xl border border-indigo-200 dark:border-indigo-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-indigo-100 dark:border-indigo-800/50 flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">今日实验信号（同步到模拟盘）</h2>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                    每日从买入信号中优选 Top 2，持仓中去重 · 实验性质，不构成投资建议
                  </span>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {focusPool.focus.map((f) => (
                      <div key={f.symbol} className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-indigo-800/30 p-4 flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          f.rank === 1
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {f.rank}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{f.name}</span>
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
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            预测收益 <span className="font-bold text-red-600 dark:text-red-400">+{f.predicted_return_5d.toFixed(2)}%</span>
                            {' · '}
                            信号强度 {signalStrength(f).toFixed(2)}
                          </div>
                          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate">{f.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 今日信号总览 */}
            {sortedPreds.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">今日信号总览</h2>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {sortedPreds.map((p) => {
                      const signal = getSignal(p.predicted_return_5d || 0);
                      const isUp = signal === '买入' || signal === '强烈买入';
                      const isDown = signal === '回避';
                      return (
                        <div key={p.symbol} className={`rounded-xl p-3 border ${
                          isUp ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800' :
                          isDown ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800' :
                          'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
                        }`}>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{p.name}</div>
                          <div className={`text-lg font-bold ${
                            isUp ? 'text-red-600 dark:text-red-400' :
                            isDown ? 'text-green-600 dark:text-green-400' :
                            'text-gray-600 dark:text-gray-400'
                          }`}>
                            {isUp ? '涨' : isDown ? '跌' : '平'}
                          </div>
                          <div className="text-xs font-medium mt-1">
                            <span className={isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-500'}>
                              {(p.predicted_return_5d || 0) > 0 ? '+' : ''}{(p.predicted_return_5d || 0).toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 股票策略列表 */}
            {sortedPreds.length === 0 ? (
              <div className="text-center py-20">
                <ShieldAlert className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">暂无策略数据</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">请先运行每日预测流水线</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedPreds.map((p) => {
                  const wf = wfReport[p.symbol];
                  const ev = evalReport?.per_symbol?.[p.symbol];
                  const signal = getSignal(p.predicted_return_5d || 0);
                  return (
                    <div key={p.symbol} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden hover:shadow-lg transition-all hover:-translate-y-0.5">
                      <button
                        onClick={() => setExpandedCode(expandedCode === p.symbol ? null : p.symbol)}
                        className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
                      >
                        <div className="w-24 shrink-0">
                          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.name}</div>
                          <div className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">{p.symbol}</div>
                        </div>
                        <div className="shrink-0">
                          <SignalBadge signal={signal} />
                        </div>
                        <div className="flex-1 min-w-0 px-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">5日预测收益</span>
                            <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{(p.predicted_return_5d || 0).toFixed(2)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                (p.predicted_return_5d || 0) > 0.5 ? 'bg-red-500' :
                                (p.predicted_return_5d || 0) < -0.5 ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                              style={{ width: `${Math.min(100, Math.abs(p.predicted_return_5d || 0) / 5 * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="hidden md:flex flex-wrap gap-1 max-w-[200px] justify-end">
                          {wf && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              wf.direction_accuracy > 0.55 ? 'bg-red-100 text-red-700' :
                              wf.direction_accuracy < 0.45 ? 'bg-green-100 text-green-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              准确率 {(wf.direction_accuracy * 100).toFixed(1)}%
                            </span>
                          )}
                          {wf && wf.reverse_better && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">反向更好</span>
                          )}
                        </div>
                        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expandedCode === p.symbol ? 'rotate-90' : ''}`} />
                      </button>

                      {expandedCode === p.symbol && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-4 space-y-4">
                          {/* 模型信息 */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FlaskConical className="w-4 h-4 text-indigo-500" />
                              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Ridge 0.6 + GBR 0.4 集成回归</span>
                            </div>
                            {ev && ev.overall_score !== undefined ? (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                ev.overall_score >= 60 ? 'bg-green-100 text-green-700' :
                                ev.overall_score >= 40 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                评估评分 {ev.overall_score}
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">样本不足，待验证</span>
                            )}
                          </div>

                          {/* Walk-forward 指标 */}
                          {wf && (
                            <div>
                              <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
                                <BarChart3 className="w-3 h-3" />
                                Walk-Forward 回测（{wf.n_predictions} 个预测点）
                              </div>
                              <div className="grid grid-cols-5 gap-2">
                                <MetricCard label="方向准确率" value={wf.direction_accuracy * 100} unit="%" positiveIsGood />
                                <MetricCard label="策略收益" value={wf.strategy_return_pct} unit="%" positiveIsGood />
                                <MetricCard label="买入持有" value={wf.buyhold_return_pct} unit="%" positiveIsGood />
                                <MetricCard label="反向策略" value={wf.reverse_return_pct} unit="%" positiveIsGood />
                                <MetricCard label="MAE" value={wf.mae} unit="%" />
                              </div>
                            </div>
                          )}

                          {/* 非价格特征 */}
                          {p.nonprice_features && (
                            <div>
                              <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
                                <BrainCircuit className="w-3 h-3" />
                                investoday 独立信号源
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {[
                                  { label: '综合评分', value: p.nonprice_features.score, color: 'text-indigo-600' },
                                  { label: '情绪分', value: p.nonprice_features.emotionScore, color: 'text-pink-600' },
                                  { label: '财务分', value: p.nonprice_features.financeScore, color: 'text-emerald-600' },
                                  { label: '行业分', value: p.nonprice_features.industryScore, color: 'text-amber-600' },
                                ].map(item => item.value !== undefined && (
                                  <div key={item.label} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
                                    <div className="text-[10px] text-gray-400 dark:text-gray-500">{item.label}</div>
                                    <div className={`text-sm font-bold ${item.color}`}>{item.value.toFixed(1)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 评估裁决 */}
                          {ev && ev.overall_score !== undefined && (
                            <div className={`rounded-lg px-3 py-2.5 border ${
                              ev.overall_score >= 60 ? 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-800/30' :
                              ev.overall_score >= 40 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800/30' :
                              'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-800/30'
                            }`}>
                              <div className="flex items-start gap-2">
                                {ev.overall_score >= 60 ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> :
                                 ev.overall_score >= 40 ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" /> :
                                 <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
                                <div>
                                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">模型评估裁决</div>
                                  <div className="text-sm text-gray-600 dark:text-gray-400">{ev.verdict}</div>
                                  {(ev.sample_size ?? 0) > 0 && (
                                    <div className="text-[10px] text-gray-400 mt-1">
                                      样本 {ev.sample_size} | 方向准确率 {((ev.direction_accuracy ?? 0) * 100).toFixed(1)}% | 二项检验 p={(ev.binom_pvalue ?? 0).toFixed(3)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 行动建议 */}
                          <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg px-3 py-2.5">
                            <div className="flex items-start gap-2">
                              <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                              <div>
                                <div className="text-xs font-semibold text-blue-800 dark:text-blue-400 mb-0.5">策略建议</div>
                                <div className="text-sm text-blue-700 dark:text-blue-300">
                                  {signal === '强烈买入' ? '预测5日收益 > 1.5%，模型给出较强做多信号。建议关注，但需注意交易成本侵蚀。' :
                                   signal === '买入' ? '预测5日收益为正，但幅度有限。可小仓位试探，严格止损。' :
                                   signal === '回避' ? '预测5日收益为负，模型建议空仓观望。避免逆势操作。' :
                                   '预测5日收益接近零，模型无明确方向。建议观望，等待更强信号。'}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 免责声明 */}
                          <div className="flex items-start gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>历史回测不代表未来收益。模型方向准确率 45-55% 接近随机水平，当前特征集可能不包含有效 alpha。investoday 非价格特征积累 90 天后将自动接入训练。</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 底部说明 */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-gray-400" />
                策略说明
              </h3>
              <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                <p><strong className="text-gray-700 dark:text-gray-300">5日预测策略：</strong>预测未来5个交易日收益率（百分比）。预测 &gt; 0.5% 视为做多信号，&lt; -0.5% 视为回避信号。</p>
                <p><strong className="text-gray-700 dark:text-gray-300">模型架构：</strong>Ridge 回归（权重 0.6）+ Gradient Boosting Regressor（权重 0.4），SelectKBest 特征选择，StandardScaler 标准化。</p>
                <p><strong className="text-gray-700 dark:text-gray-300">Walk-forward 验证：</strong>滚动窗口训练（252 天回看，每 20 天重新训练），严格避免数据泄露。</p>
                <p><strong className="text-gray-700 dark:text-gray-300">交易成本：</strong>单次买卖合计约 0.35%（佣金 0.025%×2 + 印花税 0.1% + 滑点 0.2%）。</p>
                <p><strong className="text-gray-700 dark:text-gray-300">当前局限：</strong>方向准确率 45-55% 接近随机。investoday 非价格特征（score/news sentiment/估值排名）积累 90 天后将自动接入训练。</p>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 验证实验室 Tab ==================== */}
        {activeTab === 'lab' && (
          <div className="space-y-6">
            {/* 重建方案说明 */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-indigo-500" />
                重建方案
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
                  <div className="font-medium text-indigo-700 dark:text-indigo-400 mb-1">预测目标</div>
                  <div className="text-gray-600 dark:text-gray-400">
                    二分类(涨/跌) → <span className="font-semibold text-indigo-600 dark:text-indigo-400">回归(5日收益率)</span><br/>
                    + 异常检测(|收益|&gt;2%)
                  </div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3">
                  <div className="font-medium text-emerald-700 dark:text-emerald-400 mb-1">新特征</div>
                  <div className="text-gray-600 dark:text-gray-400">
                    • investoday 情绪面得分<br/>
                    • 财务面得分 / 赛道得分<br/>
                    • 新闻情绪均值 / 数量<br/>
                    • 精简价格特征(15个)
                  </div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                  <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">验证机制</div>
                  <div className="text-gray-600 dark:text-gray-400">
                    • 每日自动预测并记录<br/>
                    • 5日后自动回填实际收益<br/>
                    • 统计方向准确率 + MAE
                  </div>
                </div>
              </div>
            </div>

            {/* 实验跟踪入口 */}
            {paperTradingReport && (
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/10 dark:to-teal-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-emerald-500" />
                    模拟盘实验跟踪
                  </h2>
                  <button
                    onClick={() => navigateTo('paperTrading')}
                    className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium"
                  >
                    查看详情 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{paperTradingReport.nav.toFixed(4)}</div>
                    <div className="text-[10px] text-gray-400">当前净值</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${paperTradingReport.total_return_pct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {paperTradingReport.total_return_pct >= 0 ? '+' : ''}{paperTradingReport.total_return_pct.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-gray-400">累计收益</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{paperTradingReport.total_trades}</div>
                    <div className="text-[10px] text-gray-400">已完成交易</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{paperTradingReport.holding_positions}</div>
                    <div className="text-[10px] text-gray-400">当前持仓</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                  模拟盘是真实的前向跟踪，每天根据实验信号实际执行买卖，包含真实交易成本。历史回测仅供参考，实验跟踪才是最终裁判。
                </div>
              </div>
            )}

            {/* 统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="总预测数" value={history.length.toString()} icon={<BarChart3 className="w-4 h-4 text-blue-500" />} />
              <StatCard label="已验证" value={verifiedRecords.length.toString()} icon={<CheckCircle2 className="w-4 h-4 text-green-500" />} />
              <StatCard label="方向准确率" value={`${(directionAccuracy * 100).toFixed(1)}%`} icon={<TrendingUp className="w-4 h-4 text-indigo-500" />} sub={verifiedRecords.length < 10 ? "样本不足" : undefined} />
              <StatCard label="平均绝对误差" value={`${avgError.toFixed(2)}%`} icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} />
            </div>

            {/* 模型评估报告 */}
            {evalReport && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">模型评估报告（基于已验证预测记录）</h2>
                </div>
                <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    {evalReport.summary.overall_verdict}
                    <span className="text-gray-400">| 样本量: {evalReport.total_verified} | 综合评分: {evalReport.summary.avg_score}/100</span>
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-2 text-left font-medium">股票</th>
                        <th className="px-4 py-2 text-right font-medium">样本</th>
                        <th className="px-4 py-2 text-right font-medium">方向准确率</th>
                        <th className="px-4 py-2 text-right font-medium">二项检验p值</th>
                        <th className="px-4 py-2 text-right font-medium">MAE</th>
                        <th className="px-4 py-2 text-right font-medium">相关系数</th>
                        <th className="px-4 py-2 text-right font-medium">评分</th>
                        <th className="px-4 py-2 text-left font-medium">裁决</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(evalReport.per_symbol)
                        .filter(([_, r]) => !r.error)
                        .map(([sym, r]) => (
                          <tr key={sym} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-4 py-2.5"><div className="font-medium text-gray-900 dark:text-gray-100">{sym}</div></td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{r.sample_size ?? '--'}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={(r.direction_accuracy ?? 0) > 0.55 ? 'text-red-600 font-semibold' : (r.direction_accuracy ?? 0) < 0.45 ? 'text-green-600 font-semibold' : 'text-gray-600'}>
                                {r.direction_accuracy !== undefined ? `${(r.direction_accuracy * 100).toFixed(1)}%` : '--'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{r.binom_pvalue?.toFixed(3) ?? '--'}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{r.mae?.toFixed(2) ?? '--'}%</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{r.correlation !== undefined ? `${r.correlation > 0 ? '+' : ''}${r.correlation.toFixed(3)}` : '--'}</td>
                            <td className="px-4 py-2.5 text-right font-semibold">
                              <span className={(r.overall_score ?? 0) >= 60 ? 'text-green-600' : (r.overall_score ?? 0) >= 40 ? 'text-amber-600' : 'text-red-600'}>
                                {r.overall_score ?? '--'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-gray-500">{r.verdict ?? '--'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Walk-Forward 回测结果 */}
            {Object.keys(wfReport).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-rose-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Walk-Forward 回测结果（5日预测 + 精简价格特征）</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-2 text-left font-medium">股票</th>
                        <th className="px-4 py-2 text-right font-medium">预测数</th>
                        <th className="px-4 py-2 text-right font-medium">方向准确率</th>
                        <th className="px-4 py-2 text-right font-medium">MAE</th>
                        <th className="px-4 py-2 text-right font-medium">相关系数</th>
                        <th className="px-4 py-2 text-right font-medium">策略收益</th>
                        <th className="px-4 py-2 text-right font-medium">买入持有</th>
                        <th className="px-4 py-2 text-right font-medium">反向策略</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(wfReport).map(([sym, r]) => (
                        <tr key={sym} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{r.name}</div>
                            <div className="text-[10px] text-gray-400">{sym}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.n_predictions}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={r.direction_accuracy > 0.55 ? 'text-red-600 font-semibold' : r.direction_accuracy < 0.45 ? 'text-green-600 font-semibold' : 'text-gray-600'}>
                              {(r.direction_accuracy * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.mae.toFixed(2)}%</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.correlation > 0 ? '+' : ''}{r.correlation.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">
                            <span className={r.strategy_return_pct > 0 ? 'text-red-600' : 'text-green-600'}>
                              {r.strategy_return_pct > 0 ? '+' : ''}{r.strategy_return_pct.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.buyhold_return_pct > 0 ? '+' : ''}{r.buyhold_return_pct.toFixed(2)}%</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={r.reverse_better ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                              {r.reverse_return_pct > 0 ? '+' : ''}{r.reverse_return_pct.toFixed(2)}%
                              {r.reverse_better && ' ⚠️'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠️ Walk-forward 结论: 方向准确率接近随机水平（45-52%），策略收益全面跑输买入持有。<br/>
                    核心发现: 仅靠价格衍生特征+us_overnight_score 不足以产生统计显著的预测能力。建议接入 investoday 独立信号源后再评估。
                  </p>
                </div>
              </div>
            )}

            {/* 旧的 Walk-Forward */}
            {Object.keys(backtest).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-rose-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Walk-Forward 回测结果（次日预测 + 非价格特征）</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-2 text-left font-medium">股票</th>
                        <th className="px-4 py-2 text-right font-medium">策略收益</th>
                        <th className="px-4 py-2 text-right font-medium">Buy&Hold</th>
                        <th className="px-4 py-2 text-right font-medium">超额</th>
                        <th className="px-4 py-2 text-right font-medium">夏普</th>
                        <th className="px-4 py-2 text-right font-medium">最大回撤</th>
                        <th className="px-4 py-2 text-right font-medium">交易</th>
                        <th className="px-4 py-2 text-right font-medium">胜率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {Object.entries(backtest).map(([sym, r]) => (
                        <tr key={sym} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{r.name}</div>
                            <div className="text-[10px] text-gray-400">{sym}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold">
                            <span className={r.total_return > 0 ? 'text-red-600' : 'text-green-600'}>
                              {r.total_return > 0 ? '+' : ''}{r.total_return.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.buyhold_return > 0 ? '+' : ''}{r.buyhold_return.toFixed(2)}%</td>
                          <td className="px-4 py-2.5 text-right font-semibold">
                            <span className={r.excess_return > 0 ? 'text-red-600' : 'text-green-600'}>
                              {r.excess_return > 0 ? '+' : ''}{r.excess_return.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.sharpe.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.max_dd.toFixed(1)}%</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.trades}次</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{r.win_rate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠️ 回测规则: T+1开盘执行 | 来回成本0.4% | -3%硬止损 | 仓位按预测强度动态调整 | 只做多<br/>
                    核心发现: 即使引入非价格特征，策略仍全部跑输Buy&Hold。频繁交易+择时在牛市中反而落后。
                  </p>
                </div>
              </div>
            )}

            {/* 今日预测详细表格 */}
            {todaySummary && todaySummary.predictions.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">📅 今日预测 ({todaySummary.date})</h2>
                  <span className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full">5日后验证</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-2 text-left font-medium">股票</th>
                        <th className="px-4 py-2 text-right font-medium">预测5日收益</th>
                        <th className="px-4 py-2 text-center font-medium">异常检测</th>
                        <th className="px-4 py-2 text-right font-medium">信号强度</th>
                        <th className="px-4 py-2 text-left font-medium">情绪分</th>
                        <th className="px-4 py-2 text-left font-medium">财务分</th>
                        <th className="px-4 py-2 text-right font-medium">模型R²</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {todaySummary.predictions.map((p) => (
                        <tr key={p.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                            <div className="text-[10px] text-gray-400">{p.symbol}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-semibold ${(p.predicted_return_5d || 0) > 0 ? 'text-red-600' : (p.predicted_return_5d || 0) < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                              {(p.predicted_return_5d || 0) > 0 ? '+' : ''}{(p.predicted_return_5d ?? 0).toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center"><AnomalyBadge direction={p.anomaly_direction} /></td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{(signalStrength(p) * 100).toFixed(1)}%</td>
                          <td className="px-4 py-2.5"><ScoreBar value={p.nonprice_features?.emotionScore || 0} color="bg-pink-500" /></td>
                          <td className="px-4 py-2.5"><ScoreBar value={p.nonprice_features?.financeScore || 0} color="bg-emerald-500" /></td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{p.model_metrics?.r2 !== undefined ? p.model_metrics.r2.toFixed(3) : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 历史记录 */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">📚 历史预测记录</h2>
              </div>
              {history.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">暂无历史记录。每日预测将自动保存于此。</div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
                      <tr className="border-b border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2 text-left font-medium">日期</th>
                        <th className="px-3 py-2 text-left font-medium">股票</th>
                        <th className="px-3 py-2 text-right font-medium">预测收益</th>
                        <th className="px-3 py-2 text-center font-medium">异常</th>
                        <th className="px-3 py-2 text-right font-medium">实际收益</th>
                        <th className="px-3 py-2 text-center font-medium">方向</th>
                        <th className="px-3 py-2 text-right font-medium">误差</th>
                        <th className="px-3 py-2 text-center font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {history.map((r, i) => (
                        <tr key={`${r.symbol}-${r.date}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-3 py-2 text-gray-500">{r.date}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span>
                            <span className="text-[10px] text-gray-400 ml-1">{r.symbol}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={(r.predicted_return_5d || 0) > 0 ? 'text-red-600' : (r.predicted_return_5d || 0) < 0 ? 'text-green-600' : ''}>
                              {(r.predicted_return_5d || 0) > 0 ? '+' : ''}{(r.predicted_return_5d ?? 0).toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center"><AnomalyBadge direction={r.anomaly_direction} small /></td>
                          <td className="px-3 py-2 text-right">
                            {r.actual_return !== undefined && r.actual_return !== null ? (
                              <span className={r.actual_return > 0 ? 'text-red-600 font-medium' : r.actual_return < 0 ? 'text-green-600 font-medium' : ''}>
                                {r.actual_return > 0 ? '+' : ''}{r.actual_return.toFixed(2)}%
                              </span>
                            ) : (<span className="text-gray-300">--</span>)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {r.direction_correct === true ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" /> :
                             r.direction_correct === false ? <TrendingDown className="w-3.5 h-3.5 text-red-500 mx-auto" /> :
                             <Minus className="w-3.5 h-3.5 text-gray-300 mx-auto" />}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">
                            {r.actual_return !== undefined && r.actual_return !== null && r.predicted_return_5d !== undefined
                              ? `${Math.abs((r.predicted_return_5d ?? 0) - r.actual_return).toFixed(2)}%`
                              : '--'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {r.verified ? (
                              <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">已验证</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full flex items-center gap-1 justify-center">
                                <Clock className="w-3 h-3" />{r.verify_date}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =================== 子组件 =================== */
function StatCard({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[10px] text-amber-600 mt-1">{sub}</div>}
    </div>
  );
}

function AnomalyBadge({ direction, small }: { direction: string; small?: boolean }) {
  if (direction === 'UP') {
    return (
      <span className={`inline-flex items-center gap-0.5 ${small ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-0.5'} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full font-medium`}>
        <TrendingUp className={`${small ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
        {small ? '多' : '看涨异常'}
      </span>
    );
  }
  if (direction === 'DOWN') {
    return (
      <span className={`inline-flex items-center gap-0.5 ${small ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-0.5'} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-medium`}>
        <TrendingDown className={`${small ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
        {small ? '空' : '看跌异常'}
      </span>
    );
  }
  return (
    <span className={`${small ? 'text-[10px] px-1 py-0.5' : 'text-xs px-2 py-0.5'} text-gray-400`}>
      {small ? '--' : '中性'}
    </span>
  );
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 w-8">{value.toFixed(0)}</span>
    </div>
  );
}
