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

// 从环境变量读取 API Key（在 CloudBase 控制台配置）
const API_KEY = process.env.INVESTODAY_API_KEY || 'cae27125ca0746c4b6ede2d77cd2dd11';
const BASE_URL = 'data-api.investoday.net';

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
      body: JSON.stringify({ healthy: true, keyConfigured: !!API_KEY }),
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
 * 处理查询记录上传
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

    // 使用 CloudBase Node SDK 上传文件到云存储（COS）
    const cloudbase = require('@cloudbase/node-sdk');
    const app = cloudbase.init({});

    const result = await app.uploadFile({
      cloudPath: filename,
      fileContent: Buffer.from(dataStr),
    });

    console.log('[UploadRecord] Saved:', filename, 'fileID:', result.fileID);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, fileID: result.fileID }),
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
 * 处理查询记录列表
 */
async function handleListRecords(event) {
  try {
    const cloudbase = require('@cloudbase/node-sdk');
    const app = cloudbase.init({});

    const prefix = 'searches/';
    const result = await app.getFileList({ prefix });
    const files = result.fileList || [];

    // 按日期分组，提取文件名信息
    const records = files.map(f => {
      const match = f.cloudPath.match(/^searches\/(\d{4}-\d{2}-\d{2})\/(.+)\.json$/);
      return {
        fileID: f.fileID,
        path: f.cloudPath,
        date: match ? match[1] : '',
        name: match ? decodeURIComponent(match[2].replace(/_/g, ' ')) : f.cloudPath,
        size: f.size || 0,
        createTime: f.createTime || '',
      };
    }).filter(r => r.date).sort((a, b) => b.path.localeCompare(a.path));

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
 * 处理查询记录详情获取
 */
async function handleGetRecord(event) {
  try {
    const query = event.queryString || {};
    const fileID = query.fileID || '';
    const path = query.path || '';

    if (!fileID && !path) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing fileID or path' }),
      };
    }

    const cloudbase = require('@cloudbase/node-sdk');
    const app = cloudbase.init({});

    let fileContent;
    if (fileID) {
      const result = await app.downloadFile({ fileID });
      fileContent = result.fileContent;
    } else {
      const result = await app.downloadFile({ cloudPath: path });
      fileContent = result.fileContent;
    }

    const content = JSON.parse(fileContent.toString('utf-8'));

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
