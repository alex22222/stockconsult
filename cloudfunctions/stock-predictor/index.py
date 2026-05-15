# -*- coding: utf-8 -*-
"""CloudBase SCF 入口 - 股票涨跌预测"""

import json
import sys
import os
import logging
import traceback

# 配置日志到 stdout（SCF 环境）
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# 确保当前目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}


def main(event, context):
    """SCF 主入口"""
    # 处理预检请求
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 204, 'headers': CORS_HEADERS, 'body': ''}

    # 健康检查
    path = event.get('path', '')
    if path in ('/health', '/stock-predictor/health'):
        return {
            'statusCode': 200,
            'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
            'body': json.dumps({'healthy': True}),
        }

    # 解析参数
    query = event.get('queryString') or event.get('queryStringParameters') or {}
    body = event.get('body', '{}')
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except:
            body = {}

    symbol = query.get('symbol') or query.get('code') or body.get('symbol') or body.get('code')
    stock_name = query.get('name') or body.get('name', '')

    if not symbol:
        return {
            'statusCode': 400,
            'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
            'body': json.dumps({'success': False, 'error': 'Missing symbol parameter'}),
        }

    try:
        result = _predict(symbol, stock_name)
        return {
            'statusCode': 200,
            'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
            'body': json.dumps(result, ensure_ascii=False, default=str),
        }
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
            'body': json.dumps({'success': False, 'error': str(e)}),
        }


def _predict(symbol, stock_name):
    """执行预测"""
    from main import StockPredictionEngine

    engine = StockPredictionEngine(symbol=symbol, stock_name=stock_name)

    # 1. 获取数据
    engine.fetch_data(days=180)

    # 2. 构建特征
    engine.build_features()

    if engine.features.empty:
        return {'success': False, 'error': '特征构建失败，数据不足'}

    # 3. 训练模型
    engine.train_models(use_rolling=False)

    # 4. 预测
    prediction = engine.predict()

    if 'error' in prediction:
        return {'success': False, 'error': prediction['error']}

    # 5. 组装返回
    individual = prediction.get('individual_predictions', {})
    probs = prediction.get('individual_probabilities', {})
    weights = prediction.get('model_weights', {})

    model_votes = []
    for model_name in ['gradient_boosting', 'random_forest', 'extra_trees', 'logistic_regression']:
        if model_name in individual:
            prob = probs.get(model_name, {})
            model_votes.append({
                'model': model_name,
                'vote': '涨' if individual[model_name] == 1 else '跌',
                'upProbability': round(prob.get('up_prob', 0) * 100, 2),
                'weight': round(weights.get(model_name, 0), 2),
            })

    return {
        'success': True,
        'symbol': symbol,
        'stockName': engine.stock_name,
        'prediction': '涨' if prediction.get('prediction') == 1 else '跌',
        'upProbability': round(prediction.get('up_probability', 0) * 100, 2),
        'downProbability': round(prediction.get('down_probability', 0) * 100, 2),
        'confidence': round(prediction.get('confidence', 0) * 100, 2),
        'modelVotes': model_votes,
    }
