export function resolveRedisUrl(): string | null {
  const explicitUrl = process.env.REDIS_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const password = process.env.REDIS_PASSWORD?.trim();
  if (password) {
    return `redis://default:${password}@127.0.0.1:6379/0`;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'redis://127.0.0.1:6379/0';
  }

  return null;
}
