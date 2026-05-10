import { DataProvider } from './base';
import type { StockInfo, MarketData, FinancialMetrics, Announcement } from '../../types/stock';

/**
 * CloudBase 云函数代理数据提供者
 * 
 * 通过 CloudBase SCF 云函数转发请求到 investoday API
 * 优势:
 * 1. API Key 存储在云函数环境变量中，前端不暴露
 * 2. 解决浏览器跨域限制
 * 3. 可利用 CloudBase 的 CDN 和缓存能力
 */
export class CloudBaseProvider extends DataProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    super('cloudbase', '1.0.0');
    // 优先使用传入的URL，其次环境变量，最后fallback
    this.baseUrl = baseUrl 
      || import.meta.env.VITE_CLOUDBASE_API_URL 
      || '';
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  private async request<T>(apiPath: string, params?: Record<string, string>): Promise<T> {
    if (!this.baseUrl) {
      throw new Error('CloudBase API URL not configured. Please set VITE_CLOUDBASE_API_URL in .env');
    }

    const url = new URL(`${this.baseUrl}/api${apiPath}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `CloudBase proxy error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async fetchStockInfo(code: string): Promise<StockInfo> {
    return this.request<StockInfo>('/stock/info', { code });
  }

  async fetchMarketData(code: string): Promise<MarketData> {
    return this.request<MarketData>('/stock/market', { code });
  }

  async fetchFinancialMetrics(code: string): Promise<FinancialMetrics> {
    return this.request<FinancialMetrics>('/stock/financial', { code });
  }

  async fetchAnnouncements(code: string, limit: number = 20): Promise<Announcement[]> {
    return this.request<Announcement[]>('/stock/announcements', { code, limit: String(limit) });
  }

  async searchStocks(query: string): Promise<StockInfo[]> {
    return this.request<StockInfo[]>('/stock/search', { query });
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      if (!this.baseUrl) {
        return { healthy: false, latency: 0, message: 'CloudBase URL not configured' };
      }
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      return { 
        healthy: data.healthy, 
        latency: Math.round(performance.now() - start),
        message: data.keyConfigured ? 'Proxy ready with API Key' : 'Proxy ready but API Key missing',
      };
    } catch (e) {
      return { healthy: false, latency: Math.round(performance.now() - start), message: String(e) };
    }
  }
}
