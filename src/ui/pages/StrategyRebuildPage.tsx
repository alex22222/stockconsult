import { useState, useEffect } from 'react';
import { FlaskConical, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Clock, BarChart3, BrainCircuit, Activity } from 'lucide-react';

interface PredictionRecord {
  date: string;
  symbol: string;
  name: string;
  predicted_return_5d: number;
  anomaly_direction: string;
  confidence: number;
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

export function StrategyRebuildPage() {
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);
  const [backtest, setBacktest] = useState<Record<string, BacktestResult>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [histRes, sumRes, btRes] = await Promise.all([
          fetch('/paper-trading/rebuild_prediction_history.json'),
          fetch(`/paper-trading/rebuild_daily_summary_${new Date().toISOString().split('T')[0]}.json`),
          fetch('/paper-trading/rebuild_backtest.json'),
        ]);

        if (histRes.ok) {
          const hist = await histRes.json();
          setHistory(Array.isArray(hist) ? hist.reverse() : []);
        }
        if (sumRes.ok) {
          const sum = await sumRes.json();
          setTodaySummary(sum);
        }
        if (btRes.ok) {
          const bt = await btRes.json();
          setBacktest(bt.stocks || {});
        }
      } catch (e) {
        console.warn('[StrategyRebuild] load failed:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const verifiedRecords = history.filter((r) => r.verified);
  const directionAccuracy = verifiedRecords.length > 0
    ? verifiedRecords.filter((r) => r.direction_correct).length / verifiedRecords.length
    : 0;

  const avgError = verifiedRecords.length > 0
    ? verifiedRecords.reduce((s, r) => s + Math.abs((r.predicted_return_5d || 0) - (r.actual_return || 0)), 0) / verifiedRecords.length
    : 0;

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 标题 */}
        <div className="flex items-center gap-3">
          <FlaskConical className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">策略重建实验室</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              回归目标 + 非价格特征 | 从今天开始积累数据
            </p>
          </div>
        </div>

        {/* 策略说明卡片 */}
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

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="总预测数"
            value={history.length.toString()}
            icon={<BarChart3 className="w-4 h-4 text-blue-500" />}
          />
          <StatCard
            label="已验证"
            value={verifiedRecords.length.toString()}
            icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          />
          <StatCard
            label="方向准确率"
            value={`${(directionAccuracy * 100).toFixed(1)}%`}
            icon={<TrendingUp className="w-4 h-4 text-indigo-500" />}
            sub={verifiedRecords.length < 10 ? "样本不足" : undefined}
          />
          <StatCard
            label="平均绝对误差"
            value={`${avgError.toFixed(2)}%`}
            icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
          />
        </div>

        {/* Walk-Forward 回测结果 */}
        {Object.keys(backtest).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Walk-Forward 回测结果（次日预测 + 非价格特征）
              </h2>
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
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                        {r.buyhold_return > 0 ? '+' : ''}{r.buyhold_return.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        <span className={r.excess_return > 0 ? 'text-red-600' : 'text-green-600'}>
                          {r.excess_return > 0 ? '+' : ''}{r.excess_return.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{r.sharpe.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{r.max_dd.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{r.trades}次</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{r.win_rate.toFixed(1)}%</td>
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

        {/* 今日预测 */}
        {todaySummary && todaySummary.predictions.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                📅 今日预测 ({todaySummary.date})
              </h2>
              <span className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full">
                5日后验证
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2 text-left font-medium">股票</th>
                    <th className="px-4 py-2 text-right font-medium">预测5日收益</th>
                    <th className="px-4 py-2 text-center font-medium">异常检测</th>
                    <th className="px-4 py-2 text-right font-medium">置信度</th>
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
                        <span className={`font-semibold ${p.predicted_return_5d > 0 ? 'text-red-600' : p.predicted_return_5d < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                          {p.predicted_return_5d > 0 ? '+' : ''}{p.predicted_return_5d.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <AnomalyBadge direction={p.anomaly_direction} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                        {(p.confidence * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5">
                        <ScoreBar value={p.nonprice_features?.emotionScore || 0} color="bg-pink-500" />
                      </td>
                      <td className="px-4 py-2.5">
                        <ScoreBar value={p.nonprice_features?.financeScore || 0} color="bg-emerald-500" />
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {p.model_metrics?.r2 !== undefined ? p.model_metrics.r2.toFixed(3) : '--'}
                      </td>
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
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              📚 历史预测记录
            </h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              暂无历史记录。每日预测将自动保存于此。
            </div>
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
                        <span className={r.predicted_return_5d > 0 ? 'text-red-600' : r.predicted_return_5d < 0 ? 'text-green-600' : ''}>
                          {r.predicted_return_5d > 0 ? '+' : ''}{r.predicted_return_5d.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <AnomalyBadge direction={r.anomaly_direction} small />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.actual_return !== undefined && r.actual_return !== null ? (
                          <span className={r.actual_return > 0 ? 'text-red-600 font-medium' : r.actual_return < 0 ? 'text-green-600 font-medium' : ''}>
                            {r.actual_return > 0 ? '+' : ''}{r.actual_return.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-gray-300">--</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.direction_correct === true ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" />
                        ) : r.direction_correct === false ? (
                          <TrendingDown className="w-3.5 h-3.5 text-red-500 mx-auto" />
                        ) : (
                          <Minus className="w-3.5 h-3.5 text-gray-300 mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">
                        {r.actual_return !== undefined && r.actual_return !== null
                          ? `${Math.abs(r.predicted_return_5d - r.actual_return).toFixed(2)}%`
                          : '--'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.verified ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">已验证</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full flex items-center gap-1 justify-center">
                            <Clock className="w-3 h-3" />
                            {r.verify_date}
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
    </div>
  );
}

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
