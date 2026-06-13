# -*- coding: utf-8 -*-
"""
SCF 定时任务入口 — 每日数据更新 + 预测 + 模拟盘重建
=====================================================
通过 investoday MCP API 获取数据，纯 Python 标准库 + 云函数内置依赖

部署方式：
1. 在腾讯云 SCF 控制台创建/更新函数
2. 上传此文件 + requirements.txt
3. 配置定时触发器：0 30 15 * * * *（每天15:30，收盘后）
4. 环境变量：INVESTODAY_API_KEY

注意：此版本使用 investoday API 获取数据，不依赖 akshare/baostock
"""

import json
import os
import sys
import logging
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from strategy_config import get_rebuild_stocks, get_sector

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Investoday API 配置（可选）
INVESTODAY_API_KEY = os.environ.get('INVESTODAY_API_KEY')
INVESTODAY_BASE_URL = 'https://data-api.investoday.net/data/mcp/preset'

def _to_tencent_code(symbol):
    code = symbol.replace('sh', '').replace('sz', '').replace('hk', '')
    if code.startswith('6') or code.startswith('5'):
        return f'sh{code}'
    return f'sz{code}'

def _http_get(url, timeout=15, headers=None):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8')
    except Exception as e:
        logger.warning(f"HTTP GET failed: {url[:60]}... error: {e}")
        return None

def fetch_history_tencent(stock_code, days=120):
    """通过腾讯财经获取历史 K 线数据（前复权）"""
    tcode = _to_tencent_code(stock_code)
    end = datetime.now()
    begin = end - timedelta(days=days + 60)
    url = (
        f"http://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
        f"?param={tcode},day,{begin.strftime('%Y-%m-%d')},{end.strftime('%Y-%m-%d')},640,qfq"
    )
    raw = _http_get(url, timeout=20)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception as e:
        logger.warning(f"Tencent JSON parse failed: {e}")
        return []
    day_data = data.get('data', {}).get(tcode, {}).get('day', [])
    if not day_data:
        for k, v in data.get('data', {}).items():
            if isinstance(v, dict) and 'day' in v:
                day_data = v['day']
                break
    klines = []
    for row in day_data:
        if len(row) < 6:
            continue
        klines.append({
            'tradeDate': row[0],
            'openPrice': float(row[1]),
            'closePrice': float(row[2]),
            'lowPrice': float(row[3]),
            'highPrice': float(row[4]),
            'volume': float(row[5]),
        })
    klines.sort(key=lambda x: x['tradeDate'])
    return klines

def fetch_realtime_quote_tencent(stock_code):
    """通过腾讯财经获取实时行情"""
    tcode = _to_tencent_code(stock_code)
    url = f"http://qt.gtimg.cn/q={tcode}"
    raw = _http_get(url, timeout=10)
    if not raw:
        return None
    try:
        match = raw.split('"')[1]
        parts = match.split('~')
        if len(parts) < 45:
            return None
        return {
            'name': parts[1],
            'code': parts[2],
            'price': float(parts[3]),
            'prevClose': float(parts[4]),
            'open': float(parts[5]),
            'high': float(parts[33]),
            'low': float(parts[34]),
            'volume': float(parts[36]),
            'changePercent': float(parts[32]),
        }
    except Exception as e:
        logger.warning(f"Tencent realtime parse failed: {e}")
        return None

def mcp_call(tool_name, arguments, timeout=15):
    """调用 investoday MCP API（可选 fallback）"""
    if not INVESTODAY_API_KEY:
        return None
    url = f"{INVESTODAY_BASE_URL}?apiKey={INVESTODAY_API_KEY}"
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments}
    }).encode('utf-8')

    req = urllib.request.Request(
        url, data=payload,
        headers={'Content-Type': 'application/json', 'User-Agent': 'stock-predictor/2.0'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        logger.warning(f"MCP call failed: {e}")
        return None

    if data.get('error'):
        return None
    result = data.get('result', {})
    if result.get('isError'):
        return None
    content = result.get('content', [{}])[0].get('text', '{}')
    try:
        return json.loads(content)
    except:
        return {"raw": content}


def fetch_history_investoday(stock_code, days=120):
    """通过 investoday 获取历史 K 线（可选 fallback）"""
    if not INVESTODAY_API_KEY:
        return []
    end = datetime.now()
    begin = end - timedelta(days=days + 30)
    result = mcp_call('list_stock_adjusted_quotes', {
        'stockCode': stock_code,
        'beginDate': begin.strftime('%Y-%m-%d'),
        'endDate': end.strftime('%Y-%m-%d'),
    })
    if not result or not result.get('data'):
        return []
    return sorted(result['data'], key=lambda x: x.get('tradeDate', x.get('QUOTETIME', '')))


def fetch_history(stock_code, days=120):
    """获取历史 K 线数据：腾讯优先，investoday fallback"""
    klines = fetch_history_tencent(stock_code, days)
    if klines and len(klines) >= 30:
        return klines
    logger.warning(f"Tencent history failed for {stock_code}, trying investoday")
    klines = fetch_history_investoday(stock_code, days)
    if klines and len(klines) >= 30:
        return klines
    logger.error(f"All history sources failed for {stock_code}")
    return []


def fetch_realtime_quote(stock_code):
    """获取实时行情：腾讯优先，investoday fallback"""
    quote = fetch_realtime_quote_tencent(stock_code)
    if quote:
        return quote
    logger.warning(f"Tencent realtime failed for {stock_code}, trying investoday")
    if not INVESTODAY_API_KEY:
        return None
    result = mcp_call('get_stock_quote_realtime', {'stockCode': stock_code})
    if result and result.get('code') == 'Success' and result.get('data'):
        return result['data']
    return None


# ==================== 技术指标（纯 Python）====================

def calc_ma(prices, period):
    if len(prices) < period:
        return []
    return [sum(prices[i - period + 1:i + 1]) / period for i in range(period - 1, len(prices))]


def calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return 50
    gains, losses = [], []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i - 1]
        gains.append(diff if diff > 0 else 0)
        losses.append(-diff if diff < 0 else 0)
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100 if avg_gain > 0 else 50
    return 100 - (100 / (1 + avg_gain / avg_loss))


def calc_ema(data, period):
    multiplier = 2 / (period + 1)
    ema_vals = [sum(data[:period]) / period]
    for price in data[period:]:
        ema_vals.append((price - ema_vals[-1]) * multiplier + ema_vals[-1])
    return ema_vals


def calc_macd(prices, fast=12, slow=26, signal=9):
    if len(prices) < slow + signal:
        return 0, 0, 0
    fast_ema = calc_ema(prices, fast)
    slow_ema = calc_ema(prices, slow)
    min_len = min(len(fast_ema), len(slow_ema))
    macd_line = [fast_ema[-(min_len - i)] - slow_ema[-(min_len - i)] for i in range(min_len)]
    if len(macd_line) < signal:
        return 0, 0, 0
    signal_line = calc_ema(macd_line, signal)
    return macd_line[-1], signal_line[-1], macd_line[-1] - signal_line[-1]


def calc_bollinger(prices, period=20):
    if len(prices) < period:
        return None, None, None
    recent = prices[-period:]
    ma = sum(recent) / period
    std = (sum((p - ma) ** 2 for p in recent) / period) ** 0.5
    return ma + 2 * std, ma, ma - 2 * std


# ==================== 预测引擎 ====================

def predict_stock(symbol, stock_name=''):
    """基于技术指标的涨跌预测"""
    klines = fetch_history(symbol, days=120)
    if len(klines) < 30:
        return {'success': False, 'error': f'历史数据不足: {len(klines)}条'}

    closes = [float(k['closePrice']) for k in klines if k.get('closePrice')]
    volumes = [float(k.get('volume', k.get('DEALSTOCKAMOUNT', 0))) for k in klines]
    if len(closes) < 30:
        return {'success': False, 'error': '有效收盘价不足'}

    # 技术指标
    ma5 = calc_ma(closes, 5)
    ma10 = calc_ma(closes, 10)
    ma20 = calc_ma(closes, 20)
    rsi = calc_rsi(closes, 14)
    macd_val, signal_val, histogram = calc_macd(closes)
    bb_upper, bb_mid, bb_lower = calc_bollinger(closes)

    latest = closes[-1]
    prev = closes[-2] if len(closes) >= 2 else latest
    today_change = (latest - prev) / prev * 100 if prev > 0 else 0
    recent_5d = ((latest - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 else 0

    # 多模型评分
    models = {}
    # 趋势模型
    trend_score = 50
    if len(ma5) >= 1 and len(ma10) >= 1 and len(ma20) >= 1:
        if ma5[-1] > ma10[-1] > ma20[-1]:
            trend_score = 85
        elif ma5[-1] > ma10[-1]:
            trend_score = 65
        elif ma5[-1] < ma10[-1] < ma20[-1]:
            trend_score = 15
        elif ma5[-1] < ma10[-1]:
            trend_score = 35
    models['gradient_boosting'] = {'score': trend_score, 'weight': 0.35, 'name': '趋势模型'}

    # 动量模型
    momentum_score = max(0, min(100, 50 + recent_5d * 3 + today_change * 0.5))
    if rsi > 70:
        momentum_score = min(momentum_score, 80)
    elif rsi < 30:
        momentum_score = max(momentum_score, 20)
    models['random_forest'] = {'score': momentum_score, 'weight': 0.25, 'name': '动量模型'}

    # 量能模型
    vol_trend = 0
    if len(volumes) >= 10:
        recent_vol = sum(volumes[-5:]) / 5
        prev_vol = sum(volumes[-10:-5]) / 5
        vol_trend = (recent_vol / prev_vol - 1) * 100 if prev_vol > 0 else 0
    volume_score = 50
    if vol_trend > 20:
        volume_score = 75 if today_change > 0 else 25
    elif vol_trend > 0:
        volume_score = 65 if today_change > 0 else 35
    models['extra_trees'] = {'score': volume_score, 'weight': 0.20, 'name': '量能模型'}

    # 综合评分
    total_weight = sum(m['weight'] for m in models.values())
    weighted_score = sum(m['score'] * m['weight'] for m in models.values()) / total_weight

    # 预测结果
    prediction = 1 if weighted_score > 50 else 0
    up_prob = weighted_score / 100
    confidence = abs(weighted_score - 50) / 50

    return {
        'success': True,
        'symbol': symbol,
        'name': stock_name,
        'prediction': prediction,
        'up_probability': round(up_prob, 4),
        'down_probability': round(1 - up_prob, 4),
        'confidence': round(confidence, 4),
        'individual_predictions': {k: (1 if v['score'] > 50 else 0) for k, v in models.items()},
        'model_weights': {k: v['weight'] for k, v in models.items()},
        'latest_price': round(latest, 2),
        'today_change_pct': round(today_change, 2),
        'indicators': {
            'rsi': round(rsi, 2),
            'macd': round(macd_val, 4),
            'macd_signal': round(signal_val, 4),
            'ma5': round(ma5[-1], 2) if ma5 else None,
            'ma10': round(ma10[-1], 2) if ma10 else None,
            'ma20': round(ma20[-1], 2) if ma20 else None,
        }
    }


# ==================== 模拟盘逻辑 ====================

def run_daily_pipeline():
    """执行每日流水线"""
    logger.info("=" * 60)
    logger.info(f"每日流水线开始: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    results = []
    focus_pool = []
    stocks = get_rebuild_stocks()

    for symbol, name in stocks.items():
        logger.info(f"\n预测 {name}({symbol})...")
        result = predict_stock(symbol, name)
        if result.get('success'):
            results.append(result)
            pred_return = (result['up_probability'] - 0.5) * 10  # 转换为预期收益率
            signal = '买入' if result['prediction'] == 1 else '观望'
            focus_pool.append({
                'symbol': symbol,
                'name': name,
                'predicted_return_5d': round(pred_return, 2),
                'signal': signal,
                'confidence': round(result['confidence'], 2),
                'reason': f"综合评分{result['up_probability']*100:.1f}%，RSI={result['indicators']['rsi']}",
                'sector': get_sector(symbol),
            })
            logger.info(f"  预测: {'涨' if result['prediction']==1 else '跌'} "
                       f"(涨概率{result['up_probability']*100:.1f}%, 置信度{result['confidence']*100:.1f}%)")
        else:
            logger.warning(f"  预测失败: {result.get('error')}")

    # 排序：按预期收益降序
    focus_pool.sort(key=lambda x: x['predicted_return_5d'], reverse=True)

    # 生成报告
    report = {
        'date': datetime.now().strftime('%Y-%m-%d'),
        'focus_pool': focus_pool,
        'predictions': results,
        'generated_at': datetime.now().isoformat(),
    }

    logger.info(f"\n{'=' * 60}")
    logger.info(f"流水线完成: {len(results)}/{len(stocks)} 只股票预测成功")
    logger.info(f"精选池 Top 3:")
    for i, f in enumerate(focus_pool[:3], 1):
        logger.info(f"  {i}. {f['name']}({f['symbol']}): {f['signal']} 预期{f['predicted_return_5d']:+.2f}%")
    logger.info(f"{'=' * 60}")

    return report


# ==================== SCF 入口 ====================

def main_handler(event, context):
    """SCF 主入口"""
    # 处理预检请求
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 204, 'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }, 'body': ''}

    # HTTP 健康检查
    if event.get('path') in ['/health', '/stock-predictor/health']:
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'healthy': True, 'version': '2.0', 'timestamp': datetime.now().isoformat()})
        }

    # HTTP 预测接口
    if event.get('path') in ['/predict', '/stock-predictor/predict']:
        query = event.get('queryString', {}) or event.get('queryStringParameters', {})
        stocks = get_rebuild_stocks()
        default_symbol = next(iter(stocks), '')
        symbol = query.get('symbol') or default_symbol
        name = query.get('name') or stocks.get(symbol, '')
        if not symbol:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'success': False, 'error': 'No stock universe available'})
            }
        result = predict_stock(symbol, name)
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(result)
        }

    # HTTP 批量预测接口
    if event.get('path') in ['/predict-all', '/stock-predictor/predict-all']:
        report = run_daily_pipeline()
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(report)
        }

    # 定时触发器入口（无 path 或 timer 触发）
    report = run_daily_pipeline()
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            'success': True,
            'message': 'Daily pipeline completed',
            'stocks_predicted': len(report['predictions']),
            'date': report['date'],
            'report': report,
        })
    }


# 兼容旧版入口
main = main_handler
