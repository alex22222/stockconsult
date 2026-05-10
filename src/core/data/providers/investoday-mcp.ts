import { DataProvider } from './base';
import { InvestodayMCPClient } from '../mcp-client';
import type { StockInfo, MarketData, FinancialMetrics, Announcement, StockDataBundle } from '../../types/stock';

/**
 * Investoday MCP 数据提供者
 * 
 * 通过 MCP (Model Context Protocol) HTTP 接口调用 investoday 的 37+ 金融数据工具
 * 当用户查询个股时，自动调用 MCP 获取真实数据
 */
export class InvestodayMCPProvider extends DataProvider {
  private client: InvestodayMCPClient;

  constructor(apiKey: string = '') {
    super('investoday-mcp', '1.0.0');
    this.client = new InvestodayMCPClient(apiKey);
  }

  setApiKey(key: string): void {
    this.client = new InvestodayMCPClient(key);
  }

  async fetchStockInfo(code: string): Promise<StockInfo> {
    // 并行获取基本信息 + 公司概况 + 实时行情（用于市值）
    const [basic, profile, quote] = await Promise.all([
      this.client.getStockBasicInfo(code),
      this.client.getCompanyProfile(code),
      this.client.getRealtimeQuote(code),
    ]);

    if (!basic) {
      throw new Error(`Stock ${code} not found in investoday`);
    }

    const exchangeMap: Record<string, string> = {
      'SH': 'SSE',
      'SZ': 'SZSE',
      'BJ': 'BJSE',
    };

    return {
      code: basic.STOCKCODE,
      name: basic.STOCKNAME,
      exchange: (exchangeMap[basic.EXCHANGECODE] || basic.EXCHANGECODE) as StockInfo['exchange'],
      industry: profile?.mainBusiness?.split('；')[0] || '',
      marketCap: quote ? Math.round(quote.totalValue / 100000000) : 0,
      floatMarketCap: quote ? Math.round(quote.circulationValue / 100000000) : 0,
      listingDate: basic.LISTDATE?.split(' ')[0],
    };
  }

  async fetchMarketData(code: string): Promise<MarketData> {
    const [quote, _score] = await Promise.all([
      this.client.getRealtimeQuote(code),
      this.client.getStockScore(code),
    ]);

    if (!quote) {
      throw new Error(`Market data for ${code} not available`);
    }

    // 获取近60日历史行情
    const endDate = new Date();
    const beginDate = new Date();
    beginDate.setDate(endDate.getDate() - 60);
    
    const history = await this.client.listAdjustedQuotes(
      code,
      beginDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const change = Number((quote.currentPrice - quote.closePriceYDay).toFixed(2));
    const changePercent = Number((quote.changeRatio * 100).toFixed(2));

    return {
      price: quote.currentPrice,
      preClose: quote.closePriceYDay,
      change,
      changePercent,
      volume: Math.round(quote.dealStockAmount),
      turnover: Math.round(quote.dealMoney / 10000),
      pe: 0,
      pb: 0,
      high52w: 0,
      low52w: 0,
      high: quote.highPrice,
      low: quote.lowPrice,
      turnoverRate: Number((quote.turnOverRate || 0).toFixed(2)),
      history: history.map(h => ({
        date: h.QUOTETIME?.split(' ')[0] || '',
        open: h.OPENPRICE,
        high: h.HIGHPRICE,
        low: h.LOWPRICE,
        close: h.CLOSEPRICE,
        volume: Math.round(h.DEALSTOCKAMOUNT),
        turnover: Math.round(h.DEALMONEY / 10000),
      })),
    };
  }

  async fetchFinancialMetrics(code: string): Promise<FinancialMetrics> {
    const [profit, _growth, strength, _valuation] = await Promise.all([
      this.client.getProfitAbility(code),
      this.client.getGrowthAbility(code),
      this.client.getFinancialStrength(code),
      this.client.getValuation(code),
    ]);

    // 构建财务周期数据（使用最新数据作为单期）
    const period = {
      period: profit?.reportDate?.split(' ')[0] || new Date().toISOString().split('T')[0],
      revenue: 0,
      netProfit: 0,
      grossProfit: 0,
      totalAssets: 0,
      totalLiabilities: 0,
      shareholdersEquity: 0,
      operatingCashFlow: 0,
    };

    return {
      periods: [period],
      grossMargin: profit?.f1200 ? Number(profit.f1200) : 0,
      netMargin: profit?.f1220 ? Number(profit.f1220) : 0,
      roe: profit?.f1230 ? Number(profit.f1230) : 0,
      roa: profit?.f1240 ? Number(profit.f1240) : 0,
      debtRatio: strength?.f1600 ? Number(strength.f1600) : 0,
      currentRatio: undefined,
      quickRatio: undefined,
      assetTurnover: profit?.f1270 ? Number(profit.f1270) : 0,
    };
  }

  async fetchAnnouncements(code: string, limit: number = 20): Promise<Announcement[]> {
    const beginDate = new Date();
    beginDate.setMonth(beginDate.getMonth() - 3);
    
    const items = await this.client.listAnnouncements(
      code,
      beginDate.toISOString().split('T')[0],
      limit
    );

    return items.map(item => ({
      id: String(item.ANNOUNCEMENTID || 0),
      title: item.ANNOUNCEMENTTITLE || '无标题公告',
      type: this.mapAnnouncementType(item.ANNOUNCEMENTTYPECODE),
      date: item.ANNOUNCEMENTDATE?.split(' ')[0] || '',
      content: item.ANNOUNCEMENTTITLE || '',
      sentiment: 'neutral',
    }));
  }

  async searchStocks(query: string): Promise<StockInfo[]> {
    // 输入校验：股票代码应为6位数字，或中文名称
    const trimmed = query.trim();
    const isValidCode = /^\d{6}$/.test(trimmed);
    const isChineseName = /[\u4e00-\u9fa5]/.test(trimmed);
    
    if (!isValidCode && !isChineseName && trimmed.length < 2) {
      return [];
    }

    const entity = await this.client.recognizeEntity(trimmed);
    
    // correlation 为0表示完全不相关，拒绝匹配
    if (!entity || entity.type !== 'stock' || (entity.correlation !== undefined && entity.correlation <= 0)) {
      return [];
    }

    const info = await this.fetchStockInfo(entity.code).catch(() => null);
    return info ? [info] : [];
  }

  async fetchBundle(code: string): Promise<StockDataBundle> {
    const [info, market, financial, announcements] = await Promise.all([
      this.fetchStockInfo(code),
      this.fetchMarketData(code),
      this.fetchFinancialMetrics(code),
      this.fetchAnnouncements(code, 20),
    ]);

    return {
      info,
      market,
      financial,
      announcements,
      fetchedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      const entity = await this.client.recognizeEntity('贵州茅台');
      const latency = Math.round(performance.now() - start);
      return {
        healthy: !!entity,
        latency,
        message: entity ? `Connected, recognized: ${entity.name}` : 'Connection ok but recognition failed',
      };
    } catch (e) {
      return {
        healthy: false,
        latency: Math.round(performance.now() - start),
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // ========== 辅助方法 ==========

  private mapAnnouncementType(typeCode?: string): Announcement['type'] {
    const map: Record<string, Announcement['type']> = {
      '1': 'earnings',
      '2': 'dividend',
      '3': 'major_event',
      '4': 'shareholder',
      '5': 'equity',
      '6': 'financing',
      '7': 'acquisition',
      '8': 'lawsuit',
    };
    return map[typeCode || ''] || 'other';
  }
}
