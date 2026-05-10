import type { ISkill, SkillConfig, SkillResult, PipelineContext, Insight } from '../types/skill';

/**
 * Skill 抽象基类
 * 所有内置Skill应继承此类
 */
export abstract class BaseSkill implements ISkill {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly config: SkillConfig;

  constructor(config: SkillConfig) {
    this.id = config.id;
    this.name = config.name;
    this.version = config.version;
    this.config = config;
  }

  /**
   * Skill核心执行逻辑 —— 子类必须实现
   */
  abstract execute(context: PipelineContext): Promise<SkillResult>;

  /**
   * 便捷方法：创建成功结果
   */
  protected createSuccess(data: Record<string, unknown>, insights: Insight[], summary: string): SkillResult {
    return {
      skillId: this.id,
      skillName: this.name,
      status: 'success',
      data,
      insights,
      summary,
    };
  }

  /**
   * 便捷方法：创建失败结果
   */
  protected createFailure(error: string, summary?: string): SkillResult {
    return {
      skillId: this.id,
      skillName: this.name,
      status: 'failure',
      data: {},
      insights: [{
        type: 'risk',
        title: '分析失败',
        description: error,
        confidence: 1,
        source: this.id,
      }],
      summary: summary || `分析失败: ${error}`,
      error,
    };
  }

  /**
   * 便捷方法：获取配置参数（带默认值）
   */
  protected getConfig<T>(key: string, defaultValue: T): T {
    const value = this.config.config[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  /**
   * 便捷方法：从上下文中获取数据
   */
  protected getContextData<T>(context: PipelineContext, key: string): T | undefined {
    return context.getData<T>(key);
  }

  /**
   * 便捷方法：计算同比变化率
   */
  protected calcYoY(current: number, previous: number): number {
    if (previous === 0) return 0;
    return Number(((current - previous) / Math.abs(previous) * 100).toFixed(2));
  }

  /**
   * 便捷方法：计算环比变化率
   */
  protected calcQoQ(current: number, previous: number): number {
    return this.calcYoY(current, previous);
  }

  /**
   * 便捷方法：计算历史分位数
   */
  protected calcPercentile(value: number, history: number[]): number {
    if (history.length === 0) return 50;
    const sorted = [...history].sort((a, b) => a - b);
    let count = 0;
    for (const v of sorted) {
      if (v <= value) count++;
    }
    return Math.round((count / sorted.length) * 100);
  }
}
