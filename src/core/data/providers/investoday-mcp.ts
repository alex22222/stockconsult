import { DataProvider } from './base';
import { StockDataClient } from '../stock-data-client';
import { getEnvString } from '../../utils/env';
import type { StockInfo, MarketData, FinancialMetrics, Announcement, StockDataBundle, NewsItem, ResearchReport } from '../../types/stock';

/**
 * Investoday MCP 数据提供者
 * 
 * 通过 MCP (Model Context Protocol) HTTP 接口调用 investoday 的 37+ 金融数据工具
 * 当用户查询个股时，自动调用 MCP 获取真实数据
 */
export class InvestodayMCPProvider extends DataProvider {
  private client: StockDataClient;

  constructor(_apiKey: string = '', baseUrl?: string) {
    super('investoday-mcp', '1.0.0');
    // 生产环境通过 CloudBase 云函数代理，无需 apiKey（key 在云函数环境变量中）
    const cloudBaseUrl = getEnvString('VITE_CLOUDBASE_API_URL');
    this.client = new StockDataClient(baseUrl || cloudBaseUrl);
  }

  setApiKey(_key: string): void {
    // No-op: Investoday key is no longer used by the browser.
  }

  async fetchStockInfo(code: string): Promise<StockInfo> {
    // 并行获取基本信息 + 公司概况 + 实时行情 + 综合评分（含行业信息）
    const [basic, profile, quote, score] = await Promise.all([
      this.client.getStockBasicInfo(code),
      this.client.getCompanyProfile(code),
      this.client.getRealtimeQuote(code),
      this.client.getStockScore(code),
    ]);

    if (!basic) {
      throw new Error(`Stock ${code} not found in investoday`);
    }

    const exchangeMap: Record<string, string> = {
      'SH': 'SSE',
      'SZ': 'SZSE',
      'BJ': 'BJSE',
    };

    // 行业信息优先级：综合评分 > 主营业务描述
    const industry = score?.idu4Lv3Name || basic.MAINBUSINESS?.split('；')[0] || '';

    return {
      code: basic.STOCKCODE,
      name: basic.STOCKNAME,
      exchange: (exchangeMap[basic.EXCHANGECODE] || basic.EXCHANGECODE) as StockInfo['exchange'],
      industry,
      marketCap: quote ? Math.round(quote.totalValue / 100000000) : 0,
      floatMarketCap: quote ? Math.round(quote.circulationValue / 100000000) : 0,
      listingDate: basic.LISTDATE?.split(' ')[0],
      companyName: profile?.companyName || basic.STOCKFULLNAME,
      mainBusiness: profile?.mainBusiness || basic.MAINBUSINESS,
    };
  }

  async fetchMarketData(code: string): Promise<MarketData> {
    const [quote, valuation] = await Promise.all([
      this.client.getRealtimeQuote(code),
      this.client.getValuation(code),
    ]);

    if (!quote) {
      throw new Error(`Market data for ${code} not available`);
    }

    // 获取近250日历史行情（用于计算52周高低价）
    const endDate = new Date();
    const beginDate = new Date();
    beginDate.setDate(endDate.getDate() - 250);
    
    const history = await this.client.listAdjustedQuotes(
      code,
      beginDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    const change = Number((quote.currentPrice - quote.closePriceYDay).toFixed(2));
    const changePercent = Number((quote.changeRatio * 100).toFixed(2));
    const amplitude = quote.highPrice && quote.lowPrice
      ? Number(((quote.highPrice - quote.lowPrice) / quote.closePriceYDay * 100).toFixed(2))
      : undefined;

    // 从250日历史数据计算52周高低价
    const validHistory = history.filter(h => h.highPrice > 0 && h.lowPrice > 0);
    const high52w = validHistory.length > 0
      ? Number(Math.max(...validHistory.map(h => h.highPrice)).toFixed(2))
      : 0;
    const low52w = validHistory.length > 0
      ? Number(Math.min(...validHistory.map(h => h.lowPrice)).toFixed(2))
      : 0;

    // 从估值指标解析 PE/PB/PS/股息率/EV-EBITDA
    const parseValue = (v: string | undefined): number => {
      if (!v || v === '--' || v === 'null' || v === 'undefined') return 0;
      const n = Number(v);
      return isNaN(n) ? 0 : Number(n.toFixed(2));
    };

    return {
      price: quote.currentPrice,
      preClose: quote.closePriceYDay,
      change,
      changePercent,
      volume: Math.round(quote.dealStockAmount),
      turnover: Math.round(quote.dealMoney / 10000),
      pe: parseValue(valuation?.f2250),
      pb: parseValue(valuation?.f2260),
      ps: parseValue(valuation?.f2270) || undefined,
      dividendYield: parseValue(valuation?.f2290) || undefined,
      evEbitda: parseValue(valuation?.f2280) || undefined,
      high52w,
      low52w,
      high: quote.highPrice,
      low: quote.lowPrice,
      amplitude,
      turnoverRate: Number((quote.turnOverRate || 0).toFixed(2)),
      // 取最近60日用于图表展示
      history: history.slice(-60).map(h => ({
        date: h.tradeDate?.split(' ')[0] || '',
        open: h.openPrice ?? 0,
        high: h.highPrice ?? 0,
        low: h.lowPrice ?? 0,
        close: h.closePrice ?? 0,
        volume: Math.round(h.volume ?? 0),
        turnover: Math.round((h.amount ?? 0) / 10000),
      })),
      updateTime: quote.dataTime,
    };
  }

  async fetchFinancialMetrics(code: string): Promise<FinancialMetrics> {
    const [profit, growth, strength] = await Promise.all([
      this.client.getProfitAbility(code),
      this.client.getGrowthAbility(code),
      this.client.getFinancialStrength(code),
    ]);

    // 构建财务周期数据（使用最新数据作为单期）
    const reportDate = profit?.reportDate?.split(' ')[0]
      || growth?.reportDate?.split(' ')[0]
      || strength?.reportDate?.split(' ')[0]
      || new Date().toISOString().split('T')[0];

    const period = {
      period: reportDate,
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
      // 成长能力
      revenueGrowth: growth?.f1420 ? Number(growth.f1420) : undefined,
      profitGrowth: growth?.f1400 ? Number(growth.f1400) : undefined,
      epsGrowth: growth?.f1410 ? Number(growth.f1410) : undefined,
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

  async fetchNews(code: string, limit: number = 10): Promise<NewsItem[]> {
    const items = await this.client.listRelatedNews(code, limit);

    return items.map((item, idx) => {
      const title = String(item.NEWSTITLE || item.title || '无标题');
      const content = String(item.CONTENT || item.content || item.SUMMARY || item.summary || title);
      const source = String(item.SOURCE || item.source || item.MEDIA || item.media || 'investoday');
      const date = String(item.PUBLISHDATE || item.publishDate || item.date || item.DATETIME || '');
      const url = String(item.URL || item.url || item.link || '');
      const sentiment = this.inferSentiment(String(item.SENTIMENT || item.sentiment || ''));

      return {
        id: String(item.NEWSID || item.id || `news-${idx}`),
        title,
        content,
        source,
        publishDate: date,
        url: url || undefined,
        sentiment,
      };
    });
  }

  async fetchForecastRatings(code: string, limit: number = 10): Promise<ResearchReport[]> {
    const items = await this.client.listForecastRatings(code, limit);

    return items.map((item, idx) => {
      const institution = String(item.INSTITUTION || item.institution || item.ORGNAME || item.orgName || '未知机构');
      const analyst = String(item.ANALYST || item.analyst || '');
      const date = String(item.REPORTDATE || item.reportDate || item.date || '');
      const rawRating = String(item.RATING || item.rating || item.RATINGCODE || item.ratingCode || 'neutral');
      const title = String(item.TITLE || item.title || '');
      const summary = String(item.SUMMARY || item.summary || item.CONTENT || item.content || title || '');
      const targetPriceRaw = item.TARGETPRICE || item.targetPrice;
      const targetPrice = targetPriceRaw ? Number(targetPriceRaw) : undefined;

      return {
        id: String(item.REPORTID || item.id || `report-${idx}`),
        title: title || `${institution}研报`,
        institution,
        analyst: analyst || undefined,
        date,
        rating: this.mapRating(rawRating),
        targetPrice,
        summary,
      };
    });
  }

  async searchStocks(query: string): Promise<StockInfo[]> {
    // 输入校验：股票代码应为6位数字，或中文名称
    const trimmed = query.trim();
    const isValidCode = /^\d{6}$/.test(trimmed);
    const isChineseName = /[\u4e00-\u9fa5]/.test(trimmed);
    
    if (!isValidCode && !isChineseName && trimmed.length < 2) {
      return [];
    }

    const result = await this.client.recognizeEntity(trimmed);
    const entity = result?.entities?.[0];

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

    // 新闻和研报并行获取（非关键路径，失败不影响主流程）
    const [news, reports] = await Promise.all([
      this.fetchNews(code, 8).catch(() => []),
      this.fetchForecastRatings(code, 5).catch(() => []),
    ]);

    return {
      info,
      market,
      financial,
      announcements,
      news: news.length > 0 ? news : undefined,
      reports: reports.length > 0 ? reports : undefined,
      fetchedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      // Verify the proxy data endpoints are reachable (Investoday-free)
      const quote = await this.client.getRealtimeQuote('600519');
      const latency = Math.round(performance.now() - start);
      return {
        healthy: !!quote,
        latency,
        message: quote ? `Proxy data endpoints reachable` : 'Proxy reachable but quote returned empty',
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

  private mapRating(raw: string): ResearchReport['rating'] {
    const lower = raw.toLowerCase().trim();
    if (lower.includes('buy') || lower.includes('买入') || lower.includes('强推') || lower === '1') return 'buy';
    if (lower.includes('overweight') || lower.includes('增持') || lower === '2') return 'overweight';
    if (lower.includes('underweight') || lower.includes('减持') || lower === '4') return 'underweight';
    if (lower.includes('sell') || lower.includes('卖出') || lower === '5') return 'sell';
    return 'neutral';
  }

  private inferSentiment(raw: string): NewsItem['sentiment'] {
    const lower = raw.toLowerCase().trim();
    if (lower.includes('positive') || lower.includes('正面') || lower.includes('利好')) return 'positive';
    if (lower.includes('negative') || lower.includes('负面') || lower.includes('利空')) return 'negative';
    return undefined;
  }
}
