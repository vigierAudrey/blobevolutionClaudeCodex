import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth } from '../auth/auth.guard';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
import crypto from 'crypto';
import { gdprExportService } from '../../services/gdpr-export.service';
import rateLimit from 'express-rate-limit';

export const proRouter = Router();

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
    return userId || req.ip || 'anonymous';
  },
});

const upsertSchema = z.object({
  businessName: z.string().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(2000).optional().or(z.literal('').transform(() => undefined)),
  emailNotif: z.boolean().optional(),
  photoUrl: z.string().url().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const offerSchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  title: z.string().min(10).max(200),
  description: z.string().min(50).max(2000),
  hourlyRate: z.number().min(10).max(200),
  isActive: z.boolean().optional().default(true),
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

    console.log(`🗺️  Searching for ${sport} lessons within ${radiusKm}km of (${plat}, ${plng})`);

    // Optimized query using PostGIS and SQL filtering instead of JavaScript
    const candidates = await prisma.$queryRaw<Array<{
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
      distance_km: number;
      activeMatchCount: number;
    }>>`
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
        ST_Distance(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
        ) / 1000.0 AS distance_km,
        (
          COALESCE(
            (SELECT COUNT(*) FROM "Match" m1 WHERE m1."userOneId" = rp."userId" AND m1."status" = 'ACTIVE'), 0
          ) +
          COALESCE(
            (SELECT COUNT(*) FROM "Match" m2 WHERE m2."userTwoId" = rp."userId" AND m2."status" = 'ACTIVE'), 0
          )
        ) AS "activeMatchCount"
      FROM "RiderProfile" rp
      WHERE rp."wantsLesson" = true
        AND rp."lat" IS NOT NULL
        AND rp."lng" IS NOT NULL
        AND (rp."lessonSport" = ${sport} OR rp."lessonSport" IS NULL)
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(${plng}, ${plat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
          ${radiusKm * 1000}  -- Use requested radius from query
        )
      ORDER BY distance_km ASC
      LIMIT 500
    `;

    console.log(`✅ Found ${candidates.length} riders wanting ${sport} lessons`);

    // No more JavaScript filtering needed - everything is done in SQL!
    const items = candidates.map((c) => ({
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
      distanceKm: Math.round(c.distance_km * 10) / 10  // Already calculated in SQL
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
proRouter.get('/offers/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est bien un PRO
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'PRO') return res.status(403).json({ error: 'Forbidden: PRO role required' });

    // Récupérer le profil pro et son offre
    const proProfile = await prisma.proProfile.findUnique({
      where: { userId },
      include: { offers: true }
    });

    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });

    return res.json({ offers: proProfile.offers });
  } catch (err) {
    console.error('Error fetching pro offer:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Create or update my offer
proRouter.post('/offers', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est bien un PRO
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'PRO') return res.status(403).json({ error: 'Forbidden: PRO role required' });

    // Valider les données
    const body = offerSchema.parse(req.body);

    // Récupérer le profil pro pour la géolocalisation
    const proProfile = await prisma.proProfile.findUnique({ where: { userId } });
    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });
    if (!proProfile.lat || !proProfile.lng) {
      return res.status(400).json({ error: 'Geolocation required. Please update your pro profile with lat/lng first.' });
    }

    // Chercher l'offre existante pour ce pro
    const existingOffer = await prisma.proOffer.findFirst({
      where: { proProfileId: proProfile.id }
    });

    let offer;
    if (existingOffer) {
      // Mettre à jour l'offre existante
      offer = await prisma.proOffer.update({
        where: { id: existingOffer.id },
        data: {
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
    } else {
      // Créer une nouvelle offre
      offer = await prisma.proOffer.create({
        data: {
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
    }

    return res.status(201).json(offer);
  } catch (err: any) {
    console.error('Error creating/updating pro offer:', err);
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Delete my offer
proRouter.delete('/offers/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est bien un PRO
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'PRO') return res.status(403).json({ error: 'Forbidden: PRO role required' });

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
proRouter.patch('/offers/me/toggle', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est bien un PRO
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'PRO') return res.status(403).json({ error: 'Forbidden: PRO role required' });

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

// ========== OFFERS SEARCH FOR RIDERS ==========

// Search offers near rider location
proRouter.get('/offers/search', requireAuth, async (req, res) => {
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
    const where: any = {
      isActive: true,
    };

    if (sport && ['surf', 'kitesurf'].includes(sport)) {
      where.sport = sport;
    }

    if (level && ['beginner', 'intermediate', 'advanced'].includes(level)) {
      where.level = level;
    }

    // Récupérer toutes les offres actives avec les filtres
    const offers = await prisma.proOffer.findMany({
      where,
      include: {
        proProfile: {
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        }
      },
      take: 1000 // Limite pour éviter les gros datasets
    });

    // Fonction de calcul de distance (Haversine)
    function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6371; // km
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // Calculer les distances et filtrer par rayon
    const offersWithDistance = offers
      .map(offer => {
        const distance = haversine(searchLat!, searchLng!, offer.lat, offer.lng);
        return {
          id: offer.id,
          sport: offer.sport,
          level: offer.level,
          title: offer.title,
          description: offer.description,
          hourlyRate: Number(offer.hourlyRate), // Convertir Decimal en number
          lat: offer.lat,
          lng: offer.lng,
          createdAt: offer.createdAt,
          distanceKm: Math.round(distance * 10) / 10,
          pro: {
            id: offer.proProfile.id,
            userId: offer.proProfile.user.id,
            businessName: offer.proProfile.businessName,
            bio: offer.proProfile.bio,
            photoUrl: offer.proProfile.photoUrl,
            verified: offer.proProfile.verified,
          }
        };
      })
      .filter(offer => offer.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 50); // Limiter le résultat final

    return res.json({
      offers: offersWithDistance,
      total: offersWithDistance.length,
      searchParams: {
        lat: searchLat,
        lng: searchLng,
        radiusKm,
        sport,
        level
      }
    });

  } catch (err) {
    console.error('Error searching offers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Data Export endpoint (Article 20 - Right to data portability)
proRouter.get('/export', requireAuth, exportRateLimiter, async (req, res) => {
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
proRouter.post('/delete-account', requireAuth, async (req, res) => {
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

    // TODO: Send email notification about deletion schedule

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
proRouter.post('/cancel-deletion', requireAuth, async (req, res) => {
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

    // TODO: Send email notification about cancellation

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
proRouter.get('/deletion-status', requireAuth, async (req, res) => {
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
