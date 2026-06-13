# -*- coding: utf-8 -*-
"""
CloudBase SCF 入口 - 股票涨跌预测（轻量版）
纯 Python 标准库实现，无 pandas/sklearn 依赖
主数据源: investoday MCP API（有额度限制）
备用数据源: 腾讯财经（免费，无需认证）
"""

import json
import sys
import os
import logging
import traceback
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from strategy_config import get_rebuild_stocks, get_sector

# 配置日志到 stdout（SCF 环境）
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Investoday API 配置（可选，长期不可用时优先使用腾讯/新浪）
INVESTODAY_API_KEY = os.environ.get('INVESTODAY_API_KEY')
INVESTODAY_BASE_URL = 'https://data-api.investoday.net/data/mcp/preset'

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}


# ==================== 工具函数 ====================

def _http_get(url, timeout=15, headers=None):
    """通用 HTTP GET"""
    req = urllib.request.Request(
        url,
        headers=headers or {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8')
    except Exception as e:
        logger.warning(f"HTTP GET failed: {url[:60]}... error: {e}")
        return None


def _to_sina_code(symbol):
    """转换为新浪财经代码格式"""
    code = symbol.replace('sh', '').replace('sz', '').replace('hk', '')
    if code.startswith('6') or code.startswith('5'):
        return f'sh{code}'
    return f'sz{code}'


def _to_tencent_code(symbol):
    """转换为腾讯财经代码格式"""
    code = symbol.replace('sh', '').replace('sz', '').replace('hk', '')
    if code.startswith('6') or code.startswith('5'):
        return f'sh{code}'
    return f'sz{code}'


# ==================== 备用数据源: 腾讯财经 ====================

def fetch_history_tencent(stock_code, days=120):
    """
    通过腾讯财经获取历史 K 线数据（前复权）
    接口: http://web.ifzq.gtimg.cn/appstock/app/fqkline/get
    无需认证，免费，返回 JSON
    """
    tcode = _to_tencent_code(stock_code)
    end = datetime.now()
    begin = end - timedelta(days=days + 60)  # 多取一些确保有足够交易日

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

    # 解析腾讯返回格式
    stock_key = tcode
    day_data = data.get('data', {}).get(stock_key, {}).get('day', [])
    if not day_data:
        # 尝试其他 key 格式
        for k, v in data.get('data', {}).items():
            if isinstance(v, dict) and 'day' in v:
                day_data = v['day']
                break

    if not day_data:
        logger.warning(f"Tencent: no day data for {stock_code}")
        return []

    # 转换为统一格式
    klines = []
    for row in day_data:
        if len(row) < 6:
            continue
        # 腾讯格式: [日期, 开盘, 收盘, 最低, 最高, 成交量]
        klines.append({
            'tradeDate': row[0],
            'openPrice': float(row[1]),
            'closePrice': float(row[2]),
            'lowPrice': float(row[3]),
            'highPrice': float(row[4]),
            'volume': float(row[5]),
        })

    # 按日期排序
    klines.sort(key=lambda x: x['tradeDate'])
    logger.info(f"Tencent: fetched {len(klines)} klines for {stock_code}")
    return klines


def fetch_realtime_quote_tencent(stock_code):
    """
    通过腾讯财经获取实时行情
    接口: http://qt.gtimg.cn/q={market}{code}
    """
    tcode = _to_tencent_code(stock_code)
    url = f"http://qt.gtimg.cn/q={tcode}"

    raw = _http_get(url, timeout=10)
    if not raw:
        return None

    # 腾讯返回格式: v_{market}{code}="1~名称~代码~...";
    try:
        match = raw.split('"')[1]  # 提取引号内容
        parts = match.split('~')
        if len(parts) < 45:
            return None

        # 字段索引参考腾讯格式
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


# ==================== 备用数据源: 新浪财经 ====================

def fetch_history_sina(stock_code, days=120):
    """
    通过新浪财经获取历史 K 线数据
    接口: https://quotes.sina.cn/cn/api/quotes.php?symbol={market}{code}&source=sina
    注意: 新浪财经历史数据接口不稳定，优先使用腾讯
    """
    scode = _to_sina_code(stock_code)
    # 新浪财经历史数据需要通过其他方式获取，这里作为最后的备用
    # 实际使用腾讯财经作为主要备用
    logger.info(f"Sina history fallback for {stock_code} (using tencent)")
    return fetch_history_tencent(stock_code, days)


def fetch_realtime_quote_sina(stock_code):
    """
    通过新浪财经获取实时行情
    接口: https://hq.sinajs.cn/list={market}{code}
    已在 investoday-proxy 中验证可用
    """
    scode = _to_sina_code(stock_code)
    url = f"https://hq.sinajs.cn/list={scode}"

    raw = _http_get(url, timeout=10, headers={
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    if not raw:
        return None

    try:
        match = raw.split('"')[1]
        parts = match.split(',')
        if len(parts) < 5:
            return None

        # A股格式: 名称,今日开盘,昨日收盘,最新价,最高价,最低价,...
        return {
            'name': parts[0],
            'price': float(parts[3]) if parts[3] else float(parts[2]),
            'prevClose': float(parts[2]),
            'open': float(parts[1]),
            'high': float(parts[4]),
            'low': float(parts[5]),
            'volume': float(parts[8]) if len(parts) > 8 else 0,
        }
    except Exception as e:
        logger.warning(f"Sina realtime parse failed: {e}")
        return None


# ==================== 主数据源: Investoday MCP ====================

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


def fetch_history_investoday(stock_code, days=120):
    """通过 investoday 获取历史 K 线"""
    end = datetime.now()
    begin = end - timedelta(days=days + 30)

    result = mcp_call('list_stock_adjusted_quotes', {
        'stockCode': stock_code,
        'beginDate': begin.strftime('%Y-%m-%d'),
        'endDate': end.strftime('%Y-%m-%d'),
    })

    if not result or not result.get('data'):
        return []

    klines = sorted(result['data'], key=lambda x: x.get('tradeDate', x.get('QUOTETIME', '')))
    return klines


def fetch_stock_info(stock_code):
    """获取股票基本信息"""
    result = mcp_call('get_stock_basic_info', {'stockCode': stock_code})
    if result and result.get('code') == 0 and result.get('data'):
        return result['data'][0]
    return None


def fetch_realtime_quote_investoday(stock_code):
    """通过 investoday 获取实时行情"""
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


# ==================== 自动降级数据获取 ====================

def fetch_history(stock_code, days=120):
    """
    获取历史 K 线数据（自动降级）
    优先级: 腾讯财经 → investoday → 空列表
    """
    # 1. 优先腾讯财经（免费、稳定）
    klines = fetch_history_tencent(stock_code, days)
    if klines and len(klines) >= 30:
        logger.info(f"Using tencent data for {stock_code}: {len(klines)} klines")
        return klines

    # 2. 尝试 investoday（如果配置了 key）
    if INVESTODAY_API_KEY:
        logger.warning(f"Tencent failed for {stock_code}, falling back to investoday")
        klines = fetch_history_investoday(stock_code, days)
        if klines and len(klines) >= 30:
            logger.info(f"Using investoday data for {stock_code}: {len(klines)} klines")
            return klines

    # 3. 都失败了
    logger.error(f"All data sources failed for {stock_code}")
    return []


def fetch_realtime_quote(stock_code):
    """
    获取实时行情（自动降级）
    优先级: 腾讯财经 → 新浪财经 → investoday
    """
    # 1. 腾讯财经
    quote = fetch_realtime_quote_tencent(stock_code)
    if quote:
        return quote

    # 2. 新浪财经
    logger.warning(f"Tencent realtime failed for {stock_code}, trying sina")
    quote = fetch_realtime_quote_sina(stock_code)
    if quote:
        return quote

    # 3. investoday（如果配置了 key）
    if INVESTODAY_API_KEY:
        logger.warning(f"Sina realtime failed for {stock_code}, trying investoday")
        quote = fetch_realtime_quote_investoday(stock_code)
        if quote:
            return quote

    logger.error(f"All realtime sources failed for {stock_code}")
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
    models['trend_model'] = {
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
    models['momentum_model'] = {
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
    models['volume_model'] = {
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
    models['technical_model'] = {
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


# ==================== 每日流水线 ====================


def run_daily_pipeline():
    """执行每日流水线：预测所有股票"""
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
            pred_return = (result['upProbability'] - 50) / 5  # 转换为预期收益率
            signal = '买入' if result['prediction'] == '涨' else '观望'
            focus_pool.append({
                'symbol': symbol,
                'name': name,
                'predicted_return_5d': round(pred_return, 2),
                'signal': signal,
                'confidence': round(result['confidence'] / 100, 2),
                'reason': f"综合评分{result['upProbability']}%，RSI={result['indicators']['rsi']}",
                'sector': get_sector(symbol),
            })
            logger.info(f"  预测: {result['prediction']} "
                       f"(涨概率{result['upProbability']}%, 置信度{result['confidence']}%)")
        else:
            logger.warning(f"  预测失败: {result.get('error')}")

    # 排序：按预期收益降序
    focus_pool.sort(key=lambda x: x['predicted_return_5d'], reverse=True)

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
            'body': json.dumps({'healthy': True, 'version': 'lightweight-v2'}),
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

    # 判断触发类型：定时触发器没有 path 和 symbol
    trigger_type = event.get('TriggerName', '') or event.get('Type', '')
    is_timer = 'timer' in trigger_type.lower() or not path or not symbol

    try:
        if is_timer:
            # 定时触发：运行完整流水线
            report = run_daily_pipeline()
            return {
                'statusCode': 200,
                'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
                'body': json.dumps({
                    'success': True,
                    'message': 'Daily pipeline completed',
                    'stocks_predicted': len(report['predictions']),
                    'date': report['date'],
                    'report': report,
                }, ensure_ascii=False, default=str),
            }
        else:
            # HTTP 请求：单股预测
            if not symbol:
                return {
                    'statusCode': 400,
                    'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
                    'body': json.dumps({'success': False, 'error': 'Missing symbol parameter'}),
                }
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
