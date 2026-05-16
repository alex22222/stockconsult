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
const cloudbase = require('@cloudbase/node-sdk');

// CloudBase 数据库初始化
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const FAVORITES_COLLECTION = 'favorites';
const PREDICT_COLLECTION = 'predict';
const DEFAULT_USER_ID = 'anonymous';

// 版本标记（用于确认部署生效）
const VERSION = '2026-05-12-v2';

// 从环境变量读取 API Key（在 CloudBase 控制台配置）
const API_KEY = process.env.INVESTODAY_API_KEY || 'cae27125ca0746c4b6ede2d77cd2dd11';
const BASE_URL = 'data-api.investoday.net';

// COS 配置
const COS_BUCKET = '7765-weight-tracker-1ghr085dd7d6cff2-1328081868';
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
    const result = await proxyMCPRequest(requestBody);
    
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
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
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
