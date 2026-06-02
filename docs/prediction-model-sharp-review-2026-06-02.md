# 股票趋势预测项目犀利复审

> 生成日期：2026-06-02  
> 分析范围：`cloudfunctions/stock-predictor/`、`public/paper-trading/`、`docs/` 中与模型、回测、实盘跟踪相关的代码和报告。  
> 结论性质：代码与结果审计，不构成投资建议。

## 一句话结论

这个项目已经从“技术指标堆叠”开始向“量化研究框架”转型，但当前还不是可交易模型。最重要的问题不是模型不够复杂，而是回测口径、标签构造、真实执行和统计验证还没有完全站稳。

更尖锐一点说：当前已有的 walk-forward 报告已经在反向证明模型缺少稳定 alpha。继续堆模型架构，边际收益很低；先把实验纪律、未来函数和样本外验证钉死，才有继续研究的价值。

## 做得好的地方

### 1. 已经开始修数据泄露

`model_trainer.py` 里已经改成先按时间切分训练集和验证集，再做特征选择和标准化：

- `cloudfunctions/stock-predictor/model_trainer.py:162`
- `cloudfunctions/stock-predictor/model_trainer.py:171`
- `cloudfunctions/stock-predictor/model_trainer.py:175`

这比之前“全量 fit selector/scaler 后再切验证集”的方式健康很多。

### 2. 从分类涨跌转向回归收益率是正确方向

`rebuild_predictor.py` 已经把目标明确到 5 日收益率：

- `cloudfunctions/stock-predictor/rebuild_predictor.py:31`

这比单纯预测“明天涨或跌”更接近交易问题，因为交易最终看的是幅度、成本和盈亏比，而不是方向标签本身。

### 3. 新增 IC 特征评估是对的

`feature_evaluator.py` 用 IC 和分层收益评估特征：

- `cloudfunctions/stock-predictor/feature_evaluator.py:41`

这是从“凭感觉加特征”走向“先验证特征是否有 alpha”的正确路径。

### 4. 已经有真实跟踪闭环雏形

`paper_trading_rebuild.py` 和 `public/paper-trading/portfolio.json` 已经开始做模拟盘记录。虽然样本还很少，但方向比单纯看回测强。

## 致命问题

### 1. 新的 5 日回归回测疑似存在未来泄露

`regression_backtest.py` 里为了预测 `end_idx+1`，对 `stock_daily` 截断到 `end_idx + 5`：

- `cloudfunctions/stock-predictor/regression_backtest.py:67`
- `cloudfunctions/stock-predictor/regression_backtest.py:74`
- `cloudfunctions/stock-predictor/regression_backtest.py:77`

随后又调用：

- `cloudfunctions/stock-predictor/feature_engineer.py:1004`

这里用 `close.shift(-predict_horizon)` 构造 5 日未来收益标签。

这非常危险。预测时为了构造最后一行信号，把未来 5 天价格放进同一批数据环境，再训练模型，容易把当前预测点的未来收益也带进训练集。正确做法应该是：

1. 训练集只包含标签已知的历史样本。
2. 预测日特征单独构造，不带未来标签。
3. `X_train/y_train` 和 `X_signal` 必须分开生成。

现在的实现更像是在修错位时把未来数据一起带进来了。这类问题会让回测结果变得不可引用。

### 2. 分类回测的错位修复也有类似风险

`backtest_engine.py` 为了修正 `build_features` 会删除最后一天的问题，对 `stock_daily` 多留了 `end_idx + 1`：

- `cloudfunctions/stock-predictor/backtest_engine.py:106`
- `cloudfunctions/stock-predictor/backtest_engine.py:109`

随后训练：

- `cloudfunctions/stock-predictor/backtest_engine.py:123`

问题是，如果 `end_idx` 的标签已经通过多留一行被构造出来，那么模型训练时可能已经见过它要预测的那一天答案。这个风险和 5 日版本同源。

### 3. walk-forward 报告已经明显反证模型有效性

`public/paper-trading/rebuild_walkforward_report.json` 里，10 只股票多数跑输买入持有，且很多预测收益与真实收益相关系数为负。

代表性结果：

| 股票 | 方向准确率 | 相关系数 | 策略收益 | 买入持有 | 超额 |
|---|---:|---:|---:|---:|---:|
| 贵州茅台 | 48.63% | -0.0399 | -22.69% | -26.55% | +3.86% |
| 工商银行 | 52.74% | +0.0358 | +46.45% | +131.61% | -85.17% |
| 中国石油 | 50.87% | -0.1363 | +52.61% | +197.05% | -144.44% |
| 农业银行 | 53.74% | -0.0120 | +86.69% | +227.92% | -141.23% |
| 中国平安 | 50.08% | -0.0608 | -14.36% | +25.57% | -39.93% |

这说明模型就算偶尔方向准确率超过 50%，也没有稳定转化为交易收益。更糟的是，多只股票的 `reverse_better=true`，反向策略反而更好。这通常说明信号不稳定，甚至方向可能反着来。

### 4. 置信度仍然是伪置信度

`regression_model_trainer.py` 中的 confidence 是基于预测绝对值和模型间分歧手工拼出来的：

- `cloudfunctions/stock-predictor/regression_model_trainer.py:177`
- `cloudfunctions/stock-predictor/regression_model_trainer.py:180`

这不是概率，不是命中率，也不是校准后的置信度。它最多只能叫“信号强度”或“模型一致性分数”。

但前端和报告里会展示“模型置信度”，例如：

- `public/paper-trading/report.json`

这会给用户错误的确定感。

### 5. 实盘验证样本几乎没有

`public/paper-trading/rebuild_evaluation_report.json` 当前只有 3 条已验证记录，报告明确显示样本不足。

这意味着现在所有“精选池”“买入信号”“模型置信度”都还没有统计意义。模拟盘刚开始跑，可以观察，但不能当证明。

### 6. 模拟盘执行仍偏理想化

`paper_trading_rebuild.py` 买入用最新可用收盘价：

- `cloudfunctions/stock-predictor/paper_trading_rebuild.py:141`

结算时也按历史收盘价处理：

- `cloudfunctions/stock-predictor/paper_trading_rebuild.py:260`

这适合记账演示，但不能等同实盘。A 股至少要处理：

- 次日开盘成交
- 买入后 T+1 才能卖出
- 涨停买不到
- 跌停卖不出
- 停牌
- 除权除息
- 交易日而不是自然日

### 7. 回测体系仍然碎片化

当前仍有多套回测或半回测文件：

- `backtest_engine.py`
- `regression_backtest.py`
- `risk_filter_backtest.py`
- `rebuild_walkforward.py`
- `backtest_v2.py`
- `backtest_weekly.py`
- `backtest_fast.py`

`backtest_v2.py` 虽然已经标注 archived，但代码仍然存在且可运行。多套口径并存会导致一个很危险的问题：坏结果被遗忘，好结果被挑出来展示。

## 模型层面的犀利点评

### 原始分类模型

原始分类模型的本质是：大量同源技术指标加 sklearn 集成模型。它的问题不是“模型太简单”，而是信号源太同质。

GradientBoosting、RandomForest、ExtraTrees、AdaBoost 看似多模型集成，但大部分都是树模型家族。它们对同一批价格、成交量、技术指标的噪声会产生相似反应，集成多样性并没有看起来那么高。

更关键的是，日频涨跌分类本身很难直接交易。55% 的方向准确率，在扣除滑点、佣金、印花税和错过开盘价之后，未必赚钱。

### 5 日回归模型

5 日回归是更正确的方向，但当前回测实现仍有未来泄露风险。只要这个问题没修，所有 5 日回归回测都不能作为证据。

模型选择上，Ridge + GradientBoosting 比大杂烩稳健一些，但从报告看，核心问题不是模型不够强，而是特征没有稳定预测力。

### 风控守门员策略

`risk_filter_backtest.py` 的思路比“满仓/空仓”更成熟：让模型作为仓位过滤器，而不是每天猜涨跌。

但它同样调用了多留未来 5 天的训练预测逻辑：

- `cloudfunctions/stock-predictor/risk_filter_backtest.py:80`
- `cloudfunctions/stock-predictor/risk_filter_backtest.py:88`

因此目前也不能作为可信结论。

## 当前状态判断

项目当前处在 Research Phase，不是 Trading Phase。

更具体地说：

- 可以继续作为研究系统。
- 可以继续跑模拟盘积累样本。
- 不适合用真实资金自动执行。
- 不适合对外声称模型有预测能力。
- 不适合继续优先堆模型复杂度。

## 建议路线

### 第一优先级：重写唯一权威 walk-forward

必须统一成一个权威回测框架，核心原则：

1. 每个预测时点 `t`，训练样本最多只能到 `t - horizon`。
2. `X_signal(t)` 单独构造，不参与训练。
3. 所有 scaler、selector、model 只能在训练窗口 fit。
4. 预测后等待真实未来数据回填验证。
5. 输出必须包含买入持有、空仓、均线、随机、反向信号基准。

在这个框架修好之前，不要再解释策略收益。

### 第二优先级：停止使用“置信度”这个词

当前 confidence 应统一改名为：

- `signal_strength`
- `model_agreement`
- `prediction_magnitude_score`

除非已有至少 100 条样本完成校准，否则不要叫置信度。

### 第三优先级：只保留一条主线

建议主线收敛为：

1. `feature_evaluator.py`
2. `rebuild_predictor.py`
3. `rebuild_walkforward.py`
4. `paper_trading_rebuild.py`

其他回测脚本归档或明确标注“不作为决策依据”。

### 第四优先级：先验证特征，再谈模型

用 IC 和分层收益筛特征。没有跨股票、跨时间稳定 IC 的特征直接删。

目标不是保留 100 个特征，而是保留 10 到 20 个稳定、可解释、互相不高度同源的特征。

### 第五优先级：模拟盘继续跑，但只当观察实验

当前已验证样本只有 3 条。建议最低门槛：

- 30 条验证记录：只能做初步方向观察。
- 100 条验证记录：开始看校准和分层表现。
- 250 条验证记录：才值得讨论统计显著性。

在此之前，精选池只能叫“实验信号”，不能叫“模型推荐”。

### 第六优先级：引入真正独立 alpha

当前特征仍以价格、成交量、技术指标为主，同源性太强。后续更值得投入的是独立信号源：

- 新闻情绪
- 财务质量
- 估值分位
- 行业景气
- 资金流微观结构
- 分析师预期变化

如果没有这些，继续优化树模型和线性模型，多半只是在更精致地拟合噪声。

## 最终判断

这个项目的工程热情和研究意识是有的，而且最近已经开始往正确方向走。但当前最需要的不是更多模型，而是更冷酷的实验纪律。

先把未来函数彻底掐掉，再让结果难看地真实起来。真实但难看的回测，比漂亮但带泄露的回测有价值得多。
