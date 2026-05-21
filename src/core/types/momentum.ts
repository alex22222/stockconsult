// ============================================
// 爆破力扫描 — 短期爆发力选股模型类型
// ============================================

export interface MomentumDimension {
  name: string;
  score: number;        // 0-100
  weight: number;       // 权重
  details: string[];    // 具体理由 bullet points
}

export type MomentumLevel = 'extreme' | 'high' | 'medium' | 'low';

export interface MomentumPick {
  rank: number;
  stock: {
    code: string;
    name: string;
    exchange: string;
    industry: string;
  };
  price: number;
  changePercent: number;
  score: number;              // 综合爆破力指数 0-100
  level: MomentumLevel;
  dimensions: MomentumDimension[];
  summary: string;            // 一句话总结
  holdingPeriod: string;      // 建议持仓周期
  riskWarning: string[];      // 风险提示
  updatedAt: string;
}

export interface MomentumScanResult {
  picks: MomentumPick[];
  scanTime: string;
  marketSentiment: 'bullish' | 'neutral' | 'bearish';
  totalScanned: number;
}
