# -*- coding: utf-8 -*-
"""
CloudBase SCF 入口 - 股票涨跌预测（轻量版）
纯 Python 标准库实现，无 pandas/sklearn 依赖
通过 investoday MCP API 获取数据，本地计算技术指标
"""

import json
import sys
import os
import logging
import traceback
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

# 配置日志到 stdout（SCF 环境）
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Investoday API 配置
INVESTODAY_API_KEY = os.environ.get('INVESTODAY_API_KEY') or 'cae27125ca0746c4b6ede2d77cd2dd11'
INVESTODAY_BASE_URL = 'https://data-api.investoday.net/data/mcp/preset'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}


# ==================== MCP 数据获取 ====================

def mcp_call(tool_name, arguments, timeout=15):
    """调用 investoday MCP API"""
    url = f"{INVESTODAY_BASE_URL}?apiKey={INVESTODAY_API_KEY}"
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    }).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'stock-predictor/1.0'
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        logger.warning(f"MCP call failed: {e}")
        return None

    if data.get('error'):
        logger.warning(f"MCP error: {data['error']}")
        return None

    result = data.get('result', {})
    if result.get('isError'):
        logger.warning(f"MCP tool error: {result}")
        return None

    content = result.get('content', [{}])[0].get('text', '{}')
    try:
        return json.loads(content)
    except:
        return {"raw": content}


def fetch_history(stock_code, days=120):
    """获取历史 K 线数据"""
    end = datetime.now()
    begin = end - timedelta(days=days + 30)  # 多取一些确保有足够交易日

    result = mcp_call('list_stock_adjusted_quotes', {
        'stockCode': stock_code,
        'beginDate': begin.strftime('%Y-%m-%d'),
        'endDate': end.strftime('%Y-%m-%d'),
    })

    if not result or not result.get('data'):
        return []

    # 按日期排序
    klines = sorted(result['data'], key=lambda x: x.get('tradeDate', x.get('QUOTETIME', '')))
    return klines


def fetch_stock_info(stock_code):
    """获取股票基本信息"""
    result = mcp_call('get_stock_basic_info', {'stockCode': stock_code})
    if result and result.get('code') == 0 and result.get('data'):
        return result['data'][0]
    return None


def fetch_realtime_quote(stock_code):
    """获取实时行情"""
    result = mcp_call('get_stock_quote_realtime', {'stockCode': stock_code})
    if result and result.get('code') == 'Success' and result.get('data'):
        return result['data']
    return None


def fetch_stock_score(stock_code):
    """获取综合评分"""
    result = mcp_call('get_stock_score', {'stockCode': stock_code})
    if result and result.get('data'):
        return result['data']
    return None


# ==================== 技术指标计算（纯 Python）====================

def calc_ma(prices, period):
    """计算简单移动平均线"""
    if len(prices) < period:
        return []
    return [sum(prices[i - period + 1:i + 1]) / period for i in range(period - 1, len(prices))]


def calc_rsi(prices, period=14):
    """计算 RSI（相对强弱指标）"""
    if len(prices) < period + 1:
        return 50
    gains = []
    losses = []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i - 1]
        if diff > 0:
            gains.append(diff)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(-diff)

    if len(gains) < period:
        return 50

    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period

    if avg_loss == 0:
        return 100 if avg_gain > 0 else 50

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calc_macd(prices, fast=12, slow=26, signal=9):
    """计算 MACD（简化版）"""
    if len(prices) < slow + signal:
        return 0, 0, 0

    def ema(data, period):
        multiplier = 2 / (period + 1)
        ema_vals = [sum(data[:period]) / period]
        for price in data[period:]:
            ema_vals.append((price - ema_vals[-1]) * multiplier + ema_vals[-1])
        return ema_vals

    fast_ema = ema(prices, fast)
    slow_ema = ema(prices, slow)

    # 对齐长度
    min_len = min(len(fast_ema), len(slow_ema))
    macd_line = [fast_ema[-(min_len - i)] - slow_ema[-(min_len - i)] for i in range(min_len)]

    if len(macd_line) < signal:
        return 0, 0, 0

    signal_line = ema(macd_line, signal)
    histogram = macd_line[-1] - signal_line[-1]

    return macd_line[-1], signal_line[-1], histogram


def calc_bollinger(prices, period=20):
    """计算布林带"""
    if len(prices) < period:
        return None, None, None
    recent = prices[-period:]
    ma = sum(recent) / period
    variance = sum((p - ma) ** 2 for p in recent) / period
    std = variance ** 0.5
    return ma + 2 * std, ma, ma - 2 * std


def calc_volume_trend(volumes):
    """计算成交量趋势"""
    if len(volumes) < 10:
        return 0
    recent = sum(volumes[-5:]) / 5
    previous = sum(volumes[-10:-5]) / 5
    if previous == 0:
        return 0
    return (recent / previous - 1) * 100


# ==================== 预测引擎 ====================

def predict_stock(symbol, stock_name=''):
    """
    基于纯 Python 技术指标的涨跌预测
    返回与原版兼容的格式
    """
    # 1. 获取数据
    klines = fetch_history(symbol, days=120)
    if len(klines) < 30:
        return {'success': False, 'error': f'历史数据不足，仅获取到 {len(klines)} 条记录'}

    info = fetch_stock_info(symbol)
    if info:
        stock_name = info.get('stockName', info.get('STOCKNAME', stock_name))

    # 提取收盘价、成交量
    closes = [float(k['closePrice']) for k in klines if k.get('closePrice')]
    volumes = [float(k.get('volume', k.get('DEALSTOCKAMOUNT', 0))) for k in klines]

    if len(closes) < 30:
        return {'success': False, 'error': '有效收盘价数据不足'}

    # 2. 计算技术指标
    ma5 = calc_ma(closes, 5)
    ma10 = calc_ma(closes, 10)
    ma20 = calc_ma(closes, 20)
    rsi = calc_rsi(closes, 14)
    macd_val, signal_val, histogram = calc_macd(closes)
    bb_upper, bb_mid, bb_lower = calc_bollinger(closes)
    vol_trend = calc_volume_trend(volumes)

    latest_close = closes[-1]

    # 3. 各模型评分（模拟 4 个模型的独立判断）
    models = {}

    # 模型1: 趋势模型 (Trend) - 基于均线排列
    trend_score = 50
    if len(ma5) >= 1 and len(ma10) >= 1 and len(ma20) >= 1:
        if ma5[-1] > ma10[-1] > ma20[-1]:
            trend_score = 85  # 多头排列
        elif ma5[-1] > ma10[-1]:
            trend_score = 65  # 短期上穿
        elif ma5[-1] < ma10[-1] < ma20[-1]:
            trend_score = 15  # 空头排列
        elif ma5[-1] < ma10[-1]:
            trend_score = 35  # 短期下穿
        else:
            trend_score = 50
    models['gradient_boosting'] = {
        'score': trend_score,
        'weight': 0.35,
        'name': '趋势模型'
    }

    # 模型2: 动量模型 (Momentum) - 基于 RSI + 近期涨跌幅
    recent_change = ((closes[-1] - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 else 0
    today_change = ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) >= 2 else 0
    momentum_score = 50 + recent_change * 3 + today_change * 0.5
    momentum_score = max(0, min(100, momentum_score))
    # RSI 修正
    if rsi > 70:
        momentum_score = min(momentum_score, 80)  # 超买压制
    elif rsi < 30:
        momentum_score = max(momentum_score, 20)  # 超卖托底
    models['random_forest'] = {
        'score': momentum_score,
        'weight': 0.25,
        'name': '动量模型'
    }

    # 模型3: 量能模型 (Volume) - 基于成交量趋势 + 价格方向
    volume_score = 50
    if vol_trend > 20:
        volume_score = 75 if today_change > 0 else 25  # 涨放量 / 跌放量
    elif vol_trend > 0:
        volume_score = 65 if today_change > 0 else 35  # 涨温和放量 / 跌温和放量
    elif vol_trend < -20:
        volume_score = 55 if today_change > 0 else 45  # 涨缩量 / 跌缩量
    else:
        volume_score = 55 if today_change > 0 else 45
    models['extra_trees'] = {
        'score': volume_score,
        'weight': 0.20,
        'name': '量能模型'
    }

    # 模型4: 技术模型 (Technical) - 基于 MACD + 布林带 + RSI
    tech_score = 50
    # MACD 贡献
    if histogram > 0 and macd_val > 0:
        tech_score += 15  # MACD 金叉且向上
    elif histogram > 0:
        tech_score += 5   # MACD 向上
    elif histogram < 0 and macd_val < 0:
        tech_score -= 15  # MACD 死叉且向下
    elif histogram < 0:
        tech_score -= 5   # MACD 向下

    # 布林带贡献
    if bb_upper and bb_lower:
        bb_position = (latest_close - bb_lower) / (bb_upper - bb_lower) if (bb_upper - bb_lower) > 0 else 0.5
        if bb_position > 0.8:
            tech_score -= 10  # 接近上轨，短期承压
        elif bb_position < 0.2:
            tech_score += 10  # 接近下轨，短期反弹

    # RSI 贡献
    if rsi > 60:
        tech_score += 5
    elif rsi < 40:
        tech_score -= 5

    tech_score = max(0, min(100, tech_score))
    models['logistic_regression'] = {
        'score': tech_score,
        'weight': 0.20,
        'name': '技术模型'
    }

    # 4. 加权综合
    total_weight = sum(m['weight'] for m in models.values())
    composite_score = sum(m['score'] * m['weight'] for m in models.values()) / total_weight

    # 上涨概率
    up_probability = round(composite_score)
    up_probability = max(5, min(95, up_probability))  # 限制在 5%-95%
    down_probability = 100 - up_probability

    # 预测方向
    if up_probability > 55:
        prediction = '涨'
    elif up_probability < 45:
        prediction = '跌'
    else:
        prediction = '平'

    # 置信度 = |上涨概率 - 50| × 2
    confidence = round(abs(up_probability - 50) * 2)

    # 构建 modelVotes
    model_votes = []
    for key, m in models.items():
        model_votes.append({
            'model': key,
            'vote': '涨' if m['score'] > 50 else '跌',
            'upProbability': round(m['score']),
            'weight': round(m['weight'], 2),
        })

    # 计算近期趋势标签
    recent_5day = ((closes[-1] - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 else 0
    recent_20day = ((closes[-1] - closes[-21]) / closes[-21] * 100) if len(closes) >= 21 else 0
    if recent_5day > 2 and recent_20day > 0:
        history_trend = '上涨'
    elif recent_5day < -2 and recent_20day < 0:
        history_trend = '下跌'
    else:
        history_trend = '震荡'

    return {
        'success': True,
        'symbol': symbol,
        'stockName': stock_name or symbol,
        'prediction': prediction,
        'upProbability': up_probability,
        'downProbability': down_probability,
        'confidence': confidence,
        'historyTrend': history_trend,
        'modelVotes': model_votes,
        'factorScores': {
            'trend': round(trend_score),
            'momentum': round(momentum_score),
            'volume': round(volume_score),
            'technical': round(tech_score),
        },
        'indicators': {
            'ma5': round(ma5[-1], 2) if ma5 else None,
            'ma10': round(ma10[-1], 2) if ma10 else None,
            'ma20': round(ma20[-1], 2) if ma20 else None,
            'rsi': round(rsi, 2),
            'macd': round(macd_val, 4) if macd_val else None,
            'macdSignal': round(signal_val, 4) if signal_val else None,
            'macdHistogram': round(histogram, 4) if histogram else None,
            'volumeTrend': round(vol_trend, 2),
        },
        'dataPoints': len(closes),
        'timestamp': datetime.now().isoformat(),
    }


# ==================== SCF 入口 ====================

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
            'body': json.dumps({'healthy': True, 'version': 'lightweight-v1'}),
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
        result = predict_stock(symbol, stock_name)
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
