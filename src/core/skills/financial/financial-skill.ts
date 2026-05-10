import { BaseSkill } from '../base-skill';
import type { SkillConfig, SkillResult, PipelineContext, Insight } from '../../types/skill';
import type { FinancialPeriod, FinancialMetrics } from '../../types/stock';

/**
 * 财报分析 Skill
 * 分析财务报表，进行趋势分析、同比环比、杜邦分析、现金流健康度评估
 */
export class FinancialSkill extends BaseSkill {
  constructor(config?: Partial<SkillConfig>) {
    super({
      id: 'financial-analyzer',
      name: '财报分析',
      version: '1.0.0',
      enabled: true,
      dependencies: [],
      parallel: true,
      config: config?.config || {},
    });
  }

  async execute(context: PipelineContext): Promise<SkillResult> {
    try {
      const financial = context.dataBundle.financial;
      const periods = financial.periods;
      const hasMultiPeriods = periods && periods.length >= 2;
      
      // 优先使用多期数据，否则使用成长能力API返回的单期增长率
      const latest = periods?.[periods.length - 1] || {
        period: new Date().toISOString().split('T')[0],
        revenue: 0, netProfit: 0, grossProfit: 0,
        totalAssets: 0, totalLiabilities: 0, shareholdersEquity: 0,
        operatingCashFlow: 0, freeCashFlow: 0,
      };
      const previous = hasMultiPeriods ? periods[periods.length - 2] : undefined;
      const yearAgo = hasMultiPeriods ? (periods[periods.length - 5] || periods[0]) : undefined;

      // 多维度分析
      const growthAnalysis = this.analyzeGrowth(periods, latest, previous, yearAgo, financial);
      const profitabilityAnalysis = this.analyzeProfitability(financial, periods);
      const qualityAnalysis = this.analyzeQuality(financial, periods);
      const trendAnalysis = hasMultiPeriods ? this.analyzeTrend(periods) : { insights: [], trend: 'unknown' as const };

      const insights: Insight[] = [
        ...growthAnalysis.insights,
        ...profitabilityAnalysis.insights,
        ...qualityAnalysis.insights,
        ...trendAnalysis.insights,
      ];

      const summary = this.generateSummary(growthAnalysis, profitabilityAnalysis, qualityAnalysis);

      return this.createSuccess(
        {
          latestPeriod: latest.period,
          revenue: {
            latest: latest.revenue,
            qoq: growthAnalysis.revenueQoQ,
            yoy: growthAnalysis.revenueYoY,
          },
          netProfit: {
            latest: latest.netProfit,
            qoq: growthAnalysis.profitQoQ,
            yoy: growthAnalysis.profitYoY,
          },
          margins: {
            gross: financial.grossMargin,
            net: financial.netMargin,
            roe: financial.roe,
          },
          quality: {
            debtRatio: financial.debtRatio,
            operatingCashFlow: latest.operatingCashFlow,
            freeCashFlow: latest.freeCashFlow,
          },
          trend: trendAnalysis.trend,
        },
        insights,
        summary
      );
    } catch (error) {
      return this.createFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private analyzeGrowth(_periods: FinancialPeriod[], latest: FinancialPeriod, previous?: FinancialPeriod, yearAgo?: FinancialPeriod, financial?: any) {
    // 优先从成长能力API获取增长率，其次从多期数据计算
    const revenueYoY = financial?.revenueGrowth ?? (yearAgo ? this.calcYoY(latest.revenue, yearAgo.revenue) : 0);
    const profitYoY = financial?.profitGrowth ?? (yearAgo ? this.calcYoY(latest.netProfit, yearAgo.netProfit) : 0);
    const revenueQoQ = previous ? this.calcQoQ(latest.revenue, previous.revenue) : 0;
    const profitQoQ = previous ? this.calcQoQ(latest.netProfit, previous.netProfit) : 0;

    const insights: Insight[] = [];

    // 营收增长
    if (revenueYoY > 20) {
      insights.push({
        type: 'opportunity',
        title: '营收高速增长',
        description: `营收同比增长${revenueYoY}%，处于高速增长通道`,
        confidence: 0.85,
        source: 'financial-analyzer',
        metric: 'revenue_yoy',
        value: `${revenueYoY}%`,
      });
    } else if (revenueYoY < 0) {
      insights.push({
        type: 'risk',
        title: '营收同比下滑',
        description: `营收同比${revenueYoY}%，需关注业务增长压力`,
        confidence: 0.8,
        source: 'financial-analyzer',
        metric: 'revenue_yoy',
        value: `${revenueYoY}%`,
      });
    }

    // 利润增长
    if (profitYoY > 30) {
      insights.push({
        type: 'opportunity',
        title: '利润增速强劲',
        description: `净利润同比增长${profitYoY}%，盈利能力显著提升`,
        confidence: 0.85,
        source: 'financial-analyzer',
        metric: 'profit_yoy',
        value: `${profitYoY}%`,
      });
    } else if (profitYoY < -10) {
      insights.push({
        type: 'risk',
        title: '利润明显下滑',
        description: `净利润同比${profitYoY}%，盈利能力承压`,
        confidence: 0.8,
        source: 'financial-analyzer',
        metric: 'profit_yoy',
        value: `${profitYoY}%`,
      });
    }

    return { revenueQoQ, profitQoQ, revenueYoY, profitYoY, insights };
  }

  private analyzeProfitability(financial: FinancialMetrics, _periods: FinancialPeriod[]) {
    const insights: Insight[] = [];

    // ROE分析
    if (financial.roe > 20) {
      insights.push({
        type: 'opportunity',
        title: 'ROE表现优异',
        description: `ROE为${financial.roe}%，高于20%优秀线，股东回报能力强`,
        confidence: 0.9,
        source: 'financial-analyzer',
        metric: 'roe',
        value: `${financial.roe}%`,
      });
    } else if (financial.roe < 8) {
      insights.push({
        type: 'risk',
        title: 'ROE偏低',
        description: `ROE为${financial.roe}%，股东回报效率不足`,
        confidence: 0.75,
        source: 'financial-analyzer',
        metric: 'roe',
        value: `${financial.roe}%`,
      });
    }

    // 毛利率
    if (financial.grossMargin > 40) {
      insights.push({
        type: 'opportunity',
        title: '高毛利率护城河',
        description: `毛利率${financial.grossMargin}%，具备较强定价权和竞争优势`,
        confidence: 0.85,
        source: 'financial-analyzer',
        metric: 'gross_margin',
        value: `${financial.grossMargin}%`,
      });
    }

    return { insights };
  }

  private analyzeQuality(financial: FinancialMetrics, _periods: FinancialPeriod[]) {
    const insights: Insight[] = [];
    const latest = _periods[_periods.length - 1];

    // 负债率
    if (financial.debtRatio > 70) {
      insights.push({
        type: 'risk',
        title: '负债率偏高',
        description: `资产负债率${financial.debtRatio}%，财务杠杆较高`,
        confidence: 0.8,
        source: 'financial-analyzer',
        metric: 'debt_ratio',
        value: `${financial.debtRatio}%`,
      });
    } else if (financial.debtRatio < 30) {
      insights.push({
        type: 'opportunity',
        title: '财务结构稳健',
        description: `资产负债率仅${financial.debtRatio}%，财务风险低`,
        confidence: 0.8,
        source: 'financial-analyzer',
        metric: 'debt_ratio',
        value: `${financial.debtRatio}%`,
      });
    }

    // 现金流
    if (latest.operatingCashFlow > latest.netProfit * 0.8) {
      insights.push({
        type: 'opportunity',
        title: '现金流健康',
        description: `经营现金流${latest.operatingCashFlow}亿，盈利质量高`,
        confidence: 0.85,
        source: 'financial-analyzer',
        metric: 'operating_cash_flow',
        value: `${latest.operatingCashFlow}亿`,
      });
    }

    return { insights };
  }

  private analyzeTrend(periods: FinancialPeriod[]) {
    const insights: Insight[] = [];
    
    // 计算营收趋势（近4个季度）
    const recent = periods.slice(-4);
    const revenues = recent.map(p => p.revenue);
    const isIncreasing = revenues.every((v, i) => i === 0 || v >= revenues[i - 1] * 0.95);
    const isDecreasing = revenues.every((v, i) => i === 0 || v <= revenues[i - 1] * 1.05);

    if (isIncreasing) {
      insights.push({
        type: 'opportunity',
        title: '营收趋势向好',
        description: '近4个季度营收整体呈上升趋势',
        confidence: 0.8,
        source: 'financial-analyzer',
      });
    } else if (isDecreasing) {
      insights.push({
        type: 'risk',
        title: '营收趋势下行',
        description: '近4个季度营收整体呈下降趋势',
        confidence: 0.75,
        source: 'financial-analyzer',
      });
    }

    return { insights, trend: isIncreasing ? 'up' : isDecreasing ? 'down' : 'fluctuating' };
  }

  private generateSummary(growth: any, _profitability: any, _quality: any): string {
    const parts: string[] = [];
    
    if (growth.revenueYoY > 0) parts.push(`营收同比增长${growth.revenueYoY}%`);
    else parts.push(`营收同比${growth.revenueYoY}%`);
    
    if (growth.profitYoY > 0) parts.push(`净利润增长${growth.profitYoY}%`);
    else parts.push(`净利润${growth.profitYoY}%`);
    
    return parts.join('，') + '。';
  }
}
