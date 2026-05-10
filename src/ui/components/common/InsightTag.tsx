import { AlertTriangle, Lightbulb, Info, Flame } from 'lucide-react';
import type { Insight } from '../../../core/types/skill';

interface InsightTagProps {
  insight: Insight;
  compact?: boolean;
}

const typeConfig: Record<string, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  risk: { 
    icon: <AlertTriangle className="w-3.5 h-3.5" />, 
    bg: 'bg-orange-50', 
    text: 'text-orange-700', 
    border: 'border-orange-200' 
  },
  opportunity: { 
    icon: <Lightbulb className="w-3.5 h-3.5" />, 
    bg: 'bg-blue-50', 
    text: 'text-blue-700', 
    border: 'border-blue-200' 
  },
  neutral: { 
    icon: <Info className="w-3.5 h-3.5" />, 
    bg: 'bg-gray-50', 
    text: 'text-gray-600', 
    border: 'border-gray-200' 
  },
  highlight: { 
    icon: <Flame className="w-3.5 h-3.5" />, 
    bg: 'bg-purple-50', 
    text: 'text-purple-700', 
    border: 'border-purple-200' 
  },
};

export function InsightTag({ insight, compact = false }: InsightTagProps) {
  const config = typeConfig[insight.type] || typeConfig.neutral;
  
  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${config.bg} ${config.text} ${config.border} text-xs`}>
        {config.icon}
        <span className="font-medium">{insight.title}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-lg border ${config.bg} ${config.border}`}>
      <span className={`mt-0.5 ${config.text}`}>{config.icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${config.text}`}>{insight.title}</div>
        <div className="text-xs text-gray-600 mt-0.5 leading-relaxed">{insight.description}</div>
        {insight.metric && (
          <div className="text-xs text-gray-400 mt-1">
            {insight.metric}: <span className="font-medium text-gray-600">{insight.value}</span>
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-400 whitespace-nowrap">
        置信度{Math.round((insight.confidence || 0) * 100)}%
      </div>
    </div>
  );
}
