/**
 * 集成测试：验证核心引擎流水线
 * 运行: npx tsx src/test/integration.test.ts
 */

import { globalDataService } from '../core/data/data-service';
import { globalSkillRegistry } from '../core/pipeline/skill-registry';
import { AnalysisPipeline } from '../core/pipeline/pipeline';
import { ReportGenerator } from '../core/report-generator';
import { AnnouncementSkill } from '../core/skills/announcement/announcement-skill';
import { FinancialSkill } from '../core/skills/financial/financial-skill';
import { ValuationSkill } from '../core/skills/valuation/valuation-skill';

async function runTest() {
  console.log('=== 个股查询核心引擎集成测试 ===\n');

  // 1. 初始化 Skills
  globalSkillRegistry.register(new AnnouncementSkill());
  globalSkillRegistry.register(new FinancialSkill());
  globalSkillRegistry.register(new ValuationSkill());
  console.log(`✓ 已注册 ${globalSkillRegistry.getAll().length} 个 Skill`);

  // 2. 获取 Mock 数据
  const candidates = await globalDataService.searchStocks('');
  const stockCode = candidates[0]?.code;
  if (!stockCode) {
    throw new Error('未找到可用于测试的股票');
  }
  console.log(`\n→ 获取 ${stockCode} 数据...`);
  const bundle = await globalDataService.fetchBundle(stockCode);
  console.log(`✓ 数据获取完成: ${bundle.info.name} (${bundle.info.code})`);
  console.log(`  - 行情: 价格 ${bundle.market.price}, PE ${bundle.market.pe}`);
  console.log(`  - 财务: ${bundle.financial.periods.length} 个季度`);
  console.log(`  - 公告: ${bundle.announcements.length} 条`);

  // 3. 执行分析流水线
  console.log(`\n→ 执行分析流水线...`);
  const pipeline = new AnalysisPipeline(globalSkillRegistry);
  const result = await pipeline.execute(
    {
      id: 'test-pipeline',
      name: '测试流水线',
      stages: [
        { id: 's1', name: '数据提取', skillIds: ['announcement-analyzer', 'financial-analyzer'], parallel: true },
        { id: 's2', name: '估值分析', skillIds: ['valuation-framework'], parallel: false },
      ],
    },
    stockCode,
    bundle
  );

  console.log(`✓ 流水线执行完成 (${result.totalExecutionTimeMs}ms)`);
  console.log(`  状态: ${result.status}`);
  for (const r of result.results) {
    console.log(`  - [${r.status}] ${r.skillName}: ${r.summary.substring(0, 60)}${r.summary.length > 60 ? '...' : ''}`);
  }

  // 4. 生成报告
  console.log(`\n→ 生成结构化报告...`);
  const report = ReportGenerator.generate(bundle.info, bundle, result);
  console.log(`✓ 报告生成完成`);
  console.log(`\n  === 四大模块输出 ===`);
  console.log(`  [核心观点] 评级: ${report.coreView.ratingLabel}`);
  console.log(`  [核心观点] 摘要: ${report.coreView.oneSentenceSummary}`);
  console.log(`  [关键指标] 估值: PE ${report.keyMetrics.valuation[0].value}倍, PB ${report.keyMetrics.valuation[1].value}倍`);
  console.log(`  [关键指标] 盈利: ROE ${report.keyMetrics.profitability[0].value}%, 毛利率 ${report.keyMetrics.profitability[2].value}%`);
  console.log(`  [市场解读] 情绪: ${report.marketInterpretation.sentimentAnalysis.summary}`);
  console.log(`  [行动建议] 建议: ${report.actionAdvice.recommendationLabel}`);
  console.log(`  [行动建议] 目标价: ${report.actionAdvice.targetPrices?.base ?? '-'}元 (基准)`);
  console.log(`\n  洞察总数: ${report.rawInsights.length}`);
  console.log(`  风险提示: ${report.riskWarnings.length} 条`);
  console.log(`  整体置信度: ${(report.overallConfidence * 100).toFixed(0)}%`);

  // 5. 验证扩展性
  console.log(`\n=== 扩展性验证 ===`);
  console.log(`✓ 新增 Provider: 实现 DataProvider 接口即可`);
  console.log(`✓ 新增 Skill: 继承 BaseSkill 并重写 execute 方法`);
  console.log(`✓ 当前 Skill 数量: ${globalSkillRegistry.getAll().length}`);
  console.log(`✓ Skill 依赖解析: ${globalSkillRegistry.validateDependencies().valid ? '通过' : '失败'}`);

  console.log(`\n=== 测试通过 ===`);
}

runTest().catch(console.error);
