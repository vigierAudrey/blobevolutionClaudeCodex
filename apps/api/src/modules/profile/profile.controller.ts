import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';
import { requireAuth } from '../auth/auth.guard';

export const profileRouter = Router();

const sexEnum = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED']);
const partnerEnum = z.enum(['ALL', 'WOMEN', 'MEN']);

const upsertSchema = z.object({
  displayName: z.string().min(1).max(60).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(1000).optional().or(z.literal('').transform(() => undefined)),
  sex: sexEnum.optional(),
  partnerPref: partnerEnum.optional(),
  maxDistanceKm: z.number().int().min(1).max(500).optional(),
  emailNotif: z.boolean().optional(),
  photoUrl: z.string().url().optional(),
});

profileRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let rp = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!rp) {
      rp = await prisma.riderProfile.create({ data: { userId } });
    }
    return res.json(rp);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

profileRouter.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const body = upsertSchema.parse(req.body);
    const rp = await prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, ...body },
      update: { ...body },
    });
    return res.json(rp);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

