import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { optionalAuth } from '../auth/auth.guard';
import { ingestPublicAnalyticsEvent } from '../../services/analytics/events.service';
import { secureLogger } from '../../utils/secure-logger';

export const analyticsRouter = Router();
analyticsRouter.use(optionalAuth);

type RateEntry = { count: number; resetAt: number };

// Read at request time so tests can set env vars after module load
const getRateLimitWindowMs = () => Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS || '60000');
const getRateLimitMax = () => Number(process.env.ANALYTICS_RATE_LIMIT_MAX || '20');
const RATE_LIMIT_SALT = process.env.ANALYTICS_RATE_LIMIT_SALT || 'blobinfini-analytics-rate';

const rateMap = new Map<string, RateEntry>();

const hashOrigin = (req: Request) => {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined) || '';
  const ip = forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown-agent';
  return crypto.createHash('sha256').update(`${ip}:${userAgent}:${RATE_LIMIT_SALT}`).digest('hex');
};

const analyticsRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const key = hashOrigin(req);
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || entry.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + getRateLimitWindowMs() });
    return next();
  }
  if (entry.count < getRateLimitMax()) {
    entry.count += 1;
    return next();
  }
  const retryAfter = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'ANALYTICS_RATE_LIMIT' });
};

const consentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid consent hash');
const contentIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/i, 'Invalid content id');
const domainSchema = z
  .string()
  .max(190)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'Invalid domain');
const campaignIdSchema = z.string().regex(/^[a-z0-9_-]{1,48}$/i, 'Invalid campaign');

const blobosphereViewSchema = z
  .object({
    eventType: z.literal('BLOBOSPHERE_VIEW'),
    consentHash: consentHashSchema,
    contentId: contentIdSchema,
  })
  .strict();

const blobosphereOutboundSchema = z
  .object({
    eventType: z.literal('BLOBOSPHERE_OUTBOUND'),
    consentHash: consentHashSchema,
    contentId: contentIdSchema,
    domain: domainSchema,
    campaignId: campaignIdSchema.optional(),
  })
  .strict();

const blobosphereSignupSchema = z
  .object({
    eventType: z.literal('BLOBOSPHERE_SIGNUP'),
    consentHash: consentHashSchema,
    contentId: contentIdSchema.optional(),
  })
  .strict();

const proDashboardSchema = z
  .object({
    eventType: z.literal('PRO_DASHBOARD_OPEN'),
    consentHash: consentHashSchema,
  })
  .strict();

const analyticsEventSchema = z.discriminatedUnion('eventType', [
  blobosphereViewSchema,
  blobosphereOutboundSchema,
  blobosphereSignupSchema,
  proDashboardSchema,
]);

analyticsRouter.post('/events', analyticsRateLimit, async (req: Request, res: Response) => {
  const parsed = analyticsEventSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    secureLogger.warn('ANALYTICS_EVENT_INVALID', {
      errorCount: parsed.error.errors.length,
    });
    return res.status(400).json({ error: 'Invalid analytics payload' });
  }

  const payload = parsed.data;
  const user = (req as any).user as { id?: string; role?: string } | undefined;
  const originKey = hashOrigin(req);

  const result = await ingestPublicAnalyticsEvent({
    eventType: payload.eventType,
    consentHash: payload.consentHash,
    contentId: 'contentId' in payload ? payload.contentId ?? null : null,
    metadata:
      payload.eventType === 'BLOBOSPHERE_OUTBOUND'
        ? {
            domain: payload.domain,
            campaignId: payload.campaignId ?? null,
          }
        : null,
    originKey,
    userId: user?.id ?? null,
    userRole: user?.role ?? null,
  });

  if (result.status === 'forbidden') {
    return res.status(403).json({ error: 'CONSENT_REQUIRED' });
  }

  if (result.status === 'ignored') {
    return res.status(202).json({ ok: true, ignored: true });
  }

  return res.status(202).json({ ok: true });
});

/**
 * Clear rate limit map (for testing only)
 * This allows tests to reset rate limiting state between test cases
 */
export function clearAnalyticsRateLimit(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearAnalyticsRateLimit can only be called in test environment');
  }
  rateMap.clear();
}
