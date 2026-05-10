#!/bin/bash
# ============================================
# StockConsult - CloudBase 一键部署脚本
# ============================================

set -e

echo "=== StockConsult CloudBase 部署 ==="

# 检查依赖
echo "→ 检查依赖..."
if ! command -v tcb &> /dev/null; then
    echo "× 未安装 CloudBase CLI，正在安装..."
    npm install -g @cloudbase/cli
fi

if ! command -v tcb &> /dev/null; then
    echo "× CloudBase CLI 安装失败，请手动安装: npm install -g @cloudbase/cli"
    exit 1
fi

# 检查登录状态
echo "→ 检查登录状态..."
tcb login --check || tcb login

# 读取环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 检查必要配置
ENV_ID=$(grep -o '"envId": *"[^"]*"' cloudbaserc.json | cut -d'"' -f4)
if [ "$ENV_ID" = "<你的云开发环境ID>" ]; then
    echo "× 错误: 请在 cloudbaserc.json 中填写你的云开发环境ID"
    exit 1
fi

# 检查 API Key
if [ -z "$INVESTODAY_API_KEY" ]; then
    echo "⚠ 警告: 未设置 INVESTODAY_API_KEY 环境变量"
    echo "  云函数部署后将无法调用真实 API"
    echo "  请在 CloudBase 控制台 → 云函数 → investoday-proxy → 环境变量 中配置"
fi

# 构建前端
echo "→ 构建前端..."
npm run build

# 部署到 CloudBase
echo "→ 部署到 CloudBase ($ENV_ID)..."
tcb framework deploy

echo ""
echo "=== 部署完成 ==="
echo "前端地址: https://$ENV_ID.tcloudbaseapp.com"
echo "云函数地址: https://$ENV_ID.service.tcloudbase.com/investoday-proxy"
echo ""
echo "如需配置 investoday API Key:"
echo "  CloudBase 控制台 → 云函数 → investoday-proxy → 环境变量 → 添加 INVESTODAY_API_KEY"
