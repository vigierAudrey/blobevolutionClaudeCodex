export function resolveRedisUrl(): string {
  const explicitUrl = process.env.REDIS_URL?.trim();
  if (explicitUrl) {
    return ensureDatabasePath(explicitUrl);
  }

  if (process.env.DOCKER === 'true') {
    return 'redis://redis:6379';
  }

  return 'redis://localhost:6379';
}

function ensureDatabasePath(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/0';
    }
    return url.toString();
  } catch {
    return urlString;
  }
}
