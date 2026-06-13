/**
 * 安全读取 Vite 环境变量。
 * 在 Node.js（如 tsx 测试）环境中 import.meta.env 可能不存在，
 * 此辅助函数可避免运行时崩溃。
 */
export function getEnv(key: string): string | undefined {
  try {
    const meta = import.meta as { env?: Record<string, string | undefined> };
    return meta.env?.[key];
  } catch {
    return undefined;
  }
}

export function getEnvString(key: string, fallback: string = ''): string {
  return getEnv(key) ?? fallback;
}
