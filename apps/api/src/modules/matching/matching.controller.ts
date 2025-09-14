import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.guard';
import { prisma } from '@blobinfini/database';
import { Prisma } from '@prisma/client';

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
  excludeIds: z.array(z.string()).optional(),
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

    // Pull last search to provide sensible defaults if not provided
    const last = await prisma.lastSearch.findUnique({ where: { userId } });

    const effectiveLocation = location ?? (last?.lat && last?.lng ? { lat: last.lat, lng: last.lng } : undefined) ??
      (profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : undefined) ?? null;

    // Compose criteria using profile preferences (distance, partnerPref, etc.)
    const criteria = {
      sport,
      level,
      date,
      maxDistanceKm: distanceKm ?? last?.distanceKm ?? profile.maxDistanceKm,
      partnerPref: partner ?? profile.partnerPref,
      emailNotif: profile.emailNotif,
      location: effectiveLocation,
    } as const;

    // Persist last search (for defaults next time)
    await prisma.lastSearch.upsert({
      where: { userId },
      create: {
        userId,
        sport,
        level,
        partner: criteria.partnerPref,
        distanceKm: criteria.maxDistanceKm,
        lat: effectiveLocation?.lat ?? null,
        lng: effectiveLocation?.lng ?? null,
        date: new Date(date + 'T00:00:00Z'),
      },
      update: {
        sport,
        level,
        partner: criteria.partnerPref,
        distanceKm: criteria.maxDistanceKm,
        lat: effectiveLocation?.lat ?? null,
        lng: effectiveLocation?.lng ?? null,
        date: new Date(date + 'T00:00:00Z'),
      },
    });

    // If no location provided, return empty results (no DB dependency in this path)
    if (!criteria.location) {
      return res.json({ criteria, results: [], total: 0, page, pageSize, hasMore: false });
    }

    // If we have a location, use PostGIS for distance + optional radius filtering
    let results: Array<{ id: string; displayName: string | null; gender: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED'; sport: string; level: string; distanceKm: number | null }> = [];
    let total = 0;
    let hasMore = false;
    if (criteria.location) {
      const genderCond = criteria.partnerPref === 'WOMEN'
        ? Prisma.sql`AND rp."sex" = 'FEMALE'`
        : criteria.partnerPref === 'MEN'
          ? Prisma.sql`AND rp."sex" = 'MALE'`
          : Prisma.empty;

      const radiusCond = criteria.maxDistanceKm
        ? Prisma.sql`
            AND ST_DWithin(
              ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
              ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
              ${criteria.maxDistanceKm * 1000}
            )
          `
        : Prisma.empty;

      const offset = (page - 1) * pageSize;
      const orderBy = sortBy === 'distance'
        ? Prisma.sql`ORDER BY dist_m ASC`
        : Prisma.sql`ORDER BY rp."displayName" ASC NULLS LAST`;

      // Additional dynamic conditions
      const excludeCond = (req.body.excludeIds && Array.isArray(req.body.excludeIds) && req.body.excludeIds.length > 0)
        ? Prisma.sql`AND rp."id" NOT IN (${Prisma.join(req.body.excludeIds as string[])})`
        : Prisma.empty;

      const notAlreadyActedCond = Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "MatchDecision" md
          WHERE md."actorUserId" = ${userId} AND md."targetProfileId" = rp."id"
        )
      `;

      // Count total matching rows (for pagination metadata)
      const countRows = await prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM "RiderProfile" rp
          JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport} AND rd."level" = ${level}
          WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${userId}
          ${genderCond}
          ${radiusCond}
          ${excludeCond}
          ${notAlreadyActedCond}
        `
      );
      total = (countRows?.[0]?.count ?? 0) as number;

      // Fetch paginated rows with computed distance
      const rows = await prisma.$queryRaw<Array<{ id: string; displayName: string | null; sex: any; sport: string; level: string; wantsLesson: boolean; lessonSport: string | null; dist_m: number | null }>>(
        Prisma.sql`
          SELECT rp."id", rp."displayName", rp."sex", rd."sport", rd."level", rp."wantsLesson", rp."lessonSport",
                 CASE
                   WHEN rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL THEN ST_DistanceSphere(
                     ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
                     ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
                   )
                   ELSE NULL
                 END AS dist_m
          FROM "RiderProfile" rp
          JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport} AND rd."level" = ${level}
          WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${userId}
          ${genderCond}
          ${radiusCond}
          ${excludeCond}
          ${notAlreadyActedCond}
          ${orderBy}
          LIMIT ${pageSize} OFFSET ${offset}
        `
      );

      results = rows
        .filter((r) => r.dist_m == null || isFinite(r.dist_m))
        .map((r) => ({
          id: r.id,
          displayName: r.displayName ?? 'Profil',
          gender: r.sex,
          sport: r.sport,
          level: r.level,
          wantsLesson: !!r.wantsLesson,
          lessonSport: r.lessonSport,
          distanceKm: r.dist_m == null ? null : Math.round(r.dist_m / 1000),
        }));

      hasMore = offset + results.length < total;
    }

    return res.json({ criteria, results, total, page, pageSize, hasMore });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Record a decision (accept/refuse) for a target profile
const decisionSchema = z.object({ targetProfileId: z.string().uuid(), decision: z.enum(['ACCEPT','REFUSE']) });
matchingRouter.post('/decision', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { targetProfileId, decision } = decisionSchema.parse(req.body);
    const createdConversations: Array<{ conversationId: string; otherDisplayName: string | null }> = [];
    await prisma.$transaction(async (tx) => {
      await tx.matchDecision.upsert({
        where: { actorUserId_targetProfileId: { actorUserId: userId, targetProfileId } as any },
        update: { decision },
        create: { actorUserId: userId, targetProfileId, decision },
      });
      if (decision === 'ACCEPT') {
        const targetProfile = await tx.riderProfile.findUnique({ where: { id: targetProfileId }, select: { userId: true, displayName: true } });
        if (targetProfile?.userId) {
          const myProfile = await tx.riderProfile.findUnique({ where: { userId }, select: { id: true } });
          if (myProfile?.id) {
            const reciprocal = await tx.matchDecision.findUnique({
              where: { actorUserId_targetProfileId: { actorUserId: targetProfile.userId, targetProfileId: myProfile.id } as any },
              select: { decision: true },
            });
            if (reciprocal?.decision === 'ACCEPT') {
              const [one, two] = userId < targetProfile.userId ? [userId, targetProfile.userId] : [targetProfile.userId, userId];
              const match = await tx.match.upsert({
                where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } as any },
                update: { status: 'ACTIVE' },
                create: { userOneId: one, userTwoId: two, status: 'ACTIVE' },
              });
              let conv = await tx.conversation.findFirst({ where: { matchId: match.id } });
              if (!conv) {
                conv = await tx.conversation.create({ data: { matchId: match.id } });
                await tx.conversationMember.createMany({
                  data: [
                    { conversationId: conv.id, userId: userId },
                    { conversationId: conv.id, userId: targetProfile.userId },
                  ],
                  skipDuplicates: true,
                });
              }
              createdConversations.push({ conversationId: conv.id, otherDisplayName: targetProfile.displayName ?? 'Profil' });
            }
          }
        }
      }
    });
    return res.json({ ok: true, createdConversations });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Batch decisions
matchingRouter.post('/decisions', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const schema = z.object({ items: z.array(z.object({ targetProfileId: z.string().uuid(), decision: z.enum(['ACCEPT','REFUSE']) })).max(100) });
    const { items } = schema.parse(req.body || { items: [] });
    if (items.length === 0) return res.json({ ok: true, count: 0 });
    // Upsert decisions and compute new matches
    const createdConversations: Array<{ conversationId: string; otherDisplayName: string | null }> = [];
    await prisma.$transaction(async (tx) => {
      for (const it of items) {
        await tx.matchDecision.upsert({
          where: { actorUserId_targetProfileId: { actorUserId: userId, targetProfileId: it.targetProfileId } as any },
          update: { decision: it.decision },
          create: { actorUserId: userId, targetProfileId: it.targetProfileId, decision: it.decision },
        });
        if (it.decision === 'ACCEPT') {
          // Check reciprocal accept
          const targetProfile = await tx.riderProfile.findUnique({ where: { id: it.targetProfileId }, select: { userId: true, displayName: true } });
          if (!targetProfile?.userId) continue;
          const targetUserId = targetProfile.userId;
          const myProfile = await tx.riderProfile.findUnique({ where: { userId }, select: { id: true } });
          if (!myProfile?.id) continue;
          const reciprocal = await tx.matchDecision.findUnique({
            where: { actorUserId_targetProfileId: { actorUserId: targetUserId, targetProfileId: myProfile.id } as any },
            select: { decision: true },
          });
          if (reciprocal?.decision === 'ACCEPT') {
            // Create Match (canonical order by userId)
            const [one, two] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
            const match = await tx.match.upsert({
              where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } as any },
              update: { status: 'ACTIVE' },
              create: { userOneId: one, userTwoId: two, status: 'ACTIVE' },
            });
            // Create Conversation if not exists
            let conv = await tx.conversation.findFirst({
              where: { matchId: match.id },
            });
            if (!conv) {
              conv = await tx.conversation.create({ data: { matchId: match.id } });
              await tx.conversationMember.createMany({
                data: [
                  { conversationId: conv.id, userId: userId },
                  { conversationId: conv.id, userId: targetUserId },
                ],
                skipDuplicates: true,
              });
            }
            createdConversations.push({ conversationId: conv.id, otherDisplayName: targetProfile.displayName ?? 'Profil' });
          }
        }
      }
    });
    return res.json({ ok: true, count: items.length, createdConversations });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});
