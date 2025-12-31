import { getClientIp } from '../lib/client-ip';

type Window = {
  hits: number;
  resetAt: number;
};

const store = new Map<string, Window>();

export function rateLimit({ key, limit = 100, windowMs = 60_000 }: { key: string; limit?: number; windowMs?: number }) {
  return (req: any, res: any, next: any) => {
    // Use secure IP extraction (prevents spoofing)
    const ip = getClientIp(req) || 'local';
    const bucket = `${key}:${ip}`;
    const now = Date.now();
    const w = store.get(bucket);
    if (!w || w.resetAt <= now) {
      store.set(bucket, { hits: 1, resetAt: now + windowMs });
      return next();
    }
    if (w.hits < limit) {
      w.hits += 1;
      return next();
    }
    const retryAfter = Math.max(0, Math.ceil((w.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  };
}

