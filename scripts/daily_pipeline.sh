#!/bin/bash
# 每日流水线：预测 + 简报 + 飞书推送
cd /Users/henry/projects/stockconsult/cloudfunctions/stock-predictor

# 1. 执行预测
python3 daily_rebuild_record.py --all

# 2. 生成并发送舆情简报
python3 daily_sentiment_report.py --send
