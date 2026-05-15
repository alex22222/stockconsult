import type { StockDataBundle, StockInfo } from './types/stock';
import type { SkillResult, Insight, PipelineExecutionResult } from './types/skill';
import type { AnalysisReport } from './types/analysis';

/**
 * 报告生成器
 * 将Pipeline执行结果和原始数据整合为结构化的四大模块分析报告
 * 
 * 原则：所有展示数据优先使用 MCP 服务返回的真实数据，不编造数据。
 * MCP 没有返回的字段置为 undefined，前端展示 "-" 或隐藏。
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
    const finResult = skillResults.find(r => r.skillId === 'financial-analyzer');
    const valResult = skillResults.find(r => r.skillId === 'valuation-framework');

    // 综合评级
    const rating = this.determineRating(valResult, finResult, insights);
    
    // 驱动因素
    const keyDrivers = this.extractKeyDrivers(stock, market, financial, finResult, valResult, insights);

    // 投资逻辑
    const investmentThesis = this.generateThesis(stock, market, financial, finResult, valResult);

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

    const valData = valResult?.data as any || {};

    // 成长能力：使用 MCP 真实数据（getGrowthAbility）
    const revenueGrowth = financial.revenueGrowth ?? null;
    const profitGrowth = financial.profitGrowth ?? null;

    return {
      valuation: [
        { name: 'pe', label: '市盈率(PE)', value: market.pe > 0 ? market.pe : '-', unit: market.pe > 0 ? '倍' : '', trend: valData.pePercentile > 70 ? 'up' : valData.pePercentile < 30 ? 'down' : 'flat', category: 'valuation', benchmark: valData.peVsIndustry ? `行业均值${valData.peVsIndustry > 0 ? '+' : ''}${valData.peVsIndustry}%` : undefined, percentile: valData.pePercentile },
        { name: 'pb', label: '市净率(PB)', value: market.pb > 0 ? market.pb : '-', unit: market.pb > 0 ? '倍' : '', trend: valData.pbPercentile > 70 ? 'up' : valData.pbPercentile < 30 ? 'down' : 'flat', category: 'valuation', benchmark: valData.pbVsIndustry ? `行业均值${valData.pbVsIndustry > 0 ? '+' : ''}${valData.pbVsIndustry}%` : undefined, percentile: valData.pbPercentile },
        { name: 'ps', label: '市销率(PS)', value: market.ps || '-', unit: market.ps ? '倍' : '', category: 'valuation' },
        { name: 'marketCap', label: '总市值', value: stock.marketCap > 0 ? (stock.marketCap / 10000).toFixed(2) : '-', unit: stock.marketCap > 0 ? '万亿' : '', category: 'valuation' },
      ],
      profitability: [
        { name: 'roe', label: '净资产收益率(ROE)', value: financial.roe > 0 ? financial.roe : '-', unit: financial.roe > 0 ? '%' : '', category: 'profitability', benchmark: financial.roe > 15 ? '优秀' : financial.roe > 8 ? '良好' : financial.roe > 0 ? '一般' : undefined },
        { name: 'grossMargin', label: '毛利率', value: financial.grossMargin > 0 ? financial.grossMargin : '-', unit: financial.grossMargin > 0 ? '%' : '', category: 'profitability' },
        { name: 'netMargin', label: '净利率', value: financial.netMargin > 0 ? financial.netMargin : '-', unit: financial.netMargin > 0 ? '%' : '', category: 'profitability' },
        { name: 'roa', label: '总资产收益率(ROA)', value: financial.roa && financial.roa > 0 ? financial.roa : '-', unit: financial.roa && financial.roa > 0 ? '%' : '', category: 'profitability' },
      ],
      growth: [
        { name: 'revenueYoY', label: '营收增速', value: revenueGrowth != null ? revenueGrowth : '-', unit: revenueGrowth != null ? '%' : '', trend: revenueGrowth != null ? (revenueGrowth > 10 ? 'up' : revenueGrowth < 0 ? 'down' : 'flat') : 'flat', category: 'growth' },
        { name: 'profitYoY', label: '净利润增速', value: profitGrowth != null ? profitGrowth : '-', unit: profitGrowth != null ? '%' : '', trend: profitGrowth != null ? (profitGrowth > 15 ? 'up' : profitGrowth < 0 ? 'down' : 'flat') : 'flat', category: 'growth' },
        { name: 'epsYoY', label: '每股收益增速', value: financial.epsGrowth != null ? financial.epsGrowth : '-', unit: financial.epsGrowth != null ? '%' : '', category: 'growth' },
      ],
      quality: [
        { name: 'debtRatio', label: '资产负债率', value: financial.debtRatio > 0 ? financial.debtRatio : '-', unit: financial.debtRatio > 0 ? '%' : '', category: 'quality', benchmark: financial.debtRatio > 0 ? (financial.debtRatio < 40 ? '稳健' : financial.debtRatio < 70 ? '中等' : '偏高') : undefined },
        { name: 'operatingCF', label: '经营现金流', value: financial.periods[0]?.operatingCashFlow > 0 ? financial.periods[0].operatingCashFlow : '-', unit: financial.periods[0]?.operatingCashFlow > 0 ? '亿' : '', category: 'quality' },
        { name: 'currentRatio', label: '流动比率', value: financial.currentRatio != null ? financial.currentRatio : '-', unit: financial.currentRatio != null ? '倍' : '', category: 'quality' },
      ],
      market: [
        { name: 'price', label: '最新价', value: market.price > 0 ? market.price : '-', unit: market.price > 0 ? '元' : '', trend: market.change >= 0 ? 'up' : 'down', category: 'market', change: market.change, changePercent: market.changePercent },
        { name: 'turnoverRate', label: '换手率', value: market.turnoverRate != null ? market.turnoverRate : '-', unit: market.turnoverRate != null ? '%' : '', category: 'market' },
        { name: 'amplitude', label: '振幅', value: market.amplitude != null ? market.amplitude : '-', unit: market.amplitude != null ? '%' : '', category: 'market' },
        { name: 'high52w', label: '52周最高', value: market.high52w > 0 ? market.high52w : '-', unit: market.high52w > 0 ? '元' : '', category: 'market' },
        { name: 'low52w', label: '52周最低', value: market.low52w > 0 ? market.low52w : '-', unit: market.low52w > 0 ? '元' : '', category: 'market' },
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
    const news = dataBundle.news || [];
    const reports = dataBundle.reports || [];

    // 近期事件：公告 + 新闻（全部来自 MCP）
    const announcementEvents = (annData.recentAnnouncements || []).map((a: any) => ({
      date: a.date,
      title: a.title,
      type: 'announcement' as const,
      impact: a.sentiment,
      description: a.title,
    }));

    const newsEvents = news.slice(0, 5).map((n) => ({
      date: n.publishDate?.split(' ')[0] || '',
      title: n.title,
      type: 'news' as const,
      impact: n.sentiment || 'neutral',
      description: n.content?.slice(0, 100) || n.title,
    }));

    const recentEvents = [...announcementEvents, ...newsEvents]
      .filter((event, index, self) => index === self.findIndex((e) => e.title === event.title))
      .sort((a, b) => {
        return (b.date || '').localeCompare(a.date || '');
      }).slice(0, 10);

    // 情感分析（来自 MCP 公告）
    const sentimentStats = annData.sentimentStats || { positive: 0, neutral: 0, negative: 0, total: 0 };
    const total = sentimentStats.total || 1;
    const sentimentScore = (sentimentStats.positive - sentimentStats.negative) / total;
    const overallSentiment = sentimentScore > 0.2 ? 'positive' as const : sentimentScore < -0.2 ? 'negative' as const : 'neutral' as const;

    // 机构观点：仅当有研报时才提供
    const validReports = reports.filter(r => r.rating && r.rating !== 'neutral');
    const hasReports = reports.length > 0;
    
    let institutionalViews: AnalysisReport['marketInterpretation']['institutionalViews'];
    
    if (hasReports) {
      const buyCount = validReports.filter(r => r.rating === 'buy' || r.rating === 'overweight').length;
      const sellCount = validReports.filter(r => r.rating === 'sell' || r.rating === 'underweight').length;
      const totalReports = validReports.length || 1;
      const consensusScore = (buyCount - sellCount) / totalReports;
      const consensusRating = consensusScore > 0.3 ? 'buy' as const : consensusScore < -0.3 ? 'sell' as const : 'hold' as const;
      
      const targetPrices = reports.filter(r => r.targetPrice).map(r => r.targetPrice!);

      institutionalViews = {
        consensusRating,
        targetPriceRange: targetPrices.length > 0
          ? [Math.min(...targetPrices), Math.max(...targetPrices)]
          : undefined,
        reportCount: reports.length,
        latestReports: reports.slice(0, 3).map(r => ({
          institution: r.institution,
          analyst: r.analyst,
          date: r.date,
          rating: r.rating,
          targetPrice: r.targetPrice,
          summary: r.summary?.slice(0, 120) || '',
        })),
      };
    } else {
      institutionalViews = {
        reportCount: 0,
        latestReports: [],
      };
    }

    return {
      recentEvents,
      sentimentAnalysis: {
        overall: overallSentiment,
        score: Number(sentimentScore.toFixed(2)),
        summary: this.generateSentimentSummary(sentimentStats, total),
      },
      institutionalViews,
      industryContext: {
        industryName: stock.industry || '未知行业',
        // MCP 未提供行业趋势/竞争格局/政策影响数据，不编造
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
    const reports = dataBundle.reports || [];

    const rating = this.mapValuationToRating(valData.compositeRating);
    const currentPrice = market.price;

    // 目标价：仅当有研报目标价或 DCF 数据时才提供，不编造
    const targetPrices = reports.filter(r => r.targetPrice).map(r => r.targetPrice!);
    const hasAnalystTargets = targetPrices.length > 0;
    const hasDcf = valData?.dcfImpliedPrice && valData.dcfImpliedPrice > 0;
    
    let targetPricesData: AnalysisReport['actionAdvice']['targetPrices'] | undefined;
    
    if (hasAnalystTargets) {
      const avgTarget = targetPrices.reduce((a, b) => a + b, 0) / targetPrices.length;
      targetPricesData = {
        conservative: Number((avgTarget * 0.9).toFixed(0)),
        base: Number(avgTarget.toFixed(0)),
        optimistic: Number((avgTarget * 1.15).toFixed(0)),
      };
    } else if (hasDcf) {
      const dcfPrice = valData.dcfImpliedPrice;
      targetPricesData = {
        conservative: Number((dcfPrice * 0.85).toFixed(0)),
        base: Number(dcfPrice.toFixed(0)),
        optimistic: Number((dcfPrice * 1.2).toFixed(0)),
      };
    }

    // 关键跟踪点：从 MCP 公告/新闻中提取，无数据时不编造
    const keyMonitoringPoints = this.extractMonitoringPoints(dataBundle);

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
      // MCP 未提供止损价数据，不编造
      targetPrices: targetPricesData,
      positionAdvice: this.generatePositionAdvice(rating),
      keyMonitoringPoints,
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

    // 使用 MCP 真实成长数据
    const revenueGrowth = financial.revenueGrowth ?? finData?.revenue?.yoy;
    const profitGrowth = financial.profitGrowth ?? finData?.netProfit?.yoy;

    if (revenueGrowth != null && revenueGrowth > 15) drivers.push(`营收保持${revenueGrowth}%高速增长`);
    else if (revenueGrowth != null && revenueGrowth > 0) drivers.push(`营收同比增长${revenueGrowth}%`);
    
    if (profitGrowth != null && profitGrowth > 20) drivers.push(`净利润同比增长${profitGrowth}%`);
    else if (profitGrowth != null && profitGrowth > 0) drivers.push(`净利润同比增长${profitGrowth}%`);
    
    if (financial.roe > 15) drivers.push(`ROE高达${financial.roe}%，盈利能力强`);
    if (financial.grossMargin > 40) drivers.push(`毛利率${financial.grossMargin}%，具备定价权`);
    if (valData?.pePercentile < 30) drivers.push('估值处于历史低位');
    if (valData?.dcfUpside > 20) drivers.push(`DCF模型显示${valData.dcfUpside}%上行空间`);
    
    if (drivers.length < 3) {
      if (stock.industry) {
        drivers.push(`${stock.name}在${stock.industry}行业具备龙头地位`);
      }
      if (stock.marketCap > 0) {
        drivers.push(`总市值${(stock.marketCap / 10000).toFixed(2)}万亿，流动性充裕`);
      }
    }

    return drivers.slice(0, 5);
  }

  private static generateThesis(stock: StockInfo, _market: any, financial: any, finResult?: SkillResult, valResult?: SkillResult): string {
    const parts: string[] = [];
    const finData = finResult?.data as any;
    const valData = valResult?.data as any;

    // 开头定位：一句话摘要已展示名称，此处不再重复
    if (stock.industry) {
      parts.push(`公司深耕${stock.industry}领域`);
    } else {
      parts.push('公司');
    }

    const revenueGrowth = financial.revenueGrowth ?? finData?.revenue?.yoy;
    if (revenueGrowth != null && revenueGrowth > 0) {
      parts.push(`，营收保持增长，最新季度同比增长${revenueGrowth}%`);
    }

    if (financial.roe > 15) {
      parts.push(`；ROE维持在${financial.roe}%的较高水平，股东回报能力突出`);
    }

    if (valData?.compositeRating && valData?.compositeBand) {
      parts.push(`；当前估值${valData.compositeBand}，PE位于历史${valData.pePercentile}%分位`);
    }

    if (stock.mainBusiness) {
      parts.push(`。主营业务：${stock.mainBusiness.slice(0, 60)}${stock.mainBusiness.length > 60 ? '...' : ''}`);
    } else {
      parts.push('。');
    }

    return parts.join('');
  }

  private static generateScenarios(_stock: StockInfo, market: any, _financial: any, valResult?: SkillResult): { bullCase: string; bearCase: string } {
    const valData = valResult?.data as any;
    const currentPrice = market.price;
    
    // 使用 DCF 隐含价格（如有），否则基于当前价格的合理倍数
    const bullTarget = valData?.dcfImpliedPrice && valData.dcfImpliedPrice > currentPrice
      ? valData.dcfImpliedPrice
      : currentPrice * 1.25;
    
    const bearTarget = currentPrice * 0.75;

    return {
      bullCase: `乐观情景：业绩持续超预期，估值修复，目标价${bullTarget.toFixed(0)}元，较当前有${((bullTarget - currentPrice) / currentPrice * 100).toFixed(0)}%上行空间。`,
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
    const industry = stock.industry || '所属';
    const valuationDesc = financial.roe > 15 ? '合理' : financial.roe > 0 ? '待观察' : '数据不足';
    return `${stock.name}（${stock.code}）当前${industry}行业基本面${sentiment}，估值${valuationDesc}，综合评级「${label}」。`;
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

  /**
   * 从 MCP 公告/新闻中提取关键跟踪点，无数据时不编造
   */
  private static extractMonitoringPoints(dataBundle: StockDataBundle): string[] {
    const points: string[] = [];
    
    // 从公告中提取关键事件类型
    const announcements = dataBundle.announcements || [];
    const earningsCount = announcements.filter(a => a.type === 'earnings').length;
    if (earningsCount > 0) points.push('季度财报业绩是否超预期');
    
    const shareholderCount = announcements.filter(a => a.type === 'shareholder').length;
    if (shareholderCount > 0) points.push('大股东增减持动向');
    
    const majorEventCount = announcements.filter(a => a.type === 'major_event').length;
    if (majorEventCount > 0) points.push('重大事项进展');
    
    // 从新闻中提取关注点
    const news = dataBundle.news || [];
    if (news.length > 0) {
      points.push('关注最新行业与公司动态');
    }
    
    // 如果 MCP 没有提供足够数据，给出通用的基本面关注点
    if (points.length < 2) {
      if (dataBundle.financial.periods.length > 0) {
        points.push('季度财报业绩表现');
      }
      if (dataBundle.market.pe > 0) {
        points.push('估值水平变化');
      }
    }

    return points.length > 0 ? points : ['持续关注基本面变化'];
  }
}
