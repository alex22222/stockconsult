import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AnalysisReport } from '../../../core/types/analysis';

interface MetricCardProps {
  metric: AnalysisReport['keyMetrics']['valuation'][0];
}

/**
 * 指标卡片
 * 原则：优先展示 MCP 真实数据，缺失值显示 "-"
 */
export function MetricCard({ metric }: MetricCardProps) {
  const hasValue = metric.value !== '-' && metric.value !== '' && metric.value !== undefined && metric.value !== null;
  const numericValue = typeof metric.value === 'number' ? metric.value : NaN;
  const isValidNumber = !isNaN(numericValue);

  const trendIcon = !hasValue ? null :
    metric.trend === 'up' 
    ? <TrendingUp className="w-3.5 h-3.5 text-red-500" />
    : metric.trend === 'down'
    ? <TrendingDown className="w-3.5 h-3.5 text-green-500" />
    : <Minus className="w-3.5 h-3.5 text-gray-400" />;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{metric.label}</span>
        {trendIcon}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>
          {hasValue ? metric.value : '-'}
        </span>
        {hasValue && metric.unit && <span className="text-xs text-gray-400">{metric.unit}</span>}
      </div>
      {isValidNumber && metric.changePercent !== undefined && (
        <div className={`text-xs mt-1 font-medium ${metric.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
          {metric.changePercent >= 0 ? '+' : ''}{metric.changePercent}%
        </div>
      )}
      {metric.benchmark && hasValue && (
        <div className="text-xs text-gray-400 mt-1">{metric.benchmark}</div>
      )}
      {isValidNumber && metric.percentile !== undefined && metric.percentile >= 0 && (
        <div className="mt-2">
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div 
              className={`h-1.5 rounded-full ${metric.percentile > 70 ? 'bg-red-400' : metric.percentile < 30 ? 'bg-green-400' : 'bg-blue-400'}`}
              style={{ width: `${Math.min(metric.percentile, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 mt-0.5 block">历史{metric.percentile}%分位</span>
        </div>
      )}
    </div>
  );
}
