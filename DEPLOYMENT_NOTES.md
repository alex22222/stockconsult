# StockConsult 部署经验总结

> 记录时间：2026-05-16
> 记录人：Kimi Code CLI

## 部署架构

```
前端 (dist/) ──→ CloudBase 静态网站托管 (CDN)
                       │
                       ▼
         investoday-proxy (Node.js SCF)
         stock-predictor (Python SCF) ← 依赖问题待解决
```

- 环境ID：`stockconsult-d9g7b6ae5b8170e00`
- 地域：`ap-shanghai`
- CloudBase 桶：`7374-stockconsult-d9g7b6ae5b8170e00-1328081868`

---

## 前端部署（已成功）

```bash
# 构建
npm run build

# 部署到 CloudBase 静态托管
tcb hosting deploy dist -e stockconsult-d9g7b6ae5b8170e00
```

**地址**：https://stockconsult-d9g7b6ae5b8170e00-1328081868.tcloudbaseapp.com

---

## investoday-proxy 云函数部署（已成功）

```bash
# 导出 API Key（云函数环境变量需要）
export INVESTODAY_API_KEY=$(grep VITE_INVESTODAY_API_KEY .env | cut -d= -f2)

# 部署（tcb framework deploy 因 CLI bug 不可用，改用以下方式）
# 方式1：使用 tcb fn deploy（需配合 cloudbaserc.json 旧版格式）
# 方式2：直接 tcb fn deploy investoday-proxy -e <envId> --dir cloudfunctions/investoday-proxy
```

**健康检查**：
```bash
curl https://stockconsult-d9g7b6ae5b8170e00.service.tcloudbase.com/investoday-proxy/health
# 期望返回 200
```

**关键配置**：
- 运行时：Nodejs18.15
- 超时：120秒
- 内存：256MB
- 环境变量：`INVESTODAY_API_KEY`（需在 CloudBase 控制台或部署时配置）

---

## stock-predictor 云函数部署（受阻）

### 当前状态
- HTTP 路由已创建：/stock-predictor
- 代码已上传（不含 Python 依赖包）
- 运行时缺少 `pandas`、`numpy`、`scikit-learn`

### 遇到的关键问题

#### 问题1：CloudBase CLI `tcb framework deploy` 无法使用
- **现象**：`Error: Cannot find module .../framework-plugin-website` (webpackEmptyContext)
- **根因**：CloudBase CLI 2.12.7 / 3.3.3 的 standalone 版本有 bug，无法动态加载 framework 插件
- **workaround**：放弃 `tcb framework deploy`，改用 `tcb fn deploy` 分别部署各组件

#### 问题2：`tcb fn deploy` ZIP 上传限制仅 1.5MB
- **现象**：`ZipFile 上传不能大于 1.5MB，请使用 COS 上传方式`
- **影响**：`stock-predictor` 打包 `pandas/numpy/sklearn` 后 ZIP 约 64MB，无法直传

#### 问题3：COS 上传 60 秒超时
- **现象**：`[stock-predictor] COS 上传超时（60秒）`
- **已尝试**：多次重试均失败，即使 ZIP 从 95MB 精简到 64MB 仍然超时
- **根因**：当前网络环境下，CloudBase CLI 的 COS 分块上传速度不足以在 60 秒内完成

#### 问题4：SCF `InstallDependency` 在线安装不生效
- **现象**：`InstallDependency: "TRUE"` 已配置，`requirements.txt` 在代码包中，但多次调用仍报 `No module named 'pandas'`
- **已验证**：`requirements.txt` 存在于部署包中，但 SCF 后台未触发 pip install

#### 问题5：`tcb api scf UpdateFunctionCode` COS 桶名称格式不符
- **现象**：`CosBucketName取值与规范不符`
- **已尝试**：`7374-stockconsult-d9g7b6ae5b8170e00-1328081868`、`stockconsult-d9g7b6ae5b8170e00-1328081868` 均失败
- **待验证**：可能需要使用 SCF 专用的 COS 桶，而非 CloudBase 云存储桶

### 可行解决方案（待执行）

| 方案 | 难度 | 说明 |
|------|------|------|
| **A. 控制台手动上传** | 低 | 登录 CloudBase 控制台 → 云函数 → 函数代码 → 上传 ZIP 包（控制台无 60 秒限制） |
| **B. CloudBase Layer** | 中 | 在控制台创建预装 pandas/numpy/sklearn 的 Python Layer，绑定到函数 |
| **C. 简化技术栈** | 高 | 将 stock-predictor 改写为纯 numpy 实现，移除 sklearn，使 ZIP < 1.5MB |
| **D. 使用腾讯云 SCF 控制台** | 低 | 直接在 SCF 控制台（非 CloudBase）上传代码和配置依赖 |

### 依赖精简记录

为尝试缩小包体积，已执行以下清理（仍无法降至 1.5MB）：
1. 移除了 `pytz/`（pandas 2.x 使用 tzdata）
2. 移除了 sklearn 不常用子模块：`cluster/`, `datasets/`, `decomposition/`, `manifold/` 等
3. 移除了 scipy 不常用子模块：`io/`, `signal/`, `misc/`, `fft/`, `ndimage/`, `fftpack/`
4. 移除了所有 `tests/` 目录、`.dist-info`、`.pyx`/`.pxd` 源文件

**清理后大小**：原始 212MB → ZIP 64MB（仍远超 1.5MB）

### 手动上传 ZIP 包步骤（备忘）

```bash
# 1. 创建精简版 ZIP（已在 /tmp/stock-predictor-smaller.zip，64MB）
cd cloudfunctions/stock-predictor
zip -r /tmp/stock-predictor.zip . -x "*.pyc" -x "__pycache__/*"

# 2. 上传到 CloudBase 云存储（成功过）
tcb storage upload /tmp/stock-predictor.zip stock-predictor.zip -e stockconsult-d9g7b6ae5b8170e00

# 3. 通过 API 更新函数代码（COS 桶名称格式待确认）
# 需要找到正确的 CosBucketName 格式
```

---

## TypeScript 编译修复记录

构建时遇到的 TS 错误及修复：

1. **未使用的 import（TS6133）**
   - `Header.tsx`：移除 `BarChart3`, `Sword`
   - `PaperTradingPage.tsx`：移除 `TrendingUp`, `TrendingDown`, `CheckCircle2`, `XCircle`, `ChevronUp`
   - `StrategyAdvisorPage.tsx`：移除 `TrendingDown`, `Percent`

2. **未使用的变量（TS6133）**
   - `PaperTradingPage.tsx(212)`：移除 `settledSignals`

3. **AppState 缺少属性（TS2739）**
   - `app-store.ts`：添加 `toggleStrategyAdvisorPage` 和 `togglePaperTradingPage` 的实现

---

## 关键命令速查

```bash
# 登录检查
tcb login --check

# 前端部署
tcb hosting deploy dist -e stockconsult-d9g7b6ae5b8170e00

# 查看云函数列表
tcb fn list -e stockconsult-d9g7b6ae5b8170e00

# 查看函数详情
tcb api scf GetFunction --body '{"FunctionName":"stock-predictor","Namespace":"stockconsult-d9g7b6ae5b8170e00"}' --json

# 查看路由
tcb routes list -e stockconsult-d9g7b6ae5b8170e00

# 添加路由
tcb routes add -e stockconsult-d9g7b6ae5b8170e00 --data '{"domain":"*","routes":[{"path":"/stock-predictor","upstreamResourceType":"SCF","upstreamResourceName":"stock-predictor"}]}'

# 调用函数（查看日志）
tcb api scf Invoke --body '{"FunctionName":"stock-predictor","Namespace":"stockconsult-d9g7b6ae5b8170e00","InvocationType":"RequestResponse","LogType":"Tail"}' --json
```

---

## 环境变量

```bash
# .env 中已有的变量
VITE_DATA_PROVIDER=investoday-mcp
VITE_INVESTODAY_API_KEY=${INVESTODAY_API_KEY}
VITE_CLOUDBASE_API_URL=https://stockconsult-d9g7b6ae5b8170e00.service.tcloudbase.com/investoday-proxy

# 云函数部署时需要导出
export INVESTODAY_API_KEY=${INVESTODAY_API_KEY}
```

---

## 配置文件说明

| 文件 | 用途 | 备注 |
|------|------|------|
| `cloudbaserc.json` | CloudBase Framework v2.0 配置 | `tcb framework deploy` 因 bug 不可用 |
| `cloudfunctions/investoday-proxy/cloudbaserc.json` | 旧版函数配置 | `tcb fn deploy --all` 可读取 |
| `cloudfunctions/stock-predictor/cloudbaserc.json` | 旧版函数配置 | 同上 |
| `.env` | 前端环境变量 | `VITE_` 前缀 |
