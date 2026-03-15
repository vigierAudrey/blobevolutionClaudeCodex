import { Router } from 'express';
import { z } from 'zod';
import {
  createOrUpdateConsent,
  getConsent,
  type ConsentPayload,
} from '../../services/consent.service';
import { secureLogger } from '../../utils/secure-logger';

export const consentRouter = Router();

const consentBodySchema = z.object({
  consentLevel: z.enum(['personalized', 'npa', 'limited', 'none']),
  ad_storage: z.enum(['granted', 'denied']),
  ad_user_data: z.enum(['granted', 'denied']),
  ad_personalization: z.enum(['granted', 'denied']),
  cmpVersion: z.string().max(120).optional(),
});

consentRouter.get('/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash) {
      return res.status(400).json({ error: 'Missing hash parameter' });
    }

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

consentRouter.post('/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash) {
      return res.status(400).json({ error: 'Missing hash parameter' });
    }

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
