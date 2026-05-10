import { DataProvider } from './base';
import type { StockInfo, MarketData, FinancialMetrics, Announcement } from '../../types/stock';

/**
 * Investoday REST API 数据提供者
 * 
 * API文档参考: https://data-api.investoday.net/
 * 需要在设置中配置 API Key
 * 
 * ⚠️ 重要说明:
 * 当前实现为框架预留， investoday 的具体 REST API 端点格式
 * 需根据官方文档确认后完善。当前已配置 API Key，接口调用逻辑待补充。
 * 
 * 已知信息:
 * - Base URL: https://data-api.investoday.net
 * - 认证方式: Authorization: Bearer <API_KEY>
 * - 覆盖: A股/港股/基金/指数/宏观经济 200+接口
 * 
 * 建议接入步骤:
 * 1. 确认 investoday REST API 文档中的具体端点路径
 * 2. 完善本文件中的 fetchStockInfo/fetchMarketData 等方法
 * 3. 或使用 CloudBase 云函数代理方式（更安全）
 */
export class InvestodayRESTProvider extends DataProvider {
  private apiKey: string;
  readonly baseUrl: string = 'https://data-api.investoday.net';

  constructor(apiKey: string = '') {
    super('investoday-rest', '1.0.0');
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * 通用请求方法
   * TODO: 根据 investoday 实际 API 文档调整 endpoint 格式
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Investoday API Key not configured. Please set it in Settings or .env file.');
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Investoday API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async fetchStockInfo(_code: string): Promise<StockInfo> {
    // TODO: 根据 investoday 实际端点调整
    // 示例: return this.request<StockInfo>('/api/stock/info', { code });
    throw new Error(
      'Investoday REST API endpoint not configured. ' +
      'Please check investoday API docs and update investoday-rest.ts. ' +
      'Current API Key is set, but endpoint paths need confirmation.'
    );
  }

  async fetchMarketData(_code: string): Promise<MarketData> {
    // TODO: 根据 investoday 实际端点调整
    throw new Error('Investoday REST API endpoint not configured. Use MockProvider or CloudBase provider for now.');
  }

  async fetchFinancialMetrics(_code: string): Promise<FinancialMetrics> {
    // TODO: 根据 investoday 实际端点调整
    throw new Error('Investoday REST API endpoint not configured. Use MockProvider or CloudBase provider for now.');
  }

  async fetchAnnouncements(_code: string, _limit: number = 20): Promise<Announcement[]> {
    // TODO: 根据 investoday 实际端点调整
    throw new Error('Investoday REST API endpoint not configured. Use MockProvider or CloudBase provider for now.');
  }

  async searchStocks(_query: string): Promise<StockInfo[]> {
    // TODO: 根据 investoday 实际端点调整
    throw new Error('Investoday REST API endpoint not configured. Use MockProvider or CloudBase provider for now.');
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      if (!this.apiKey) {
        return { healthy: false, latency: 0, message: 'API Key not configured' };
      }
      // 预留：真实健康检查
      void this.request;
      return { healthy: true, latency: Math.round(performance.now() - start), message: 'API Key configured, endpoints pending' };
    } catch (e) {
      return { healthy: false, latency: Math.round(performance.now() - start), message: String(e) };
    }
  }
}
