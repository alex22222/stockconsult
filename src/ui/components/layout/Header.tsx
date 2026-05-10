import { TrendingUp, Settings, Database, Wifi } from 'lucide-react';
import { useAppStore } from '../../store/app-store';

const PROVIDER_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  mock: { label: 'Mock数据', color: 'bg-gray-100 text-gray-600', icon: Database },
  'investoday-rest': { label: 'Investoday REST', color: 'bg-green-50 text-green-700', icon: Wifi },
  'investoday-mcp': { label: 'Investoday MCP', color: 'bg-purple-50 text-purple-700', icon: Wifi },
  cloudbase: { label: '云函数代理', color: 'bg-blue-50 text-blue-700', icon: Wifi },
};

export function Header() {
  const activeProvider = useAppStore((s) => s.activeProvider);
  const config = PROVIDER_LABELS[activeProvider] || PROVIDER_LABELS.mock;
  const Icon = config.icon;

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900 tracking-tight">个股智询</h1>
          <span className="text-xs text-gray-400 ml-1 hidden sm:inline">StockConsult</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1 ${config.color}`}>
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
