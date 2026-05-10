import { DataProvider } from './base';
import type { StockInfo, MarketData, FinancialMetrics, Announcement } from '../../types/stock';

/**
 * Mock 数据提供者
 * 用于开发、测试和无API Key时的演示
 * 数据基于贵州茅台(600519)的真实业务特征构建
 */
export class MockProvider extends DataProvider {
  constructor() {
    super('mock', '1.0.0');
  }

  private stockDb: Map<string, StockInfo> = new Map([
    ['600519', { code: '600519', name: '贵州茅台', exchange: 'SSE', industry: '白酒', subIndustry: '高端白酒', marketCap: 21000, floatMarketCap: 21000, listingDate: '2001-08-27' }],
    ['000858', { code: '000858', name: '五粮液', exchange: 'SZSE', industry: '白酒', subIndustry: '高端白酒', marketCap: 5800, floatMarketCap: 5800, listingDate: '1998-04-27' }],
    ['300750', { code: '300750', name: '宁德时代', exchange: 'SZSE', industry: '电力设备', subIndustry: '动力电池', marketCap: 9200, floatMarketCap: 8200, listingDate: '2018-06-11' }],
    ['000333', { code: '000333', name: '美的集团', exchange: 'SZSE', industry: '家用电器', subIndustry: '白色家电', marketCap: 4800, floatMarketCap: 4700, listingDate: '2013-09-18' }],
    ['601318', { code: '601318', name: '中国平安', exchange: 'SSE', industry: '保险', subIndustry: '综合保险', marketCap: 8900, floatMarketCap: 6500, listingDate: '2007-03-01' }],
    ['600036', { code: '600036', name: '招商银行', exchange: 'SSE', industry: '银行', subIndustry: '股份制银行', marketCap: 9200, floatMarketCap: 7500, listingDate: '2002-04-09' }],
    ['002594', { code: '002594', name: '比亚迪', exchange: 'SZSE', industry: '汽车', subIndustry: '乘用车', marketCap: 7800, floatMarketCap: 4500, listingDate: '2011-06-30' }],
    ['00700', { code: '00700', name: '腾讯控股', exchange: 'HKEX', industry: '互联网', subIndustry: '互联网平台', marketCap: 35000, floatMarketCap: 35000, listingDate: '2004-06-16' }],
    ['03690', { code: '03690', name: '美团-W', exchange: 'HKEX', industry: '互联网', subIndustry: '本地生活', marketCap: 8200, floatMarketCap: 7200, listingDate: '2018-09-20' }],
    ['09988', { code: '09988', name: '阿里巴巴-W', exchange: 'HKEX', industry: '互联网', subIndustry: '电商平台', marketCap: 18000, floatMarketCap: 9500, listingDate: '2019-11-26' }],
  ]);

  async fetchStockInfo(code: string): Promise<StockInfo> {
    const info = this.stockDb.get(code);
    if (!info) {
      // 对于未知代码，生成合理的Mock数据
      return {
        code,
        name: `股票${code}`,
        exchange: code.startsWith('6') ? 'SSE' : code.startsWith('0') || code.startsWith('3') ? 'SZSE' : 'HKEX',
        industry: '综合',
        marketCap: Math.round(Math.random() * 5000 + 500),
      };
    }
    return info;
  }

  async fetchMarketData(code: string): Promise<MarketData> {
    const basePrice = code === '600519' ? 1670 : code === '000858' ? 150 : code === '300750' ? 210 : 50;
    const volatility = basePrice * 0.02;
    const price = Number((basePrice + (Math.random() - 0.5) * volatility).toFixed(2));
    const change = Number((price - basePrice).toFixed(2));
    const changePercent = Number((change / basePrice * 100).toFixed(2));

    // 生成60日历史
    const history = this.generateHistory(basePrice, 60);

    return {
      price,
      preClose: basePrice,
      change,
      changePercent,
      volume: Math.round(Math.random() * 5000000 + 1000000),
      turnover: Math.round(Math.random() * 50 + 10),
      pe: code === '600519' ? 28.5 : code === '300750' ? 22.3 : code === '00700' ? 18.6 : 15 + Math.random() * 15,
      pb: code === '600519' ? 8.2 : code === '300750' ? 5.1 : 2 + Math.random() * 4,
      ps: 5 + Math.random() * 10,
      high52w: basePrice * 1.25,
      low52w: basePrice * 0.78,
      high: price * 1.015,
      low: price * 0.985,
      amplitude: 2.5 + Math.random() * 2,
      turnoverRate: 0.3 + Math.random() * 0.8,
      history,
    };
  }

  async fetchFinancialMetrics(code: string): Promise<FinancialMetrics> {
    const isMoutai = code === '600519';
    const isBYD = code === '002594';
    const isBank = code === '600036';

    // 生成8个季度的数据
    const periods: FinancialMetrics['periods'] = [];
    const baseRevenue = isMoutai ? 400 : isBYD ? 1200 : isBank ? 800 : 200;
    const baseProfit = isMoutai ? 200 : isBYD ? 60 : isBank ? 350 : 30;

    for (let i = 7; i >= 0; i--) {
      const year = 2023 + Math.floor((12 - i * 3) / 12);
      const quarter = ((12 - i * 3) % 12) || 12;
      const q = quarter <= 3 ? 1 : quarter <= 6 ? 2 : quarter <= 9 ? 3 : 4;
      const growth = 1 + (Math.random() - 0.3) * 0.15;
      
      periods.push({
        period: `${year}-Q${q}`,
        revenue: Math.round(baseRevenue * growth * (1 + (7 - i) * 0.03)),
        netProfit: Math.round(baseProfit * growth * (1 + (7 - i) * 0.025)),
        grossProfit: Math.round(baseRevenue * growth * (isMoutai ? 0.92 : isBank ? 0.35 : 0.22)),
        operatingProfit: Math.round(baseProfit * growth * 1.1),
        totalAssets: Math.round((isMoutai ? 2500 : isBYD ? 6000 : 12000) * (1 + (7 - i) * 0.02)),
        totalLiabilities: Math.round((isMoutai ? 400 : isBYD ? 4500 : 11000) * (1 + (7 - i) * 0.015)),
        shareholdersEquity: Math.round((isMoutai ? 2100 : isBYD ? 1500 : 1000) * (1 + (7 - i) * 0.03)),
        operatingCashFlow: Math.round(baseProfit * (isMoutai ? 1.1 : 1.5)),
        freeCashFlow: Math.round(baseProfit * (isMoutai ? 0.9 : 0.5)),
      });
    }

    const latest = periods[periods.length - 1];

    return {
      periods,
      grossMargin: Number((latest.grossProfit / latest.revenue * 100).toFixed(2)),
      netMargin: Number((latest.netProfit / latest.revenue * 100).toFixed(2)),
      roe: Number((latest.netProfit / latest.shareholdersEquity * 100).toFixed(2)),
      roa: Number((latest.netProfit / latest.totalAssets * 100).toFixed(2)),
      debtRatio: Number((latest.totalLiabilities / latest.totalAssets * 100).toFixed(2)),
      currentRatio: isBank ? undefined : Number((latest.totalAssets / latest.totalLiabilities * 1.5).toFixed(2)),
      quickRatio: isBank ? undefined : Number((latest.totalAssets / latest.totalLiabilities * 1.2).toFixed(2)),
      assetTurnover: Number((latest.revenue / latest.totalAssets).toFixed(2)),
      inventoryTurnover: isMoutai ? 0.3 : isBYD ? 6.5 : undefined,
      receivableTurnover: isMoutai ? 12 : undefined,
    };
  }

  async fetchAnnouncements(code: string, limit: number = 20): Promise<Announcement[]> {
    const isMoutai = code === '600519';
    const templates = isMoutai ? [
      { title: '2024年年度报告', type: 'earnings' as const, sentiment: 'positive' as const },
      { title: '2024年度利润分配预案公告', type: 'dividend' as const, sentiment: 'positive' as const },
      { title: '关于控股股东增持公司股份计划的公告', type: 'shareholder' as const, sentiment: 'positive' as const },
      { title: '关于子公司设立产业投资基金的公告', type: 'major_event' as const, sentiment: 'neutral' as const },
      { title: '2024年第三季度报告', type: 'earnings' as const, sentiment: 'positive' as const },
      { title: '关于高级管理人员变动的公告', type: 'other' as const, sentiment: 'neutral' as const },
    ] : [
      { title: '2024年年度报告', type: 'earnings' as const, sentiment: 'positive' as const },
      { title: '关于对外投资设立合资公司的公告', type: 'major_event' as const, sentiment: 'positive' as const },
      { title: '2024年第三季度报告', type: 'earnings' as const, sentiment: 'neutral' as const },
      { title: '关于签订重大合同的公告', type: 'major_event' as const, sentiment: 'positive' as const },
      { title: '关于股东减持股份计划的公告', type: 'shareholder' as const, sentiment: 'negative' as const },
    ];

    const announcements: Announcement[] = [];
    const now = new Date();
    
    for (let i = 0; i < Math.min(limit, templates.length * 3); i++) {
      const tpl = templates[i % templates.length];
      const date = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      
      announcements.push({
        id: `${code}-ann-${i}`,
        title: tpl.title,
        type: tpl.type,
        date: date.toISOString().split('T')[0],
        content: `${tpl.title}。具体内容详见公告正文。`,
        sentiment: tpl.sentiment,
        confidence: 0.7 + Math.random() * 0.25,
        keyEvents: this.extractKeyEvents(tpl.title, tpl.type),
      });
    }

    return announcements;
  }

  async searchStocks(query: string): Promise<StockInfo[]> {
    const results: StockInfo[] = [];
    const q = query.toLowerCase();
    
    for (const info of this.stockDb.values()) {
      if (info.code.includes(q) || info.name.includes(query) || info.industry.includes(query)) {
        results.push(info);
      }
    }
    
    return results.slice(0, 10);
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    return {
      healthy: true,
      latency: Math.round(performance.now() - start),
      message: 'Mock provider is always healthy',
    };
  }

  // ============ 辅助方法 ============

  private generateHistory(basePrice: number, days: number) {
    const history = [];
    let current = basePrice * 0.85;
    const now = new Date();
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const change = (Math.random() - 0.48) * basePrice * 0.025;
      current = Math.max(current * 0.97, current + change);
      const open = current + (Math.random() - 0.5) * basePrice * 0.01;
      const high = Math.max(open, current) * (1 + Math.random() * 0.015);
      const low = Math.min(open, current) * (1 - Math.random() * 0.015);
      
      history.push({
        date: date.toISOString().split('T')[0],
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(current.toFixed(2)),
        volume: Math.round(Math.random() * 3000000 + 500000),
      });
    }
    
    return history;
  }

  private extractKeyEvents(title: string, type: string): string[] {
    const events: string[] = [];
    if (type === 'earnings') events.push('业绩披露');
    if (type === 'dividend') events.push('分红方案');
    if (title.includes('增持')) events.push('股东增持');
    if (title.includes('减持')) events.push('股东减持');
    if (title.includes('投资') || title.includes('设立')) events.push('资本运作');
    if (events.length === 0) events.push('常规公告');
    return events;
  }
}
