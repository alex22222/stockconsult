import type { StockInfo, MarketData, FinancialMetrics, Announcement, StockDataBundle } from '../../types/stock';

/**
 * 数据提供者抽象基类
 * 所有数据源（REST API、MCP、Mock）需实现此接口
 */
export abstract class DataProvider {
  readonly name: string;
  readonly version: string;
  protected enabled: boolean = true;

  constructor(name: string, version: string) {
    this.name = name;
    this.version = version;
  }

  abstract fetchStockInfo(code: string): Promise<StockInfo>;
  abstract fetchMarketData(code: string): Promise<MarketData>;
  abstract fetchFinancialMetrics(code: string): Promise<FinancialMetrics>;
  abstract fetchAnnouncements(code: string, limit?: number): Promise<Announcement[]>;

  /**
   * 批量获取完整数据包
   * 默认实现为并行获取各维度数据
   */
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

  /**
   * 搜索股票（名称/代码模糊匹配）
   */
  abstract searchStocks(query: string): Promise<StockInfo[]>;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 健康检查
   */
  abstract healthCheck(): Promise<{ healthy: boolean; latency: number; message?: string }>;
}
