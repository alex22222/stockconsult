import { Header } from './ui/components/layout/Header';
import { SearchPage } from './ui/pages/SearchPage';
import { DashboardPage } from './ui/pages/DashboardPage';
import { RecordsPage } from './ui/pages/RecordsPage';
import { useAppStore } from './ui/store/app-store';

function App() {
  const report = useAppStore((s) => s.report);
  const loadingState = useAppStore((s) => s.loadingState);
  const selectedStock = useAppStore((s) => s.selectedStock);
  const showRecordsPage = useAppStore((s) => s.showRecordsPage);

  const showDashboard = selectedStock && (report || loadingState === 'analyzing' || loadingState === 'error');

  return (
    <div className="min-h-svh flex flex-col bg-gray-50">
      <Header />
      {showRecordsPage ? <RecordsPage /> : showDashboard ? <DashboardPage /> : <SearchPage />}
    </div>
  );
}

export default App;
