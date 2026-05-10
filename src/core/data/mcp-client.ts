/**
 * Investoday MCP HTTP Client
 * 
 * MCP (Model Context Protocol) over HTTP
 * 使用 JSON-RPC 2.0 格式调用工具
 * 
 * 端点: https://data-api.investoday.net/data/mcp/preset?apiKey=<key>
 */

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPCallResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface MCPStockBasicInfo {
  STOCKCODE: string;
  EXCHANGECODE: string;
  BOARDNAME: string;
  STOCKNAME: string;
  STOCKFULLNAME: string;
  LISTSTATUS: string;
  LISTDATE: string;
  STOCKTYPE: string;
  COMPANYID: string;
  SHARESTOTAL: number;
  SHARESFLOAT: number;
  OFFICEADDRESS: string;
  MAINBUSINESS: string;
  REPORTDATE: string;
}

export interface MCPRealtimeQuote {
  stockCode: string;
  stockName: string;
  marketType: string;
  openPrice: number;
  closePriceYDay: number;
  currentPrice: number;
  changeRatio: number;
  highPrice: number;
  lowPrice: number;
  dataTime: string;
  dealStockAmount: number;
  dealMoney: number;
  limitUpPrice: number;
  limitDownPrice: number;
  turnOverRate: number;
  circulationValue: number;
  totalValue: number;
}

export interface MCPCompanyProfile {
  stockCode: string;
  stockName: string;
  companyName: string;
  companyNameEn: string;
  registeredCapital: number;
  mainBusiness: string;
  officeAddress: string;
  registeredAddress: string;
  contactPerson1: string;
  contactPhone1: string;
}

export interface MCPAnnouncement {
  ANNOUNCEMENTID: number;
  ANNOUNCEMENTTITLE: string;
  ANNOUNCEMENTDATE: string;
  ANNOUNCEMENTTYPE: string;
  ANNOUNCEMENTTYPECODE: string;
}

export interface MCPFinanceProfit {
  stockCode: string;
  stockName: string;
  f1200: number;  // 毛利率
  f1210: number;  // 营业利润率
  f1220: number;  // 净利率
  f1230: number;  // ROE
  f1240: number;  // ROA
  f1250: number;  // 资本回报率
  f1260: number;  // 杜邦ROE
  f1270: number;  // 资产周转率
  f1280: number;  // 权益乘数
  f1290: number;  // 营业利润率(杜邦)
  reportDate: string;
}

export interface MCPFinanceGrowth {
  stockCode: string;
  stockName: string;
  f1400: number;  // 每股收益增长率
  f1410: number;  // 每股收入增长率
  f1420: number;  // 总收入增长率
  f1430: number;  // 每股股息增长率
  reportDate: string;
}

export interface MCPFinanceStrength {
  stockCode: string;
  stockName: string;
  f1600: number;  // 现金负债率
  f1610: number;  // 股东权益比率
  f1620: number;  // 利息保障倍数
  f1630: number;  // 基本面趋势
  f1640: number;  // 破产风险
  f1650: number;  // 财务造假嫌疑
  reportDate: string;
}

export interface MCPFinanceValuation {
  stockCode: string;
  stockName: string;
  f2250: string;  // 市盈率PE
  f2260: string;  // 市净率PB
  f2270: string;  // 市销率PS
  f2280: string;  // 企业价值倍数EV/EBITDA
  f2290: string;  // 股息率
  f2300: string;  // 股息支付率
  reportDate: string;
}

export interface MCPStockScore {
  stockCode: string;
  stockName: string;
  sentimentScore: number;
  financeScore: number;
  trackScore: number;
  techScore: number;
  sentimentScoreAvg: number;
  financeScoreAvg: number;
  trackScoreAvg: number;
  techScoreAvg: number;
  induCode3: string;
  induName3: string;
}

export interface MCPQuoteHistory {
  STOCKCODE: string;
  STOCKNAME: string;
  QUOTETIME: string;
  OPENPRICE: number;
  HIGHPRICE: number;
  LOWPRICE: number;
  CLOSEPRICE: number;
  DEALSTOCKAMOUNT: number;
  DEALMONEY: number;
}

export class InvestodayMCPClient {
  private apiKey: string;
  private baseUrl: string = 'https://data-api.investoday.net/data/mcp/preset';
  private requestId: number = 0;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  private async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requestId++;
    const url = `${this.baseUrl}?apiKey=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.requestId,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP error: ${response.status}`);
    }

    const data = await response.json() as {
      jsonrpc: string;
      id: number;
      result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
      error?: { code: number; message: string };
    };

    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }

    if (!data.result) {
      throw new Error('MCP response missing result');
    }

    if (data.result.isError) {
      const text = data.result.content[0]?.text || 'Unknown MCP tool error';
      throw new Error(`MCP tool error: ${text}`);
    }

    // 解析文本内容为 JSON
    const textContent = data.result.content[0]?.text;
    if (!textContent) {
      return {};
    }

    try {
      return JSON.parse(textContent);
    } catch {
      return { raw: textContent };
    }
  }

  // ========== 工具调用封装 ==========

  /**
   * 实体识别 - 从自然语言提取股票代码
   */
  async recognizeEntity(input: string): Promise<{ code: string; name: string; type: string; correlation?: number } | null> {
    const result = await this.call('tools/call', {
      name: 'entity_recognition',
      arguments: { input },
    }) as { entities?: Array<{ code: string; name: string; type: string }> };

    const stock = result.entities?.find(e => e.type === 'stock');
    return stock || null;
  }

  /**
   * 获取股票基本信息
   */
  async getStockBasicInfo(stockCode: string): Promise<MCPStockBasicInfo | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_basic_info',
      arguments: { stockCode },
    }) as { code: number; data?: MCPStockBasicInfo[]; message: string };

    if (result.code !== 0 || !result.data || result.data.length === 0) {
      return null;
    }
    return result.data[0];
  }

  /**
   * 获取实时行情
   */
  async getRealtimeQuote(stockCode: string): Promise<MCPRealtimeQuote | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_quote_realtime',
      arguments: { stockCode },
    }) as { code?: string; data?: MCPRealtimeQuote };

    if (result.code !== 'Success' || !result.data) {
      return null;
    }
    return result.data;
  }

  /**
   * 获取公司概况
   */
  async getCompanyProfile(stockCode: string): Promise<MCPCompanyProfile | null> {
    const result = await this.call('tools/call', {
      name: 'get_company_profiles',
      arguments: { stockCode },
    }) as { data?: MCPCompanyProfile[] };

    return result.data?.[0] || null;
  }

  /**
   * 获取公告列表
   */
  async listAnnouncements(stockCode: string, beginDate: string = '2025-01-01', pageSize: number = 20): Promise<MCPAnnouncement[]> {
    const result = await this.call('tools/call', {
      name: 'list_announcements',
      arguments: { stockCode, beginDate, pageSize },
    }) as { data?: MCPAnnouncement[]; total?: number };

    return result.data || [];
  }

  /**
   * 获取盈利能力
   */
  async getProfitAbility(stockCode: string): Promise<MCPFinanceProfit | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_finance_profit_ability',
      arguments: { stockCode },
    }) as { data?: MCPFinanceProfit };

    return result.data || null;
  }

  /**
   * 获取成长能力
   */
  async getGrowthAbility(stockCode: string): Promise<MCPFinanceGrowth | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_finance_growth_ability',
      arguments: { stockCode },
    }) as { data?: MCPFinanceGrowth };

    return result.data || null;
  }

  /**
   * 获取财务实力
   */
  async getFinancialStrength(stockCode: string): Promise<MCPFinanceStrength | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_finance_strength',
      arguments: { stockCode },
    }) as { data?: MCPFinanceStrength };

    return result.data || null;
  }

  /**
   * 获取估值指标
   */
  async getValuation(stockCode: string): Promise<MCPFinanceValuation | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_finance_valuation',
      arguments: { stockCode },
    }) as { data?: MCPFinanceValuation };

    return result.data || null;
  }

  /**
   * 获取综合评分
   */
  async getStockScore(stockCode: string): Promise<MCPStockScore | null> {
    const result = await this.call('tools/call', {
      name: 'get_stock_score',
      arguments: { stockCode },
    }) as { data?: MCPStockScore };

    return result.data || null;
  }

  /**
   * 获取历史行情（复权）
   */
  async listAdjustedQuotes(stockCode: string, beginDate: string, endDate: string): Promise<MCPQuoteHistory[]> {
    const result = await this.call('tools/call', {
      name: 'list_stock_adjusted_quotes',
      arguments: { stockCode, beginDate, endDate },
    }) as { data?: MCPQuoteHistory[] };

    return result.data || [];
  }

  /**
   * 获取相关新闻
   */
  async listRelatedNews(stockCode: string, pageSize: number = 10): Promise<unknown[]> {
    const result = await this.call('tools/call', {
      name: 'list_entity_related_news',
      arguments: { stockCode, pageSize },
    }) as { data?: unknown[] };

    return result.data || [];
  }

  /**
   * 获取研报预测评级
   */
  async listForecastRatings(stockCode: string, pageSize: number = 10): Promise<unknown[]> {
    const result = await this.call('tools/call', {
      name: 'list_report_stock_forecast_ratings',
      arguments: { stockCode, pageSize },
    }) as { data?: unknown[] };

    return result.data || [];
  }
}
