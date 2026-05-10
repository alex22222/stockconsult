/**
 * 缓存服务
 * 基于 localStorage + Memory Cache 的两级缓存
 * 后续可升级为 IndexedDB
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

export class CacheService {
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map();
  private prefix: string = 'stockconsult:';
  private enabled: boolean = true;

  constructor(prefix?: string) {
    if (prefix) this.prefix = prefix;
  }

  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    if (!this.enabled) return null;

    const fullKey = this.prefix + key;
    
    // 先查内存
    const memEntry = this.memoryCache.get(fullKey) as CacheEntry<T> | undefined;
    if (memEntry && !this.isExpired(memEntry)) {
      return memEntry.data;
    }

    // 再查 localStorage
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored) {
        const entry: CacheEntry<T> = JSON.parse(stored);
        if (!this.isExpired(entry)) {
          // 回填内存
          this.memoryCache.set(fullKey, entry);
          return entry.data;
        }
      }
    } catch {
      // localStorage 不可用或数据损坏
    }

    return null;
  }

  /**
   * 设置缓存
   */
  set<T>(key: string, data: T, ttlMinutes: number = 30): void {
    if (!this.enabled) return;

    const fullKey = this.prefix + key;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMinutes * 60 * 1000,
    };

    // 写入内存
    this.memoryCache.set(fullKey, entry);

    // 写入 localStorage
    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // localStorage 已满或不可用
    }
  }

  /**
   * 删除缓存
   */
  remove(key: string): void {
    const fullKey = this.prefix + key;
    this.memoryCache.delete(fullKey);
    try {
      localStorage.removeItem(fullKey);
    } catch { /* noop */ }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.memoryCache.clear();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    } catch { /* noop */ }
  }

  /**
   * 设置是否启用缓存
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
}

// 全局单例
export const globalCache = new CacheService();
