# -*- coding: utf-8 -*-
"""
每日预测工作流
==============

用法:
    python daily_predict.py --symbol 002617 --name 露笑科技
    python daily_predict.py --symbol 002617 --name 露笑科技 --train

流程:
    1. 检查/更新本地数据（baostock）
    2. 加载模型（如无则训练）
    3. 基于最新数据预测明日涨跌
    4. 输出预测结果

建议定时运行（crontab）:
    15 15 * * 1-5 cd /path/to/stock-predictor && source venv/bin/activate && python daily_predict.py --symbol 002617 >> logs/daily.log 2>&1
    # A股收盘后15:15执行，周一到周五
"""

import sys
import os
import argparse
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import StockPredictionEngine
from update_daily_data import update_all, is_update_failed

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)


def daily_predict(symbol: str, stock_name: str, auto_train: bool = False, days: int = 500):
    """
    每日预测主流程
    
    Args:
        symbol: 股票代码
        stock_name: 股票名称
        auto_train: 是否自动训练（首次或模型过期时）
        days: 历史数据天数
    """
    print(f"\n{'='*60}")
    print(f"  每日预测工作流: {stock_name} ({symbol})")
    print(f"  运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    # Step 1: 更新数据
    print("【Step 1】更新本地数据...")
    data_updated = update_all()
    
    if not data_updated:
        print(f"\n{'='*60}")
        print(f"  ⚠ 今日数据更新失败，无法预测")
        print(f"{'='*60}\n")
        logger.error("数据更新失败，终止预测")
        return None
    
    print()
    
    # Step 2: 初始化引擎
    print("【Step 2】加载预测引擎...")
    engine = StockPredictionEngine(symbol=symbol, stock_name=stock_name)
    
    # Step 3: 获取最新数据
    print(f"【Step 3】获取最近 {days} 天数据...")
    engine.fetch_data(days=days)
    stock_df = engine.raw_data.get("stock_daily", [])
    if len(stock_df) == 0:
        print("❌ 数据获取失败，无法预测")
        return None
    print(f"  个股数据: {len(stock_df)} 条")
    print(f"  最新日期: {stock_df['日期'].iloc[-1] if '日期' in stock_df.columns else 'unknown'}")
    
    # Step 4: 构建特征
    print("\n【Step 4】构建特征...")
    X, y = engine.build_features()
    print(f"  特征矩阵: {X.shape}")
    if X.empty:
        print("❌ 特征构建失败")
        return None
    
    # Step 5: 训练（如果需要）
    if auto_train or not engine.trainer.models:
        print("\n【Step 5】训练模型...")
        engine.train_models(use_rolling=False)
        print("  训练完成")
    else:
        print("\n【Step 5】使用已有模型预测...")
    
    # Step 6: 预测
    print("\n【Step 6】预测明日涨跌...")
    pred = engine.predict()
    
    if "error" in pred:
        print(f"❌ 预测失败: {pred['error']}")
        return None
    
    # Step 7: 输出结果
    print(f"\n{'='*60}")
    print(f"  📊 预测结果")
    print(f"{'='*60}")
    print(f"  股票: {stock_name} ({symbol})")
    print(f"  预测: {'📈 上涨' if pred['prediction'] == 1 else '📉 下跌'}")
    print(f"  上涨概率: {pred['up_probability']*100:.2f}%")
    print(f"  下跌概率: {pred['down_probability']*100:.2f}%")
    print(f"  置信度: {pred['confidence']*100:.2f}%")
    print(f"  预测日期: {datetime.now().strftime('%Y-%m-%d')}")
    print(f"  目标日期: 下一交易日")
    print(f"{'='*60}")
    
    # Step 8: 模型投票明细
    print(f"\n【模型投票明细】")
    individual = pred.get("individual_predictions", {})
    probs = pred.get("individual_probabilities", {})
    weights = pred.get("model_weights", {})
    for model_name in individual:
        vote = "涨" if individual[model_name] == 1 else "跌"
        prob = probs.get(model_name, {})
        up = prob.get("up_prob", 0) * 100
        w = weights.get(model_name, 0)
        print(f"  {model_name:25s}: {vote} (涨{up:.1f}%) [权重{w:.2f}]")
    
    # Step 9: 保存预测记录（用于次日验证）
    record_path = os.path.join(os.path.dirname(__file__), "data", f"prediction_{symbol}.csv")
    import pandas as pd
    record = pd.DataFrame([{
        "日期": datetime.now().strftime('%Y-%m-%d'),
        "股票代码": symbol,
        "预测": "涨" if pred['prediction'] == 1 else "跌",
        "上涨概率": round(pred['up_probability'] * 100, 2),
        "置信度": round(pred['confidence'] * 100, 2),
    }])
    if os.path.exists(record_path):
        existing = pd.read_csv(record_path, encoding='utf-8-sig')
        combined = pd.concat([existing, record], ignore_index=True)
    else:
        combined = record
    combined.to_csv(record_path, index=False, encoding='utf-8-sig')
    print(f"\n  预测记录已保存: {record_path}")
    
    return pred


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="每日预测工作流")
    parser.add_argument("--symbol", type=str, default="002617", help="股票代码")
    parser.add_argument("--name", type=str, default="露笑科技", help="股票名称")
    parser.add_argument("--train", action="store_true", help="强制重新训练")
    parser.add_argument("--days", type=int, default=500, help="历史数据天数")
    
    args = parser.parse_args()
    
    result = daily_predict(
        symbol=args.symbol,
        stock_name=args.name,
        auto_train=args.train,
        days=args.days,
    )
    
    sys.exit(0 if result else 1)
