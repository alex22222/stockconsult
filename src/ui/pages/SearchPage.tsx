import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Clock, TrendingUp, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/app-store';

const HOT_STOCKS = [
  { code: '600519', name: '贵州茅台', industry: '白酒' },
  { code: '000858', name: '五粮液', industry: '白酒' },
  { code: '300750', name: '宁德时代', industry: '动力电池' },
  { code: '000333', name: '美的集团', industry: '白色家电' },
  { code: '601318', name: '中国平安', industry: '保险' },
  { code: '600036', name: '招商银行', industry: '银行' },
  { code: '002594', name: '比亚迪', industry: '汽车' },
  { code: '00700', name: '腾讯控股', industry: '互联网' },
];

export function SearchPage() {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  const { 
    searchResults, 
    history, 
    loadingState, 
    searchStocks, 
    selectStock, 
    analyzeStock,
    clearResults,
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

  const handleSelect = useCallback((stock: typeof HOT_STOCKS[0]) => {
    selectStock(stock as any);
    setShowDropdown(false);
    setInputValue(stock.name);
    analyzeStock(stock.code);
  }, [selectStock, analyzeStock]);

  const handleHotStockClick = useCallback((stock: typeof HOT_STOCKS[0]) => {
    clearResults();
    setInputValue(stock.name);
    handleSelect(stock);
  }, [handleSelect, clearResults]);

  const isSearching = loadingState === 'searching';

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">个股智能分析</h2>
        <p className="text-gray-500">输入股票名称或代码，获取深度分析报告</p>
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

      {/* 热门股票 */}
      <div className="w-full max-w-xl mt-8">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>热门股票</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {HOT_STOCKS.map((stock) => (
            <button
              key={stock.code}
              onClick={() => handleHotStockClick(stock)}
              className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-left
                         hover:border-blue-300 hover:shadow-sm transition-all group"
            >
              <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                {stock.name}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{stock.code}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
