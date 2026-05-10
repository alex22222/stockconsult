import { Header } from './ui/components/layout/Header';
import { SearchPage } from './ui/pages/SearchPage';
import { DashboardPage } from './ui/pages/DashboardPage';
import { useAppStore } from './ui/store/app-store';

function App() {
  const report = useAppStore((s) => s.report);
  const loadingState = useAppStore((s) => s.loadingState);
  const selectedStock = useAppStore((s) => s.selectedStock);

  const showDashboard = selectedStock && (report || loadingState === 'analyzing' || loadingState === 'error');

  return (
    <div className="min-h-svh flex flex-col bg-gray-50">
      <Header />
      {showDashboard ? <DashboardPage /> : <SearchPage />}
    </div>
  );
}

export default App;
