import type { StockDataBundle, StockInfo } from './types/stock';
import type { SkillResult, Insight, PipelineExecutionResult } from './types/skill';
import type { AnalysisReport } from './types/analysis';

/**
 * 报告生成器
 * 将Pipeline执行结果和原始数据整合为结构化的四大模块分析报告
 */
export class ReportGenerator {
  /**
   * 生成完整分析报告
   */
  static generate(
    stock: StockInfo,
    dataBundle: StockDataBundle,
    pipelineResult: PipelineExecutionResult
  ): AnalysisReport {
    const skillResults = pipelineResult.results;
    const allInsights = this.collectInsights(skillResults);
    
    const report: AnalysisReport = {
      stock,
      generatedAt: new Date().toISOString(),
      dataDate: dataBundle.fetchedAt,
      
      coreView: this.generateCoreView(stock, dataBundle, skillResults, allInsights),
      keyMetrics: this.generateKeyMetrics(stock, dataBundle, skillResults),
      marketInterpretation: this.generateMarketInterpretation(stock, dataBundle, skillResults, allInsights),
      actionAdvice: this.generateActionAdvice(stock, dataBundle, skillResults, allInsights),
      
      skillResults,
      rawInsights: allInsights,
      
      overallConfidence: this.calcOverallConfidence(skillResults),
      riskLevel: this.assessRiskLevel(allInsights),
      riskWarnings: this.collectRiskWarnings(allInsights),
      disclaimers: [
        '本报告基于公开数据和算法模型自动生成，仅供参考，不构成投资建议。',
        '投资有风险，入市需谨慎。请结合自身风险承受能力做出独立判断。',
      ],
    };

    return report;
  }

  // ========== 模块1: 核心观点 ==========
  private static generateCoreView(
    stock: StockInfo,
    dataBundle: StockDataBundle,
    skillResults: SkillResult[],
    insights: Insight[]
  ): AnalysisReport['coreView'] {
    const market = dataBundle.market;
    const financial = dataBundle.financial;
    const annResult = skillResults.find(r => r.skillId === 'announcement-analyzer');
    const finResult = skillResults.find(r => r.skillId === 'financial-analyzer');
    const valResult = skillResults.find(r => r.skillId === 'valuation-framework');

    // 综合评级
    const rating = this.determineRating(valResult, finResult, insights);
    
    // 驱动因素
    const keyDrivers = this.extractKeyDrivers(stock, market, financial, finResult, valResult, insights);

    // 投资逻辑
    const investmentThesis = this.generateThesis(stock, market, financial, finResult, valResult, annResult);

    // 乐观/悲观情景
    const { bullCase, bearCase } = this.generateScenarios(stock, market, financial, valResult);

    return {
      rating,
      ratingLabel: this.ratingToLabel(rating),
      oneSentenceSummary: this.generateOneSentence(stock, market, financial, rating, insights),
      keyDrivers,
      bullCase,
      bearCase,
      investmentThesis,
    };
  }

  // ========== 模块2: 关键指标 ==========
  private static generateKeyMetrics(
    stock: StockInfo,
    dataBundle: StockDataBundle,
    skillResults: SkillResult[]
  ): AnalysisReport['keyMetrics'] {
    const market = dataBundle.market;
    const financial = dataBundle.financial;
    const valResult = skillResults.find(r => r.skillId === 'valuation-framework');
    const finResult = skillResults.find(r => r.skillId === 'financial-analyzer');

    const valData = valResult?.data as any || {};
    const finData = finResult?.data as any || {};

    return {
      valuation: [
        { name: 'pe', label: '市盈率(PE)', value: market.pe, unit: '倍', trend: valData.pePercentile > 70 ? 'up' : valData.pePercentile < 30 ? 'down' : 'flat', category: 'valuation', benchmark: `行业均值${valData.peVsIndustry > 0 ? '+' : ''}${valData.peVsIndustry}%`, percentile: valData.pePercentile },
        { name: 'pb', label: '市净率(PB)', value: market.pb, unit: '倍', trend: valData.pbPercentile > 70 ? 'up' : valData.pbPercentile < 30 ? 'down' : 'flat', category: 'valuation', benchmark: `行业均值${valData.pbVsIndustry > 0 ? '+' : ''}${valData.pbVsIndustry}%`, percentile: valData.pbPercentile },
        { name: 'ps', label: '市销率(PS)', value: market.ps || '-', unit: market.ps ? '倍' : '', category: 'valuation' },
        { name: 'marketCap', label: '总市值', value: (stock.marketCap / 10000).toFixed(2), unit: '万亿', category: 'valuation' },
      ],
      profitability: [
        { name: 'roe', label: '净资产收益率(ROE)', value: financial.roe, unit: '%', category: 'profitability', benchmark: financial.roe > 15 ? '优秀' : financial.roe > 8 ? '良好' : '一般' },
        { name: 'grossMargin', label: '毛利率', value: financial.grossMargin, unit: '%', category: 'profitability' },
        { name: 'netMargin', label: '净利率', value: financial.netMargin, unit: '%', category: 'profitability' },
        { name: 'roa', label: '总资产收益率(ROA)', value: financial.roa || '-', unit: financial.roa ? '%' : '', category: 'profitability' },
      ],
      growth: [
        { name: 'revenueYoY', label: '营收增速', value: finData.revenue?.yoy || '-', unit: '%', trend: finData.revenue?.yoy > 10 ? 'up' : finData.revenue?.yoy < 0 ? 'down' : 'flat', category: 'growth' },
        { name: 'profitYoY', label: '净利润增速', value: finData.netProfit?.yoy || '-', unit: '%', trend: finData.netProfit?.yoy > 15 ? 'up' : finData.netProfit?.yoy < 0 ? 'down' : 'flat', category: 'growth' },
      ],
      quality: [
        { name: 'debtRatio', label: '资产负债率', value: financial.debtRatio, unit: '%', category: 'quality', benchmark: financial.debtRatio < 40 ? '稳健' : financial.debtRatio < 70 ? '中等' : '偏高' },
        { name: 'operatingCF', label: '经营现金流', value: financial.periods[financial.periods.length - 1].operatingCashFlow, unit: '亿', category: 'quality' },
        { name: 'currentRatio', label: '流动比率', value: financial.currentRatio || '-', unit: financial.currentRatio ? '倍' : '', category: 'quality' },
      ],
      market: [
        { name: 'price', label: '最新价', value: market.price, unit: '元', trend: market.change >= 0 ? 'up' : 'down', category: 'market', change: market.change, changePercent: market.changePercent },
        { name: 'turnoverRate', label: '换手率', value: market.turnoverRate || '-', unit: market.turnoverRate ? '%' : '', category: 'market' },
        { name: 'amplitude', label: '振幅', value: market.amplitude || '-', unit: market.amplitude ? '%' : '', category: 'market' },
      ],
    };
  }

  // ========== 模块3: 市场解读 ==========
  private static generateMarketInterpretation(
    stock: StockInfo,
    dataBundle: StockDataBundle,
    skillResults: SkillResult[],
    _insights: Insight[]
  ): AnalysisReport['marketInterpretation'] {
    const annResult = skillResults.find(r => r.skillId === 'announcement-analyzer');
    const annData = annResult?.data as any || {};
    const marketPrice = dataBundle.market?.price || 100;

    // 近期事件
    const recentEvents = (annData.recentAnnouncements || []).map((a: any) => ({
      date: a.date,
      title: a.title,
      type: 'announcement' as const,
      impact: a.sentiment,
      description: a.title,
    }));

    // 情感分析
    const sentimentStats = annData.sentimentStats || { positive: 0, neutral: 0, negative: 0, total: 0 };
    const total = sentimentStats.total || 1;
    const sentimentScore = (sentimentStats.positive - sentimentStats.negative) / total;
    const overallSentiment = sentimentScore > 0.2 ? 'positive' as const : sentimentScore < -0.2 ? 'negative' as const : 'neutral' as const;

    return {
      recentEvents,
      sentimentAnalysis: {
        overall: overallSentiment,
        score: Number(sentimentScore.toFixed(2)),
        summary: this.generateSentimentSummary(sentimentStats, total),
      },
      institutionalViews: {
        consensusRating: 'hold' as const,
        targetPriceRange: [marketPrice * 0.85, marketPrice * 1.15],
        reportCount: 0,
        latestReports: [],
      },
      industryContext: {
        industryName: stock.industry,
        industryTrend: `${stock.industry}行业整体景气度中性，需关注政策变化与竞争格局`,
        competitivePosition: `${stock.name}在${stock.industry}行业中处于领先地位，具备品牌与规模优势`,
        policyImpact: '关注行业监管政策变化对估值的影响',
      },
    };
  }

  // ========== 模块4: 行动建议 ==========
  private static generateActionAdvice(
    _stock: StockInfo,
    dataBundle: StockDataBundle,
    skillResults: SkillResult[],
    insights: Insight[]
  ): AnalysisReport['actionAdvice'] {
    const valResult = skillResults.find(r => r.skillId === 'valuation-framework');
    const valData = valResult?.data as any || {};
    const market = dataBundle.market;

    const rating = this.mapValuationToRating(valData.compositeRating);
    const currentPrice = market.price;

    return {
      recommendation: rating,
      recommendationLabel: this.ratingToLabel(rating),
      timeHorizon: 'medium',
      entryStrategy: rating === 'strong_buy' || rating === 'buy' 
        ? `可在${(currentPrice * 0.95).toFixed(0)}元附近分批建仓` 
        : `建议观望，等待更明确信号`,
      exitStrategy: rating === 'sell' || rating === 'reduce'
        ? `建议逢反弹减仓`
        : `持有为主，达到目标价位可考虑部分止盈`,
      stopLoss: Number((currentPrice * 0.88).toFixed(0)),
      targetPrices: {
        conservative: Number((currentPrice * 1.08).toFixed(0)),
        base: Number((currentPrice * 1.18).toFixed(0)),
        optimistic: Number((currentPrice * 1.35).toFixed(0)),
      },
      positionAdvice: this.generatePositionAdvice(rating),
      keyMonitoringPoints: [
        '季度财报业绩是否超预期',
        '行业政策变化与竞争格局',
        '大股东增减持动向',
        '估值水平是否持续扩张',
      ],
      riskReminders: this.collectRiskWarnings(insights).slice(0, 3),
    };
  }

  // ========== 辅助方法 ==========

  private static collectInsights(skillResults: SkillResult[]): Insight[] {
    return skillResults
      .filter(r => r.status === 'success')
      .flatMap(r => r.insights);
  }

  private static calcOverallConfidence(skillResults: SkillResult[]): number {
    const successResults = skillResults.filter(r => r.status === 'success');
    if (successResults.length === 0) return 0;
    const avgConfidence = successResults.flatMap(r => r.insights).reduce((sum, i) => sum + (i.confidence || 0.5), 0) 
      / Math.max(successResults.flatMap(r => r.insights).length, 1);
    return Number(avgConfidence.toFixed(2));
  }

  private static assessRiskLevel(insights: Insight[]): AnalysisReport['riskLevel'] {
    const riskCount = insights.filter((i: Insight) => i.type === 'risk').length;
    const oppCount = insights.filter((i: Insight) => i.type === 'opportunity').length;
    if (riskCount > oppCount + 2) return 'high';
    if (riskCount > oppCount) return 'medium';
    return 'low';
  }

  private static collectRiskWarnings(insights: Insight[]): string[] {
    return insights
      .filter(i => i.type === 'risk')
      .map(i => i.title + (i.description ? `：${i.description}` : ''));
  }

  private static determineRating(valResult?: SkillResult, finResult?: SkillResult, _insights?: Insight[]): AnalysisReport['coreView']['rating'] {
    const valData = valResult?.data as any;
    if (!valData) return 'hold';
    
    const finData = finResult?.data as any;
    const profitYoY = finData?.netProfit?.yoy || 0;
    
    if (valData.compositeRating === 'undervalued' && profitYoY > 15) return 'buy';
    if (valData.compositeRating === 'undervalued' && profitYoY > 0) return 'buy';
    if (valData.compositeRating === 'overvalued' && profitYoY < 0) return 'sell';
    if (valData.compositeRating === 'overvalued') return 'reduce';
    return 'hold';
  }

  private static ratingToLabel(rating: AnalysisReport['coreView']['rating']): string {
    const map: Record<string, string> = {
      strong_buy: '强烈买入',
      buy: '买入',
      hold: '持有',
      reduce: '减持',
      sell: '卖出',
    };
    return map[rating] || '观望';
  }

  private static mapValuationToRating(val: string): AnalysisReport['actionAdvice']['recommendation'] {
    switch (val) {
      case 'undervalued': return 'buy';
      case 'overvalued': return 'reduce';
      default: return 'hold';
    }
  }

  private static extractKeyDrivers(stock: StockInfo, _market: any, financial: any, finResult?: SkillResult, valResult?: SkillResult, _insights?: Insight[]): string[] {
    const drivers: string[] = [];
    const finData = finResult?.data as any;
    const valData = valResult?.data as any;

    if (finData?.revenue?.yoy > 15) drivers.push(`营收保持${finData.revenue.yoy}%高速增长`);
    if (finData?.netProfit?.yoy > 20) drivers.push(`净利润同比增长${finData.netProfit.yoy}%`);
    if (financial.roe > 15) drivers.push(`ROE高达${financial.roe}%，盈利能力强`);
    if (financial.grossMargin > 40) drivers.push(`毛利率${financial.grossMargin}%，具备定价权`);
    if (valData?.pePercentile < 30) drivers.push('估值处于历史低位');
    if (valData?.dcfUpside > 20) drivers.push(`DCF模型显示${valData.dcfUpside}%上行空间`);
    
    if (drivers.length < 3) {
      drivers.push(`${stock.name}在${stock.industry}行业具备龙头地位`);
      drivers.push(`总市值${(stock.marketCap / 10000).toFixed(2)}万亿，流动性充裕`);
    }

    return drivers.slice(0, 5);
  }

  private static generateThesis(stock: StockInfo, _market: any, financial: any, finResult?: SkillResult, valResult?: SkillResult, _annResult?: SkillResult): string {
    const parts: string[] = [];
    const finData = finResult?.data as any;
    const valData = valResult?.data as any;

    parts.push(`${stock.name}（${stock.code}）是${stock.industry}行业的代表性企业。`);
    
    if (finData?.revenue?.yoy > 0) {
      parts.push(`公司营收保持增长，最新季度同比增长${finData.revenue.yoy}%。`);
    }
    
    if (financial.roe > 15) {
      parts.push(`ROE维持在${financial.roe}%的较高水平，股东回报能力突出。`);
    }

    if (valData?.compositeRating) {
      parts.push(`当前估值${valData.compositeBand}，PE位于历史${valData.pePercentile}%分位。`);
    }

    return parts.join('');
  }

  private static generateScenarios(_stock: StockInfo, market: any, _financial: any, valResult?: SkillResult): { bullCase: string; bearCase: string } {
    const valData = valResult?.data as any;
    const currentPrice = market.price;
    
    const bullTarget = valData?.dcfImpliedPrice 
      ? Math.max(valData.dcfImpliedPrice, currentPrice * 1.25) 
      : currentPrice * 1.3;
    
    const bearTarget = currentPrice * 0.75;

    return {
      bullCase: `乐观情景：业绩持续超预期，估值修复至历史中高位，目标价${bullTarget.toFixed(0)}元，较当前有${((bullTarget - currentPrice) / currentPrice * 100).toFixed(0)}%上行空间。`,
      bearCase: `悲观情景：宏观环境恶化或行业竞争加剧，业绩不及预期，股价可能下探${bearTarget.toFixed(0)}元附近。`,
    };
  }

  private static generateOneSentence(stock: StockInfo, _market: any, financial: any, rating: AnalysisReport['coreView']['rating'], _insights: Insight[]): string {
    const riskCount = _insights.filter((i: Insight) => i.type === 'risk').length;
    const oppCount = _insights.filter((i: Insight) => i.type === 'opportunity').length;
    
    let sentiment = '中性';
    if (oppCount > riskCount + 1) sentiment = '偏乐观';
    else if (riskCount > oppCount + 1) sentiment = '偏谨慎';

    const label = this.ratingToLabel(rating);
    return `${stock.name}当前基本面${sentiment}，估值${financial.roe > 15 ? '合理' : '待观察'}，综合评级「${label}」。`;
  }

  private static generateSentimentSummary(stats: any, total: number): string {
    if (total === 0) return '近期无公告数据';
    const pos = Math.round((stats.positive / total) * 100);
    const neg = Math.round((stats.negative / total) * 100);
    return `近${total}条公告中，正面${pos}%、负面${neg}%，整体情绪${pos > neg ? '偏正面' : pos < neg ? '偏负面' : '中性'}。`;
  }

  private static generatePositionAdvice(rating: AnalysisReport['actionAdvice']['recommendation']): string {
    switch (rating) {
      case 'strong_buy': return '可配置核心仓位（建议不超过总资产的15%）';
      case 'buy': return '可适度配置（建议占总资产的5-10%）';
      case 'hold': return '维持现有仓位，暂不增减';
      case 'reduce': return '建议减仓至轻仓或清仓';
      case 'sell': return '建议择机清仓';
    }
  }
}
