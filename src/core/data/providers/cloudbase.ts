import { DataProvider } from './base';
import { InvestodayMCPProvider } from './investoday-mcp';
import { getEnvString } from '../../utils/env';
import type { StockInfo, MarketData, FinancialMetrics, Announcement, StockDataBundle } from '../../types/stock';

/**
 * CloudBase 云函数代理数据提供者
 * 
 * 通过 CloudBase SCF 云函数转发 MCP 请求到 investoday API
 * 优势:
 * 1. API Key 存储在云函数环境变量中，前端不暴露
 * 2. 解决浏览器跨域限制
 * 3. 复用 InvestodayMCPProvider 的所有逻辑，只是 baseUrl 指向云函数代理
 */
export class CloudBaseProvider extends DataProvider {
  private inner: InvestodayMCPProvider;

  constructor(baseUrl?: string) {
    super('cloudbase', '1.0.0');
    const url = baseUrl || getEnvString('VITE_CLOUDBASE_API_URL');
    // CloudBase proxy 不需要 apiKey（key 在云函数环境变量中）
    this.inner = new InvestodayMCPProvider('', url);
  }

  setBaseUrl(url: string): void {
    this.inner = new InvestodayMCPProvider('', url);
  }

  async fetchStockInfo(code: string): Promise<StockInfo> {
    return this.inner.fetchStockInfo(code);
  }

  async fetchMarketData(code: string): Promise<MarketData> {
    return this.inner.fetchMarketData(code);
  }

  async fetchFinancialMetrics(code: string): Promise<FinancialMetrics> {
    return this.inner.fetchFinancialMetrics(code);
  }

  async fetchAnnouncements(code: string, limit: number = 20): Promise<Announcement[]> {
    return this.inner.fetchAnnouncements(code, limit);
  }

  async searchStocks(query: string): Promise<StockInfo[]> {
    return this.inner.searchStocks(query);
  }

  async fetchBundle(code: string): Promise<StockDataBundle> {
    return this.inner.fetchBundle(code);
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }> {
    const start = performance.now();
    try {
      const url = getEnvString('VITE_CLOUDBASE_API_URL');
      if (!url) {
        return { healthy: false, latency: 0, message: 'CloudBase URL not configured' };
      }
      // 云函数 health check
      const response = await fetch(`${url}/health`);
      const data = await response.json();
      if (!data.healthy) {
        return { healthy: false, latency: Math.round(performance.now() - start), message: 'Proxy unhealthy' };
      }
      // 再测试 MCP 连通性
      const innerCheck = await this.inner.healthCheck();
      return {
        healthy: innerCheck.healthy,
        latency: Math.round(performance.now() - start),
        message: innerCheck.message || `Proxy ready, MCP: ${innerCheck.healthy ? 'OK' : 'FAIL'}`,
      };
    } catch (e) {
      return { healthy: false, latency: Math.round(performance.now() - start), message: String(e) };
    }
  }
}
