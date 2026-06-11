# 股票趋势预测项目犀利复审

> 生成日期：2026-06-06  
> 分析范围：`cloudfunctions/stock-predictor/`、`public/paper-trading/`、`scripts/`、`src/ui/`、`docs/` 中与股票趋势预测、回测、模拟盘、前端展示相关的代码和结果。  
> 结论性质：代码与模型逻辑审计，不构成投资建议。

## 一句话结论

项目比 2026-06-02 的版本明显收敛：旧回测脚本已经移入 `archived/`，主线集中到 `rebuild_predictor.py`、`rebuild_walkforward.py`、`paper_trading_rebuild.py`，模拟盘也开始积累真实记录。

但核心问题仍未解决：当前 walk-forward 的 5 日收益标签存在“标签可得性”时间泄露风险。即使特征本身没有未来函数，训练集里也可能包含在真实预测时点尚不可知的未来收益标签。这个问题不修，回测结论仍然不能完全引用。

更冷一点说：工程纪律在进步，但 alpha 还没出现。最新 walk-forward 结果仍显示模型多数跑输买入持有，预测与真实收益相关性大多接近 0 或为负。

## 当前进步

### 1. 回测体系开始收敛

旧的高风险或混淆脚本已被移入 `cloudfunctions/stock-predictor/archived/`，包括：

- `backtest_fast.py`
- `backtest_v2.py`
- `backtest_weekly.py`
- `regression_backtest.py`
- `risk_filter_backtest.py`
- `rebuild_backtest.py`

这是非常好的动作。量化项目最怕多套回测口径并存，因为坏结果会被忘掉，好结果会被拿出来展示。归档旧引擎让“唯一主线”更清楚。

### 2. 主线 walk-forward 加了安全审计

`rebuild_walkforward.py` 新增了 `audit_walkforward_safety()`：

- `cloudfunctions/stock-predictor/rebuild_walkforward.py:34`
- `cloudfunctions/stock-predictor/rebuild_walkforward.py:124`

它检查了特征行数、标签长度、dropna 后行数、特征列名等。这说明项目已经开始主动防未来函数。

### 3. 特征构造注释更清楚

`rebuild_predictor.py` 对核心特征逐项标注了时间窗口：

- `cloudfunctions/stock-predictor/rebuild_predictor.py:37`
- `cloudfunctions/stock-predictor/rebuild_predictor.py:60`
- `cloudfunctions/stock-predictor/rebuild_predictor.py:86`

这比之前“堆技术指标但不知道每个特征是否可用”的状态好很多。

### 4. 模拟盘进入真实记录阶段

`public/paper-trading/portfolio.json`、`trades.json`、`portfolio_history.json` 已经有实际模拟交易记录。当前模拟盘已产生 2 笔闭合交易，净值约为 `1.0021`，累计收益约 `+0.2144%`。

样本太少，不能说明模型有效，但至少闭环开始跑起来了。

## 致命问题

### 1. Walk-forward 仍有 5 日标签可得性泄露

`rebuild_walkforward.py` 中构造 5 日未来收益：

- `cloudfunctions/stock-predictor/rebuild_walkforward.py:98`

```python
future_return = (close.shift(-PREDICT_HORIZON) / close - 1) * 100
```

随后在预测第 `i` 天时，训练集是：

- `cloudfunctions/stock-predictor/rebuild_walkforward.py:142`
- `cloudfunctions/stock-predictor/rebuild_walkforward.py:143`

```python
train_X = X_all.iloc[:i]
train_y = y_all[:i]
```

问题在于：`y_all[i-1]`、`y_all[i-2]`、`y_all[i-3]`、`y_all[i-4]` 都是未来 5 日收益。在真实时间的第 `i` 天，这些标签还没有完全发生，不能用于训练。

当前代码虽然没有把第 `i` 天特征放进训练，但它把“第 `i` 天尚不可知的近几天标签”放进了训练。这是标签可得性泄露，不是特征未来函数。

正确训练边界应该类似：

```python
train_end = i - PREDICT_HORIZON
train_X = X_all.iloc[:train_end]
train_y = y_all[:train_end]
```

并且要断言：训练集中任一样本的标签结束日期不得晚于预测日期。

### 2. 现有 P0 审计结论过满

`docs/prediction-model-review-round2-2026-06-02-P0-AUDIT.md` 写道：

- `docs/prediction-model-review-round2-2026-06-02-P0-AUDIT.md:11`

> 未发现未来数据泄露。代码设计正确，已通过运行时断言验证。

这个结论需要降级。现有审计主要验证了：

- 特征列不含未来信息。
- scaler/selector 只在训练窗口 fit。
- 特征和标签长度对齐。

但它没有验证“训练标签在预测时点是否已经可观察”。对 5 日收益模型来说，这是更关键的时间约束。

建议改为：

> 未发现特征未来函数，但 5 日标签可得性仍需修复和重测。

### 3. 最新 walk-forward 继续反证模型有效性

`public/paper-trading/rebuild_walkforward_report.json` 生成于 `2026-06-05T17:32:32`。核心数据如下：

| 股票 | 预测数 | 方向准确率 | 相关系数 | 策略收益 | 买入持有 | 超额 | 反向更优 |
|---|---:|---:|---:|---:|---:|---:|:--:|
| 贵州茅台 | 807 | 47.21% | -0.0517 | -38.28% | -24.52% | -13.76% | 是 |
| 工商银行 | 807 | 53.04% | +0.0495 | +47.32% | +132.90% | -85.59% | 否 |
| 中国石油 | 807 | 51.05% | -0.1269 | +50.01% | +191.42% | -141.41% | 是 |
| 农业银行 | 807 | 52.66% | -0.0073 | +77.48% | +220.81% | -143.33% | 否 |
| 中国银行 | 807 | 55.76% | +0.0530 | +79.91% | +116.31% | -36.40% | 否 |
| 中国人寿 | 807 | 48.82% | -0.0418 | -7.68% | -1.34% | -6.34% | 是 |
| 招商银行 | 807 | 49.57% | -0.0371 | +23.58% | +11.88% | +11.70% | 否 |
| 中国神华 | 807 | 53.41% | -0.0109 | +43.81% | +103.23% | -59.42% | 否 |
| 长江电力 | 807 | 50.43% | -0.0738 | +23.44% | +48.84% | -25.40% | 否 |
| 中国平安 | 673 | 51.11% | -0.0668 | -5.74% | +23.28% | -29.02% | 是 |

结论很明确：

- 多数股票跑输买入持有。
- 预测收益与真实收益相关性大多接近 0 或为负。
- 方向准确率略高于 50% 的股票，也没有稳定转化为超额收益。
- 反向策略在多只股票上更好。

这不是“模型还差一点”。这更像是当前特征集没有稳定 alpha。

### 4. 评估脚本有方向正确性明细 bug

`run_rebuild_evaluation.py` 里 records 明细的 `correct` 写法是：

- `cloudfunctions/stock-predictor/run_rebuild_evaluation.py:123`

```python
"correct": (r.get("predicted_return_5d", 0) or 0) > 0 == (r.get("actual_return", 0) or 0) > 0
```

Python 会把它解析为链式比较，不是两个布尔表达式相等。正确写法应是：

```python
"correct": ((r.get("predicted_return_5d", 0) or 0) > 0) == ((r.get("actual_return", 0) or 0) > 0)
```

当前主统计 `pred_direction == actual_direction` 是对的，但 records 明细会误导前端和人工复盘。

### 5. “置信度”仍然是伪概念

`rebuild_predictor.py` 仍然用以下方式生成 confidence：

- `cloudfunctions/stock-predictor/rebuild_predictor.py:354`

```python
"confidence": round(abs(ensemble) / 5, 4)
```

这只是预测收益绝对值除以 5。它衡量的是信号幅度，不是命中概率，也不是校准置信度。

但前端和 JSON 仍然展示“置信度”，例如：

- `src/ui/pages/PaperTradingPage.tsx:645`
- `public/paper-trading/report.json`

建议统一改成：

- `signal_strength`
- `预测强度`

等至少有 100 条已验证样本后，再谈校准后的概率或置信度。

### 6. 云函数入口和本地主线模型不是一套东西

`scf_index.py` 是云函数入口，但它并没有跑本地主线 Ridge + GBR 5 日回归模型。

它实际是一个硬编码技术评分器：

- `cloudfunctions/stock-predictor/scf_index.py:163`
- `cloudfunctions/stock-predictor/scf_index.py:187`
- `cloudfunctions/stock-predictor/scf_index.py:223`

而且它把规则评分命名成：

- `gradient_boosting`
- `random_forest`
- `extra_trees`

这会让用户误以为云端跑的是机器学习模型。实际上不是。

更刺眼的是：

- `cloudfunctions/stock-predictor/scf_index.py:33`

这里给了默认 API key。即使它可能只是体验 key，也不应该出现在代码默认值里。

### 7. 模拟盘仍有回放式结算问题

`paper_trading_rebuild.py` 的结算逻辑会从买入日后所有已有行情逐日扫描：

- `cloudfunctions/stock-predictor/paper_trading_rebuild.py:296`
- `cloudfunctions/stock-predictor/paper_trading_rebuild.py:307`

如果某天脚本没跑，之后再运行会“回放”过去几天并把退出日期写成过去日期。这会导致净值历史不连续。

当前 `portfolio_history.json` 已出现味道：

- 2026-06-03 和 2026-06-04 净值没有反映真实平仓变化。
- 2026-06-05 一次性变成全现金。

这对于模拟盘展示可以接受，但对于策略绩效评估不严谨。

## 模型层面的犀利点评

### 1. 当前模型不是缺调参，是缺 alpha

Ridge + GBR 组合是克制的，特征也比原来精简了。但回测结果表明：特征与未来收益的关系太弱。

如果预测收益和真实收益的相关系数长期在 0 附近，甚至多只股票为负，那么换更复杂模型只会更快地拟合噪声。

### 2. 方向准确率不是交易能力

中国银行方向准确率 55.76%，看起来不错，但策略收益仍跑输买入持有。

原因很简单：

- 对的日子可能赚得少。
- 错的日子可能亏得多。
- 空仓会错过趋势行情。
- 交易成本吃掉微弱优势。

方向准确率只是入门指标，不是交易系统指标。

### 3. 当前策略更像“择时减仓实验”，不是预测系统

如果模型在强趋势大票上长期跑输买入持有，它更适合被定位为风险过滤器，而不是收益增强器。

但要做风险过滤，评价指标也要换：

- 是否降低最大回撤？
- 是否提高 Calmar？
- 是否减少左尾亏损？
- 是否在熊市阶段有效？

现在用“策略收益 vs 买入持有”评价择时模型，结论已经不太乐观。

### 4. 模拟盘盈利不能说明模型有效

当前模拟盘 2 笔交易，1 盈 1 亏，净收益约 +21.43 元。这个样本没有统计意义。

更重要的是，这两笔都来自银行股短期行情，不能证明模型泛化。

## 建议优先级

### P0：修正 walk-forward 标签边界

把训练窗口从：

```python
train_X = X_all.iloc[:i]
train_y = y_all[:i]
```

改为：

```python
train_end = i - PREDICT_HORIZON
if train_end < MIN_TRAIN_SIZE:
    continue
train_X = X_all.iloc[:train_end]
train_y = y_all[:train_end]
```

同时在审计函数里新增检查：

```python
latest_train_label_end = train_end - 1 + PREDICT_HORIZON
assert latest_train_label_end <= i
```

这一步完成前，walk-forward 报告仍应标注“存在标签可得性风险”。

### P1：修复评估明细 bug

修复 `run_rebuild_evaluation.py:123` 的链式比较。

否则前端展示和人工复盘会出现方向正确性误判。

### P2：重命名 confidence

将本项目主线里的：

```json
"confidence": 0.4762
```

改为：

```json
"signal_strength": 0.4762
```

前端展示也改为“预测强度”。

### P3：统一云端与本地主线

二选一：

1. SCF 明确定位为“轻量规则评分器”，前端别把它和主线模型混为一谈。
2. 把主线 `rebuild_predictor.py` 的 Ridge + GBR 逻辑部署到 SCF。

现在的状态最危险：名字像模型，实际是规则。

### P4：模拟盘按交易日推进

模拟盘结算应只处理当前交易日，不应回放历史多日并改写过去退出日期。

如果必须补跑，建议记录：

```json
"backfilled": true
```

并单独标识为补账，不混入正常净值曲线。

### P5：停止用“推荐/置信度”式语言

用户界面和报告建议改成：

- “实验信号”
- “预测强度”
- “样本不足”
- “未证明有 alpha”

不要让前端语气比模型证据更自信。

## 当前定位

这个项目现在应该定位为：

> A 股 5 日收益预测的研究与模拟盘实验系统。

不应该定位为：

> 可用于实盘的股票趋势预测模型。

理由：

- walk-forward 标签边界仍需修。
- 历史回测多数跑输买入持有。
- 实盘验证只有 6 条已验证记录。
- 云端与本地主线模型不一致。
- 置信度未校准。

## 最终判断

这几天的工程方向是对的：归档旧脚本、收敛主线、增加审计、跑模拟盘，这些都是真进步。

但模型有效性这件事，还没有被证明。相反，目前多数证据仍然指向：价格衍生特征在这套股票池和 5 日尺度上没有稳定 alpha。

下一步最有价值的不是继续加模型，而是把 walk-forward 的标签边界修正，然后重跑。重跑后如果结果更差，也别急，这是项目从“好看”走向“可信”的必经过程。
