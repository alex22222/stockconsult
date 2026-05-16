import { useAppStore } from '../store/app-store';
import {
  ArrowLeft, Brain, Database, Layers, GitBranch, BarChart3, ShieldCheck,
  TrendingUp, Activity, Zap, Eye, Coins, Monitor
} from 'lucide-react';

/* ============================================================
   AI 涨跌预测引擎 · 原理说明页
   ============================================================ */

function ArchitectureDiagram() {
  const box = (
    icon: React.ReactNode,
    title: string,
    subtitle: string,
    color: string,
    delay: number
  ) => (
    <div
      className={`relative flex flex-col items-center justify-center rounded-2xl border-2 ${color} 
        bg-white dark:bg-gray-800 px-5 py-4 shadow-sm hover:shadow-md transition-all duration-300
        animate-fade-in-up`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <div className={`mb-2 p-2 rounded-xl ${color.replace('border-', 'bg-').replace('500', '100').replace('400', '900/20')}`}>
        {icon}
      </div>
      <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</span>
    </div>
  );

  const arrow = (delay: number) => (
    <div
      className="flex items-center justify-center text-gray-300 dark:text-gray-600 animate-fade-in"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <svg width="24" height="40" viewBox="0 0 24 40" fill="none" className="hidden sm:block">
        <path d="M12 0V32M12 32L4 24M12 32L20 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg width="40" height="24" viewBox="0 0 40 24" fill="none" className="sm:hidden">
        <path d="M0 12H32M32 12L24 4M32 12L24 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );

  return (
    <div className="w-full">
      <style>{`
        .animate-fade-in-up { animation: fadeInUp 0.6s ease-out both; }
        .animate-fade-in { animation: fadeIn 0.5s ease-out both; }
      `}</style>

      {/* 桌面端横向流程图 */}
      <div className="hidden md:flex items-stretch justify-center gap-2 py-6">
        {box(<Database className="w-5 h-5 text-blue-500" />, '多源数据采集', '行情/资金/板块/宏观', 'border-blue-400 dark:border-blue-500', 0)}
        {arrow(100)}
        {box(<Layers className="w-5 h-5 text-purple-500" />, '六大类因子工程', '80+ 特征构建', 'border-purple-400 dark:border-purple-500', 200)}
        {arrow(300)}
        {box(<GitBranch className="w-5 h-5 text-amber-500" />, '四模型集成', 'GBDT/RF/ET/LR', 'border-amber-400 dark:border-amber-500', 400)}
        {arrow(500)}
        {box(<Brain className="w-5 h-5 text-rose-500" />, '进化优化引擎', '权重自适应调整', 'border-rose-400 dark:border-rose-500', 600)}
        {arrow(700)}
        {box(<BarChart3 className="w-5 h-5 text-emerald-500" />, '预测输出', '涨跌 + 置信度', 'border-emerald-400 dark:border-emerald-500', 800)}
      </div>

      {/* 移动端纵向流程图 */}
      <div className="md:hidden flex flex-col items-center gap-2 py-4">
        {box(<Database className="w-5 h-5 text-blue-500" />, '多源数据采集', '行情/资金/板块/宏观', 'border-blue-400 dark:border-blue-500', 0)}
        {arrow(100)}
        {box(<Layers className="w-5 h-5 text-purple-500" />, '六大类因子工程', '80+ 特征构建', 'border-purple-400 dark:border-purple-500', 200)}
        {arrow(300)}
        {box(<GitBranch className="w-5 h-5 text-amber-500" />, '四模型集成', 'GBDT/RF/ET/LR', 'border-amber-400 dark:border-amber-500', 400)}
        {arrow(500)}
        {box(<Brain className="w-5 h-5 text-rose-500" />, '进化优化引擎', '权重自适应调整', 'border-rose-400 dark:border-rose-500', 600)}
        {arrow(700)}
        {box(<BarChart3 className="w-5 h-5 text-emerald-500" />, '预测输出', '涨跌 + 置信度', 'border-emerald-400 dark:border-emerald-500', 800)}
      </div>

      {/* 反馈回路虚线 */}
      <div className="relative h-8 mt-2 mb-4">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 40" preserveAspectRatio="none">
          <path
            d="M 680 5 Q 700 35 400 35 Q 100 35 120 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            className="text-gray-300 dark:text-gray-600"
          />
          <polygon points="118,5 124,2 124,8" className="fill-gray-300 dark:fill-gray-600" />
        </svg>
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 px-2">
            回测验证 → 触发进化 → 模型迭代
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 因子卡片 ---------------- */
const FACTORS = [
  {
    icon: <Monitor className="w-5 h-5" />,
    title: '市场环境因子',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-100 dark:border-blue-800',
    items: ['大盘趋势斜率', '市场波动率(ATR)', '个股-指数相关性', '指数创新高/新低'],
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: '大盘能量因子',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-100 dark:border-amber-800',
    items: ['成交量能量比', '价格动量(1/5/10/20日)', '换手率变化', '量价配合度'],
  },
  {
    icon: <Eye className="w-5 h-5" />,
    title: '市场情绪因子',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-100 dark:border-purple-800',
    items: ['恐惧贪婪指数', '连续涨跌天数', '振幅变化', '主力净流入占比'],
  },
  {
    icon: <Activity className="w-5 h-5" />,
    title: '技术指标因子',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-100 dark:border-emerald-800',
    items: ['MACD金叉/死叉', 'KDJ超买超卖', 'RSI背离', '布林带缩口/突破', '均线多头排列'],
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: '板块热度因子',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    border: 'border-rose-100 dark:border-rose-800',
    items: ['板块资金流向', '个股相对强弱', '板块排名', '轮动指标'],
  },
  {
    icon: <Coins className="w-5 h-5" />,
    title: '资金异动因子',
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    border: 'border-cyan-100 dark:border-cyan-800',
    items: ['成交量异常放大/缩小', '价格-成交量背离', '主力资金流向', '大单异动', '资金集中度'],
  },
];

/* ---------------- 模型卡片 ---------------- */
const MODELS = [
  {
    name: 'Gradient Boosting',
    abbr: 'GBDT',
    desc: '梯度提升树，对非线性关系建模能力强，擅长捕捉特征间的交互效应。',
    weight: '动态',
  },
  {
    name: 'Random Forest',
    abbr: 'RF',
    desc: '随机森林，通过多棵决策树投票降低方差，抗过拟合能力优秀。',
    weight: '动态',
  },
  {
    name: 'Extra Trees',
    abbr: 'ET',
    desc: '极端随机树，在随机森林基础上进一步随机化分裂点，增加模型多样性。',
    weight: '动态',
  },
  {
    name: 'Logistic Regression',
    abbr: 'LR',
    desc: '逻辑回归，提供线性基准，与树模型形成互补，增强泛化能力。',
    weight: '动态',
  },
];

/* ---------------- 主页面 ---------------- */
export function ModelDocPage() {
  const toggleModelDocPage = useAppStore((s) => s.toggleModelDocPage);

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900">
      {/* 顶部返回栏 */}
      <div className="sticky top-[3.5rem] z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center">
          <button
            onClick={() => toggleModelDocPage(false)}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h2 className="ml-4 text-sm font-semibold text-gray-800 dark:text-gray-100">
            AI 涨跌预测引擎原理
          </h2>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        {/* ========== 概述 ========== */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs font-medium">
            <Brain className="w-3.5 h-3.5" />
            基于机器学习的多因子量化预测系统
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50">
            从数据到预测，六阶段闭环演进
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            本引擎通过采集个股行情、大盘指数、资金流向、板块热度等多维度数据，
            构建六大类共 80+ 因子特征，采用四模型集成学习进行涨跌预测，
            并通过滚动训练与进化优化持续逼近真实市场规律。
          </p>
        </section>

        {/* ========== 架构总览图 ========== */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            系统架构总览
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            数据 → 特征 → 模型 → 进化 → 预测 → 验证 → 反馈迭代
          </p>
          <ArchitectureDiagram />
        </section>

        {/* ========== 六大因子 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-500" />
            六大类因子特征工程
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FACTORS.map((f) => (
              <div
                key={f.title}
                className={`rounded-xl border ${f.border} ${f.bg} p-4 hover:shadow-sm transition-shadow`}
              >
                <div className={`flex items-center gap-2 mb-3 ${f.color}`}>
                  {f.icon}
                  <span className="text-sm font-bold">{f.title}</span>
                </div>
                <ul className="space-y-1.5">
                  {f.items.map((item) => (
                    <li
                      key={item}
                      className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5"
                    >
                      <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600 mt-1.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ========== 四模型集成 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-amber-500" />
            四模型集成学习
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-gray-700">
              {MODELS.map((m) => (
                <div key={m.abbr} className="p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                        {m.abbr}
                      </span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {m.name}
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      权重 {m.weight}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    {m.desc}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">集成策略：</span>
                采用加权软投票（Weighted Soft Voting），各模型权重基于验证集 AUC 表现通过 Softmax 动态调整。
                最终输出上涨概率为各模型预测概率的加权平均。
              </p>
            </div>
          </div>
        </section>

        {/* ========== 训练与进化 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Brain className="w-4 h-4 text-rose-500" />
            滚动训练与进化优化
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 滚动训练 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-rose-500" />
                </div>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Walk-forward 滚动训练</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                模拟实盘场景，用过去 N 天数据训练，预测未来 M 天。训练窗口随时间向前滚动，
                确保模型始终基于最新市场规律，避免用未来数据训练。
              </p>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">窗口 120 日</span>
                <span>→</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">预测 20 日</span>
                <span>→</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">步进 20 日</span>
              </div>
            </div>

            {/* 进化优化 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-rose-500" />
                </div>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">自适应进化引擎</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                当近期准确率低于阈值或积累足够新数据时自动触发进化：
                因子权重按特征重要性重新分配、模型权重按 AUC 表现调整、
                低贡献特征被淘汰，并注入探索噪声防止局部最优。
              </p>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">触发条件</span>
                <span>→</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">因子进化</span>
                <span>→</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">模型进化</span>
                <span>→</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">特征选择</span>
              </div>
            </div>
          </div>
        </section>

        {/* ========== 评估体系 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            科学评估体系
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              不只看准确率，从六个维度科学验证模型是否具备<span className="font-medium text-gray-700 dark:text-gray-300">真实的预测能力</span>，
              而非伪相关或数据泄露。综合评分 ≥ 80 分才判定为"具备预测能力"。
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { title: '统计显著性', desc: '二项检验 + 置换检验', score: '25%' },
                { title: '基准对比', desc: 'vs 随机/买入持有/均线', score: '20%' },
                { title: '置信度校准', desc: 'ECE + Brier Score', score: '15%' },
                { title: '过拟合检测', desc: '样本内 vs 样本外', score: '15%' },
                { title: '经济意义', desc: '扣费净收益 / 信息比率', score: '15%' },
                { title: '稳定性', desc: '滚动窗口变异系数', score: '10%' },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{item.title}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.score}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 针对露笑科技的定制 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-500" />
            露笑科技 (002617) 定制方案
          </h3>
          <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-900/10 dark:to-blue-900/10 rounded-2xl border border-cyan-100 dark:border-cyan-800/30 p-5">
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              针对露笑科技<span className="font-medium">高波动、政策敏感、产业链联动强</span>的特点，
              在六大类因子基础上额外注入外部环境因子，形成专属预测模型。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { title: '关联板块指数', items: ['中证光伏产业指数', '中证半导体指数', '新能源车指数'] },
                { title: '上下游关联个股', items: ['北方稀土/五矿稀土(上游)', '比亚迪/宁德时代(下游)'] },
                { title: '宏观敏感指标', items: ['光伏装机量月度数据', '新能源汽车月度销量', '半导体政策事件'] },
                { title: '六阶段演进计划', items: ['基础冷启动 → 滚动验证', '外部因子 → 在线学习', '进化优化 → 实盘监控'] },
              ].map((block) => (
                <div key={block.title} className="bg-white/70 dark:bg-gray-800/50 rounded-xl p-3">
                  <span className="text-xs font-bold text-cyan-700 dark:text-cyan-400">{block.title}</span>
                  <ul className="mt-2 space-y-1">
                    {block.items.map((it) => (
                      <li key={it} className="text-[11px] text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-cyan-300 dark:bg-cyan-600 mt-1.5 flex-shrink-0" />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 免责声明 ========== */}
        <section className="text-center pb-8">
          <div className="inline-block rounded-xl bg-gray-100 dark:bg-gray-800 px-4 py-3">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed max-w-lg">
              <span className="font-medium text-gray-500 dark:text-gray-400">免责声明：</span>
              本预测引擎仅供研究和学习使用，不构成任何投资建议。
              股票市场存在不可预测的风险，任何模型都无法保证盈利。
              预测结果基于历史数据训练，未来表现可能与历史回测存在差异。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
