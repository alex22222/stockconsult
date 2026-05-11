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

function pad(n: number): string {
  return n.toString().padStart(2, '0');
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
  // 统一使用本地时间生成文件名，避免 UTC/本地混用
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}-${minutes}-${seconds}`;
  const safeQuery = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename = `searches/${dateStr}/${timeStr}_${safeQuery}.json`;

  const record: SearchRecord = {
    query,
    results,
    timestamp: now.toISOString(),
    source: 'web',
  };

  try {
    console.log('[SearchLogger] Uploading:', filename, 'results:', results.length);
    const response = await fetch(`${CLOUDBASE_API_URL}/upload-record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data: record }),
    });

    if (!response.ok) {
      console.warn('[SearchLogger] Upload failed:', response.status, await response.text().catch(() => ''));
      return;
    }

    const result = await response.json().catch(() => null);
    if (result?.success) {
      console.log('[SearchLogger] Record saved:', filename);
    } else {
      console.warn('[SearchLogger] Upload returned:', result);
    }
  } catch (error) {
    console.warn('[SearchLogger] Error:', error);
  }
}
