import { useState, useEffect, useCallback } from 'react';
import { Brain, Activity, Gauge, AlertTriangle, HelpCircle } from 'lucide-react';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

interface FactorScores {
  trend: number;
  momentum: number;
  volume: number;
  technical: number;
  usMarket?: number;
}

interface USMarketDetail {
  nasdaq: number;
  dow: number;
  sp500: number;
  chinaDragon: number;
}

interface PredictionData {
  code: string;
  name: string;
  prediction: string;
  upProbability: number;
  downProbability: number;
  confidence: number;
  historyTrend: string;
  factorScores: FactorScores;
  usMarketDetail?: USMarketDetail;
}

const FACTOR_LOGIC: Record<string, string> = {
  趋势: 'MA5/MA10/MA20均线排列：多头排列85分，短期上穿65分，空头排列15分，短期下穿35分，纠缠50分',
  动量: '基础50 + 近5日累计涨跌幅×3 + 今日涨跌幅×0.5，clamp到[0,100]',
  量能: '近5日均量 vs 近10日均量比值 × 今日涨跌方向：涨放量75分，涨缩量55分，跌放量25分，跌缩量45分',
  技术: '简化RSI = 100 - 100/(1+平均涨幅/平均跌幅)，基于全部历史日涨跌计算',
  美股: '隔夜美股综合评分：纳斯达克/道琼斯/标普500/中国金龙指数加权(默认30/25/25/20)，涨加分跌减分',
};

function FactorBar({ label, value, color }: { label: string; value: number; color: string }) {
  const isPositive = value >= 50;
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500 dark:text-gray-400 w-12 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${value}%` }}
          />
        </div>
        <span className={`text-[11px] font-medium w-8 text-right ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
          {value}
        </span>
        <button
          className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          onClick={() => setShowTip(!showTip)}
        >
          <HelpCircle className="w-3 h-3" />
        </button>
      </div>
      {showTip && (
        <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/80 px-2 py-1 rounded leading-relaxed">
          {FACTOR_LOGIC[label]}
        </div>
      )}
    </div>
  );
}

export function AIPredictionPanel({ stockCode }: { stockCode: string; stockName?: string }) {
  const [data, setData] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLogic, setShowLogic] = useState(false);

  const fetchPrediction = useCallback(async () => {
    if (!CLOUDBASE_API_URL || !stockCode) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${CLOUDBASE_API_URL}/fortune?codes=${encodeURIComponent(stockCode)}`, { cache: 'no-store' });
      const result = await res.json();
      if (result.success && Array.isArray(result.stocks) && result.stocks.length > 0) {
        setData(result.stocks[0]);
      } else {
        setError('预测数据异常');
      }
    } catch (e: unknown) {
      setError((e as Error).message || '获取失败');
    } finally {
      setLoading(false);
    }
  }, [stockCode]);

  useEffect(() => {
    fetchPrediction();
  }, [fetchPrediction]);

  if (loading && !data) {
    return (
      <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-600" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">AI 涨跌预测</h3>
        </div>
        <div className="p-6 space-y-3">
          <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-600" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">AI 涨跌预测</h3>
        </div>
        <div className="p-6 text-center">
          <p className="text-xs text-gray-400">{error}</p>
          <button onClick={fetchPrediction} className="mt-2 text-xs text-purple-500 hover:underline">重试</button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const isUp = data.prediction === '涨';
  const isDown = data.prediction === '跌';
  const scores = data.factorScores;

  return (
    <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-600" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">AI 涨跌预测</h3>
        </div>
        <span className="text-[10px] text-gray-400">多因子模型</span>
      </div>

      <div className="p-6">
        {/* 预测结果大卡片 */}
        <div className={`rounded-xl p-4 mb-4 ${
          isUp ? 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800' :
          isDown ? 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800' :
          'bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">明日预测</div>
              <div className={`text-3xl font-bold ${
                isUp ? 'text-red-600 dark:text-red-400' :
                isDown ? 'text-green-600 dark:text-green-400' :
                'text-gray-600 dark:text-gray-400'
              }`}>
                {isUp ? '上涨' : isDown ? '下跌' : '平盘'}
              </div>
            </div>
            <div className="text-right relative group">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center justify-end gap-1">
                信号强度
                <HelpCircle className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
              </div>
              <div className="text-xl font-bold text-gray-800 dark:text-gray-200">{data.confidence}%</div>
              <div className="absolute right-0 top-full mt-1 w-56 text-[10px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-2 py-1.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                信号强度 = |上涨概率 − 50%| × 2<br />
                越偏离50%，信号越明显（非校准置信度）
              </div>
            </div>
          </div>

          {/* 概率条 */}
          <div className="mt-3">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="text-red-500 font-medium">涨 {data.upProbability}%</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden flex">
                <div className="h-full bg-red-400" style={{ width: `${data.upProbability}%` }} />
                <div className="h-full bg-green-400" style={{ width: `${data.downProbability}%` }} />
              </div>
              <span className="text-green-500 font-medium">跌 {data.downProbability}%</span>
            </div>
          </div>
        </div>

        {/* 因子评分 */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            多因子评分
            <span className="text-[10px] text-gray-300 ml-auto cursor-pointer hover:text-gray-500" onClick={() => setShowLogic(!showLogic)}>
              {showLogic ? '收起说明' : '查看说明'}
            </span>
          </div>
          <FactorBar label="趋势" value={scores.trend} color="bg-blue-400" />
          <FactorBar label="动量" value={scores.momentum} color="bg-orange-400" />
          <FactorBar label="量能" value={scores.volume} color="bg-purple-400" />
          <FactorBar label="技术" value={scores.technical} color="bg-cyan-400" />
          {scores.usMarket !== undefined && (
            <FactorBar label="美股" value={scores.usMarket} color="bg-indigo-400" />
          )}
          {showLogic && (
            <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2.5 space-y-1.5 leading-relaxed">
              <p><span className="font-medium text-gray-600 dark:text-gray-300">综合预测</span> = 趋势×22% + 动量×22% + 量能×18% + 技术×25% + 美股×13%</p>
              <p><span className="font-medium text-gray-600 dark:text-gray-300">上涨概率</span> = round(综合预测)，&gt;55判涨，&lt;45判跌，中间判平</p>
              <p><span className="font-medium text-gray-600 dark:text-gray-300">信号强度</span> = |上涨概率 − 50| × 2，越偏离50%信号越明显（非校准置信度）</p>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-1.5 mt-1.5 space-y-1">
                <p><span className="font-medium">趋势分</span>：MA5/MA10/MA20排列 — 多头85/短期上65/空头15/短期下35/纠缠50</p>
                <p><span className="font-medium">动量分</span>：50 + 近5日累计涨跌×3 + 今日涨跌×0.5，clamp[0,100]</p>
                <p><span className="font-medium">量能分</span>：近5日均量/近10日均量 × 涨跌方向 — 涨放量75/涨缩量55/跌放量25/跌缩量45</p>
                <p><span className="font-medium">技术分</span>：简化RSI = 100 − 100/(1+平均涨幅/平均跌幅)，基于历史日涨跌</p>
                <p><span className="font-medium">美股分</span>：隔夜纳斯达克/道琼斯/标普500/金龙指数加权评分，50为中性</p>
              </div>
            </div>
          )}
        </div>

        {/* 隔夜美股详情 */}
        {data.usMarketDetail && (
          <div className="mt-3 p-2.5 bg-indigo-50 dark:bg-indigo-900/10 rounded-lg border border-indigo-100 dark:border-indigo-800/30">
            <div className="text-[10px] text-indigo-500 dark:text-indigo-400 mb-1.5 font-medium">隔夜美股</div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '纳斯达克', value: data.usMarketDetail.nasdaq },
                { label: '道琼斯', value: data.usMarketDetail.dow },
                { label: '标普500', value: data.usMarketDetail.sp500 },
                { label: '中国金龙', value: data.usMarketDetail.chinaDragon },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-[10px] text-gray-400">{item.label}</div>
                  <div className={`text-xs font-semibold ${item.value >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {item.value >= 0 ? '+' : ''}{item.value.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 历史趋势 */}
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-400">
          <Gauge className="w-3 h-3" />
          近期趋势：
          <span className={`font-medium ${
            data.historyTrend === '上涨' ? 'text-red-500' :
            data.historyTrend === '下跌' ? 'text-green-500' :
            'text-gray-500'
          }`}>
            {data.historyTrend}
          </span>
        </div>

        {/* 免责声明 */}
        <div className="mt-3 flex items-start gap-1 text-[10px] text-gray-400">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>免责声明：基于历史数据的技术分析预测，不构成投资建议。股市有风险，投资需谨慎。</span>
        </div>
      </div>
    </section>
  );
}
