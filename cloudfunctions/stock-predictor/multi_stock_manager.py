# -*- coding: utf-8 -*-
"""
多股票统一管理器
================

支持股票:
- 002617 露笑科技 (已有)
- 601318 中国平安
- 300622 博士眼镜
- 002896 中大力德

用法:
    # 批量下载数据
    python multi_stock_manager.py --action download

    # 批量训练模型
    python multi_stock_manager.py --action train

    # 批量预测
    python multi_stock_manager.py --action predict

    # 一键全部
    python multi_stock_manager.py --action all
"""

import sys
import os
import argparse
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import StockPredictionEngine, train_and_save
from update_daily_data import update_all
from daily_predict import daily_predict

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# 多股票配置
STOCKS = [
    {"symbol": "002617", "name": "露笑科技", "market": "sz"},
    {"symbol": "601318", "name": "中国平安", "market": "sh"},
    {"symbol": "300622", "name": "博士眼镜", "market": "sz"},
    {"symbol": "002896", "name": "中大力德", "market": "sz"},
]


def download_all():
    """更新所有股票数据（调用 update_daily_data）"""
    print(f"\n{'='*60}")
    print(f"  批量更新数据")
    print(f"{'='*60}\n")
    update_all()
    print("\n  数据更新完成")


def train_all(days: int = 500):
    """批量训练所有股票模型（模型按股票代码隔离）"""
    print(f"\n{'='*60}")
    print(f"  批量训练模型")
    print(f"{'='*60}\n")
    
    results = []
    for stock in STOCKS:
        symbol = stock["symbol"]
        name = stock["name"]
        print(f"\n【{name} ({symbol})】")
        try:
            train_and_save(symbol=symbol, stock_name=name, days=days)
            results.append({"symbol": symbol, "name": name, "status": "success"})
        except Exception as e:
            print(f"  ❌ 训练失败: {e}")
            results.append({"symbol": symbol, "name": name, "status": "failed", "error": str(e)})
    
    print(f"\n{'='*60}")
    print(f"  训练结果汇总")
    print(f"{'='*60}")
    for r in results:
        status_icon = "✅" if r["status"] == "success" else "❌"
        print(f"  {status_icon} {r['name']} ({r['symbol']})")
        if r.get("error"):
            print(f"     错误: {r['error']}")
    return results


def predict_all(days: int = 500, auto_train: bool = False):
    """批量预测所有股票"""
    print(f"\n{'='*60}")
    print(f"  批量预测")
    print(f"{'='*60}\n")
    
    results = []
    for stock in STOCKS:
        symbol = stock["symbol"]
        name = stock["name"]
        try:
            pred = daily_predict(
                symbol=symbol,
                stock_name=name,
                auto_train=auto_train,
                days=days,
            )
            results.append({
                "symbol": symbol,
                "name": name,
                "status": "success",
                "prediction": "涨" if pred and pred.get("prediction") == 1 else "跌" if pred else "N/A",
                "up_probability": pred.get("up_probability", 0) * 100 if pred else 0,
            })
        except Exception as e:
            print(f"  ❌ 预测失败: {e}")
            results.append({"symbol": symbol, "name": name, "status": "failed", "error": str(e)})
    
    print(f"\n{'='*60}")
    print(f"  预测结果汇总")
    print(f"{'='*60}")
    for r in results:
        if r["status"] == "success":
            pred_icon = "📈" if r["prediction"] == "涨" else "📉"
            print(f"  {pred_icon} {r['name']} ({r['symbol']}): {r['prediction']} (涨{r['up_probability']:.1f}%)")
        else:
            print(f"  ❌ {r['name']} ({r['symbol']}): 失败 - {r.get('error', '')}")
    return results


def run_all(days: int = 500):
    """一键执行：更新数据 → 训练 → 预测"""
    download_all()
    train_all(days=days)
    predict_all(days=days, auto_train=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="多股票统一管理器")
    parser.add_argument("--action", type=str, default="all",
                        choices=["download", "train", "predict", "all"],
                        help="操作类型: download/train/predict/all")
    parser.add_argument("--days", type=int, default=500, help="历史数据天数")
    parser.add_argument("--train", action="store_true", help="预测时若模型不存在则自动训练")
    
    args = parser.parse_args()
    
    if args.action == "download":
        download_all()
    elif args.action == "train":
        train_all(days=args.days)
    elif args.action == "predict":
        predict_all(days=args.days, auto_train=args.train)
    else:
        run_all(days=args.days)
