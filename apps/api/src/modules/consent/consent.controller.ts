import { Router, type Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import {
  createOrUpdateConsent,
  getConsent,
  type ConsentPayload,
} from '../../services/consent.service';
import { secureLogger } from '../../utils/secure-logger';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { getClientIp } from '../../lib/client-ip';

export const consentRouter = Router();

const HASH_REGEX = /^[0-9a-f]{64}$/;

const consentReadLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'CONSENT_RATE_LIMIT_EXCEEDED' },
  },
  'consent_read',
);

// Écriture non authentifiée (bannière cookies anonyme) : budget bien plus
// serré que la lecture — un visiteur légitime ne change son consentement
// que quelques fois par minute au maximum.
const consentWriteLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'CONSENT_RATE_LIMIT_EXCEEDED' },
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `consent_write:ip:${ipKeyGenerator(ip)}`;
    },
  },
  'consent_write',
);

const consentBodySchema = z.object({
  consentLevel: z.enum(['personalized', 'npa', 'limited', 'none']),
  ad_storage: z.enum(['granted', 'denied']),
  ad_user_data: z.enum(['granted', 'denied']),
  ad_personalization: z.enum(['granted', 'denied']),
  cmpVersion: z.string().max(120).optional(),
});

consentRouter.get('/:hash', consentReadLimiter, async (req, res) => {
  const { hash } = req.params;
  if (!hash || !HASH_REGEX.test(hash)) {
    return res.status(400).json({ error: 'Invalid hash format' });
  }

  try {
    const consent = await getConsent(hash);
    if (!consent) {
      return res.json({ consent: null });
    }

    return res.json({ consent });
  } catch (error) {
    secureLogger.error('CONSENT_FETCH_FAILED', { error });
    return res.status(400).json({ error: 'Unable to fetch consent' });
  }
});

consentRouter.post('/:hash', consentWriteLimiter, async (req, res) => {
  const { hash } = req.params;
  if (!hash || !HASH_REGEX.test(hash)) {
    return res.status(400).json({ error: 'Invalid hash format' });
  }

  try {
    const parsedBody = consentBodySchema.parse(req.body);

    const payload: ConsentPayload = {
      userHash: hash,
      ...parsedBody,
    };

    const record = await createOrUpdateConsent(payload);

    return res.status(201).json({ consent: record });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid consent payload', details: error.errors });
    }

    secureLogger.error('CONSENT_UPDATE_FAILED', { error });
    return res.status(400).json({ error: 'Unable to update consent' });
  }
});
