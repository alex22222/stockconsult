/**
 * CloudBase 云函数 - Investoday API 代理 + 查询记录存储
 * 
 * 作用:
 * 1. 前端不直接暴露 investoday API Key
 * 2. 解决浏览器跨域限制
 * 3. 统一日志和错误处理
 * 4. 提供 /upload-record 端点将查询记录写入 COS
 * 
 * CloudBase SCF 事件格式:
 * {
 *   httpMethod: 'GET' | 'POST',
 *   path: '/investoday-proxy/...',
 *   queryString: {...},
 *   headers: {...},
 *   body: '...'
 * }
 */

const https = require('https');
const Iconv = require('iconv-lite');
const cloudbase = require('@cloudbase/node-sdk');

// CloudBase 数据库初始化
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const FAVORITES_COLLECTION = 'favorites';
const PREDICT_COLLECTION = 'predict';
const API_LOGS_COLLECTION = 'api_logs';
const DEFAULT_USER_ID = 'anonymous';

// 版本标记（用于确认部署生效）
const VERSION = '2026-05-12-v2';

// 从环境变量读取 API Key（在 CloudBase 控制台配置）
const API_KEY = process.env.INVESTODAY_API_KEY;
if (!API_KEY) {
  throw new Error('INVESTODAY_API_KEY environment variable is required');
}
const BASE_URL = 'data-api.investoday.net';

// COS 配置 (stockconsult 环境)
const COS_BUCKET = '7374-stockconsult-d9g7b6ae5b8170e00-1328081868';
const COS_REGION = 'ap-shanghai';

function getCOSClient() {
  const COS = require('cos-nodejs-sdk-v5');
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN || undefined,
  });
}

// CORS 配置
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.main = async (event, context) => {
  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  // 健康检查
  if (event.path === '/health' || event.path === '/investoday-proxy/health') {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ healthy: true, keyConfigured: !!API_KEY, version: VERSION }),
    };
  }

  // 初始化数据库集合
  if (event.path === '/init-db' || event.path === '/investoday-proxy/init-db') {
    return handleInitDb(event);
  }

  // 版本检查（用于确认部署生效）
  if (event.path === '/version' || event.path === '/investoday-proxy/version') {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: VERSION, timestamp: new Date().toISOString() }),
    };
  }

  // 查询记录上传
  if (event.path === '/upload-record' || event.path === '/investoday-proxy/upload-record') {
    return handleUploadRecord(event);
  }

  // 查询记录列表
  if (event.path === '/list-records' || event.path === '/investoday-proxy/list-records') {
    return handleListRecords(event);
  }

  // 查询记录详情
  if (event.path === '/get-record' || event.path === '/investoday-proxy/get-record') {
    return handleGetRecord(event);
  }

  // API 调用日志列表
  if (event.path === '/list-api-logs' || event.path === '/investoday-proxy/list-api-logs') {
    return handleListApiLogs(event);
  }

  // 重建索引（扫描 COS 文件重建 index.json）
  if (event.path === '/rebuild-index' || event.path === '/investoday-proxy/rebuild-index') {
    return handleRebuildIndex(event);
  }

  // 重建报告索引
  if (event.path === '/rebuild-report-index' || event.path === '/investoday-proxy/rebuild-report-index') {
    return handleRebuildIndex(event, 'reports');
  }

  // 市场指数行情
  if (event.path === '/market-indices' || event.path === '/investoday-proxy/market-indices') {
    return handleMarketIndices(event);
  }

  // 个股实时行情（批量）
  if (event.path === '/stock-quotes' || event.path === '/investoday-proxy/stock-quotes') {
    return handleStockQuotes(event);
  }

  // 我的收藏
  if (event.path === '/favorites' || event.path === '/investoday-proxy/favorites') {
    if (event.httpMethod === 'GET') return handleGetFavorites(event);
    if (event.httpMethod === 'POST') return handleAddFavorite(event);
    if (event.httpMethod === 'DELETE') return handleRemoveFavorite(event);
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // 占卜师 - 涨跌概率预测
  if (event.path === '/fortune' || event.path === '/investoday-proxy/fortune') {
    return handleFortune(event);
  }

  // 板块资金流向热力图
  if (event.path === '/sector-fund-flow' || event.path === '/investoday-proxy/sector-fund-flow') {
    return handleSectorFundFlow(event);
  }

  // 热门个股扫描（涨幅排行）
  if (event.path === '/hot-stocks' || event.path === '/investoday-proxy/hot-stocks') {
    return handleHotStocks(event);
  }

  // 个股历史 K 线（Investoday → 腾讯 fallback）
  if (event.path === '/stock-history' || event.path === '/investoday-proxy/stock-history') {
    return handleStockHistory(event);
  }

  // 个股评分代理（Investoday → 启发式 fallback）
  if (event.path === '/stock-score-proxy' || event.path === '/investoday-proxy/stock-score-proxy') {
    return handleStockScoreProxy(event);
  }

  // 个股基本信息（Investoday → Eastmoney fallback）
  if (event.path === '/proxy/stock-basic-info' || event.path === '/investoday-proxy/proxy/stock-basic-info') {
    return handleStockBasicInfo(event);
  }

  // 个股估值指标（Investoday → Eastmoney fallback）
  if (event.path === '/proxy/stock-valuation' || event.path === '/investoday-proxy/proxy/stock-valuation') {
    return handleStockValuation(event);
  }

  // 预测记录 - 定时预测
  if (event.path === '/daily-predict' || event.path === '/investoday-proxy/daily-predict') {
    return handleDailyPredict(event);
  }

  // 预测记录 - 收盘验证
  if (event.path === '/daily-verify' || event.path === '/investoday-proxy/daily-verify') {
    return handleDailyVerify(event);
  }

  // 预测记录 - 列表查询
  if (event.path === '/list-predictions' || event.path === '/investoday-proxy/list-predictions') {
    return handleListPredictions(event);
  }

  // 预测记录 - 统计
  if (event.path === '/prediction-stats' || event.path === '/investoday-proxy/prediction-stats') {
    return handlePredictionStats(event);
  }

  // 保存预测记录（本地模型 + 云模型）
  if (event.path === '/save-prediction' || event.path === '/investoday-proxy/save-prediction') {
    return handleSavePrediction(event);
  }

  // Web Search（补充个股信息）
  if (event.path === '/search-web' || event.path === '/investoday-proxy/search-web') {
    return handleWebSearch(event);
  }

  // 调试：列出 COS bucket
  if (event.path === '/debug-buckets' || event.path === '/investoday-proxy/debug-buckets') {
    return handleDebugBuckets(event);
  }

  // 数据文件代理（从 COS 读取 rebuild/paper-trading 等数据）
  if (event.path === '/data' || event.path === '/investoday-proxy/data') {
    return handleGetData(event);
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API Key not configured in cloud function environment' }),
    };
  }

  // 转发 MCP 请求到 investoday
  try {
    // 解析请求体
    let requestBody = event.body;
    if (typeof requestBody === 'string') {
      try { requestBody = JSON.parse(requestBody); } catch { /* keep as string */ }
    }

    // 输入校验：entity_recognition 请求需要过滤低置信度结果
    if (requestBody?.method === 'tools/call' && 
        requestBody?.params?.name === 'entity_recognition') {
      const input = requestBody.params.arguments?.input || '';
      const trimmed = input.trim();
      const isValidCode = /^\d{6}$/.test(trimmed);
      const isChineseName = /[\u4e00-\u9fa5]/.test(trimmed);
      
      if (!isValidCode && !isChineseName && trimmed.length < 2) {
        return {
          statusCode: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: requestBody.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ entities: [] }) }] }
          }),
        };
      }
    }

    // 调用 investoday MCP
    const startTime = Date.now();
    const result = await proxyMCPRequest(requestBody);
    const latency = Date.now() - startTime;

    // 记录 API 调用日志到数据库（异步，不阻塞响应）
    logApiCall(requestBody, result, latency).catch(err => console.error('[ApiLog] failed:', err.message));

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('[Proxy Error]', error);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Proxy request failed', 
        message: error.message,
      }),
    };
  }
};

/**
 * 初始化 CloudBase app（复用）
 */
function getCloudBaseApp() {
  const cloudbase = require('@cloudbase/node-sdk');
  return cloudbase.init({});
}

async function readIndexFile(indexKey = 'searches/index.json') {
  try {
    const cos = getCOSClient();
    const result = await new Promise((resolve, reject) => {
      cos.getObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: indexKey,
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    const data = JSON.parse(result.Body.toString('utf-8'));
    return { records: Array.isArray(data) ? data : [], etag: result.ETag };
  } catch (e) {
    return { records: [], etag: null };
  }
}

async function saveIndexFile(records, expectedEtag, indexKey = 'searches/index.json') {
  const cos = getCOSClient();
  const params = {
    Bucket: COS_BUCKET,
    Region: COS_REGION,
    Key: indexKey,
    Body: Buffer.from(JSON.stringify(records)),
    ContentType: 'application/json',
  };
  if (expectedEtag) {
    params.IfMatch = expectedEtag;
  }
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * CAS 更新索引文件（带重试）
 */
async function updateIndexFile(newRecord, indexKey = 'searches/index.json', maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { records, etag } = await readIndexFile(indexKey);
      const filtered = records.filter(r => r.path !== newRecord.path);
      filtered.unshift(newRecord);
      const trimmed = filtered.slice(0, 500);
      await saveIndexFile(trimmed, etag, indexKey);
      console.log(`[Index] Updated ${indexKey}, attempt:`, attempt + 1);
      return { success: true };
    } catch (error) {
      if (error.statusCode === 412 || error.code === 'PreconditionFailed') {
        console.warn(`[Index] CAS conflict on ${indexKey}, retrying... (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to update ${indexKey} after ${maxRetries} retries`);
}

/**
 * 处理查询记录上传：上传 COS + 更新索引文件
 */
async function handleUploadRecord(event) {
  try {
    let body = event.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {
        return {
          statusCode: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
      }
    }

    const { filename, data } = body || {};

    if (!filename || !data) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing filename or data' }),
      };
    }

    // 校验文件名格式：允许 searches/YYYY-MM-DD/*.json 或 reports/YYYY-MM-DD/*.json
    const isSearch = /^searches\/\d{4}-\d{2}-\d{2}\/[^\/]+\.json$/.test(filename);
    const isReport = /^reports\/\d{4}-\d{2}-\d{2}\/[^\/]+\.json$/.test(filename);
    if (!isSearch && !isReport) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid filename format. Expected searches/YYYY-MM-DD/*.json or reports/YYYY-MM-DD/*.json' }),
      };
    }
    const indexKey = isSearch ? 'searches/index.json' : 'reports/index.json';

    // 校验数据大小（不超过 50KB）
    const dataStr = JSON.stringify(data);
    if (Buffer.byteLength(dataStr) > 50 * 1024) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Data too large (max 50KB)' }),
      };
    }

    const app = getCloudBaseApp();

    // 1. 上传文件到云存储（COS）
    const uploadResult = await app.uploadFile({
      cloudPath: filename,
      fileContent: Buffer.from(dataStr),
    });

    // 2. CAS 更新索引文件（防止并发覆盖）
    const dateMatch = filename.match(/^(searches|reports)\/(\d{4}-\d{2}-\d{2})\/(.+)\.json$/);
    const newRecord = {
      query: data.query,
      results: data.results || [],
      timestamp: data.timestamp || new Date().toISOString(),
      source: data.source || 'web',
      path: filename,
      fileID: uploadResult.fileID,
      date: dateMatch ? dateMatch[2] : '',
      name: dateMatch ? dateMatch[3].replace(/_/g, ' ') : filename,
      size: Buffer.byteLength(dataStr),
    };
    // 报告类型额外保存摘要信息
    if (isReport && data.stock) {
      newRecord.stock = data.stock;
      newRecord.sections = data.sections ? {
        coreView: {
          rating: data.sections.coreView?.rating,
          ratingLabel: data.sections.coreView?.ratingLabel,
          oneSentenceSummary: data.sections.coreView?.oneSentenceSummary,
        },
        keyMetricsSummary: data.sections.keyMetrics ? {
          valuation: data.sections.keyMetrics.valuation?.map(m => ({ label: m.label, value: m.value })),
          profitability: data.sections.keyMetrics.profitability?.map(m => ({ label: m.label, value: m.value })),
          growth: data.sections.keyMetrics.growth?.map(m => ({ label: m.label, value: m.value })),
        } : undefined,
      } : undefined;
    }
    await updateIndexFile(newRecord, indexKey);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, fileID: uploadResult.fileID }),
    };
  } catch (error) {
    console.error('[UploadRecord Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upload failed', message: error.message }),
    };
  }
}

/**
 * 处理查询记录列表（读取索引文件）
 */
async function handleListRecords(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const type = query.type || 'search'; // 'search' | 'report'
    const indexKey = type === 'report' ? 'reports/index.json' : 'searches/index.json';
    const { records } = await readIndexFile(indexKey);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, records, total: records.length, type }),
    };
  } catch (error) {
    console.error('[ListRecords Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'List records failed', message: error.message }),
    };
  }
}

/**
 * 重建索引：扫描 COS 中指定前缀下的文件，重建 index.json
 */
async function handleRebuildIndex(event, type = 'searches') {
  try {
    const cos = getCOSClient();
    const prefix = type + '/';
    const indexKey = type + '/index.json';

    // 1. 列出所有文件
    const allFiles = [];
    let marker = null;

    do {
      const result = await new Promise((resolve, reject) => {
        cos.getBucket({
          Bucket: COS_BUCKET,
          Region: COS_REGION,
          Prefix: prefix,
          MaxKeys: 1000,
          Marker: marker,
        }, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      const contents = result.Contents || [];
      for (const item of contents) {
        if (item.Key !== indexKey && item.Key.endsWith('.json')) {
          allFiles.push(item.Key);
        }
      }
      marker = result.IsTruncated ? result.NextMarker : null;
    } while (marker);

    console.log(`[RebuildIndex] Found ${allFiles.length} files in ${prefix}`);

    // 2. 读取每个文件内容
    const records = [];
    for (const key of allFiles) {
      try {
        const result = await new Promise((resolve, reject) => {
          cos.getObject({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Key: key,
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        const content = JSON.parse(result.Body.toString('utf-8'));
        const dateMatch = key.match(new RegExp(`^${type}/(\\d{4}-\\d{2}-\\d{2})/(.+)\\.json$`));
        const record = {
          query: content.query || '',
          results: content.results || [],
          timestamp: content.timestamp || new Date().toISOString(),
          source: content.source || 'web',
          path: key,
          date: dateMatch ? dateMatch[1] : '',
          name: dateMatch ? dateMatch[2].replace(/_/g, ' ') : key,
          size: result.Body.length,
        };
        // 报告类型额外保留摘要
        if (type === 'reports' && content.stock) {
          record.stock = content.stock;
          if (content.sections?.coreView) {
            record.rating = content.sections.coreView.rating;
            record.ratingLabel = content.sections.coreView.ratingLabel;
            record.oneSentenceSummary = content.sections.coreView.oneSentenceSummary;
          }
        }
        records.push(record);
      } catch (e) {
        console.warn(`[RebuildIndex] Failed to read ${key}:`, e.message);
      }
    }

    // 3. 按时间倒序排序，去重
    const seen = new Set();
    const uniqueRecords = [];
    for (const r of records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        uniqueRecords.push(r);
      }
    }

    // 4. 写入索引
    const finalRecords = uniqueRecords.slice(0, 500);
    await saveIndexFile(finalRecords, null, indexKey);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `${type} index rebuilt: ${finalRecords.length} records`,
        scanned: allFiles.length,
        rebuilt: finalRecords.length,
      }),
    };
  } catch (error) {
    console.error('[RebuildIndex Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Rebuild failed', message: error.message }),
    };
  }
}

/**
 * 调试端点：列出所有 COS bucket 和文件
 */
async function handleDebugBuckets(event) {
  try {
    const cos = getCOSClient();
    const serviceResult = await new Promise((resolve, reject) => {
      cos.getService((err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const buckets = serviceResult.Buckets || [];
    const bucketDetails = [];

    for (const bucket of buckets) {
      try {
        const result = await new Promise((resolve, reject) => {
          cos.getBucket({
            Bucket: bucket.Name,
            Region: bucket.Location || COS_REGION,
            MaxKeys: 100,
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        bucketDetails.push({
          name: bucket.Name,
          region: bucket.Location,
          fileCount: result.Contents?.length || 0,
          keys: result.Contents?.map(c => c.Key).slice(0, 10),
        });
      } catch (e) {
        bucketDetails.push({ name: bucket.Name, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, buckets: bucketDetails }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(error) }),
    };
  }
}

/**
 * 处理查询记录详情获取（使用 CloudBase 云存储 downloadFile）
 */
async function handleGetRecord(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const path = query.path || '';

    if (!path) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing path', debug: { queryString: event.queryString, queryStringParameters: event.queryStringParameters } }),
      };
    }

    const cos = getCOSClient();
    const result = await new Promise((resolve, reject) => {
      cos.getObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: path,
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const content = JSON.parse(result.Body.toString('utf-8'));

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: content }),
    };
  } catch (error) {
    console.error('[GetRecord Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Get record failed', message: error.message }),
    };
  }
}

/**
 * Web Search 处理
 * 使用 DuckDuckGo API 或 Google Custom Search 搜索补充信息
 */
async function handleWebSearch(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const q = query.q || '';
    const stockName = query.stockName || '';
    const stockCode = query.stockCode || '';

    if (!q && !stockName) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing query parameter (q or stockName)' }),
      };
    }

    const searchQuery = q || `${stockName} ${stockCode} 最新动态`;
    
    // 尝试 DuckDuckGo API
    const result = await searchDuckDuckGo(searchQuery);
    
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        query: searchQuery,
        ...result,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('[WebSearch Error]', error);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        query: '',
        summary: 'Web search temporarily unavailable',
        sources: [],
        error: error.message,
        fetchedAt: new Date().toISOString(),
      }),
    };
  }
}

/**
 * 使用 DuckDuckGo API 搜索
 */
function searchDuckDuckGo(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&pretty=1&no_html=1&skip_disambig=1`;
    
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const abstract = parsed.Abstract || parsed.AbstractText || '';
          const relatedTopics = (parsed.RelatedTopics || []).slice(0, 5).map(t => ({
            title: t.Text || t.FirstURL || '',
            url: t.FirstURL || '',
            snippet: t.Text || '',
          })).filter(t => t.title);
          
          resolve({
            summary: abstract,
            sources: relatedTopics,
          });
        } catch {
          resolve({ summary: '', sources: [] });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('DuckDuckGo timeout'));
    });
  });
}

/**
 * 记录 API 调用日志到 CloudBase 数据库
 */
async function logApiCall(requestBody, response, latency) {
  try {
    const toolName = requestBody?.params?.name || requestBody?.method || 'unknown';
    const params = requestBody?.params?.arguments || {};
    const stockCode = params.code || params.input || params.stock_code || '';

    // 提取响应摘要（避免存储过大的响应体）
    let responseSummary = null;
    if (response?.result?.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(response.result.content[0].text);
        // 根据工具类型提取摘要
        if (Array.isArray(parsed)) {
          responseSummary = { count: parsed.length, sample: parsed[0] ? Object.keys(parsed[0]).reduce((acc, k) => { acc[k] = parsed[0][k]; return acc; }, {}) : null };
        } else if (typeof parsed === 'object') {
          responseSummary = { keys: Object.keys(parsed).slice(0, 10) };
        }
      } catch {
        responseSummary = { textLength: response.result.content[0].text.length };
      }
    }

    await db.collection(API_LOGS_COLLECTION).add({
      tool_name: toolName,
      stock_code: stockCode,
      params: params,
      latency_ms: latency,
      response_summary: responseSummary,
      response_error: response?.error ? true : false,
      source: 'investoday-proxy',
      created_at: new Date(),
    });
  } catch (err) {
    console.error('[ApiLog] log failed:', err.message);
  }
}

function proxyMCPRequest(body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const url = new URL(`https://${BASE_URL}/data/mcp/preset?apiKey=${API_KEY}`);

    const options = {
      hostname: BASE_URL,
      path: `/data/mcp/preset?apiKey=${API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}


/**
 * 获取市场指数行情（代理新浪接口）
 */
async function handleMarketIndices(event) {
  try {
    const symbols = [
      { code: 'sh000001', name: '上证指数', region: 'A股' },
      { code: 'sh000300', name: '沪深300', region: 'A股' },
      { code: 'hkHSI', name: '恒生指数', region: '港股' },
      { code: 'gb_ixic', name: '纳斯达克', region: '美股' },
      { code: 'gb_dji', name: '道琼斯', region: '美股' },
    ];

    const listParam = symbols.map(s => s.code).join(',');
    const url = `https://hq.sinajs.cn/list=${listParam}`;

    const rawText = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 8000,
        headers: {
          'Referer': 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 新浪财经返回 GBK/GB2312 编码，需要转码
          const text = Iconv.decode(buf, 'gb2312');
          resolve(text);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Sina timeout')); });
    });

    const indices = [];
    for (const s of symbols) {
      const match = rawText.match(new RegExp(`var hq_str_${s.code}="([^"]*)";`));
      if (!match || !match[1]) {
        indices.push({ ...s, price: 0, change: 0, changePercent: 0, status: 'unavailable' });
        continue;
      }
      const parts = match[1].split(',');
      let price = 0, prevClose = 0, change = 0, changePercent = 0;

      if (s.code.startsWith('sh') || s.code.startsWith('sz')) {
        // A股指数: 名称,昨日收盘,今日开盘,最新价,最高价,最低价,...
        prevClose = parseFloat(parts[1]) || 0;
        price = parseFloat(parts[3]) || prevClose;
      } else if (s.code.startsWith('hk')) {
        // 港股指数: 英文,中文,最新价,今开,最高,最低,昨收,成交量(百万),成交额(亿),...
        // e.g. HSI,恒生指数,26310.870,26393.711,26427.140,26219.260,26406.840,...
        price = parseFloat(parts[2]) || 0;
        prevClose = parseFloat(parts[6]) || 0;
      } else if (s.code.startsWith('gb')) {
        // 美股指数: 名称,最新价,涨跌幅(%),时间,涨跌额,成交量,今开,最低,最高,...,昨收
        // e.g. 纳斯达克,26291.3502,0.17,2026-05-11 23:21:00,44.2739,...
        price = parseFloat(parts[1]) || 0;
        changePercent = parseFloat(parts[2]) || 0;
        change = parseFloat(parts[4]) || 0;
        // 美股数据已直接提供涨跌额和涨跌幅，无需计算
      }

      // A股和港股需要自行计算涨跌
      if (s.code.startsWith('sh') || s.code.startsWith('sz') || s.code.startsWith('hk')) {
        if (prevClose > 0) {
          change = price - prevClose;
          changePercent = (change / prevClose) * 100;
        }
      }

      indices.push({
        ...s,
        price: Number(price.toFixed(2)),
        change: Number(change.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        status: price > 0 ? 'ok' : 'unavailable',
      });
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, indices, updatedAt: new Date().toISOString() }),
    };
  } catch (error) {
    console.error('[MarketIndices Error]', error);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, indices: [], error: error.message }),
    };
  }
}


/**
 * 批量获取个股实时行情（新浪财经接口）
 * Query: ?symbols=600519,601398,601857
 * 返回: { success: true, quotes: [{ symbol, name, price, prevClose, change, changePercent, open, high, low, volume, updatedAt }] }
 */
async function handleStockQuotes(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const symbolsParam = query.symbols || '';
    if (!symbolsParam) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing symbols parameter' }),
      };
    }

    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    // A股上海前缀 sh，深圳前缀 sz
    const sinaCodes = symbols.map(s => {
      const code = s.replace(/\D/g, '');
      // 6开头是上证，0/3开头是深证，但我们的股票池全是6开头
      return code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`;
    });

    const url = `https://hq.sinajs.cn/list=${sinaCodes.join(',')}`;
    const rawText = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 8000,
        headers: {
          'Referer': 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 新浪财经返回 GBK/GB2312 编码，需要转码
          const text = Iconv.decode(buf, 'gb2312');
          resolve(text);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Sina timeout')); });
    });

    const quotes = [];
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const sinaCode = sinaCodes[i];
      const match = rawText.match(new RegExp(`var hq_str_${sinaCode}="([^"]*)";`));
      if (!match || !match[1]) {
        quotes.push({ symbol, price: 0, prevClose: 0, change: 0, changePercent: 0, status: 'unavailable' });
        continue;
      }
      const parts = match[1].split(',');
      // A股个股格式: 名称,今日开盘,昨日收盘,最新价,最高价,最低价,买入价,卖出价,成交量,成交额,...
      const name = parts[0] || '';
      const open = parseFloat(parts[1]) || 0;
      const prevClose = parseFloat(parts[2]) || 0;
      const price = parseFloat(parts[3]) || prevClose;
      const high = parseFloat(parts[4]) || 0;
      const low = parseFloat(parts[5]) || 0;
      const volume = parseInt(parts[8]) || 0;
      const amount = parseFloat(parts[9]) || 0;

      const change = price - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

      quotes.push({
        symbol,
        name,
        price: Number(price.toFixed(2)),
        prevClose: Number(prevClose.toFixed(2)),
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        change: Number(change.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        volume,
        amount: Number(amount.toFixed(2)),
        status: price > 0 ? 'ok' : 'unavailable',
      });
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, quotes, updatedAt: new Date().toISOString() }),
    };
  } catch (error) {
    console.error('[StockQuotes Error]', error);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, quotes: [], error: error.message }),
    };
  }
}


// ========== 我的收藏（CloudBase 文档数据库）==========

/**
 * 获取收藏列表
 */
async function handleGetFavorites(event) {
  try {
    const collection = db.collection(FAVORITES_COLLECTION);
    const result = await collection
      .where({ userId: DEFAULT_USER_ID })
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, favorites: result.data || [] }),
    };
  } catch (error) {
    console.error('[GetFavorites Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

/**
 * 查询 API 调用日志列表
 */
async function handleListApiLogs(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const page = parseInt(query.page, 10) || 1;
    const pageSize = Math.min(parseInt(query.pageSize, 10) || 50, 100);
    const stockCode = query.stockCode || '';
    const toolName = query.toolName || '';

    let dbQuery = db.collection(API_LOGS_COLLECTION);

    if (stockCode) {
      dbQuery = dbQuery.where({ stock_code: stockCode });
    }
    if (toolName) {
      dbQuery = dbQuery.where({ tool_name: toolName });
    }

    const countRes = await dbQuery.count();
    const total = countRes.total || 0;

    const res = await dbQuery.orderBy('created_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get();
    const records = res.data || [];

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        records: records.map(r => ({
          id: r._id,
          tool_name: r.tool_name,
          stock_code: r.stock_code,
          params: r.params,
          latency_ms: r.latency_ms,
          response_summary: r.response_summary,
          response_error: r.response_error,
          created_at: r.created_at,
        })),
        pagination: { page, pageSize, total },
      }),
    };
  } catch (error) {
    console.error('[ListApiLogs Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to list api logs', message: error.message }),
    };
  }
}

/**
 * 添加收藏
 */
async function handleAddFavorite(event) {
  try {
    let body = event.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const { code, name, industry, exchange, marketCap } = body;
    if (!code || !name) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Missing code or name' }),
      };
    }

    const collection = db.collection(FAVORITES_COLLECTION);

    // 检查是否已存在
    const existing = await collection.where({ userId: DEFAULT_USER_ID, code }).get();
    if (existing.data && existing.data.length > 0) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, added: false, message: 'Already exists' }),
      };
    }

    // 检查数量上限
    const count = await collection.where({ userId: DEFAULT_USER_ID }).count();
    if (count.total >= 10) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Max 10 favorites reached' }),
      };
    }

    await collection.add({
      userId: DEFAULT_USER_ID,
      code,
      name,
      industry: industry || '',
      exchange: exchange || '',
      marketCap: marketCap || 0,
      createdAt: new Date(),
    });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, added: true }),
    };
  } catch (error) {
    console.error('[AddFavorite Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

/**
 * 移除收藏
 */
async function handleRemoveFavorite(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const code = query.code;
    if (!code) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Missing code parameter' }),
      };
    }

    const collection = db.collection(FAVORITES_COLLECTION);
    await collection.where({ userId: DEFAULT_USER_ID, code }).remove();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('[RemoveFavorite Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}


/**
 * 占卜师 - 基于历史数据计算涨跌概率
 */
async function handleFortune(event) {
  // 占卜师模块已迁移到策略重建实验室
  // 请访问 /strategyRebuild 页面查看基于机器学习回归模型的5日预测
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      stocks: [],
      message: '占卜师模块已迁移到策略重建实验室。请访问策略重建页面查看基于 Ridge+GBR 集成回归模型的 5 日预测及 Walk-Forward 回测结果。',
    }),
  };
}

// 旧版占卜师实现已废弃，保留代码以供参考：
/*
async function handleFortuneLegacy(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const codesStr = query.codes || '';
    const codes = codesStr.split(',').filter(Boolean);

    if (codes.length === 0) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, stocks: [] }),
      };
    }

    const stocks = [];
    const endDate = new Date();
    const beginDate = new Date();
    beginDate.setDate(endDate.getDate() - 40);
    const beginStr = beginDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // 获取隔夜美股数据（一次即可，所有股票共用）
    const usMarketData = await fetchUSMarketData();

    for (const code of codes) {
      try {
        const [quoteRes, historyRes] = await Promise.all([
          proxyMCPRequest({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: 'get_stock_quote_realtime', arguments: { stockCode: code } },
          }),
          proxyMCPRequest({
            jsonrpc: '2.0',
            id: Date.now() + 1,
            method: 'tools/call',
            params: {
              name: 'list_stock_adjusted_quotes',
              arguments: { stockCode: code, beginDate: beginStr, endDate: endStr },
            },
          }),
        ]);

        let quote = null;
        if (quoteRes.result && !quoteRes.result.isError) {
          const text = quoteRes.result.content?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.code === 'Success' && parsed.data) quote = parsed.data;
          }
        }

        let history = [];
        if (historyRes.result && !historyRes.result.isError) {
          const text = historyRes.result.content?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            history = parsed.data || [];
          }
        }

        const fortune = calculateFortune(quote, history, usMarketData);
        stocks.push({ ...fortune, code });
      } catch (e) {
        console.warn(`[Fortune] Failed for ${code}:`, e.message);
        stocks.push({
          code,
          name: code,
          price: 0,
          change: 0,
          changePercent: 0,
          upProbability: 33,
          neutralProbability: 34,
          downProbability: 33,
          historyTrend: '震荡',
          recentDays: [],
          status: 'error',
        });
      }
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, stocks }),
    };
  } catch (error) {
    console.error('[Fortune Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

/**
 * 计算涨跌概率（增强版 AI 预测）
 */
/**
 * 获取隔夜美股实时数据（新浪财经）
 */
async function fetchUSMarketData() {
  try {
    const https = require('https');
    const url = 'https://hq.sinajs.cn/list=gb_ixic,gb_dji,gb_inx,gb_hxc';
    
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } }, (res) => {
        let chunks = '';
        res.on('data', chunk => chunks += chunk);
        res.on('end', () => resolve(chunks));
        res.on('error', reject);
      }).on('error', reject);
    });

    // 解析新浪返回的 JS 变量
    const result = { nasdaq: 0, dow: 0, sp500: 0, chinaDragon: 0 };
    const matches = data.matchAll(/var hq_str_gb_(\w+)="([^"]+)"/g);
    for (const m of matches) {
      const code = m[1];
      const parts = m[2].split(',');
      if (parts.length >= 2) {
        const close = parseFloat(parts[1]) || 0;
        const prevClose = parseFloat(parts[26]) || close;
        const chg = prevClose > 0 ? ((close - prevClose) / prevClose * 100) : 0;
        if (code === 'ixic') result.nasdaq = Number(chg.toFixed(2));
        if (code === 'dji') result.dow = Number(chg.toFixed(2));
        if (code === 'inx') result.sp500 = Number(chg.toFixed(2));
        if (code === 'hxc') result.chinaDragon = Number(chg.toFixed(2));
      }
    }
    return result;
  } catch (e) {
    console.warn('[USMarket] fetch failed:', e.message);
    return { nasdaq: 0, dow: 0, sp500: 0, chinaDragon: 0 };
  }
}

/**
 * 计算美股综合评分 (0-100)
 */
function calculateUSScore(usData) {
  if (!usData) return 50;
  // 默认权重
  const weights = { nasdaq: 0.30, dow: 0.25, sp500: 0.25, chinaDragon: 0.20 };
  let score = 50;
  for (const [key, w] of Object.entries(weights)) {
    score += (usData[key] || 0) * w * 3;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateFortune(quote, history, usMarketData = null) {
  const price = quote ? quote.currentPrice : 0;
  const change = quote ? Number((quote.currentPrice - quote.closePriceYDay).toFixed(2)) : 0;
  const changePercent = quote ? Number((quote.changeRatio * 100).toFixed(2)) : 0;
  const name = quote ? quote.stockName : '';

  // 兼容大小写不同的字段名
  const normalize = (h) => ({
    close: h.closePrice || h.CLOSEPRICE || h.close || 0,
    open: h.openPrice || h.OPENPRICE || h.open || 0,
    high: h.highPrice || h.HIGHPRICE || h.high || 0,
    low: h.lowPrice || h.LOWPRICE || h.low || 0,
    volume: h.volume || h.DEALSTOCKAMOUNT || h.dealStockAmount || 0,
    time: h.tradeDate || h.QUOTETIME || h.quotetime || h.date || h.time || '',
  });

  const normalized = history.map(normalize);
  const validHistory = normalized
    .filter((h) => h.close > 0 && h.time)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  // 调试：如果历史数据为空，记录原因
  if (validHistory.length === 0 && history.length > 0) {
    console.warn('[Fortune] history has', history.length, 'items but none valid. First item keys:', Object.keys(history[0]), 'sample:', JSON.stringify(history[0]).slice(0, 200));
  }

  const dailyChanges = [];
  for (let i = 1; i < validHistory.length; i++) {
    const prev = validHistory[i - 1].close;
    const curr = validHistory[i].close;
    dailyChanges.push(Number(((curr - prev) / prev * 100).toFixed(2)));
  }

  const recentDays = validHistory.slice(-10).map((h, idx) => ({
    date: h.time?.split(' ')[0] || '',
    change: dailyChanges[Math.max(0, validHistory.indexOf(h) - 1)] || 0,
  }));

  // ========== 多因子评分系统 ==========
  let trendScore = 50;      // 趋势分 (0-100)
  let momentumScore = 50;   // 动量分 (0-100)
  let volumeScore = 50;     // 量能分 (0-100)
  let techScore = 50;       // 技术分 (0-100)

  if (validHistory.length >= 20) {
    const closes = validHistory.map((h) => h.close);
    const volumes = validHistory.map((h) => h.volume || 0);

    // --- 趋势分：均线排列 ---
    const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (ma5 > ma10 && ma10 > ma20) trendScore = 85;
    else if (ma5 > ma10) trendScore = 65;
    else if (ma5 < ma10 && ma10 < ma20) trendScore = 15;
    else if (ma5 < ma10) trendScore = 35;
    else trendScore = 50;

    // --- 动量分：近期涨幅 + 今日 momentum ---
    const recent5Change = dailyChanges.slice(-5).reduce((a, b) => a + b, 0);
    momentumScore = Math.min(100, Math.max(0, 50 + recent5Change * 3 + changePercent * 0.5));

    // --- 量能分：成交量放大 + 量价配合 ---
    const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-5).length);
    const vol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-10).length);
    const volRatio = vol10 > 0 ? vol5 / vol10 : 1;
    // 量价配合：涨时放量加分，跌时放量减分
    if (changePercent > 0 && volRatio > 1.1) volumeScore = 75;
    else if (changePercent > 0 && volRatio < 0.9) volumeScore = 55;
    else if (changePercent < 0 && volRatio > 1.1) volumeScore = 25;
    else if (changePercent < 0 && volRatio < 0.9) volumeScore = 45;
    else volumeScore = 50;

    // --- 技术分：RSI 简化 + 近期涨跌比 ---
    const gains = dailyChanges.filter((c) => c > 0);
    const losses = dailyChanges.filter((c) => c < 0);
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0.001;
    const rsi = 100 - (100 / (1 + avgGain / avgLoss));
    techScore = Math.min(100, Math.max(0, rsi));
  }

  // 美股因子评分
  const usScore = calculateUSScore(usMarketData);

  // 综合预测（五因子）
  const weights = { trend: 0.22, momentum: 0.22, volume: 0.18, tech: 0.25, usMarket: 0.13 };
  const compositeScore = trendScore * weights.trend + momentumScore * weights.momentum +
                         volumeScore * weights.volume + techScore * weights.tech +
                         usScore * weights.usMarket;

  let upProb = Math.round(compositeScore);
  let downProb = 100 - upProb;
  let neutralProb = 0;
  let prediction = upProb > 55 ? '涨' : downProb > 55 ? '跌' : '平';
  let confidence = Math.round(Math.abs(upProb - 50) * 2);
  let trend = '震荡';

  if (upProb > 60) trend = '上涨';
  else if (downProb > 60) trend = '下跌';

  if (dailyChanges.length >= 5) {
    const avg5 = dailyChanges.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avg10 = dailyChanges.slice(-10).reduce((a, b) => a + b, 0) / 10;
    if (avg5 > 0.5 && avg10 > 0) trend = '上涨';
    else if (avg5 < -0.5 && avg10 < 0) trend = '下跌';
  }

  return {
    name,
    price,
    change,
    changePercent,
    prediction,
    upProbability: upProb,
    downProbability: downProb,
    neutralProbability: neutralProb,
    confidence,
    historyTrend: trend,
    factorScores: {
      trend: Math.round(trendScore),
      momentum: Math.round(momentumScore),
      volume: Math.round(volumeScore),
      technical: Math.round(techScore),
      usMarket: usScore,
    },
    usMarketDetail: usMarketData || { nasdaq: 0, dow: 0, sp500: 0, chinaDragon: 0 },
    recentDays,
    status: 'ok',

  };
}


/**
 * 板块资金流向热力图 - 代理东方财富API
 */
async function handleSectorFundFlow(event) {
  try {
    function parseNum(v) {
      if (v == null || v === '-' || v === '') return 0;
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    }

    function parseItem(item) {
      return {
        code: item.f12 || '',
        name: item.f14 || '',
        changePercent: parseNum(item.f3),
        netInflow: parseNum(item.f62),
        netInflowPercent: parseNum(item.f184),
      };
    }

    async function fetchPage(po) {
      const url = 'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=' + po + '&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62,f184&_t=' + Date.now();
      return new Promise((resolve, reject) => {
        const req = https.get(url, {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://quote.eastmoney.com/',
          },
        }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error('Parse error'));
            }
          });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });
    }

    // 并行请求：po=1 降序(流入最多) + po=0 升序(流出最多)
    const [descData, ascData] = await Promise.all([fetchPage(1), fetchPage(0)]);

    const inflow = (descData.data?.diff || [])
      .map(parseItem)
      .filter((s) => s.code && s.name && s.netInflow > 0)
      .slice(0, 15);

    const outflow = (ascData.data?.diff || [])
      .map(parseItem)
      .filter((s) => s.code && s.name && s.netInflow < 0)
      .slice(0, 15);

    const sectors = [...inflow, ...outflow];

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, sectors }),
    };
  } catch (error) {
    console.error('[SectorFundFlow Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}


// ==================== 热门个股扫描 ====================

async function handleHotStocks(event) {
  try {
    const query = event.queryString || {};
    const parsedLimit = parseInt(query.limit || '30', 10);
    const limit = Math.min(Number.isNaN(parsedLimit) ? 30 : parsedLimit, 50);
    const market = query.market || 'all'; // all | cyb (创业板)

    // 构建 fs 参数
    let fsParam = 'm:0+t:6,m:0+t:13,m:1+t:2,m:1+t:23'; // 全A股
    if (market === 'cyb') {
      fsParam = 'm:0+t:13'; // 仅创业板
    }

    const url = 'https://push2delay.eastmoney.com/api/qt/clist/get'
      + '?pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f3'
      + '&fs=' + encodeURIComponent(fsParam)
      + '&fields=f12,f14,f3,f5,f6,f8,f10,f15,f16,f17,f18,f20,f21'
      + '&_t=' + Date.now();

    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://quote.eastmoney.com/',
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Parse error')); }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });

    const rawList = (data.data?.diff || []);

    const stocks = rawList.map((item) => ({
      code: String(item.f12 || ''),
      name: String(item.f14 || ''),
      changePercent: item.f3 == null || item.f3 === '-' ? 0 : Number(item.f3),
      volume: item.f5 == null || item.f5 === '-' ? 0 : Number(item.f5),
      turnover: item.f6 == null || item.f6 === '-' ? 0 : Number(item.f6),
      turnoverRate: item.f8 == null || item.f8 === '-' ? 0 : Number(item.f8),
      volumeRatio: item.f10 == null || item.f10 === '-' ? 0 : Number(item.f10),
      high: item.f15 == null || item.f15 === '-' ? 0 : Number(item.f15),
      low: item.f16 == null || item.f16 === '-' ? 0 : Number(item.f16),
      open: item.f17 == null || item.f17 === '-' ? 0 : Number(item.f17),
      preClose: item.f18 == null || item.f18 === '-' ? 0 : Number(item.f18),
      totalValue: item.f20 == null || item.f20 === '-' ? 0 : Number(item.f20),
      floatValue: item.f21 == null || item.f21 === '-' ? 0 : Number(item.f21),
    })).filter((s) => {
      // 过滤条件
      if (!s.code || !s.name) return false;
      // 排除 ST / *ST / 退市 / 新股(N) / 次新股(C)
      if (/[ST退]|^[NC]/.test(s.name)) return false;
      // 排除停牌（无涨跌幅）
      if (s.changePercent === 0 && s.volume === 0) return false;
      // 排除北交所(8/9开头4位)、新三板(4开头)、B股
      const first = s.code.charAt(0);
      if (first === '8' || first === '9' || first === '4') return false;
      return true;
    }).slice(0, limit);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, market, total: stocks.length, stocks }),
    };
  } catch (error) {
    console.error('[HotStocks Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}


// ==================== Investoday-free data proxies ====================

function toTencentCode(symbol) {
  const code = String(symbol || '').replace(/^(sh|sz|hk)/, '');
  if (code.startsWith('6') || code.startsWith('5')) return `sh${code}`;
  return `sz${code}`;
}

function toEastmoneyCode(symbol) {
  const code = String(symbol || '').replace(/^(sh|sz|hk)/, '');
  if (code.startsWith('6') || code.startsWith('5')) return `1.${code}`;
  return `0.${code}`;
}

async function fetchTencentHistory(code, days = 90) {
  const tcode = toTencentCode(code);
  const end = new Date();
  const begin = new Date();
  begin.setDate(begin.getDate() - days - 60);
  const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcode},day,${begin.toISOString().split('T')[0]},${end.toISOString().split('T')[0]},640,qfq`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const dayData = data.data?.[tcode]?.day || [];
          if (!dayData.length) {
            // try alternate key format
            for (const k of Object.keys(data.data || {})) {
              if (data.data[k]?.day) {
                resolve(data.data[k].day);
                return;
              }
            }
          }
          resolve(dayData);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchInvestodayHistory(code, days) {
  if (!API_KEY) return null;
  const end = new Date().toISOString().split('T')[0];
  const beginObj = new Date();
  beginObj.setDate(beginObj.getDate() - days);
  const begin = beginObj.toISOString().split('T')[0];
  const result = await proxyMCPRequest({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'list_stock_adjusted_quotes',
      arguments: { stockCode: code, beginDate: begin, endDate: end },
    },
  });
  const text = result?.result?.content?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed.code !== 'Success' && parsed.code !== 0 && parsed.code !== '0') return null;
  const arr = Array.isArray(parsed.data) ? parsed.data : parsed.data?.data;
  if (!Array.isArray(arr)) return null;
  return arr;
}

function isInvestodayResourceError(result) {
  if (!result) return true;
  if (result.error) return true;
  const text = result?.result?.content?.[0]?.text;
  if (!text) return true;
  try {
    const parsed = JSON.parse(text);
    if (parsed.message && parsed.message.includes('资源包')) return true;
    if (parsed.code && parsed.code !== 'Success' && parsed.code !== 0 && parsed.code !== '0') return true;
  } catch { /* ignore */ }
  return false;
}

async function handleStockHistory(event) {
  try {
    const query = event.queryString || {};
    const code = query.code;
    const days = Math.min(parseInt(query.days || '90', 10), 365);
    if (!code || !/^\d{6}$/.test(code)) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid code' }) };
    }

    let source = 'investoday';
    let rows = null;

    if (API_KEY) {
      try {
        const inv = await fetchInvestodayHistory(code, days);
        if (inv && inv.length >= 30) rows = inv;
      } catch (e) {
        console.warn('[StockHistory] Investoday failed:', e.message);
      }
    }

    if (!rows || rows.length < 30) {
      try {
        const tencentRows = await fetchTencentHistory(code, days);
        if (tencentRows && tencentRows.length >= 30) {
          // Tencent format: [date, open, close, low, high, volume]
          rows = tencentRows.map((r) => ({
            stockCode: code,
            stockName: '',
            tradeDate: r[0],
            prevClosePrice: 0,
            openPrice: Number(r[1]),
            highPrice: Number(r[4]),
            lowPrice: Number(r[3]),
            closePrice: Number(r[2]),
            volume: Number(r[5]),
            amount: 0,
            turnover: 0,
            marketCapFloat: 0,
            marketCap: 0,
            changePct: 0,
            peTtm: 0,
            pb: 0,
          }));
          source = 'tencent';
        }
      } catch (e) {
        console.warn('[StockHistory] Tencent failed:', e.message);
      }
    }

    if (!rows || rows.length < 30) {
      return { statusCode: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No usable history source available' }) };
    }

    // sort by date ascending and trim to requested window
    rows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const filtered = rows.filter((r) => r.tradeDate >= cutoffStr);

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, code, source, count: filtered.length, data: filtered }) };
  } catch (error) {
    console.error('[StockHistory Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

async function fetchEastmoneyBasic(code) {
  const emCode = toEastmoneyCode(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${emCode}&fields=f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f57,f58,f60,f84,f85,f162,f163,f164,f167,f168,f169,f170,f171,f173,f177,f183,f184,f185,f186,f187,f188,f189,f190`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchInvestodayScore(code) {
  if (!API_KEY) return null;
  const result = await proxyMCPRequest({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: 'get_stock_score', arguments: { stockCode: code } },
  });
  const text = result?.result?.content?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed.code !== 'Success' && parsed.code !== 0 && parsed.code !== '0') return null;
  return parsed.data;
}

async function handleStockScoreProxy(event) {
  try {
    const query = event.queryString || {};
    const code = query.code;
    if (!code || !/^\d{6}$/.test(code)) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid code' }) };
    }

    let source = 'investoday';
    let score = await fetchInvestodayScore(code);

    if (!score) {
      // Heuristic fallback based on Eastmoney real-time + valuation fields
      source = 'heuristic';
      try {
        const em = await fetchEastmoneyBasic(code);
        const d = em?.data || {};
        const pe = d.f162 == null || d.f162 === '-' ? null : Number(d.f162);
        const pb = d.f163 == null || d.f163 === '-' ? null : Number(d.f163);
        const change = d.f170 == null || d.f170 === '-' ? 0 : Number(d.f170);
        const turnover = d.f168 == null || d.f168 === '-' ? 0 : Number(d.f168);
        const name = d.f58 || '';
        const industry = d.f20 || '';

        // Simple heuristic: lower valuation + positive momentum + liquidity = higher score
        let s = 50;
        if (pe != null && pe > 0 && pe < 30) s += 10;
        else if (pe != null && pe > 50) s -= 10;
        if (pb != null && pb > 0 && pb < 3) s += 5;
        if (change > 0 && change < 7) s += 10;
        else if (change >= 7) s += 5;
        else if (change < -3) s -= 10;
        if (turnover > 3) s += 5;
        s = Math.min(100, Math.max(20, s));

        score = {
          stockCode: code,
          stockName: name,
          score: s,
          scoreAvg: 50,
          skillScore: s,
          skillScoreAvg: 50,
          emotionScore: change > 0 ? Math.min(100, 50 + change * 3) : Math.max(20, 50 + change * 2),
          emotionScoreAvg: 50,
          financeScore: pe != null && pe > 0 && pe < 30 ? 70 : 50,
          financeScoreAvg: 50,
          industryScore: 50,
          industryScoreAvg: 50,
          idu4Lv1Id: '',
          idu4Lv1Name: '',
          idu4Lv2Id: '',
          idu4Lv2Name: '',
          idu4Lv3Id: '',
          idu4Lv3Name: industry,
        };
      } catch (e) {
        console.warn('[StockScoreProxy] Heuristic failed:', e.message);
      }
    }

    if (!score) {
      return { statusCode: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No usable score source available' }) };
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, code, source, data: score }) };
  } catch (error) {
    console.error('[StockScoreProxy Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}


async function fetchInvestodayBasicInfo(code) {
  if (!API_KEY) return null;
  const result = await proxyMCPRequest({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: 'get_stock_basic_info', arguments: { stockCode: code } },
  });
  const text = result?.result?.content?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed.code !== 'Success' && parsed.code !== 0 && parsed.code !== '0') return null;
  return parsed.data;
}

async function handleStockBasicInfo(event) {
  try {
    const query = event.queryString || {};
    const code = query.code;
    if (!code || !/^\d{6}$/.test(code)) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid code' }) };
    }

    let source = 'investoday';
    let data = await fetchInvestodayBasicInfo(code);

    if (!data) {
      source = 'eastmoney';
      try {
        const em = await fetchEastmoneyBasic(code);
        const d = em?.data || {};
        data = {
          STOCKCODE: code,
          EXCHANGECODE: code.startsWith('6') || code.startsWith('5') ? 'SH' : 'SZ',
          BOARDNAME: '',
          STOCKNAME: d.f58 || '',
          STOCKFULLNAME: d.f58 || '',
          LISTSTATUS: '',
          LISTDATE: '',
          STOCKTYPE: '',
          COMPANYID: '',
          SHARESTOTAL: d.f84 || 0,
          SHARESFLOAT: d.f85 || 0,
          OFFICEADDRESS: '',
          MAINBUSINESS: d.f20 || '',
          REPORTDATE: '',
        };
      } catch (e) {
        console.warn('[StockBasicInfo] Eastmoney failed:', e.message);
      }
    }

    if (!data) {
      return { statusCode: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No usable basic info source available' }) };
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, code, source, data }) };
  } catch (error) {
    console.error('[StockBasicInfo Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

async function fetchInvestodayValuation(code) {
  if (!API_KEY) return null;
  const result = await proxyMCPRequest({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: 'get_stock_finance_valuation', arguments: { stockCode: code } },
  });
  const text = result?.result?.content?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed.code !== 'Success' && parsed.code !== 0 && parsed.code !== '0') return null;
  return parsed.data;
}

async function handleStockValuation(event) {
  try {
    const query = event.queryString || {};
    const code = query.code;
    if (!code || !/^\d{6}$/.test(code)) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid code' }) };
    }

    let source = 'investoday';
    let data = await fetchInvestodayValuation(code);

    if (!data) {
      source = 'eastmoney';
      try {
        const em = await fetchEastmoneyBasic(code);
        const d = em?.data || {};
        data = {
          stockCode: code,
          stockName: d.f58 || '',
          f2250: d.f162 == null || d.f162 === '-' ? '0' : String(d.f162), // PE
          f2260: d.f163 == null || d.f163 === '-' ? '0' : String(d.f163), // PB
          f2270: '0', // PS
          f2280: '0', // EV/EBITDA
          f2290: '0', // 股息率
        };
      } catch (e) {
        console.warn('[StockValuation] Eastmoney failed:', e.message);
      }
    }

    if (!data) {
      return { statusCode: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'No usable valuation source available' }) };
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, code, source, data }) };
  } catch (error) {
    console.error('[StockValuation Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}


// ==================== 预测记录系统 ====================

function getDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().split('T')[0];
}

async function savePredictionFile(key, data) {
  const cos = getCOSClient();
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET, Region: COS_REGION, Key: key,
      Body: Buffer.from(JSON.stringify(data, null, 2)),
      ContentType: 'application/json',
    }, (err, data) => { if (err) reject(err); else resolve(data); });
  });
}

async function readPredictionFile(key) {
  try {
    const cos = getCOSClient();
    const result = await new Promise((resolve, reject) => {
      cos.getObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err, data) => {
        if (err) reject(err); else resolve(data);
      });
    });
    return JSON.parse(result.Body.toString('utf-8'));
  } catch (e) { return null; }
}

/**
 * 保存预测记录（本地模型 + 云模型）到 predict 集合
 */
async function handleSavePrediction(event) {
  try {
    let body = event.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid JSON body' }) };
      }
    }

    const {
      stockCode, stockName, predictDate,
      localModel, cloudModel,
      priceAtPredict, changePercentAtPredict,
    } = body || {};

    if (!stockCode || !predictDate) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing stockCode or predictDate' }) };
    }

    const collection = db.collection(PREDICT_COLLECTION);

    // 检查是否已存在同日期记录，存在则更新，不存在则新增
    const existing = await collection.where({ stockCode, predictDate }).get();
    const record = {
      stockCode,
      stockName: stockName || stockCode,
      predictDate,
      localModel: localModel || {},
      cloudModel: cloudModel || {},
      priceAtPredict: priceAtPredict || 0,
      changePercentAtPredict: changePercentAtPredict || 0,
      verified: false,
      actualResult: null,
      actualChangePercent: null,
      actualClosePrice: null,
      localCorrect: null,
      cloudCorrect: null,
      createdAt: new Date(),
      verifiedAt: null,
    };

    if (existing.data && existing.data.length > 0) {
      const docId = existing.data[0]._id;
      await collection.doc(docId).update(record);
    } else {
      await collection.add(record);
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Prediction saved' }) };
  } catch (error) {
    console.error('[SavePrediction Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

/**
 * 每日定时预测 — 对收藏股票做预测并保存到 predict 集合
 */
async function handleDailyPredict(event) {
  try {
    const favRes = await db.collection(FAVORITES_COLLECTION)
      .where({ userId: DEFAULT_USER_ID })
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    const favorites = favRes.data || [];
    if (favorites.length === 0) {
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'No favorites', predictions: [] }) };
    }

    const dateStr = getDateStr(0);
    const predictions = [];

    // 获取隔夜美股数据（一次即可，所有股票共用）
    const usMarketData = await fetchUSMarketData();

    for (const fav of favorites) {
      try {
        const [quoteRes, historyRes] = await Promise.all([
          proxyMCPRequest({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
            params: { name: 'get_stock_quote_realtime', arguments: { stockCode: fav.code } },
          }),
          proxyMCPRequest({ jsonrpc: '2.0', id: Date.now() + 1, method: 'tools/call',
            params: { name: 'list_stock_adjusted_quotes', arguments: { stockCode: fav.code, beginDate: getDateStr(40), endDate: getDateStr(0) } },
          }),
        ]);

        let quote = null;
        if (quoteRes.result && !quoteRes.result.isError) {
          const text = quoteRes.result.content?.[0]?.text;
          if (text) { const parsed = JSON.parse(text); if (parsed.code === 'Success' && parsed.data) quote = parsed.data; }
        }
        let history = [];
        if (historyRes.result && !historyRes.result.isError) {
          const text = historyRes.result.content?.[0]?.text;
          if (text) { const parsed = JSON.parse(text); history = parsed.data || []; }
        }

        const fortune = calculateFortune(quote, history, usMarketData);
        const priceAtPredict = fortune.price || (quote ? quote.closePriceYDay : 0) || 0;

        const record = {
          stockCode: fav.code,
          stockName: fav.name || fortune.name || fav.code,
          predictDate: dateStr,
          localModel: {
            prediction: fortune.prediction,
            upProbability: fortune.upProbability,
            downProbability: fortune.downProbability,
            confidence: fortune.confidence,
          },
          cloudModel: {
            prediction: fortune.prediction,
            upProbability: fortune.upProbability,
            downProbability: fortune.downProbability,
            confidence: fortune.confidence,
            factorScores: fortune.factorScores,
          },
          priceAtPredict,
          changePercentAtPredict: fortune.changePercent,
          verified: false,
          actualResult: null,
          actualChangePercent: null,
          actualClosePrice: null,
          localCorrect: null,
          cloudCorrect: null,
          createdAt: new Date(),
          verifiedAt: null,
        };

        const collection = db.collection(PREDICT_COLLECTION);
        const existing = await collection.where({ stockCode: fav.code, predictDate: dateStr }).get();
        if (existing.data && existing.data.length > 0) {
          await collection.doc(existing.data[0]._id).update(record);
        } else {
          await collection.add(record);
        }

        predictions.push(record);
      } catch (e) {
        console.warn(`[DailyPredict] Failed for ${fav.code}:`, e.message);
      }
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, count: predictions.length, predictions }) };
  } catch (error) {
    console.error('[DailyPredict Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

/**
 * 每日15:35收盘后验证 — 获取实际收盘价回填 predict 集合
 */
async function handleDailyVerify(event) {
  try {
    const collection = db.collection(PREDICT_COLLECTION);
    const unverifiedRes = await collection.where({ verified: false }).get();
    const unverified = unverifiedRes.data || [];

    if (unverified.length === 0) {
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'No unverified predictions', updated: 0 }) };
    }

    const updated = [];
    for (const doc of unverified) {
      try {
        // 获取实时行情（即当天收盘价）
        const quoteRes = await proxyMCPRequest({
          jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name: 'get_stock_quote_realtime', arguments: { stockCode: doc.stockCode } },
        });

        let quote = null;
        if (quoteRes.result && !quoteRes.result.isError) {
          const text = quoteRes.result.content?.[0]?.text;
          if (text) { const parsed = JSON.parse(text); if (parsed.code === 'Success' && parsed.data) quote = parsed.data; }
        }

        if (!quote || quote.currentPrice <= 0) continue;

        const actualClose = quote.currentPrice;
        const prevClose = doc.priceAtPredict || quote.closePriceYDay || actualClose;
        const actualChangePct = prevClose > 0 ? Number(((actualClose - prevClose) / prevClose * 100).toFixed(2)) : 0;
        const actualResult = actualChangePct > 0 ? '涨' : actualChangePct < 0 ? '跌' : '平';

        const localCorrect = doc.localModel?.prediction === actualResult;
        const cloudCorrect = doc.cloudModel?.prediction === actualResult;

        await collection.doc(doc._id).update({
          actualClosePrice: actualClose,
          actualChangePercent: actualChangePct,
          actualResult,
          verified: true,
          localCorrect,
          cloudCorrect,
          verifiedAt: new Date(),
        });

        updated.push({ stockCode: doc.stockCode, predictDate: doc.predictDate, actualResult, actualChangePercent: actualChangePct, localCorrect, cloudCorrect });
      } catch (e) {
        console.warn(`[DailyVerify] Failed for ${doc.stockCode}:`, e.message);
      }
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, updated: updated.length, results: updated }) };
  } catch (error) {
    console.error('[DailyVerify Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

/**
 * 获取预测记录列表（从 predict 集合）
 */
async function handleListPredictions(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const collection = db.collection(PREDICT_COLLECTION);

    let dbQuery = collection;
    if (query.stockCode) {
      dbQuery = dbQuery.where({ stockCode: query.stockCode });
    }
    if (query.date) {
      dbQuery = dbQuery.where({ predictDate: query.date });
    }

    const res = await dbQuery.orderBy('predictDate', 'desc').get();
    let records = res.data || [];

    // 分页
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '20', 10);
    const start = (page - 1) * pageSize;
    const paginated = records.slice(start, start + pageSize);

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, total: records.length, page, pageSize, records: paginated }) };
  } catch (error) {
    console.error('[ListPredictions Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}

/**
 * 获取预测统计（从 predict 集合）
 */
async function handlePredictionStats(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const collection = db.collection(PREDICT_COLLECTION);
    let dbQuery = collection;
    if (query.stockCode) {
      dbQuery = dbQuery.where({ stockCode: query.stockCode });
    }

    const res = await dbQuery.orderBy('predictDate', 'desc').get();
    const records = res.data || [];

    const verified = records.filter((r) => r.verified);
    const localCorrect = verified.filter((r) => r.localCorrect);
    const cloudCorrect = verified.filter((r) => r.cloudCorrect);

    const upPredictions = verified.filter((r) => r.localModel?.prediction === '涨');
    const upCorrect = upPredictions.filter((r) => r.actualResult === '涨');
    const downPredictions = verified.filter((r) => r.localModel?.prediction === '跌');
    const downCorrect = downPredictions.filter((r) => r.actualResult === '跌');

    // 最近7天趋势
    const last7Days = [...new Set(records.map((r) => r.predictDate).sort().slice(-7))];
    const dailyStats = last7Days.map((date) => {
      const dayRecs = verified.filter((r) => r.predictDate === date);
      const dayLocalCorrect = dayRecs.filter((r) => r.localCorrect);
      const dayCloudCorrect = dayRecs.filter((r) => r.cloudCorrect);
      return {
        date,
        total: dayRecs.length,
        localCorrect: dayLocalCorrect.length,
        cloudCorrect: dayCloudCorrect.length,
        localAccuracy: dayRecs.length > 0 ? Math.round(dayLocalCorrect.length / dayRecs.length * 100) : 0,
        cloudAccuracy: dayRecs.length > 0 ? Math.round(dayCloudCorrect.length / dayRecs.length * 100) : 0,
      };
    });

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        stats: {
          totalPredictions: records.length,
          verifiedPredictions: verified.length,
          localAccuracy: verified.length > 0 ? Math.round(localCorrect.length / verified.length * 100) : 0,
          cloudAccuracy: verified.length > 0 ? Math.round(cloudCorrect.length / verified.length * 100) : 0,
          upAccuracy: upPredictions.length > 0 ? Math.round(upCorrect.length / upPredictions.length * 100) : 0,
          downAccuracy: downPredictions.length > 0 ? Math.round(downCorrect.length / downPredictions.length * 100) : 0,
          dailyStats,
        },
      }) };
  } catch (error) {
    console.error('[PredictionStats Error]', error);
    return { statusCode: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) };
  }
}


/**
 * 初始化数据库集合
 */
async function handleInitDb(event) {
  try {
    const collections = ['favorites'];
    const results = [];
    for (const name of collections) {
      try {
        await db.createCollection(name);
        results.push({ name, status: 'created' });
      } catch (e) {
        if (e.message && e.message.includes('already exists')) {
          results.push({ name, status: 'already_exists' });
        } else {
          results.push({ name, status: 'error', message: e.message });
        }
      }
    }
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, results }),
    };
  } catch (error) {
    console.error('[InitDb Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}


/**
 * 从 COS 读取数据文件（rebuild / paper-trading / reports / momentum）
 * 供前端动态拉取，替代静态托管嵌入
 */
async function handleGetData(event) {
  try {
    const query = event.queryString || event.queryStringParameters || {};
    const key = query.key || query.path || '';
    if (!key) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Missing key parameter' }),
      };
    }

    // 安全校验：只允许读取指定前缀
    const allowedPrefixes = ['market/', 'rebuild/', 'paper-trading/', 'reports/', 'momentum/'];
    if (!allowedPrefixes.some(p => key.startsWith(p))) {
      return {
        statusCode: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Access denied' }),
      };
    }

    const cos = getCOSClient();
    const result = await new Promise((resolve, reject) => {
      cos.getObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const contentType = key.endsWith('.json') ? 'application/json' : 'text/csv';
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      },
      body: result.Body.toString('utf-8'),
    };
  } catch (error) {
    console.error('[GetData Error]', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}
