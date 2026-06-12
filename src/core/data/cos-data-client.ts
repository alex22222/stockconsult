const COS_BUCKET = '7374-stockconsult-d9g7b6ae5b8170e00-1328081868';
const COS_REGION = 'ap-shanghai';
const COS_BASE_URL = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com`;

type CacheBust = boolean | string | number;

interface FetchCosOptions {
  cacheBust?: CacheBust;
  logPrefix?: string;
}

export function cosDataUrl(key: string, cacheBust?: CacheBust) {
  const normalizedKey = key.replace(/^\/+/, '');
  const url = new URL(`${COS_BASE_URL}/${normalizedKey}`);

  if (cacheBust) {
    url.searchParams.set('t', cacheBust === true ? String(Date.now()) : String(cacheBust));
  }

  return url.toString();
}

export async function fetchCosJson<T>(key: string, options: FetchCosOptions = {}): Promise<T | null> {
  try {
    const res = await fetch(cosDataUrl(key, options.cacheBust));
    if (res.ok) return await res.json();
  } catch (e) {
    if (options.logPrefix) {
      console.warn(`[${options.logPrefix}] fetch failed: ${key}`, e);
    }
  }

  return null;
}

export async function fetchFirstCosJson<T>(
  keys: string[],
  options: FetchCosOptions = {},
): Promise<T | null> {
  for (const key of keys) {
    const data = await fetchCosJson<T>(key, options);
    if (data !== null) return data;
  }

  return null;
}
