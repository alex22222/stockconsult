# -*- coding: utf-8 -*-
"""
模型评估对比 — 时间序列交叉验证（无数据泄露）
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, roc_auc_score, f1_score
from sklearn.preprocessing import StandardScaler

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def ts_cv_eval(symbol: str, n_splits: int = 5) -> dict:
    """时间序列交叉验证评估"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw, symbol)

    if X.empty or y.empty:
        return {}

    tscv = TimeSeriesSplit(n_splits=n_splits)
    results = {}
    model_names = ["gradient_boosting", "random_forest", "extra_trees",
                   "logistic_regression", "ada_boost", "svm_rbf", "mlp"]

    for model_name in model_names:
        accs, aucs, f1s = [], [], []
        for train_idx, test_idx in tscv.split(X):
            X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
            y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

            # 创建独立的 trainer
            trainer = ModelTrainer()
            # 禁用其他模型
            for name in list(trainer.config["models"].keys()):
                if name != model_name:
                    trainer.config["models"][name]["enabled"] = False

            result = trainer.train_single_model(model_name, X_train, y_train, validation_split=0.15)
            if result["status"] == "success":
                # 在测试集上预测
                X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
                scaler = StandardScaler()
                scaler.fit(X_train.replace([np.inf, -np.inf], 0).fillna(0))
                X_test_scaled = scaler.transform(X_test_clean)

                model = trainer.models[model_name]
                y_pred = model.predict(X_test_scaled)
                y_prob = model.predict_proba(X_test_scaled)[:, 1]

                accs.append(accuracy_score(y_test, y_pred))
                if len(np.unique(y_test)) > 1:
                    aucs.append(roc_auc_score(y_test, y_prob))
                f1s.append(f1_score(y_test, y_pred, zero_division=0))

        if accs:
            results[model_name] = {
                "accuracy_mean": np.mean(accs),
                "accuracy_std": np.std(accs),
                "auc_mean": np.mean(aucs) if aucs else 0,
                "f1_mean": np.mean(f1s),
            }

    # 集成模型评估
    ensemble_accs, ensemble_aucs = [], []
    for train_idx, test_idx in tscv.split(X):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        trainer = ModelTrainer()
        trainer.train_ensemble(X_train, y_train, validation_split=0.15)

        X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
        scaler = StandardScaler()
        scaler.fit(X_train.replace([np.inf, -np.inf], 0).fillna(0))
        X_test_scaled = scaler.transform(X_test_clean)

        # 加权投票
        probs = []
        weights = []
        for name, model in trainer.models.items():
            w = trainer.model_weights.get(name, 0.25)
            p = model.predict_proba(X_test_scaled)[:, 1]
            probs.append(p)
            weights.append(w)

        if probs:
            total_w = sum(weights)
            avg_prob = sum(p * w for p, w in zip(probs, weights)) / total_w
            y_pred = (avg_prob > 0.5).astype(int)

            ensemble_accs.append(accuracy_score(y_test, y_pred))
            if len(np.unique(y_test)) > 1:
                ensemble_aucs.append(roc_auc_score(y_test, avg_prob))

    if ensemble_accs:
        results["ensemble"] = {
            "accuracy_mean": np.mean(ensemble_accs),
            "accuracy_std": np.std(ensemble_accs),
            "auc_mean": np.mean(ensemble_aucs) if ensemble_aucs else 0,
        }

    return results


def main():
    symbols = {
        '002617': '露笑科技',
        '601318': '中国平安',
        '300622': '博士眼镜',
        '002896': '中大力德',
    }

    for sym, name in symbols.items():
        print(f"\n{'='*60}")
        print(f"【{name} {sym}】时间序列交叉验证 (5折)")
        print(f"{'='*60}")
        results = ts_cv_eval(sym, n_splits=5)
        if not results:
            print("  评估失败")
            continue

        print(f"{'模型':<20} {'准确率':>10} {'AUC':>10} {'F1':>10}")
        print("-" * 52)
        for model_name, metrics in results.items():
            if model_name == "ensemble":
                continue
            acc = metrics["accuracy_mean"]
            auc = metrics["auc_mean"]
            f1 = metrics["f1_mean"]
            print(f"{model_name:<20} {acc:>10.2%} {auc:>10.3f} {f1:>10.3f}")

        if "ensemble" in results:
            ens = results["ensemble"]
            print("-" * 52)
            print(f"{'集成(7模型加权)':<20} {ens['accuracy_mean']:>10.2%} {ens['auc_mean']:>10.3f}")


if __name__ == "__main__":
    main()
