#!/bin/bash
# StockConsult 每日流水线 — launchd 版本
# 由 ~/Library/LaunchAgents/com.stockconsult.daily-pipeline.plist 定时触发

set -e

PROJECT_DIR="/Users/henry/projects/stockconsult"
LOG_FILE="/tmp/stockconsult-daily.log"
PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
ENV_ID="stockconsult-d9g7b6ae5b8170e00"

cd "$PROJECT_DIR"

exec >> "$LOG_FILE" 2>&1

echo "========================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 每日流水线开始"
echo "========================================"

# 1. 更新价格数据
# 2. 更新市场情绪数据
# 3. 更新美股隔夜数据
# 4. 执行预测
# 5. 生成舆情简报
# 6. 模型评估
# 7. Walk-forward 回测
# 8. 模拟盘更新
# 9. 同步到 COS
# 10. 构建前端
# 11. 部署到 CloudBase

# 使用闭环流水线引擎
# 10. 构建前端（按需）
# 11. 部署到 CloudBase（按需）

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 使用闭环流水线引擎..."
$PYTHON cloudfunctions/stock-predictor/pipeline_runner.py --quick || echo "流水线失败，尝试健康检查修复..."
$PYTHON cloudfunctions/stock-predictor/pipeline_runner.py --repair --quick || echo "修复后仍失败"

# 10. 构建前端（按需）
# 11. 部署到 CloudBase（按需）
# 注：前端不常变，只有代码修改时才需要构建部署
# 如需自动部署，取消下面两行注释
# npm run build || echo "构建失败"
# tcb hosting deploy dist -e "$ENV_ID" 2>/dev/null || echo "部署失败"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 每日流水线完成"
echo "========================================"
