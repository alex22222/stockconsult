import { useState, useEffect } from 'react';
import { Brain, Cloud, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, Minus, ArrowRight, BarChart3 } from 'lucide-react';
import { useAppStore } from '../store/app-store';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

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



function PredictionCard({
  icon,
  title,
  subtitle,
  prediction,
  upProbability,
  confidence,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  prediction: string;
  upProbability: number;
  confidence: number;
  color: 'blue' | 'purple' | 'green';
}) {
  const isUp = prediction === '涨';
  const isDown = prediction === '跌';

  const colorMap = {
    blue: {
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      iconBg: 'bg-blue-100',
      iconText: 'text-blue-600',
      predText: isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-600',
      predBg: isUp ? 'bg-red-50' : isDown ? 'bg-green-50' : 'bg-gray-50',
      bar: isUp ? 'bg-red-400' : 'bg-green-400',
    },
    purple: {
      border: 'border-purple-200',
      bg: 'bg-purple-50',
      iconBg: 'bg-purple-100',
      iconText: 'text-purple-600',
      predText: isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-600',
      predBg: isUp ? 'bg-red-50' : isDown ? 'bg-green-50' : 'bg-gray-50',
      bar: isUp ? 'bg-red-400' : 'bg-green-400',
    },
    green: {
      border: 'border-emerald-200',
      bg: 'bg-emerald-50',
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-600',
      predText: isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-600',
      predBg: isUp ? 'bg-red-50' : isDown ? 'bg-green-50' : 'bg-gray-50',
      bar: isUp ? 'bg-red-400' : 'bg-green-400',
    },
  };

  const c = colorMap[color];

  return (
    <div className={`flex-1 rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center`}>
          <span className={c.iconText}>{icon}</span>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-700">{title}</div>
          <div className="text-[10px] text-gray-400">{subtitle}</div>
        </div>
      </div>

      <div className={`text-center py-2 rounded-lg ${c.predBg} mb-2`}>
        <div className={`text-xl font-bold ${c.predText} flex items-center justify-center gap-1`}>
          {isUp ? <TrendingUp className="w-4 h-4" /> : isDown ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
          {isUp ? '上涨' : isDown ? '下跌' : '平盘'}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400 w-10">涨跌概率</span>
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
            <div className={`h-full ${c.bar}`} style={{ width: `${upProbability}%` }} />
            <div className="h-full bg-gray-300" style={{ width: `${100 - upProbability}%` }} />
          </div>
          <span className={`text-[10px] font-medium w-8 text-right ${isUp ? 'text-red-500' : 'text-green-500'}`}>
            涨{upProbability}%
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-400">置信度</span>
          <span className="font-medium text-gray-600">{confidence}%</span>
        </div>
      </div>
    </div>
  );
}

function VerificationCard({ record }: { record: PredictionRecord }) {
  if (!record.verified) {
    return (
      <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-700">T+1 验证</div>
            <div className="text-[10px] text-gray-400">下一交易日收盘后</div>
          </div>
        </div>
        <div className="text-center py-4">
          <div className="text-sm text-amber-600 font-medium">待验证</div>
          <div className="text-[10px] text-amber-400 mt-1">等待次日收盘数据</div>
        </div>
      </div>
    );
  }

  const actualUp = record.actualResult === '涨';
  const actualDown = record.actualResult === '跌';
  const localHit = record.localCorrect;
  const cloudHit = record.cloudCorrect;

  return (
    <div className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-700">T+1 验证</div>
          <div className="text-[10px] text-gray-400">已收盘验证</div>
        </div>
      </div>

      <div className="text-center py-2 rounded-lg bg-white mb-2">
        <div className={`text-xl font-bold flex items-center justify-center gap-1 ${actualUp ? 'text-red-600' : actualDown ? 'text-green-600' : 'text-gray-600'}`}>
          {actualUp ? <TrendingUp className="w-4 h-4" /> : actualDown ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
          {actualUp ? '上涨' : actualDown ? '下跌' : '平盘'}
          <span className="text-sm font-normal text-gray-500">
            {record.actualChangePercent !== null && record.actualChangePercent > 0 ? '+' : ''}
            {record.actualChangePercent}%
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-500">本地模型</span>
          <span className={`flex items-center gap-0.5 font-medium ${localHit ? 'text-green-600' : 'text-red-600'}`}>
            {localHit ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {localHit ? '命中' : '未命中'}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-500">云模型</span>
          <span className={`flex items-center gap-0.5 font-medium ${cloudHit ? 'text-green-600' : 'text-red-600'}`}>
            {cloudHit ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {cloudHit ? '命中' : '未命中'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function DualPredictionPanel({ stockCode, stockName }: { stockCode: string; stockName: string }) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toggleLuxiaoHistory = useAppStore((s) => s.toggleLuxiaoHistoryPage);

  const isLuxiao = stockCode === '002617' || stockName === '露笑科技';

  useEffect(() => {
    if (!isLuxiao) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        setLoading(true);
        // 优先从 CloudBase 数据库获取
        if (CLOUDBASE_API_URL) {
          const res = await fetch(
            `${CLOUDBASE_API_URL}/list-predictions?stockCode=002617&pageSize=50`,
            { cache: 'no-store' }
          );
          if (res.ok) {
            const apiData = await res.json();
            if (apiData.success && Array.isArray(apiData.records) && apiData.records.length > 0) {
              const records = apiData.records;
              const latest = records[0];
              const verified = records.filter((r: PredictionRecord) => r.verified);
              const localCorrect = verified.filter((r: PredictionRecord) => r.localCorrect);
              const cloudCorrect = verified.filter((r: PredictionRecord) => r.cloudCorrect);

              setData({
                symbol: '002617',
                name: '露笑科技',
                updatedAt: latest.predictDate,
                latest,
                stats: {
                  total: records.length,
                  verified: verified.length,
                  localAccuracy: verified.length > 0 ? Math.round((localCorrect.length / verified.length) * 100 * 10) / 10 : null,
                  cloudAccuracy: verified.length > 0 ? Math.round((cloudCorrect.length / verified.length) * 100 * 10) / 10 : null,
                },
                history: records,
              });
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
      } catch (e: unknown) {
        setError((e as Error).message || '获取失败');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isLuxiao]);

  if (!isLuxiao) return null;

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-900">AI 预测对比</h3>
          <span className="text-[10px] text-gray-400 ml-1">露笑科技专用</span>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || !data || !data.latest) {
    return (
      <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-900">AI 预测对比</h3>
          <span className="text-[10px] text-gray-400 ml-1">露笑科技专用</span>
        </div>
        <div className="p-6 text-center">
          <p className="text-xs text-gray-400">{error || '暂无预测数据'}</p>
          <p className="text-[10px] text-gray-300 mt-1">请运行 daily_predict.py 生成预测</p>
        </div>
      </section>
    );
  }

  const latest = data.latest;
  const stats = data.stats;

  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-900">AI 预测对比</h3>
          <span className="text-[10px] text-gray-400 ml-1">露笑科技专用</span>
          <span className="text-[10px] text-gray-300">·</span>
          <span className="text-[10px] text-gray-400">预测日 {latest.predictDate}</span>
        </div>
        <button
          onClick={() => toggleLuxiaoHistory(true)}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5 hover:underline"
        >
          查看完整历史
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="p-6">
        {/* 三个预测卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <PredictionCard
            icon={<Brain className="w-4 h-4" />}
            title="本地模型"
            subtitle="sklearn 集成学习"
            prediction={latest.localModel.prediction}
            upProbability={latest.localModel.upProbability}
            confidence={latest.localModel.confidence}
            color="blue"
          />
          <PredictionCard
            icon={<Cloud className="w-4 h-4" />}
            title="云模型"
            subtitle="四因子评分模型"
            prediction={latest.cloudModel.prediction}
            upProbability={latest.cloudModel.upProbability}
            confidence={latest.cloudModel.confidence}
            color="purple"
          />
          <VerificationCard record={latest} />
        </div>

        {/* 统计摘要 */}
        {stats && stats.verified > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-4 flex-wrap">
            <div className="text-[10px] text-gray-400">历史统计</div>
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-gray-500">已验证</span>
              <span className="font-semibold text-gray-700">{stats.verified}</span>
              <span className="text-gray-400">/{stats.total} 次</span>
            </div>
            {stats.localAccuracy !== null && (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-gray-500">本地准确率</span>
                <span className="font-semibold text-blue-600">{stats.localAccuracy}%</span>
              </div>
            )}
            {stats.cloudAccuracy !== null && (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-gray-500">云模型准确率</span>
                <span className="font-semibold text-purple-600">{stats.cloudAccuracy}%</span>
              </div>
            )}
          </div>
        )}

        {/* 因子评分（云模型） */}
        {latest.cloudModel.factorScores && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-[10px] text-gray-400 mb-2">云模型因子评分</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: '趋势', value: latest.cloudModel.factorScores.trend, color: 'bg-blue-400' },
                { label: '动量', value: latest.cloudModel.factorScores.momentum, color: 'bg-orange-400' },
                { label: '量能', value: latest.cloudModel.factorScores.volume, color: 'bg-purple-400' },
                { label: '技术', value: latest.cloudModel.factorScores.technical, color: 'bg-cyan-400' },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-8">{f.label}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${f.color}`} style={{ width: `${f.value}%` }} />
                  </div>
                  <span className={`text-[10px] w-6 text-right ${f.value >= 50 ? 'text-red-500' : 'text-green-500'}`}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
