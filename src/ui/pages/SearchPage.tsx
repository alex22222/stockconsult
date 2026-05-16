import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Clock, TrendingUp, Loader2, Plus, Check, Star, ChevronDown, ChevronUp, X, Sparkles } from 'lucide-react';
import { SectorHeatmap } from '../components/SectorHeatmap';
import { useAppStore } from '../store/app-store';

export function SearchPage() {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFavoriteToast, setShowFavoriteToast] = useState<string | null>(null);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const searchRef = useRef<HTMLDivElement>(null);

  const {
    searchResults,
    history,
    hotStocks,
    favorites,
    loadingState,
    searchStocks,
    selectStock,
    analyzeStock,
    clearResults,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
  } = useAppStore();

  // 点击外部关闭下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 收藏提示自动消失
  useEffect(() => {
    if (showFavoriteToast) {
      const timer = setTimeout(() => setShowFavoriteToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [showFavoriteToast]);

  // 执行搜索
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setShowDropdown(false);
      return;
    }
    await searchStocks(query.trim());
    setShowDropdown(true);
  }, [searchStocks]);

  // Enter 键搜索
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      doSearch(inputValue);
    }
  }, [inputValue, doSearch]);

  const handleSelect = useCallback((stock: { code: string; name: string; industry?: string; exchange?: string }) => {
    selectStock(stock as any);
    setShowDropdown(false);
    setInputValue(stock.name);
    analyzeStock(stock.code);
  }, [selectStock, analyzeStock]);

  const handleHotStockClick = useCallback((stock: { code: string; name: string; industry?: string }) => {
    clearResults();
    setInputValue(stock.name);
    handleSelect(stock);
  }, [handleSelect, clearResults]);

  const handleAddFavorite = useCallback(async (e: React.MouseEvent, stock: { code: string; name: string; industry: string }) => {
    e.stopPropagation();
    if (isFavorite(stock.code)) {
      await removeFromFavorites(stock.code);
    } else {
      const added = await addToFavorites(stock as any);
      if (added) setShowFavoriteToast(`已添加「${stock.name}」到收藏`);
    }
  }, [addToFavorites, removeFromFavorites, isFavorite]);

  const handleRemoveFavorite = useCallback(async (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    await removeFromFavorites(code);
  }, [removeFromFavorites]);

  const isSearching = loadingState === 'searching';

  return (
    <div className="flex-1 flex relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-100/40 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-20 w-60 h-60 bg-purple-100/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 right-1/4 w-72 h-72 bg-cyan-100/20 rounded-full blur-3xl" />
      </div>

      {/* 收藏提示 */}
      {showFavoriteToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="bg-gray-900/90 backdrop-blur-sm text-white text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            {showFavoriteToast}
          </div>
        </div>
      )}

      {/* 左侧：搜索主区域 */}
      <div className="flex-1 flex flex-col items-center px-4 py-12 relative z-10 overflow-y-auto">
        {/* 标题 */}
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 bg-blue-50 border border-blue-100 rounded-full text-xs text-blue-600 font-medium">
            <Sparkles className="w-3 h-3" />
            AI 驱动的智能投研助手
          </div>
          <h2 className="text-4xl font-bold gradient-text mb-3 tracking-tight">
            投资座舱
          </h2>
          <p className="text-gray-400 text-sm">
            输入股票名称或代码，获取深度分析报告与 AI 预测
          </p>
        </div>

        {/* 搜索框 */}
        <div ref={searchRef} className="w-full max-w-xl relative animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="relative flex gap-2">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 transition-colors group-focus-within:text-blue-500" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => inputValue.trim().length >= 1 && setShowDropdown(true)}
                placeholder="搜索股票名称或代码，如：贵州茅台 / 600519"
                className="w-full pl-12 pr-4 py-3.5 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400
                           focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                           shadow-sm text-base transition-all glow-input"
              />
              {isSearching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 animate-spin" />
              )}
            </div>
            <button
              onClick={() => doSearch(inputValue)}
              disabled={isSearching || !inputValue.trim()}
              className="px-6 py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-2xl font-medium
                         hover:from-blue-700 hover:to-blue-600 hover:shadow-lg hover:shadow-blue-500/25
                         active:scale-95 transition-all shadow-sm flex items-center gap-2 whitespace-nowrap btn-press"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  查询中
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  查询
                </>
              )}
            </button>
          </div>

          {/* 搜索结果下拉 */}
          {showDropdown && (searchResults.length > 0 || inputValue.trim().length >= 1) && (
            <div className="absolute top-full left-0 right-0 mt-3 bg-white/95 backdrop-blur-md border border-gray-100 rounded-2xl shadow-xl shadow-gray-200/50 overflow-hidden z-50 animate-scale-in origin-top">
              {searchResults.length === 0 ? (
                <div className="px-5 py-4 text-sm text-gray-400 flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  未找到匹配的股票
                </div>
              ) : (
                searchResults.map((stock, i) => (
                  <button
                    key={stock.code}
                    onClick={() => handleSelect(stock)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-blue-50/60 transition-all text-left group"
                    style={{ animationDelay: `${i * 0.03}s` }}
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-sm group-hover:scale-110 transition-transform">
                      {stock.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{stock.name}</div>
                      <div className="text-xs text-gray-400">{stock.code} · {stock.industry}</div>
                    </div>
                    <TrendingUp className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 历史记录 */}
        {history.length > 0 && (
          <div className="w-full max-w-xl mt-6 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <Clock className="w-3.5 h-3.5" />
              <span>最近查看</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((stock) => (
                <button
                  key={stock.code}
                  onClick={() => handleSelect(stock as any)}
                  className="px-3.5 py-1.5 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-sm text-gray-700
                             hover:border-blue-300 hover:text-blue-600 hover:shadow-sm hover:-translate-y-0.5 transition-all"
                >
                  {stock.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 板块热力图 */}
        <div className="w-full max-w-xl mt-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <SectorHeatmap />
        </div>

        {/* 热门股票 */}
        <div className="w-full max-w-xl mt-8 animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>热门股票</span>
              <span className="text-[10px] text-gray-300">({hotStocks.length})</span>
            </div>
            {favorites.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                <span>已收藏 {favorites.length}/10</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {hotStocks.map((stock) => {
              const fav = isFavorite(stock.code);
              return (
                <div
                  key={stock.code}
                  className="relative group"
                >
                  <button
                    onClick={() => handleHotStockClick(stock)}
                    className="w-full px-3.5 py-3 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-xl text-left
                               hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 hover:-translate-y-1 transition-all card-hover"
                  >
                    <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors pr-5">
                      {stock.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono">{stock.code}</div>
                  </button>
                  {/* 收藏按钮 */}
                  <button
                    onClick={(e) => handleAddFavorite(e, stock)}
                    title={fav ? '取消收藏' : '添加到收藏'}
                    className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all
                      ${fav
                        ? 'text-yellow-500 bg-yellow-50 opacity-100 scale-100'
                        : 'text-gray-300 hover:text-yellow-500 hover:bg-yellow-50 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100'
                      }`}
                  >
                    {fav ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 右侧：我的收藏 */}
      <div className="hidden md:flex md:w-52 lg:w-60 shrink-0 bg-white/60 backdrop-blur-sm border-l border-gray-200/60 flex-col">
        <div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-y-auto">
          <div className="p-4">
            {/* 我的收藏 */}
            <div className="bg-white/80 backdrop-blur-sm border border-gray-200/80 rounded-2xl overflow-hidden shadow-sm">
              <button
                onClick={() => setFavoritesExpanded(!favoritesExpanded)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50/80 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold text-gray-800">我的收藏</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {favorites.length}/10
                  </span>
                </div>
                {favoritesExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {favoritesExpanded && (
                <div className="border-t border-gray-100">
                  {favorites.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-2">
                        <Star className="w-5 h-5 text-gray-200" />
                      </div>
                      <p className="text-xs text-gray-400">暂无收藏</p>
                      <p className="text-[10px] text-gray-300 mt-1">在热门股票中点击 + 添加</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50/80">
                      {favorites.map((stock, i) => (
                        <div
                          key={stock.code}
                          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-blue-50/40 transition-all"
                          style={{ animationDelay: `${i * 0.05}s` }}
                        >
                          <button
                            onClick={() => handleSelect(stock)}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                          >
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center text-blue-600 text-[10px] font-bold flex-shrink-0">
                              {stock.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 truncate">{stock.name}</div>
                              <div className="text-[10px] text-gray-400 font-mono">{stock.code}</div>
                            </div>
                          </button>
                          <button
                            onClick={(e) => handleRemoveFavorite(e, stock.code)}
                            className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                            title="移除收藏"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
