import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Clock, TrendingUp, Loader2, Plus, Check, Star, ChevronDown, ChevronUp, X } from 'lucide-react';
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
    <div className="flex-1 flex relative">
      {/* 收藏提示 */}
      {showFavoriteToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          <span className="flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            {showFavoriteToast}
          </span>
        </div>
      )}

      {/* 左侧：搜索主区域 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">个股智能分析</h2>
          <p className="text-gray-500 dark:text-gray-400">输入股票名称或代码，获取深度分析报告</p>
        </div>

        {/* 搜索框 */}
        <div ref={searchRef} className="w-full max-w-xl relative">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => inputValue.trim().length >= 1 && setShowDropdown(true)}
                placeholder="搜索股票名称或代码，如：贵州茅台 / 600519"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400
                           focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
                           shadow-sm text-base transition-all"
              />
              {isSearching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 animate-spin" />
              )}
            </div>
            <button
              onClick={() => doSearch(inputValue)}
              disabled={isSearching || !inputValue.trim()}
              className="px-5 py-3 bg-blue-600 text-white rounded-xl font-medium
                         hover:bg-blue-700 active:bg-blue-800
                         disabled:bg-blue-300 disabled:cursor-not-allowed
                         transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap"
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
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
              {searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400">未找到匹配的股票</div>
              ) : (
                searchResults.map((stock) => (
                  <button
                    key={stock.code}
                    onClick={() => handleSelect(stock)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 text-xs font-bold">
                      {stock.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{stock.name}</div>
                      <div className="text-xs text-gray-400">{stock.code} · {stock.industry}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 历史记录 */}
        {history.length > 0 && (
          <div className="w-full max-w-xl mt-6">
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <Clock className="w-3.5 h-3.5" />
              <span>最近查看</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((stock) => (
                <button
                  key={stock.code}
                  onClick={() => handleSelect(stock as any)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700
                             hover:border-blue-300 hover:text-blue-600 transition-colors"
                >
                  {stock.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 板块热力图 */}
        <div className="w-full max-w-xl mt-8">
          <SectorHeatmap />
        </div>

        {/* 热门股票 */}
        <div className="w-full max-w-xl mt-8">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {hotStocks.map((stock) => {
              const fav = isFavorite(stock.code);
              return (
                <div
                  key={stock.code}
                  className="relative group"
                >
                  <button
                    onClick={() => handleHotStockClick(stock)}
                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-left
                               hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors pr-5">
                      {stock.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{stock.code}</div>
                  </button>
                  {/* 收藏按钮 */}
                  <button
                    onClick={(e) => handleAddFavorite(e, stock)}
                    title={fav ? '取消收藏' : '添加到收藏'}
                    className={`absolute top-2 right-2 p-1 rounded-md transition-all
                      ${fav
                        ? 'text-yellow-500 bg-yellow-50 opacity-100'
                        : 'text-gray-300 hover:text-yellow-500 hover:bg-yellow-50 opacity-0 group-hover:opacity-100'
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
      <div className="hidden md:flex md:w-52 lg:w-60 shrink-0 bg-white border-l border-gray-200 flex-col">
        <div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-y-auto">
          <div className="p-4">
            {/* 我的收藏 */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setFavoritesExpanded(!favoritesExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
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
                    <div className="px-4 py-6 text-center">
                      <Star className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">暂无收藏</p>
                      <p className="text-[10px] text-gray-300 mt-1">在热门股票中点击 + 添加</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {favorites.map((stock) => (
                        <div
                          key={stock.code}
                          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <button
                            onClick={() => handleSelect(stock)}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                          >
                            <div className="w-7 h-7 rounded-md bg-blue-50 flex items-center justify-center text-blue-600 text-[10px] font-bold flex-shrink-0">
                              {stock.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 truncate">{stock.name}</div>
                              <div className="text-[10px] text-gray-400">{stock.code}</div>
                            </div>
                          </button>
                          <button
                            onClick={(e) => handleRemoveFavorite(e, stock.code)}
                            className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
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
