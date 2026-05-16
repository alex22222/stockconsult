import { useEffect } from 'react';
import { Header } from './ui/components/layout/Header';
import { SearchPage } from './ui/pages/SearchPage';
import { DashboardPage } from './ui/pages/DashboardPage';
import { RecordsPage } from './ui/pages/RecordsPage';
import { FortuneTellerPage } from './ui/pages/FortuneTellerPage';
import { ModelDocPage } from './ui/pages/ModelDocPage';
import { LuxiaoHistoryPage } from './ui/pages/LuxiaoHistoryPage';
import { StrategyAdvisorPage } from './ui/pages/StrategyAdvisorPage';
import { useAppStore } from './ui/store/app-store';

function App() {
  const report = useAppStore((s) => s.report);
  const loadingState = useAppStore((s) => s.loadingState);
  const selectedStock = useAppStore((s) => s.selectedStock);
  const showRecordsPage = useAppStore((s) => s.showRecordsPage);
  const showFortunePage = useAppStore((s) => s.showFortunePage);
  const showModelDocPage = useAppStore((s) => s.showModelDocPage);
  const showLuxiaoHistoryPage = useAppStore((s) => s.showLuxiaoHistoryPage);
  const showStrategyAdvisorPage = useAppStore((s) => s.showStrategyAdvisorPage);
  const loadFavorites = useAppStore((s) => s.loadFavorites);
  const theme = useAppStore((s) => s.theme);

  // 初始化加载收藏列表
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // 同步主题到 html 元素
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const showDashboard = selectedStock && (report || loadingState === 'analyzing' || loadingState === 'error');

  function renderPage() {
    if (showStrategyAdvisorPage) return <StrategyAdvisorPage />;
    if (showLuxiaoHistoryPage) return <LuxiaoHistoryPage />;
    if (showModelDocPage) return <ModelDocPage />;
    if (showFortunePage) return <FortuneTellerPage />;
    if (showRecordsPage) return <RecordsPage />;
    if (showDashboard) return <DashboardPage />;
    return <SearchPage />;
  }

  return (
    <div className="min-h-svh flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      {renderPage()}
    </div>
  );
}

export default App;
