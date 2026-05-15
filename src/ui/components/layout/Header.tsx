import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, Settings, FileText, Sparkles, Sun, Moon, BrainCircuit } from 'lucide-react';
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

function IndexItem({ index }: { index: MarketIndex }) {
  if (index.status !== 'ok' || index.price === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">{index.name}</span>
        <span className="text-[10px] text-gray-300 dark:text-gray-600">--</span>
      </span>
    );
  }
  const isUp = index.change >= 0;
  return (
    <span className="inline-flex items-center gap-1 px-2">
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{index.name}</span>
      <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">
        {index.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`text-[10px] font-medium inline-flex items-center gap-0.5 ${isUp ? 'text-red-600' : 'text-green-600'}`}>
        {isUp ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
        {isUp ? '+' : ''}{index.changePercent.toFixed(2)}%
      </span>
      <span className="text-[10px] text-gray-300 dark:text-gray-600">|</span>
    </span>
  );
}

function Marquee({ indices }: { indices: MarketIndex[] }) {
  const items = indices.filter(i => i.status === 'ok' && i.price > 0);
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-1 px-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2">
            <span className="w-8 h-2 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            <span className="w-10 h-2 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            <span className="w-8 h-2 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            <span className="text-[10px] text-gray-300 dark:text-gray-600">|</span>
          </span>
        ))}
      </div>
    );
  }

  const content = (
    <>
      {items.map((idx) => (
        <IndexItem key={idx.code} index={idx} />
      ))}
    </>
  );

  return (
    <div className="overflow-hidden relative group/marquee">
      <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent dark:from-gray-900 dark:to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent dark:from-gray-900 dark:to-transparent z-10 pointer-events-none" />

      <div className="flex whitespace-nowrap animate-marquee group-hover/marquee:[animation-play-state:paused]">
        <span className="inline-flex items-center">{content}</span>
        <span className="inline-flex items-center">{content}</span>
      </div>
    </div>
  );
}

export function Header() {
  const showRecordsPage = useAppStore((s) => s.showRecordsPage);
  const toggleRecordsPage = useAppStore((s) => s.toggleRecordsPage);
  const showFortunePage = useAppStore((s) => s.showFortunePage);
  const toggleFortunePage = useAppStore((s) => s.toggleFortunePage);
  const showModelDocPage = useAppStore((s) => s.showModelDocPage);
  const toggleModelDocPage = useAppStore((s) => s.toggleModelDocPage);
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

  // 点击外部关闭设置下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 5s linear infinite;
        }
      `}</style>

      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          {/* 左侧：Logo + 走马灯 */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-shrink-0">
              <TrendingUp className="w-6 h-6 text-blue-600" />
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">投资座舱</h1>
            </div>

            {/* 桌面端走马灯 */}
            <div className="hidden lg:flex flex-1 items-center ml-3 border-l border-gray-200 dark:border-gray-700 pl-3 min-w-0">
              <div className="flex-1 max-w-md">
                <Marquee indices={indices} />
              </div>
            </div>
          </div>

          {/* 右侧：占卜师 + 记录 + 设置 */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => toggleFortunePage(!showFortunePage)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors ${
                showFortunePage
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">占卜师</span>
            </button>
            <button
              onClick={() => toggleModelDocPage(!showModelDocPage)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors ${
                showModelDocPage
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">模型说明</span>
            </button>
            <button
              onClick={() => toggleRecordsPage(!showRecordsPage)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors ${
                showRecordsPage
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">历史记录</span>
            </button>

            {/* 设置下拉 */}
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings
                    ? 'text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Settings className="w-4 h-4" />
              </button>

              {showSettings && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-50">
                  <div className="px-3 py-2 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    界面风格
                  </div>
                  <button
                    onClick={() => { setTheme('light'); setShowSettings(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      theme === 'light'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    白天模式
                    {theme === 'light' && <span className="ml-auto text-xs">✓</span>}
                  </button>
                  <button
                    onClick={() => { setTheme('dark'); setShowSettings(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      theme === 'dark'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    黑夜模式
                    {theme === 'dark' && <span className="ml-auto text-xs">✓</span>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 移动端走马灯 */}
        <div className="lg:hidden border-t border-gray-100 dark:border-gray-800 py-1">
          <Marquee indices={indices} />
        </div>
      </header>
    </>
  );
}
