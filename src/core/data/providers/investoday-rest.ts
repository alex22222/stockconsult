import { DataProvider } from './base';
import type { StockInfo, MarketData, FinancialMetrics, Announcement } from '../../types/stock';

/**
 * Investoday REST API 数据提供者
 * 
 * API文档参考: https://data-api.investoday.net/
 * 需要在设置中配置 API Key
 * 
 * 当前实现为框架预留，真实调用需要：
 * 1. 注册 investoday.net 获取 API Key
 * 2. 在设置面板配置 key
 * 3. 取消注释 fetch 调用逻辑
 */
export class InvestodayRESTProvider extends DataProvider {
  private apiKey: string;
  readonly baseUrl: string = 'https://data-api.investoday.net/api';

  constructor(apiKey: string = '') {
    super('investoday-rest', '1.0.0');
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async request<T>(_endpoint: string, _params?: Record<string, string>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Investoday API Key not configured. Please set it in Settings.');
    }
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async fetchStockInfo(_code: string): Promise<StockInfo> {
    // TODO: 接入真实API
    // const data = await this.request<any>('/stock/info', { code });
    // return { ... }
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async fetchMarketData(_code: string): Promise<MarketData> {
    // TODO: 接入真实API
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async fetchFinancialMetrics(_code: string): Promise<FinancialMetrics> {
    // TODO: 接入真实API
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async fetchAnnouncements(_code: string, _limit: number = 20): Promise<Announcement[]> {
    // TODO: 接入真实API
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async searchStocks(_query: string): Promise<StockInfo[]> {
    // TODO: 接入真实API
    throw new Error('Investoday REST API not yet implemented. Use MockProvider for now.');
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      if (!this.apiKey) {
        return { healthy: false, latency: 0, message: 'API Key not configured' };
      }
      // 预留：真实健康检查可调用 this.request('/health')
      void this.request;
      return { healthy: true, latency: Math.round(performance.now() - start), message: 'Ready' };
    } catch (e) {
      return { healthy: false, latency: Math.round(performance.now() - start), message: String(e) };
    }
  }
}
