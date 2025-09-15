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
      include: { offer: true }
    });

    if (!proProfile) return res.status(404).json({ error: 'Pro profile not found' });

    return res.json({ offer: proProfile.offer });
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

    // Créer ou mettre à jour l'offre (upsert)
    const offer = await prisma.proOffer.upsert({
      where: { proProfileId: proProfile.id },
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
    });

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
      include: { offer: true }
    });

    if (!proProfile?.offer) return res.status(404).json({ error: 'No offer found' });

    // Toggle le statut
    const updatedOffer = await prisma.proOffer.update({
      where: { id: proProfile.offer.id },
      data: { isActive: !proProfile.offer.isActive }
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
