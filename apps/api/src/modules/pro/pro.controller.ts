import { Router, type Request } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
import crypto from 'crypto';
import { gdprExportService } from '../../services/gdpr-export.service';
import { sendAccountDeletionCancelledEmail, sendAccountDeletionEmail } from '../../lib/mailer';
import { ipKeyGenerator } from 'express-rate-limit';
import { requireProRole } from './pro.guard';
import { secureLogger } from '../../utils/secure-logger';
import { computeZoneLarge, recordServerAnalyticsEvent } from '../../services/analytics/events.service';
import { createGeoEndpointLimiter, createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { getClientIp } from '../../lib/client-ip';
import { hashIpHmacSafe } from '../../lib/hash-ip';
import {
  FRANCE_ONLY_MESSAGES,
  assertFranceOnlyProLocation,
  isFranceOnlyError,
} from '../../lib/france-only';

export const proRouter = Router();
proRouter.use(requireAuth, requireVerifiedEmail);

const getConsentHash = (req: Request) => {
  const header = req.headers['x-consent-hash'];
  return typeof header === 'string' && header.trim().length > 0 ? header : null;
};

// GDPR Export rate limiter: max 3 exports per hour per user
const exportRateLimiter = createLazyCustomRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Trop de demandes d\'export. Veuillez réessayer dans une heure.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    // Rate limit per authenticated user
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = req.ip || req.socket?.remoteAddress;
    return ip ? ipKeyGenerator(ip) : 'anonymous';
  },
}, 'pro_export');

// Profile update rate limiter: max 10 updates per 15 minutes per user
const profileUpdateLimiter = createLazyCustomRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Maximum 10 updates par fenêtre
  message: 'Trop de mises à jour de profil. Veuillez réessayer dans 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}:profile_update`;
    }
    const ip = req.ip || req.socket?.remoteAddress;
    return ip ? ipKeyGenerator(ip) : 'anonymous';
  },
  handler: (req: any, res: any) => {
    const userId = (req as any).user?.id;
    secureLogger.security('Rate limit exceeded for profile update', {
      userId,
      ipHash: hashIpHmacSafe(getClientIp(req)),
    });

    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime ? Math.ceil((resetTime.getTime() - Date.now()) / 1000) : 900;

    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de mises à jour de profil. Veuillez réessayer dans 15 minutes.',
      retryAfter,
    });
  },
}, 'pro_profile_update');

const notificationPreferencesSchema = z.object({
  notifyForSurf: z.boolean().optional(),
  notifyForKitesurf: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
}).optional();

const upsertSchema = z.object({
  countryCode: z.string().trim().min(2).max(2).transform((value) => value.toUpperCase()).optional(),
  businessName: z.string().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  emailNotif: z.boolean().optional(),
  photoUrl: z.string().url().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().int().min(1).max(200).optional(),
  notificationPreferences: notificationPreferencesSchema,
});

const nearLessonsBurstLimiter = createGeoEndpointLimiter('pro_near_lessons', 'GEO_HEAVY_BURST');
const nearLessonsMinuteLimiter = createGeoEndpointLimiter('pro_near_lessons', 'GEO_HEAVY_MINUTE');

type LessonCandidateRow = {
  id: string;
  displayName: string | null;
  bio: string | null;
  lessonSport: string | null;
  lessonLevel: string | null;
  lessonDate: Date | null;
  lessonPlace: string | null;
  lessonStudentCount: number | null;
  distanceKm: number;
  activeMatchCount: number;
};

const toDistanceBucket = (distanceKm: number): '<5km' | '5-15km' | '15-30km' | '>30km' => {
  if (distanceKm < 5) return '<5km';
  if (distanceKm < 15) return '5-15km';
  if (distanceKm < 30) return '15-30km';
  return '>30km';
};

proRouter.get('/me', requireProRole, async (req, res) => {
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

const persistProProfile = async (userId: string, body: z.infer<typeof upsertSchema>) => {
  const radiusSegment = (value: number | undefined) => (value !== undefined ? { radiusKm: value } : {});
  const notifPrefsSegment = (value: z.infer<typeof notificationPreferencesSchema>) => {
    if (value === undefined) return {};
    // Merge with existing preferences to avoid overwriting unspecified fields
    return { notificationPreferences: value };
  };
  const existingProfile = await prisma.proProfile.findUnique({
    where: { userId },
    select: {
      countryCode: true,
      lat: true,
      lng: true,
    },
  });

  const nextCountryCode = body.countryCode ?? existingProfile?.countryCode ?? null;
  const nextLat = body.lat !== undefined ? body.lat : existingProfile?.lat ?? null;
  const nextLng = body.lng !== undefined ? body.lng : existingProfile?.lng ?? null;

  assertFranceOnlyProLocation(
    {
      countryCode: nextCountryCode,
      lat: nextLat,
      lng: nextLng,
    },
    FRANCE_ONLY_MESSAGES.proProfile,
  );

  return prisma.proProfile.upsert({
    where: { userId },
    create: {
      userId,
      countryCode: nextCountryCode ?? undefined,
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif ?? false,
      photoUrl: body.photoUrl,
      lat: body.lat,
      lng: body.lng,
      ...radiusSegment(body.radiusKm),
      ...notifPrefsSegment(body.notificationPreferences),
    },
    update: {
      countryCode: nextCountryCode ?? undefined,
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif,
      photoUrl: body.photoUrl,
      lat: body.lat,
      lng: body.lng,
      ...radiusSegment(body.radiusKm),
      ...notifPrefsSegment(body.notificationPreferences),
    },
  });
};

proRouter.put('/me', requireProRole, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body);
    const pp = await persistProProfile(userId, body);
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'PRO_PROFILE_UPDATE',
      actorType: 'PRO',
      actorId: userId,
      consentHash,
      zoneLarge: computeZoneLarge(pp.lat, pp.lng),
      occurredAt: pp.updatedAt,
    });
    return res.json(pp);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    if (isFranceOnlyError(err)) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

proRouter.patch('/me', requireProRole, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body || {});
    const pp = await persistProProfile(userId, body);
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'PRO_PROFILE_UPDATE',
      actorType: 'PRO',
      actorId: userId,
      consentHash,
      zoneLarge: computeZoneLarge(pp.lat, pp.lng),
      occurredAt: pp.updatedAt,
    });
    return res.json(pp);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    if (isFranceOnlyError(err)) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Presigned upload URL for pro photo/logo
proRouter.post('/photo/upload-url', requireProRole, async (req, res) => {
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
proRouter.get('/near/lessons', requireProRole, nearLessonsBurstLimiter, nearLessonsMinuteLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rawRadius = req.query.radiusKm ? Number(req.query.radiusKm) : undefined;
    const me = await prisma.proProfile.findUnique({
      where: { userId },
      select: { countryCode: true, lat: true, lng: true, radiusKm: true },
    });
    if (!me?.lat || !me?.lng) return res.status(400).json({ error: 'Missing pro location' });
    assertFranceOnlyProLocation(me, FRANCE_ONLY_MESSAGES.feature);
    const radiusFallback = me.radiusKm ?? 25;
    const safeRadius = typeof rawRadius === 'number' && !Number.isNaN(rawRadius) ? rawRadius : radiusFallback;
    const radiusKm = Math.max(1, Math.min(200, safeRadius));
    const sport = String(req.query.sport || 'surf');
    if (sport !== 'surf' && sport !== 'kitesurf') return res.status(400).json({ error: 'Invalid sport' });
    const plat = me.lat, plng = me.lng;

    // Optimized query using PostGIS and SQL filtering instead of JavaScript
    const candidates = await prisma.$queryRaw<LessonCandidateRow[]>(Prisma.sql`
      WITH active_matches AS (
        SELECT "userOneId" AS "userId"
        FROM "Match"
        WHERE "status" = 'ACTIVE'
        UNION ALL
        SELECT "userTwoId" AS "userId"
        FROM "Match"
        WHERE "status" = 'ACTIVE'
      ),
      match_counts AS (
        SELECT "userId", COUNT(*) AS total
        FROM active_matches
        GROUP BY "userId"
      )
          SELECT
            rp."id",
            rp."displayName",
            rp."bio",
            rp."lessonSport",
            rp."lessonLevel",
            rp."lessonDate",
            rp."lessonPlace",
            rp."lessonStudentCount",
            ST_Distance(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
        ) / 1000.0 AS "distanceKm",
        COALESCE(mc.total, 0) AS "activeMatchCount"
      FROM "RiderProfile" rp
      LEFT JOIN match_counts mc ON mc."userId" = rp."userId"
      WHERE rp."wantsLesson" = true
        AND rp."lat" IS NOT NULL
        AND rp."lng" IS NOT NULL
        AND (rp."lessonSport" = ${sport} OR rp."lessonSport" IS NULL)
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          ${radiusKm * 1000}
        )
      ORDER BY "distanceKm" ASC
      LIMIT 500
    `);

    // No more JavaScript filtering needed - everything is done in SQL!
    const items = candidates.map((c: LessonCandidateRow) => ({
      id: c.id,
      displayName: c.displayName,
      bio: c.bio,
      lessonSport: c.lessonSport,
      lessonLevel: c.lessonLevel,
      lessonDate: c.lessonDate,
      lessonPlace: c.lessonPlace,
      lessonStudentCount: c.lessonStudentCount,
      distanceBucket: toDistanceBucket(c.distanceKm),
    }))
      .slice(0, 500);

    return res.json({ items });
  } catch (err) {
    if (isFranceOnlyError(err)) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    secureLogger.error('Error fetching lesson candidates', { error: err });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Data Export endpoint (Article 20 - Right to data portability)
proRouter.get('/export', exportRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Extract IP for audit logging
    const ip = getClientIp(req) ?? undefined;

    // Generate export data
    const exportData = await gdprExportService.exportUserData(userId, ip);

    // Set appropriate headers for JSON download
    const filename = `blobinfini-data-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Send the data
    return res.json(exportData);
  } catch (err: any) {
    secureLogger.error('GDPR export error', { error: err });
    return res.status(500).json({ error: 'Erreur lors de l\'export de vos données' });
  }
});

// Account deletion with 30-day grace period (CNIL best practice)
proRouter.post('/delete-account', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const confirm = req.body?.confirm === true;
    if (!confirm) {
      return res.status(400).json({ error: 'Confirmation required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.deletedAt) {
      return res.status(400).json({
        error: 'Account already scheduled for deletion',
        deletedAt: user.deletedAt,
        deletionDate: new Date(user.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    // Mark account for deletion
    const now = new Date();
    const deletionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: now },
    });

    // Log the deletion request for audit
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_REQUESTED',
        resource: 'User',
        metadata: {
          requestedAt: now.toISOString(),
          scheduledDeletionDate: deletionDate.toISOString(),
          email: user.email,
          userRole: 'PRO',
        },
        ip: hashIpHmacSafe(getClientIp(req)),
      },
    });

    await sendAccountDeletionEmail(user.email, deletionDate, 'PRO');

    return res.json({
      message: 'Demande de suppression enregistrée',
      deletedAt: now,
      deletionDate,
      daysRemaining: 30,
    });
  } catch (err: any) {
    secureLogger.error('Account deletion error', { error: err });
    return res.status(500).json({ error: 'Erreur lors de la demande de suppression' });
  }
});

// Cancel account deletion (within 30-day grace period)
proRouter.post('/cancel-deletion', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.deletedAt) {
      return res.status(400).json({
        error: 'No deletion scheduled for this account',
      });
    }

    // Check if still within grace period (30 days)
    const now = new Date();
    const daysSinceDeletion = Math.floor((now.getTime() - user.deletedAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceDeletion >= 30) {
      return res.status(400).json({
        error: 'Grace period expired - account cannot be recovered',
      });
    }

    // Cancel deletion
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
    });

    // Log the cancellation for audit
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_CANCELLED',
        resource: 'User',
        metadata: {
          cancelledAt: now.toISOString(),
          originalDeletionDate: user.deletedAt.toISOString(),
          daysSinceDeletion,
          email: user.email,
          userRole: 'PRO',
        },
        ip: hashIpHmacSafe(getClientIp(req)),
      },
    });

    await sendAccountDeletionCancelledEmail(user.email, 'PRO');

    return res.json({
      message: 'Suppression de compte annulée',
      cancelledAt: now,
    });
  } catch (err: any) {
    secureLogger.error('Cancel deletion error', { error: err });
    return res.status(500).json({ error: 'Erreur lors de l\'annulation' });
  }
});

// Get deletion status
proRouter.get('/deletion-status', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.deletedAt) {
      return res.json({
        isScheduled: false,
      });
    }

    const now = new Date();
    const deletionDate = new Date(user.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, Math.ceil((deletionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    return res.json({
      isScheduled: true,
      deletedAt: user.deletedAt,
      deletionDate,
      daysRemaining,
    });
  } catch (err: any) {
    secureLogger.error('Deletion status error', { error: err });
    return res.status(500).json({ error: 'Erreur lors de la vérification du statut' });
  }
});
