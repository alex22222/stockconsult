import {
  TrendingUp, FlaskConical, PiggyBank, Zap, BrainCircuit,
  Search, Clock, ArrowRight, BarChart3, AlertTriangle
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

function FeatureCard({
  title, desc, icon: Icon, color, bgColor, onClick
}: {
  title: string;
  desc: string;
  icon: typeof TrendingUp;
  color: string;
  bgColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">{desc}</p>
      <div className="flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
        进入 <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}

export function LandingPage() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const toggleLandingPage = useAppStore((s) => s.toggleLandingPage);

  const features = [
    {
      title: '策略重建',
      desc: 'Ridge+GBR 回归模型，预测5日收益率，每日实验信号 + walk-forward 验证',
      icon: FlaskConical,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
      page: 'strategyRebuild' as const,
    },
    {
      title: '模拟盘',
      desc: '¥10,000 初始资金，真实交易成本，止盈止损规则，板块分散，前向跟踪',
      icon: PiggyBank,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
      page: 'paperTrading' as const,
    },
    {
      title: '爆破力扫描',
      desc: '技术突破 + 资金涌入 + 波动释放，三维度扫描市场高动能股票',
      icon: Zap,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      page: 'momentum' as const,
    },
    {
      title: '个股分析',
      desc: '搜索任意A股，获取财务/估值/公告/情绪多维度AI分析报告',
      icon: Search,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      page: 'search' as const,
    },
    {
      title: '模型说明',
      desc: '了解模型原理、特征工程、训练流程和回测机制的技术文档',
      icon: BrainCircuit,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
      page: 'modelDoc' as const,
    },
    {
      title: '预测历史',
      desc: '查看所有历史预测记录，5日后自动回填验证实际收益',
      icon: Clock,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
      page: 'records' as const,
    },
  ];

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 dark:text-gray-100">
      {/* Hero 区域 */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20 mb-5">
          <TrendingUp className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-3 tracking-tight">
          投资座舱
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-lg mx-auto leading-relaxed">
          基于 Ridge+GBR 回归模型的量化策略研究与实盘跟踪系统。<br className="hidden sm:block" />
          每日预测 → 实验信号 → 模拟盘执行 → 自动验证，形成完整闭环。
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            实验性质：当前模型方向准确率约 50%，尚未证明存在稳定 alpha
          </span>
        </div>
      </div>

      {/* 功能导航网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {features.map((f) => (
          <FeatureCard
            key={f.title}
            title={f.title}
            desc={f.desc}
            icon={f.icon}
            color={f.color}
            bgColor={f.bgColor}
            onClick={() => {
              if (f.page === 'search') {
                toggleLandingPage(false);
              } else {
                navigateTo(f.page);
              }
            }}
          />
        ))}
      </div>

      {/* 当前状态摘要 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">当前运行状态</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">10只</div>
            <div className="text-[10px] text-gray-400">市值股股票池</div>
          </div>
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">Ridge+GBR</div>
            <div className="text-[10px] text-gray-400">回归集成模型</div>
          </div>
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">5日</div>
            <div className="text-[10px] text-gray-400">预测 horizon</div>
          </div>
          <div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">0.4%</div>
            <div className="text-[10px] text-gray-400">来回交易成本</div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-400 dark:text-gray-500">
          <p>流水线运行时间：每天收盘后 15:35 自动执行（launchd com.stockconsult.daily-pipeline）</p>
          <p>部署环境：CloudBase 静态托管 + Python3.9 云函数</p>
        </div>
      </div>
    </div>
  );
}
