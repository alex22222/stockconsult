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
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 1. 更新价格数据..."
$PYTHON cloudfunctions/stock-predictor/update_daily_data.py || echo "价格更新失败，继续..."

# 2. 更新市场情绪数据
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 2. 更新市场情绪数据..."
$PYTHON cloudfunctions/stock-predictor/fetch_market_sentiment_data.py || echo "市场情绪更新失败，继续..."

# 3. 更新美股隔夜数据
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 3. 更新美股隔夜数据..."
$PYTHON -c "from cloudfunctions.stock_predictor.us_market_fetcher import download_us_history; download_us_history()" 2>/dev/null || true

# 4. 执行预测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 4. 执行预测..."
cd "$PROJECT_DIR/cloudfunctions/stock-predictor"
$PYTHON daily_rebuild_record.py --all || echo "预测失败"

# 5. 生成舆情简报
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 5. 生成舆情简报..."
$PYTHON daily_sentiment_report.py --send 2>/dev/null || true

# 6. 模型评估
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 6. 模型评估..."
$PYTHON run_rebuild_evaluation.py 2>/dev/null || true

# 7. Walk-forward 回测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 7. Walk-forward 回测..."
$PYTHON rebuild_walkforward.py 2>/dev/null || true

# 8. 模拟盘更新
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 8. 模拟盘更新..."
$PYTHON paper_trading_rebuild.py full 2>/dev/null || true

# 9. 同步到 COS
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 9. 同步数据到 COS..."
cd "$PROJECT_DIR/cloudfunctions/stock-predictor"
$PYTHON upload_to_cos.py || echo "COS 同步失败"

# 10. 构建前端
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 10. 构建前端..."
cd "$PROJECT_DIR"
npm run build || echo "构建失败"

# 11. 部署到 CloudBase
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 11. 部署到 CloudBase..."
tcb hosting deploy dist -e "$ENV_ID" 2>/dev/null || echo "部署失败"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 每日流水线完成"
echo "========================================"
