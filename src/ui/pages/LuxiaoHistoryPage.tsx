import { useState, useEffect } from 'react';
import {
  ArrowLeft, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, Clock,
  Brain, Cloud, BarChart3, Calendar, Target,
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

interface LocalModelData {
  prediction: string;
  upProbability: number;
  downProbability: number;
  confidence: number;
}

interface CloudModelData {
  prediction: string;
  upProbability: number;
  downProbability: number;
  confidence: number;
  factorScores?: {
    trend: number;
    momentum: number;
    volume: number;
    technical: number;
  };
}

interface PredictionRecord {
  predictDate: string;
  localModel: LocalModelData;
  cloudModel: CloudModelData;
  verified: boolean;
  actualResult: string | null;
  actualChangePercent: number | null;
  localCorrect: boolean | null;
  cloudCorrect: boolean | null;
  verifiedAt?: string;
}

interface ComparisonData {
  symbol: string;
  name: string;
  updatedAt: string;
  latest: PredictionRecord | null;
  stats: {
    total: number;
    verified: number;
    localAccuracy: number | null;
    cloudAccuracy: number | null;
  } | null;
  history: PredictionRecord[];
}

function PredictionBadge({ prediction, size = 'sm' }: { prediction: string; size?: 'sm' | 'md' }) {
  const isUp = prediction === '涨';
  const isDown = prediction === '跌';
  const sizeClasses = size === 'md'
    ? 'text-sm px-2.5 py-1'
    : 'text-[10px] px-1.5 py-0.5';

  return (
    <span className={`inline-flex items-center gap-0.5 rounded font-medium ${sizeClasses} ${
      isUp ? 'bg-red-50 text-red-600' :
      isDown ? 'bg-green-50 text-green-600' :
      'bg-gray-50 text-gray-500'
    }`}>
      {isUp ? <TrendingUp className={size === 'md' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} /> :
       isDown ? <TrendingDown className={size === 'md' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} /> :
       <Minus className={size === 'md' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} />}
      {isUp ? '涨' : isDown ? '跌' : '平'}
    </span>
  );
}

function HitBadge({ hit }: { hit: boolean | null }) {
  if (hit === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500">
        <Clock className="w-2.5 h-2.5" />
        待验证
      </span>
    );
  }
  return hit ? (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-medium">
      <CheckCircle2 className="w-2.5 h-2.5" />
      命中
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-red-500 font-medium">
      <XCircle className="w-2.5 h-2.5" />
      未命中
    </span>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

export function LuxiaoHistoryPage() {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<PredictionRecord | null>(null);

  const toggleLuxiaoHistory = useAppStore((s: { toggleLuxiaoHistoryPage: (show?: boolean) => void }) => s.toggleLuxiaoHistoryPage);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const apiUrl = import.meta.env.VITE_CLOUDBASE_API_URL || '';

        // 优先从 CloudBase 数据库获取
        if (apiUrl) {
          const res = await fetch(
            `${apiUrl}/list-predictions?stockCode=002617&pageSize=100`,
            { cache: 'no-store' }
          );
          if (res.ok) {
            const apiData = await res.json();
            if (apiData.success && Array.isArray(apiData.records)) {
              const records: PredictionRecord[] = apiData.records;
              const latest = records[0] || null;
              const verified = records.filter((r) => r.verified);
              const localCorrect = verified.filter((r) => r.localCorrect);
              const cloudCorrect = verified.filter((r) => r.cloudCorrect);

              const comparisonData: ComparisonData = {
                symbol: '002617',
                name: '露笑科技',
                updatedAt: latest?.predictDate || '',
                latest,
                stats: {
                  total: records.length,
                  verified: verified.length,
                  localAccuracy: verified.length > 0
                    ? Math.round((localCorrect.length / verified.length) * 100 * 10) / 10
                    : null,
                  cloudAccuracy: verified.length > 0
                    ? Math.round((cloudCorrect.length / verified.length) * 100 * 10) / 10
                    : null,
                },
                history: records,
              };
              setData(comparisonData);
              if (records.length > 0) {
                setSelectedRecord(records[0]);
              }
              setLoading(false);
              return;
            }
          }
        }

        // 降级到本地 JSON
        const res = await fetch('/data/luxiao_comparison.json', { cache: 'no-store' });
        if (!res.ok) {
          setError('预测数据尚未生成');
          return;
        }
        const json = await res.json();
        setData(json);
        if (json.history && json.history.length > 0) {
          setSelectedRecord(json.history[0]);
        }
      } catch (e: unknown) {
        setError((e as Error).message || '获取失败');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-sm text-gray-500">加载预测历史...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => toggleLuxiaoHistory(false)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">露笑科技预测历史</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-sm text-amber-700">{error || '暂无数据'}</p>
          <p className="text-xs text-amber-500 mt-1">请先运行 daily_predict.py 生成预测记录</p>
        </div>
      </div>
    );
  }

  const history = data.history || [];
  const stats = data.stats;

  // 计算累计趋势（最近14天）
  // const recentHistory = history.slice(0, 14).reverse();
  const verifiedHistory = history.filter((h) => h.verified);

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => toggleLuxiaoHistory(false)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">露笑科技预测历史</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            002617 · 本地模型 vs 云模型 · 次日收盘验证
          </p>
        </div>
        <div className="ml-auto text-xs text-gray-400">
          更新于 {data.updatedAt}
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500">总预测次数</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">已验证</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats.verified}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">本地准确率</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {stats.localAccuracy !== null ? `${stats.localAccuracy}%` : '--'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cloud className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-gray-500">云模型准确率</span>
            </div>
            <div className="text-2xl font-bold text-purple-600">
              {stats.cloudAccuracy !== null ? `${stats.cloudAccuracy}%` : '--'}
            </div>
          </div>
        </div>
      )}

      {/* 准确率趋势（最近验证记录） */}
      {verifiedHistory.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-medium text-gray-700 mb-3">验证结果趋势（最近 {Math.min(verifiedHistory.length, 14)} 次）</div>
          <div className="flex items-end gap-1 h-20">
            {verifiedHistory.slice(0, 14).reverse().map((rec) => {
              const localHit = rec.localCorrect;
              const cloudHit = rec.cloudCorrect;
              return (
                <div key={rec.predictDate} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex gap-0.5">
                    <div
                      className={`w-2 rounded-sm ${localHit ? 'bg-blue-400' : 'bg-gray-200'}`}
                      style={{ height: '20px' }}
                      title={`本地: ${localHit ? '命中' : '未命中'}`}
                    />
                    <div
                      className={`w-2 rounded-sm ${cloudHit ? 'bg-purple-400' : 'bg-gray-200'}`}
                      style={{ height: '20px' }}
                      title={`云模型: ${cloudHit ? '命中' : '未命中'}`}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400">{rec.predictDate.slice(5)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400" />本地命中</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-400" />云模型命中</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-200" />未命中</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 左侧：历史记录表格 */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-900">预测记录</span>
              </div>
              <span className="text-xs text-gray-400">{history.length} 条</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2 font-medium">预测日</th>
                    <th className="px-3 py-2 font-medium text-center">本地模型</th>
                    <th className="px-3 py-2 font-medium text-center">云模型</th>
                    <th className="px-3 py-2 font-medium text-center">实际结果</th>
                    <th className="px-3 py-2 font-medium text-center">本地</th>
                    <th className="px-3 py-2 font-medium text-center">云</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {history.map((rec) => (
                    <tr
                      key={rec.predictDate}
                      onClick={() => setSelectedRecord(rec)}
                      className={`text-xs cursor-pointer transition-colors ${
                        selectedRecord?.predictDate === rec.predictDate
                          ? 'bg-blue-50'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                        {rec.predictDate}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <PredictionBadge prediction={rec.localModel.prediction} />
                          <span className="text-[9px] text-gray-400">{rec.localModel.upProbability}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <PredictionBadge prediction={rec.cloudModel.prediction} />
                          <span className="text-[9px] text-gray-400">{rec.cloudModel.upProbability}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {rec.verified ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <PredictionBadge prediction={rec.actualResult || '平'} />
                            <span className={`text-[9px] ${(rec.actualChangePercent || 0) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {(rec.actualChangePercent || 0) > 0 ? '+' : ''}{rec.actualChangePercent}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-amber-500">待验证</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <HitBadge hit={rec.localCorrect} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <HitBadge hit={rec.cloudCorrect} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {history.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无预测记录</p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情面板 */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 bg-white border border-gray-200 rounded-xl overflow-hidden">
            {selectedRecord ? (
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">{selectedRecord.predictDate} 预测详情</h3>
                  {selectedRecord.verified ? (
                    <span className="text-[10px] px-2 py-0.5 bg-green-50 text-green-600 rounded-full font-medium">已验证</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full font-medium">待验证</span>
                  )}
                </div>

                <div className="space-y-4">
                  {/* 本地模型 */}
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-xs font-medium text-blue-700">本地模型预测</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <PredictionBadge prediction={selectedRecord.localModel.prediction} size="md" />
                      <div className="text-[10px] text-gray-500">
                        涨{selectedRecord.localModel.upProbability}% · 置信{selectedRecord.localModel.confidence}%
                      </div>
                    </div>
                    {selectedRecord.localCorrect !== null && (
                      <div className="mt-2 text-[10px]">
                        <HitBadge hit={selectedRecord.localCorrect} />
                      </div>
                    )}
                  </div>

                  {/* 云模型 */}
                  <div className="bg-purple-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Cloud className="w-3.5 h-3.5 text-purple-600" />
                      <span className="text-xs font-medium text-purple-700">云模型预测</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <PredictionBadge prediction={selectedRecord.cloudModel.prediction} size="md" />
                      <div className="text-[10px] text-gray-500">
                        涨{selectedRecord.cloudModel.upProbability}% · 置信{selectedRecord.cloudModel.confidence}%
                      </div>
                    </div>
                    {selectedRecord.cloudCorrect !== null && (
                      <div className="mt-2 text-[10px]">
                        <HitBadge hit={selectedRecord.cloudCorrect} />
                      </div>
                    )}
                    {/* 因子评分 */}
                    {selectedRecord.cloudModel.factorScores && (
                      <div className="mt-2 space-y-1">
                        {[
                          { label: '趋势', value: selectedRecord.cloudModel.factorScores.trend, color: 'bg-blue-400' },
                          { label: '动量', value: selectedRecord.cloudModel.factorScores.momentum, color: 'bg-orange-400' },
                          { label: '量能', value: selectedRecord.cloudModel.factorScores.volume, color: 'bg-purple-400' },
                          { label: '技术', value: selectedRecord.cloudModel.factorScores.technical, color: 'bg-cyan-400' },
                        ].map((f) => (
                          <div key={f.label} className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-8">{f.label}</span>
                            <MiniBar value={f.value} color={f.color} />
                            <span className={`text-[10px] w-6 text-right ${f.value >= 50 ? 'text-red-500' : 'text-green-500'}`}>{f.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 实际结果 */}
                  {selectedRecord.verified && (
                    <div className="bg-emerald-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-xs font-medium text-emerald-700">T+1 实际结果</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <PredictionBadge prediction={selectedRecord.actualResult || '平'} size="md" />
                        <div className={`text-sm font-bold ${(selectedRecord.actualChangePercent || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {(selectedRecord.actualChangePercent || 0) > 0 ? '+' : ''}{selectedRecord.actualChangePercent}%
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 对比 */}
                  {selectedRecord.verified && (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="text-[10px] text-gray-500 mb-2">模型对比</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`text-center py-2 rounded-lg ${selectedRecord.localCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                          <div className="text-[10px] text-gray-500">本地模型</div>
                          <div className={`text-sm font-bold ${selectedRecord.localCorrect ? 'text-green-600' : 'text-red-600'}`}>
                            {selectedRecord.localCorrect ? '✓ 命中' : '✗ 未命中'}
                          </div>
                        </div>
                        <div className={`text-center py-2 rounded-lg ${selectedRecord.cloudCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                          <div className="text-[10px] text-gray-500">云模型</div>
                          <div className={`text-sm font-bold ${selectedRecord.cloudCorrect ? 'text-green-600' : 'text-red-600'}`}>
                            {selectedRecord.cloudCorrect ? '✓ 命中' : '✗ 未命中'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">点击左侧记录查看详情</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
