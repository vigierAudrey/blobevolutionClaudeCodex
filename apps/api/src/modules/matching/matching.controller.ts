import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { cacheService, CacheKeys } from '../../services/cache.service';
import { notifyNewMatch, notifyMatchDecision, notifyNewMatchingCard } from '../../lib/socket';
import { recordServerAnalyticsEvent } from '../../services/analytics/events.service';

export const matchingRouter = Router();
matchingRouter.use(requireAuth, requireVerifiedEmail);

const sportEnum = z.enum(['surf', 'kitesurf']);
const levelEnum = z.enum(['beginner', 'intermediate', 'advanced', 'anytime']);

const getConsentHash = (req: Request) => {
  const header = req.headers['x-consent-hash'];
  return typeof header === 'string' && header.trim().length > 0 ? header : null;
};

const searchSchema = z.object({
  sport: sportEnum,
  level: levelEnum,
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|anytime)$/), // YYYY-MM-DD or "anytime"
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

type GeospatialMatchRow = {
  id: string;
  displayName: string | null;
  sex: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED' | null;
  photoUrl: string | null;
  bio: string | null;
  sport: string;
  level: string;
  wantsLesson: boolean;
  lessonSport: string | null;
  dist_m: number | null;
};

type MatchingResponseItem = {
  id: string;
  displayName: string;
  gender: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED' | null;
  photoUrl: string | null;
  bio: string | null;
  sport: string;
  level: string;
  wantsLesson: boolean;
  lessonSport: string | null;
  distanceKm: number | null;
};

type TargetProfileSummary = Prisma.RiderProfileGetPayload<{
  select: { id: true; userId: true; displayName: true };
}>;
type ReciprocalDecisionSummary = Prisma.MatchDecisionGetPayload<{
  select: { actorUserId: true; decision: true };
}>;

matchingRouter.post('/search', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { sport, level, date, distanceKm, location, cursor, limit, page, pageSize, sortBy } = searchSchema.parse(req.body);

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

    // Check cache first for matching results (cursor-aware and date-aware)
    const baseCacheKey = `${CacheKeys.matching(sport, level, criteria.location.lat, criteria.location.lng, criteria.maxDistanceKm || 50)}:date:${date}`;
    const cacheKey = useCursorPagination
      ? `${baseCacheKey}:cursor:${cursor || 'start'}`
      : baseCacheKey;

    const cachedResults = await cacheService.getMatchingResults(cacheKey);
    if (cachedResults && cacheService.isAvailable()) {
      const myProfileId = profile?.id ?? null;
      const excludeIdsSet = new Set<string>(
        Array.isArray(req.body.excludeIds) ? (req.body.excludeIds as string[]) : []
      );
      if (myProfileId) {
        excludeIdsSet.add(myProfileId);
      }

      const candidateIds = cachedResults.map((result) => result.id);
      let actedSet = new Set<string>();
      if (candidateIds.length > 0) {
        const actedDecisions: Array<{ targetProfileId: string }> = await prisma.matchDecision.findMany({
          where: { actorUserId: userId, targetProfileId: { in: candidateIds } },
          select: { targetProfileId: true }
        });
        actedSet = new Set(actedDecisions.map((decision) => decision.targetProfileId));
      }

      // Apply exclusions to cached results
      const filtered = cachedResults.filter((result) => {
        if (excludeIdsSet.has(result.id)) return false;
        if (actedSet.has(result.id)) return false;
        return true;
      });

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
    let results: MatchingResponseItem[] = [];
    let total = 0;
    let hasMore = false;
    let nextCursor: string | null = null;
    if (criteria.location) {
      const radiusCond = criteria.maxDistanceKm
        ? Prisma.sql`
            AND ST_DWithin(
              ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
              ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
              ${criteria.maxDistanceKm * 1000}
            )
          `
        : Prisma.empty;

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

      // Level filtering logic:
      // - If searcher chose "anytime": see all levels (no level filter)
      // - If searcher chose a specific level: see only that level
      const levelCond = level === 'anytime'
        ? Prisma.empty
        : Prisma.sql` AND rd."level" = ${level}`;

      // Date filtering logic:
      // - If searcher chose "anytime": see all profiles (no date filter)
      // - If searcher chose a specific date: see only profiles who chose that exact same date (not "anytime")
      const dateCond = date === 'anytime'
        ? Prisma.empty
        : Prisma.sql`
            AND ls."date" = ${new Date(date + 'T00:00:00Z')}
          `;

      // Count total matching rows (only for legacy pagination)
      if (!useCursorPagination) {
        const countRows = await prisma.$queryRaw<Array<{ count: number }>>(
          Prisma.sql`
            SELECT COUNT(*)::int AS count
            FROM "RiderProfile" rp
            JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport}${levelCond}
            LEFT JOIN "LastSearch" ls ON ls."userId" = rp."userId"
            WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${userId}
            ${radiusCond}
            ${excludeCond}
            ${notAlreadyActedCond}
            ${dateCond}
          `
        );
        total = (countRows?.[0]?.count ?? 0) as number;
      }

      // ✅ OPTIMIZATION: Single query with LIMIT 200, then filter/paginate in JS
      const rows = await prisma.$queryRaw<GeospatialMatchRow[]>(
        Prisma.sql`
          SELECT
            rp."id",
            rp."displayName",
            rp."sex",
            rp."photoUrl",
            rp."bio",
            rd."sport",
            rd."level",
            rp."wantsLesson",
            rp."lessonSport",
            CASE
              WHEN rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL THEN ST_Distance(
                ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
                ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
              )
              ELSE NULL
            END AS dist_m
          FROM "RiderProfile" rp
          JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport}${levelCond}
          LEFT JOIN "LastSearch" ls ON ls."userId" = rp."userId"
          WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${userId}
          ${radiusCond}
          ${excludeCond}
          ${notAlreadyActedCond}
          ${dateCond}
          ${orderBy}
          LIMIT 200
        `
      );

      // Process and filter results
      const allResults: MatchingResponseItem[] = rows
        .filter((r: GeospatialMatchRow) => r.dist_m == null || isFinite(r.dist_m))
        .map((r: GeospatialMatchRow) => ({
          id: r.id,
          displayName: r.displayName ?? 'Profil',
          gender: r.sex,
          photoUrl: r.photoUrl,
          bio: r.bio,
          sport: r.sport,
          level: r.level,
          wantsLesson: !!r.wantsLesson,
          lessonSport: r.lessonSport,
          distanceKm: r.dist_m == null ? null : Math.round(r.dist_m / 1000),
        }));

      // Apply client-side exclusions
      const excludeSet = new Set<string>(req.body.excludeIds || []);
      const filteredResults = allResults.filter((r: MatchingResponseItem) => !excludeSet.has(r.id));

      // Apply pagination in JavaScript
      let actualResults = filteredResults;

      if (useCursorPagination) {
        // Cursor-based pagination
        const startIndex = cursor ? filteredResults.findIndex((r: MatchingResponseItem) => r.id === cursor) + 1 : 0;
        const endIndex = Math.min(startIndex + effectiveLimit, filteredResults.length);
        actualResults = filteredResults.slice(startIndex, endIndex);
        hasMore = endIndex < filteredResults.length;
        nextCursor = hasMore && actualResults.length > 0 ? actualResults[actualResults.length - 1].id : null;
      } else {
        // Legacy offset pagination
        const offset = ((page || 1) - 1) * effectiveLimit;
        actualResults = filteredResults.slice(offset, offset + effectiveLimit);
        hasMore = offset + effectiveLimit < filteredResults.length;
        total = filteredResults.length;
      }

      results = actualResults;

      // Cache all results for future requests (reuse allResults, no second query needed)
      if (allResults.length > 0 && cacheService.isAvailable()) {
        await cacheService.setMatchingResults(cacheKey, allResults, 300); // 5 minutes cache
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
matchingRouter.post('/decision', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { targetProfileId, decision } = decisionSchema.parse(req.body);
    const createdConversations: Array<{ conversationId: string; otherDisplayName: string | null }> = [];
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

              // ✨ Notifier les deux utilisateurs du nouveau match (WebSocket)
              // Get my profile info for the notification
              const myFullProfile = await tx.riderProfile.findUnique({
                where: { userId },
                select: { displayName: true, photoUrl: true }
              });

              // Notifier l'autre utilisateur
              notifyNewMatch(targetProfile.userId, {
                matchId: match.id,
                conversationId: conv.id,
                otherUser: {
                  id: userId,
                  displayName: myFullProfile?.displayName || 'Un rider',
                  photoUrl: myFullProfile?.photoUrl
                }
              });

              // Notifier moi-même
              notifyNewMatch(userId, {
                matchId: match.id,
                conversationId: conv.id,
                otherUser: {
                  id: targetProfile.userId,
                  displayName: targetProfile.displayName || 'Un rider',
                  photoUrl: null // On pourrait fetch photoUrl ici si nécessaire
                }
              });
            } else {
              // ✨ Notifier l'autre utilisateur de ma décision (sans match mutuel)
              notifyMatchDecision(targetProfile.userId, {
                actorUserId: userId,
                decision: 'ACCEPT',
                mutualMatch: false
              });
            }
          }
        }
      }
    });
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'RIDER_MATCH_DECISION',
      actorType: 'RIDER',
      actorId: userId,
      consentHash,
      occurredAt: new Date(),
    });
    return res.json({ ok: true, createdConversations });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Batch decisions
matchingRouter.post('/decisions', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const schema = z.object({ items: z.array(z.object({ targetProfileId: z.string().uuid(), decision: z.enum(['ACCEPT','REFUSE']) })).max(100) });
    const { items } = schema.parse(req.body || { items: [] });
    if (items.length === 0) return res.json({ ok: true, count: 0 });
    // Optimized batch decisions - Fix N+1 queries
    const createdConversations: Array<{ conversationId: string; otherDisplayName: string | null }> = [];
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Batch upsert all decisions first
      const decisions = items.map((it) => ({
        where: { actorUserId_targetProfileId: { actorUserId: userId, targetProfileId: it.targetProfileId } as any },
        update: { decision: it.decision },
        create: { actorUserId: userId, targetProfileId: it.targetProfileId, decision: it.decision },
      }));

      // Process decisions in batch
      for (const decision of decisions) {
        await tx.matchDecision.upsert(decision);
      }

      // 2. Pre-fetch all target profiles in one query
      const acceptedItems = items.filter((it) => it.decision === 'ACCEPT');
      if (acceptedItems.length === 0) return;

      const targetProfileIds = acceptedItems.map((it) => it.targetProfileId);
      const targetProfiles: TargetProfileSummary[] = await tx.riderProfile.findMany({
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
      const targetUserIds = targetProfiles
        .map((p: TargetProfileSummary) => p.userId)
        .filter((id): id is string => Boolean(id));
      const reciprocalDecisions = await tx.matchDecision.findMany({
        where: {
          actorUserId: { in: targetUserIds },
          targetProfileId: myProfile.id
        },
        select: { actorUserId: true, decision: true }
      });

      // 5. Create maps for efficient lookup
      const profileMap = new Map<string, TargetProfileSummary>(
        targetProfiles.map((p: TargetProfileSummary) => [p.id, p])
      );
      const reciprocalMap = new Map<string, ReciprocalDecisionSummary['decision']>(
        reciprocalDecisions.map((r: ReciprocalDecisionSummary) => [r.actorUserId, r.decision])
      );

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
    const consentHash = getConsentHash(req);
    if (items.length > 0) {
      void recordServerAnalyticsEvent({
        eventType: 'RIDER_MATCH_DECISION',
        actorType: 'RIDER',
        actorId: userId,
        consentHash,
        occurredAt: new Date(),
      });
    }
    return res.json({ ok: true, count: items.length, createdConversations });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});
