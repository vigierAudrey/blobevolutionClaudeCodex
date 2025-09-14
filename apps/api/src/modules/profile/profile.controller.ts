import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';
import { requireAuth } from '../auth/auth.guard';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
import { lookup as mimeLookup, extension as mimeExtension } from 'mime-types';
import crypto from 'crypto';

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
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Lesson intent (visible on BloboMap Pro)
  wantsLesson: z.boolean().optional(),
  lessonSport: z.enum(['surf','kitesurf']).optional(),
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
    console.log('Updating profile for user:', userId, 'with data:', body);
    const rp = await prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, ...body },
      update: { ...body },
    });
    console.log('Profile updated:', rp);
    return res.json(rp);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('upload-url error', err);
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Disciplines (sport + level) CRUD
const sportEnum = ['surf', 'kitesurf'] as const;
const levelEnum = ['beginner', 'intermediate', 'advanced'] as const;
const disciplineSchema = z.object({ sport: z.enum(sportEnum), level: z.enum(levelEnum) });

profileRouter.get('/disciplines', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rp = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rp) return res.json([]);
    const items = await prisma.riderDiscipline.findMany({ where: { profileId: rp.id }, select: { sport: true, level: true } });
    return res.json(items);
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
});

profileRouter.put('/disciplines', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = z.array(disciplineSchema).max(10).parse(req.body || []);
    let rp = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!rp) rp = await prisma.riderProfile.create({ data: { userId } });

    // Replace strategy: clear then insert unique sports/levels
    await prisma.riderDiscipline.deleteMany({ where: { profileId: rp.id } });
    if (body.length > 0) {
      await prisma.riderDiscipline.createMany({
        data: Array.from(new Map(body.map((b) => [`${b.sport}:${b.level}`, { profileId: rp.id, sport: b.sport, level: b.level }])).values()),
        skipDuplicates: true,
      });
    }
    const after = await prisma.riderDiscipline.findMany({ where: { profileId: rp.id }, select: { sport: true, level: true } });
    return res.json(after);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Generate a pre-signed URL for direct upload to S3/MinIO
profileRouter.post('/photo/upload-url', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const schema = z.object({ contentType: z.string().min(1) });
    const { contentType } = schema.parse(req.body);

    // Accept only common image types
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(contentType)) return res.status(400).json({ error: 'Unsupported content type' });

    // Debug basic env state for S3
    // eslint-disable-next-line no-console
    console.log('S3 env check', {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      hasKey: !!process.env.S3_ACCESS_KEY_ID,
    });
    await ensureBucket();
    const ext = mimeExtension(contentType) || 'bin';
    const key = `users/${userId}/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await presignPutObject(key, contentType, 900);
    const fileUrl = publicUrlForKey(key);

    return res.json({ uploadUrl, key, fileUrl });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('upload-url error', err);
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});
