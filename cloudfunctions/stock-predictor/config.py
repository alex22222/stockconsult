# -*- coding: utf-8 -*-
"""股票涨跌预测引擎 - 精简配置 (SCF 云函数版)"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")

for d in [DATA_DIR, MODEL_DIR]:
    os.makedirs(d, exist_ok=True)

DATA_CONFIG = {
    "history_years": 2,
    "min_history_days": 100,
    "daily_refresh": True,
    "cache_valid_hours": 6,
    "primary_source": "akshare",
    "tushare_token": "",
}

DEMO_STOCK = {
    "code": "600519",
    "name": "贵州茅台",
    "market": "sh",
}

FACTOR_CATEGORIES = {
    "market_environment": {"weight": 0.15, "factors": ["index_trend", "market_volatility", "breadth_indicator"]},
    "market_energy": {"weight": 0.15, "factors": ["volume_energy", "price_momentum", "turnover_ratio"]},
    "market_sentiment": {"weight": 0.15, "factors": ["fear_greed_index", "sentiment_momentum"]},
    "technical_indicators": {"weight": 0.25, "factors": ["macd", "kdj", "rsi", "boll", "ma_cross", "volume_ma", "obv"]},
    "sector_heat": {"weight": 0.15, "factors": ["sector_rank", "sector_fund_flow", "sector_momentum"]},
    "fund_anomaly": {"weight": 0.15, "factors": ["main_fund_flow", "retail_fund_flow", "large_order_ratio", "fund_divergence"]},
}

FEATURE_CONFIG = {
    "macd": {"fast": 12, "slow": 26, "signal": 9},
    "kdj": {"n": 9, "m1": 3, "m2": 3},
    "rsi": {"period": 14},
    "boll": {"period": 20, "std_dev": 2},
    "ma": {"short": 5, "medium": 10, "long": 20, "super_long": 60},
    "volume": {"short_ma": 5, "medium_ma": 20, "long_ma": 60},
    "momentum": {"short_period": 5, "medium_period": 10, "long_period": 20},
    "volatility": {"atr_period": 14, "bb_width_period": 20},
    "fund_flow": {"ma_period": 5, "divergence_lookback": 10},
}

MODEL_CONFIG = {
    "train_window": 60,
    "test_window": 20,
    "min_train_samples": 80,
    "prediction_horizon": 1,
    "target_threshold": 0.0,
    "models": {
        "gradient_boosting": {
            "enabled": True,
            "params": {
                "n_estimators": 100,
                "max_depth": 4,
                "learning_rate": 0.08,
                "random_state": 42,
            }
        },
        "random_forest": {
            "enabled": True,
            "params": {
                "n_estimators": 100,
                "max_depth": 10,
                "min_samples_split": 5,
                "min_samples_leaf": 2,
                "random_state": 42,
                "n_jobs": -1,
            }
        },
        "extra_trees": {
            "enabled": True,
            "params": {
                "n_estimators": 100,
                "max_depth": 10,
                "min_samples_split": 5,
                "min_samples_leaf": 2,
                "random_state": 42,
                "n_jobs": -1,
            }
        },
        "logistic_regression": {
            "enabled": True,
            "params": {
                "max_iter": 1000,
                "random_state": 42,
            }
        },
    },
    "ensemble_strategy": "weighted",
    "model_weights": {
        "gradient_boosting": 0.30,
        "random_forest": 0.30,
        "extra_trees": 0.25,
        "logistic_regression": 0.15,
    },
    "cv_folds": 3,
    "cv_strategy": "TimeSeriesSplit",
}

LOG_CONFIG = {
    "level": "WARNING",
    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    "file": os.path.join(BASE_DIR, "engine.log"),
    "console": False,
}

CLASS_LABELS = {0: "下跌", 1: "上涨"}

INDEX_CODES = {
    "上证指数": "000001.SH",
    "深证成指": "399001.SZ",
    "创业板指": "399006.SZ",
    "沪深300": "000300.SH",
}

EVOLUTION_CONFIG = {
    "min_samples_for_evolution": 20,
    "accuracy_threshold": 0.52,
    "min_evolution_interval_days": 5,
    "factor_learning_rate": 0.15,
    "model_temperature": 3.0,
    "exploration_noise": 0.03,
    "feature_select_topk": 60,
    "min_features_per_category": 4,
    "accuracy_window": 20,
    "max_history": 500,
}
