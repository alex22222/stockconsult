import { useState, useEffect, useCallback } from 'react';
import {
  Zap, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp,
  BarChart3, Activity, DollarSign, Megaphone, Waves, Clock, AlertTriangle,
  Trophy, Flame, Target, ArrowUpRight, Search, BarChart4
} from 'lucide-react';
import type { MomentumPick, MomentumScanResult } from '../../core/types/momentum';
import { scanMomentumPicks } from '../../core/data/momentum-scanner';

function LevelBadge({ level, score }: { level: MomentumPick['level']; score: number }) {
  if (level === 'extreme') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <Flame className="w-3 h-3" />
        极度爆破 {score}
      </span>
    );
  }
  if (level === 'high') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
        <Zap className="w-3 h-3" />
        高爆破 {score}
      </span>
    );
  }
  if (level === 'medium') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        <TrendingUp className="w-3 h-3" />
        中度爆破 {score}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      <Activity className="w-3 h-3" />
      观察 {score}
    </span>
  );
}

function DimensionBar({ name, score, weight, icon: Icon }: {
  name: string; score: number; weight: number;
  icon: React.ElementType;
}) {
  const colorClass = score >= 80
    ? 'bg-red-500'
    : score >= 60
    ? 'bg-orange-500'
    : score >= 40
    ? 'bg-yellow-500'
    : 'bg-gray-400';

  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] text-gray-600 dark:text-gray-400">{name}</span>
          <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
            {score}<span className="text-gray-400 dark:text-gray-500">/100</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">({Math.round(weight * 100)}%)</span>
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StockCard({ pick, expanded, onToggle }: {
  pick: MomentumPick;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dimIcons: Record<string, React.ElementType> = {
    '量价脉冲': BarChart3,
    '技术突破': Target,
    '资金涌入': DollarSign,
    '情绪催化': Megaphone,
    '波动释放': Waves,
  };

  return (
    <div className={`rounded-xl border transition-all duration-200 ${
      pick.level === 'extreme'
        ? 'border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-900/10'
        : pick.level === 'high'
        ? 'border-orange-200 dark:border-orange-900/40 bg-orange-50/30 dark:bg-orange-900/10'
        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
    }`}>
      {/* 头部 */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded-xl"
      >
        <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
          pick.rank <= 3
            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        }`}>
          {pick.rank <= 3 ? <Trophy className="w-3.5 h-3.5" /> : pick.rank}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{pick.stock.name}</span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{pick.stock.code}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {pick.stock.industry}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <LevelBadge level={pick.level} score={pick.score} />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              ¥{pick.price.toFixed(2)}
            </span>
            <span className={`text-[11px] font-medium inline-flex items-center gap-0.5 ${
              pick.changePercent >= 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-green-600 dark:text-green-400'
            }`}>
              {pick.changePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {pick.changePercent >= 0 ? '+' : ''}{pick.changePercent.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex-shrink-0">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800">
          {/* 一句话总结 */}
          <div className="mt-3 flex items-start gap-2">
            <ArrowUpRight className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{pick.summary}</p>
          </div>

          {/* 五大维度 */}
          <div className="mt-4 space-y-2.5">
            {pick.dimensions.map((dim) => (
              <DimensionBar
                key={dim.name}
                name={dim.name}
                score={dim.score}
                weight={dim.weight}
                icon={dimIcons[dim.name] || Activity}
              />
            ))}
          </div>

          {/* 详细理由 */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {pick.dimensions.map((dim) => (
              <div
                key={dim.name}
                className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  {(() => {
                    const Icon = dimIcons[dim.name] || Activity;
                    return <Icon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />;
                  })()}
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{dim.name}</span>
                  <span className={`text-[10px] ml-auto font-bold ${
                    dim.score >= 80 ? 'text-red-500' : dim.score >= 60 ? 'text-orange-500' : 'text-gray-400'
                  }`}>
                    {dim.score}分
                  </span>
                </div>
                <ul className="space-y-1">
                  {dim.details.map((detail, i) => (
                    <li key={i} className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed flex items-start gap-1">
                      <span className="text-gray-300 dark:text-gray-600 mt-0.5">•</span>
                      {detail}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* 持仓建议 & 风险提示 */}
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 rounded-lg bg-blue-50 dark:bg-blue-900/10 p-3 flex items-start gap-2">
              <Clock className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-medium text-blue-700 dark:text-blue-400">建议持仓周期</div>
                <div className="text-sm text-blue-800 dark:text-blue-300 mt-0.5">{pick.holdingPeriod}</div>
              </div>
            </div>
            <div className="flex-1 rounded-lg bg-amber-50 dark:bg-amber-900/10 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-medium text-amber-700 dark:text-amber-400">风险提示</div>
                <ul className="mt-0.5 space-y-0.5">
                  {pick.riskWarning.map((w, i) => (
                    <li key={i} className="text-[11px] text-amber-800 dark:text-amber-300">{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TheorySection() {
  const [showTheory, setShowTheory] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <button
        onClick={() => setShowTheory(!showTheory)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart4 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">「爆破力扫描」选股理论</span>
        </div>
        {showTheory ? (
          <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        )}
      </button>

      {showTheory && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-3">
          <p>
            <strong className="text-gray-800 dark:text-gray-200">核心思想：</strong>
            短期爆发力不是猜涨跌，而是识别「资金正在集中涌入 + 技术形态刚突破 + 消息面有催化」的三重共振时刻。
            模型从全市场 A 股中扫描，每日更新，上限展示前 10 名。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { name: '量价脉冲', weight: '30%', icon: BarChart3, desc: '成交量突增 + 价格快速拉升，确认资金真实介入而非无量空涨' },
              { name: '技术突破', weight: '25%', icon: Target, desc: '突破 20 日/60 日高点 + MACD 金叉 + RSI 强势区间' },
              { name: '资金涌入', weight: '20%', icon: DollarSign, desc: '主力资金净流入 + 大单买入占比提升 + 换手率放大' },
              { name: '情绪催化', weight: '15%', icon: Megaphone, desc: '近期利好公告密度 + 研报覆盖变化 + 新闻情绪得分' },
              { name: '波动释放', weight: '10%', icon: Waves, desc: '布林带收窄后突破 + ATR 从低位快速放大' },
            ].map((item) => (
              <div key={item.name} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <item.icon className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{item.name}</span>
                  <span className="text-[10px] text-blue-500 font-bold ml-auto">{item.weight}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">评分等级：</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <Flame className="w-3 h-3" /> 85-100 极度爆破
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
              <Zap className="w-3 h-3" /> 70-84 高爆破
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              <TrendingUp className="w-3 h-3" /> 55-69 中度爆破
            </span>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            ⚠️ 免责声明：本模型仅为技术研究演示，不构成任何投资建议。股市有风险，入市需谨慎。
          </p>
        </div>
      )}
    </div>
  );
}

export function MomentumScanPage() {
  const [result, setResult] = useState<MomentumScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [expandedId, setExpandedId] = useState<number | null>(1);

  const runScan = useCallback(async () => {
    setLoading(true);
    setProgress({ done: 0, total: 12 });
    try {
      const data = await scanMomentumPicks((done, total) => {
        setProgress({ done, total });
      });
      setResult(data);
      setExpandedId(1);
    } catch (e) {
      console.error('Scan failed:', e);
    } finally {
      setLoading(false);
      setProgress({ done: 0, total: 0 });
    }
  }, []);

  // 首次进入自动扫描
  useEffect(() => {
    if (!result && !loading) {
      runScan();
    }
  }, [result, loading, runScan]);

  const toggleExpand = (rank: number) => {
    setExpandedId((prev) => (prev === rank ? null : rank));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">爆破力扫描</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">A 股短期爆发力选股模型 · 每日更新 · Top 10</p>
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '扫描中...' : '重新扫描'}
          </button>
        </div>

        {/* 理论说明 */}
        <TheorySection />

        {/* 扫描状态 / 结果 */}
        {loading && !result && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 flex flex-col items-center justify-center">
            <div className="relative w-12 h-12 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-gray-100 dark:border-gray-800" />
              <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
              <Search className="absolute inset-0 m-auto w-5 h-5 text-blue-500" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {progress.total > 0
                ? `正在获取真实行情数据… ${progress.done}/${progress.total}`
                : '正在全市场扫描...'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              通过 investoday API 获取 {progress.total || 12} 只标的近期行情，计算量价/技术/资金/情绪/波动五维指标
            </p>
            {progress.total > 0 && (
              <div className="w-48 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {result && (
          <>
            {/* 市场氛围 */}
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">市场氛围</span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                result.marketSentiment === 'bullish'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : result.marketSentiment === 'bearish'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {result.marketSentiment === 'bullish' ? (
                  <><TrendingUp className="w-3 h-3" /> 偏多</>
                ) : result.marketSentiment === 'bearish' ? (
                  <><TrendingDown className="w-3 h-3" /> 偏空</>
                ) : (
                  <><Activity className="w-3 h-3" /> 中性</>
                )}
              </span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">
                本次扫描 {result.totalScanned.toLocaleString()} 只个股 · {result.scanTime}
              </span>
            </div>

            {/* 股票列表 */}
            <div className="space-y-3">
              {result.picks.map((pick) => (
                <StockCard
                  key={pick.stock.code}
                  pick={pick}
                  expanded={expandedId === pick.rank}
                  onToggle={() => toggleExpand(pick.rank)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
