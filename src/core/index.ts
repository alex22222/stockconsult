// 核心引擎层 — 统一导出

// 类型
export * from './types/stock';
export * from './types/skill';
export * from './types/analysis';

// 数据层
export { DataProvider } from './data/providers/base';
export { MockProvider } from './data/providers/mock';
export { InvestodayRESTProvider } from './data/providers/investoday-rest';
export { CloudBaseProvider } from './data/providers/cloudbase';
export { CacheService, globalCache } from './data/cache-service';
export { DataService, globalDataService, type ProviderName } from './data/data-service';

// 流水线
export { PipelineContextImpl } from './pipeline/context';
export { SkillRegistry, globalSkillRegistry } from './pipeline/skill-registry';
export { AnalysisPipeline } from './pipeline/pipeline';

// Skills
export { BaseSkill } from './skills/base-skill';
export { AnnouncementSkill } from './skills/announcement/announcement-skill';
export { FinancialSkill } from './skills/financial/financial-skill';
export { ValuationSkill } from './skills/valuation/valuation-skill';

// 报告生成
export { ReportGenerator } from './report-generator';
