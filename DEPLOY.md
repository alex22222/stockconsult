# CloudBase 部署指南

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                             │
│                    (PC 前端应用)                              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────┐
│              CloudBase 静态网站托管                          │
│         (dist/ 构建产物 → CDN 全球加速)                       │
└────────────────────────┬────────────────────────────────────┘
                         │ AJAX
┌────────────────────────▼────────────────────────────────────┐
│            CloudBase 云函数 (SCF)                            │
│              investoday-proxy                               │
│         ┌──────────────────────────┐                       │
│         │  • CORS 处理              │                       │
│         │  • API Key 安全存储        │                       │
│         │  • 请求转发 investoday     │                       │
│         │  • 统一日志/错误处理        │                       │
│         └──────────────────────────┘                       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────┐
│              investoday.net 数据 API                         │
│         (200+ 金融数据接口)                                   │
└─────────────────────────────────────────────────────────────┘
```

## 前置准备

1. **腾讯云账号** + 开通 [CloudBase 云开发](https://console.cloud.tencent.com/tcb)
2. **investoday API Key** - 注册 [data-api.investoday.net](https://data-api.investoday.net/)
3. **Node.js ≥ 18**

## 快速部署

### 1. 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
# INVESTODAY_API_KEY=你的API密钥
```

### 2. 配置 CloudBase 环境ID

编辑 `cloudbaserc.json`，将 `<你的云开发环境ID>` 替换为真实的 CloudBase 环境 ID：

```json
{
  "envId": "your-env-id-xxx",
  ...
}
```

### 3. 一键部署

```bash
# 方式1: 使用脚本
bash scripts/deploy.sh

# 方式2: 手动部署
npm run build
tcb framework deploy
```

### 4. 配置云函数环境变量（关键）

部署完成后，需在 CloudBase 控制台配置 API Key：

```
CloudBase 控制台 → 云函数 → investoday-proxy → 函数配置 → 环境变量
  添加: INVESTODAY_API_KEY = 你的 investoday API Key
```

## 多环境配置

| 环境 | 配置文件 | 数据源 | 用途 |
|------|---------|--------|------|
| 开发 | `.env.development` | mock | 本地开发，无网络依赖 |
| 测试 | `.env` | investoday-rest | 直连 API 测试 |
| 生产 | `.env.production` | cloudbase | 云函数代理，安全部署 |

切换开发数据源：

```bash
# 使用 Mock 数据（默认）
VITE_DATA_PROVIDER=mock npm run dev

# 使用 investoday 直连（需配置 Key）
VITE_DATA_PROVIDER=investoday-rest VITE_INVESTODAY_API_KEY=xxx npm run dev

# 使用 CloudBase 代理（需先部署云函数）
VITE_DATA_PROVIDER=cloudbase VITE_CLOUDBASE_API_URL=https://xxx.service.tcloudbase.com/investoday-proxy npm run dev
```

## 云函数说明

### investoday-proxy

**路径**: `/cloudfunctions/investoday-proxy/`

**功能**:
- 代理所有 investoday API 请求
- 前端通过 `https://<环境ID>.service.tcloudbase.com/investoday-proxy/api/...` 访问
- API Key 存储在云函数环境变量，前端不可见

**可调用端点**:
```
GET /health                          # 健康检查
GET /api/stock/info?code=600519    # 股票信息
GET /api/stock/market?code=600519  # 行情数据
GET /api/stock/financial?code=xxx  # 财务数据
GET /api/stock/announcements?code=xxx&limit=20  # 公告
GET /api/stock/search?query=茅台   # 搜索
```

## 前端 SPA 路由适配

CloudBase 静态托管已配置 rewrite 规则，所有路由指向 `index.html`：

```json
{
  "rewrite": [
    { "source": "/*", "destination": "/index.html" }
  ]
}
```

## 自定义域名（可选）

1. CloudBase 控制台 → 静态网站托管 → 自定义域名
2. 添加你的域名并配置 DNS CNAME 记录
3. 申请免费 SSL 证书

## 常见问题

**Q: 部署后前端页面空白？**
A: 检查 `cloudbaserc.json` 中 `outputPath` 是否为 `dist`，且构建是否成功。

**Q: 云函数返回 "API Key not configured"？**
A: 需在 CloudBase 控制台 → 云函数 → 环境变量中配置 `INVESTODAY_API_KEY`。

**Q: 如何只更新前端不更新云函数？**
A: `npm run build && tcb hosting deploy dist -e <环境ID>`

**Q: 如何只更新云函数？**
A: `tcb fn deploy investoday-proxy -e <环境ID>`
