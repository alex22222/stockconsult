// ============================================
// 分析报告输出类型 — 四大模块
// ============================================

import type { StockInfo } from './stock';
import type { SkillResult, Insight } from './skill';

// --------------------------------------------
// 模块1: 核心观点
// --------------------------------------------

export type Rating = 'strong_buy' | 'buy' | 'hold' | 'reduce' | 'sell';

export interface CoreView {
  rating: Rating;
  ratingLabel: string;        // 评级中文，如 "增持"
  oneSentenceSummary: string; // 一句话核心观点
  keyDrivers: string[];       // 核心驱动因素（3-5条）
  bullCase: string;           // 乐观情景
  bearCase: string;           // 悲观情景
  investmentThesis: string;   // 投资逻辑
}

// --------------------------------------------
// 模块2: 关键指标
// --------------------------------------------

export interface MetricCard {
  name: string;
  label: string;
  value: string | number;
  unit?: string;
  change?: number;            // 同比变化
  changePercent?: number;
  trend?: 'up' | 'down' | 'flat';
  category: 'valuation' | 'profitability' | 'growth' | 'quality' | 'market';
  benchmark?: string;         // 行业均值/历史中位数对比
  percentile?: number;        // 历史分位 0-100
}

export interface KeyMetrics {
  valuation: MetricCard[];    // 估值指标: PE, PB, PS, EV/EBITDA
  profitability: MetricCard[];// 盈利指标: ROE, ROA, 毛利率, 净利率
  growth: MetricCard[];       // 成长指标: 营收增速, 利润增速
  quality: MetricCard[];      // 质量指标: 负债率, 现金流, 应收账款
  market: MetricCard[];       // 市场指标: 市值, 换手率, 机构持仓
}

// --------------------------------------------
// 模块3: 市场解读
// --------------------------------------------

export interface MarketEvent {
  date: string;
  title: string;
  type: 'announcement' | 'report' | 'price_movement' | 'industry';
  impact: 'positive' | 'neutral' | 'negative';
  description: string;
}

export interface MarketInterpretation {
  recentEvents: MarketEvent[];      // 近期重要事件时间线
  sentimentAnalysis: {
    overall: 'positive' | 'neutral' | 'negative';
    score: number;                   // -1 ~ +1
    summary: string;
  };
  institutionalViews: {             // 机构观点汇总
    consensusRating: Rating;
    targetPriceRange: [number, number];
    reportCount: number;
    latestReports: { institution: string; rating: Rating; targetPrice?: number; summary: string }[];
  };
  industryContext: {                // 行业背景
    industryName: string;
    industryTrend: string;
    competitivePosition: string;
    policyImpact?: string;
  };
}

// --------------------------------------------
// 模块4: 行动建议
// --------------------------------------------

export interface ActionAdvice {
  recommendation: Rating;
  recommendationLabel: string;
  timeHorizon: 'short' | 'medium' | 'long'; // 短线/中线/长线
  entryStrategy?: string;           // 买入策略
  exitStrategy?: string;            // 卖出/止盈策略
  stopLoss?: number;                // 止损价位
  targetPrices: {                   // 目标价位
    conservative: number;
    base: number;
    optimistic: number;
  };
  positionAdvice?: string;          // 仓位建议
  keyMonitoringPoints: string[];    // 关键跟踪点
  riskReminders: string[];          // 风险提示
}

// --------------------------------------------
// 完整分析报告
// --------------------------------------------

export interface AnalysisReport {
  stock: StockInfo;
  generatedAt: string;
  dataDate: string;                 // 数据截止日期

  // 四大结构化输出
  coreView: CoreView;
  keyMetrics: KeyMetrics;
  marketInterpretation: MarketInterpretation;
  actionAdvice: ActionAdvice;

  // 底层数据
  skillResults: SkillResult[];
  rawInsights: Insight[];

  // 元信息
  overallConfidence: number;        // 0-1
  riskLevel: 'low' | 'medium' | 'high';
  riskWarnings: string[];
  disclaimers: string[];
}

// --------------------------------------------
// 报告导出格式
// --------------------------------------------

export interface ExportOptions {
  format: 'json' | 'markdown' | 'pdf';
  includeRawData?: boolean;
  includeCharts?: boolean;
  language?: 'zh' | 'en';
}
