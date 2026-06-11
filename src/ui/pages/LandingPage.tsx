import {
  AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, Clock3,
  FlaskConical, LineChart, PiggyBank, Search, ShieldAlert, Target, Zap,
} from 'lucide-react';
import { useAppStore } from '../store/app-store';

type NavTarget = 'strategyRebuild' | 'momentum' | 'paperTrading' | 'modelDoc' | 'records' | 'search';

function MetricTile({ label, value, note, tone = 'neutral' }: {
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'red' | 'emerald' | 'amber' | 'blue';
}) {
  const toneClass = tone === 'red' ? 'text-red-600 dark:text-red-400'
    : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'blue' ? 'text-blue-600 dark:text-blue-400'
    : 'text-gray-950 dark:text-gray-50';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{note}</div>
    </div>
  );
}

function WorkbenchAction({ title, desc, icon: Icon, target, tone, primary = false }: {
  title: string;
  desc: string;
  icon: typeof Zap;
  target: NavTarget;
  tone: string;
  primary?: boolean;
}) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <button
      onClick={() => navigateTo(target)}
      className={`group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        primary
          ? 'border-gray-900 bg-gray-950 text-white hover:bg-gray-900 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-white'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700 dark:hover:bg-gray-900'
      }`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${primary ? 'bg-white/12 dark:bg-gray-950/10' : tone}`}>
        <Icon className={`h-4 w-4 ${primary ? 'text-white dark:text-gray-950' : ''}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${primary ? '' : 'text-gray-950 dark:text-gray-50'}`}>{title}</div>
        <div className={`mt-1 text-xs leading-relaxed ${primary ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'}`}>{desc}</div>
      </div>
      <ArrowRight className={`mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${primary ? 'text-white dark:text-gray-950' : 'text-gray-400'}`} />
    </button>
  );
}

function StatusRow({ icon: Icon, label, value, tone = 'neutral' }: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone?: 'neutral' | 'red' | 'emerald' | 'amber';
}) {
  const iconClass = tone === 'red' ? 'text-red-500'
    : tone === 'emerald' ? 'text-emerald-500'
    : tone === 'amber' ? 'text-amber-500'
    : 'text-gray-400';

  return (
    <div className="flex items-start gap-2 border-b border-gray-100 py-2.5 last:border-b-0 dark:border-gray-800">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{value}</div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-4 lg:grid-cols-[1.55fr_0.95fr] lg:px-6">
        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  <LineChart className="h-3.5 w-3.5" />
                  量化研究工作台
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-gray-950 dark:text-gray-50">
                  今日先看机会，再看风险，最后看模型是否值得信。
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  当前系统更适合做研究与前向跟踪：扫描高动能标的、观察 5 日收益预测、记录模拟盘执行，并持续用真实结果淘汰无效信号。
                </p>
              </div>
              <button
                onClick={() => navigateTo('search')}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                <Search className="h-3.5 w-3.5" />
                个股分析
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="股票池" value="10+" note="蓝筹跟踪 + 热门扫描" tone="blue" />
              <MetricTile label="预测周期" value="5D" note="收盘后生成信号" />
              <MetricTile label="模型状态" value="研究中" note="未证明稳定 alpha" tone="amber" />
              <MetricTile label="交易成本" value="0.4%" note="买卖来回估算" tone="red" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <WorkbenchAction
              primary
              title="机会扫描"
              desc="直接区分上破追击、等上破确认、回踩低吸和等待确认，减少看不懂信号的摩擦。"
              icon={Zap}
              target="momentum"
              tone="bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
            />
            <WorkbenchAction
              title="策略重建"
              desc="查看 Ridge+GBR 的 5 日收益预测、精选池、walk-forward 和风险基准。"
              icon={FlaskConical}
              target="strategyRebuild"
              tone="bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"
            />
            <WorkbenchAction
              title="模拟盘"
              desc="用前向执行结果检验信号，关注真实成本、止损、止盈和持仓去重。"
              icon={PiggyBank}
              target="paperTrading"
              tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
            />
            <WorkbenchAction
              title="模型说明"
              desc="把模型逻辑、泄漏风险、回测边界和当前局限放在一个地方核对。"
              icon={BrainCircuit}
              target="modelDoc"
              tone="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-50">工作流</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">按交易日闭环组织，不把预测当结论。</p>
              </div>
              <Target className="h-4 w-4 text-gray-400" />
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              {[
                ['01', '收盘后更新', '拉取行情与基础数据'],
                ['02', '生成信号', '预测收益与机会扫描'],
                ['03', '模拟执行', '成本、仓位、止损约束'],
                ['04', '回填验证', '5 日后用真实收益审计'],
              ].map(([step, title, desc]) => (
                <div key={step} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                  <div className="font-mono text-[11px] font-semibold text-gray-400">{step}</div>
                  <div className="mt-2 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">当前结论要冷静</h2>
                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  模型仍处研究期，方向准确率接近随机，机会扫描是筛选器，不是自动买入指令。
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="mb-2 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-50">运行状态</h2>
            </div>
            <StatusRow icon={CheckCircle2} label="数据流水线" value="每日收盘后运行，输出预测、精选池与验证报告。" tone="emerald" />
            <StatusRow icon={AlertTriangle} label="模型可信度" value="前向样本仍少，不能用单日收益证明有效。" tone="amber" />
            <StatusRow icon={Clock3} label="交易视角" value="买点需要触发价和失效条件，不再只显示通过原因。" />
            <StatusRow icon={BrainCircuit} label="下一步" value="先修正泄漏审计和样本不足，再谈放大仓位。" tone="red" />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-50">快捷入口</h2>
              <ArrowRight className="h-4 w-4 text-gray-400" />
            </div>
            <div className="grid gap-2">
              <button
                onClick={() => navigateTo('records')}
                className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                历史预测记录
                <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
              </button>
              <button
                onClick={() => navigateTo('paperTrading')}
                className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                模拟盘持仓
                <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
              </button>
              <button
                onClick={() => navigateTo('modelDoc')}
                className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                模型与风险说明
                <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
