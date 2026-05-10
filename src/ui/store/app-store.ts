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
  
  // 设置
  activeProvider: 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase';
  apiKey: string;
  
  // Actions
  setQuery: (query: string) => void;
  searchStocks: (query: string) => Promise<void>;
  selectStock: (stock: StockInfo) => void;
  analyzeStock: (code: string) => Promise<void>;
  clearResults: () => void;
  setProvider: (provider: 'mock' | 'investoday-rest') => void;
  setApiKey: (key: string) => void;
  addToHistory: (stock: StockInfo) => void;
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
  activeProvider: (import.meta.env.VITE_DATA_PROVIDER as 'mock' | 'investoday-rest' | 'investoday-mcp' | 'cloudbase') || 'mock',
  apiKey: import.meta.env.VITE_INVESTODAY_API_KEY || '',

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
}));
