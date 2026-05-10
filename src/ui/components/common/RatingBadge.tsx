import type { AnalysisReport } from '../../../core/types/analysis';

interface RatingBadgeProps {
  rating: AnalysisReport['coreView']['rating'] | AnalysisReport['actionAdvice']['recommendation'];
  size?: 'sm' | 'md' | 'lg';
}

const ratingConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
  strong_buy: { label: '强烈买入', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  buy: { label: '买入', bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  hold: { label: '持有', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  reduce: { label: '减持', bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
  sell: { label: '卖出', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1',
  lg: 'text-lg px-5 py-2 font-semibold',
};

export function RatingBadge({ rating, size = 'md' }: RatingBadgeProps) {
  const config = ratingConfig[rating] || { label: rating, bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' };
  
  return (
    <span className={`inline-flex items-center rounded-lg border ${config.bg} ${config.text} ${config.border} ${sizeClasses[size]}`}>
      {config.label}
    </span>
  );
}
