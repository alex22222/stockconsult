/**
 * 查询记录落库到 CloudBase COS
 * 通过 investoday-proxy 云函数的 /upload-record 端点写入
 */

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

export interface SearchRecord {
  query: string;
  results: Array<{ code: string; name: string }>;
  timestamp: string;
  source: string;
}

/**
 * 记录一次查询到 COS
 * 静默失败，不阻断主流程
 */
export async function logSearch(query: string, results: Array<{ code: string; name: string }>): Promise<void> {
  if (!CLOUDBASE_API_URL) {
    console.warn('[SearchLogger] CLOUDBASE_API_URL not configured, skipping log');
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const safeQuery = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename = `searches/${dateStr}/${timeStr}_${safeQuery}.json`;

  const record: SearchRecord = {
    query,
    results,
    timestamp: now.toISOString(),
    source: 'web',
  };

  try {
    const response = await fetch(`${CLOUDBASE_API_URL}/upload-record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data: record }),
    });

    if (!response.ok) {
      console.warn('[SearchLogger] Upload failed:', response.status);
      return;
    }

    const result = await response.json().catch(() => null);
    if (result?.success) {
      console.log('[SearchLogger] Record saved:', filename);
    }
  } catch (error) {
    console.warn('[SearchLogger] Error:', error);
  }
}
