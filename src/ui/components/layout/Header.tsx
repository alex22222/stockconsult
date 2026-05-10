import { TrendingUp, Settings } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900 tracking-tight">个股智询</h1>
          <span className="text-xs text-gray-400 ml-1 hidden sm:inline">StockConsult</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
            Mock模式
          </span>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
