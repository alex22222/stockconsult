import type { MomentumPick, MomentumScanResult } from '../types/momentum';
import { InvestodayMCPClient } from './mcp-client';
import type { MCPQuoteHistory, MCPStockScore } from './mcp-client';

// ============================================
// 爆破力扫描 — 数据获取层
// 1. 优先通过 investoday API 获取真实行情计算
// 2. 回退到本地 JSON / Mock 数据
// ============================================

const BATCH_SIZE = 5;

interface HotStock {
  code: string;
  name: string;
  changePercent: number;
  volume: number;
  turnover: number;
  turnoverRate: number;
  volumeRatio: number;
  high: number;
  low: number;
  open: number;
  preClose: number;
}

async function fetchHotStocks(): Promise<HotStock[]> {
  const baseUrl = import.meta.env.VITE_CLOUDBASE_API_URL || '';
  console.log('[MomentumScanner] fetchHotStocks baseUrl:', baseUrl);
  try {
    const res = await fetch(`${baseUrl}/hot-stocks?limit=25&market=all`, { cache: 'no-store' });
    console.log('[MomentumScanner] fetchHotStocks status:', res.status, 'ok:', res.ok);
    const data = await res.json();
    console.log('[MomentumScanner] fetchHotStocks data.success:', data.success, 'stocks:', data.stocks?.length);
    if (data.success && Array.isArray(data.stocks)) {
      return data.stocks;
    }
  } catch (e) {
    console.warn('[MomentumScanner] fetchHotStocks failed:', e);
  }
  return [];
}

function inferExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('688') || code.startsWith('689')) return 'SSE';
  if (code.startsWith('0') || code.startsWith('3')) return 'SZSE';
  return 'BJSE';
}

// ========== 技术指标计算（纯前端）==========

function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    result.push(sum / period);
  }
  return result;
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[0]);
    } else {
      result.push(values[i] * k + result[i - 1] * (1 - k));
    }
  }
  return result;
}

function calcRSI(closes: number[], period = 6): number[] {
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const avgGain = sma(gains, period);
  const avgLoss = sma(losses, period);
  const rsi: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(avgGain[i]) || isNaN(avgLoss[i]) || avgLoss[i] === 0) {
      rsi.push(50);
    } else {
      rsi.push(100 - 100 / (1 + avgGain[i] / avgLoss[i]));
    }
  }
  return rsi;
}

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif: number[] = [];
  for (let i = 0; i < closes.length; i++) dif.push(emaFast[i] - emaSlow[i]);
  const dea = ema(dif, signal);
  const hist: number[] = [];
  for (let i = 0; i < closes.length; i++) hist.push(dif[i] - dea[i]);
  return { dif, dea, hist };
}

function calcBollinger(closes: number[], period = 20, mult = 2) {
  const ma = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(ma[i])) {
      upper.push(NaN);
      lower.push(NaN);
      width.push(NaN);
      continue;
    }
    let sumSq = 0;
    for (let j = 0; j < period && i - j >= 0; j++) {
      sumSq += Math.pow(closes[i - j] - ma[i], 2);
    }
    const std = Math.sqrt(sumSq / period);
    upper.push(ma[i] + mult * std);
    lower.push(ma[i] - mult * std);
    width.push(((ma[i] + mult * std) - (ma[i] - mult * std)) / (ma[i] + 1e-10) * 100);
  }
  return { ma, upper, lower, width };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < highs.length; i++) {
    const tr1 = highs[i] - lows[i];
    const tr2 = Math.abs(highs[i] - closes[i - 1]);
    const tr3 = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  return sma(tr, period);
}

// ========== 五维评分引擎 ==========

interface QuoteRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

function parseHistory(raw: MCPQuoteHistory[]): QuoteRow[] {
  return raw.map((h) => ({
    date: (h.tradeDate || '').split(' ')[0],
    open: h.openPrice ?? 0,
    high: h.highPrice ?? 0,
    low: h.lowPrice ?? 0,
    close: h.closePrice ?? 0,
    volume: h.volume ?? 0,
    turnover: h.amount ?? 0,
  }));
}

function scoreVolumePrice(rows: QuoteRow[]): { name: string; score: number; details: string[] } {
  if (rows.length < 25) return { name: '量价脉冲', score: 50, details: ['数据不足，无法评估量价'] };
  const closes = rows.map((r) => r.close);
  const volumes = rows.map((r) => r.volume);

  const vol20 = sma(volumes, 20);
  const latestVolRatio = volumes[volumes.length - 1] / (vol20[vol20.length - 1] || 1);

  const ret3d = (closes[closes.length - 1] / closes[closes.length - 4] - 1) * 100;

  let volScore = 40;
  if (latestVolRatio >= 3.0) volScore = 100;
  else if (latestVolRatio >= 2.0) volScore = 85;
  else if (latestVolRatio >= 1.5) volScore = 70;
  else if (latestVolRatio >= 1.2) volScore = 55;

  const retScore =
    8 <= ret3d && ret3d <= 18 ? 90 :
    5 <= ret3d && ret3d < 8 ? 80 :
    2 <= ret3d && ret3d < 5 ? 65 :
    0 <= ret3d && ret3d < 2 ? 50 :
    ret3d < 0 ? 35 :
    60; // >18 透支

  const score = Math.round(volScore * 0.6 + retScore * 0.4);

  const details: string[] = [];
  details.push(`近3日成交量为20日均量的 ${latestVolRatio.toFixed(1)} 倍`);
  details.push(`近3日累计涨幅 ${ret3d >= 0 ? '+' : ''}${ret3d.toFixed(2)}%`);
  if (latestVolRatio >= 1.5 && ret3d >= 5) details.push('量价齐升，资金介入迹象明显');
  else if (latestVolRatio >= 1.5) details.push('放量但涨幅温和，筹码交换充分');
  else details.push('量能一般，等待放量确认');

  return { name: '量价脉冲', score, details };
}

function scoreTechnical(rows: QuoteRow[]): { name: string; score: number; details: string[] } {
  if (rows.length < 60) return { name: '技术突破', score: 50, details: ['数据不足，无法评估技术形态'] };
  const closes = rows.map((r) => r.close);
  const highs = rows.map((r) => r.high);

  const high20 = Math.max(...highs.slice(-20));
  const high60 = Math.max(...highs.slice(-60));
  const latestClose = closes[closes.length - 1];

  const breakout20 = latestClose >= high20 * 0.995;
  const breakout60 = latestClose >= high60 * 0.995;

  const rsi = calcRSI(closes, 6);
  const latestRSI = rsi[rsi.length - 1];

  const { dif, dea, hist } = calcMACD(closes);
  const macdBull = dif[dif.length - 1] > dea[dea.length - 1] && hist[hist.length - 1] > 0;
  const macdExpanding = hist.length >= 3 && hist[hist.length - 1] > hist[hist.length - 2];

  let breakoutScore = 50;
  if (breakout60) breakoutScore = 95;
  else if (breakout20) breakoutScore = 80;

  const rsiScore =
    latestRSI >= 55 && latestRSI <= 75 ? 90 :
    latestRSI >= 50 && latestRSI < 55 ? 75 :
    latestRSI >= 40 && latestRSI < 50 ? 55 :
    latestRSI > 75 ? 65 :
    40;

  let macdScore = 45;
  if (macdBull && macdExpanding) macdScore = 90;
  else if (macdBull) macdScore = 75;

  const score = Math.round(breakoutScore * 0.4 + rsiScore * 0.3 + macdScore * 0.3);

  const details: string[] = [];
  if (breakout60) details.push('收盘价突破近60日高点，中期趋势强势');
  else if (breakout20) details.push('收盘价突破近20日高点，短期趋势向上');
  else details.push('尚未突破近期高点，处于盘整或回调中');
  details.push(`RSI(6) 位于 ${latestRSI.toFixed(1)}，${latestRSI >= 50 ? '强势区间' : '弱势区间'}`);
  if (macdBull && macdExpanding) details.push('MACD 红柱连续放大，动能增强');
  else if (macdBull) details.push('MACD 金叉维持，但红柱未明显扩大');
  else details.push('MACD 尚未形成明确多头信号');

  return { name: '技术突破', score, details };
}

function scoreCapital(rows: QuoteRow[]): { name: string; score: number; details: string[] } {
  if (rows.length < 25) return { name: '资金涌入', score: 50, details: ['数据不足'] };
  const volumes = rows.map((r) => r.volume);
  const vol20 = sma(volumes, 20);
  const latestVol = volumes[volumes.length - 1];
  const avgVol20 = vol20[vol20.length - 1] || 1;
  const ratio = latestVol / avgVol20;

  let score = 45;
  if (ratio >= 2.5) score = 95;
  else if (ratio >= 2.0) score = 85;
  else if (ratio >= 1.5) score = 75;
  else if (ratio >= 1.2) score = 60;

  const details: string[] = [];
  details.push(`最新成交量为20日均量的 ${ratio.toFixed(1)} 倍`);
  if (ratio >= 1.5) details.push('交易活跃度显著提升，资金关注度增加');
  else details.push('成交相对平稳，未出现明显资金异动');

  return { name: '资金涌入', score, details };
}

function scoreSentiment(rows: QuoteRow[], scoreData: MCPStockScore | null): { name: string; score: number; details: string[] } {
  const closes = rows.map((r) => r.close);
  // 近5日阳线数
  let yangCount = 0;
  for (let i = Math.max(0, closes.length - 5); i < closes.length; i++) {
    if (i > 0 && closes[i] > closes[i - 1]) yangCount++;
  }

  let s = 50;
  if (yangCount >= 4) s += 15;
  else if (yangCount >= 3) s += 8;
  else if (yangCount <= 1) s -= 10;

  // 加入 investoday 综合评分中的情绪分和技术分
  if (scoreData) {
    const sentiment = scoreData.emotionScore || 50;
    const tech = scoreData.skillScore || 50;
    // 映射到 0-100
    s = Math.round(s * 0.5 + sentiment * 0.3 + tech * 0.2);
  }

  const details: string[] = [];
  details.push(`近5日 ${yangCount} 天收阳，${yangCount >= 3 ? '市场情绪偏乐观' : '情绪中性'}`);
  if (scoreData) {
    details.push(` investoday 情绪评分 ${scoreData.emotionScore?.toFixed(1) || '--'}，技术评分 ${scoreData.skillScore?.toFixed(1) || '--'}`);
  }

  return { name: '情绪催化', score: Math.min(100, Math.max(30, s)), details };
}

function scoreVolatility(rows: QuoteRow[]): { name: string; score: number; details: string[] } {
  if (rows.length < 25) return { name: '资金涌入', score: 50, details: ['数据不足'] };
  const closes = rows.map((r) => r.close);
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);

  const { upper, width } = calcBollinger(closes);
  const atr = calcATR(highs, lows, closes);

  const latestClose = closes[closes.length - 1];
  const latestUpper = upper[upper.length - 1];
  const breakoutBB = !isNaN(latestUpper) && latestClose > latestUpper * 0.995;

  const latestATR = atr[atr.length - 1];
  const atr20 = sma(atr, 20);
  const atrRatio = !isNaN(latestATR) && atr20.length > 0 && !isNaN(atr20[atr20.length - 1])
    ? latestATR / atr20[atr20.length - 1]
    : 1;

  let score = 50;
  if (breakoutBB) score = 85;
  else if (atrRatio >= 1.3) score = 70;

  const details: string[] = [];
  details.push(`布林带宽度 ${width[width.length - 1]?.toFixed(2) || '--'}%`);
  if (breakoutBB) details.push('收盘价突破布林带上轨，波动向上释放');
  details.push(`ATR(14) 为20日均值的 ${atrRatio.toFixed(1)} 倍`);

  return { name: '波动释放', score, details };
}

function buildEntryPlan(
  rows: QuoteRow[],
  totalScore: number,
  dimensions: Array<{ name: string; score: number; details: string[] }>
): MomentumPick['entryPlan'] {
  const closes = rows.map((r) => r.close);
  const highs = rows.map((r) => r.high);
  const volumes = rows.map((r) => r.volume);
  const latest = rows[rows.length - 1];
  const latestClose = latest.close;
  const prevClose = rows[rows.length - 2]?.close || latestClose;
  const dailyChange = prevClose ? (latestClose / prevClose - 1) * 100 : 0;

  const high20 = Math.max(...highs.slice(-20));
  const high60 = Math.max(...highs.slice(-60));
  const vol20 = sma(volumes, 20);
  const volRatio = volumes[volumes.length - 1] / (vol20[vol20.length - 1] || 1);
  const rsi = calcRSI(closes, 6);
  const latestRSI = rsi[rsi.length - 1];
  const ret3d = closes.length >= 4 ? (latestClose / closes[closes.length - 4] - 1) * 100 : 0;

  const breakout20 = latestClose >= high20 * 0.995;
  const breakout60 = latestClose >= high60 * 0.995;
  const breakoutLevel = breakout60 ? high60 : high20;
  const technical = dimensions.find((d) => d.name === '技术突破')?.score ?? 50;
  const capital = dimensions.find((d) => d.name === '资金涌入')?.score ?? 50;
  const isOverheated = latestRSI > 78 || ret3d > 12 || dailyChange > 7;
  const hasBreakout = breakout20 || breakout60;
  const nearBreakout = latestClose >= high20 * 0.97;
  const stopPrice = Math.min(latestClose * 0.95, breakoutLevel * 0.97);

  if (totalScore < 55 || technical < 55) {
    return {
      type: 'wait',
      label: '等待确认',
      trigger: `放量站上 ${high20.toFixed(2)} 后再观察`,
      invalidation: `收盘跌破 ${stopPrice.toFixed(2)}`,
      note: '当前只是通过扫描，不等于出现可执行买点。',
    };
  }

  if (hasBreakout && isOverheated) {
    return {
      type: 'pullback',
      label: '回踩低吸',
      trigger: `回踩 ${breakoutLevel.toFixed(2)} 附近不破且缩量企稳`,
      invalidation: `收盘跌破 ${stopPrice.toFixed(2)}`,
      note: '已上破但短线偏热，不建议把“通过扫描”理解为直接追高。',
    };
  }

  if (hasBreakout && volRatio >= 1.2 && capital >= 60) {
    return {
      type: 'breakout',
      label: '上破追击',
      trigger: `放量站稳 ${breakoutLevel.toFixed(2)}，且分时不快速跌回`,
      invalidation: `收盘跌破 ${stopPrice.toFixed(2)}`,
      note: '偏突破确认买点，适合小仓位试错并严格止损。',
    };
  }

  if (nearBreakout && technical >= 65) {
    return {
      type: 'breakout',
      label: '等上破确认',
      trigger: `有效突破 ${high20.toFixed(2)} 且成交量继续放大`,
      invalidation: `收盘跌破 ${stopPrice.toFixed(2)}`,
      note: '还没真正突破，优先等上破，不是下跌途中接刀。',
    };
  }

  return {
    type: 'pullback',
    label: '回踩低吸',
    trigger: `回踩 ${Math.min(latestClose * 0.98, high20).toFixed(2)} 附近企稳`,
    invalidation: `收盘跌破 ${stopPrice.toFixed(2)}`,
    note: '动能够看，但买点不清晰，等价格给出更好的风险收益比。',
  };
}

function buildPick(
  stock: { code: string; name: string },
  rows: QuoteRow[],
  scoreData: MCPStockScore | null
): MomentumPick {
  const d1 = scoreVolumePrice(rows);
  const d2 = scoreTechnical(rows);
  const d3 = scoreCapital(rows);
  const d4 = scoreSentiment(rows, scoreData);
  const d5 = scoreVolatility(rows);

  const total = Math.round(d1.score * 0.30 + d2.score * 0.25 + d3.score * 0.20 + d4.score * 0.15 + d5.score * 0.10);
  const level: MomentumPick['level'] =
    total >= 85 ? 'extreme' : total >= 70 ? 'high' : total >= 55 ? 'medium' : 'low';

  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const changePercent = prev ? Number(((latest.close - prev.close) / prev.close * 100).toFixed(2)) : 0;

  const bestDim = [d1, d2, d3, d4, d5].reduce((a, b) => (a.score > b.score ? a : b));

  const summaryMap: Record<string, string> = {
    '量价脉冲': `${stock.name} 近期量能显著放大，${d1.details[0].split('，')[0]}，短期动能充沛。`,
    '技术突破': `${stock.name} 技术形态向好，${d2.details[0].split('，')[0]}，关注突破后的持续性。`,
    '资金涌入': `${stock.name} 交易活跃度提升，${d3.details[0].split('，')[0]}，资金关注度增加。`,
    '情绪催化': `${stock.name} 市场情绪${d4.score >= 60 ? '偏暖' : '中性'}，${d4.details[0].split('，')[0]}。`,
    '波动释放': `${stock.name} 波动率出现变化，${d5.details[0].split('，')[0]}，方向选择中。`,
  };

  const dimensions = [
    { name: '量价脉冲', score: d1.score, weight: 0.30, details: d1.details },
    { name: '技术突破', score: d2.score, weight: 0.25, details: d2.details },
    { name: '资金涌入', score: d3.score, weight: 0.20, details: d3.details },
    { name: '情绪催化', score: d4.score, weight: 0.15, details: d4.details },
    { name: '波动释放', score: d5.score, weight: 0.10, details: d5.details },
  ];

  const riskWarnings: string[] = [];
  if (total > 80) {
    riskWarnings.push('短期涨幅较大，需警惕获利回吐压力');
    riskWarnings.push('建议设置止损位，控制单笔亏损不超过 5%');
  } else if (total > 65) {
    riskWarnings.push('板块轮动较快，需关注热点持续性');
    riskWarnings.push('建议设置止损位，控制单笔亏损不超过 5%');
  } else {
    riskWarnings.push('信号强度一般，建议观察等待');
    riskWarnings.push('大盘环境可能影响个股表现');
  }

  return {
    rank: 0,
    stock: {
      code: stock.code,
      name: stock.name,
      exchange: inferExchange(stock.code),
      industry: scoreData?.idu4Lv3Name || '综合',
    },
    price: Number(latest.close.toFixed(2)),
    changePercent,
    score: total,
    level,
    dimensions,
    summary: summaryMap[bestDim.name] || `${stock.name} 综合爆破力指数 ${total} 分，值得关注。`,
    entryPlan: buildEntryPlan(rows, total, dimensions),
    holdingPeriod: total >= 80 ? '1-3 个交易日' : total >= 65 ? '3-5 个交易日' : '5 个交易日以内',
    riskWarning: riskWarnings,
    updatedAt: latest.date,
  };
}

// ========== API 扫描 ==========

async function scanViaAPI(onProgress?: (done: number, total: number) => void): Promise<MomentumScanResult> {
  // 1. 从东方财富获取今日热门股（动态股票池）
  const hotStocks = await fetchHotStocks();
  console.log('[MomentumScanner] scanViaAPI hotStocks.length:', hotStocks.length);
  if (hotStocks.length === 0) {
    throw new Error('无法获取热门股票池');
  }

  const baseUrl = import.meta.env.VITE_CLOUDBASE_API_URL || '';
  const client = new InvestodayMCPClient('', baseUrl);

  const endDate = new Date().toISOString().split('T')[0];
  const beginDateObj = new Date();
  beginDateObj.setDate(beginDateObj.getDate() - 90);
  const beginDate = beginDateObj.toISOString().split('T')[0];

  const picks: MomentumPick[] = [];
  const total = hotStocks.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = hotStocks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (stock) => {
        try {
          console.log('[MomentumScanner] fetching:', stock.code, stock.name);
          const [historyRaw, scoreRaw] = await Promise.all([
            client.listAdjustedQuotes(stock.code, beginDate, endDate),
            client.getStockScore(stock.code),
          ]);
          console.log('[MomentumScanner] historyRaw length:', historyRaw.length, 'scoreRaw:', scoreRaw ? 'OK' : 'null', 'for', stock.code);
          const rows = parseHistory(historyRaw);
          console.log('[MomentumScanner] parsed rows:', rows.length, 'for', stock.code, 'first:', rows[0]);
          if (rows.length < 30) {
            console.log('[MomentumScanner] skipping', stock.code, 'rows too short');
            return null;
          }
          const pick = buildPick(stock, rows, scoreRaw);
          console.log('[MomentumScanner] built pick for', stock.code, 'score:', pick.score);
          return pick;
        } catch (e) {
          console.warn(`[MomentumScanner] Failed to fetch ${stock.code}:`, e);
          return null;
        }
      })
    );
    batchResults.forEach((r) => { if (r) picks.push(r); });
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, total), total);
  }

  picks.sort((a, b) => b.score - a.score);
  picks.forEach((p, i) => { p.rank = i + 1; });

  const top = picks.slice(0, 10);
  const sentiment: MomentumScanResult['marketSentiment'] =
    top.length > 0 && top[0].score >= 70 ? 'bullish' : 'neutral';

  return {
    picks: top,
    scanTime: new Date().toLocaleString('zh-CN'),
    marketSentiment: sentiment,
    totalScanned: hotStocks.length,
  };
}

// ========== 本地 JSON / Mock 回退 ==========

async function fetchLocalMomentumPicks(): Promise<MomentumScanResult | null> {
  try {
    // 加时间戳绕过 CDN/浏览器缓存
    const res = await fetch(`/data/momentum_scan.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.picks || !Array.isArray(data.picks)) return null;
    return data as MomentumScanResult;
  } catch (e) {
    console.warn('[MomentumScanner] Local data fetch failed:', e);
    return null;
  }
}

function generateMockPicks(): MomentumScanResult {
  const industries = ['半导体', '光伏', '锂电池', 'AI算力', '机器人', '创新药', '证券', '消费电子'];
  const names: Record<string, string[]> = {
    '半导体': ['中芯国际', '韦尔股份', '兆易创新', '北方华创'],
    '光伏': ['隆基绿能', '通威股份', '晶科能源'],
    '锂电池': ['宁德时代', '亿纬锂能', '天赐材料'],
    'AI算力': ['中科曙光', '浪潮信息', '工业富联'],
    '机器人': ['汇川技术', '埃斯顿', '双环传动'],
    '创新药': ['恒瑞医药', '百济神州', '药明康德'],
    '证券': ['东方财富', '中信证券', '华泰证券'],
    '消费电子': ['立讯精密', '歌尔股份', '蓝思科技'],
  };

  const picks: MomentumPick[] = [];
  const used = new Set<string>();

  for (let i = 0; i < 10; i++) {
    const ind = industries[Math.floor(Math.random() * industries.length)];
    const pool = names[ind] || ['未知'];
    let name = pool[Math.floor(Math.random() * pool.length)];
    while (used.has(name)) name = pool[Math.floor(Math.random() * pool.length)];
    used.add(name);

    const code = ['600', '601', '603', '000', '002', '300'][Math.floor(Math.random() * 6)] +
      String(100 + Math.floor(Math.random() * 900));
    const score = Math.min(100, Math.max(45, 88 - i * 5 + Math.floor(Math.random() * 9) - 4));
    const level = score >= 85 ? 'extreme' : score >= 70 ? 'high' : score >= 55 ? 'medium' : 'low';

    const d = (base: number) => Math.min(100, Math.max(30, base + Math.floor(Math.random() * 25) - 12));
    const dims = [
      { name: '量价脉冲', score: d(score), weight: 0.30, details: [`成交量放大 ${(1 + Math.random() * 4).toFixed(1)} 倍`, `近3日涨幅 ${(Math.random() * 20 - 5).toFixed(1)}%`] },
      { name: '技术突破', score: d(score), weight: 0.25, details: [score > 70 ? '突破近期高点' : '尚未突破', `RSI ${Math.floor(Math.random() * 40 + 30)}`] },
      { name: '资金涌入', score: d(score), weight: 0.20, details: [`换手率 ${(Math.random() * 15 + 1).toFixed(1)}%`] },
      { name: '情绪催化', score: d(score), weight: 0.15, details: ['消息面中性'] },
      { name: '波动释放', score: d(score), weight: 0.10, details: ['波动率中性'] },
    ];
    const entryPlan: MomentumPick['entryPlan'] = score > 75
      ? {
          type: 'breakout',
          label: '上破追击',
          trigger: '放量突破前高后确认',
          invalidation: '跌回突破位下方',
          note: '演示数据仅展示字段形态，不构成真实买点。',
        }
      : {
          type: 'wait',
          label: '等待确认',
          trigger: '突破近期高点后再观察',
          invalidation: '跌破短期支撑',
          note: '演示数据仅展示字段形态，不构成真实买点。',
        };

    picks.push({
      rank: i + 1,
      stock: { code, name, exchange: code.startsWith('6') ? 'SSE' : 'SZSE', industry: ind },
      price: Number((Math.random() * 150 + 10).toFixed(2)),
      changePercent: Number((Math.random() * 10 - 2).toFixed(2)),
      score,
      level,
      dimensions: dims,
      summary: `${name} 短期动能${score > 70 ? '充沛' : '一般'}，综合爆破力 ${score} 分。`,
      entryPlan,
      holdingPeriod: score >= 80 ? '1-3 个交易日' : score >= 65 ? '3-5 个交易日' : '5 个交易日以内',
      riskWarning: score > 70
        ? ['短期涨幅较大，需警惕获利回吐压力', '建议设置止损位']
        : ['信号强度一般，建议观察等待'],
      updatedAt: new Date().toISOString().split('T')[0],
    });
  }

  picks.sort((a, b) => b.score - a.score);
  picks.forEach((p, i) => { p.rank = i + 1; });

  return {
    picks,
    scanTime: new Date().toLocaleString('zh-CN'),
    marketSentiment: 'bullish',
    totalScanned: 5200,
  };
}

// ========== 公开接口 ==========

export async function scanMomentumPicks(
  onProgress?: (done: number, total: number) => void
): Promise<MomentumScanResult> {
  // 第一优先级：investoday API 真实数据
  try {
    const apiResult = await scanViaAPI(onProgress);
    if (apiResult.picks.length >= 5) {
      return apiResult;
    }
    console.warn('[MomentumScanner] API scan returned only', apiResult.picks.length, 'picks, falling back to local');
  } catch (e) {
    console.warn('[MomentumScanner] API scan failed, falling back:', e);
  }

  // 第二优先级：本地预计算 JSON
  const local = await fetchLocalMomentumPicks();
  if (local && local.picks.length > 0) {
    return local;
  }

  // 最终回退：Mock
  return generateMockPicks();
}
