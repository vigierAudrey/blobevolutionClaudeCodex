import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';
import { requireAuth } from '../auth/auth.guard';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
import crypto from 'crypto';

export const proRouter = Router();

const upsertSchema = z.object({
  businessName: z.string().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  emailNotif: z.boolean().optional(),
  photoUrl: z.string().url().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

proRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    let pp = await prisma.proProfile.findUnique({ where: { userId } });
    if (!pp) pp = await prisma.proProfile.create({ data: { userId } });
    return res.json(pp);
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
});

proRouter.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body);
    const pp = await prisma.proProfile.upsert({
      where: { userId },
      create: { userId, businessName: body.businessName, bio: body.bio, emailNotif: body.emailNotif ?? false, photoUrl: body.photoUrl, lat: body.lat, lng: body.lng },
      update: { businessName: body.businessName, bio: body.bio, emailNotif: body.emailNotif, photoUrl: body.photoUrl, lat: body.lat, lng: body.lng },
    });
    return res.json(pp);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Presigned upload URL for pro photo/logo
proRouter.post('/photo/upload-url', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const schema = z.object({ contentType: z.string().min(1) });
    const { contentType } = schema.parse(req.body);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(contentType)) return res.status(400).json({ error: 'Unsupported content type' });

    await ensureBucket();
    const ext = contentType.split('/')[1] || 'bin';
    const key = `pros/${userId}/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await presignPutObject(key, contentType, 900);
    const fileUrl = publicUrlForKey(key);

    return res.json({ uploadUrl, key, fileUrl });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// List riders wanting lessons (variant B: visible to all pros in radius)
proRouter.get('/near/lessons', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const radiusKm = Math.max(1, Math.min(200, Number(req.query.radiusKm) || 25));
    const sport = String(req.query.sport || 'surf');
    if (sport !== 'surf' && sport !== 'kitesurf') return res.status(400).json({ error: 'Invalid sport' });

    const me = await prisma.proProfile.findUnique({ where: { userId }, select: { lat: true, lng: true } });
    if (!me?.lat || !me?.lng) return res.status(400).json({ error: 'Missing pro location' });
    const plat = me.lat, plng = me.lng;

    // Fetch candidate riders (want lessons, have coords, lessonSport surf, and at least one active match)
    const candidates = await prisma.riderProfile.findMany({
      where: {
        wantsLesson: true,
        lat: { not: null },
        lng: { not: null },
        OR: [
          { lessonSport: sport },
          { lessonSport: null }, // tolerate missing data; will be filtered client-side default
        ],
      },
      select: {
        id: true,
        userId: true,
        displayName: true,
        bio: true,
        lat: true,
        lng: true,
        lessonSport: true,
        user: {
          select: {
            matchesA: { where: { status: 'ACTIVE' }, select: { id: true } },
            matchesB: { where: { status: 'ACTIVE' }, select: { id: true } },
          },
        },
      },
      take: 2000,
    });

    function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6371; // km
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const items = candidates
      .filter((c) => (c.user.matchesA.length + c.user.matchesB.length) > 0)
      .filter((c) => (c.lessonSport || 'surf') === sport)
      .map((c) => {
        const d = haversine(plat, plng, c.lat as number, c.lng as number);
        return { id: c.id, userId: c.userId, displayName: c.displayName, bio: c.bio, lat: c.lat, lng: c.lng, distanceKm: Math.round(d * 10) / 10 };
      })
      .filter((it) => it.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 500);

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});
