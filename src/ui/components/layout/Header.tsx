import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, BarChart3, BrainCircuit, ChevronDown, Clock3, FileText, FlaskConical,
  Home, Moon, PiggyBank, Search, Settings, Sun, TrendingDown, TrendingUp, Zap,
} from 'lucide-react';
import { useAppStore } from '../../store/app-store';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

interface MarketIndex {
  code: string;
  name: string;
  region: string;
  price: number;
  change: number;
  changePercent: number;
  status: string;
}

type PageKey = 'landing' | 'strategyRebuild' | 'momentum' | 'paperTrading' | 'modelDoc' | 'records' | 'search';

function IndexItem({ index }: { index: MarketIndex }) {
  if (index.status !== 'ok' || index.price === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{index.name}</span>
        <span className="text-[11px] text-gray-300 dark:text-gray-600">--</span>
      </span>
    );
  }

  const isUp = index.change >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1">
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{index.name}</span>
      <span className="font-mono text-[11px] font-semibold text-gray-900 dark:text-gray-100">
        {index.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${isUp ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
        {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isUp ? '+' : ''}{index.changePercent.toFixed(2)}%
      </span>
    </span>
  );
}

function MarketStrip({ indices }: { indices: MarketIndex[] }) {
  const items = indices.filter((i) => i.status === 'ok' && i.price > 0);

  return (
    <div className="border-t border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-950/60">
      <div className="mx-auto flex h-8 max-w-7xl items-center gap-3 px-3 sm:px-4 lg:px-6">
        <div className="hidden items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 sm:flex">
          <Activity className="h-3.5 w-3.5" />
          市场脉搏
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {items.length > 0 ? (
            <div className="flex whitespace-nowrap">
              <div className="animate-marquee flex">
                {items.map((idx) => <IndexItem key={idx.code} index={idx} />)}
                {items.map((idx) => <IndexItem key={`${idx.code}-copy`} index={idx} />)}
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-3 w-24 rounded bg-gray-200/70 dark:bg-gray-800" />
              ))}
            </div>
          )}
        </div>
        <div className="hidden items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 md:flex">
          <Clock3 className="h-3.5 w-3.5" />
          收盘后更新
        </div>
      </div>
    </div>
  );
}

export function Header() {
  const showRecordsPage = useAppStore((s) => s.showRecordsPage);
  const showModelDocPage = useAppStore((s) => s.showModelDocPage);
  const showPaperTradingPage = useAppStore((s) => s.showPaperTradingPage);
  const showMomentumScanPage = useAppStore((s) => s.showMomentumScanPage);
  const showStrategyRebuildPage = useAppStore((s) => s.showStrategyRebuildPage);
  const showLandingPage = useAppStore((s) => s.showLandingPage);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const fetchIndices = useCallback(async () => {
    if (!CLOUDBASE_API_URL) return;
    try {
      const res = await fetch(`${CLOUDBASE_API_URL}/market-indices`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && Array.isArray(data.indices)) {
        setIndices(data.indices);
      }
    } catch (e) {
      console.warn('[MarketIndices] fetch failed:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchIndices(), 0);
    return () => clearTimeout(timer);
  }, [fetchIndices]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activePage: PageKey = showStrategyRebuildPage ? 'strategyRebuild'
    : showMomentumScanPage ? 'momentum'
    : showPaperTradingPage ? 'paperTrading'
    : showModelDocPage ? 'modelDoc'
    : showRecordsPage ? 'records'
    : showLandingPage ? 'landing'
    : 'search';

  const navItems: Array<{ key: PageKey; label: string; icon: typeof Home; tone: string }> = [
    { key: 'landing', label: '总览', icon: Home, tone: 'blue' },
    { key: 'strategyRebuild', label: '策略重建', icon: FlaskConical, tone: 'indigo' },
    { key: 'momentum', label: '机会扫描', icon: Zap, tone: 'red' },
    { key: 'paperTrading', label: '模拟盘', icon: PiggyBank, tone: 'emerald' },
    { key: 'modelDoc', label: '模型说明', icon: BrainCircuit, tone: 'amber' },
    { key: 'records', label: '历史记录', icon: FileText, tone: 'slate' },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
      <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-3 px-3 py-2 sm:px-4 lg:px-6">
        <button
          onClick={() => navigateTo('landing')}
          className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-950">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="hidden min-w-0 sm:block">
            <div className="text-sm font-semibold text-gray-950 dark:text-gray-50">投资座舱</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Research cockpit</div>
          </div>
        </button>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigateTo(item.key)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-800 dark:text-gray-50'
                    : 'text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-100'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${
                  active && item.tone === 'red' ? 'text-red-600' :
                  active && item.tone === 'emerald' ? 'text-emerald-600' :
                  active && item.tone === 'amber' ? 'text-amber-600' :
                  active && item.tone === 'indigo' ? 'text-indigo-600' :
                  active ? 'text-blue-600' :
                  ''
                }`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => navigateTo('search')}
          className="hidden h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900 md:inline-flex"
        >
          <Search className="h-3.5 w-3.5" />
          个股分析
        </button>

        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
            aria-label="界面设置"
          >
            <Settings className="h-4 w-4" />
          </button>

          {showSettings && (
            <div className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">界面模式</span>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <button
                onClick={() => { setTheme('light'); setShowSettings(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${theme === 'light' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
              >
                <Sun className="h-4 w-4" />
                白天模式
              </button>
              <button
                onClick={() => { setTheme('dark'); setShowSettings(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${theme === 'dark' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
              >
                <Moon className="h-4 w-4" />
                黑夜模式
              </button>
            </div>
          )}
        </div>
      </div>
      <MarketStrip indices={indices} />
    </header>
  );
}
