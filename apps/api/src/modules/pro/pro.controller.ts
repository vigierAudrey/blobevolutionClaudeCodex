import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
import crypto from 'crypto';
import { gdprExportService } from '../../services/gdpr-export.service';
import { sendAccountDeletionCancelledEmail, sendAccountDeletionEmail } from '../../lib/mailer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireProRole } from './pro.guard';

export const proRouter = Router();
proRouter.use(requireAuth, requireVerifiedEmail);

// GDPR Export rate limiter: max 3 exports per hour per user
const exportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Trop de demandes d\'export. Veuillez réessayer dans une heure.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit per authenticated user
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = req.ip || req.socket?.remoteAddress;
    return ip ? ipKeyGenerator(ip) : 'anonymous';
  },
});

// Profile update rate limiter: max 10 updates per 15 minutes per user
const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Maximum 10 updates par fenêtre
  message: 'Trop de mises à jour de profil. Veuillez réessayer dans 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}:profile_update`;
    }
    const ip = req.ip || req.socket?.remoteAddress;
    return ip ? ipKeyGenerator(ip) : 'anonymous';
  },
  handler: (req, res) => {
    const userId = (req as any).user?.id;
    console.warn(`⚠️ Rate limit exceeded for profile update: user=${userId}, ip=${req.ip}`);

    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime ? Math.ceil((resetTime.getTime() - Date.now()) / 1000) : 900;

    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de mises à jour de profil. Veuillez réessayer dans 15 minutes.',
      retryAfter,
    });
  },
});

const upsertSchema = z.object({
  businessName: z.string().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  emailNotif: z.boolean().optional(),
  photoUrl: z.string().url().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().int().min(1).max(200).optional(),
});

const offerSchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  title: z.string().min(10).max(200),
  description: z.string().min(50).max(2000),
  hourlyRate: z.number().min(10).max(200),
  isActive: z.boolean().optional().default(true),
});

const offerIdParamSchema = z.object({
  offerId: z.string().uuid()
});

type LessonCandidateRow = {
  id: string;
  userId: string;
  displayName: string | null;
  bio: string | null;
  lat: number;
  lng: number;
  lessonSport: string | null;
  lessonLevel: string | null;
  lessonDate: Date | null;
  lessonPlace: string | null;
  lessonStudentCount: number | null;
  distanceKm: number;
  activeMatchCount: number;
};

type OfferSearchRow = {
  offerId: string;
  sport: string;
  level: string;
  title: string;
  description: string | null;
  hourlyRate: number;
  lat: number;
  lng: number;
  createdAt: Date;
  distanceKm: number;
  proProfileId: string;
  proUserId: string;
  businessName: string | null;
  bio: string | null;
  photoUrl: string | null;
  verified: boolean;
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

  return prisma.proProfile.upsert({
    where: { userId },
    create: {
      userId,
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif ?? false,
      photoUrl: body.photoUrl,
      lat: body.lat,
      lng: body.lng,
      ...radiusSegment(body.radiusKm),
    },
    update: {
      businessName: body.businessName,
      bio: body.bio,
      emailNotif: body.emailNotif,
      photoUrl: body.photoUrl,
      lat: body.lat,
      lng: body.lng,
      ...radiusSegment(body.radiusKm),
    },
  });
};

proRouter.put('/me', requireProRole, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body);
    const pp = await persistProProfile(userId, body);
    return res.json(pp);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

proRouter.patch('/me', requireProRole, profileUpdateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = upsertSchema.parse(req.body || {});
    const pp = await persistProProfile(userId, body);
    return res.json(pp);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
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
proRouter.get('/near/lessons', requireProRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rawRadius = req.query.radiusKm ? Number(req.query.radiusKm) : undefined;
    const me = await prisma.proProfile.findUnique({ where: { userId }, select: { lat: true, lng: true, radiusKm: true } });
    if (!me?.lat || !me?.lng) return res.status(400).json({ error: 'Missing pro location' });
    const radiusFallback = me.radiusKm ?? 25;
    const safeRadius = typeof rawRadius === 'number' && !Number.isNaN(rawRadius) ? rawRadius : radiusFallback;
    const radiusKm = Math.max(1, Math.min(200, safeRadius));
    const sport = String(req.query.sport || 'surf');
    if (sport !== 'surf' && sport !== 'kitesurf') return res.status(400).json({ error: 'Invalid sport' });
    const plat = me.lat, plng = me.lng;

    console.log(`🗺️  Searching for ${sport} lessons within ${radiusKm}km of (${plat}, ${plng})`);

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
            rp."userId",
            rp."displayName",
            rp."bio",
            rp."lat",
            rp."lng",
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

    console.log(`✅ Found ${candidates.length} riders wanting ${sport} lessons`);

    // No more JavaScript filtering needed - everything is done in SQL!
    const items = candidates.map((c: LessonCandidateRow) => ({
      id: c.id,
      userId: c.userId,
      displayName: c.displayName,
      bio: c.bio,
      lat: c.lat,
      lng: c.lng,
      lessonSport: c.lessonSport,
      lessonLevel: c.lessonLevel,
      lessonDate: c.lessonDate,
      lessonPlace: c.lessonPlace,
      lessonStudentCount: c.lessonStudentCount,
      distanceKm: Math.round(c.distanceKm * 10) / 10  // Already calculé en SQL
    }))
      .slice(0, 500);

    console.log(`📤 Returning ${items.length} lesson requests to pro`);

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ========== PRO OFFERS ENDPOINTS ==========

// Get my offer
proRouter.get('/offers/me', requireProRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Récupérer le profil pro et son offre
    const proProfile = await prisma.proProfile.findUnique({
      where: { userId },
      include: {
        offers: {
          include: {
            _count: { select: { clicks: true } },
            clicks: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true }
            }
          }
        }
      }
    });

    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });

    const offersWithStats = proProfile.offers.map((offer: any) => {
      const { clicks, _count, ...rest } = offer;
      return {
        ...rest,
        stats: {
          uniqueClicks: _count?.clicks ?? 0,
          lastClickAt: clicks?.[0]?.createdAt ?? null
        }
      };
    });

    return res.json({ offers: offersWithStats });
  } catch (err) {
    console.error('Error fetching pro offer:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Create or update my offer
proRouter.post('/offers', requireProRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Valider les données
    const body = offerSchema.parse(req.body);

    // Récupérer le profil pro pour la géolocalisation
    const proProfile = await prisma.proProfile.findUnique({ where: { userId } });
    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });
    if (!proProfile.lat || !proProfile.lng) {
      return res.status(400).json({ error: 'Geolocation required. Please update your pro profile with lat/lng first.' });
    }

    const offer = await prisma.proOffer.upsert({
      where: { proProfileId: proProfile.id },
      update: {
        sport: body.sport,
        level: body.level,
        title: body.title,
        description: body.description,
        hourlyRate: body.hourlyRate,
        lat: proProfile.lat,
        lng: proProfile.lng,
        isActive: body.isActive,
      },
      create: {
        proProfileId: proProfile.id,
        sport: body.sport,
        level: body.level,
        title: body.title,
        description: body.description,
        hourlyRate: body.hourlyRate,
        lat: proProfile.lat,
        lng: proProfile.lng,
        isActive: body.isActive,
      },
    });

    return res.status(201).json(offer);
  } catch (err: any) {
    console.error('Error creating/updating pro offer:', err);
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Delete my offer
proRouter.delete('/offers/me', requireProRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Récupérer le profil pro
    const proProfile = await prisma.proProfile.findUnique({ where: { userId } });
    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });

    // Supprimer l'offre si elle existe
    const deletedOffer = await prisma.proOffer.deleteMany({
      where: { proProfileId: proProfile.id }
    });

    if (deletedOffer.count === 0) {
      return res.status(404).json({ error: 'No offer found to delete' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('Error deleting pro offer:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Toggle offer active status
proRouter.patch('/offers/me/toggle', requireProRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Récupérer le profil pro et son offre
    const proProfile = await prisma.proProfile.findUnique({
      where: { userId },
      include: { offers: true }
    });

    if (!proProfile?.offers || proProfile.offers.length === 0) return res.status(404).json({ error: 'No offer found' });

    // Toggle le statut
    const updatedOffer = await prisma.proOffer.update({
      where: { id: proProfile.offers[0].id },
      data: { isActive: !proProfile.offers[0].isActive }
    });

    return res.json(updatedOffer);
  } catch (err) {
    console.error('Error toggling offer status:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Register a rider click on an offer (unique per rider/offer)
proRouter.post('/offers/:offerId/click', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { offerId } = offerIdParamSchema.parse(req.params);

    const offer = await prisma.proOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        proProfile: { select: { userId: true } }
      }
    });

    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    // Ne pas compter les clics du propriétaire pro
    if (offer.proProfile.userId === userId) return res.status(204).send();

    await prisma.proOfferClick.upsert({
      where: { proOfferId_riderUserId: { proOfferId: offerId, riderUserId: userId } },
      create: { proOfferId: offerId, riderUserId: userId },
      update: {}
    });

    return res.status(204).send();
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    console.error('Error registering offer click:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ========== OFFERS SEARCH FOR RIDERS ==========

// Search offers near rider location
proRouter.get('/offers/search', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Paramètres de recherche
    const radiusKm = Math.max(1, Math.min(200, Number(req.query.radiusKm) || 50));
    const sport = req.query.sport as string | undefined;
    const level = req.query.level as string | undefined;
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;

    // Si pas de coordonnées dans la query, essayer de récupérer depuis le profil rider
    let searchLat = lat;
    let searchLng = lng;

    if (!searchLat || !searchLng) {
      const riderProfile = await prisma.riderProfile.findUnique({
        where: { userId },
        select: { lat: true, lng: true }
      });

      if (riderProfile?.lat && riderProfile?.lng) {
        searchLat = riderProfile.lat;
        searchLng = riderProfile.lng;
      }
    }

    if (!searchLat || !searchLng) {
      return res.status(400).json({
        error: 'Geolocation required. Please provide lat/lng in query or update your profile.'
      });
    }

    // Construire les filtres
    const selectedSport = sport && ['surf', 'kitesurf'].includes(sport) ? sport : undefined;
    const selectedLevel = level && ['beginner', 'intermediate', 'advanced'].includes(level) ? level : undefined;

    const offerRows: OfferSearchRow[] = await prisma.$queryRaw<OfferSearchRow[]>(Prisma.sql`
      SELECT
        o."id" AS "offerId",
        o."sport",
        o."level",
        o."title",
        o."description",
        o."hourlyRate"::float AS "hourlyRate",
        o."lat",
        o."lng",
        o."createdAt",
        pp."id" AS "proProfileId",
        u."id" AS "proUserId",
        pp."businessName",
        pp."bio",
        pp."photoUrl",
        pp."verified",
        ST_Distance(
          ST_SetSRID(ST_MakePoint(${searchLng!}, ${searchLat!}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(o."lng", o."lat"), 4326)::geography
        ) / 1000.0 AS "distanceKm"
      FROM "ProOffer" o
      JOIN "ProProfile" pp ON pp."id" = o."proProfileId"
      JOIN "User" u ON u."id" = pp."userId"
      WHERE o."isActive" = true
        AND o."lat" IS NOT NULL
        AND o."lng" IS NOT NULL
        ${selectedSport ? Prisma.sql`AND o."sport" = CAST(${selectedSport} AS "Sport")` : Prisma.sql``}
        ${selectedLevel ? Prisma.sql`AND o."level" = CAST(${selectedLevel} AS "Level")` : Prisma.sql``}
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(${searchLng!}, ${searchLat!}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(o."lng", o."lat"), 4326)::geography,
          ${radiusKm * 1000}
        )
      ORDER BY "distanceKm" ASC
      LIMIT 50
    `);

    const offersWithDistance = offerRows.map((row: OfferSearchRow) => ({
      id: row.offerId,
      sport: row.sport,
      level: row.level,
      title: row.title,
      description: row.description,
      hourlyRate: Math.round(row.hourlyRate * 100) / 100,
      lat: row.lat,
      lng: row.lng,
      createdAt: row.createdAt,
      distanceKm: Math.round(row.distanceKm * 10) / 10,
      pro: {
        id: row.proProfileId,
        userId: row.proUserId,
        businessName: row.businessName,
        bio: row.bio,
        photoUrl: row.photoUrl,
        verified: row.verified,
      }
    }));

    return res.json({
      offers: offersWithDistance,
      total: offersWithDistance.length,
      searchParams: {
        lat: searchLat,
        lng: searchLng,
        radiusKm,
        sport: selectedSport,
        level: selectedLevel
      }
    });

  } catch (err) {
    console.error('Error searching offers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Data Export endpoint (Article 20 - Right to data portability)
proRouter.get('/export', exportRateLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Extract IP for audit logging
    const ips = (req as any).ips as string[] | undefined;
    const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;

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
    // eslint-disable-next-line no-console
    console.error('GDPR export error', err);
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
        ip: (req as any).ip || 'unknown',
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
    console.error('Account deletion error', err);
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
        ip: (req as any).ip || 'unknown',
      },
    });

    await sendAccountDeletionCancelledEmail(user.email, 'PRO');

    return res.json({
      message: 'Suppression de compte annulée',
      cancelledAt: now,
    });
  } catch (err: any) {
    console.error('Cancel deletion error', err);
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
    console.error('Deletion status error', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification du statut' });
  }
});
