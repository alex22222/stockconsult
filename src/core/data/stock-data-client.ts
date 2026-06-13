/**
 * Stock Data Client
 *
 * Investoday-free data client that talks to the CloudBase proxy endpoints.
 * Falls back gracefully when upstream data sources are unavailable.
 */
import { getEnvString } from '../utils/env';
import type {
  MCPStockBasicInfo,
  MCPCompanyProfile,
  MCPRealtimeQuote,
  MCPAnnouncement,
  MCPFinanceProfit,
  MCPFinanceGrowth,
  MCPFinanceStrength,
  MCPFinanceValuation,
  MCPQuoteHistory,
  MCPStockScore,
  MCPNewsItem,
  MCPForecastRating,
} from './mcp-client';

export class StockDataClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || getEnvString('VITE_CLOUDBASE_API_URL') || '';
  }

  private async getJson(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getStockBasicInfo(code: string): Promise<MCPStockBasicInfo | null> {
    try {
      const data = await this.getJson(`/proxy/stock-basic-info?code=${code}`);
      return data.success ? (data.data as MCPStockBasicInfo) : null;
    } catch (e) {
      console.warn('[StockDataClient] getStockBasicInfo failed:', e);
      return null;
    }
  }

  async getCompanyProfile(code: string): Promise<MCPCompanyProfile | null> {
    // No free equivalent yet; derive from basic info.
    const basic = await this.getStockBasicInfo(code);
    if (!basic) return null;
    return {
      stockCode: basic.STOCKCODE,
      stockName: basic.STOCKNAME,
      companyName: basic.STOCKFULLNAME,
      companyNameEn: '',
      registeredCapital: 0,
      mainBusiness: basic.MAINBUSINESS,
      officeAddress: basic.OFFICEADDRESS,
      registeredAddress: '',
      contactPerson1: '',
      contactPhone1: '',
    };
  }

  async getRealtimeQuote(code: string): Promise<MCPRealtimeQuote | null> {
    try {
      const data = await this.getJson(`/stock-quotes?codes=${code}`);
      const list = data?.quotes || [];
      if (list.length === 0) return null;
      const q = list[0];
      return {
        stockCode: code,
        stockName: q.name || '',
        marketType: '',
        openPrice: q.open ?? 0,
        closePriceYDay: q.preClose ?? 0,
        currentPrice: q.price ?? 0,
        changeRatio: q.changePercent ? q.changePercent / 100 : 0,
        highPrice: q.high ?? 0,
        lowPrice: q.low ?? 0,
        dataTime: q.time || '',
        dealStockAmount: q.volume ?? 0,
        dealMoney: (q.amount ?? 0) * 10000,
        limitUpPrice: 0,
        limitDownPrice: 0,
        turnOverRate: q.turnoverRate ?? 0,
        circulationValue: (q.floatMarketCap ?? 0) * 100000000,
        totalValue: (q.totalMarketCap ?? 0) * 100000000,
      };
    } catch (e) {
      console.warn('[StockDataClient] getRealtimeQuote failed:', e);
      return null;
    }
  }

  async getStockScore(code: string): Promise<MCPStockScore | null> {
    try {
      const data = await this.getJson(`/stock-score-proxy?code=${code}`);
      return data.success ? (data.data as MCPStockScore) : null;
    } catch (e) {
      console.warn('[StockDataClient] getStockScore failed:', e);
      return null;
    }
  }

  async listAdjustedQuotes(code: string, beginDate: string, endDate: string): Promise<MCPQuoteHistory[]> {
    try {
      const days = Math.min(365, Math.max(30, Math.ceil((new Date(endDate).getTime() - new Date(beginDate).getTime()) / 86400000) + 1));
      const data = await this.getJson(`/stock-history?code=${code}&days=${days}`);
      return data.success && Array.isArray(data.data) ? (data.data as MCPQuoteHistory[]) : [];
    } catch (e) {
      console.warn('[StockDataClient] listAdjustedQuotes failed:', e);
      return [];
    }
  }

  async getValuation(code: string): Promise<MCPFinanceValuation | null> {
    try {
      const data = await this.getJson(`/proxy/stock-valuation?code=${code}`);
      return data.success ? (data.data as MCPFinanceValuation) : null;
    } catch (e) {
      console.warn('[StockDataClient] getValuation failed:', e);
      return null;
    }
  }

  async getProfitAbility(_code: string): Promise<MCPFinanceProfit | null> {
    // Free equivalent not implemented yet.
    return null;
  }

  async getGrowthAbility(_code: string): Promise<MCPFinanceGrowth | null> {
    return null;
  }

  async getFinancialStrength(_code: string): Promise<MCPFinanceStrength | null> {
    return null;
  }

  async listAnnouncements(_code: string, _beginDate?: string, _limit = 20): Promise<MCPAnnouncement[]> {
    return [];
  }

  async listRelatedNews(_code: string, _limit = 20): Promise<MCPNewsItem[]> {
    return [];
  }

  async listForecastRatings(_code: string, _limit = 20): Promise<MCPForecastRating[]> {
    return [];
  }

  async recognizeEntity(input: string): Promise<{ entities: Array<{ type: string; code: string; name: string; correlation: number }> }> {
    const trimmed = input.trim();
    if (/^\d{6}$/.test(trimmed)) {
      return { entities: [{ type: 'stock', code: trimmed, name: '', correlation: 1 }] };
    }
    return { entities: [] };
  }
}
