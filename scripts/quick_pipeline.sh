#!/bin/bash
# StockConsult 快速数据流水线 — 只计算 + 上传，不构建部署

set -e

PROJECT_DIR="/Users/henry/projects/stockconsult"
LOG_FILE="/tmp/stockconsult-quick.log"
PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
ENV_ID="stockconsult-d9g7b6ae5b8170e00"

cd "$PROJECT_DIR"

exec > "$LOG_FILE" 2>&1

echo "========================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 快速流水线开始"
echo "========================================"

# 1. 更新价格数据
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 1. 更新价格数据..."
$PYTHON cloudfunctions/stock-predictor/update_daily_data.py || echo "价格更新失败，继续..."

# 2. 执行预测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 2. 执行预测..."
cd "$PROJECT_DIR/cloudfunctions/stock-predictor"
$PYTHON daily_rebuild_record.py --all || echo "预测失败"

# 3. 模拟盘更新
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 3. 模拟盘更新..."
$PYTHON paper_trading_rebuild.py full 2>/dev/null || true

# 4. 生成舆情简报
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 4. 生成舆情简报..."
$PYTHON daily_sentiment_report.py --send 2>/dev/null || true

# 5. 模型评估
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 5. 模型评估..."
$PYTHON run_rebuild_evaluation.py 2>/dev/null || true

# 6. Walk-forward 回测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 6. Walk-forward 回测..."
$PYTHON rebuild_walkforward.py 2>/dev/null || true

# 7. 同步到 COS
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 7. 同步数据到 COS..."
$PYTHON upload_to_cos.py || echo "COS 同步失败"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 快速流水线完成"
echo "========================================"
