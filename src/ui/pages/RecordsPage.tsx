import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Calendar, FileText, Loader2, Clock } from 'lucide-react';
import { useAppStore } from '../store/app-store';

interface RecordItem {
  fileID: string;
  path: string;
  date: string;
  name: string;
  size: number;
  createTime: string;
}

interface RecordDetail {
  query: string;
  results: Array<{ code: string; name: string }>;
  timestamp: string;
  source: string;
}

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

export function RecordsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFileID, setSelectedFileID] = useState('');

  const toggleRecordsPage = useAppStore((s) => s.toggleRecordsPage);

  useEffect(() => {
    fetchRecords();
  }, []);

  async function fetchRecords() {
    if (!CLOUDBASE_API_URL) {
      setError('CloudBase API URL 未配置');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${CLOUDBASE_API_URL}/list-records`);
      const data = await response.json();

      if (data.success) {
        setRecords(data.records || []);
      } else {
        setError(data.error || '获取记录失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetail(path: string) {
    if (!CLOUDBASE_API_URL) return;

    try {
      setDetailLoading(true);
      setSelectedFileID(path);
      const response = await fetch(`${CLOUDBASE_API_URL}/get-record?path=${encodeURIComponent(path)}`);
      const data = await response.json();

      if (data.success) {
        setSelectedRecord(data.data);
      }
    } catch (e) {
      console.warn('获取详情失败:', e);
    } finally {
      setDetailLoading(false);
    }
  }

  // 按日期分组
  const grouped = records.reduce((acc, r) => {
    if (!acc[r.date]) acc[r.date] = [];
    acc[r.date].push(r);
    return acc;
  }, {} as Record<string, RecordItem[]>);

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => toggleRecordsPage(false)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">查询记录</h1>
          <p className="text-sm text-gray-500 mt-0.5">共 {records.length} 条记录</p>
        </div>
        <button
          onClick={fetchRecords}
          disabled={loading}
          className="ml-auto px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '刷新'}
        </button>
      </div>

      {loading && records.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="text-center py-20">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">暂无查询记录</p>
          <p className="text-sm text-gray-400 mt-1">在搜索页查询股票后，记录会自动保存到这里</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 记录列表 */}
        <div className="lg:col-span-2 space-y-6">
          {dates.map((date) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{date}</span>
                <span className="text-xs text-gray-400">({grouped[date].length} 条)</span>
              </div>
              <div className="space-y-2">
                {grouped[date].map((record) => (
                  <button
                    key={record.path}
                    onClick={() => fetchDetail(record.path)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      selectedFileID === record.path
                        ? 'border-blue-300 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-blue-200 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Search className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {record.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{record.path}</span>
                          {record.size > 0 && (
                            <span className="text-xs text-gray-300">· {(record.size / 1024).toFixed(1)} KB</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 详情面板 */}
        <div className="lg:col-span-1">
          <div className="sticky top-20 bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">记录详情</h3>

            {detailLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            )}

            {!detailLoading && !selectedRecord && (
              <div className="text-center py-8 text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">点击左侧记录查看详情</p>
              </div>
            )}

            {!detailLoading && selectedRecord && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">查询词</label>
                  <div className="text-sm font-medium text-gray-900">{selectedRecord.query}</div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">时间</label>
                  <div className="flex items-center gap-1 text-sm text-gray-600">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(selectedRecord.timestamp).toLocaleString('zh-CN')}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    搜索结果 ({selectedRecord.results?.length || 0})
                  </label>
                  {selectedRecord.results && selectedRecord.results.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedRecord.results.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm"
                        >
                          <span className="font-medium text-gray-900">{r.name}</span>
                          <span className="text-xs text-gray-400">{r.code}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">无结果</p>
                  )}
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <label className="text-xs text-gray-400 block mb-1">来源</label>
                  <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full">
                    {selectedRecord.source}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
