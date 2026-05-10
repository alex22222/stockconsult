// ============================================
// 股票基础数据类型
// ============================================

export type Exchange = 'SSE' | 'SZSE' | 'HKEX' | 'NASDAQ' | 'NYSE';

export interface StockInfo {
  code: string;           // 股票代码，如 "600519"
  name: string;           // 股票名称，如 "贵州茅台"
  exchange: Exchange;
  industry: string;       // 所属行业
  subIndustry?: string;   // 细分行业
  marketCap: number;      // 总市值（亿元）
  floatMarketCap?: number;// 流通市值
  listingDate?: string;   // 上市日期
}

// ============================================
// 行情数据类型
// ============================================

export interface PricePoint {
  date: string;           // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
}

export interface MarketData {
  price: number;          // 最新价
  preClose: number;       // 昨收
  change: number;         // 涨跌额
  changePercent: number;  // 涨跌幅
  volume: number;         // 成交量
  turnover: number;       // 成交额
  pe: number;             // 市盈率
  pb: number;             // 市净率
  ps?: number;            // 市销率
  high52w: number;        // 52周最高
  low52w: number;         // 52周最低
  high: number;           // 当日最高
  low: number;            // 当日最低
  amplitude?: number;     // 振幅
  turnoverRate?: number;  // 换手率
  history: PricePoint[];  // 历史价格（如60日）
}

// ============================================
// 财务数据类型
// ============================================

export interface FinancialPeriod {
  period: string;         // 报告期，如 "2024-Q3"
  revenue: number;        // 营业收入
  netProfit: number;      // 净利润
  grossProfit: number;    // 毛利润
  operatingProfit?: number;// 营业利润
  totalAssets: number;    // 总资产
  totalLiabilities: number;// 总负债
  shareholdersEquity: number;// 股东权益
  operatingCashFlow: number;// 经营现金流
  freeCashFlow?: number;  // 自由现金流
}

export interface FinancialMetrics {
  periods: FinancialPeriod[];
  // 衍生指标（最新一期）
  grossMargin: number;    // 毛利率
  netMargin: number;      // 净利率
  roe: number;            // 净资产收益率
  roa?: number;           // 总资产收益率
  debtRatio: number;      // 资产负债率
  currentRatio?: number;  // 流动比率
  quickRatio?: number;    // 速动比率
  assetTurnover?: number; // 总资产周转率
  inventoryTurnover?: number;// 存货周转率
  receivableTurnover?: number;// 应收账款周转率
}

// ============================================
// 公告数据类型
// ============================================

export type AnnouncementType = 
  | 'earnings'       // 业绩预告/快报/报告
  | 'dividend'       // 分红送转
  | 'major_event'    // 重大事项
  | 'shareholder'    // 股东变动
  | 'equity'         // 股权变动
  | 'financing'      // 再融资
  | 'acquisition'    // 并购重组
  | 'lawsuit'        // 诉讼仲裁
  | 'other';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface Announcement {
  id: string;
  title: string;
  type: AnnouncementType;
  date: string;
  content: string;
  sentiment: Sentiment;
  confidence?: number;    // 情感分析置信度
  keyEvents?: string[];   // 提取的关键事件
}

// ============================================
// 研报/机构观点类型
// ============================================

export interface ResearchReport {
  id: string;
  title: string;
  institution: string;
  analyst?: string;
  date: string;
  rating: 'buy' | 'overweight' | 'neutral' | 'underweight' | 'sell';
  targetPrice?: number;
  summary: string;
}

// ============================================
// 统一的原始数据包
// ============================================

export interface StockDataBundle {
  info: StockInfo;
  market: MarketData;
  financial: FinancialMetrics;
  announcements: Announcement[];
  reports?: ResearchReport[];
  fetchedAt: string;
}
