import type { StockDataBundle } from '../types/stock';
import type { SkillResult, PipelineContext } from '../types/skill';

/**
 * Pipeline 上下文实现
 * 承载Skill执行过程中的数据共享
 */
export class PipelineContextImpl implements PipelineContext {
  stockCode: string;
  stockName?: string;
  dataBundle: StockDataBundle;
  results: Map<string, SkillResult>;
  config: Record<string, unknown>;
  
  private sharedData: Map<string, unknown> = new Map();

  constructor(stockCode: string, dataBundle: StockDataBundle, config: Record<string, unknown> = {}) {
    this.stockCode = stockCode;
    this.stockName = dataBundle.info.name;
    this.dataBundle = dataBundle;
    this.results = new Map();
    this.config = config;
  }

  getResult(skillId: string): SkillResult | undefined {
    return this.results.get(skillId);
  }

  getData<T = unknown>(key: string): T | undefined {
    return this.sharedData.get(key) as T | undefined;
  }

  setData<T = unknown>(key: string, value: T): void {
    this.sharedData.set(key, value);
  }

  /**
   * 记录Skill执行结果
   */
  recordResult(result: SkillResult): void {
    this.results.set(result.skillId, result);
  }

  /**
   * 获取所有洞察
   */
  getAllInsights() {
    const insights: Array<{ skillId: string; insight: import('../types/skill').Insight }> = [];
    for (const [skillId, result] of this.results) {
      if (result.status === 'success') {
        for (const insight of result.insights) {
          insights.push({ skillId, insight });
        }
      }
    }
    return insights;
  }
}
