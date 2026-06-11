# -*- coding: utf-8 -*-
"""
特征维度对比 — 97维 vs 151维（时间序列交叉验证）
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from local_data_provider import LocalDataProvider
from feature_engineer import FeatureEngineer
from model_trainer import ModelTrainer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def eval_with_features(symbol: str, feature_mask: list = None, n_splits: int = 5):
    """使用指定特征子集评估"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    engineer = FeatureEngineer()
    X, y = engineer.build_features(raw, symbol)
    
    if feature_mask:
        X = X[feature_mask]
    
    tscv = TimeSeriesSplit(n_splits=n_splits)
    model_names = ["gradient_boosting", "random_forest", "extra_trees",
                   "logistic_regression", "ada_boost", "svm_rbf", "mlp"]
    results = {}
    
    for mn in model_names:
        accs, aucs = [], []
        for train_idx, test_idx in tscv.split(X):
            X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
            y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
            
            trainer = ModelTrainer()
            for n in list(trainer.config['models'].keys()):
                trainer.config['models'][n]['enabled'] = (n == mn)
            
            result = trainer.train_single_model(mn, X_train, y_train, validation_split=0.2)
            if result['status'] == 'success':
                X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
                scaler = StandardScaler()
                scaler.fit(X_train.replace([np.inf, -np.inf], 0).fillna(0))
                X_test_scaled = scaler.transform(X_test_clean)
                model = trainer.models[mn]
                y_pred = model.predict(X_test_scaled)
                y_prob = model.predict_proba(X_test_scaled)[:, 1]
                accs.append(accuracy_score(y_test, y_pred))
                if len(np.unique(y_test)) > 1:
                    aucs.append(roc_auc_score(y_test, y_prob))
        
        results[mn] = {
            'accuracy': np.mean(accs) if accs else 0,
            'auc': np.mean(aucs) if aucs else 0,
        }
    
    # 集成
    ens_accs, ens_aucs = [], []
    for train_idx, test_idx in tscv.split(X):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
        trainer = ModelTrainer()
        trainer.train_ensemble(X_train, y_train, validation_split=0.2)
        X_test_clean = X_test.replace([np.inf, -np.inf], 0).fillna(0)
        scaler = StandardScaler()
        scaler.fit(X_train.replace([np.inf, -np.inf], 0).fillna(0))
        X_test_scaled = scaler.transform(X_test_clean)
        probs, weights = [], []
        for mname, model in trainer.models.items():
            w = trainer.model_weights.get(mname, 0.25)
            p = model.predict_proba(X_test_scaled)[:, 1]
            probs.append(p)
            weights.append(w)
        if probs:
            avg_prob = sum(p * w for p, w in zip(probs, weights)) / sum(weights)
            y_pred = (avg_prob > 0.5).astype(int)
            ens_accs.append(accuracy_score(y_test, y_pred))
            if len(np.unique(y_test)) > 1:
                ens_aucs.append(roc_auc_score(y_test, avg_prob))
    
    results['ensemble'] = {
        'accuracy': np.mean(ens_accs) if ens_accs else 0,
        'auc': np.mean(ens_aucs) if ens_aucs else 0,
    }
    
    return results


def main():
    symbols = {
        '002617': '露笑科技',
        '601318': '中国平安',
        '300622': '博士眼镜',
        '002896': '中大力德',
    }
    
    # 获取旧特征列表（不含新特征的子集）
    old_feature_keywords = [
        'index_trend', 'market_volatility', 'index_corr', 'index_return', 'index_new',
        'volume_ratio', 'volume_trend', 'momentum_', 'turnover', 'volume_price_corr', 'amount_ratio',
        'fear_greed', 'sentiment_momentum', 'consecutive_', 'amplitude', 'main_fund_ratio',
        'macd', 'kdj', 'rsi', 'bb_', 'ma_', 'obv', 'atr', 'body_ratio', 'upper_shadow', 'lower_shadow',
        'relative_strength', 'sector_avg', 'sector_rank', 'turnover_percentile',
        'volume_spike', 'volume_shrink', 'price_volume_', 'main_fund_flow', 'super_large', 'large_fund',
        'retail_fund', 'fund_price_divergence', 'large_order', 'fund_concentration',
        'nasdaq', 'dow', 'sp500', 'china', 'us_overnight',
    ]
    
    for sym, name in symbols.items():
        print(f"\n{'='*70}")
        print(f"【{name} {sym}】97维 vs 151维 对比")
        print(f"{'='*70}")
        
        local = LocalDataProvider(DATA_DIR)
        raw = local.get_all_data_for_stock(sym, days=5000)
        engineer = FeatureEngineer()
        X, y = engineer.build_features(raw, sym)
        
        # 识别旧特征
        old_cols = [c for c in X.columns if any(kw in c for kw in old_feature_keywords)]
        new_cols = [c for c in X.columns if c not in old_cols]
        
        print(f"总特征: {X.shape[1]}, 旧特征: {len(old_cols)}, 新特征: {len(new_cols)}")
        
        # 评估旧特征
        print(f"\n{'模型':<18} {'旧特征准确率':>12} {'新特征准确率':>12} {'提升':>8}")
        print("-" * 52)
        
        old_results = eval_with_features(sym, old_cols)
        new_results = eval_with_features(sym, None)  # 全部特征
        
        for mn in list(old_results.keys()):
            old_acc = old_results[mn]['accuracy']
            new_acc = new_results[mn]['accuracy']
            delta = new_acc - old_acc
            print(f"{mn:<18} {old_acc:>11.2%} {new_acc:>11.2%} {delta:>+7.2%}")


if __name__ == "__main__":
    main()
