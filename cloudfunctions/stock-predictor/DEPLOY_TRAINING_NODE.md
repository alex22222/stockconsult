# 训练节点部署指南

> 将本机已验证的模型训练环境完整复制到另一台电脑

---

## 一、目标机器环境要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 操作系统 | macOS / Linux / Windows WSL | macOS / Linux |
| Python | 3.10+ | 3.12 |
| 内存 | 4GB | 8GB+ |
| 磁盘 | 1GB 可用空间 | 5GB+（保存历史模型）|
| 网络 | 可访问 GitHub | 可访问 GitHub + 国内网络 |

---

## 二、快速部署（推荐）

### Step 1: 克隆代码仓库

```bash
git clone https://github.com/alex22222/stockconsult.git
cd stockconsult/cloudfunctions/stock-predictor
```

### Step 2: 安装 Python 依赖

```bash
# 创建虚拟环境（强烈推荐）
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

# 安装核心依赖
pip install pandas numpy scikit-learn joblib akshare baostock -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> **踩坑记录**: 如果 `akshare` 安装失败或网络超时，至少确保 `baostock` 安装成功——它是我们的数据生命线。

### Step 3: 一键下载真实数据

```bash
python3 -c "
import baostock as bs, pandas as pd, os
os.makedirs('data', exist_ok=True)
bs.login()

# 下载露笑科技 + 三大指数
for code, fname, fields in [
    ('sz.002617', '002617_daily', 'date,code,open,high,low,close,volume,amount,turn,pctChg'),
    ('sh.000001', 'sh_index_000001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399001', 'sz_index_399001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399006', 'cy_index_399006', 'date,open,high,low,close,volume,amount,pctChg'),
]:
    rs = bs.query_history_k_data_plus(code, fields,
        start_date='2023-01-01', end_date='2026-12-31',
        frequency='d', adjustflag='3')
    data = [rs.get_row_data() for _ in iter(int, 1) if (rs.error_code == '0') & rs.next()]
    df = pd.DataFrame(data, columns=rs.fields)
    df.to_csv(f'data/{fname}.csv', index=False, encoding='utf-8-sig')
    print(f'{fname}: {len(df)} 条')

bs.logout()
print('数据下载完成')
"
```

### Step 4: 验证训练环境

```bash
python3 -c "
import sys; sys.path.insert(0, '.')
from main import StockPredictionEngine
engine = StockPredictionEngine('002617', '露笑科技')
engine.fetch_data(days=500)
X, y = engine.build_features()
print(f'✓ 数据加载成功: {X.shape}')
engine.train_models(use_rolling=False)
print('✓ 训练成功')
pred = engine.predict()
print(f'✓ 预测成功: {pred[\"prediction_label\"]}')
"
```

---

## 三、完整训练流程

### 运行六阶段训练计划

```bash
# 方式1: 完整六阶段
python3 luxiao_training_plan.py --phases 1,2,3,4,5,6

# 方式2: 单独运行某一阶段
python3 luxiao_training_plan.py --phase 1

# 方式3: 只训练+预测（不走评估流程）
python3 main.py --symbol 002617 --name 露笑科技
```

### 训练产物说明

```
models/
├── models_2026xxxx_xxxxxx.joblib   ← 集成模型文件（自动按时间命名）
├── evolution_state_xxx.json         ← 进化引擎状态
└── luxiao_reports/
    ├── phase1_report.json           ← 各阶段评估报告
    ├── phase2_report.json
    └── training_summary_xxx.json    ← 最终汇总

data/
├── 002617_daily.csv                 ← 个股数据（可定期更新）
├── sh_index_000001.csv              ← 上证指数
├── sz_index_399001.csv              ← 深证成指
└── cy_index_399006.csv              ← 创业板指
```

---

## 四、踩坑经验总结（关键！）

### 坑 1: akshare 网络不稳定

**现象**: `RemoteDisconnected('Remote end closed connection without response')`

**解决**: 
- 首次下载数据用 `baostock`（证券宝接口更稳定）
- 数据下载到 `data/` 目录后，训练时自动回退到本地 CSV
- 即使 akshare 完全不可用，也能 100% 离线训练

### 坑 2: 缺失 `tushare_token`

**现象**: `KeyError: 'tushare_token'`

**解决**: `config.py` 中已添加 `"tushare_token": ""`，无需处理。

### 坑 3: 缺失 `get_stock_info`

**现象**: `AttributeError: 'DataFetcher' object has no attribute 'get_stock_info'`

**解决**: 已在 `data_fetcher.py` 中补齐该方法。

### 坑 4: matplotlib 缺失

**现象**: `matplotlib不可用，将只生成文本报告`

**解决**: 不影响训练，只是没有图表报告。如需图表：`pip install matplotlib`

### 坑 5: 不同 Python 环境

**现象**: 系统 Python 缺少包，但虚拟环境中有

**解决**: 始终使用虚拟环境运行训练脚本

```bash
source venv/bin/activate
python3 main.py --symbol 002617
```

---

## 五、自动化脚本（一键部署）

保存为 `setup_training_node.sh`，在新机器上直接运行：

```bash
#!/bin/bash
set -e

echo "=== 训练节点初始化 ==="

# 1. 克隆仓库
if [ ! -d "stockconsult" ]; then
    git clone https://github.com/alex22222/stockconsult.git
fi
cd stockconsult/cloudfunctions/stock-predictor

# 2. 创建虚拟环境
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# 3. 安装依赖
pip install pandas numpy scikit-learn joblib akshare baostock -i https://pypi.tuna.tsinghua.edu.cn/simple -q

# 4. 下载数据
python3 -c "
import baostock as bs, pandas as pd, os
os.makedirs('data', exist_ok=True)
lg = bs.login()
if lg.error_code != '0':
    print('登录失败'); exit(1)

for code, fname, fields in [
    ('sz.002617', '002617_daily', 'date,code,open,high,low,close,volume,amount,turn,pctChg'),
    ('sh.000001', 'sh_index_000001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399001', 'sz_index_399001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399006', 'cy_index_399006', 'date,open,high,low,close,volume,amount,pctChg'),
]:
    rs = bs.query_history_k_data_plus(code, fields,
        start_date='2023-01-01', end_date='2026-12-31',
        frequency='d', adjustflag='3')
    data = []
    while (rs.error_code == '0') & rs.next():
        data.append(rs.get_row_data())
    df = pd.DataFrame(data, columns=rs.fields)
    df.to_csv(f'data/{fname}.csv', index=False, encoding='utf-8-sig')
    print(f'{fname}: {len(df)} 条')

bs.logout()
print('数据准备完成')
"

# 5. 验证训练
python3 -c "
import sys; sys.path.insert(0, '.')
from main import StockPredictionEngine
engine = StockPredictionEngine('002617', '露笑科技')
engine.fetch_data(days=500)
X, y = engine.build_features()
print(f'数据验证: {X.shape}')
engine.train_models(use_rolling=False)
print('训练验证通过')
"

echo "=== 初始化完成，可以开始训练 ==="
echo "运行: python3 luxiao_training_plan.py --phases 1,2,3,4,5,6"
```

---

## 六、每日自动化训练（可选）

如果希望目标机器每天自动训练并输出预测，可以设置 cron 任务：

```bash
# 编辑 crontab
crontab -e

# 每天 21:00 执行训练+预测
0 21 * * * cd /path/to/stockconsult/cloudfunctions/stock-predictor && source venv/bin/activate && python3 main.py --symbol 002617 >> logs/daily_train.log 2>&1
```

---

## 七、两台机器协作方案

| 机器 | 角色 | 任务 |
|------|------|------|
| **本机（开发机）** | 研发节点 | 代码迭代、特征工程实验、模型调参 |
| **另一台（训练机）** | 计算节点 | 大规模回测、滚动训练、每日定时预测、模型进化 |

**同步方式**:
```bash
# 开发机有新代码时
 git push origin main

# 训练机拉取最新代码
 cd stockconsult && git pull origin main
```

---

> 文档版本: 2026-05-16 | 配套代码版本: main 分支最新
