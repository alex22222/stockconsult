import { useState, useEffect } from 'react';
import {
  ArrowLeft, Sword, Target, ShieldAlert, TrendingUp,
  Clock, Activity, Zap, BarChart3, AlertTriangle, CheckCircle2,
  XCircle, HelpCircle, ChevronRight, Sparkles
} from 'lucide-react';
import { useAppStore } from '../store/app-store';
import strategyConfig from '../../assets/strategy-config.json';

interface StrategyData {
  name: string;
  optimalMode: string;
  signal: string;
  confidence: number;
  keyFactors: string[];
  backtest: {
    return: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    trades: number;
  };
  riskLevel: string;
  suggestion: string;
  warning?: string;
}

const SIGNAL_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; icon: typeof CheckCircle2 }> = {
  '强烈买入': { label: '强烈买入', bg: 'bg-red-500', text: 'text-white', border: 'border-red-500', icon: Zap },
  '买入': { label: '买入', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', icon: TrendingUp },
  '观望': { label: '观望', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', icon: Clock },
  '回避': { label: '回避', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', icon: XCircle },
  '数据不足': { label: '数据不足', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-700', icon: HelpCircle },
};

const RISK_CONFIG: Record<string, { color: string; bars: number }> = {
  '低': { color: 'bg-green-400', bars: 1 },
  '中': { color: 'bg-amber-400', bars: 2 },
  '中高': { color: 'bg-orange-400', bars: 3 },
  '高': { color: 'bg-red-500', bars: 4 },
  '未知': { color: 'bg-gray-300 dark:bg-gray-600', bars: 0 },
};

function SignalBadge({ signal }: { signal: string }) {
  const config = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG['观望'];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${config.bg} ${config.text} ${config.border}`}>
      <Icon className="w-4 h-4" />
      {config.label}
    </span>
  );
}

function RiskIndicator({ level }: { level: string }) {
  const config = RISK_CONFIG[level] || RISK_CONFIG['未知'];
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 w-10">风险</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`w-3 h-1.5 rounded-sm ${i <= config.bars ? config.color : 'bg-gray-200 dark:bg-gray-700'}`}
          />
        ))}
      </div>
      <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">{level}</span>
    </div>
  );
}

function MetricCard({ label, value, unit, positiveIsGood }: { label: string; value: number; unit: string; positiveIsGood?: boolean }) {
  const isPositive = value >= 0;
  const colorClass = positiveIsGood === undefined
    ? 'text-gray-700 dark:text-gray-300'
    : (isPositive === positiveIsGood ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400');

  return (
    <div className="flex flex-col items-center px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`text-sm font-bold ${colorClass}`}>
        {value > 0 && isPositive ? '+' : ''}{value.toFixed(unit === '%' ? 2 : 2)}{unit}
      </span>
    </div>
  );
}

function StockStrategyCard({ code, strategy }: { code: string; strategy: StrategyData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden hover:shadow-lg transition-all hover:-translate-y-0.5">
      {/* 主行 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
      >
        {/* 股票信息 */}
        <div className="w-24 shrink-0">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{strategy.name}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">{code}</div>
        </div>

        {/* 信号 */}
        <div className="shrink-0">
          <SignalBadge signal={strategy.signal} />
        </div>

        {/* 置信度条 */}
        <div className="flex-1 min-w-0 px-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">模型置信度</span>
            <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{strategy.confidence}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                strategy.confidence >= 60 ? 'bg-red-500' :
                strategy.confidence >= 55 ? 'bg-amber-400' :
                strategy.confidence >= 50 ? 'bg-blue-400' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              style={{ width: `${strategy.confidence}%` }}
            />
          </div>
        </div>

        {/* 关键因子摘要 */}
        <div className="hidden md:flex flex-wrap gap-1 max-w-[200px] justify-end">
          {strategy.keyFactors.slice(0, 2).map((f, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
              {f.length > 8 ? f.slice(0, 8) + '...' : f}
            </span>
          ))}
        </div>

        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-4">
          {/* 策略类型 + 风险 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sword className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{strategy.optimalMode}</span>
            </div>
            <RiskIndicator level={strategy.riskLevel} />
          </div>

          {/* 回测指标 */}
          {strategy.backtest.trades > 0 && (
            <div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                历史回测表现（Walk-forward验证）
              </div>
              <div className="grid grid-cols-5 gap-2">
                <MetricCard label="总收益" value={strategy.backtest.return} unit="%" positiveIsGood />
                <MetricCard label="夏普" value={strategy.backtest.sharpe} unit="" />
                <MetricCard label="最大回撤" value={-strategy.backtest.maxDrawdown} unit="%" positiveIsGood={false} />
                <MetricCard label="胜率" value={strategy.backtest.winRate} unit="%" positiveIsGood />
                <MetricCard label="交易次数" value={strategy.backtest.trades} unit="次" />
              </div>
            </div>
          )}

          {/* 关键因子 */}
          <div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
              <Target className="w-3 h-3" />
              决策因子
            </div>
            <div className="space-y-1.5">
              {strategy.keyFactors.map((factor, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{factor}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 警告 */}
          {strategy.warning && (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/30 rounded-lg px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 dark:text-red-300">{strategy.warning}</div>
              </div>
            </div>
          )}

          {/* 行动建议 */}
          <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-blue-800 dark:text-blue-400 mb-0.5">策略建议</div>
                <div className="text-sm text-blue-700 dark:text-blue-300">{strategy.suggestion}</div>
              </div>
            </div>
          </div>

          {/* 免责声明 */}
          <div className="flex items-start gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>历史回测不代表未来收益。模型基于统计规律，存在失效风险。每次交易约0.17%成本已计入。</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyAdvisorPage() {
  const favorites = useAppStore((s) => s.favorites);
  const toggleStrategyAdvisorPage = useAppStore((s) => s.toggleStrategyAdvisorPage);
  const [strategies, setStrategies] = useState<Record<string, StrategyData>>({});

  useEffect(() => {
    // 合并静态配置与收藏列表
    const config = strategyConfig.strategies as Record<string, StrategyData>;
    const merged: Record<string, StrategyData> = {};

    // 先加入所有有配置的股票
    for (const [code, data] of Object.entries(config)) {
      merged[code] = data;
    }

    // 收藏但无配置的股票显示默认
    favorites.forEach((f) => {
      if (!merged[f.code]) {
        merged[f.code] = {
          name: f.name,
          optimalMode: '未建模',
          signal: '数据不足',
          confidence: 0,
          keyFactors: ['该股票尚未建立5日预测模型'],
          backtest: { return: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, trades: 0 },
          riskLevel: '未知',
          suggestion: '请先运行5日策略建模，获取专属策略建议。',
        };
      }
    });

    setStrategies(merged);
  }, [favorites]);

  const sortedCodes = Object.keys(strategies).sort((a, b) => {
    // 按信号强度排序：强烈买入 > 买入 > 观望 > 回避 > 数据不足
    const order = ['强烈买入', '买入', '观望', '回避', '数据不足'];
    const sa = strategies[a]?.signal || '数据不足';
    const sb = strategies[b]?.signal || '数据不足';
    return order.indexOf(sa) - order.indexOf(sb);
  });

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 dark:text-gray-100">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => toggleStrategyAdvisorPage(false)}
          className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all hover:scale-105"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
            <Sword className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">策略锐评</h1>
            <p className="text-xs text-gray-400 hidden sm:block">基于5日预测模型的持仓策略建议</p>
          </div>
        </div>
      </div>

      {/* 策略概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: '建模股票', value: Object.values(strategies).filter(s => s.backtest.trades > 0).length, unit: '只', icon: Target },
          { label: '平均夏普', value: Object.values(strategies).filter(s => s.backtest.trades > 0).reduce((a, s) => a + s.backtest.sharpe, 0) / Math.max(1, Object.values(strategies).filter(s => s.backtest.trades > 0).length), unit: '', icon: Activity },
          { label: '信号数量', value: sortedCodes.filter(c => strategies[c]?.signal === '买入' || strategies[c]?.signal === '强烈买入').length, unit: '个', icon: Zap },
          { label: '持仓周期', value: 5, unit: '天', icon: Clock },
        ].map((item) => (
          <div key={item.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
              <item.icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {typeof item.value === 'number' ? item.value.toFixed(item.unit === '' && item.label === '平均夏普' ? 2 : 0) : item.value}{item.unit}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 股票策略列表 */}
      {sortedCodes.length === 0 ? (
        <div className="text-center py-20">
          <ShieldAlert className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">暂无策略数据</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">先在首页添加股票到收藏</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedCodes.map((code) => (
            <StockStrategyCard key={code} code={code} strategy={strategies[code]} />
          ))}
        </div>
      )}

      {/* 底部说明 */}
      <div className="mt-8 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-gray-400" />
          策略说明
        </h3>
        <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <p><strong className="text-gray-700 dark:text-gray-300">5日持仓策略：</strong>预测未来5个交易日涨跌，只在高置信度时买入并持有5天，5天后强制平仓。</p>
          <p><strong className="text-gray-700 dark:text-gray-300">Walk-forward验证：</strong>模拟真实交易场景，用历史数据滚动训练、滚动预测，避免数据泄露。</p>
          <p><strong className="text-gray-700 dark:text-gray-300">交易成本：</strong>每次完整交易（买+卖）约0.17%（佣金0.03%×2 + 印花税0.05% + 滑点0.06%）。</p>
          <p><strong className="text-gray-700 dark:text-gray-300">风险提示：</strong>模型基于历史统计规律，市场结构变化可能导致策略失效。建议先用模拟盘验证3-6个月。</p>
        </div>
      </div>
    </div>
  );
}
