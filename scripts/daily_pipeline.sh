#!/bin/bash
# 每日流水线：数据更新 + 预测 + 简报 + 飞书推送 + CloudBase 同步
# 注意：使用 python3 的完整路径，确保 launchd 环境能找到依赖

PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
ENV_ID="stockconsult-d9g7b6ae5b8170e00"
cd /Users/henry/projects/stockconsult/cloudfunctions/stock-predictor

# 1. 更新价格数据（个股 + 指数）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新价格数据..."
$PYTHON update_daily_data.py

# 2. 更新市场情绪数据（北向资金、涨跌停、国债收益率）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新市场情绪数据..."
$PYTHON fetch_market_sentiment_data.py

# 3. 更新美股隔夜数据
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新美股隔夜数据..."
$PYTHON -c "from us_market_fetcher import download_us_history; download_us_history()"

# 4. 执行预测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 执行预测..."
$PYTHON daily_rebuild_record.py --all

# 5. 生成并发送舆情简报
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 生成舆情简报..."
$PYTHON daily_sentiment_report.py --send

# 6. 运行模型评估（基于已验证的预测记录）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 运行模型评估..."
$PYTHON run_rebuild_evaluation.py 2>/dev/null || true

# 7. 运行 Walk-forward 回测
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 运行 Walk-forward 回测..."
$PYTHON rebuild_walkforward.py 2>/dev/null || true

# 8. 更新模拟盘数据（精选池联动）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新模拟盘..."
$PYTHON paper_trading_rebuild.py full

# 9. 同步预测数据到前端 public 目录
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 同步本地前端数据..."
cp data/rebuild/prediction_history.json ../../public/paper-trading/rebuild_prediction_history.json
cp data/rebuild/evaluation_report.json ../../public/paper-trading/rebuild_evaluation_report.json 2>/dev/null || true
cp data/rebuild/walkforward_report.json ../../public/paper-trading/rebuild_walkforward_report.json 2>/dev/null || true
cp data/rebuild/focus_pool.json ../../public/paper-trading/rebuild_focus_pool.json 2>/dev/null || true
# 同步最新的 daily_summary（前端期望的文件名是 rebuild_daily_summary_*.json）
TODAY=$(date '+%Y-%m-%d')
cp "data/rebuild/daily_summary_${TODAY}.json" "../../public/paper-trading/rebuild_daily_summary_${TODAY}.json" 2>/dev/null || true

# 9. 同步到 CloudBase 静态托管（方案B）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 同步到 CloudBase..."
cd /Users/henry/projects/stockconsult
if command -v tcb &> /dev/null; then
    tcb hosting deploy ./public/paper-trading paper-trading -e "$ENV_ID" 2>&1 | tail -5
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] CloudBase 同步完成"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ tcb CLI 未找到，跳过 CloudBase 同步"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 每日流水线完成"
