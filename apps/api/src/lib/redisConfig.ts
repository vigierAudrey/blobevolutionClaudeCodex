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

/**
 * Redacts credentials from a Redis URL for safe logging.
 *
 * Handles all formats:
 *   redis://default:SECRET@host:6379/0  → redis://***@host:6379/0
 *   redis://:SECRET@host:6379/0         → redis://***@host:6379/0
 *   redis://host:6379/0                 → redis://host:6379/0  (unchanged)
 *
 * Uses the URL API to avoid regex fragility — any format the `redis` npm
 * package accepts is correctly handled here.
 */
export function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '***';
    }
    return u.toString();
  } catch {
    // Fallback for non-parseable strings: mask anything between // and @
    return url.replace(/\/\/[^@/]*@/g, '//***@');
  }
}
