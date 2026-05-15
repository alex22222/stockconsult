#!/bin/bash
# ============================================================
# 训练节点一键初始化脚本
# Usage:
#   chmod +x setup_training_node.sh
#   ./setup_training_node.sh
# ============================================================

set -e

echo "=========================================="
echo "  露笑科技预测模型 - 训练节点初始化"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查 Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}错误: 未找到 python3，请先安装 Python 3.10+${NC}"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python 版本: $PYTHON_VERSION${NC}"

# 2. 克隆仓库（如果不存在）
REPO_DIR="stockconsult"
if [ ! -d "$REPO_DIR" ]; then
    echo -e "${YELLOW}→ 正在克隆代码仓库...${NC}"
    git clone https://github.com/alex22222/stockconsult.git
else
    echo -e "${GREEN}✓ 仓库已存在${NC}"
fi

cd "$REPO_DIR/cloudfunctions/stock-predictor"
WORK_DIR=$(pwd)
echo -e "${GREEN}✓ 工作目录: $WORK_DIR${NC}"

# 3. 创建虚拟环境
VENV_DIR="venv"
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}→ 创建虚拟环境...${NC}"
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
echo -e "${GREEN}✓ 虚拟环境已激活${NC}"

# 4. 安装依赖
echo -e "${YELLOW}→ 安装 Python 依赖（可能需要几分钟）...${NC}"
pip install --upgrade pip -q
pip install pandas numpy scikit-learn joblib baostock -q

# akshare 可选（网络不好可能装不上或连不上）
echo -e "${YELLOW}→ 尝试安装 akshare（可选，失败不影响训练）...${NC}"
pip install akshare -q || echo -e "${YELLOW}⚠ akshare 安装失败，将使用 baostock + 本地数据模式${NC}"

echo -e "${GREEN}✓ 依赖安装完成${NC}"

# 5. 下载真实数据
echo -e "${YELLOW}→ 下载露笑科技真实历史数据...${NC}"
python3 -c "
import baostock as bs
import pandas as pd
import os

os.makedirs('data', exist_ok=True)

lg = bs.login()
if lg.error_code != '0':
    print('baostock 登录失败')
    exit(1)

print('baostock 登录成功')

# 个股 + 三大指数
configs = [
    ('sz.002617', '002617_daily', 'date,code,open,high,low,close,volume,amount,turn,pctChg'),
    ('sh.000001', 'sh_index_000001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399001', 'sz_index_399001', 'date,open,high,low,close,volume,amount,pctChg'),
    ('sz.399006', 'cy_index_399006', 'date,open,high,low,close,volume,amount,pctChg'),
]

for code, fname, fields in configs:
    print(f'正在下载 {fname}...', end=' ', flush=True)
    rs = bs.query_history_k_data_plus(
        code, fields,
        start_date='2023-01-01', end_date='2026-12-31',
        frequency='d', adjustflag='3'
    )
    data = []
    while (rs.error_code == '0') & rs.next():
        data.append(rs.get_row_data())
    df = pd.DataFrame(data, columns=rs.fields)
    df.to_csv(f'data/{fname}.csv', index=False, encoding='utf-8-sig')
    print(f'{len(df)} 条')

bs.logout()
print('数据下载完成')
"

# 6. 验证环境
echo -e "${YELLOW}→ 验证训练环境...${NC}"
python3 -c "
import sys
sys.path.insert(0, '.')

# 检查依赖
for pkg in ['pandas', 'numpy', 'sklearn', 'joblib', 'baostock']:
    __import__(pkg)
print('依赖检查通过')

# 检查数据
import os
data_files = ['002617_daily.csv', 'sh_index_000001.csv', 'sz_index_399001.csv', 'cy_index_399006.csv']
for f in data_files:
    path = f'data/{f}'
    if not os.path.exists(path):
        print(f'缺失数据文件: {f}')
        sys.exit(1)
print('数据文件检查通过')

# 试运行训练
from main import StockPredictionEngine
engine = StockPredictionEngine('002617', '露笑科技')
engine.fetch_data(days=500)
X, y = engine.build_features()
print(f'特征构建: {X.shape}')
engine.train_models(use_rolling=False)
print('训练通过')
pred = engine.predict()
print(f'预测结果: {pred[\"prediction_label\"]} (置信度: {pred[\"confidence\"]*100:.1f}%)')
"

echo ""
echo "=========================================="
echo -e "${GREEN}  初始化完成！${NC}"
echo "=========================================="
echo ""
echo "数据目录:    $WORK_DIR/data"
echo "模型目录:    $WORK_DIR/models"
echo "虚拟环境:    source $WORK_DIR/venv/bin/activate"
echo ""
echo "开始训练:"
echo "  python3 luxiao_training_plan.py --phases 1,2,3,4,5,6"
echo ""
echo "快速预测:"
echo "  python3 main.py --symbol 002617 --name 露笑科技"
echo ""
echo "每日定时训练（crontab）:"
echo "  0 21 * * * cd $WORK_DIR && source venv/bin/activate && python3 main.py --symbol 002617 >> logs/daily.log 2>&1"
echo ""
