import { DataProvider } from './providers/base';
import { MockProvider } from './providers/mock';
import { InvestodayRESTProvider } from './providers/investoday-rest';
import { InvestodayMCPProvider } from './providers/investoday-mcp';
import { CloudBaseProvider } from './providers/cloudbase';
import { CacheService } from './cache-service';
import type { StockInfo, StockDataBundle } from '../types/stock';

export type ProviderName = 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase';

/**
 * 统一数据服务
 * 管理多个Provider，提供统一的查询入口、缓存策略、降级机制
 */
export class DataService {
  private providers: Map<ProviderName, DataProvider> = new Map();
  private activeProvider: ProviderName = 'mock';
  private cache: CacheService;
  private fallbackEnabled: boolean = true;

  constructor(cache?: CacheService) {
    this.cache = cache || new CacheService();
    
    // 注册默认Provider
    this.registerProvider('mock', new MockProvider());
    this.registerProvider('investoday-rest', new InvestodayRESTProvider());
    this.registerProvider('investoday-mcp', new InvestodayMCPProvider());
    this.registerProvider('cloudbase', new CloudBaseProvider());
  }

  registerProvider(name: ProviderName, provider: DataProvider): void {
    this.providers.set(name, provider);
  }

  setActiveProvider(name: ProviderName): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not registered.`);
    }
    this.activeProvider = name;
  }

  getActiveProvider(): ProviderName {
    return this.activeProvider;
  }

  getProvider(name: ProviderName): DataProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 搜索股票
   */
  async searchStocks(query: string): Promise<StockInfo[]> {
    const cacheKey = `search:${query}`;
    const cached = this.cache.get<StockInfo[]>(cacheKey);
    if (cached) return cached;

    try {
      const provider = this.providers.get(this.activeProvider)!;
      const results = await provider.searchStocks(query);
      this.cache.set(cacheKey, results, 10); // 搜索缓存10分钟
      return results;
    } catch (error) {
      if (this.fallbackEnabled && this.activeProvider !== 'mock') {
        console.warn('[DataService] Primary provider failed, falling back to mock:', error);
        const mock = this.providers.get('mock')!;
        return mock.searchStocks(query);
      }
      throw error;
    }
  }

  /**
   * 获取股票完整数据包
   */
  async fetchBundle(code: string): Promise<StockDataBundle> {
    const cacheKey = `bundle:${code}`;
    const cached = this.cache.get<StockDataBundle>(cacheKey);
    if (cached) {
      console.log(`[DataService] Cache hit for ${code}`);
      return cached;
    }

    try {
      const provider = this.providers.get(this.activeProvider)!;
      const bundle = await provider.fetchBundle(code);
      this.cache.set(cacheKey, bundle, 15); // 数据缓存15分钟
      return bundle;
    } catch (error) {
      if (this.fallbackEnabled && this.activeProvider !== 'mock') {
        console.warn('[DataService] Primary provider failed, falling back to mock:', error);
        const mock = this.providers.get('mock')!;
        const bundle = await mock.fetchBundle(code);
        this.cache.set(cacheKey, bundle, 15);
        return bundle;
      }
      throw error;
    }
  }

  /**
   * 配置Investoday API Key
   */
  setInvestodayApiKey(key: string): void {
    const restProvider = this.providers.get('investoday-rest') as InvestodayRESTProvider;
    if (restProvider) {
      restProvider.setApiKey(key);
    }
    const mcpProvider = this.providers.get('investoday-mcp') as InvestodayMCPProvider;
    if (mcpProvider) {
      mcpProvider.setApiKey(key);
    }
  }

  /**
   * 配置 CloudBase 代理地址
   */
  setCloudBaseUrl(url: string): void {
    const provider = this.providers.get('cloudbase') as CloudBaseProvider;
    if (provider) {
      provider.setBaseUrl(url);
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ provider: ProviderName; healthy: boolean; message: string }[]> {
    const results = [];
    for (const [name, provider] of this.providers) {
      try {
        const check = await provider.healthCheck();
        results.push({ provider: name as ProviderName, healthy: check.healthy, message: check.message || `Latency: ${check.latency}ms` });
      } catch (e) {
        results.push({ provider: name as ProviderName, healthy: false, message: String(e) });
      }
    }
    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// 全局单例
export const globalDataService = new DataService();
