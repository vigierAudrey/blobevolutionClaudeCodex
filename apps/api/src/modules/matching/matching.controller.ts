import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.guard';
import { prisma } from '@blobinfini/database';

export const matchingRouter = Router();

const sportEnum = z.enum(['surf', 'kitesurf']);
const levelEnum = z.enum(['beginner', 'intermediate', 'advanced']);

const partnerEnum = z.enum(['ALL', 'WOMEN', 'MEN']);

const searchSchema = z.object({
  sport: sportEnum,
  level: levelEnum,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  partner: partnerEnum.optional(),
  distanceKm: z.number().int().min(1).max(500).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(50).optional().default(50),
  sortBy: z.enum(['distance','name']).optional().default('distance'),
});

matchingRouter.post('/search', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { sport, level, date, partner, distanceKm, location, page, pageSize, sortBy } = searchSchema.parse(req.body);

    // Ensure we have a profile to read preferences from
    let profile = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.riderProfile.create({ data: { userId } });
    }

    // Compose criteria using profile preferences (distance, partnerPref, etc.)
    const criteria = {
      sport,
      level,
      date,
      maxDistanceKm: distanceKm ?? profile.maxDistanceKm,
      partnerPref: partner ?? profile.partnerPref,
      emailNotif: profile.emailNotif,
      location: location ?? null,
    } as const;

    // Mock dataset (to be replaced by real search using PostGIS)
    type Mock = {
      id: string;
      displayName: string;
      gender: 'FEMALE' | 'MALE';
      sports: Array<{ sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced' }>;
      location?: { lat: number; lng: number };
    };
    const MOCKS: Mock[] = [
      {
        id: 'm1',
        displayName: 'Léa',
        gender: 'FEMALE',
        sports: [
          { sport: 'surf', level: 'beginner' },
          { sport: 'kitesurf', level: 'intermediate' },
        ],
        location: { lat: 48.8566, lng: 2.3522 }, // Paris
      },
      {
        id: 'm2',
        displayName: 'Hugo',
        gender: 'MALE',
        sports: [
          { sport: 'surf', level: 'intermediate' },
          { sport: 'kitesurf', level: 'advanced' },
        ],
        location: { lat: 43.2965, lng: 5.3698 }, // Marseille
      },
      {
        id: 'm3',
        displayName: 'Camille',
        gender: 'FEMALE',
        sports: [
          { sport: 'surf', level: 'beginner' },
          { sport: 'kitesurf', level: 'beginner' },
        ],
        location: { lat: 44.8378, lng: -0.5792 }, // Bordeaux
      },
      {
        id: 'm4',
        displayName: 'Noah',
        gender: 'MALE',
        sports: [
          { sport: 'surf', level: 'advanced' },
        ],
        location: { lat: 47.2184, lng: -1.5536 }, // Nantes
      },
    ];

    function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
      const R = 6371;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const la1 = (a.lat * Math.PI) / 180;
      const la2 = (b.lat * Math.PI) / 180;
      const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
      return 2 * R * Math.asin(Math.sqrt(x));
    }

    // Filter mocks
    const genderFilter = (g: 'FEMALE' | 'MALE') => {
      if (criteria.partnerPref === 'WOMEN') return g === 'FEMALE';
      if (criteria.partnerPref === 'MEN') return g === 'MALE';
      return true;
    };

    const sportLevelFilter = (m: Mock) => m.sports.some((s) => s.sport === sport && s.level === level);

    let results = MOCKS.filter((m) => genderFilter(m.gender) && sportLevelFilter(m)).map((m) => {
      let distanceKm: number | null = null;
      if (criteria.location && m.location) {
        distanceKm = Math.round(haversineKm(criteria.location, m.location));
      }
      return {
        id: m.id,
        displayName: m.displayName,
        gender: m.gender,
        sport,
        level,
        distanceKm,
      };
    });

    if (criteria.location && criteria.maxDistanceKm) {
      results = results.filter((r) => r.distanceKm == null || r.distanceKm <= criteria.maxDistanceKm);
    }

    // Sort
    if (sortBy === 'distance') {
      results.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    } else if (sortBy === 'name') {
      results.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
    }

    const total = results.length;
    const start = (page - 1) * pageSize;
    const pageResults = results.slice(start, start + pageSize);
    const hasMore = start + pageSize < total;

    return res.json({ criteria, results: pageResults, total, page, pageSize, hasMore });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});
