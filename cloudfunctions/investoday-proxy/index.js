/**
 * CloudBase 云函数 - Investoday API 代理
 * 
 * 作用:
 * 1. 前端不直接暴露 investoday API Key
 * 2. 解决浏览器跨域限制
 * 3. 统一日志和错误处理
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
