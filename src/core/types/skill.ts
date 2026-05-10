// ============================================
// Skill 系统类型定义
// ============================================

import type { StockDataBundle } from './stock';

// Skill 执行状态
export type SkillStatus = 'success' | 'failure' | 'skipped' | 'pending';

// 洞察类型
export type InsightType = 'risk' | 'opportunity' | 'neutral' | 'highlight';

// 洞察点
export interface Insight {
  type: InsightType;
  title: string;
  description: string;
  confidence: number;      // 0-1
  source: string;          // 数据来源标识
  metric?: string;         // 关联指标
  value?: string | number; // 指标值
}

// Skill 执行结果
export interface SkillResult {
  skillId: string;
  skillName: string;
  status: SkillStatus;
  data: Record<string, unknown>;
  insights: Insight[];
  summary: string;         // 一句话摘要
  executionTimeMs?: number;
  error?: string;
}

// Skill 配置
export interface SkillConfig {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  dependencies: string[];  // 依赖的Skill ID列表
  parallel: boolean;       // 是否可与同层级并行
  config: Record<string, unknown>; // 运行时配置参数
}

// Skill 接口定义
export interface ISkill {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly config: SkillConfig;
  execute(context: PipelineContext): Promise<SkillResult>;
}

// ============================================
// Pipeline 上下文
// ============================================

export interface PipelineContext {
  stockCode: string;
  stockName?: string;
  dataBundle: StockDataBundle;
  results: Map<string, SkillResult>;
  config: Record<string, unknown>;
  
  // 便捷方法
  getResult(skillId: string): SkillResult | undefined;
  getData<T = unknown>(key: string): T | undefined;
  setData<T = unknown>(key: string, value: T): void;
}

// ============================================
// Pipeline 定义
// ============================================

export interface PipelineStage {
  id: string;
  name: string;
  skillIds: string[];      // 本阶段要执行的Skill
  parallel: boolean;       // 阶段内是否并行
}

export interface PipelineDefinition {
  id: string;
  name: string;
  stages: PipelineStage[];
}

export interface PipelineExecutionResult {
  pipelineId: string;
  stockCode: string;
  status: 'completed' | 'partial' | 'failed';
  results: SkillResult[];
  startTime: string;
  endTime: string;
  totalExecutionTimeMs: number;
}

// ============================================
// 插件系统类型
// ============================================

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  skills?: SkillConfig[];
  uiSlots?: UISlotRegistration[];
}

export interface UISlotRegistration {
  slot: string;            // 插槽位置，如 'dashboard.footer'
  componentName: string;
}

export interface IPlugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface PluginContext {
  registerSkill(skill: ISkill): void;
  unregisterSkill(skillId: string): void;
  registerUI(slot: string, component: unknown): void;
  getDataService(): unknown;
}
