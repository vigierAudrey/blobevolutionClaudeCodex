import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.guard';
import { prisma } from '@blobinfini/database';
import { Prisma } from '@prisma/client';
import { cacheService, CacheKeys } from '../../services/cache.service';

export const matchingRouter = Router();

const sportEnum = z.enum(['surf', 'kitesurf']);
const levelEnum = z.enum(['beginner', 'intermediate', 'advanced']);

const partnerEnum = z.enum(['ALL', 'WOMEN', 'MEN']);

const searchSchema = z.object({
  sport: sportEnum,
  level: levelEnum,
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|anytime)$/), // YYYY-MM-DD or "anytime"
  partner: partnerEnum.optional(),
  distanceKm: z.number().int().min(1).max(500).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  // Cursor-based pagination
  cursor: z.string().optional(), // Profile ID to start after
  limit: z.number().int().min(1).max(100).optional().default(50),
  // Legacy pagination support (deprecated)
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  sortBy: z.enum(['distance','name']).optional().default('distance'),
  excludeIds: z.array(z.string()).optional(),
});

matchingRouter.post('/search', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { sport, level, date, partner, distanceKm, location, cursor, limit, page, pageSize, sortBy } = searchSchema.parse(req.body);

    const partnerPref = partner ?? 'WOMEN';

    // Ensure we have a profile to read preferences from
    let profile = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.riderProfile.create({ data: { userId } });
    }

    // Pull last search to provide sensible defaults if not provided
    const last = await prisma.lastSearch.findUnique({ where: { userId } });

    const effectiveLocation = location ?? (last?.lat && last?.lng ? { lat: last.lat, lng: last.lng } : undefined) ??
      (profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : undefined) ?? null;

    // Compose criteria using profile preferences (distance, etc.)
    const criteria = {
      sport,
      level,
      date,
      maxDistanceKm: distanceKm ?? last?.distanceKm ?? profile.maxDistanceKm,
      emailNotif: profile.emailNotif,
      location: effectiveLocation,
      partnerPref,
    } as const;

    // Persist last search (for defaults next time)
    const dateValue = date === 'anytime' ? null : new Date(date + 'T00:00:00Z');
    await prisma.lastSearch.upsert({
      where: { userId },
      create: {
        userId,
        sport,
        level,
        distanceKm: criteria.maxDistanceKm,
        lat: effectiveLocation?.lat ?? null,
        lng: effectiveLocation?.lng ?? null,
        date: dateValue,
      },
      update: {
        sport,
        level,
        distanceKm: criteria.maxDistanceKm,
        lat: effectiveLocation?.lat ?? null,
        lng: effectiveLocation?.lng ?? null,
        date: dateValue,
      },
    });

    // If no location provided, return empty results (no DB dependency in this path)
    if (!criteria.location) {
      return res.json({
        criteria,
        results: [],
        hasMore: false,
        nextCursor: null,
        // Legacy pagination support
        total: 0,
        page: page || 1,
        pageSize: pageSize || limit
      });
    }

    // Determine pagination method (cursor-based preferred, fallback to offset)
    const useCursorPagination = cursor !== undefined || !page;
    const effectiveLimit = limit || pageSize || 50;

    // Check cache first for matching results (cursor-aware)
    const cacheKey = useCursorPagination
      ? `${CacheKeys.matching(sport, level, criteria.location.lat, criteria.location.lng, criteria.maxDistanceKm || 50)}:cursor:${cursor || 'start'}`
      : CacheKeys.matching(sport, level, criteria.location.lat, criteria.location.lng, criteria.maxDistanceKm || 50);

    const cachedResults = await cacheService.getMatchingResults(cacheKey);
    if (cachedResults && cacheService.isAvailable()) {
      console.log('🚀 Cache hit for matching results');

      // Apply exclusions to cached results
      const excludeIds = req.body.excludeIds || [];
      const filtered = cachedResults.filter(result => !excludeIds.includes(result.id));

      if (useCursorPagination) {
        // Cursor-based pagination on cached results
        const startIndex = cursor ? filtered.findIndex(r => r.id === cursor) + 1 : 0;
        const endIndex = Math.min(startIndex + effectiveLimit, filtered.length);
        const paginatedResults = filtered.slice(startIndex, endIndex);
        const nextCursor = endIndex < filtered.length ? filtered[endIndex - 1].id : null;

        return res.json({
          criteria,
          results: paginatedResults,
          hasMore: endIndex < filtered.length,
          nextCursor,
          cached: true
        });
      } else {
        // Legacy offset pagination on cached results
        const offset = ((page || 1) - 1) * effectiveLimit;
        const paginatedResults = filtered.slice(offset, offset + effectiveLimit);

        return res.json({
          criteria,
          results: paginatedResults,
          total: filtered.length,
          page: page || 1,
          pageSize: effectiveLimit,
          hasMore: offset + effectiveLimit < filtered.length,
          cached: true
        });
      }
    }

    // If we have a location, use PostGIS for distance + optional radius filtering
    let results: Array<{ id: string; displayName: string | null; gender: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED'; sport: string; level: string; distanceKm: number | null }> = [];
    let total = 0;
    let hasMore = false;
    let nextCursor: string | null = null;
    if (criteria.location) {
      const genderCond = Prisma.empty;

      const radiusCond = criteria.maxDistanceKm
        ? Prisma.sql`
            AND ST_DWithin(
              ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
              ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
              ${criteria.maxDistanceKm * 1000}
            )
          `
        : Prisma.empty;

      // Cursor-based or offset pagination
      let paginationCond = Prisma.empty;
      let limitClause = Prisma.sql`LIMIT ${effectiveLimit + 1}`; // +1 to check if more results exist

      if (useCursorPagination && cursor) {
        // Cursor-based: get results after the cursor ID
        paginationCond = Prisma.sql`AND rp."id" > ${cursor}`;
      } else if (!useCursorPagination && page) {
        // Legacy offset pagination
        const offset = (page - 1) * effectiveLimit;
        limitClause = Prisma.sql`LIMIT ${effectiveLimit} OFFSET ${offset}`;
      }

      const orderBy = sortBy === 'distance'
        ? Prisma.sql`ORDER BY dist_m ASC, rp."id" ASC` // Add ID for stable cursor ordering
        : Prisma.sql`ORDER BY rp."displayName" ASC NULLS LAST, rp."id" ASC`;

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

      // Count total matching rows (only for legacy pagination)
      if (!useCursorPagination) {
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
      }

      // Fetch paginated rows with computed distance
      const rows = await prisma.$queryRaw<Array<{ id: string; displayName: string | null; sex: any; sport: string; level: string; wantsLesson: boolean; lessonSport: string | null; dist_m: number | null }>>(
        Prisma.sql`
          SELECT rp."id", rp."displayName", rp."sex", rd."sport", rd."level", rp."wantsLesson", rp."lessonSport",
                 CASE
                   WHEN rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL THEN ST_Distance(
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
          ${paginationCond}
          ${orderBy}
          ${limitClause}
        `
      );

      // Process results and determine pagination metadata
      const processedRows = rows
        .filter((r) => r.dist_m == null || isFinite(r.dist_m));

      let actualResults = processedRows;

      if (useCursorPagination) {
        // For cursor pagination, check if we have more results (we fetched limit + 1)
        hasMore = processedRows.length > effectiveLimit;
        if (hasMore) {
          actualResults = processedRows.slice(0, effectiveLimit);
          nextCursor = actualResults[actualResults.length - 1]?.id || null;
        }
      } else {
        // Legacy pagination
        hasMore = ((page || 1) - 1) * effectiveLimit + processedRows.length < total;
      }

      results = actualResults.map((r) => ({
        id: r.id,
        displayName: r.displayName ?? 'Profil',
        gender: r.sex,
        sport: r.sport,
        level: r.level,
        wantsLesson: !!r.wantsLesson,
        lessonSport: r.lessonSport,
        distanceKm: r.dist_m == null ? null : Math.round(r.dist_m / 1000),
      }));

      // Cache the results for future requests (exclude user-specific filters)
      if (results.length > 0 && cacheService.isAvailable()) {
        // Get full results for caching (without pagination/exclusions)
        const fullResults = await prisma.$queryRaw<Array<{ id: string; displayName: string | null; sex: any; sport: string; level: string; wantsLesson: boolean; lessonSport: string | null; dist_m: number | null }>>(
          Prisma.sql`
            SELECT rp."id", rp."displayName", rp."sex", rd."sport", rd."level", rp."wantsLesson", rp."lessonSport",
                   CASE
                     WHEN rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL THEN ST_Distance(
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
            ${notAlreadyActedCond}
            ${orderBy}
            LIMIT 200
          `
        );

        const cacheData = fullResults
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

        await cacheService.setMatchingResults(cacheKey, cacheData, 300); // 5 minutes cache
        console.log(`💾 Cached ${cacheData.length} matching results`);
      }
    }

    // Return appropriate response format based on pagination method
    const responseNextCursor = nextCursor || (results.length > 0 ? results[results.length - 1].id : null);

    if (useCursorPagination) {
      return res.json({
        criteria,
        results,
        hasMore,
        nextCursor: responseNextCursor,
        // Include legacy fields for backward compatibility
        total: total || results.length,
        page: 1,
        pageSize: effectiveLimit
      });
    } else {
      return res.json({
        criteria,
        results,
        total,
        page: page || 1,
        pageSize: effectiveLimit,
        hasMore,
        // Include cursor fields for forward compatibility
        nextCursor: responseNextCursor
      });
    }
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
    // Optimized batch decisions - Fix N+1 queries
    const createdConversations: Array<{ conversationId: string; otherDisplayName: string | null }> = [];
    await prisma.$transaction(async (tx) => {
      // 1. Batch upsert all decisions first
      const decisions = items.map(it => ({
        where: { actorUserId_targetProfileId: { actorUserId: userId, targetProfileId: it.targetProfileId } as any },
        update: { decision: it.decision },
        create: { actorUserId: userId, targetProfileId: it.targetProfileId, decision: it.decision },
      }));

      // Process decisions in batch
      for (const decision of decisions) {
        await tx.matchDecision.upsert(decision);
      }

      // 2. Pre-fetch all target profiles in one query
      const acceptedItems = items.filter(it => it.decision === 'ACCEPT');
      if (acceptedItems.length === 0) return;

      const targetProfileIds = acceptedItems.map(it => it.targetProfileId);
      const targetProfiles = await tx.riderProfile.findMany({
        where: { id: { in: targetProfileIds } },
        select: { id: true, userId: true, displayName: true }
      });

      // 3. Get my profile once
      const myProfile = await tx.riderProfile.findUnique({
        where: { userId },
        select: { id: true }
      });
      if (!myProfile?.id) return;

      // 4. Pre-fetch all reciprocal decisions in one query
      const targetUserIds = targetProfiles.map(p => p.userId).filter(Boolean);
      const reciprocalDecisions = await tx.matchDecision.findMany({
        where: {
          actorUserId: { in: targetUserIds },
          targetProfileId: myProfile.id
        },
        select: { actorUserId: true, decision: true }
      });

      // 5. Create maps for efficient lookup
      const profileMap = new Map(targetProfiles.map(p => [p.id, p]));
      const reciprocalMap = new Map(reciprocalDecisions.map(r => [r.actorUserId, r.decision]));

      // 6. Process matches efficiently
      for (const it of acceptedItems) {
        const targetProfile = profileMap.get(it.targetProfileId);
        if (!targetProfile?.userId) continue;

        const targetUserId = targetProfile.userId;
        const reciprocalDecision = reciprocalMap.get(targetUserId);

        if (reciprocalDecision === 'ACCEPT') {
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
          createdConversations.push({
            conversationId: conv.id,
            otherDisplayName: targetProfile.displayName ?? 'Profil'
          });
        }
      }
    });
    return res.json({ ok: true, count: items.length, createdConversations });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});
