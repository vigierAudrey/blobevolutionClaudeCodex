import { Router, type Request } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { CacheKeys } from '../../services/cache.service';
import { recordServerAnalyticsEvent } from '../../services/analytics/events.service';
import { mapErrorToApiError, sendError, sendOk, wantsEnvelope } from '../../utils/api-response';
import { ERROR_CODES } from '../../utils/error-codes';
import { secureLogger } from '../../utils/secure-logger';
import * as matchingMetrics from '../../lib/matching-metrics';
import { checkDecisionsQuota, refundDecisionsQuota } from '../../lib/matching-quota';
import { createGeoEndpointLimiter } from '../../middleware/enhanced-rate-limit';

export const matchingRouter = Router();
matchingRouter.use(requireAuth, requireVerifiedEmail);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Minimum post-commit pair limit enforced in production to prevent misconfiguration. */
const POST_COMMIT_MIN_LIMIT_PROD = 5;
/** Default post-commit pair limit when env var is absent. */
const POST_COMMIT_DEFAULT_LIMIT = 50;
const MATCHING_CURSOR_VERSION = 1;

const matchingSearchBurstLimiter = createGeoEndpointLimiter('matching_search', 'GEO_HEAVY_BURST');
const matchingSearchMinuteLimiter = createGeoEndpointLimiter('matching_search', 'GEO_HEAVY_MINUTE');

// ─────────────────────────────────────────────────────────────────────────────
// Enums & schemas
// ─────────────────────────────────────────────────────────────────────────────

const sportEnum = z.enum(['surf', 'kitesurf']);
const levelEnum = z.enum(['beginner', 'intermediate', 'advanced', 'anytime']);

const getConsentHash = (req: Request) => {
  const header = req.headers['x-consent-hash'];
  return typeof header === 'string' && header.trim().length > 0 ? header : null;
};

/**
 * excludeIds normalisation:
 *   1. Enforce max(200) BEFORE filtering → ZodError with path=['excludeIds'] on violation.
 *   2. Filter out non-string and non-UUID items (do not reject — just ignore).
 *   3. Deduplicate and lowercase.
 */
const searchSchema = z.object({
  sport: sportEnum,
  level: levelEnum,
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|anytime)$/), // YYYY-MM-DD or "anytime"
  distanceKm: z.number().int().min(1).max(500).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  // Cursor-based pagination (opaque keyset token)
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  // Legacy pagination support (deprecated)
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  sortBy: z.enum(['distance', 'name']).optional().default('distance'),
  // P1: bounded (max 200), normalised (UUID-only, deduped, lowercase), never req.body raw
  excludeIds: z
    .array(z.unknown())
    .max(200)
    .optional()
    .default([])
    .transform((arr) =>
      [
        ...new Set(
          (arr ?? [])
            .filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id))
            .map((id) => id.toLowerCase()),
        ),
      ],
    ),
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
  name_null_rank: number;
  name_sort: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Helper: canonical cache key builder (cursor NOT included — anti-amplification)
// Exported for unit-testing in matching.cache.unit.test.ts
// ─────────────────────────────────────────────────────────────────────────────

export function buildMatchingCacheKey(
  sport: string,
  level: string,
  lat: number,
  lng: number,
  radius: number,
  date: string,
  sortBy: string,
): string {
  return `${CacheKeys.matching(sport, level, lat, lng, radius)}:date:${date}:sort:${sortBy}`;
}

type DistanceCursorPayload = {
  v: number;
  s: 'distance';
  d: number;
  i: string;
};

type NameCursorPayload = {
  v: number;
  s: 'name';
  n: string;
  k: 0 | 1;
  i: string;
};

type MatchingCursorPayload = DistanceCursorPayload | NameCursorPayload;

function encodeCursor(payload: MatchingCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, sortBy: 'distance' | 'name'): MatchingCursorPayload | null {
  if (!cursor) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  if (!decoded || typeof decoded !== 'object') {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  const raw = decoded as Record<string, unknown>;
  if (raw.v !== MATCHING_CURSOR_VERSION || raw.s !== sortBy || typeof raw.i !== 'string' || !UUID_REGEX.test(raw.i)) {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  if (sortBy === 'distance') {
    if (typeof raw.d !== 'number' || !Number.isFinite(raw.d)) {
      throw Object.assign(new Error('Invalid cursor'), { status: 400 });
    }
    return { v: MATCHING_CURSOR_VERSION, s: 'distance', d: raw.d, i: raw.i };
  }

  if (typeof raw.n !== 'string' || (raw.k !== 0 && raw.k !== 1)) {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  return { v: MATCHING_CURSOR_VERSION, s: 'name', n: raw.n, k: raw.k, i: raw.i };
}

const matchingResultSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED']).nullable(),
  photoUrl: z.string().nullable(),
  bio: z.string().nullable().optional(),
  sport: z.string(),
  level: z.string(),
  wantsLesson: z.boolean(),
  lessonSport: z.string().nullable(),
  distanceKm: z.number().nullable(),
});

const matchingSearchResponseSchema = z.object({
  criteria: z.any().optional(),
  results: z.array(matchingResultSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullable().optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  cached: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Prisma error code extractor
// ─────────────────────────────────────────────────────────────────────────────

function getPrismaErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as Record<string, unknown>).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: classify errors for conditional quota refund
// Exported for unit tests — no side effects.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the error represents a server-side fault (5xx) that should
 * trigger a quota refund.  Returns false for client errors (4xx: validation,
 * auth, business rules) that the user intentionally caused.
 *
 * Decision table:
 *   ZodError                → false (validation 400)
 *   QUOTA_EXCEEDED code     → false (rate limit 429, intentional)
 *   Prisma P2xxx            → false (constraint / not-found → 4xx)
 *   Prisma P1xxx            → true  (infrastructure 503)
 *   HttpException status≥500→ true
 *   Unknown / unexpected    → true  (safe default: refund on uncertainty)
 */
export function isServerError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'ZodError') return false;
  if (err && typeof err === 'object' && (err as any).code === 'QUOTA_EXCEEDED') return false;

  const prismaCode = getPrismaErrorCode(err);
  if (prismaCode) {
    if (prismaCode.startsWith('P2')) return false; // constraint / not-found → 4xx
    if (prismaCode.startsWith('P1')) return true;  // infrastructure → 5xx
  }

  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as any).status;
    if (typeof status === 'number') return status >= 500;
  }

  return true; // unknown → assume server error (safe default)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: post-commit mini-TX for a single mutual pair
// Returns 'success' | 'pending' (for reconcile) | 'skip' (fallback failed)
// ─────────────────────────────────────────────────────────────────────────────

type PairResult = { type: 'success'; conversationId: string } | { type: 'pending' } | { type: 'skip' };

async function processMutualPair(userId: string, targetUserId: string): Promise<PairResult> {
  const [one, two] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];

  const runMiniTx = async (): Promise<string> => {
    let convId = '';
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
            { conversationId: conv.id, userId },
            { conversationId: conv.id, userId: targetUserId },
          ],
          skipDuplicates: true,
        });
      }
      convId = conv.id;
    });
    return convId;
  };

  try {
    const conversationId = await runMiniTx();
    return { type: 'success', conversationId };
  } catch (err) {
    const code = getPrismaErrorCode(err);

    // P1017 / P1001: transient connection reset → retry once
    if (code === 'P1017' || code === 'P1001') {
      try {
        const conversationId = await runMiniTx();
        return { type: 'success', conversationId };
      } catch {
        return { type: 'pending' };
      }
    }

    // P2002: unique constraint (concurrent insert) → fallback read existing rows
    if (code === 'P2002') {
      try {
        const match = await prisma.match.findUnique({
          where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } as any },
          select: { id: true },
        });
        if (!match) return { type: 'skip' };
        const conv = await prisma.conversation.findFirst({
          where: { matchId: match.id },
          select: { id: true },
        });
        if (!conv) return { type: 'skip' };
        // Idempotent: add members if not already present
        await prisma.conversationMember.createMany({
          data: [
            { conversationId: conv.id, userId },
            { conversationId: conv.id, userId: targetUserId },
          ],
          skipDuplicates: true,
        });
        return { type: 'success', conversationId: conv.id };
      } catch {
        return { type: 'skip' };
      }
    }

    // Other error → schedule for reconcile pass
    return { type: 'pending' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /matching/search
// ─────────────────────────────────────────────────────────────────────────────

matchingRouter.post('/search', matchingSearchBurstLimiter, matchingSearchMinuteLimiter, async (req, res) => {
  const envelope = wantsEnvelope(req);
  const _searchStart = Date.now();
  matchingMetrics.incSearchRequest();
  // Record latency + classify errors once the response is flushed.
  res.on('finish', () => {
    matchingMetrics.recordSearchLatency(Date.now() - _searchStart);
    if (res.statusCode >= 500) matchingMetrics.incSearchError5xx();
    else if (res.statusCode >= 400) matchingMetrics.incSearchError4xx();
  });
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      return envelope
        ? sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
        : res.status(401).json({ error: 'Unauthorized' });
    }
    const role = (req as any).user?.role as string | undefined;
    if (role && role !== 'RIDER') {
      return envelope
        ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Forbidden')
        : res.status(403).json({ error: 'Forbidden' });
    }

    // P1 fix: excludeIds validated/normalised/bounded by Zod schema (not req.body raw)
    const { sport, level, date, distanceKm, location, cursor, limit, page, pageSize, sortBy, excludeIds } =
      searchSchema.parse(req.body);

    // Ensure we have a profile to read preferences from
    let profile = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.riderProfile.create({ data: { userId } });
    }

    // Pull last search to provide sensible defaults (distance, not location)
    const last = await prisma.lastSearch.findUnique({ where: { userId } });

    // Privacy invariant: location is ONLY used when explicitly provided in the request body.
    // Stored lat/lng (lastSearch or profile) are NOT used as fallback — this ensures
    // consistent, oracle-free behaviour regardless of stored profile data.
    const effectiveLocation = location ?? null;

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

    const effectiveLimit = limit || pageSize || 50;
    if ((page ?? 1) > 1 && !cursor) {
      throw Object.assign(new Error('Page-based pagination beyond page=1 is no longer supported. Use nextCursor.'), { status: 400 });
    }
    const decodedCursor = decodeCursor(cursor, sortBy);

    // If no location provided, return empty results
    if (!criteria.location) {
      const payload = {
        criteria,
        results: [],
        hasMore: false,
        nextCursor: null,
        page: 1,
        pageSize: effectiveLimit,
      };
      const parsedPayload = matchingSearchResponseSchema.parse(payload);
      return envelope ? sendOk(res, 200, parsedPayload) : res.json(payload);
    }

    // Query PostGIS
    matchingMetrics.incSearchCacheMiss();

    // PostGIS geospatial query
    let results: MatchingResponseItem[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;
    if (criteria.location) {
      const distanceExpr = Prisma.sql`
        ST_Distance(
          ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
          ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography
        )
      `;

      const radiusCond = criteria.maxDistanceKm
        ? Prisma.sql`
            AND ST_DWithin(
              ST_MakePoint(${criteria.location.lng}, ${criteria.location.lat})::geography,
              ST_SetSRID(ST_MakePoint(rp."lng", rp."lat"), 4326)::geography,
              ${criteria.maxDistanceKm * 1000}
            )
          `
        : Prisma.empty;

      const orderBy =
        sortBy === 'distance'
          ? Prisma.sql`ORDER BY base.dist_m ASC, base."id" ASC`
          : Prisma.sql`ORDER BY base.name_null_rank ASC, base.name_sort ASC, base."id" ASC`;

      // P1 fix: use validated excludeIds (not req.body raw) in SQL
      const excludeCond =
        excludeIds.length > 0
          ? Prisma.sql`AND rp."id" NOT IN (${Prisma.join(excludeIds)})`
          : Prisma.empty;

      const notAlreadyActedCond = Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "MatchDecision" md
          WHERE md."actorUserId" = ${userId} AND md."targetProfileId" = rp."id"
        )
      `;

      const levelCond = level === 'anytime' ? Prisma.empty : Prisma.sql` AND rd."level" = ${level}`;

      const dateCond =
        date === 'anytime'
          ? Prisma.empty
          : Prisma.sql`
            AND ls."date" = ${new Date(date + 'T00:00:00Z')}
          `;
      const queryLimit = effectiveLimit + 1;
      const keysetCond =
        decodedCursor == null
          ? Prisma.empty
          : decodedCursor.s === 'distance'
            ? Prisma.sql`AND (base.dist_m, base."id") > (${decodedCursor.d}, ${decodedCursor.i})`
            : Prisma.sql`AND (base.name_null_rank, base.name_sort, base."id") > (${decodedCursor.k}, ${decodedCursor.n}, ${decodedCursor.i})`;

      const rows = await prisma.$queryRaw<GeospatialMatchRow[]>(
        Prisma.sql`
          WITH base AS (
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
              ${distanceExpr} AS dist_m,
              CASE WHEN rp."displayName" IS NULL THEN 1 ELSE 0 END AS name_null_rank,
              COALESCE(rp."displayName", '') AS name_sort
            FROM "RiderProfile" rp
            JOIN "RiderDiscipline" rd ON rd."profileId" = rp."id" AND rd."sport" = ${sport}${levelCond}
            LEFT JOIN "LastSearch" ls ON ls."userId" = rp."userId"
            WHERE rp."lat" IS NOT NULL AND rp."lng" IS NOT NULL AND rp."userId" <> ${userId}
            ${radiusCond}
            ${excludeCond}
            ${notAlreadyActedCond}
            ${dateCond}
          )
          SELECT
            base."id",
            base."displayName",
            base."sex",
            base."photoUrl",
            base."bio",
            base."sport",
            base."level",
            base."wantsLesson",
            base."lessonSport",
            base.dist_m,
            base.name_null_rank,
            base.name_sort
          FROM base
          WHERE 1 = 1
          ${keysetCond}
          ${orderBy}
          LIMIT ${queryLimit}
        `,
      );

      const stableRows = rows
        .filter((r: GeospatialMatchRow) => r.dist_m == null || isFinite(r.dist_m))
        .slice(0, effectiveLimit);

      results = stableRows.map((r: GeospatialMatchRow) => ({
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

      hasMore = rows.length > effectiveLimit;
      if (hasMore && stableRows.length > 0) {
        const lastRow = stableRows[stableRows.length - 1];
        if (sortBy === 'distance') {
          nextCursor = encodeCursor({
            v: MATCHING_CURSOR_VERSION,
            s: 'distance',
            d: Number(lastRow.dist_m ?? 0),
            i: lastRow.id,
          });
        } else {
          nextCursor = encodeCursor({
            v: MATCHING_CURSOR_VERSION,
            s: 'name',
            n: lastRow.name_sort,
            k: lastRow.name_null_rank === 1 ? 1 : 0,
            i: lastRow.id,
          });
        }
      }
    }

    const payload = {
      criteria,
      results,
      hasMore,
      nextCursor,
      page: 1,
      pageSize: effectiveLimit,
    };
    const parsedPayload = matchingSearchResponseSchema.parse(payload);
    return envelope ? sendOk(res, 200, parsedPayload) : res.json(payload);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return envelope
        ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input', err.errors)
        : res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    const mapped = mapErrorToApiError(err);
    return envelope
      ? sendError(
          res,
          mapped.status,
          (mapped.code as string) || ERROR_CODES.INTERNAL_ERROR,
          mapped.message,
          mapped.details,
        )
      : res
          .status(mapped.status)
          .json({
            error: mapped.message,
            ...(mapped.details ? { details: mapped.details } : {}),
          });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /matching/decision  (legacy — removed)
// ─────────────────────────────────────────────────────────────────────────────

matchingRouter.post('/decision', (req, res) => {
  const envelope = wantsEnvelope(req);
  const message = 'This endpoint is removed. Use POST /matching/decisions.';
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', '2026-04-12T00:00:00Z');
  res.setHeader('Link', '</matching/decisions>; rel="alternate"');
  if (envelope) {
    return sendError(res, 410, ERROR_CODES.GONE, message, { redirect: '/matching/decisions' });
  }
  return res.status(410).json({ error: message, redirect: '/matching/decisions' });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /matching/decisions  (batch)
//
// Security invariants:
//   - RIDER-only (403 for any other role)
//   - self-target silently skipped and NOT written to DB
//   - all targetProfileIds must exist in DB (400 otherwise — oracle-hardened)
//   - per-user quota enforced inside main TX (429 on excess)
//   - items max(100) enforced by Zod (400 on excess)
//
// Post-commit pair processing:
//   - MATCHING_POST_COMMIT_PAIR_LIMIT (default 50) caps concurrent match creation
//   - In production, limit < 5 is clamped to 5 with POST_COMMIT_PAIR_LIMIT_CLAMPED warning
//   - P1017/P1001 → inline retry; P2002 → fallback read; other → pendingReconcile
//   - POST_COMMIT_SKIPPED_LIMIT warning logged for skipped pairs
//
// Response:
//   - No envelope: { ok: true, count, createdMatchesCount, createdConversations: [{ conversationId }] }
//   - With X-API-ENVELOPE: 1: sendOk wraps payload in { ok: true, data: { ... } }
// ─────────────────────────────────────────────────────────────────────────────

matchingRouter.post('/decisions', async (req, res) => {
  const envelope = wantsEnvelope(req);
  const requestId = randomUUID(); // ephemeral, for structured logs only — never in response
  const _decisionsStart = Date.now();
  matchingMetrics.incDecisionsRequest();
  res.on('finish', () => {
    matchingMetrics.recordDecisionsLatency(Date.now() - _decisionsStart);
    if (res.statusCode >= 500) matchingMetrics.incDecisionsError5xx();
    else if (res.statusCode >= 400) matchingMetrics.incDecisionsError4xx();
  });

  // Refund tracking — hoisted so catch block can access them.
  // _quotaWasCharged is set to true AFTER checkDecisionsQuota returns OK,
  // meaning Redis was incremented (or DB path used but TX may have rolled back).
  let _quotaWasCharged = false;
  let _quotaItemCount = 0;
  let _handlerUserId: string | undefined;

  try {
    const userId = (req as any).user?.id as string | undefined;
    _handlerUserId = userId;
    if (!userId) {
      return envelope
        ? sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
        : res.status(401).json({ error: 'Unauthorized' });
    }

    // P1: RIDER-only — PRO and ADMIN must not create match decisions
    const role = (req as any).user?.role as string | undefined;
    if (role !== 'RIDER') {
      return envelope
        ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Forbidden')
        : res.status(403).json({ error: 'Forbidden' });
    }

    // Hard cap: max 50 items per batch — reduces blast radius of a single request.
    // Production safety floor: configurable via MATCHING_DECISIONS_QUOTA_* env vars.
    const decisionsSchema = z.object({
      items: z
        .array(
          z.object({
            targetProfileId: z.string().uuid(),
            decision: z.enum(['ACCEPT', 'REFUSE']),
          }),
        )
        .max(50),
    });
    const { items } = decisionsSchema.parse(req.body ?? { items: [] });

    if (items.length === 0) {
      const payload = { count: 0, createdMatchesCount: 0, createdConversations: [] };
      return envelope
        ? sendOk(res, 200, payload)
        : res.json({ ok: true, ...payload });
    }

    // P1: look up my profile once — needed for self-target filter
    const myProfile = await prisma.riderProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    // P1: filter out self-target items BEFORE TX — they are never stored in DB
    const safeItems = myProfile?.id
      ? items.filter((it) => it.targetProfileId !== myProfile.id)
      : items;

    if (safeItems.length === 0) {
      const payload = { count: 0, createdMatchesCount: 0, createdConversations: [] };
      return envelope
        ? sendOk(res, 200, payload)
        : res.json({ ok: true, ...payload });
    }

    // P1: validate all targetProfileIds exist in DB (400 — oracle-hardened, same body for all)
    const targetProfileIds = [...new Set(safeItems.map((it) => it.targetProfileId))];
    const existingProfiles = await prisma.riderProfile.findMany({
      where: { id: { in: targetProfileIds } },
      select: { id: true, userId: true },
    });
    if (existingProfiles.length !== targetProfileIds.length) {
      return envelope
        ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input')
        : res.status(400).json({ error: 'Invalid input' });
    }

    // Count accept/refuse for metrics (before TX — counts attempted, not committed)
    matchingMetrics.incDecisionsAccept(safeItems.filter((it) => it.decision === 'ACCEPT').length);
    matchingMetrics.incDecisionsRefuse(safeItems.filter((it) => it.decision === 'REFUSE').length);

    // Main TX: quota check + batch upsert decisions
    _quotaItemCount = safeItems.length;
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await checkDecisionsQuota(tx, userId, safeItems.length);
      // Redis was incremented (or DB path used) — flag for conditional refund in catch.
      _quotaWasCharged = true;
      for (const item of safeItems) {
        await tx.matchDecision.upsert({
          where: {
            actorUserId_targetProfileId: {
              actorUserId: userId,
              targetProfileId: item.targetProfileId,
            } as any,
          },
          update: { decision: item.decision },
          create: {
            actorUserId: userId,
            targetProfileId: item.targetProfileId,
            decision: item.decision,
          },
        });
      }
    });

    // Optional delay for deterministic race-condition tests
    const testDelayMs = parseInt(process.env.MATCHING_TEST_DELAY_MS ?? '0', 10);
    if (!isNaN(testDelayMs) && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }

    // ── Post-commit: find reciprocal pairs and create matches ──────────────
    const createdConversations: Array<{ conversationId: string }> = [];

    const acceptedItems = safeItems.filter((it) => it.decision === 'ACCEPT');

    if (acceptedItems.length > 0 && myProfile?.id) {
      // Determine effective pair limit with production safety clamp
      const configuredLimitRaw = process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
      const configuredLimit =
        configuredLimitRaw !== undefined
          ? parseInt(configuredLimitRaw, 10)
          : POST_COMMIT_DEFAULT_LIMIT;
      const IS_PROD = process.env.NODE_ENV === 'production';
      let effectiveLimit = isNaN(configuredLimit) ? POST_COMMIT_DEFAULT_LIMIT : configuredLimit;

      if (IS_PROD && effectiveLimit < POST_COMMIT_MIN_LIMIT_PROD) {
        secureLogger.warn('POST_COMMIT_PAIR_LIMIT_CLAMPED', {
          requestId,
          configured: effectiveLimit,
          effective: POST_COMMIT_MIN_LIMIT_PROD,
        });
        effectiveLimit = POST_COMMIT_MIN_LIMIT_PROD;
      }

      // Batch-fetch target profiles
      const acceptedTargetIds = acceptedItems.map((it) => it.targetProfileId);
      const targetProfiles = await prisma.riderProfile.findMany({
        where: { id: { in: acceptedTargetIds } },
        select: { id: true, userId: true },
      });

      type ProfileEntry = { id: string; userId: string };
      const profileMap = new Map<string, ProfileEntry>(
        targetProfiles.map((p: ProfileEntry) => [p.id, p] as [string, ProfileEntry]),
      );

      // Batch-fetch reciprocal ACCEPT decisions toward my profile
      const targetUserIds = targetProfiles
        .map((p: ProfileEntry) => p.userId)
        .filter((id: string): id is string => Boolean(id));

      const reciprocalDecisions = await prisma.matchDecision.findMany({
        where: {
          actorUserId: { in: targetUserIds },
          targetProfileId: myProfile.id,
          decision: 'ACCEPT',
        },
        select: { actorUserId: true },
      });
      const reciprocalSet = new Set(
        reciprocalDecisions.map((r: { actorUserId: string }) => r.actorUserId),
      );

      // Collect mutual pairs
      type MutualPair = { it: (typeof acceptedItems)[0]; targetUserId: string };
      const mutualPairs: MutualPair[] = acceptedItems
        .map((it) => {
          const tp = profileMap.get(it.targetProfileId);
          return tp?.userId && reciprocalSet.has(tp.userId)
            ? { it, targetUserId: tp.userId }
            : null;
        })
        .filter((p): p is MutualPair => p !== null);

      // Process pairs within budget
      const pendingReconcile: MutualPair[] = [];
      let pairsAttempted = 0;
      let skippedCount = 0;

      for (const pair of mutualPairs) {
        if (pairsAttempted >= effectiveLimit) {
          skippedCount++;
          continue;
        }
        pairsAttempted++;
        const result = await processMutualPair(userId, pair.targetUserId);
        if (result.type === 'success') {
          createdConversations.push({ conversationId: result.conversationId });
        } else if (result.type === 'pending') {
          pendingReconcile.push(pair);
        }
        // 'skip' (P2002 fallback not found) → silently ignored
      }

      if (skippedCount > 0) {
        secureLogger.warn('POST_COMMIT_SKIPPED_LIMIT', {
          requestId,
          skippedReciprocalPairsCount: skippedCount,
        });
      }

      // Reconcile: one retry pass for pairs that had transient failures
      for (const pair of pendingReconcile) {
        const result = await processMutualPair(userId, pair.targetUserId);
        if (result.type === 'success') {
          createdConversations.push({ conversationId: result.conversationId });
        }
      }
    }

    // Analytics (fire-and-forget)
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'RIDER_MATCH_DECISION',
      actorType: 'RIDER',
      actorId: userId,
      consentHash,
      occurredAt: new Date(),
    });

    const payload = {
      count: safeItems.length,
      createdMatchesCount: createdConversations.length,
      createdConversations,
    };
    return envelope
      ? sendOk(res, 200, payload)
      : res.json({ ok: true, ...payload });
  } catch (err: any) {
    const _durationMs = Date.now() - _decisionsStart;

    // ── Conditional quota refund ──────────────────────────────────────────────
    // Refund only when quota was charged AND the failure is server-side (5xx).
    // On 4xx (validation, auth, business rules) we keep the charge as abuse deterrent.
    if (_quotaWasCharged && _handlerUserId) {
      const serverFault = isServerError(err);
      if (serverFault) {
        void refundDecisionsQuota(_handlerUserId, _quotaItemCount);
        secureLogger.warn('matching_quota_refund_decision', {
          requestId,
          route: '/matching/decisions',
          method: 'POST',
          errorClass: err?.constructor?.name ?? 'Unknown',
          errorCode: err?.code ?? 'INTERNAL',
          refunded: true,
          reason: 'server_error_5xx',
          durationMs: _durationMs,
        });
      } else {
        secureLogger.warn('matching_quota_refund_decision', {
          requestId,
          route: '/matching/decisions',
          method: 'POST',
          errorClass: err?.constructor?.name ?? 'Unknown',
          errorCode: err?.code ?? 'INTERNAL',
          refunded: false,
          reason: 'client_error_4xx',
          durationMs: _durationMs,
        });
      }
    }

    // Zod validation
    if (err?.name === 'ZodError') {
      return envelope
        ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input', err.errors)
        : res.status(400).json({ error: 'Invalid input', details: err.errors });
    }

    // Per-user quota exceeded
    if (err?.code === 'QUOTA_EXCEEDED') {
      return envelope
        ? sendError(res, 429, ERROR_CODES.RATE_LIMITED, 'Too many requests')
        : res.status(429).json({ error: 'Too many requests' });
    }

    // Prisma infrastructure error (P1xxx) → 503 (never leak raw message)
    const prismaCode = getPrismaErrorCode(err);
    if (prismaCode?.startsWith('P1')) {
      return envelope
        ? sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
        : res.status(503).json({ error: 'Service unavailable' });
    }

    // Record not found
    if (prismaCode === 'P2025') {
      return envelope
        ? sendError(res, 404, 'NOT_FOUND', 'Not found')
        : res.status(404).json({ error: 'Not found' });
    }

    // Generic 500 — never expose raw message in production
    return envelope
      ? sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, 'Internal error')
      : res.status(500).json({ error: 'Internal error' });
  }
});
