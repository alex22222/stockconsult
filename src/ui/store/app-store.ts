import { create } from 'zustand';
import type { StockInfo, StockDataBundle } from '../../core/types/stock';
import type { AnalysisReport } from '../../core/types/analysis';
import type { PipelineExecutionResult } from '../../core/types/skill';
import { globalDataService } from '../../core/data/data-service';
import { globalSkillRegistry } from '../../core/pipeline/skill-registry';
import { AnalysisPipeline } from '../../core/pipeline/pipeline';
import { ReportGenerator } from '../../core/report-generator';
import { AnnouncementSkill } from '../../core/skills/announcement/announcement-skill';
import { FinancialSkill } from '../../core/skills/financial/financial-skill';
import { ValuationSkill } from '../../core/skills/valuation/valuation-skill';
import { logSearch } from '../../core/data/search-logger';
import { logReport } from '../../core/data/report-logger';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

// 默认热门股票
const DEFAULT_HOT_STOCKS: StockInfo[] = [
  { code: '600519', name: '贵州茅台', exchange: 'SSE', industry: '白酒', marketCap: 0 },
  { code: '000858', name: '五粮液', exchange: 'SZSE', industry: '白酒', marketCap: 0 },
  { code: '300750', name: '宁德时代', exchange: 'SZSE', industry: '动力电池', marketCap: 0 },
  { code: '000333', name: '美的集团', exchange: 'SZSE', industry: '白色家电', marketCap: 0 },
  { code: '601318', name: '中国平安', exchange: 'SSE', industry: '保险', marketCap: 0 },
  { code: '600036', name: '招商银行', exchange: 'SSE', industry: '银行', marketCap: 0 },
  { code: '002594', name: '比亚迪', exchange: 'SZSE', industry: '汽车', marketCap: 0 },
  { code: '00700', name: '腾讯控股', exchange: 'HKEX', industry: '互联网', marketCap: 0 },
];

// 初始化注册内置Skills
function initSkills() {
  if (globalSkillRegistry.getAll().length === 0) {
    globalSkillRegistry.register(new AnnouncementSkill());
    globalSkillRegistry.register(new FinancialSkill());
    globalSkillRegistry.register(new ValuationSkill());
  }
}
initSkills();

export type LoadingState = 'idle' | 'searching' | 'analyzing' | 'completed' | 'error';

interface AppState {
  // 搜索状态
  query: string;
  searchResults: StockInfo[];
  selectedStock: StockInfo | null;
  
  // 加载状态
  loadingState: LoadingState;
  errorMessage: string | null;
  progress: number; // 0-100
  
  // 分析结果
  dataBundle: StockDataBundle | null;
  pipelineResult: PipelineExecutionResult | null;
  report: AnalysisReport | null;
  
  // 历史记录
  history: StockInfo[];

  // 热门股票（查询自动添加）
  hotStocks: StockInfo[];

  // 我的收藏（最多10个）
  favorites: StockInfo[];

  // 设置
  activeProvider: 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase';
  apiKey: string;

  // 主题
  theme: 'light' | 'dark';

  // 查询记录
  showRecordsPage: boolean;

  // 占卜师频道
  showFortunePage: boolean;

  // 模型原理说明
  showModelDocPage: boolean;

  // 露笑科技预测历史
  showLuxiaoHistoryPage: boolean;

  // 策略锐评
  showStrategyAdvisorPage: boolean;

  // 模拟盘
  showPaperTradingPage: boolean;

  // 爆破力扫描
  showMomentumScanPage: boolean;

  // 策略重建
  showStrategyRebuildPage: boolean;

  // Actions
  setQuery: (query: string) => void;
  searchStocks: (query: string) => Promise<void>;
  selectStock: (stock: StockInfo) => void;
  analyzeStock: (code: string) => Promise<void>;
  clearResults: () => void;
  setProvider: (provider: 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase') => void;
  setApiKey: (key: string) => void;
  addToHistory: (stock: StockInfo) => void;
  toggleRecordsPage: (show?: boolean) => void;
  toggleFortunePage: (show?: boolean) => void;
  toggleModelDocPage: (show?: boolean) => void;
  toggleLuxiaoHistoryPage: (show?: boolean) => void;
  toggleStrategyAdvisorPage: (show?: boolean) => void;
  togglePaperTradingPage: (show?: boolean) => void;
  toggleMomentumScanPage: (show?: boolean) => void;
  toggleStrategyRebuildPage: (show?: boolean) => void;
  navigateTo: (page: 'search' | 'records' | 'fortune' | 'modelDoc' | 'luxiao' | 'strategy' | 'paperTrading' | 'momentum' | 'strategyRebuild' | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  addToHotStocks: (stock: StockInfo) => void;
  addToFavorites: (stock: StockInfo) => Promise<boolean>;
  removeFromFavorites: (code: string) => Promise<void>;
  isFavorite: (code: string) => boolean;
  loadFavorites: () => Promise<void>;
}

const initialProvider = (import.meta.env.VITE_DATA_PROVIDER as 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase') || 'mock';

// 同步 provider 到全局数据服务
try {
  globalDataService.setActiveProvider(initialProvider);
} catch (e) {
  console.warn('[AppStore] Failed to set initial provider:', e);
}

export const useAppStore = create<AppState>((set, get) => ({
  query: '',
  searchResults: [],
  selectedStock: null,
  loadingState: 'idle',
  errorMessage: null,
  progress: 0,
  dataBundle: null,
  pipelineResult: null,
  report: null,
  history: [],
  hotStocks: [...DEFAULT_HOT_STOCKS],
  favorites: [],
  activeProvider: initialProvider,
  apiKey: import.meta.env.VITE_INVESTODAY_API_KEY || '',
  theme: (localStorage.getItem('stockconsult-theme') as 'light' | 'dark') || 'light',
  showRecordsPage: false,
  showFortunePage: false,
  showModelDocPage: false,
  showLuxiaoHistoryPage: false,
  showStrategyAdvisorPage: false,
  showPaperTradingPage: false,
  showMomentumScanPage: false,
  showStrategyRebuildPage: false,

  setQuery: (query) => set({ query }),

  searchStocks: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    set({ loadingState: 'searching', errorMessage: null, progress: 10 });
    try {
      const results = await globalDataService.searchStocks(query.trim());
      set({ searchResults: results, loadingState: 'idle', progress: 0 });
      // 搜索到的股票自动加入热门
      results.forEach(r => get().addToHotStocks(r));
      // 落库查询记录（静默失败，不阻塞）
      logSearch(query.trim(), results.map(r => ({ code: r.code, name: r.name }))).catch(() => {});
    } catch (error) {
      set({ 
        loadingState: 'error', 
        errorMessage: error instanceof Error ? error.message : '搜索失败',
        progress: 0 
      });
    }
  },

  selectStock: (stock) => {
    set({ selectedStock: stock, query: stock.name });
    get().addToHistory(stock);
    get().addToHotStocks(stock);
    // 落库查询记录（点击热门股票、历史记录、搜索结果时也会记录）
    logSearch(stock.name, [{ code: stock.code, name: stock.name }]).catch(() => {});
  },

  analyzeStock: async (code) => {
    set({ loadingState: 'analyzing', errorMessage: null, progress: 20 });
    
    try {
      // 1. 获取数据
      set({ progress: 30 });
      const dataBundle = await globalDataService.fetchBundle(code);
      set({ dataBundle, progress: 50 });

      // 2. 执行分析流水线
      const pipeline = new AnalysisPipeline(globalSkillRegistry);
      const pipelineResult = await pipeline.execute(
        {
          id: 'default-analysis',
          name: '默认分析流水线',
          stages: [
            { id: 'stage1', name: '数据提取', skillIds: ['announcement-analyzer', 'financial-analyzer'], parallel: true },
            { id: 'stage2', name: '估值分析', skillIds: ['valuation-framework'], parallel: false },
          ],
        },
        code,
        dataBundle
      );
      set({ pipelineResult, progress: 80 });

      // 3. 生成报告
      const report = ReportGenerator.generate(dataBundle.info, dataBundle, pipelineResult);
      set({ report, loadingState: 'completed', progress: 100 });

      // 4. 保存完整分析报告到 COS（静默失败）
      const currentQuery = get().query || dataBundle.info.name;
      logReport(currentQuery, report, dataBundle).catch(() => {});

    } catch (error) {
      set({
        loadingState: 'error',
        errorMessage: error instanceof Error ? error.message : '分析失败',
        progress: 0,
      });
    }
  },

  clearResults: () => set({
    selectedStock: null,
    dataBundle: null,
    pipelineResult: null,
    report: null,
    loadingState: 'idle',
    errorMessage: null,
    progress: 0,
  }),

  setProvider: (provider) => {
    globalDataService.setActiveProvider(provider);
    set({ activeProvider: provider });
  },

  setApiKey: (key) => {
    globalDataService.setInvestodayApiKey(key);
    set({ apiKey: key });
  },

  addToHistory: (stock) => {
    set((state) => ({
      history: [stock, ...state.history.filter(s => s.code !== stock.code)].slice(0, 10),
    }));
  },

  toggleRecordsPage: (show) => {
    set((state) => ({
      showRecordsPage: show !== undefined ? show : !state.showRecordsPage,
    }));
  },

  toggleFortunePage: (show) => {
    set((state) => ({
      showFortunePage: show !== undefined ? show : !state.showFortunePage,
    }));
  },

  toggleModelDocPage: (show) => {
    set((state) => ({
      showModelDocPage: show !== undefined ? show : !state.showModelDocPage,
    }));
  },

  toggleLuxiaoHistoryPage: (show) => {
    set((state) => ({
      showLuxiaoHistoryPage: show !== undefined ? show : !state.showLuxiaoHistoryPage,
    }));
  },

  toggleStrategyAdvisorPage: (show) => {
    set((state) => ({
      showStrategyAdvisorPage: show !== undefined ? show : !state.showStrategyAdvisorPage,
    }));
  },

  togglePaperTradingPage: (show) => {
    set((state) => ({
      showPaperTradingPage: show !== undefined ? show : !state.showPaperTradingPage,
    }));
  },

  toggleMomentumScanPage: (show) => {
    set((state) => ({
      showMomentumScanPage: show !== undefined ? show : !state.showMomentumScanPage,
    }));
  },

  toggleStrategyRebuildPage: (show) => {
    set((state) => ({
      showStrategyRebuildPage: show !== undefined ? show : !state.showStrategyRebuildPage,
    }));
  },

  navigateTo: (page) => {
    set({
      showRecordsPage: page === 'records',
      showFortunePage: page === 'fortune',
      showModelDocPage: page === 'modelDoc',
      showLuxiaoHistoryPage: page === 'luxiao',
      showStrategyAdvisorPage: page === 'strategy',
      showPaperTradingPage: page === 'paperTrading',
      showMomentumScanPage: page === 'momentum',
      showStrategyRebuildPage: page === 'strategyRebuild',
    });
  },

  setTheme: (theme) => {
    localStorage.setItem('stockconsult-theme', theme);
    set({ theme });
  },

  addToHotStocks: (stock) => {
    set((state) => ({
      hotStocks: [stock, ...state.hotStocks.filter(s => s.code !== stock.code)].slice(0, 12),
    }));
  },

  addToFavorites: async (stock) => {
    const state = get();
    if (state.favorites.some(s => s.code === stock.code)) return false;

    // 乐观更新本地状态
    set((s) => ({ favorites: [stock, ...s.favorites].slice(0, 10) }));

    // 同步到数据库（静默失败）
    if (CLOUDBASE_API_URL) {
      try {
        const res = await fetch(`${CLOUDBASE_API_URL}/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stock),
        });
        const data = await res.json();
        if (!data.success && data.error) {
          console.warn('[Favorites] DB add failed:', data.error);
        }
      } catch (e) {
        console.warn('[Favorites] DB add error:', e);
      }
    }
    return true;
  },

  removeFromFavorites: async (code) => {
    // 乐观更新本地状态
    set((state) => ({
      favorites: state.favorites.filter(s => s.code !== code),
    }));

    // 同步到数据库（静默失败）
    if (CLOUDBASE_API_URL) {
      try {
        await fetch(`${CLOUDBASE_API_URL}/favorites?code=${encodeURIComponent(code)}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('[Favorites] DB remove error:', e);
      }
    }
  },

  isFavorite: (code) => {
    return get().favorites.some(s => s.code === code);
  },

  loadFavorites: async () => {
    if (!CLOUDBASE_API_URL) return;
    try {
      const res = await fetch(`${CLOUDBASE_API_URL}/favorites`);
      const data = await res.json();
      if (data.success && Array.isArray(data.favorites)) {
        const mapped: StockInfo[] = data.favorites.map((f: any) => ({
          code: f.code,
          name: f.name,
          industry: f.industry || '',
          exchange: (f.exchange || 'SSE') as StockInfo['exchange'],
          marketCap: f.marketCap || 0,
        }));
        set({ favorites: mapped });
      }
    } catch (e) {
      console.warn('[Favorites] Load failed:', e);
    }
  },
}));
