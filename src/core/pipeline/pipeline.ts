import type { PipelineDefinition, PipelineStage, PipelineExecutionResult, SkillResult } from '../types/skill';
import { PipelineContextImpl } from './context';
import { SkillRegistry } from './skill-registry';
import type { StockDataBundle } from '../types/stock';

/**
 * 分析流水线引擎
 * 负责编排Skill的执行顺序，支持并行/串行、依赖解析、错误处理
 */
export class AnalysisPipeline {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry = new SkillRegistry()) {
    this.registry = registry;
  }

  /**
   * 执行预定义的流水线
   */
  async execute(
    definition: PipelineDefinition,
    stockCode: string,
    dataBundle: StockDataBundle,
    config: Record<string, unknown> = {}
  ): Promise<PipelineExecutionResult> {
    const startTime = performance.now();
    const context = new PipelineContextImpl(stockCode, dataBundle, config);
    const allResults: SkillResult[] = [];

    console.log(`[Pipeline] Starting pipeline "${definition.name}" for ${stockCode}`);

    try {
      for (const stage of definition.stages) {
        const stageResults = await this.executeStage(stage, context);
        allResults.push(...stageResults);
      }
    } catch (error) {
      console.error(`[Pipeline] Pipeline execution failed:`, error);
    }

    const endTime = performance.now();
    const totalMs = Math.round(endTime - startTime);

    // 判断整体状态
    const failedCount = allResults.filter(r => r.status === 'failure').length;
    const status = failedCount === 0 ? 'completed' : failedCount < allResults.length / 2 ? 'partial' : 'failed';

    console.log(`[Pipeline] Completed in ${totalMs}ms. Status: ${status}`);

    return {
      pipelineId: definition.id,
      stockCode,
      status,
      results: allResults,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      totalExecutionTimeMs: totalMs,
    };
  }

  /**
   * 执行单个阶段
   */
  private async executeStage(stage: PipelineStage, context: PipelineContextImpl): Promise<SkillResult[]> {
    console.log(`[Pipeline] Stage "${stage.name}": executing ${stage.skillIds.length} skill(s)`);

    // 解析依赖，确保执行顺序正确
    const orderedIds = this.registry.resolveDependencies(stage.skillIds);

    if (stage.parallel && orderedIds.length > 1) {
      // 并行执行（同阶段内无依赖关系的可并行）
      return this.executeParallel(orderedIds, context);
    } else {
      // 串行执行
      return this.executeSequential(orderedIds, context);
    }
  }

  /**
   * 串行执行
   */
  private async executeSequential(skillIds: string[], context: PipelineContextImpl): Promise<SkillResult[]> {
    const results: SkillResult[] = [];

    for (const id of skillIds) {
      const result = await this.executeSkill(id, context);
      results.push(result);

      // 串行时，失败不中断，但记录
      if (result.status === 'failure') {
        console.warn(`[Pipeline] Skill "${id}" failed, continuing...`);
      }
    }

    return results;
  }

  /**
   * 并行执行
   * 注意：有依赖关系的Skill实际上已由resolveDependencies排好序，
   * 真正的并行只在无依赖的Skill之间。这里简化处理为全部并行，
   * 因为resolveDependencies已经保证了正确的注册顺序。
   */
  private async executeParallel(skillIds: string[], context: PipelineContextImpl): Promise<SkillResult[]> {
    const promises = skillIds.map(id => this.executeSkill(id, context));
    return Promise.all(promises);
  }

  /**
   * 执行单个Skill
   */
  private async executeSkill(skillId: string, context: PipelineContextImpl): Promise<SkillResult> {
    // 如果已经执行过且成功，直接返回缓存结果
    const existing = context.getResult(skillId);
    if (existing && existing.status === 'success') {
      console.log(`[Pipeline] Skill "${skillId}" already executed, using cached result`);
      return existing;
    }

    const skill = this.registry.get(skillId);
    if (!skill) {
      return {
        skillId,
        skillName: 'Unknown',
        status: 'failure',
        data: {},
        insights: [],
        summary: `Skill "${skillId}" not found in registry`,
        error: `Skill "${skillId}" not found`,
      };
    }

    // 检查依赖是否已执行且成功
    for (const dep of skill.config.dependencies) {
      const depResult = context.getResult(dep);
      if (!depResult) {
        return {
          skillId,
          skillName: skill.name,
          status: 'skipped',
          data: {},
          insights: [],
          summary: `Skipped: dependency "${dep}" not executed`,
        };
      }
      if (depResult.status === 'failure') {
        return {
          skillId,
          skillName: skill.name,
          status: 'skipped',
          data: {},
          insights: [],
          summary: `Skipped: dependency "${dep}" failed`,
        };
      }
    }

    const start = performance.now();
    try {
      console.log(`[Pipeline] Executing skill: ${skillId}`);
      const result = await skill.execute(context);
      result.executionTimeMs = Math.round(performance.now() - start);
      context.recordResult(result);
      console.log(`[Pipeline] Skill "${skillId}" completed in ${result.executionTimeMs}ms`);
      return result;
    } catch (error) {
      const executionTimeMs = Math.round(performance.now() - start);
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Skill "${skillId}" failed:`, errorMsg);
      
      const result: SkillResult = {
        skillId,
        skillName: skill.name,
        status: 'failure',
        data: {},
        insights: [{
          type: 'risk',
          title: '分析执行异常',
          description: errorMsg,
          confidence: 1,
          source: 'pipeline',
        }],
        summary: `执行失败: ${errorMsg}`,
        executionTimeMs,
        error: errorMsg,
      };
      context.recordResult(result);
      return result;
    }
  }
}
