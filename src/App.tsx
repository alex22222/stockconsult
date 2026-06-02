import { useEffect } from 'react';
import { Header } from './ui/components/layout/Header';
import { SearchPage } from './ui/pages/SearchPage';
import { DashboardPage } from './ui/pages/DashboardPage';
import { RecordsPage } from './ui/pages/RecordsPage';
// import { FortuneTellerPage } from './ui/pages/FortuneTellerPage'; // 已迁移到策略重建实验室
import { ModelDocPage } from './ui/pages/ModelDocPage';
import { LuxiaoHistoryPage } from './ui/pages/LuxiaoHistoryPage';
// StrategyAdvisorPage 已合并到 StrategyRebuildPage
import { PaperTradingPage } from './ui/pages/PaperTradingPage';
import { MomentumScanPage } from './ui/pages/MomentumScanPage';
import { StrategyRebuildPage } from './ui/pages/StrategyRebuildPage';
import { LandingPage } from './ui/pages/LandingPage';
import { useAppStore } from './ui/store/app-store';

function App() {
  const report = useAppStore((s) => s.report);
  const loadingState = useAppStore((s) => s.loadingState);
  const selectedStock = useAppStore((s) => s.selectedStock);
  const showRecordsPage = useAppStore((s) => s.showRecordsPage);
  // const showFortunePage = useAppStore((s) => s.showFortunePage); // 已迁移到策略重建实验室
  const showModelDocPage = useAppStore((s) => s.showModelDocPage);
  const showLuxiaoHistoryPage = useAppStore((s) => s.showLuxiaoHistoryPage);
  // showStrategyAdvisorPage 已合并到策略重建实验室
  const showPaperTradingPage = useAppStore((s) => s.showPaperTradingPage);
  const showMomentumScanPage = useAppStore((s) => s.showMomentumScanPage);
  const showStrategyRebuildPage = useAppStore((s) => s.showStrategyRebuildPage);
  const showLandingPage = useAppStore((s) => s.showLandingPage);
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
    if (showLandingPage && !showStrategyRebuildPage && !showMomentumScanPage && !showPaperTradingPage && !showLuxiaoHistoryPage && !showModelDocPage && !showRecordsPage && !showDashboard) {
      return <LandingPage />;
    }
    if (showStrategyRebuildPage) return <StrategyRebuildPage />;
    if (showMomentumScanPage) return <MomentumScanPage />;
    if (showPaperTradingPage) return <PaperTradingPage />;
    if (showLuxiaoHistoryPage) return <LuxiaoHistoryPage />;
    if (showModelDocPage) return <ModelDocPage />;
    // if (showFortunePage) return <FortuneTellerPage />; // 已迁移到策略重建实验室
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
