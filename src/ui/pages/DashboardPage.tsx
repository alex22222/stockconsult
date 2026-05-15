import { useState } from 'react';
import { ArrowLeft, Download, Loader2, AlertCircle, Newspaper, Building2, TrendingUp, TrendingDown, Minus, ExternalLink, Star, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { Insight } from '../../core/types/skill';
import type { AnalysisReport } from '../../core/types/analysis';
import type { NewsItem, ResearchReport } from '../../core/types/stock';
import { useAppStore } from '../store/app-store';
import { RatingBadge } from '../components/common/RatingBadge';
import { MetricCard } from '../components/common/MetricCard';
import { InsightTag } from '../components/common/InsightTag';
import { PriceChart } from '../components/charts/PriceChart';
import { TableOfContents } from '../components/common/TableOfContents';
import { AIPredictionPanel } from '../components/AIPredictionPanel';

function RatingLabel({ rating }: { rating: ResearchReport['rating'] }) {
  const config: Record<ResearchReport['rating'], { text: string; class: string }> = {
    buy: { text: '买入', class: 'bg-red-50 text-red-700 border-red-100' },
    overweight: { text: '增持', class: 'bg-orange-50 text-orange-700 border-orange-100' },
    neutral: { text: '中性', class: 'bg-gray-50 text-gray-600 border-gray-200' },
    underweight: { text: '减持', class: 'bg-amber-50 text-amber-700 border-amber-100' },
    sell: { text: '卖出', class: 'bg-green-50 text-green-700 border-green-100' },
  };
  const c = config[rating] || config.neutral;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${c.class} font-medium`}>{c.text}</span>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: 'positive' | 'neutral' | 'negative' }) {
  if (!sentiment) return null;
  const config = {
    positive: { icon: TrendingUp, text: '正面', class: 'bg-red-50 text-red-600' },
    negative: { icon: TrendingDown, text: '负面', class: 'bg-green-50 text-green-600' },
    neutral: { icon: Minus, text: '中性', class: 'bg-gray-50 text-gray-500' },
  };
  const c = config[sentiment];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${c.class}`}>
      <Icon className="w-2.5 h-2.5" />
      {c.text}
    </span>
  );
}

export function DashboardPage() {
  const { report, dataBundle, loadingState, errorMessage, selectedStock, clearResults, analyzeStock, favorites, removeFromFavorites, selectStock } = useAppStore();
  const [favExpanded, setFavExpanded] = useState(true);

  const handleBack = () => {
    clearResults();
  };

  const handleRetry = () => {
    if (selectedStock) {
      analyzeStock(selectedStock.code);
    }
  };

  // 加载中
  if (loadingState === 'analyzing') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <div className="text-lg font-medium text-gray-900 mb-1">正在分析 {selectedStock?.name}...</div>
        <div className="text-sm text-gray-500">数据获取 → 公告解读 → 财报分析 → 估值评估</div>
        <div className="w-64 h-1.5 bg-gray-100 rounded-full mt-6 overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  // 错误
  if (loadingState === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
        <div className="text-lg font-medium text-gray-900 mb-1">分析失败</div>
        <div className="text-sm text-gray-500 max-w-md text-center">{errorMessage}</div>
        <div className="flex gap-3 mt-6">
          <button onClick={handleRetry} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            重试
          </button>
          <button onClick={handleBack} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            返回搜索
          </button>
        </div>
      </div>
    );
  }

  // 无报告
  if (!report) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-gray-400">
        <div>请选择股票开始分析</div>
      </div>
    );
  }

  const { stock, coreView, keyMetrics, marketInterpretation, actionAdvice, rawInsights } = report;
  const news = dataBundle?.news || [];
  const reports = dataBundle?.reports || [];

  // 构建目录项（根据数据是否存在动态显示）
  const tocItems = [
    { id: 'core-view', label: '核心观点' },
    ...(dataBundle?.market?.history && dataBundle.market.history.length > 0 ? [{ id: 'price-chart', label: '价格走势' }] : []),
    { id: 'key-metrics', label: '关键指标' },
    { id: 'market-interpretation', label: '市场解读' },
    ...(reports.length > 0 ? [{ id: 'institutional-views', label: '机构观点' }] : []),
    ...(news.length > 0 ? [{ id: 'related-news', label: '相关新闻' }] : []),
    { id: 'action-advice', label: '行动建议' },
    ...(rawInsights.length > 0 ? [{ id: 'insights', label: '分析洞察' }] : []),
  ];

  return (
    <div className="flex-1 bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 sticky top-14 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button onClick={handleBack} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-gray-900">{stock.name}</span>
                <span className="text-xs text-gray-400 font-mono">{stock.code}</span>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{stock.exchange}</span>
                {/* 最新价格 */}
                {dataBundle?.market?.price != null && dataBundle.market.price > 0 && (
                  <div className="flex items-center gap-2 ml-1">
                    <span className="text-lg font-bold text-gray-900">{dataBundle.market.price.toFixed(2)}</span>
                    <span className={`text-sm font-medium ${dataBundle.market.change >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {dataBundle.market.change >= 0 ? '+' : ''}{dataBundle.market.change.toFixed(2)}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${dataBundle.market.changePercent >= 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                      {dataBundle.market.changePercent >= 0 ? '+' : ''}{dataBundle.market.changePercent.toFixed(2)}%
                    </span>
                    {dataBundle.market.updateTime && (
                      <span className="text-[10px] text-gray-400 ml-1">
                        {dataBundle.market.updateTime.split(' ')[1]?.slice(0, 5)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {stock.industry ? `${stock.industry}` : ''}
                {stock.marketCap > 0 ? ` · ${(stock.marketCap / 10000).toFixed(2)}万亿市值` : ''}
                {dataBundle?.market?.pe && dataBundle.market.pe > 0 ? ` · PE ${dataBundle.market.pe}倍` : ''}
                {dataBundle?.market?.pb && dataBundle.market.pb > 0 ? ` · PB ${dataBundle.market.pb}倍` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <RatingBadge rating={coreView.rating} size="sm" />
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-8">
          {/* 左侧内容 */}
          <div className="flex-1 min-w-0 space-y-6">
        
        {/* 核心观点 */}
        <section id="core-view" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">核心观点</h3>
            <RatingBadge rating={coreView.rating} />
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <div className="text-xs font-medium text-green-700 mb-1">乐观情景</div>
                <div className="text-sm text-green-800 leading-relaxed">{coreView.bullCase}</div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <div className="text-xs font-medium text-red-700 mb-1">悲观情景</div>
                <div className="text-sm text-red-800 leading-relaxed">{coreView.bearCase}</div>
              </div>
            </div>
          </div>
        </section>

        {/* AI 涨跌预测 */}
        {selectedStock && (
          <AIPredictionPanel stockCode={selectedStock.code} stockName={selectedStock.name} />
        )}

        {/* 价格走势 */}
        {dataBundle?.market?.history && dataBundle.market.history.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">价格走势</h3>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {dataBundle.market.high52w && dataBundle.market.high52w > 0 && (
                  <span>52周高: <span className="text-gray-600 font-medium">{dataBundle.market.high52w}</span></span>
                )}
                {dataBundle.market.low52w && dataBundle.market.low52w > 0 && (
                  <span>52周低: <span className="text-gray-600 font-medium">{dataBundle.market.low52w}</span></span>
                )}
                <span>近{dataBundle.market.history.length}日</span>
              </div>
            </div>
            <div className="p-4">
              <PriceChart data={dataBundle.market.history} />
            </div>
          </section>
        )}

        {/* 关键指标 */}
        <section id="key-metrics" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">关键指标</h3>
          </div>
          <div className="p-6 space-y-6">
            {/* 估值 */}
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">估值指标</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {keyMetrics.valuation.map((m: AnalysisReport['keyMetrics']['valuation'][0]) => <MetricCard key={m.name} metric={m} />)}
              </div>
            </div>
            {/* 盈利 */}
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">盈利能力</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {keyMetrics.profitability.map((m: AnalysisReport['keyMetrics']['profitability'][0]) => <MetricCard key={m.name} metric={m} />)}
              </div>
            </div>
            {/* 成长 + 质量 + 市场 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">成长性</div>
                <div className="space-y-3">
                  {keyMetrics.growth.map((m: AnalysisReport['keyMetrics']['growth'][0]) => <MetricCard key={m.name} metric={m} />)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">财务质量</div>
                <div className="space-y-3">
                  {keyMetrics.quality.map((m: AnalysisReport['keyMetrics']['quality'][0]) => <MetricCard key={m.name} metric={m} />)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">市场表现</div>
                <div className="space-y-3">
                  {keyMetrics.market.map((m: AnalysisReport['keyMetrics']['market'][0]) => <MetricCard key={m.name} metric={m} />)}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 市场解读 */}
        <section id="market-interpretation" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">市场解读</h3>
          </div>
          <div className="p-6">
            {/* 情感分析 */}
            <div className="flex items-center gap-3 mb-5">
              <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                marketInterpretation.sentimentAnalysis.overall === 'positive' ? 'bg-red-50 text-red-700' :
                marketInterpretation.sentimentAnalysis.overall === 'negative' ? 'bg-green-50 text-green-700' :
                'bg-gray-50 text-gray-700'
              }`}>
                {marketInterpretation.sentimentAnalysis.overall === 'positive' ? '情绪偏正面' :
                 marketInterpretation.sentimentAnalysis.overall === 'negative' ? '情绪偏负面' : '情绪中性'}
              </div>
              <span className="text-sm text-gray-500">{marketInterpretation.sentimentAnalysis.summary}</span>
            </div>

            {/* 近期事件时间线 */}
            <div className="mb-5">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">近期重要事件</div>
              <div className="space-y-3">
                {marketInterpretation.recentEvents.slice(0, 8).map((event: AnalysisReport['marketInterpretation']['recentEvents'][0], i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      event.impact === 'positive' ? 'bg-red-400' :
                      event.impact === 'negative' ? 'bg-green-400' :
                      'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-900">{event.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          {event.type === 'announcement' ? '公告' :
                           event.type === 'news' ? '新闻' :
                           event.type === 'report' ? '研报' :
                           event.type === 'industry' ? '行业' : '其他'}
                        </span>
                        {event.date && <span className="text-[10px] text-gray-400">{event.date}</span>}
                      </div>
                      {event.description && event.description !== event.title && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{event.description}</div>
                      )}
                    </div>
                  </div>
                ))}
                {marketInterpretation.recentEvents.length === 0 && (
                  <div className="text-sm text-gray-400">暂无近期事件数据</div>
                )}
              </div>
            </div>

            {/* 行业背景 */}
            {stock.industry && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs font-medium text-gray-500 mb-2">
                  {marketInterpretation.industryContext.industryName || stock.industry}
                </div>
                {marketInterpretation.industryContext.industryTrend && (
                  <div className="text-sm text-gray-700">{marketInterpretation.industryContext.industryTrend}</div>
                )}
                {marketInterpretation.industryContext.competitivePosition && (
                  <div className="text-sm text-gray-700">{marketInterpretation.industryContext.competitivePosition}</div>
                )}
                {marketInterpretation.industryContext.policyImpact && (
                  <div className="text-sm text-gray-500">{marketInterpretation.industryContext.policyImpact}</div>
                )}
                {/* 如果 MCP 未提供行业分析数据，展示提示 */}
                {!marketInterpretation.industryContext.industryTrend &&
                 !marketInterpretation.industryContext.competitivePosition &&
                 !marketInterpretation.industryContext.policyImpact && (
                  <div className="text-xs text-gray-400">暂无行业分析数据</div>
                )}
                {stock.mainBusiness && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-[10px] text-gray-400 mb-1">主营业务</div>
                    <div className="text-xs text-gray-600 leading-relaxed">{stock.mainBusiness}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 研报/机构观点 */}
        {reports.length > 0 && (
          <section id="institutional-views" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-500" />
                <h3 className="text-base font-semibold text-gray-900">机构观点</h3>
              </div>
              <span className="text-xs text-gray-400">{reports.length} 篇研报</span>
            </div>
            <div className="p-6">
              {/* 机构评级汇总 */}
              {(marketInterpretation.institutionalViews.consensusRating || marketInterpretation.institutionalViews.targetPriceRange) && (
                <div className="flex items-center gap-4 mb-5 flex-wrap">
                  {marketInterpretation.institutionalViews.consensusRating && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">评级共识:</span>
                      <RatingBadge rating={marketInterpretation.institutionalViews.consensusRating} size="sm" />
                    </div>
                  )}
                  {marketInterpretation.institutionalViews.targetPriceRange && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">目标价区间:</span>
                      <span className="text-sm font-medium text-gray-700">
                        {marketInterpretation.institutionalViews.targetPriceRange[0].toFixed(0)} - {marketInterpretation.institutionalViews.targetPriceRange[1].toFixed(0)} 元
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 最新研报列表 */}
              <div className="space-y-3">
                {marketInterpretation.institutionalViews.latestReports.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-gray-900">{r.institution}</span>
                        <RatingLabel rating={r.rating} />
                        {r.targetPrice && (
                          <span className="text-xs text-blue-600 font-medium">目标价 {r.targetPrice}元</span>
                        )}
                      </div>
                      {r.summary && (
                        <div className="text-xs text-gray-500 line-clamp-2">{r.summary}</div>
                      )}
                      {r.date && (
                        <div className="text-[10px] text-gray-400 mt-1">{r.date}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 相关新闻 */}
        {news.length > 0 && (
          <section id="related-news" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-gray-500" />
                <h3 className="text-base font-semibold text-gray-900">相关新闻</h3>
              </div>
              <span className="text-xs text-gray-400">{news.length} 条</span>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {news.slice(0, 6).map((item: NewsItem, i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-1 h-1 rounded-full bg-gray-300 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-900">{item.title}</span>
                        {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                      </div>
                      {item.content && item.content !== item.title && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.content}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {item.source && (
                          <span className="text-[10px] text-gray-400">{item.source}</span>
                        )}
                        {item.publishDate && (
                          <span className="text-[10px] text-gray-400">{item.publishDate.split(' ')[0]}</span>
                        )}
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-600"
                          >
                            查看 <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 行动建议 */}
        <section id="action-advice" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">行动建议</h3>
            <RatingBadge rating={actionAdvice.recommendation} />
          </div>
          <div className="p-6">
            {/* 目标价（仅当有数据时展示） */}
            {actionAdvice.targetPrices && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-500 mb-1">保守目标</div>
                  <div className="text-xl font-bold text-gray-700">{actionAdvice.targetPrices.conservative}元</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-100">
                  <div className="text-xs text-blue-600 mb-1">基准目标</div>
                  <div className="text-2xl font-bold text-blue-700">{actionAdvice.targetPrices.base}元</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-500 mb-1">乐观目标</div>
                  <div className="text-xl font-bold text-gray-700">{actionAdvice.targetPrices.optimistic}元</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {actionAdvice.entryStrategy && (
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <div className="text-xs font-medium text-green-700 mb-1">买入策略</div>
                  <div className="text-sm text-green-800">{actionAdvice.entryStrategy}</div>
                </div>
              )}
              {actionAdvice.exitStrategy && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <div className="text-xs font-medium text-amber-700 mb-1">卖出/止盈策略</div>
                  <div className="text-sm text-amber-800">{actionAdvice.exitStrategy}</div>
                </div>
              )}
            </div>

            {actionAdvice.stopLoss && actionAdvice.stopLoss > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-gray-500">建议止损位：</span>
                <span className="text-sm font-semibold text-red-600">{actionAdvice.stopLoss}元</span>
              </div>
            )}

            {actionAdvice.positionAdvice && (
              <div className="text-sm text-gray-600 mb-4">
                <span className="font-medium">仓位建议：</span>{actionAdvice.positionAdvice}
              </div>
            )}

            <div className="space-y-3">
              {actionAdvice.keyMonitoringPoints.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">关键跟踪点</div>
                  <div className="flex flex-wrap gap-2">
                    {actionAdvice.keyMonitoringPoints.map((point: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg">
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {actionAdvice.riskReminders.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">风险提示</div>
                  <div className="space-y-1.5">
                    {actionAdvice.riskReminders.map((risk: string, i: number) => (
                      <div key={i} className="text-xs text-orange-600 flex items-start gap-1.5">
                        <span className="mt-0.5">•</span>
                        <span>{risk}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 洞察标签云 */}
        {rawInsights.length > 0 && (
          <section id="insights" className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">分析洞察</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {rawInsights.slice(0, 8).map((insight: Insight, i: number) => (
                  <InsightTag key={i} insight={insight} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 免责声明 */}
        <div className="text-center py-4">
          <div className="text-[10px] text-gray-400 space-y-0.5">
            {report.disclaimers.map((d: string, i: number) => <p key={i}>{d}</p>)}
            <p>生成时间: {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
          </div>
        </div>
          </div>
          {/* 右侧目录导航 */}
          <div className="hidden xl:block w-52 shrink-0 space-y-4">
            <div className="sticky top-24 space-y-4">
              {/* 我的收藏 */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setFavExpanded(!favExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-xs font-semibold text-gray-700">我的收藏</span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                      {favorites.length}/10
                    </span>
                  </div>
                  {favExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>

                {favExpanded && (
                  <div className="border-t border-gray-100">
                    {favorites.length === 0 ? (
                      <div className="px-3 py-4 text-center">
                        <Star className="w-6 h-6 text-gray-200 mx-auto mb-1.5" />
                        <p className="text-[11px] text-gray-400">暂无收藏</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {favorites.map((stock) => (
                          <div key={stock.code} className="group flex items-center gap-1.5 px-2 py-2">
                            <button
                              onClick={() => {
                                selectStock(stock);
                                analyzeStock(stock.code);
                              }}
                              className="flex-1 flex items-center gap-1.5 text-left min-w-0"
                            >
                              <div className="w-5 h-5 rounded bg-blue-50 flex items-center justify-center text-blue-600 text-[10px] font-bold flex-shrink-0">
                                {stock.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-800 truncate">{stock.name}</div>
                                <div className="text-[10px] text-gray-400">{stock.code}</div>
                              </div>
                            </button>
                            <button
                              onClick={() => removeFromFavorites(stock.code)}
                              className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                              title="移除收藏"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <TableOfContents items={tocItems} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
