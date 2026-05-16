# -*- coding: utf-8 -*-
"""
本地快速训练脚本 — 跳过网络请求，直接从 CSV 加载
"""
import warnings
import os
import sys

warnings.filterwarnings('ignore')
os.environ['LOG_LEVEL'] = 'ERROR'

from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")


def train_stock(symbol: str) -> dict:
    """训练单股模型"""
    print(f"\n===== 训练 {symbol} =====")

    # 1. 加载本地数据
    local = LocalDataProvider(DATA_DIR)
    raw_data = local.get_all_data_for_stock(symbol, days=500)

    stock_df = raw_data.get("stock_daily")
    if stock_df is None or stock_df.empty:
        print(f"  ⚠ 个股数据为空")
        return {}

    print(f"  个股数据: {len(stock_df)} 条")
    print(f"  美股数据: {len(raw_data.get('us_overnight', pd.DataFrame()))} 条")

    # 2. 特征工程
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw_data, symbol)

    if X.empty or y.empty:
        print(f"  ⚠ 特征构建失败")
        return {}

    print(f"  特征矩阵: {X.shape}")

    # 3. 训练模型
    trainer = ModelTrainer()
    results = trainer.train_ensemble(X, y)

    # 4. 保存模型
    model_dir = os.path.join(MODEL_DIR, symbol)
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, f"models_local.joblib")
    trainer.save_models(model_path)
    print(f"  模型已保存: {model_path}")

    # 5. 打印各模型结果
    print(f"  各模型验证准确率:")
    for model_name, result in results.items():
        if result.get("status") == "success":
            acc = result["metrics"]["accuracy"]
            auc = result["metrics"]["auc"]
            print(f"    {model_name}: acc={acc:.2%}, auc={auc:.3f}")

    # 集成评估（全量数据交叉验证）
    eval_metrics = trainer.evaluate(X, y)
    print(f"  集成验证准确率: {eval_metrics.get('accuracy', 0):.2%}")
    print(f"  上涨准确率: {eval_metrics.get('up_accuracy', 0):.2%}")
    print(f"  下跌准确率: {eval_metrics.get('down_accuracy', 0):.2%}")

    # 6. 美股因子重要性
    fi = results.get("feature_importance", {})
    us_fi = {k: v for k, v in fi.items() if any(x in k for x in ['nasdaq', 'dow', 'sp500', 'china', 'us_overnight'])}
    if us_fi:
        print(f"  美股因子重要性:")
        for k, v in sorted(us_fi.items(), key=lambda x: -x[1]):
            print(f"    {k}: {v:.4f}")

    return results


def main():
    symbols = ['002617', '601318', '300622', '002896']
    for sym in symbols:
        try:
            train_stock(sym)
        except Exception as e:
            print(f"  ❌ 训练失败: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
