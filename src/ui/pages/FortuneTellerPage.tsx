import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Sparkles, RefreshCw, Loader2, TrendingUp, TrendingDown,
  Star, ChevronUp, ChevronDown, HelpCircle
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

interface FortuneStock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  prediction?: string;
  upProbability: number;
  downProbability: number;
  neutralProbability: number;
  confidence?: number;
  historyTrend: string;
  factorScores?: {
    trend: number;
    momentum: number;
    volume: number;
    technical: number;
  };
  recentDays: Array<{ date: string; change: number }>;
  status: string;
}

function ProbabilityBar({ up, down, neutral }: { up: number; down: number; neutral: number }) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden flex">
      <div className="h-full bg-red-400" style={{ width: `${up}%` }} />
      <div className="h-full bg-gray-300 dark:bg-gray-600" style={{ width: `${neutral}%` }} />
      <div className="h-full bg-green-400" style={{ width: `${down}%` }} />
    </div>
  );
}

function ProbabilityBadge({ value, type }: { value: number; type: 'up' | 'down' | 'neutral' }) {
  const config: Record<string, { text: string; cls: string; icon: React.ElementType | null }> = {
    up: { text: '涨', cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800', icon: TrendingUp },
    down: { text: '跌', cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800', icon: TrendingDown },
    neutral: { text: '平', cls: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700', icon: null },
  };
  const c = config[type];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border ${c.cls} font-medium`}>
      {Icon && <Icon className="w-2.5 h-2.5" />}
      {c.text}{value.toFixed(0)}%
    </span>
  );
}

export function FortuneTellerPage() {
  const favorites = useAppStore((s) => s.favorites);
  // const toggleFortunePage = useAppStore((s) => s.toggleFortunePage); // 已迁移到策略重建实验室

  const [fortunes, setFortunes] = useState<FortuneStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const fetchFortunes = useCallback(async () => {
    if (favorites.length === 0 || !CLOUDBASE_API_URL) return;
    try {
      setLoading(true);
      const codes = favorites.map((f) => f.code).join(',');
      const res = await fetch(`${CLOUDBASE_API_URL}/fortune?codes=${encodeURIComponent(codes)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.stocks)) {
        setFortunes(data.stocks);
      }
    } catch (e) {
      console.warn('[Fortune] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [favorites]);

  useEffect(() => {
    fetchFortunes();
  }, [fetchFortunes]);

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 dark:text-gray-100">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => { window.location.href = '/strategyRebuild'; }}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all hover:scale-105"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">占卜师</h1>
            <p className="text-xs text-gray-400 hidden sm:block">基于历史数据的涨跌概率预测</p>
          </div>
        </div>
        <button
          onClick={fetchFortunes}
          disabled={loading || favorites.length === 0}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-50 text-purple-600 dark:text-purple-400 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded-xl transition-all hover:shadow-md disabled:opacity-50 active:scale-95"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          刷新
        </button>
      </div>

      {favorites.length === 0 ? (
        <div className="text-center py-20">
          <Star className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">暂无收藏股票</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">先在首页添加一些股票到收藏</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fortunes.map((stock) => {
            const isUp = stock.change >= 0;
            const expanded = expandedCode === stock.code;
            return (
              <div
                key={stock.code}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-lg hover:shadow-purple-100/30 dark:hover:shadow-purple-900/20 transition-all hover:-translate-y-0.5"
              >
                {/* 主行 */}
                <button
                  onClick={() => setExpandedCode(expanded ? null : stock.code)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left overflow-x-auto"
                >
                  {/* 代码/名称 */}
                  <div className="w-28 shrink-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stock.name}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{stock.code}</div>
                  </div>

                  {/* 今日涨跌 */}
                  <div className="w-28 shrink-0">
                    <div className={`text-sm font-bold ${isUp ? 'text-red-600' : 'text-green-600'}`}>
                      {stock.price.toFixed(2)}
                    </div>
                    <div className={`text-[11px] font-medium flex items-center gap-0.5 ${isUp ? 'text-red-500' : 'text-green-500'}`}>
                      {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {isUp ? '+' : ''}{stock.changePercent.toFixed(2)}%
                    </div>
                  </div>

                  {/* 明日涨跌概率 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <ProbabilityBadge value={stock.upProbability} type="up" />
                      <ProbabilityBadge value={stock.neutralProbability} type="neutral" />
                      <ProbabilityBadge value={stock.downProbability} type="down" />
                    </div>
                    <ProbabilityBar
                      up={stock.upProbability}
                      neutral={stock.neutralProbability}
                      down={stock.downProbability}
                    />
                  </div>

                  {/* 历史趋势 */}
                  <div className="w-20 shrink-0 text-right">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      stock.historyTrend === '上涨' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                      stock.historyTrend === '下跌' ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' :
                      'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      {stock.historyTrend}
                    </span>
                  </div>

                  {/* 展开箭头 */}
                  {expanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  )}
                </button>

                {/* 展开详情：因子评分 + 近期历史 */}
                {expanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
                    {/* 预测标签 + 置信度 */}
                    {stock.prediction && (
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`text-sm font-bold ${
                          stock.prediction === '涨' ? 'text-red-600 dark:text-red-400' :
                          stock.prediction === '跌' ? 'text-green-600 dark:text-green-400' :
                          'text-gray-600 dark:text-gray-400'
                        }`}>
                          AI 预测：{stock.prediction === '涨' ? '上涨' : stock.prediction === '跌' ? '下跌' : '平盘'}
                        </div>
                        {stock.confidence !== undefined && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 group relative inline-block">
                            置信度 {stock.confidence}%
                            <span className="absolute left-0 top-full mt-0.5 w-44 text-[9px] text-gray-500 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded px-2 py-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              置信度 = |涨概率 − 50| × 2<br/>越偏离50%越有把握
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 因子评分 */}
                    {stock.factorScores && (
                      <div className="mb-3 space-y-1.5">
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          多因子评分
                          <span className="group relative">
                            <HelpCircle className="w-3 h-3 text-gray-300 cursor-help" />
                            <span className="absolute left-full ml-1 top-0 w-52 text-[9px] text-gray-500 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded px-2 py-1.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              综合 = 趋势×25% + 动量×25% + 量能×20% + 技术×30%<br/>
                              置信度 = |涨概率−50|×2，越偏离50越有把握
                            </span>
                          </span>
                        </div>
                        {[
                          { label: '趋势', value: stock.factorScores.trend, color: 'bg-blue-400', tip: 'MA排列:多头85/短期上65/空头15/短期下35/纠缠50' },
                          { label: '动量', value: stock.factorScores.momentum, color: 'bg-orange-400', tip: '50 + 近5日涨跌×3 + 今日涨跌×0.5' },
                          { label: '量能', value: stock.factorScores.volume, color: 'bg-purple-400', tip: '量比×方向:涨放量75/涨缩量55/跌放量25/跌缩量45' },
                          { label: '技术', value: stock.factorScores.technical, color: 'bg-cyan-400', tip: '简化RSI = 100 − 100/(1+平均涨幅/平均跌幅)' },
                        ].map((f) => (
                          <div key={f.label} className="flex items-center gap-2 group">
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 w-8">{f.label}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div className={`h-full ${f.color}`} style={{ width: `${f.value}%` }} />
                            </div>
                            <span className={`text-[10px] w-6 text-right ${f.value >= 50 ? 'text-red-500' : 'text-green-500'}`}>{f.value}</span>
                            <span className="relative">
                              <HelpCircle className="w-2.5 h-2.5 text-gray-300 cursor-help" />
                              <span className="absolute right-0 top-full mt-0.5 w-48 text-[9px] text-gray-500 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded px-2 py-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                {f.tip}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">近10日涨跌</div>
                    <div className="flex items-end gap-1 h-16">
                      {stock.recentDays.map((day) => {
                        const h = Math.min(Math.abs(day.change) * 3, 100);
                        const color = day.change > 0 ? 'bg-red-400' : day.change < 0 ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600';
                        return (
                          <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                            <div className={`w-full rounded-sm ${color}`} style={{ height: `${Math.max(h, 4)}%` }} />
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">{day.date.slice(5)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                      免责声明：以上预测仅基于历史数据统计，不构成投资建议。
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
