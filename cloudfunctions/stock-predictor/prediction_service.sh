#!/bin/bash
# ============================================================
# 露笑科技 AI 预测服务管理脚本
# ============================================================

WORK_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$WORK_DIR/logs"
mkdir -p "$LOG_DIR"

# 尝试激活虚拟环境（如果存在）
if [ -f "$WORK_DIR/venv/bin/activate" ]; then
    source "$WORK_DIR/venv/bin/activate"
fi

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

show_help() {
    echo "露笑科技 (002617) AI 预测服务"
    echo ""
    echo "用法: ./prediction_service.sh <命令>"
    echo ""
    echo "命令:"
    echo "  predict     立即执行一次预测"
    echo "  train       立即重新训练模型"
    echo "  status      查看今日预测和历史"
    echo "  log         查看最近预测日志"
    echo "  update      手动更新数据"
    echo "  cron-on     开启定时任务"
    echo "  cron-off    关闭定时任务"
    echo "  cron-show   查看定时任务"
    echo "  help        显示帮助"
}

cmd_predict() {
    echo -e "${BLUE}▶ 执行预测...${NC}"
    cd "$WORK_DIR"
    python3 daily_predict.py --symbol 002617 --name 露笑科技
}

cmd_train() {
    echo -e "${BLUE}▶ 重新训练模型...${NC}"
    cd "$WORK_DIR"
    python3 daily_predict.py --symbol 002617 --name 露笑科技 --train
}

cmd_status() {
    echo -e "${BLUE}▶ 预测服务状态${NC}"
    echo ""
    
    # 数据状态
    echo "【数据状态】"
    python3 -c "
import pandas as pd, os
for f, name in [
    ('data/002617_daily.csv', '个股'),
    ('data/sh_index_000001.csv', '上证'),
    ('data/sz_index_399001.csv', '深证'),
    ('data/cy_index_399006.csv', '创业板'),
]:
    if os.path.exists(f):
        df = pd.read_csv(f, encoding='utf-8-sig')
        last = df['日期'].iloc[-1] if '日期' in df.columns else df['date'].iloc[-1]
        print(f'  {name}: {len(df)} 条 | 最新: {last}')
    else:
        print(f'  {name}: 文件缺失')
"
    echo ""
    
    # 今日预测
    echo "【今日预测】"
    if [ -f "$WORK_DIR/data/prediction_002617.csv" ]; then
        python3 -c "
import pandas as pd
df = pd.read_csv('data/prediction_002617.csv', encoding='utf-8-sig')
if len(df) > 0:
    last = df.iloc[-1]
    emoji = '📈' if last['预测'] == '涨' else '📉'
    print(f'  {last[\"日期\"]} {emoji} {last[\"预测\"]} (涨{last[\"上涨概率\"]}% 置信度{last[\"置信度\"]}%)')
else:
    print('  暂无预测记录')
"
    else
        echo "  暂无预测记录"
    fi
    echo ""
    
    # 模型状态
    echo "【模型状态】"
    if ls "$WORK_DIR"/models/models_*.joblib 1>/dev/null 2>&1; then
        latest=$(ls -t "$WORK_DIR"/models/models_*.joblib | head -1)
        echo "  最新模型: $(basename "$latest")"
    else
        echo "  暂无模型"
    fi
    
    # 定时任务状态
    echo ""
    echo "【定时任务】"
    if crontab -l 2>/dev/null | grep -q "露笑科技"; then
        echo -e "  ${GREEN}✓ 已启用${NC}"
        echo "  $(crontab -l | grep "daily_predict" | awk '{print $2":"$1, $5}')"  
    else
        echo -e "  ${RED}✗ 未启用${NC}"
    fi
}

cmd_log() {
    echo -e "${BLUE}▶ 最近预测日志${NC}"
    if [ -f "$LOG_DIR/daily_002617.log" ]; then
        echo ""
        tail -30 "$LOG_DIR/daily_002617.log"
    else
        echo "暂无日志"
    fi
}

cmd_update() {
    echo -e "${BLUE}▶ 更新数据...${NC}"
    cd "$WORK_DIR"
    python3 update_daily_data.py
}

cmd_cron_on() {
    echo -e "${BLUE}▶ 开启定时任务...${NC}"
    
    crontab -l 2>/dev/null | grep -v "露笑科技" | grep -v "stock-predictor" > /tmp/clean_crontab
    
    cat >> /tmp/clean_crontab << EOF

# ==================== 露笑科技 AI 预测模型 ====================
# 周一到周五，早上 7:00 自动更新数据+预测
0 7 * * 1-5 cd $WORK_DIR && source venv/bin/activate && python3 daily_predict.py --symbol 002617 --name 露笑科技 >> $LOG_DIR/daily_002617.log 2>&1

# 周一到周五，盘后 16:00 运行模型进化检查
0 16 * * 1-5 $WORK_DIR/run_evolution.sh >> $LOG_DIR/evolution.log 2>&1

# 每周一早 8:00 周度回测报告
0 8 * * 1 $WORK_DIR/run_weekly_report.sh >> $LOG_DIR/weekly_report.log 2>&1
EOF
    
    crontab /tmp/clean_crontab
    echo -e "${GREEN}✓ 定时任务已启用${NC}"
    echo "  07:00 每日预测 (周一到周五)"
    echo "  16:00 模型进化检查 (周一到周五)"
    echo "  08:00 周度回测报告 (每周一)"
}

cmd_cron_off() {
    echo -e "${BLUE}▶ 关闭定时任务...${NC}"
    crontab -l 2>/dev/null | grep -v "露笑科技" | grep -v "stock-predictor" | crontab -
    echo -e "${GREEN}✓ 定时任务已关闭${NC}"
}

cmd_cron_show() {
    echo -e "${BLUE}▶ 当前定时任务${NC}"
    echo ""
    if crontab -l 2>/dev/null | grep -q "露笑科技"; then
        crontab -l | grep -B1 -A1 "露笑科技"
    else
        echo "暂无与预测相关的定时任务"
    fi
}

# 主入口
case "${1:-status}" in
    predict|p)
        cmd_predict
        ;;
    train|t)
        cmd_train
        ;;
    status|s)
        cmd_status
        ;;
    log|l)
        cmd_log
        ;;
    update|u)
        cmd_update
        ;;
    cron-on)
        cmd_cron_on
        ;;
    cron-off)
        cmd_cron_off
        ;;
    cron-show)
        cmd_cron_show
        ;;
    help|h)
        show_help
        ;;
    *)
        echo "未知命令: $1"
        show_help
        exit 1
        ;;
esac
