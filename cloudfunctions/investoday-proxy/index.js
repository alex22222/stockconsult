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

// 版本标记（用于确认部署生效）
const VERSION = '2026-05-11-v5';

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

async function readIndexFile() {
  try {
    const cos = getCOSClient();
    const result = await new Promise((resolve, reject) => {
      cos.getObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: 'searches/index.json',
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    const data = JSON.parse(result.Body.toString('utf-8'));
    // 返回数据和 ETag（用于 CAS 乐观锁）
    return { records: Array.isArray(data) ? data : [], etag: result.ETag };
  } catch (e) {
    return { records: [], etag: null };
  }
}

async function saveIndexFile(records, expectedEtag) {
  const cos = getCOSClient();
  const params = {
    Bucket: COS_BUCKET,
    Region: COS_REGION,
    Key: 'searches/index.json',
    Body: Buffer.from(JSON.stringify(records)),
    ContentType: 'application/json',
  };
  // 如果有期望的 ETag，使用 If-Match 条件写入（CAS）
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
 * 防止并发覆盖：读取→校验 ETag→合并→写入，ETag 冲突则重试
 */
async function updateIndexFile(newRecord, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { records, etag } = await readIndexFile();
      // 去重：同路径只保留最新
      const filtered = records.filter(r => r.path !== newRecord.path);
      filtered.unshift(newRecord);
      // 最多保留 500 条
      const trimmed = filtered.slice(0, 500);
      await saveIndexFile(trimmed, etag);
      console.log('[Index] Updated successfully, attempt:', attempt + 1);
      return { success: true };
    } catch (error) {
      // 412 Precondition Failed = ETag 冲突（并发写入），需要重试
      if (error.statusCode === 412 || error.code === 'PreconditionFailed') {
        console.warn(`[Index] CAS conflict, retrying... (${attempt + 1}/${maxRetries})`);
        // 指数退避等待
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to update index after ${maxRetries} retries due to CAS conflicts`);
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

    // 校验文件名格式：只允许 searches/YYYY-MM-DD/*.json
    if (!/^searches\/\d{4}-\d{2}-\d{2}\/[^\/]+\.json$/.test(filename)) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid filename format' }),
      };
    }

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
    const dateMatch = filename.match(/^searches\/(\d{4}-\d{2}-\d{2})\/(.+)\.json$/);
    const newRecord = {
      query: data.query,
      results: data.results || [],
      timestamp: data.timestamp || new Date().toISOString(),
      source: data.source || 'web',
      path: filename,
      fileID: uploadResult.fileID,
      date: dateMatch ? dateMatch[1] : '',
      name: dateMatch ? dateMatch[2].replace(/_/g, ' ') : filename,
      size: Buffer.byteLength(dataStr),
    };
    await updateIndexFile(newRecord);

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
    const { records } = await readIndexFile();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, records, total: records.length }),
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
 * 重建索引：扫描 COS 中所有 searches/ 下的文件，重建 index.json
 */
async function handleRebuildIndex(event) {
  try {
    const cos = getCOSClient();

    // 1. 列出所有 searches/ 前缀的文件
    const allFiles = [];
    let marker = null;
    const prefix = 'searches/';

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
        if (item.Key !== 'searches/index.json' && item.Key.endsWith('.json')) {
          allFiles.push(item.Key);
        }
      }
      marker = result.IsTruncated ? result.NextMarker : null;
    } while (marker);

    console.log(`[RebuildIndex] Found ${allFiles.length} record files`);

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
        const dateMatch = key.match(/^searches\/(\d{4}-\d{2}-\d{2})\/(.+)\.json$/);
        records.push({
          query: content.query || '',
          results: content.results || [],
          timestamp: content.timestamp || new Date().toISOString(),
          source: content.source || 'web',
          path: key,
          date: dateMatch ? dateMatch[1] : '',
          name: dateMatch ? dateMatch[2].replace(/_/g, ' ') : key,
          size: result.Body.length,
        });
      } catch (e) {
        console.warn(`[RebuildIndex] Failed to read ${key}:`, e.message);
      }
    }

    // 3. 按时间倒序排序，去重（同路径保留最新）
    const seen = new Set();
    const uniqueRecords = [];
    for (const r of records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        uniqueRecords.push(r);
      }
    }

    // 4. 写入索引（最多 500 条）
    const finalRecords = uniqueRecords.slice(0, 500);
    await saveIndexFile(finalRecords, null);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Index rebuilt: ${finalRecords.length} records`,
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
