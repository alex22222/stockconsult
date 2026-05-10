import { BaseSkill } from '../base-skill';
import type { SkillConfig, SkillResult, PipelineContext, Insight } from '../../types/skill';

/**
 * 估值框架 Skill
 * 综合PE/PB分位数、同业对比、简化DCF，给出估值评级
 */
export class ValuationSkill extends BaseSkill {
  constructor(config?: Partial<SkillConfig>) {
    super({
      id: 'valuation-framework',
      name: '估值框架',
      version: '1.0.0',
      enabled: true,
      dependencies: ['financial-analyzer'], // 依赖财报分析结果
      parallel: false,
      config: config?.config || {
        peHistory: [15, 18, 20, 22, 25, 28, 30, 35, 32, 28, 26, 24, 25, 27, 29, 28, 26, 25, 24, 26],
        pbHistory: [4, 5, 6, 7, 8, 9, 8.5, 8, 7.5, 7, 6.5, 6, 6.5, 7, 7.5, 8, 7.5, 7, 6.5, 7],
        industryAvgPE: 22,
        industryAvgPB: 5.5,
        riskFreeRate: 0.03,
        marketRiskPremium: 0.06,
      },
    });
  }

  async execute(context: PipelineContext): Promise<SkillResult> {
    try {
      const market = context.dataBundle.market;
      const financial = context.dataBundle.financial;
      const periods = financial.periods;
      const latestPeriod = periods[periods.length - 1];

      const peHistory = this.getConfig<number[]>('peHistory', []);
      const pbHistory = this.getConfig<number[]>('pbHistory', []);
      const industryAvgPE = this.getConfig<number>('industryAvgPE', 22);
      const industryAvgPB = this.getConfig<number>('industryAvgPB', 5.5);

      // 估值分析
      const peAnalysis = this.analyzePE(market.pe, peHistory, industryAvgPE);
      const pbAnalysis = this.analyzePB(market.pb, pbHistory, industryAvgPB);
      const dcfResult = this.simplifiedDCF(latestPeriod, periods);
      const composite = this.compositeValuation(peAnalysis, pbAnalysis, dcfResult);

      const insights: Insight[] = [
        ...peAnalysis.insights,
        ...pbAnalysis.insights,
        ...dcfResult.insights,
      ];

      const summary = this.generateSummary(peAnalysis, pbAnalysis, composite);

      return this.createSuccess(
        {
          currentPE: market.pe,
          currentPB: market.pb,
          pePercentile: peAnalysis.percentile,
          pbPercentile: pbAnalysis.percentile,
          peVsIndustry: peAnalysis.vsIndustry,
          pbVsIndustry: pbAnalysis.vsIndustry,
          dcfImpliedPrice: dcfResult.impliedPrice,
          dcfUpside: dcfResult.upside,
          compositeRating: composite.rating,
          compositeScore: composite.score,
          valuationBand: composite.band,
        },
        insights,
        summary
      );
    } catch (error) {
      return this.createFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private analyzePE(currentPE: number, history: number[], industryAvg: number) {
    const percentile = this.calcPercentile(currentPE, history);
    const vsIndustry = Number(((currentPE - industryAvg) / industryAvg * 100).toFixed(1));
    
    const insights: Insight[] = [];
    
    if (percentile > 80) {
      insights.push({
        type: 'risk',
        title: 'PE处于历史高位',
        description: `当前PE ${currentPE}倍，位于历史${percentile}%分位，估值偏贵`,
        confidence: 0.8,
        source: 'valuation-framework',
        metric: 'pe_percentile',
        value: `${percentile}%`,
      });
    } else if (percentile < 20) {
      insights.push({
        type: 'opportunity',
        title: 'PE处于历史低位',
        description: `当前PE ${currentPE}倍，位于历史${percentile}%分位，估值具备吸引力`,
        confidence: 0.8,
        source: 'valuation-framework',
        metric: 'pe_percentile',
        value: `${percentile}%`,
      });
    }

    if (vsIndustry > 30) {
      insights.push({
        type: 'risk',
        title: 'PE高于行业均值',
        description: `PE较行业均值${industryAvg}倍溢价${vsIndustry}%`,
        confidence: 0.75,
        source: 'valuation-framework',
        metric: 'pe_vs_industry',
        value: `${vsIndustry}%`,
      });
    }

    return { percentile, vsIndustry, insights };
  }

  private analyzePB(currentPB: number, history: number[], industryAvg: number) {
    const percentile = this.calcPercentile(currentPB, history);
    const vsIndustry = Number(((currentPB - industryAvg) / industryAvg * 100).toFixed(1));
    
    const insights: Insight[] = [];
    
    if (percentile > 80) {
      insights.push({
        type: 'risk',
        title: 'PB处于历史高位',
        description: `当前PB ${currentPB}倍，位于历史${percentile}%分位`,
        confidence: 0.75,
        source: 'valuation-framework',
        metric: 'pb_percentile',
        value: `${percentile}%`,
      });
    } else if (percentile < 20) {
      insights.push({
        type: 'opportunity',
        title: 'PB处于历史低位',
        description: `当前PB ${currentPB}倍，位于历史${percentile}%分位`,
        confidence: 0.75,
        source: 'valuation-framework',
        metric: 'pb_percentile',
        value: `${percentile}%`,
      });
    }

    return { percentile, vsIndustry, insights };
  }

  /**
   * 简化DCF模型
   * 使用2阶段增长模型
   */
  private simplifiedDCF(latest: any, periods: any[]) {
    const riskFreeRate = this.getConfig('riskFreeRate', 0.03);
    const marketRiskPremium = this.getConfig('marketRiskPremium', 0.06);
    const beta = 1.0; // 简化假设
    const wacc = riskFreeRate + beta * marketRiskPremium;

    // 计算历史净利润增长率
    const profits = periods.map((p: any) => p.netProfit);
    const growthRates: number[] = [];
    for (let i = 1; i < profits.length; i++) {
      if (profits[i - 1] > 0) {
        growthRates.push((profits[i] - profits[i - 1]) / profits[i - 1]);
      }
    }
    const avgGrowth = growthRates.length > 0 
      ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length 
      : 0.1;

    // 2阶段：前5年高增长，之后永续增长3%
    const highGrowthYears = 5;
    const terminalGrowth = 0.03;
    const currentProfit = latest.netProfit;
    const shares = 100; // 简化：假设市值 = 股价 * 100亿股本
    
    let pv = 0;
    let profit = currentProfit;
    
    // 高增长阶段
    for (let year = 1; year <= highGrowthYears; year++) {
      profit *= (1 + Math.min(avgGrowth, 0.25)); // 上限25%
      pv += profit / Math.pow(1 + wacc, year);
    }
    
    // 终值
    const terminalProfit = profit * (1 + terminalGrowth);
    const terminalValue = terminalProfit / (wacc - terminalGrowth);
    pv += terminalValue / Math.pow(1 + wacc, highGrowthYears);

    const impliedPrice = Number((pv / shares).toFixed(2));
    const currentPrice = latest.revenue * 0.05; // 简化估算
    const upside = Number(((impliedPrice - currentPrice) / currentPrice * 100).toFixed(1));

    const insights: Insight[] = [];
    if (upside > 20) {
      insights.push({
        type: 'opportunity',
        title: 'DCF隐含上行空间',
        description: `简化DCF模型测算合理价${impliedPrice}元，较当前有${upside}%上行空间`,
        confidence: 0.6,
        source: 'valuation-framework',
        metric: 'dcf_upside',
        value: `${upside}%`,
      });
    } else if (upside < -20) {
      insights.push({
        type: 'risk',
        title: 'DCF隐含下行风险',
        description: `简化DCF模型测算合理价${impliedPrice}元，较当前有${Math.abs(upside)}%下行风险`,
        confidence: 0.6,
        source: 'valuation-framework',
        metric: 'dcf_upside',
        value: `${upside}%`,
      });
    }

    return { impliedPrice, upside, insights };
  }

  private compositeValuation(pe: any, pb: any, dcf: any) {
    // 综合评分：越低越好（便宜）
    let score = 50; // 中性起点

    // PE分位调整
    score += (pe.percentile - 50) * 0.3;
    // PB分位调整
    score += (pb.percentile - 50) * 0.2;
    // DCF调整
    if (dcf.upside > 30) score -= 15;
    else if (dcf.upside > 10) score -= 8;
    else if (dcf.upside < -20) score += 15;
    else if (dcf.upside < -10) score += 8;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let rating: 'undervalued' | 'fair' | 'overvalued';
    let band: string;
    
    if (score < 35) {
      rating = 'undervalued';
      band = '低估区间';
    } else if (score < 65) {
      rating = 'fair';
      band = '合理区间';
    } else {
      rating = 'overvalued';
      band = '高估区间';
    }

    return { score, rating, band };
  }

  private generateSummary(pe: any, pb: any, composite: any): string {
    const parts: string[] = [];
    parts.push(`PE位于历史${pe.percentile}%分位`);
    parts.push(`PB位于历史${pb.percentile}%分位`);
    parts.push(`综合估值评级：${composite.band}`);
    return parts.join('，') + '。';
  }
}
