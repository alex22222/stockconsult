/**
 * CloudBase 云函数 - Investoday API 代理
 * 
 * 作用:
 * 1. 前端不直接暴露 investoday API Key
 * 2. 解决浏览器跨域限制
 * 3. 统一日志和错误处理
 * 
 * 部署后访问路径:
 * https://<你的云开发环境ID>.service.tcloudbase.com/investoday-proxy/api/stock/info?code=600519
 */

const https = require('https');

// 从环境变量读取 API Key（在 CloudBase 控制台配置）
const API_KEY = process.env.INVESTODAY_API_KEY || '';
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
  if (event.path === '/health') {
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

  // 提取 API 路径和参数
  // CloudBase 云函数 event.path 格式示例: /investoday-proxy/api/stock/info
  // 需要去掉云函数名称前缀
  const pathParts = event.path.split('/');
  // 找到 api 所在位置后的路径
  const apiIndex = pathParts.indexOf('api');
  const apiPath = apiIndex >= 0 ? '/' + pathParts.slice(apiIndex).join('/') : event.path;
  
  // 构建查询字符串
  const queryString = event.queryString
    ? Object.entries(event.queryString)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  
  const fullPath = apiPath + (queryString ? '?' + queryString : '');

  console.log(`[Proxy] ${event.httpMethod} ${fullPath}`);

  try {
    const result = await proxyRequest(event.httpMethod || 'GET', fullPath);
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
        path: fullPath,
      }),
    };
  }
};

function proxyRequest(method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'StockConsult-CloudBase-Proxy/1.0',
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

    req.end();
  });
}
