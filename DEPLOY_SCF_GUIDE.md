# StockConsult CloudBase 定时任务部署指南

## 目标
在腾讯云 SCF（Serverless Cloud Function）上部署 `stock-predictor`，每天收盘后自动执行预测流水线。

---

## 一、准备工作

### 1.1 部署包位置
本地已打包：`/tmp/stock-predictor-scf.zip`（5.5KB）

包含文件：
- `scf_index.py` — 云函数入口（纯 Python 标准库）
- `requirements.txt` — 依赖声明（仅 urllib3）
- `cloudbaserc.json` — CloudBase 配置参考

### 1.2 功能说明
此版本使用 **investoday MCP API** 获取数据，**纯 Python 标准库** 计算技术指标：
- ✅ 获取历史 K 线数据
- ✅ 计算 MA/RSI/MACD/布林带
- ✅ 多模型评分预测涨跌
- ✅ 生成精选池（Top 买入信号）
- ✅ HTTP API 接口
- ✅ 定时触发器支持
- ❌ 不包含 Ridge+GBR 回归模型（需要 sklearn，体积过大）

---

## 二、SCF 控制台部署步骤

### Step 1: 登录腾讯云 SCF 控制台
打开：https://console.cloud.tencent.com/scf

### Step 2: 创建/选择函数
1. 地域选择：**上海**（与 CloudBase 环境一致）
2. 命名空间：**stockconsult-d9g7b6ae5b8170e00**
3. 函数名称：**stock-predictor**
4. 运行环境：**Python 3.9**

### Step 3: 上传代码
1. 选择「本地上传 ZIP 包」
2. 上传 `/tmp/stock-predictor-scf.zip`
3. 执行方法填写：`scf_index.main_handler`

### Step 4: 配置环境变量
在「函数配置」→「环境变量」中添加：

| 变量名 | 值 |
|--------|-----|
| `INVESTODAY_API_KEY` | `${INVESTODAY_API_KEY}` |

### Step 5: 配置内存和超时
- 内存：**1024 MB**
- 超时：**300 秒**（5分钟，首次运行可能需要较长时间）

### Step 6: 配置定时触发器
在「触发管理」→「创建触发器」：

| 配置项 | 值 |
|--------|-----|
| 触发方式 | 定时触发 |
| 触发周期 | 自定义触发周期 |
| Cron 表达式 | `0 30 15 * * * *` |

**Cron 说明**：每天 15:30 执行（A股收盘后）
- `0 30 15 * * * *` = 秒 分 时 日 月 星期 年

### Step 7: 配置 API 网关（可选）
如需 HTTP 访问，在「触发管理」添加：
- 触发方式：API 网关触发
- 请求方法：ANY
- 发布环境：发布

### Step 8: 保存并测试
1. 点击「完成」保存函数
2. 在「函数管理」→「测试」中运行测试事件：

```json
{
  "path": "/predict-all"
}
```

---

## 三、验证部署

### 3.1 HTTP 接口测试
```bash
# 健康检查
curl https://<API网关地址>/stock-predictor/health

# 单股预测
curl "https://<API网关地址>/stock-predictor/predict?symbol=601318&name=中国平安"

# 批量预测（每日流水线）
curl https://<API网关地址>/stock-predictor/predict-all
```

### 3.2 定时触发器测试
在 SCF 控制台「日志查询」中查看定时任务的执行记录。

---

## 四、与前端集成

### 4.1 更新前端 API 地址
在 `.env.production` 中添加：
```
VITE_STOCK_PREDICTOR_URL=https://<API网关地址>/stock-predictor
```

### 4.2 前端调用示例
```typescript
// 获取每日预测
const response = await fetch(`${import.meta.env.VITE_STOCK_PREDICTOR_URL}/predict-all`);
const report = await response.json();
```

---

## 五、注意事项

### 5.1 免费额度
腾讯云 SCF 每月有 **100万次** 免费调用额度，定时任务每天1次完全够用。

### 5.2 冷启动
云函数首次调用可能有 1-3 秒冷启动时间，后续调用更快。

### 5.3 数据持久化
当前版本预测结果仅返回在响应中，如需持久化存储：
- 方案 A：写入 CloudBase 数据库（需添加 `@cloudbase/node-sdk`）
- 方案 B：写入 COS（对象存储）
- 方案 C：前端接收后存入 localStorage/IndexedDB

### 5.4 与本地 daily_pipeline 的关系
| 维度 | 本地 daily_pipeline | SCF 定时任务 |
|------|---------------------|-------------|
| 数据源 | akshare + baostock | investoday API |
| 模型 | Ridge+GBR 回归 | 技术指标评分 |
| 依赖 | pandas, sklearn, numpy | 纯标准库 |
| 体积 | 220MB | 5KB |
| 精度 | 有回测验证 | 简化版 |

**建议**：
- 本地 daily_pipeline 继续运行（高精度模型）
- SCF 定时任务作为备份/简化版
- 或本地负责训练，SCF 负责每日推理

---

## 六、故障排查

### 6.1 调用超时
- 增加超时时间到 300 秒
- 检查 investoday API 是否可用

### 6.2 返回空数据
- 检查 `INVESTODAY_API_KEY` 环境变量是否正确
- 检查股票代码格式（6位数字）

### 6.3 定时任务未触发
- 检查 Cron 表达式格式
- 查看 SCF 日志确认触发记录

---

## 七、进阶：使用 Layer 部署完整模型

如需在 SCF 上运行完整的 Ridge+GBR 模型：

1. 在 SCF 控制台「层管理」创建 Python Layer
2. 上传包含 pandas + numpy + sklearn + scipy 的 ZIP 包
3. 在函数配置中绑定 Layer
4. 修改 `scf_index.py` 引入 sklearn 进行回归预测

Layer ZIP 包制作：
```bash
pip install pandas numpy scikit-learn scipy -t ./python
zip -r python-layer.zip python/
```

---

部署完成！🎉
