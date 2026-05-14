import { Router, type Request } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import {
  ensureBucket, presignPutObject, publicUrlForKey,
  getObjectFirstBytes, deleteObject,
} from '../../lib/s3';
import { registerPendingUpload, claimUploadToken } from '../../lib/upload-token';
import { detectMagicBytes } from '../../lib/magic-bytes';
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
import { assertFranceLaunchProProfile, isFranceLaunchGuardError } from '../../lib/france-launch-guard';

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

// Upload-url rate limiter : 20 req/heure/userId — presigned URL generation
// Plus généreux que finalize car c'est une opération légère (pas d'I/O S3 réel),
// mais user-keyed pour éviter l'épuisement du bucket IP global partagé.
const uploadUrlRateLimiter = createLazyCustomRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
  keyGenerator: (req: any) => {
    const userId = (req as any).user?.id;
    if (userId) return `upload_url:user:${userId}`;
    const ip = getClientIp(req) ?? req.socket?.remoteAddress;
    return ip ? `upload_url:ip:${ipKeyGenerator(ip)}` : 'upload_url:anonymous';
  },
  handler: (_req: any, res: any) => {
    res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Trop de tentatives. Réessayez dans une heure.' });
  },
}, 'pro_upload_url');

// Finalize rate limiter : 10 req/5min/userId — cohérent avec profile.controller.ts
const finalizeRateLimiter = createLazyCustomRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
  keyGenerator: (req: any) => {
    const userId = (req as any).user?.id;
    if (userId) return `finalize:user:${userId}`;
    const ip = getClientIp(req) ?? req.socket?.remoteAddress;
    return ip ? `finalize:ip:${ipKeyGenerator(ip)}` : 'finalize:anonymous';
  },
  handler: (_req: any, res: any) => {
    res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Trop de tentatives. Réessayez dans 5 minutes.' });
  },
}, 'pro_finalize');

const previewRateLimiter = createLazyCustomRateLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
  keyGenerator: (req: any) => {
    const userId = (req as any).user?.id;
    return userId ? `pro_preview:${userId}` : 'pro_preview:anonymous';
  },
}, 'pro_preview');

const notificationPreferencesSchema = z.object({
  notifyForSurf: z.boolean().optional(),
  notifyForKitesurf: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
}).optional();

const upsertSchema = z.object({
  businessName: z.string().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  emailNotif: z.boolean().optional(),
  // photoUrl ne peut être mis à jour que via POST /pro/photo/finalize.
  // Seul le clear explicite (null) est autorisé ici.
  photoUrl: z.null().optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
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
  // Coordonnées du lieu de cours — arrondies à 3 décimales dans la réponse (~110 m).
  lessonLat: number;
  lessonLng: number;
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

// Preview DTO — server-side guarantee: never exposes lat/lng/emailNotif/id/userId/timestamps/notificationPreferences
proRouter.get('/me/preview', requireProRole, previewRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const pp = await prisma.proProfile.findUnique({
      where: { userId },
      select: {
        businessName: true,
        bio: true,
        photoUrl: true,
        radiusKm: true,
        countryCode: true,
        lat: true,
        lng: true,
      },
    });

    if (!pp) {
      return res.json({
        businessName: null,
        bio: null,
        photoUrl: null,
        radiusKm: null,
        countryCode: null,
        hasLocation: false,
      });
    }

    // lat/lng fetched only to compute hasLocation — deliberately excluded from response
    return res.json({
      businessName: pp.businessName,
      bio: pp.bio,
      photoUrl: pp.photoUrl,
      radiusKm: pp.radiusKm,
      countryCode: pp.countryCode,
      hasLocation: pp.lat != null && pp.lng != null,
    });
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
});

const persistProProfile = async (userId: string, body: z.infer<typeof upsertSchema>) => {
  const radiusSegment = (value: number | undefined) => (value !== undefined ? { radiusKm: value } : {});
  const notifPrefsSegment = (value: any) => {
    if (value === undefined) return {};
    // Merge with existing preferences to avoid overwriting unspecified fields
    return { notificationPreferences: value };
  };
  const countrySegment = (value: string | undefined) => (value !== undefined ? { countryCode: value } : {});

  return prisma.proProfile.upsert({
    where: { userId },
    create: {
      userId,
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif ?? false,
      photoUrl: body.photoUrl,
      ...countrySegment(body.countryCode),
      lat: body.lat,
      lng: body.lng,
      ...radiusSegment(body.radiusKm),
      ...notifPrefsSegment(body.notificationPreferences),
    },
    update: {
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif,
      photoUrl: body.photoUrl,
      ...countrySegment(body.countryCode),
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
    const existingProfile = await prisma.proProfile.findUnique({
      where: { userId },
      select: { countryCode: true, lat: true, lng: true },
    });
    const nextCountryCode = body.countryCode ?? existingProfile?.countryCode ?? undefined;
    assertFranceLaunchProProfile({
      countryCode: nextCountryCode,
      lat: body.lat,
      lng: body.lng,
    });
    const normalizedCountryCode = assertFranceLaunchProProfile({
      countryCode: nextCountryCode,
      lat: body.lat ?? existingProfile?.lat ?? undefined,
      lng: body.lng ?? existingProfile?.lng ?? undefined,
    });
    const pp = await persistProProfile(userId, { ...body, countryCode: normalizedCountryCode });
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
    if (isFranceLaunchGuardError(err)) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

proRouter.patch('/me', requireProRole, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body || {});
    const existingProfile = await prisma.proProfile.findUnique({
      where: { userId },
      select: { countryCode: true, lat: true, lng: true },
    });
    const nextCountryCode = body.countryCode ?? existingProfile?.countryCode ?? undefined;
    assertFranceLaunchProProfile({
      countryCode: nextCountryCode,
      lat: body.lat,
      lng: body.lng,
    });
    const normalizedCountryCode = assertFranceLaunchProProfile({
      countryCode: nextCountryCode,
      lat: body.lat ?? existingProfile?.lat ?? undefined,
      lng: body.lng ?? existingProfile?.lng ?? undefined,
    });
    const pp = await persistProProfile(userId, { ...body, countryCode: normalizedCountryCode });
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
    if (isFranceLaunchGuardError(err)) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Presigned upload URL for pro photo/logo
proRouter.post('/photo/upload-url', requireProRole, uploadUrlRateLimiter, async (req, res) => {
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
    const PRESIGN_TTL = 180;
    const uploadUrl = await presignPutObject(key, contentType, PRESIGN_TTL);
    await registerPendingUpload(key, userId, PRESIGN_TTL);
    return res.json({ uploadUrl, key });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Finalize photo upload pro — valide le contenu réel via magic bytes puis enregistre photoUrl
proRouter.post('/photo/finalize', requireProRole, finalizeRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const bodySchema = z.object({
      key: z.string().min(1).max(200).regex(
        /^pros\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|webp)$/,
        'Invalid key format',
      ),
    });
    let key: string;
    try {
      ({ key } = bodySchema.parse(req.body));
    } catch {
      return res.status(400).json({ error: 'Invalid key format' });
    }

    if (!key.startsWith(`pros/${userId}/`)) {
      secureLogger.warn('UPLOAD_FINALIZE_PRO_KEY_NOT_OWNED', { userId, keyPrefix: key.slice(0, 50) });
      return res.status(403).json({ error: 'Key does not belong to this user' });
    }

    const claim = await claimUploadToken(key, userId);
    if (claim === 'no_redis') {
      secureLogger.error('UPLOAD_FINALIZE_PRO_NO_REDIS', { userId });
      return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
    if (claim === 'not_found')   return res.status(410).json({ error: 'Upload token expired or not found' });
    if (claim === 'wrong_user') {
      secureLogger.warn('UPLOAD_FINALIZE_PRO_WRONG_USER', { userId });
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (claim === 'already_used') return res.status(409).json({ error: 'Upload already finalized' });

    const firstBytes = await getObjectFirstBytes(key);
    if (!firstBytes) {
      await deleteObject(key);
      return res.status(422).json({ error: 'Upload not found or exceeds size limit' });
    }

    const detectedMime = detectMagicBytes(firstBytes);
    if (!detectedMime) {
      await deleteObject(key);
      secureLogger.warn('UPLOAD_FINALIZE_PRO_INVALID_CONTENT', {
        userId,
        firstBytesHex: firstBytes.slice(0, 8).toString('hex'),
      });
      return res.status(422).json({ error: 'File content does not match an allowed image format' });
    }

    const photoUrl = publicUrlForKey(key);
    if (!photoUrl) return res.status(500).json({ error: 'Storage configuration error' });

    await prisma.proProfile.upsert({
      where: { userId },
      create: { userId, photoUrl },
      update: { photoUrl },
    });

    secureLogger.info('UPLOAD_FINALIZE_PRO_SUCCESS', { userId, detectedMime });
    return res.json({ photoUrl });
  } catch (err: any) {
    secureLogger.error('UPLOAD_FINALIZE_PRO_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
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
    assertFranceLaunchProProfile(me ?? {});
    if (!me?.lat || !me?.lng) return res.status(400).json({ error: 'Missing pro location' });
    const radiusFallback = me.radiusKm ?? 25;
    const safeRadius = typeof rawRadius === 'number' && !Number.isNaN(rawRadius) ? rawRadius : radiusFallback;
    const radiusKm = Math.max(1, Math.min(200, safeRadius));
    const sport = String(req.query.sport || 'surf');
    if (sport !== 'surf' && sport !== 'kitesurf') return res.status(400).json({ error: 'Invalid sport' });
    const plat = me.lat, plng = me.lng;

    // Requête BloboMap : utilise lessonLat/lessonLng (lieu demandé) — PAS lat/lng (profil).
    // Riders sans lessonLat/lessonLng exclus : mode strict intentionnel.
    // lessonLatApprox/lessonLngApprox arrondis à 3 décimales (~110 m) : privacy by default.
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
        rp."lessonLat",
        rp."lessonLng",
        ST_Distance(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lessonLng", rp."lessonLat"), 4326)::geography
        ) / 1000.0 AS "distanceKm",
        COALESCE(mc.total, 0) AS "activeMatchCount"
      FROM "RiderProfile" rp
      LEFT JOIN match_counts mc ON mc."userId" = rp."userId"
      WHERE rp."wantsLesson" = true
        AND rp."lessonLat" IS NOT NULL
        AND rp."lessonLng" IS NOT NULL
        AND (rp."lessonSport" = ${sport} OR rp."lessonSport" IS NULL)
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lessonLng", rp."lessonLat"), 4326)::geography,
          ${radiusKm * 1000}
        )
      ORDER BY "distanceKm" ASC
      LIMIT 500
    `);

    const items = candidates.map((c: LessonCandidateRow) => ({
      id: c.id,
      displayName: c.displayName,
      bio: c.bio,
      lessonSport: c.lessonSport,
      lessonLevel: c.lessonLevel,
      lessonDate: c.lessonDate,
      lessonPlace: c.lessonPlace,
      lessonStudentCount: c.lessonStudentCount,
      // Arrondi à 3 décimales ≈ 110 m — identifie un spot côtier sans permettre
      // de localiser une adresse. 2 décimales (~1.1 km) trop grossier : deux spots
      // distincts à 500 m (ex. La Gravière / La Piste, Hossegor) seraient confondus.
      lessonLatApprox: Math.round(c.lessonLat * 1000) / 1000,
      lessonLngApprox: Math.round(c.lessonLng * 1000) / 1000,
      distanceBucket: toDistanceBucket(c.distanceKm),
    }))
      .slice(0, 500);

    return res.json({ items });
  } catch (err) {
    if (isFranceLaunchGuardError(err)) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    secureLogger.error('Error fetching lesson candidates', { error: err });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Data Export endpoint (Article 20 - Right to data portability)
proRouter.get('/export', requireProRole, exportRateLimiter, async (req, res) => {
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
proRouter.post('/delete-account', requireProRole, async (req, res) => {
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
proRouter.post('/cancel-deletion', requireProRole, async (req, res) => {
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
proRouter.get('/deletion-status', requireProRole, async (req, res) => {
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
