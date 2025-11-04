import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.guard';
import { clientPrisma as prisma } from '@blobinfini/database';

export const reportsRouter = Router();

const reportSchema = z.object({ targetProfileId: z.string().uuid(), reason: z.string().max(1000).optional() });

reportsRouter.post('/profile', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { targetProfileId, reason } = reportSchema.parse(req.body);

    const created = await prisma.profileReport.create({
      data: { reporterUserId: userId, reportedProfileId: targetProfileId, reason },
    });
    return res.status(201).json({ ok: true, id: created.id });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

