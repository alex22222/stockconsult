import { useState, useEffect } from 'react';
import {
  ArrowLeft, Search, Calendar, FileText, Loader2, Clock,
  BarChart3, Newspaper, Lightbulb, Target, ShieldAlert,
  Brain, TrendingUp, TrendingDown, Check, X, Activity
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

type RecordType = 'search' | 'report' | 'prediction';

interface DailyStat {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface PredictionStats {
  totalPredictions: number;
  verifiedPredictions: number;
  correctPredictions: number;
  accuracy: number;
  dailyStats?: DailyStat[];
}

interface RecordItem {
  path: string;
  date: string;
  name: string;
  size: number;
  query: string;
  stock?: { code: string; name: string; exchange: string; industry: string };
  rating?: string;
  ratingLabel?: string;
  oneSentenceSummary?: string;
  stockCode?: string;
  stockName?: string;
  predictDate?: string;
  prediction?: string;
  confidence?: number;
  verified?: boolean;
  actualResult?: string;
  actualChangePercent?: number;
  factorScores?: { trend: number; momentum: number; volume: number; technical: number };
}

interface SearchDetail {
  query: string;
  results: Array<{ code: string; name: string }>;
  timestamp: string;
  source: string;
}

interface ReportDetail {
  query: string;
  stock: { code: string; name: string; exchange: string; industry: string; marketCap: number };
  sections: {
    coreView: {
      rating: string;
      ratingLabel: string;
      oneSentenceSummary: string;
      keyDrivers: string[];
      bullCase: string;
      bearCase: string;
      investmentThesis: string;
    };
    keyMetrics: {
      valuation: Array<{ label: string; value: string | number; unit?: string }>;
      profitability: Array<{ label: string; value: string | number; unit?: string }>;
      growth: Array<{ label: string; value: string | number; unit?: string }>;
      quality: Array<{ label: string; value: string | number; unit?: string }>;
      market: Array<{ label: string; value: string | number; unit?: string }>;
    };
    marketInterpretation: {
      recentEvents: Array<{ date: string; title: string; type: string; impact: string }>;
      sentimentAnalysis: { overall: string; score: number; summary: string };
      institutionalViews?: { consensusRating?: string; targetPriceRange?: [number, number]; reportCount: number };
    };
    actionAdvice: {
      recommendation: string;
      recommendationLabel: string;
      entryStrategy?: string;
      exitStrategy?: string;
      stopLoss?: number;
      targetPrices?: { conservative: number; base: number; optimistic: number };
      positionAdvice?: string;
      keyMonitoringPoints: string[];
      riskReminders: string[];
    };
    rawInsights: Array<{ type: string; title: string; description?: string; confidence?: number }>;
  };
  dataBundle: {
    market: { price: number; change: number; changePercent: number; pe: number; pb: number; updateTime?: string };
    financial: { grossMargin: number; netMargin: number; roe: number; debtRatio: number };
    newsCount: number;
    reportsCount: number;
  };
  timestamp: string;
  source: string;
}

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

function RatingBadge({ rating, label }: { rating?: string; label?: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    strong_buy: { text: label || '强烈买入', cls: 'bg-red-100 text-red-700' },
    buy: { text: label || '买入', cls: 'bg-red-50 text-red-600' },
    hold: { text: label || '持有', cls: 'bg-gray-100 text-gray-600' },
    reduce: { text: label || '减持', cls: 'bg-amber-50 text-amber-600' },
    sell: { text: label || '卖出', cls: 'bg-green-50 text-green-600' },
  };
  const c = map[rating || ''] || map.hold;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.cls}`}>{c.text}</span>;
}

export function RecordsPage() {
  const [activeTab, setActiveTab] = useState<RecordType>('search');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search detail
  const [selectedSearch, setSelectedSearch] = useState<SearchDetail | null>(null);
  // Report detail
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  // Prediction stats
  const [predictionStats, setPredictionStats] = useState<PredictionStats | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');

  const toggleRecordsPage = useAppStore((s) => s.toggleRecordsPage);

  useEffect(() => {
    fetchRecords(activeTab);
  }, [activeTab]);

  async function fetchRecords(type: RecordType) {
    if (!CLOUDBASE_API_URL) {
      setError('CloudBase API URL 未配置');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setSelectedSearch(null);
      setSelectedReport(null);
      setSelectedPath('');
      setPredictionStats(null);

      if (type === 'prediction') {
        const [listRes, statsRes] = await Promise.all([
          fetch(`${CLOUDBASE_API_URL}/list-predictions?page=1&pageSize=50`),
          fetch(`${CLOUDBASE_API_URL}/prediction-stats`),
        ]);
        const listData = await listRes.json();
        const statsData = await statsRes.json();
        if (listData.success) {
          setRecords(listData.records || []);
        }
        if (statsData.success) {
          setPredictionStats(statsData.stats);
        }
      } else {
        const response = await fetch(`${CLOUDBASE_API_URL}/list-records?type=${type}`);
        const data = await response.json();
        if (data.success) {
          setRecords(data.records || []);
        } else {
          setError(data.error || '获取记录失败');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetail(path: string) {
    if (!CLOUDBASE_API_URL) return;
    try {
      setDetailLoading(true);
      setSelectedPath(path);
      const response = await fetch(`${CLOUDBASE_API_URL}/get-record?path=${encodeURIComponent(path)}`);
      const data = await response.json();
      if (data.success) {
        if (activeTab === 'search') {
          setSelectedSearch(data.data);
          setSelectedReport(null);
        } else {
          setSelectedReport(data.data);
          setSelectedSearch(null);
        }
      }
    } catch (e) {
      console.warn('获取详情失败:', e);
    } finally {
      setDetailLoading(false);
    }
  }

  const grouped = records.reduce((acc, r) => {
    if (!acc[r.date]) acc[r.date] = [];
    acc[r.date].push(r);
    return acc;
  }, {} as Record<string, RecordItem[]>);
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => toggleRecordsPage(false)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">历史记录</h1>
          <p className="text-sm text-gray-500 mt-0.5">共 {records.length} 条记录</p>
        </div>
        <button onClick={() => fetchRecords(activeTab)} disabled={loading} className="ml-auto px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '刷新'}
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'search' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" />
            查询记录
          </span>
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'report' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            分析报告
          </span>
        </button>
        <button
          onClick={() => setActiveTab('prediction')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'prediction' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5" />
            预测记录
          </span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">{error}</div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="text-center py-20">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {activeTab === 'search' ? '暂无查询记录' : activeTab === 'report' ? '暂无分析报告' : '暂无预测记录'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {activeTab === 'search' ? '在搜索页查询股票后，记录会自动保存到这里' : activeTab === 'report' ? '在搜索页分析股票后，报告会自动保存到这里' : '每日21:00自动对收藏股票做预测，次日收盘后验证'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 记录列表 */}
        <div className="lg:col-span-3 space-y-6">
          {/* 预测记录统计卡片 */}
          {activeTab === 'prediction' && predictionStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">总预测</div>
                <div className="text-xl font-bold text-gray-900">{predictionStats.totalPredictions}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">已验证</div>
                <div className="text-xl font-bold text-blue-600">{predictionStats.verifiedPredictions}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">正确数</div>
                <div className="text-xl font-bold text-green-600">{predictionStats.correctPredictions}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">准确率</div>
                <div className="text-xl font-bold text-purple-600">{predictionStats.accuracy}%</div>
              </div>
            </div>
          )}

          {activeTab === 'prediction' && predictionStats?.dailyStats && predictionStats.dailyStats.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-2">
              <div className="text-xs font-medium text-gray-500 mb-2">近7天准确率趋势</div>
              <div className="flex items-end gap-2 h-16">
                {predictionStats.dailyStats.map((d: DailyStat, i: number) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`w-full rounded-sm ${d.accuracy >= 50 ? 'bg-purple-400' : 'bg-gray-300'}`} style={{ height: `${Math.max(d.accuracy, 5)}%` }} />
                    <span className="text-[9px] text-gray-400">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dates.map((date) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{date}</span>
                <span className="text-xs text-gray-400">({grouped[date].length} 条)</span>
              </div>
              <div className="space-y-2">
                {grouped[date].map((record) => (
                  <button
                    key={record.path}
                    onClick={() => activeTab === 'prediction' ? setSelectedPath(record.path) : fetchDetail(record.path)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      selectedPath === record.path
                        ? 'border-blue-300 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-blue-200 hover:shadow-sm'
                    }`}
                  >
                    {activeTab === 'search' ? (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <Search className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{record.query}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{record.name}</span>
                            {record.size > 0 && <span className="text-xs text-gray-300">· {(record.size / 1024).toFixed(1)} KB</span>}
                          </div>
                        </div>
                      </div>
                    ) : activeTab === 'prediction' ? (
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          record.prediction === '涨' ? 'bg-red-50' : record.prediction === '跌' ? 'bg-green-50' : 'bg-gray-50'
                        }`}>
                          {record.prediction === '涨' ? <TrendingUp className="w-4 h-4 text-red-500" /> :
                           record.prediction === '跌' ? <TrendingDown className="w-4 h-4 text-green-500" /> :
                           <Activity className="w-4 h-4 text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{record.stockName || record.stockCode}</span>
                            <span className="text-xs text-gray-400 font-mono">{record.stockCode}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              record.prediction === '涨' ? 'bg-red-50 text-red-600' :
                              record.prediction === '跌' ? 'bg-green-50 text-green-600' :
                              'bg-gray-50 text-gray-500'
                            }`}>{record.prediction === '涨' ? '预测涨' : record.prediction === '跌' ? '预测跌' : '预测平'}</span>
                            {record.verified && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                record.prediction === record.actualResult ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                              }`}>
                                {record.prediction === record.actualResult ? (
                                  <span className="flex items-center gap-0.5"><Check className="w-2.5 h-2.5" />正确</span>
                                ) : (
                                  <span className="flex items-center gap-0.5"><X className="w-2.5 h-2.5" />错误</span>
                                )}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
                            <span>置信度 {record.confidence}%</span>
                            {record.verified && (
                              <span>实际{record.actualResult === '涨' ? '涨' : record.actualResult === '跌' ? '跌' : '平'} {record.actualChangePercent}%</span>
                            )}
                            {!record.verified && <span className="text-amber-500">待验证</span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <BarChart3 className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{record.stock?.name || record.query}</span>
                            <span className="text-xs text-gray-400 font-mono">{record.stock?.code}</span>
                            {record.rating && <RatingBadge rating={record.rating} label={record.ratingLabel} />}
                          </div>
                          {record.oneSentenceSummary && (
                            <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{record.oneSentenceSummary}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 详情面板 */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* 查询记录详情 */}
            {activeTab === 'search' && selectedSearch && (
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">查询详情</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">查询词</label>
                    <div className="text-sm font-medium text-gray-900">{selectedSearch.query}</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">时间</label>
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(selectedSearch.timestamp).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      搜索结果 ({selectedSearch.results?.length || 0})
                    </label>
                    {selectedSearch.results && selectedSearch.results.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedSearch.results.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                            <span className="font-medium text-gray-900">{r.name}</span>
                            <span className="text-xs text-gray-400">{r.code}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">无结果</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 分析报告详情 */}
            {activeTab === 'report' && selectedReport && (
              <div className="max-h-[calc(100vh-140px)] overflow-y-auto">
                {/* 头部概览 */}
                <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-blue-50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-bold text-gray-900">{selectedReport.stock.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{selectedReport.stock.code}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {selectedReport.stock.industry} · {selectedReport.stock.exchange}
                  </div>
                  <RatingBadge rating={selectedReport.sections.coreView.rating} label={selectedReport.sections.coreView.ratingLabel} />
                  <p className="text-sm text-gray-700 mt-2 leading-relaxed">{selectedReport.sections.coreView.oneSentenceSummary}</p>
                </div>

                <div className="p-4 space-y-5">
                  {/* 核心观点 */}
                  <Section icon={<Lightbulb className="w-4 h-4 text-amber-500" />} title="核心观点">
                    <div className="space-y-2">
                      <p className="text-sm text-gray-700">{selectedReport.sections.coreView.investmentThesis}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedReport.sections.coreView.keyDrivers?.slice(0, 4).map((d, i) => (
                          <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded-md">{d}</span>
                        ))}
                      </div>
                    </div>
                  </Section>

                  {/* 关键指标 */}
                  {selectedReport.sections.keyMetrics && (
                    <Section icon={<BarChart3 className="w-4 h-4 text-blue-500" />} title="关键指标">
                      <div className="space-y-3">
                        {selectedReport.sections.keyMetrics.valuation?.some(m => m.value !== '-') && (
                          <MetricGroup label="估值" metrics={selectedReport.sections.keyMetrics.valuation} />
                        )}
                        {selectedReport.sections.keyMetrics.profitability?.some(m => m.value !== '-') && (
                          <MetricGroup label="盈利" metrics={selectedReport.sections.keyMetrics.profitability} />
                        )}
                        {selectedReport.sections.keyMetrics.growth?.some(m => m.value !== '-') && (
                          <MetricGroup label="成长" metrics={selectedReport.sections.keyMetrics.growth} />
                        )}
                      </div>
                    </Section>
                  )}

                  {/* 市场解读 */}
                  {selectedReport.sections.marketInterpretation && (
                    <Section icon={<Newspaper className="w-4 h-4 text-green-500" />} title="市场解读">
                      <div className="space-y-2">
                        <SentimentBadge sentiment={selectedReport.sections.marketInterpretation.sentimentAnalysis?.overall} />
                        <p className="text-xs text-gray-500">{selectedReport.sections.marketInterpretation.sentimentAnalysis?.summary}</p>
                        {selectedReport.sections.marketInterpretation.recentEvents?.slice(0, 3).map((e, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${
                              e.impact === 'positive' ? 'bg-red-400' : e.impact === 'negative' ? 'bg-green-400' : 'bg-gray-300'
                            }`} />
                            <span className="text-gray-600 line-clamp-1">{e.title}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* 行动建议 */}
                  {selectedReport.sections.actionAdvice && (
                    <Section icon={<Target className="w-4 h-4 text-purple-500" />} title="行动建议">
                      <div className="space-y-2">
                        {selectedReport.sections.actionAdvice.targetPrices && (
                          <div className="flex gap-2">
                            {['conservative', 'base', 'optimistic'].map((k) => {
                              const tp = selectedReport.sections.actionAdvice.targetPrices as Record<string, number>;
                              const labels: Record<string, string> = { conservative: '保守', base: '基准', optimistic: '乐观' };
                              return (
                                <div key={k} className={`flex-1 text-center py-2 rounded-lg ${k === 'base' ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                                  <div className="text-[10px] text-gray-500">{labels[k]}</div>
                                  <div className={`text-sm font-bold ${k === 'base' ? 'text-blue-700' : 'text-gray-700'}`}>{tp[k]}元</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {selectedReport.sections.actionAdvice.entryStrategy && (
                          <p className="text-xs text-green-700 bg-green-50 px-2 py-1.5 rounded">{selectedReport.sections.actionAdvice.entryStrategy}</p>
                        )}
                        {selectedReport.sections.actionAdvice.exitStrategy && (
                          <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded">{selectedReport.sections.actionAdvice.exitStrategy}</p>
                        )}
                      </div>
                    </Section>
                  )}

                  {/* 洞察 */}
                  {selectedReport.sections.rawInsights && selectedReport.sections.rawInsights.length > 0 && (
                    <Section icon={<ShieldAlert className="w-4 h-4 text-orange-500" />} title={`分析洞察 (${selectedReport.sections.rawInsights.length})`}>
                      <div className="space-y-1.5">
                        {selectedReport.sections.rawInsights.slice(0, 5).map((insight, i) => (
                          <div key={i} className={`text-xs px-2 py-1.5 rounded ${
                            insight.type === 'risk' ? 'bg-orange-50 text-orange-700' :
                            insight.type === 'opportunity' ? 'bg-blue-50 text-blue-700' :
                            'bg-gray-50 text-gray-600'
                          }`}>
                            <span className="font-medium">{insight.title}</span>
                            {insight.description && <span className="text-gray-500 ml-1">{insight.description}</span>}
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* 时间 */}
                  <div className="pt-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(selectedReport.timestamp).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            )}

            {/* 预测记录详情 */}
            {activeTab === 'prediction' && selectedPath && (() => {
              const rec = records.find((r) => r.path === selectedPath);
              if (!rec) return null;
              return (
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">{rec.stockName} ({rec.stockCode})</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">预测日期</span>
                      <span className="text-sm text-gray-700">{rec.predictDate}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">预测结果</span>
                      <span className={`text-sm font-bold ${rec.prediction === '涨' ? 'text-red-600' : rec.prediction === '跌' ? 'text-green-600' : 'text-gray-600'}`}>
                        {rec.prediction === '涨' ? '上涨' : rec.prediction === '跌' ? '下跌' : '平盘'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">置信度</span>
                      <span className="text-sm font-medium text-gray-700">{rec.confidence}%</span>
                    </div>
                    {rec.verified ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">实际结果</span>
                          <span className={`text-sm font-bold ${rec.actualResult === '涨' ? 'text-red-600' : rec.actualResult === '跌' ? 'text-green-600' : 'text-gray-600'}`}>
                            {rec.actualResult === '涨' ? '上涨' : rec.actualResult === '跌' ? '下跌' : '平盘'} {rec.actualChangePercent}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">是否命中</span>
                          <span className={`text-sm font-bold ${rec.prediction === rec.actualResult ? 'text-green-600' : 'text-red-600'}`}>
                            {rec.prediction === rec.actualResult ? '✓ 命中' : '✗ 未命中'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">验证状态</span>
                        <span className="text-sm text-amber-500">待收盘验证</span>
                      </div>
                    )}
                    {rec.factorScores && (
                      <div className="pt-2 border-t border-gray-100">
                        <div className="text-xs font-medium text-gray-500 mb-2">因子评分</div>
                        <div className="space-y-1.5">
                          {[
                            { label: '趋势', value: rec.factorScores.trend, color: 'bg-blue-400' },
                            { label: '动量', value: rec.factorScores.momentum, color: 'bg-orange-400' },
                            { label: '量能', value: rec.factorScores.volume, color: 'bg-purple-400' },
                            { label: '技术', value: rec.factorScores.technical, color: 'bg-cyan-400' },
                          ].map((f) => (
                            <div key={f.label} className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 w-8">{f.label}</span>
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${f.color}`} style={{ width: `${f.value}%` }} />
                              </div>
                              <span className={`text-[10px] w-6 text-right ${f.value >= 50 ? 'text-red-500' : 'text-green-500'}`}>{f.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 空状态 */}
            {!detailLoading && !selectedSearch && !selectedReport && activeTab !== 'prediction' && (
              <div className="text-center py-12 text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">点击左侧记录查看详情</p>
              </div>
            )}
            {activeTab === 'prediction' && !selectedPath && (
              <div className="text-center py-12 text-gray-400">
                <Brain className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">点击左侧预测记录查看详情</p>
              </div>
            )}

            {detailLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-gray-700">{title}</span>
      </div>
      {children}
    </div>
  );
}

function MetricGroup({ label, metrics }: { label: string; metrics: Array<{ label: string; value: string | number; unit?: string }> }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {metrics.filter(m => m.value !== '-').map((m, i) => (
          <div key={i} className="bg-gray-50 rounded px-2 py-1">
            <div className="text-[10px] text-gray-400">{m.label}</div>
            <div className="text-xs font-medium text-gray-800">{m.value}{m.unit ? <span className="text-gray-400 text-[10px] ml-0.5">{m.unit}</span> : null}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const config: Record<string, { text: string; cls: string }> = {
    positive: { text: '情绪偏正面', cls: 'bg-red-50 text-red-600' },
    negative: { text: '情绪偏负面', cls: 'bg-green-50 text-green-600' },
    neutral: { text: '情绪中性', cls: 'bg-gray-50 text-gray-500' },
  };
  const c = config[sentiment] || config.neutral;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.cls}`}>{c.text}</span>;
}
