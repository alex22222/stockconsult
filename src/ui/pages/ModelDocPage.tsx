import { useState, useEffect } from 'react';
import { useAppStore } from '../store/app-store';
import { cosDataUrl } from '../../core/data/cos-data-client';

import {
  ArrowLeft, Database, Layers, GitBranch, BarChart3, ShieldCheck,
  Activity, Zap, FlaskConical,
  AlertTriangle, Clock, Target
} from 'lucide-react';

interface WalkforwardStock {
  name: string;
  n_predictions: number;
  direction_accuracy: number;
  mae: number;
  correlation: number;
  strategy_return_pct: number;
  buyhold_return_pct: number;
  reverse_return_pct: number;
  reverse_better: boolean;
}

/* ---------------- 特征卡片 ---------------- */
const PRICE_FEATURES = [
  { name: 'mom_1d', desc: '1日动量（pct_change）' },
  { name: 'mom_5d', desc: '5日动量' },
  { name: 'mom_20d', desc: '20日动量' },
  { name: 'vol_5d', desc: '5日波动率' },
  { name: 'vol_20d', desc: '20日波动率' },
  { name: 'vol_ratio_5', desc: '成交量/5日均量' },
  { name: 'vol_ratio_20', desc: '成交量/20日均量' },
  { name: 'price_vs_ma20', desc: '价格 vs 20日均线偏离' },
  { name: 'price_pctile_20d', desc: '20日价格分位数' },
  { name: 'atr_14_ratio', desc: 'ATR14/收盘价' },
  { name: 'ma5_above_ma20', desc: 'MA5 是否在 MA20 之上' },
  { name: 'index_return_1d', desc: '上证指数1日收益' },
  { name: 'index_corr_5d', desc: '个股-指数5日相关性' },
  { name: 'amplitude', desc: '日内振幅' },
  { name: 'body_ratio', desc: 'K线实体比例' },
];

const NONPRICE_FEATURES = [
  { name: 'score', desc: 'investoday 综合评分', status: '待接入' },
  { name: 'emotionScore', desc: '情绪面得分', status: '待接入' },
  { name: 'financeScore', desc: '财务面得分', status: '待接入' },
  { name: 'industryScore', desc: '行业面得分', status: '待接入' },
  { name: 'news_sentiment_mean', desc: '新闻情绪均值', status: '待接入' },
  { name: 'us_overnight_score', desc: '美股隔夜综合评分', status: '已接入' },
];

/* ---------------- 主页面 ---------------- */
export function ModelDocPage() {
  const toggleModelDocPage = useAppStore((s) => s.toggleModelDocPage);
  const [wfData, setWfData] = useState<Record<string, WalkforwardStock>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(cosDataUrl('paper-trading/rebuild_walkforward_report.json'))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setWfData(d.stocks || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stocks = Object.values(wfData);
  const avgAcc = stocks.length > 0 ? stocks.reduce((a, s) => a + (s.direction_accuracy ?? 0), 0) / stocks.length : 0;
  const avgMAE = stocks.length > 0 ? stocks.reduce((a, s) => a + (s.mae ?? 0), 0) / stocks.length : 0;

  const reverseBetterCount = stocks.filter(s => s.reverse_better).length;

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
            策略重建预测引擎 · 原理说明
          </h2>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        {/* ========== 概述 ========== */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium">
            <FlaskConical className="w-3.5 h-3.5" />
            基于 Ridge + GBR 集成回归的 5 日收益率预测系统
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-50">
            从精简特征到诚实评估
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            本引擎摒弃了 100+ 维的价格衍生特征（噪声），采用 18 维精简价格特征 + us_overnight_score，
            使用 Ridge + Gradient Boosting Regressor 集成回归预测未来 5 日收益率。
            所有结果均经过 Walk-forward 滚动验证与 7 维科学评估。
          </p>
        </section>

        {/* ========== 系统架构总览 ========== */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" />
            系统架构
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { icon: <Database className="w-5 h-5 text-blue-500" />, title: '数据采集', desc: 'AKShare + baostock', color: 'border-blue-400' },
              { icon: <Layers className="w-5 h-5 text-purple-500" />, title: '特征工程', desc: '18 维精简', color: 'border-purple-400' },
              { icon: <GitBranch className="w-5 h-5 text-amber-500" />, title: '模型训练', desc: 'Ridge + GBR', color: 'border-amber-400' },
              { icon: <Activity className="w-5 h-5 text-rose-500" />, title: 'Walk-forward', desc: '滚动验证', color: 'border-rose-400' },
              { icon: <BarChart3 className="w-5 h-5 text-emerald-500" />, title: '评估报告', desc: '7 维检验', color: 'border-emerald-400' },
            ].map((b, i) => (
              <div key={i} className={`flex flex-col items-center rounded-xl border-2 ${b.color} bg-white dark:bg-gray-800 px-3 py-4`}>
                <div className="mb-2">{b.icon}</div>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{b.title}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{b.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ========== 特征工程 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-500" />
            特征工程：从 100+ 维到 18 维的精简之路
          </h3>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">为什么从 100+ 维降到 18 维？</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">
                  最初的系统构建了 100+ 维特征（MACD/KDJ/RSI/布林带/均线交叉/滞后特征/交互特征等），
                  但 Walk-forward 回测证明：<strong className="text-gray-700 dark:text-gray-300">80%+ 是 OHLCV 的数学变换，彼此高度相关，引入大量噪声</strong>。
                  特征/样本比约 1:1.9，模型几乎必然过拟合。
                  精简到 18 维后，方向准确率未下降，训练速度提升 3 倍。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {PRICE_FEATURES.map((f) => (
                <div key={f.name} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 px-2.5 py-2">
                  <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">{f.name}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-start gap-3 mb-4">
              <Zap className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">独立信号源（非价格特征）</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">
                  当前唯一被验证有效的跨市场 alpha 是 <strong className="text-gray-700 dark:text-gray-300">us_overnight_score</strong>（美股隔夜表现对中国 ADR 相关股票的传导）。
                  investoday API 提供的综合评分、新闻情绪、估值排名等特征正在每日积累中，
                  当覆盖率 ≥ 10%（约 90 天）时将自动接入训练。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {NONPRICE_FEATURES.map((f) => (
                <div key={f.name} className={`rounded-lg border px-2.5 py-2 ${
                  f.status === '已接入'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800'
                    : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-gray-600 dark:text-gray-400">{f.name}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded ${
                      f.status === '已接入'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>{f.status}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== 模型架构 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-amber-500" />
            模型架构：Ridge(0.6) + GBR(0.4) 集成回归
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-xs font-bold text-blue-600">R</span>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Ridge 回归</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 ml-auto">权重 0.6</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                L2 正则化线性回归。在 walk-forward 验证中表现最稳健，
                方向准确率稳定，不易过拟合。作为集成主模型，提供稳定的线性基准。
              </p>
              <div className="mt-3 flex gap-2 text-[10px] text-gray-400">
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">alpha=1.0</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">random_state=42</span>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-xs font-bold text-amber-600">G</span>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Gradient Boosting Regressor</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-auto">权重 0.4</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                梯度提升回归树。对非线性关系建模能力强，但单独使用时方向准确率不稳定。
                与 Ridge 组合后，在保持稳健性的同时捕捉非线性模式。
              </p>
              <div className="mt-3 flex gap-2 text-[10px] text-gray-400">
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">n_estimators=100</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">max_depth=3</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">lr=0.05</span>
              </div>
            </div>
          </div>

          <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-rose-500" />
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">训练流程</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { step: '1', title: '时间序列分割', desc: '前 80% 训练，后 20% 测试' },
                { step: '2', title: '特征选择', desc: 'SelectKBest(mutual_info, k=15)' },
                { step: '3', title: '标准化', desc: 'StandardScaler（仅 fit 训练集）' },
                { step: '4', title: '集成预测', desc: 'Ridge×0.6 + GBR×0.4' },
              ].map((s) => (
                <div key={s.step} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 px-3 py-2.5">
                  <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">步骤 {s.step}</div>
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-0.5">{s.title}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== Walk-forward 验证 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            Walk-forward 滚动验证
          </h3>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              模拟真实交易场景：用过去 252 天数据训练，预测未来 5 日收益率。
              每 20 天重新训练一次，确保模型始终基于最新市场规律。
              <strong className="text-gray-700 dark:text-gray-300">训练窗口始终在预测窗口之前，严格避免数据泄露。</strong>
            </p>
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">回看窗口 252 日</span>
              <span>→</span>
              <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">预测 5 日收益</span>
              <span>→</span>
              <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">步进 20 日</span>
              <span>→</span>
              <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">重新训练</span>
            </div>
          </div>

          {/* 真实回测结果 */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-500" />
                真实 Walk-forward 回测结果
              </h4>
              {loading ? (
                <span className="text-[10px] text-gray-400">加载中...</span>
              ) : (
                <span className="text-[10px] text-gray-400">
                  平均方向准确率 {(avgAcc * 100).toFixed(1)}% · 平均 MAE {avgMAE.toFixed(2)}%
                </span>
              )}
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">加载回测数据中...</div>
            ) : stocks.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暂无回测数据</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                      <th className="px-4 py-2 text-left font-medium">股票</th>
                      <th className="px-4 py-2 text-right font-medium">预测数</th>
                      <th className="px-4 py-2 text-right font-medium">方向准确率</th>
                      <th className="px-4 py-2 text-right font-medium">MAE</th>
                      <th className="px-4 py-2 text-right font-medium">相关系数</th>
                      <th className="px-4 py-2 text-right font-medium">策略收益</th>
                      <th className="px-4 py-2 text-right font-medium">买入持有</th>
                      <th className="px-4 py-2 text-right font-medium">反向策略</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {stocks.map((s) => (
                      <tr key={s.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{s.name}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{s.n_predictions ?? '--'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={(s.direction_accuracy ?? 0) > 0.55 ? 'text-red-600 font-semibold' : (s.direction_accuracy ?? 0) < 0.45 ? 'text-green-600 font-semibold' : 'text-gray-600'}>
                            {s.direction_accuracy !== undefined ? `${(s.direction_accuracy * 100).toFixed(1)}%` : '--'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{s.mae?.toFixed(2) ?? '--'}%</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{s.correlation !== undefined ? `${s.correlation > 0 ? '+' : ''}${s.correlation.toFixed(3)}` : '--'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          <span className={(s.strategy_return_pct ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}>
                            {(s.strategy_return_pct ?? 0) > 0 ? '+' : ''}{s.strategy_return_pct?.toFixed(2) ?? '--'}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{(s.buyhold_return_pct ?? 0) > 0 ? '+' : ''}{s.buyhold_return_pct?.toFixed(2) ?? '--'}%</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={s.reverse_better ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                            {(s.reverse_return_pct ?? 0) > 0 ? '+' : ''}{s.reverse_return_pct?.toFixed(2) ?? '--'}%
                            {s.reverse_better && ' ⚠️'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-t border-gray-100 dark:border-gray-700">
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                ⚠️ 核心发现：方向准确率 45-55% 接近随机水平。{reverseBetterCount} 只股票反向策略更好。
                策略收益全面跑输买入持有。当前价格特征集可能不包含有效 alpha（实验性质）。
              </p>
            </div>
          </div>
        </section>

        {/* ========== 科学评估体系 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            7 维科学评估体系
          </h3>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              不只看准确率，从七个维度科学验证模型是否具备<span className="font-medium text-gray-700 dark:text-gray-300">真实的预测能力</span>，
              而非伪相关或数据泄露。综合评分 ≥ 60 分才判定为"基本合理"。
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { title: '二项检验', desc: '方向准确率是否显著高于 50%', score: '核心' },
                { title: '置换检验', desc: '打乱标签后重新评估', score: '核心' },
                { title: '游程检验', desc: '错误是否随机分布', score: '核心' },
                { title: '校准分析', desc: '预测强度分箱 vs 实际收益', score: '辅助' },
                { title: '经济意义', desc: '扣除成本后净收益', score: '辅助' },
                { title: '过拟合检测', desc: '样本内 vs 样本外差距', score: '辅助' },
                { title: '稳定性分析', desc: '滚动窗口指标变异系数', score: '辅助' },
              ].map((item) => (
                <div key={item.title} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
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

        {/* ========== 演进路线 ========== */}
        <section>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            演进路线与未来计划
          </h3>

          <div className="space-y-3">
            {[
              {
                phase: 'Phase 0', title: '证明或证伪', status: '进行中',
                desc: 'Walk-forward 已证明当前价格特征无 alpha。方向准确率 45-55%，策略全面跑输买入持有。',
                color: 'amber',
              },
              {
                phase: 'Phase 1', title: '接入 investoday 独立信号', status: '数据积累中',
                desc: '每日自动采集 score/emotionScore/financeScore/news_sentiment/估值排名/盈利排名。覆盖率 ≥ 10% 时自动接入训练。预计 2026-08-27 达成。',
                color: 'blue',
              },
              {
                phase: 'Phase 2', title: '建立风控体系', status: '待启动',
                desc: '分级仓位管理（信号强度 > 0.6 → 60%仓位）、市场状态识别（牛/熊/震荡）、涨停跌停过滤。',
                color: 'gray',
              },
              {
                phase: 'Phase 3', title: '工程化自动化', status: '已完成',
                desc: 'daily_pipeline.sh 每日 15:35 自动运行：数据更新 → 预测生成 → 评估报告 → CloudBase 同步。',
                color: 'green',
              },
            ].map((p) => (
              <div key={p.phase} className={`rounded-xl border ${
                p.color === 'amber' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800/30' :
                p.color === 'blue' ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/30' :
                p.color === 'green' ? 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-800/30' :
                'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
              } px-4 py-3`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    p.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                    p.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                    p.color === 'green' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>{p.phase}</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{p.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${
                    p.status === '已完成' ? 'bg-green-100 text-green-700' :
                    p.status === '进行中' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>{p.status}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ========== 免责声明 ========== */}
        <section className="text-center pb-8">
          <div className="inline-block rounded-xl bg-gray-100 dark:bg-gray-800 px-4 py-3">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed max-w-lg">
              <span className="font-medium text-gray-500 dark:text-gray-400">免责声明：</span>
              本预测引擎仅供研究和学习使用，不构成任何投资建议。
              Walk-forward 回测已证明当前模型方向准确率接近随机水平（45-55%），不具备统计显著的预测能力。
              股票市场存在不可预测的风险，任何模型都无法保证盈利。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
