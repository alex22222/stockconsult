import { ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react';
import type { Insight } from '../../core/types/skill';
import type { AnalysisReport } from '../../core/types/analysis';
import { useAppStore } from '../store/app-store';
import { RatingBadge } from '../components/common/RatingBadge';
import { MetricCard } from '../components/common/MetricCard';
import { InsightTag } from '../components/common/InsightTag';
import { PriceChart } from '../components/charts/PriceChart';

export function DashboardPage() {
  const { report, dataBundle, loadingState, errorMessage, selectedStock, clearResults, analyzeStock } = useAppStore();

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
          <button onClick={handleBack} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50">
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

  return (
    <div className="flex-1 bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 sticky top-14 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={handleBack} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-900">{stock.name}</span>
                <span className="text-xs text-gray-400 font-mono">{stock.code}</span>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{stock.exchange}</span>
              </div>
              <div className="text-xs text-gray-500">{stock.industry} · {(stock.marketCap / 10000).toFixed(2)}万亿市值</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RatingBadge rating={coreView.rating} size="sm" />
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* 核心观点 */}
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">核心观点</h3>
            <RatingBadge rating={coreView.rating} />
          </div>
          <div className="p-6">
            <p className="text-lg font-medium text-gray-900 mb-4">{coreView.oneSentenceSummary}</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <div className="text-xs font-medium text-green-700 mb-1">乐观情景</div>
                <div className="text-sm text-green-800 leading-relaxed">{coreView.bullCase}</div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <div className="text-xs font-medium text-red-700 mb-1">悲观情景</div>
                <div className="text-sm text-red-800 leading-relaxed">{coreView.bearCase}</div>
              </div>
            </div>

            <div className="text-sm text-gray-600 leading-relaxed">{coreView.investmentThesis}</div>

            <div className="flex flex-wrap gap-2 mt-4">
              {coreView.keyDrivers.map((driver: string, i: number) => (
                <span key={i} className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg font-medium">
                  {driver}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 价格走势 */}
        {dataBundle?.market?.history && (
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">价格走势</h3>
              <span className="text-xs text-gray-400">近60日</span>
            </div>
            <div className="p-4">
              <PriceChart data={dataBundle.market.history} />
            </div>
          </section>
        )}

        {/* 关键指标 */}
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
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
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
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
                {marketInterpretation.recentEvents.slice(0, 6).map((event: AnalysisReport['marketInterpretation']['recentEvents'][0], i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      event.impact === 'positive' ? 'bg-red-400' :
                      event.impact === 'negative' ? 'bg-green-400' :
                      'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-900">{event.title}</span>
                        <span className="text-[10px] text-gray-400">{event.date}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 行业背景 */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-500 mb-2">{marketInterpretation.industryContext.industryName}行业</div>
              <div className="text-sm text-gray-700 space-y-1">
                <p>{marketInterpretation.industryContext.industryTrend}</p>
                <p>{marketInterpretation.industryContext.competitivePosition}</p>
                {marketInterpretation.industryContext.policyImpact && (
                  <p className="text-gray-500">{marketInterpretation.industryContext.policyImpact}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 行动建议 */}
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">行动建议</h3>
            <RatingBadge rating={actionAdvice.recommendation} />
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* 目标价 */}
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

            {actionAdvice.stopLoss && (
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
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
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
    </div>
  );
}
