import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'crypto';
import { z, ZodError } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { secureLogger } from '../../utils/secure-logger';
import { recordServerAnalyticsEvent } from '../../services/analytics/events.service';
import { notifyGroupInvitation, notifyNewMessage } from '../push/push.controller';
import { notifyUser } from '../../lib/socket';
import { createNotificationSilent, NotificationType } from '../../services/notification.service';
import { sendError, sendOk, wantsEnvelope } from '../../utils/api-response';
import { ERROR_CODES } from '../../utils/error-codes';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { getClientIp } from '../../lib/client-ip';
import { pollingRateLimit } from '../../middleware/polling-rate-limit';
import {
  conversationBlockEventService,
  ConversationBlockEventServiceError,
} from '../../services/conversation-block-event.service';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth, requireVerifiedEmail);

const getConsentHash = (req: Request) => {
  const header = req.headers['x-consent-hash'];
  return typeof header === 'string' && header.trim().length > 0 ? header : null;
};

const conversationMemberSelect = {
  conversation: {
    select: {
      id: true,
      type: true,
      updatedAt: true,
      match: {
        select: { userOneId: true, userTwoId: true, createdAt: true },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
      members: { select: { userId: true } },
    },
  },
  lastReadAt: true,
  trashedAt: true,
  archivedAt: true,
  purgeAt: true,
  favoritedAt: true,
  blockedAt: true,
} as const;

type ConversationMemberWithRelations = Prisma.ConversationMemberGetPayload<{
  select: typeof conversationMemberSelect;
}>;
type ConversationParticipant = ConversationMemberWithRelations['conversation']['members'][number];
type BasicUserSummary = Prisma.UserGetPayload<{ select: { id: true; role: true } }>;
type ProProfileSummary = Prisma.ProProfileGetPayload<{
  select: { userId: true; businessName: true; photoUrl: true };
}>;
type RiderProfileSummary = Prisma.RiderProfileGetPayload<{
  select: { userId: true; displayName: true; photoUrl: true };
}>;

const CONVERSATIONS_DEFAULT_LIMIT = 50;
const CONVERSATIONS_MAX_LIMIT = 100;
const MESSAGES_DEFAULT_LIMIT = 50;
const MESSAGES_MAX_LIMIT = 100;
const INVITATIONS_PENDING_MAX = 50;
const MESSAGE_COOLDOWN_MS = 30_000;
const MESSAGE_RATE_LIMIT_WINDOW_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeErrorMeta(error: unknown): { errorName?: string; errorCode?: string } {
  const record = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null;
  return {
    ...(typeof record?.name === 'string' ? { errorName: record.name } : {}),
    ...(typeof record?.code === 'string' ? { errorCode: record.code } : {}),
  };
}

function buildDirectConversationKey(userA: string, userB: string, conversationType: string): string {
  const participants = [userA, userB].sort();
  return `direct:${participants[0]}:${participants[1]}:${conversationType}`;
}

type ConversationListCursorPayload = {
  updatedAt: string;
  conversationId: string;
};

const conversationsListQuerySchema = z.object({
  // Legacy param — preserved for backwards compat. `scope` takes precedence if both present.
  includeTrashed: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => String(value ?? 'false').toLowerCase() === 'true'),
  // New param: explicit scope filter.
  scope: z.enum(['active', 'archived', 'trashed', 'all']).optional(),
  type: z.enum(['RIDER_TO_RIDER', 'RIDER_TO_PRO', 'PRO_TO_PRO']).optional(),
  limit: z.coerce.number().int().min(1).max(CONVERSATIONS_MAX_LIMIT).optional().default(CONVERSATIONS_DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

const messagesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MESSAGES_MAX_LIMIT).optional().default(MESSAGES_DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

function encodeConversationCursor(updatedAt: Date, conversationId: string): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: updatedAt.toISOString(),
      conversationId,
    } satisfies ConversationListCursorPayload),
    'utf8',
  ).toString('base64url');
}

function decodeConversationCursor(cursor: string | undefined): { updatedAt: Date; conversationId: string } | null {
  if (!cursor) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  if (!decoded || typeof decoded !== 'object') {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  const raw = decoded as Partial<ConversationListCursorPayload>;
  if (typeof raw.updatedAt !== 'string' || typeof raw.conversationId !== 'string' || !UUID_REGEX.test(raw.conversationId)) {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  const updatedAt = new Date(raw.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw Object.assign(new Error('Invalid cursor'), { status: 400 });
  }

  return { updatedAt, conversationId: raw.conversationId };
}

// ─── Archive / purge policy ────────────────────────────────────────────────────

/** Maximum active conversations per user before auto-archiving the oldest ones. */
export const ACTIVE_CONVERSATIONS_MAX = 100;

/** Months before an auto-archived conversation member is hard-deleted by the purge job. */
const ARCHIVE_PURGE_MONTHS = 18;

/**
 * Max conversations archived per single auto-archive pass.
 * Bounds the findMany + updateMany to at most 500 rows per GET /conversations call.
 * Users far above the limit converge progressively across successive calls.
 */
export const ARCHIVE_BATCH_CAP = 500;

type ConversationListScope = 'active' | 'archived' | 'trashed' | 'all';

/**
 * Resolves explicit `scope` param, falling back to legacy `includeTrashed` boolean.
 * Explicit `scope` always wins.
 */
function normalizeConversationScope(
  scope: ConversationListScope | undefined,
  includeTrashedLegacy: boolean,
): ConversationListScope {
  if (scope) return scope;
  return includeTrashedLegacy ? 'all' : 'active';
}

/** WHERE clause fragment for ConversationMember based on scope. */
function memberScopeWhere(scope: ConversationListScope): Prisma.ConversationMemberWhereInput {
  switch (scope) {
    case 'active':   return { archivedAt: null, trashedAt: null };
    case 'archived': return { archivedAt: { not: null }, trashedAt: null };
    case 'trashed':  return { trashedAt: { not: null } };
    case 'all':      return {};
  }
}

/**
 * Auto-archive the oldest active conversations when the user exceeds ACTIVE_CONVERSATIONS_MAX.
 *
 * Transaction + double-guard (archivedAt: null, trashedAt: null) prevents TOCTOU races.
 * ARCHIVE_BATCH_CAP bounds latency: at most 500 rows per call.
 */
export async function maybeAutoArchive(userId: string): Promise<number> {
  const archivedCount = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const activeCount = await tx.conversationMember.count({
      where: { userId, trashedAt: null, archivedAt: null },
    });
    if (activeCount <= ACTIVE_CONVERSATIONS_MAX) return 0;

    const toArchive = Math.min(activeCount - ACTIVE_CONVERSATIONS_MAX, ARCHIVE_BATCH_CAP);

    const oldest = await tx.conversationMember.findMany({
      where: { userId, trashedAt: null, archivedAt: null },
      orderBy: [{ conversation: { updatedAt: 'asc' } }, { conversation: { id: 'asc' } }],
      take: toArchive,
      select: { id: true },
    });

    if (oldest.length === 0) return 0;

    const now = new Date();
    const purgeAt = new Date(now);
    purgeAt.setMonth(purgeAt.getMonth() + ARCHIVE_PURGE_MONTHS);

    const result = await tx.conversationMember.updateMany({
      where: { id: { in: oldest.map((m: { id: string }) => m.id) }, archivedAt: null, trashedAt: null },
      data: { archivedAt: now, purgeAt },
    });
    return result.count;
  });

  if (archivedCount > 0) {
    secureLogger.info('chat.auto_archive.run', { archived_count: archivedCount });
  }
  return archivedCount;
}

// ─── ETag helpers ──────────────────────────────────────────────────────────────

/**
 * Computes a lightweight ETag fingerprint for GET /conversations.
 * Uses MAX(updatedAt) + COUNT from ConversationMember — scoped strictly to userId.
 * Always includes userId in the hash to prevent cross-user collisions.
 *
 * Cache-Control: private, no-store is set alongside — CDNs must never cache this.
 */
async function computeConversationListETag(
  userId: string,
  scope: ConversationListScope,
  convType: string | undefined,
): Promise<string> {
  // Two queries via Prisma ORM — avoids raw SQL fragment nesting ($N numbering bug).
  // Both queries are scoped strictly to userId — ETags cannot be shared across users.
  const scopeWhere = memberScopeWhere(scope);
  const typeWhere = convType
    ? { conversation: { is: { type: convType as 'RIDER_TO_RIDER' | 'RIDER_TO_PRO' | 'PRO_TO_PRO' } } }
    : {};

  const [cnt, latest] = await Promise.all([
    prisma.conversationMember.count({ where: { userId, ...scopeWhere, ...typeWhere } }),
    prisma.conversationMember.findFirst({
      where: { userId, ...scopeWhere, ...typeWhere },
      orderBy: { conversation: { updatedAt: 'desc' } },
      select: { conversation: { select: { updatedAt: true } } },
    }),
  ]);

  const maxTs = latest?.conversation?.updatedAt;
  const fingerprint = `${userId}:${scope}:${convType ?? ''}:${maxTs?.getTime() ?? 0}:${cnt}`;
  return `W/"${createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}"`;
}

// ─── End archive / ETag helpers ───────────────────────────────────────────────

function buildEnvelopeAwareRateLimitHandler(message: string, code: string, reason: string) {
  return (req: Request, res: Response) => {
    const rateLimitInfo = (req as { rateLimit?: { resetTime?: Date } }).rateLimit;
    const retryAfterSeconds =
      typeof rateLimitInfo?.resetTime?.getTime === 'function'
        ? Math.max(1, Math.ceil((rateLimitInfo.resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(MESSAGE_RATE_LIMIT_WINDOW_MS / 1000);
    res.setHeader('Retry-After', retryAfterSeconds.toString());

    if (wantsEnvelope(req)) {
      return sendError(res, 429, ERROR_CODES.RATE_LIMITED, message, {
        reason,
        retryAfterSeconds,
      });
    }

    return res.status(429).json({
      code,
      error: code,
      message,
      retryAfterSeconds,
    });
  };
}

const conversationsListLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      const ipToken = ipKeyGenerator(canonicalIp);
      return userId ? `conversation_list:user:${userId}` : `conversation_list:ip:${ipToken}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de rafraîchissements de conversations. Réessaie dans quelques instants.',
      'CONVERSATIONS_LIST_RATE_LIMITED',
      'CONVERSATIONS_LIST_RATE_LIMIT',
    ),
  },
  'conversation_list',
);

const conversationMessagesReadLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    max: 90,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      const conversationId = req.params.id ?? 'unknown';
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      const ipToken = ipKeyGenerator(canonicalIp);
      return userId
        ? `conversation_messages_read:user:${userId}:conversation:${conversationId}`
        : `conversation_messages_read:ip:${ipToken}:conversation:${conversationId}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de lectures de messages en peu de temps. Réessaie dans quelques instants.',
      'CONVERSATION_MESSAGES_READ_RATE_LIMITED',
      'CONVERSATION_MESSAGES_READ_RATE_LIMIT',
    ),
  },
  'conversation_messages_read',
);

const conversationMessagesGlobalLimiter = createLazyCustomRateLimiter(
  {
    windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      const ipToken = ipKeyGenerator(canonicalIp);
      return userId ? `conversation_messages_global:user:${userId}` : `conversation_messages_global:ip:${ipToken}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de messages envoyés en peu de temps. Réessaie dans quelques instants.',
      'CONVERSATION_MESSAGES_GLOBAL_RATE_LIMITED',
      'CONVERSATION_MESSAGES_GLOBAL_RATE_LIMIT',
    ),
  },
  'conversation_messages_global',
);

const conversationMessagesPerConversationLimiter = createLazyCustomRateLimiter(
  {
    windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      const conversationId = req.params.id ?? 'unknown';
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      const ipToken = ipKeyGenerator(canonicalIp);
      return userId
        ? `conversation_messages:user:${userId}:conversation:${conversationId}`
        : `conversation_messages:ip:${ipToken}:conversation:${conversationId}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de messages envoyés dans cette conversation. Réessaie dans quelques instants.',
      'CONVERSATION_MESSAGES_RATE_LIMITED',
      'CONVERSATION_MESSAGES_RATE_LIMIT',
    ),
  },
  'conversation_messages',
);

const conversationInvitationSendLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      if (userId) return `conversation_invitation_send:user:${userId}`;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `conversation_invitation_send:ip:${ipKeyGenerator(canonicalIp)}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop d’invitations envoyées en peu de temps. Réessaie dans quelques instants.',
      'CONVERSATION_INVITATION_RATE_LIMITED',
      'CONVERSATION_INVITATION_RATE_LIMIT',
    ),
  },
  'conversation_invitation_send',
);

const conversationInvitationRespondLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      if (userId) return `conversation_invitation_respond:user:${userId}`;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `conversation_invitation_respond:ip:${ipKeyGenerator(canonicalIp)}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de réponses aux invitations. Réessaie dans quelques instants.',
      'CONVERSATION_INVITATION_RESPOND_RATE_LIMITED',
      'CONVERSATION_INVITATION_RESPOND_RATE_LIMIT',
    ),
  },
  'conversation_invitation_respond',
);

// Lectures annexes d'une conversation (membres, invitations en attente,
// recherche d'utilisateurs). Sans limiter dédié, ces GET tombaient dans le
// bucket IP global MESSAGING (10 req/min) : ouvrir 2-3 conversations dans la
// minute suffisait à déclencher un 429 et à afficher « Membres (0) » en
// navigation normale. Budget par utilisateur, borné, headers standards.
const conversationReadLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      if (userId) return `conversation_read:user:${userId}`;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `conversation_read:ip:${ipKeyGenerator(canonicalIp)}`;
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Trop de requêtes de lecture en peu de temps. Réessaie dans quelques instants.',
      'CONVERSATION_READ_RATE_LIMITED',
      'CONVERSATION_READ_RATE_LIMIT',
    ),
  },
  'conversation_read',
);

// List conversations with last message + unread count (excludes trashed by default)
// Polling rate limit applied first — avoids requireVerifiedEmail DB lookup on 429.
conversationsRouter.get('/', pollingRateLimit, conversationsListLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { includeTrashed, scope: rawScope, type: convType, limit, cursor } = conversationsListQuerySchema.parse(req.query);

    const scope = normalizeConversationScope(rawScope, includeTrashed);

    // Auto-archive on active scope: keeps active count ≤ ACTIVE_CONVERSATIONS_MAX.
    // No-op if count is within limit (fast COUNT-only path).
    if (scope === 'active') {
      await maybeAutoArchive(userId);
    }

    // ETag: computed after auto-archive so the fingerprint reflects current state.
    // Cache-Control: private — must never be cached by proxies or CDNs.
    const etag = await computeConversationListETag(userId, scope, convType);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const decodedCursor = decodeConversationCursor(cursor);

    const conversationFilters: Prisma.ConversationWhereInput = {};
    if (convType) {
      conversationFilters.type = convType as any;
    }
    if (decodedCursor) {
      conversationFilters.OR = [
        { updatedAt: { lt: decodedCursor.updatedAt } },
        {
          AND: [
            { updatedAt: decodedCursor.updatedAt },
            { id: { lt: decodedCursor.conversationId } },
          ],
        },
      ];
    }

    const convs: ConversationMemberWithRelations[] = await prisma.conversationMember.findMany({
      where: {
        userId,
        ...memberScopeWhere(scope),
        ...(Object.keys(conversationFilters).length > 0 ? { conversation: { is: conversationFilters } } : {}),
      },
      select: conversationMemberSelect,
      orderBy: [{ conversation: { updatedAt: 'desc' } }, { conversationId: 'desc' }],
      take: limit + 1,
    });

    const hasMore = convs.length > limit;
    const filteredConvs: ConversationMemberWithRelations[] = convs.slice(0, limit);

    // === QUERY BATCHING: Load all data in 4 queries instead of N×4 ===

    // Step 1: Extract all other user IDs
    const otherUserIds = filteredConvs
      .map((cm: ConversationMemberWithRelations) =>
        cm.conversation.members.find((m: ConversationParticipant) => m.userId !== userId)?.userId
      )
      .filter((id): id is string => !!id);

    // Step 2: Batch load all users (1 query)
    const users: BasicUserSummary[] = otherUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: otherUserIds } },
          select: { id: true, role: true }
        })
      : [];

    // Step 3: Separate PRO and RIDER IDs
    const proIds = users.filter((u: BasicUserSummary) => u.role === 'PRO').map((u: BasicUserSummary) => u.id);
    const riderIds = users.filter((u: BasicUserSummary) => u.role !== 'PRO').map((u: BasicUserSummary) => u.id);

    // Step 4: Batch load PRO profiles (1 query)
    const proProfiles: ProProfileSummary[] = proIds.length > 0
      ? await prisma.proProfile.findMany({
          where: { userId: { in: proIds } },
          select: { userId: true, businessName: true, photoUrl: true }
        })
      : [];

    // Step 5: Batch load RIDER profiles (1 query)
    const riderProfiles: RiderProfileSummary[] = riderIds.length > 0
      ? await prisma.riderProfile.findMany({
          where: { userId: { in: riderIds } },
          select: { userId: true, displayName: true, photoUrl: true }
        })
      : [];

    // Step 6: Batch load unread counts with a single query (1 query)
    const conversationIds = filteredConvs.map((cm: ConversationMemberWithRelations) => cm.conversation.id);
    const unreadCountsRaw = conversationIds.length > 0
      ? await prisma.$queryRaw<Array<{ conversationId: string; count: bigint }>>(
          Prisma.sql`
            SELECT
              m."conversationId",
              COUNT(*) as count
            FROM "Message" m
            INNER JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId"
            WHERE
              m."conversationId" = ANY(${conversationIds}::text[])
              AND m."senderId" != ${userId}
              AND cm."userId" = ${userId}
              AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
            GROUP BY m."conversationId"
          `
        )
      : [];

    // Step 7: Create lookup maps for O(1) access
    const userMap = new Map<string, BasicUserSummary>(users.map((u: BasicUserSummary) => [u.id, u]));
    const proMap = new Map<string, ProProfileSummary>(
      proProfiles.map((p: ProProfileSummary) => [p.userId, p])
    );
    const riderMap = new Map<string, RiderProfileSummary>(
      riderProfiles.map((r: RiderProfileSummary) => [r.userId, r])
    );
    const unreadMap = new Map<string, number>(
      unreadCountsRaw.map((u: { conversationId: string; count: bigint }) => [u.conversationId, Number(u.count)])
    );

    // Step 8: Build results without additional DB queries
    const results = filteredConvs.map((cm: ConversationMemberWithRelations) => {
      const conv = cm.conversation;
      const memberCount = conv.members.length;
      const isGroup = memberCount > 2;
      const otherId = conv.members.find((m: ConversationParticipant) => m.userId !== userId)?.userId;

      let otherDisplayName = 'Profil';
      let otherRole = 'RIDER';
      let otherPhotoUrl: string | null = null;

      if (isGroup) {
        otherDisplayName = `Groupe (${memberCount} membres)`;
        otherRole = 'RIDER'; // Default pour les groupes
      } else if (otherId) {
        const user = userMap.get(otherId);
        otherRole = user?.role || 'RIDER';

        if (otherRole === 'PRO') {
          const proProfile = proMap.get(otherId);
          otherDisplayName = proProfile?.businessName || 'Professionnel';
          otherPhotoUrl = proProfile?.photoUrl || null;
        } else {
          const riderProfile = riderMap.get(otherId);
          otherDisplayName = riderProfile?.displayName || 'Rider';
          otherPhotoUrl = riderProfile?.photoUrl || null;
        }
      }

      const unread = unreadMap.get(conv.id) || 0;

      return {
        id: conv.id,
        type: conv.type,
        otherDisplayName,
        otherRole,
        otherPhotoUrl,
        lastMessage: conv.messages[0]?.content ?? '',
        lastAt: conv.messages[0]?.createdAt ?? conv.updatedAt,
        unread,
        trashed: !!cm.trashedAt,
        archived: !!cm.archivedAt,
        favorite: !!cm.favoritedAt,
        blocked: !!cm.blockedAt,
        memberCount,
        isGroup,
        matchedAt: conv.match?.createdAt ?? null,
      };
    });

    const lastConversation = filteredConvs[filteredConvs.length - 1]?.conversation;
    const nextCursor = hasMore && lastConversation
      ? encodeConversationCursor(lastConversation.updatedAt, lastConversation.id)
      : null;

    return res.json({ items: results, hasMore, nextCursor });
  } catch (e) {
    if ((e as { status?: number })?.status === 400) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }
    secureLogger.error('CONVERSATIONS_LIST_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ── Cursor composite pour messages ─────────────────────────────────────────────
// Cursor = base64url({ createdAt: ISO, messageId: UUID })
// Ordre stable : (createdAt DESC, id DESC) → résistant aux collisions de timestamp.
// Rétrocompatibilité : si le cursor est un ISO datetime brut (ancienne API),
// on le parse comme cursor "createdAt seulement" avec messageId vide.
// ───────────────────────────────────────────────────────────────────────────────

type MessageCursor = { createdAt: Date; messageId: string };

function encodeMessageCursor(createdAt: Date, messageId: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), messageId }),
    'utf8',
  ).toString('base64url');
}

function decodeMessageCursor(raw: string): MessageCursor | null {
  // Essayer d'abord le format composite base64url
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (decoded && typeof decoded.createdAt === 'string' && typeof decoded.messageId === 'string') {
      const createdAt = new Date(decoded.createdAt);
      if (!Number.isNaN(createdAt.getTime()) && UUID_REGEX.test(decoded.messageId)) {
        return { createdAt, messageId: decoded.messageId };
      }
    }
  } catch {
    // pas du JSON base64url — continuer
  }

  // Rétrocompatibilité : ancien cursor = ISO datetime brut
  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.getTime())) {
    // messageId vide → la condition (id < '') sera toujours false → équivalent à (createdAt < cursor) only
    return { createdAt: asDate, messageId: '' };
  }

  return null;
}

// Fetch messages (paginated by composite cursor createdAt+messageId — stable sur collisions de timestamp)
conversationsRouter.get('/:id/messages', conversationMessagesReadLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const { limit, cursor: rawCursor } = messagesListQuerySchema.parse(req.query);
    const member = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Not found' });

    const cursor = rawCursor ? decodeMessageCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }

    // Filtre keyset composite : (createdAt < cur) OU (createdAt = cur AND id < cur.messageId)
    const cursorWhere: Prisma.MessageWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            ...(cursor.messageId
              ? [{ AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.messageId } }] }]
              : []),
          ],
        }
      : undefined;

    const msgs = await prisma.message.findMany({
      where: { conversationId: id, ...cursorWhere },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // +1 to detect whether a next page exists without a COUNT query
      select: {
        id: true,
        senderId: true,
        type: true,
        content: true,
        meta: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    // Get sender profiles
    const proIds = msgs.filter((m: any) => m.sender.role === 'PRO').map((m: any) => m.senderId);
    const riderIds = msgs.filter((m: any) => m.sender.role !== 'PRO').map((m: any) => m.senderId);

    const proProfiles = proIds.length > 0
      ? await prisma.proProfile.findMany({
          where: { userId: { in: [...new Set(proIds)] } },
          select: { userId: true, businessName: true, photoUrl: true },
        })
      : [];

    const riderProfiles = riderIds.length > 0
      ? await prisma.riderProfile.findMany({
          where: { userId: { in: [...new Set(riderIds)] } },
          select: { userId: true, displayName: true, photoUrl: true },
        })
      : [];

    const proMap = new Map(proProfiles.map((p: any) => [p.userId, p]));
    const riderMap = new Map(riderProfiles.map((r: any) => [r.userId, r]));

    const messagesWithSenders = msgs.map((m: any) => {
      const isPro = m.sender.role === 'PRO';
      const profile = isPro ? proMap.get(m.senderId) : riderMap.get(m.senderId);
      const senderName = isPro
        ? (profile as any)?.businessName || 'Professionnel'
        : (profile as any)?.displayName || 'Rider';

      return {
        id: m.id,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        meta: m.meta,
        createdAt: m.createdAt,
        senderName,
        senderPhotoUrl: (profile as any)?.photoUrl || null,
        isCurrentUser: m.senderId === userId,
      };
    });

    // mark read
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } as any }, data: { lastReadAt: new Date() } });

    const hasMore = msgs.length > limit;
    const pageItems = hasMore ? msgs.slice(0, limit) : msgs;
    const lastMsg = pageItems[pageItems.length - 1];
    const nextCursor = hasMore && lastMsg
      ? encodeMessageCursor(lastMsg.createdAt, lastMsg.id)
      : null;

    return res.json({ items: messagesWithSenders.slice(0, limit).reverse(), nextCursor });
  } catch (e) {
    if (e instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid query' });
    }
    secureLogger.error('CONVERSATIONS_MESSAGES_FETCH_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Send message
conversationsRouter.post('/:id/messages', conversationMessagesGlobalLimiter, conversationMessagesPerConversationLimiter, async (req, res) => {
  const envelope = wantsEnvelope(req);
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const body = z
      .object({
        type: z.enum(['TEXT', 'PROPOSAL']).default('TEXT'),
        content: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(1000)),
        meta: z.any().optional(),
        clientMsgId: z.string().uuid().optional(),
        clientMessageId: z.string().uuid().optional(), // Legacy
      })
      .refine(
        (data) => {
          // Si les deux présents, doivent être identiques
          if (data.clientMsgId && data.clientMessageId) {
            return data.clientMsgId === data.clientMessageId;
          }
          return true;
        },
        { message: 'clientMsgId and clientMessageId must be identical if both provided' }
      )
      .transform((data) => {
        // Normaliser: clientMessageId → clientMsgId si absent
        const clientMsgId = data.clientMsgId || data.clientMessageId;
        return {
          type: data.type,
          content: data.content,
          meta: data.meta,
          clientMsgId
        };
      })
      .parse(req.body);
    // Access check + block
    const me = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId } });
    if (!me) {
      return envelope ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Not a member of this conversation') : res.status(404).json({ error: 'Not found' });
    }
    const other = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId: { not: userId } } });
    if (other?.blockedAt) {
      return envelope ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'You are blocked') : res.status(403).json({ error: 'You are blocked' });
    }

    // Pattern create-then-fallback pour détecter création vs replay
    let msg;
    let wasCreated = true;

    if (body.clientMsgId) {
      // Tenter création avec clientMsgId
      try {
        msg = await prisma.message.create({
          data: {
            conversationId: id,
            senderId: userId as string,
            type: body.type as any,
            content: body.content,
            meta: body.meta,
            clientMsgId: body.clientMsgId
          },
          select: { id: true, content: true, type: true, createdAt: true },
        });
        wasCreated = true;
      } catch (e: any) {
        // Si erreur unique constraint P2002 (on assume que c'est notre contrainte composite)
        if (e?.code === 'P2002') {
          // Récupérer le message existant
          msg = await prisma.message.findUnique({
            where: {
              conversation_client_msg_unique: { conversationId: id, clientMsgId: body.clientMsgId }
            },
            select: { id: true, content: true, type: true, createdAt: true },
          });
          wasCreated = false;
          if (!msg) {
            // Cas improbable: constraint hit mais findUnique échoue
            throw new Error('Message should exist after unique constraint violation');
          }
        } else if (e?.code === 'P2003') {
          return envelope
            ? sendError(res, 404, ERROR_CODES.FORBIDDEN, 'Conversation not found')
            : res.status(404).json({ error: 'Not found' });
        } else {
          // Autre erreur, propager
          throw e;
        }
      }
    } else {
      // Sans clientMsgId: création classique
      try {
        msg = await prisma.message.create({
          data: { conversationId: id, senderId: userId as string, type: body.type as any, content: body.content, meta: body.meta },
          select: { id: true, content: true, type: true, createdAt: true },
        });
      } catch (e: any) {
        // P2003 = FK violation: conversation deleted between member-check and INSERT.
        // Return 404 instead of letting the error bubble to the generic 500 handler.
        if (e?.code === 'P2003') {
          return envelope
            ? sendError(res, 404, ERROR_CODES.FORBIDDEN, 'Conversation not found')
            : res.status(404).json({ error: 'Not found' });
        }
        throw e;
      }
      wasCreated = true;
    }
    try {
      await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    } catch (e: any) {
      // P2025 = record not found: conversation deleted between message insert and update.
      // Non-fatal: the message was created successfully; skip the timestamp bump.
      if (e?.code !== 'P2025') throw e;
    }

    const role = (req as any).user?.role as string | undefined;
    if (role === 'RIDER' || role === 'PRO') {
      const consentHash = getConsentHash(req);
      void recordServerAnalyticsEvent({
        eventType: 'MESSAGE_SENT',
        actorType: role,
        actorId: userId as string,
        consentHash,
        occurredAt: msg.createdAt,
      });
    }

    // Envoyer push notification aux autres membres (non-bloquant)
    const currentUser = await prisma.user.findUnique({
      where: { id: userId as string },
      include: {
        riderProfile: { select: { displayName: true } },
        proProfile: { select: { businessName: true } }
      }
    });

    const senderName = role === 'PRO'
      ? currentUser?.proProfile?.businessName || 'Un professionnel'
      : currentUser?.riderProfile?.displayName || 'Un rider';

    const otherMembers = await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { not: userId as string } },
      select: { userId: true }
    });

    for (const member of otherMembers) {
      notifyNewMessage(member.userId, {
        senderName,
        message: body.content,
        conversationId: id
      }).catch((error: unknown) => {
        secureLogger.error('CHAT_MESSAGE_PUSH_FAILED', safeErrorMeta(error));
      });
    }

    // Retourner 201 si création, 200 si replay
    const statusCode = wasCreated ? 201 : 200;
    return envelope ? sendOk(res, statusCode, msg) : res.status(statusCode).json({ id: msg.id });
  } catch (e: any) {
    if (e?.name === 'ZodError') return envelope ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input', e.errors) : res.status(400).json({ error: 'Invalid input' });
    secureLogger.error('CONVERSATION_MESSAGE_SEND_FAILED', safeErrorMeta(e));
    return envelope ? sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, 'Internal error') : res.status(500).json({ error: 'Internal error' });
  }
});

conversationsRouter.post('/:id/unmatch', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const conv = await prisma.conversation.findUnique({ where: { id }, include: { match: true, members: true } });
    if (!conv) return res.status(404).json({ error: 'Not found' });
    if (!conv.members.some((m: { userId: string }) => m.userId === userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (conv.matchId) await prisma.match.update({ where: { id: conv.matchId }, data: { status: 'UNMATCHED' } });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Internal error' }); }
});

conversationsRouter.post('/:id/block', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    const action = String((req.body?.action || 'block')).toLowerCase();
    if (action !== 'block' && action !== 'unblock') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    await conversationBlockEventService.setConversationBlock({
      conversationId: id,
      targetUserIds: [userId],
      action,
      actorUserId: userId,
      actorType: 'USER',
      source: 'USER_SELF',
    });
    return res.json({ ok: true, blocked: action === 'block' });
  } catch (error) {
    if (error instanceof ConversationBlockEventServiceError && error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (error instanceof ConversationBlockEventServiceError && error.code === 'STATE_CONFLICT') {
      return res.status(409).json({ error: 'State conflict' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Trash / untrash
conversationsRouter.post('/:id/trash', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    const action = String((req.body?.action || 'trash')).toLowerCase();
    const trashedAt = action === 'untrash' ? null : new Date();
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } as any }, data: { trashedAt } });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Internal error' }); }
});

// Favorite toggle
conversationsRouter.post('/:id/favorite', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    const value = req.body?.value as boolean | undefined;
    const cm = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId } as any } });
    if (!cm) return res.status(404).json({ error: 'Not found' });
    const favoritedAt = value === false ? null : (cm.favoritedAt ? cm.favoritedAt : new Date());
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } as any }, data: { favoritedAt } });
    return res.json({ ok: true, favorite: !!favoritedAt });
  } catch { return res.status(500).json({ error: 'Internal error' }); }
});

// Empty trash - permanently delete all trashed conversations
conversationsRouter.post('/empty-trash', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await prisma.conversationMember.deleteMany({
      where: {
        userId,
        trashedAt: { not: null }
      }
    });

    return res.json({ ok: true, count: result.count });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_EMPTY_TRASH_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Ensure a direct conversation exists with target user and return its id
const openConversationLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      if (userId) return `conversation_open:user:${userId}`;
      const canonicalIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return ipKeyGenerator(canonicalIp);
    },
    handler: buildEnvelopeAwareRateLimitHandler(
      'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.',
      'RATE_LIMIT',
      'RATE_LIMIT',
    ),
  },
  'conversation_open',
);

conversationsRouter.post('/open', openConversationLimiter, async (req, res) => {
  const envelope = wantsEnvelope(req);
  try {
    const meId = (req as any).user?.id as string | undefined;
    if (!meId) {
      return envelope
        ? sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
        : res.status(401).json({ error: 'Unauthorized' });
    }
    const body = z.object({ targetUserId: z.string().uuid() }).parse(req.body);
    if (body.targetUserId === meId) {
      return envelope
        ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input')
        : res.status(400).json({ error: 'Invalid input' });
    }

    // Determine conversation type based on target user's role
    const targetUser = await prisma.user.findUnique({
      where: { id: body.targetUserId },
      select: { role: true }
    });

    if (!targetUser) {
      return envelope
        ? sendError(res, 404, ERROR_CODES.VALIDATION_ERROR, 'Target user not found')
        : res.status(404).json({ error: 'Target user not found' });
    }

    // Déterminer le type de conversation selon les rôles
    const currentUser = await prisma.user.findUnique({
      where: { id: meId },
      select: { role: true }
    });

    let conversationType: string;
    if (currentUser?.role === 'PRO' && targetUser.role === 'PRO') {
      conversationType = 'PRO_TO_PRO';
    } else if (currentUser?.role === 'RIDER' && targetUser.role === 'PRO') {
      conversationType = 'RIDER_TO_PRO';
    } else if (currentUser?.role === 'PRO' && targetUser.role === 'RIDER') {
      conversationType = 'RIDER_TO_PRO'; // Même type car c'est la communication rider/pro
    } else {
      conversationType = 'RIDER_TO_RIDER';
    }

    const now = new Date();
    const directKey = buildDirectConversationKey(meId, body.targetUserId, conversationType);
    let requiredMatchId: string | null = null;

    if (conversationType === 'RIDER_TO_RIDER') {
      const [userOneId, userTwoId] = [meId, body.targetUserId].sort();
      const activeMatch = await prisma.match.findUnique({
        where: {
          userOneId_userTwoId: { userOneId, userTwoId } as any,
        },
        select: { id: true, status: true },
      });

      if (!activeMatch || activeMatch.status !== 'ACTIVE') {
        return envelope
          ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Forbidden')
          : res.status(403).json({ error: 'Forbidden' });
      }

      requiredMatchId = activeMatch.id;
    }

    const existingConversationWhere: Prisma.ConversationWhereInput = requiredMatchId
      ? {
          OR: [{ matchId: requiredMatchId }, { directKey, type: conversationType as any }],
        }
      : {
          directKey,
          type: conversationType as any,
        };

    const existingForCooldown = await prisma.conversation.findFirst({
      where: existingConversationWhere,
      select: { id: true },
    });

    const recentMessage = existingForCooldown
      ? await prisma.message.findFirst({
          where: { senderId: meId, conversationId: existingForCooldown.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, conversationId: true },
        })
      : null;

    if (recentMessage && now.getTime() - recentMessage.createdAt.getTime() < MESSAGE_COOLDOWN_MS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((MESSAGE_COOLDOWN_MS - (now.getTime() - recentMessage.createdAt.getTime())) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      return envelope
        ? sendError(res, 429, ERROR_CODES.RATE_LIMITED, 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.', {
            reason: 'CONVERSATION_COOLDOWN',
            retryAfterSeconds,
          })
        : res.status(429).json({
            code: 'CONVERSATION_COOLDOWN',
            message: 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.',
            retryAfterSeconds,
          });
    }

    const conv = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (requiredMatchId) {
        const lockedActiveMatches = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM "Match"
          WHERE id = ${requiredMatchId}
            AND status::text = 'ACTIVE'
          FOR UPDATE
        `);
        if (lockedActiveMatches.length === 0) {
          return { forbidden: true as const };
        }
      }

      const existing = await tx.conversation.findFirst({
        where: existingConversationWhere,
        select: { id: true, matchId: true, directKey: true, type: true },
      });

      if (existing) {
        const data: Prisma.ConversationUpdateInput = {};
        if (requiredMatchId && !existing.matchId) data.match = { connect: { id: requiredMatchId } };
        if (!existing.directKey) data.directKey = directKey;
        if (existing.type !== conversationType) data.type = conversationType as any;
        if (Object.keys(data).length > 0) {
          await tx.conversation.update({ where: { id: existing.id }, data });
        }
        await tx.conversationMember.createMany({
          data: [
            { userId: meId, conversationId: existing.id },
            { userId: body.targetUserId, conversationId: existing.id },
          ],
          skipDuplicates: true,
        });
        return { id: existing.id, isNew: false };
      }

      const created = await tx.conversation.create({
        data: {
          type: conversationType as any,
          directKey,
          ...(requiredMatchId ? { matchId: requiredMatchId } : {}),
          members: {
            createMany: {
              data: [
                { userId: meId },
                { userId: body.targetUserId },
              ],
              skipDuplicates: true,
            },
          },
        },
        select: { id: true },
      });

      return { id: created.id, isNew: true };
    }).catch(async (error: any) => {
      if (error?.code !== 'P2002') {
        throw error;
      }

      const existingAfterRace = await prisma.conversation.findFirst({
        where: existingConversationWhere,
        select: { id: true },
      });

      if (existingAfterRace) {
        return { id: existingAfterRace.id, isNew: false };
      }

      throw error;
    });

    if ('forbidden' in conv) {
      return envelope
        ? sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Forbidden')
        : res.status(403).json({ error: 'Forbidden' });
    }

    return envelope
      ? sendOk(res, conv.isNew ? 201 : 200, { id: conv.id, created: conv.isNew })
      : res.status(conv.isNew ? 201 : 200).json({ id: conv.id });
  } catch (e: any) {
    if (e instanceof ZodError) {
      return envelope
        ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input', e.errors)
        : res.status(400).json({ error: 'Invalid input' });
    }
    return envelope
      ? sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, 'Internal error')
      : res.status(500).json({ error: 'Internal error' });
  }
});

// Get conversation members with their details
conversationsRouter.get('/:id/members', conversationReadLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id;

    // Check if current user is a member
    const member = await prisma.conversationMember.findFirst({
      where: { conversationId: id, userId },
    });

    if (!member) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get all members
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: id },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    // Get member details
    const proIds = members.filter((m: { user: { role: string } }) => m.user.role === 'PRO').map((m: { userId: string }) => m.userId);
    const riderIds = members.filter((m: { user: { role: string } }) => m.user.role !== 'PRO').map((m: { userId: string }) => m.userId);

    const proProfiles = proIds.length > 0
      ? await prisma.proProfile.findMany({
          where: { userId: { in: proIds } },
          select: { userId: true, businessName: true, photoUrl: true },
        })
      : [];

    const riderProfiles = riderIds.length > 0
      ? await prisma.riderProfile.findMany({
          where: { userId: { in: riderIds } },
          select: { userId: true, displayName: true, photoUrl: true },
        })
      : [];

    const proMap = new Map(proProfiles.map((p: { userId: string; businessName: string | null; photoUrl: string | null }) => [p.userId, p]));
    const riderMap = new Map(riderProfiles.map((r: { userId: string; displayName: string | null; photoUrl: string | null }) => [r.userId, r]));

    const results = members.map((m: { userId: string; user: { role: string } }) => {
      const isPro = m.user.role === 'PRO';
      const profile = isPro ? proMap.get(m.userId) : riderMap.get(m.userId);

      return {
        id: m.userId,
        name: isPro ? (profile as any)?.businessName : (profile as any)?.displayName,
        photoUrl: (profile as any)?.photoUrl || null,
        role: m.user.role,
        isCurrentUser: m.userId === userId,
      };
    });

    return res.json({ items: results });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_MEMBERS_FETCH_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Search users by display name or business name
conversationsRouter.get('/users/search', conversationReadLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const query = String(req.query.q || '').trim();
    if (query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    // Search in rider profiles
    const riders = await prisma.riderProfile.findMany({
      where: {
        userId: { not: userId }, // Exclude current user
        displayName: { contains: query, mode: 'insensitive' },
      },
      select: {
        userId: true,
        displayName: true,
        photoUrl: true,
      },
      take: 10,
    });

    // Search in pro profiles
    const pros = await prisma.proProfile.findMany({
      where: {
        userId: { not: userId }, // Exclude current user
        businessName: { contains: query, mode: 'insensitive' },
      },
      select: {
        userId: true,
        businessName: true,
        photoUrl: true,
      },
      take: 10,
    });

    // Format results
    const results = [
      ...riders.map((r: { userId: string; displayName: string | null; photoUrl: string | null }) => ({
        id: r.userId,
        name: r.displayName,
        photoUrl: r.photoUrl,
        role: 'RIDER' as const,
      })),
      ...pros.map((p: { userId: string; businessName: string | null; photoUrl: string | null }) => ({
        id: p.userId,
        name: p.businessName,
        photoUrl: p.photoUrl,
        role: 'PRO' as const,
      })),
    ];

    return res.json({ items: results });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_USER_SEARCH_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Send an invitation to add a member to a conversation
conversationsRouter.post('/:id/members', conversationInvitationSendLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id;
    const body = z.object({ userId: z.string().uuid() }).parse(req.body);

    // Check if current user is a member of this conversation
    const member = await prisma.conversationMember.findFirst({
      where: { conversationId: id, userId },
    });

    if (!member) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const invitedUser = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!invitedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user to add already exists in conversation
    const existingMember = await prisma.conversationMember.findFirst({
      where: { conversationId: id, userId: body.userId },
    });

    if (existingMember) {
      return res.status(409).json({ error: 'User is already a member' });
    }

    // Check if there's already a pending invitation
    const existingInvitation = await prisma.conversationInvitation.findFirst({
      where: {
        conversationId: id,
        invitedUserId: body.userId,
        status: 'PENDING'
      },
    });

    if (existingInvitation) {
      return res.status(409).json({ error: 'An invitation is already pending for this user' });
    }

    // Create invitation
    let invitationId: string = '';
    let inviterName: string = '';
    let memberCount: number = 0;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create the invitation
      const invitation = await tx.conversationInvitation.create({
        data: {
          conversationId: id,
          invitedUserId: body.userId,
          invitedBy: userId,
          status: 'PENDING',
        },
      });

      invitationId = invitation.id;

      // Get conversation info for notification
      const conversation = await tx.conversation.findUnique({
        where: { id },
        include: {
          members: true
        }
      });

      memberCount = conversation?.members.length || 0;

      // Get user info for system message
      const invitedUser = await tx.user.findUnique({
        where: { id: body.userId },
        select: { role: true },
      });

      const invitedUserProfile = await (invitedUser?.role === 'PRO'
        ? tx.proProfile.findUnique({ where: { userId: body.userId }, select: { businessName: true } })
        : tx.riderProfile.findUnique({ where: { userId: body.userId }, select: { displayName: true } }));

      const invitedUserName = invitedUser?.role === 'PRO'
        ? (invitedUserProfile as any)?.businessName || 'Professionnel'
        : (invitedUserProfile as any)?.displayName || 'Rider';

      const inviterProfile = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }).then(async (user: { role: string } | null) => {
        if (user?.role === 'PRO') {
          return tx.proProfile.findUnique({ where: { userId }, select: { businessName: true } });
        }
        return tx.riderProfile.findUnique({ where: { userId }, select: { displayName: true } });
      });

      inviterName = (inviterProfile as any)?.businessName || (inviterProfile as any)?.displayName || 'Un membre';

      // Create system message (visible only to current members)
      await tx.message.create({
        data: {
          conversationId: id,
          senderId: userId,
          type: 'TEXT',
          meta: { kind: 'SYSTEM' },
          content: `${inviterName} a invité ${invitedUserName} à rejoindre la conversation`,
        },
      });

      // Update conversation timestamp
      await tx.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    });

    // Send push notification to invited user (non-blocking)
    notifyGroupInvitation(body.userId, {
      inviterName,
      conversationId: id,
      invitationId,
      memberCount
    }).catch((error: unknown) => {
      secureLogger.error('CHAT_INVITATION_PUSH_FAILED', safeErrorMeta(error));
    });

    // Send Socket.io real-time notification
    notifyUser(body.userId, 'group-invitation', {
      invitationId,
      conversationId: id,
      inviterName,
      memberCount
    });

    // Créer notification in-app persistée
    createNotificationSilent({
      userId: body.userId,
      type: NotificationType.GROUP_INVITATION,
      title: inviterName,
      body: `Tu as été invité(e) dans une conversation de groupe`,
      url: `/messages/${id}`,
    });
    notifyUser(body.userId, 'notification', {
      type: NotificationType.GROUP_INVITATION,
      url: `/messages/${id}`,
    });

    return res.status(201).json({ ok: true, message: 'Invitation envoyée' });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    if (e?.code === 'P2002') return res.status(409).json({ error: 'Invitation already exists' });
    if (e?.code === 'P2003' || e?.code === 'P2025') return res.status(404).json({ error: 'Conversation not found' });
    secureLogger.error('CONVERSATIONS_INVITATION_SEND_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get pending invitations for the current user
conversationsRouter.get('/invitations/pending', conversationReadLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const invitations = await prisma.conversationInvitation.findMany({
      where: {
        invitedUserId: userId,
        status: 'PENDING',
      },
      select: {
        id: true,
        conversationId: true,
        invitedBy: true,
        createdAt: true,
        conversation: {
          select: {
            id: true,
            type: true,
            members: {
              select: {
                userId: true,
              },
            },
          },
        },
        inviter: {
          select: {
            id: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: INVITATIONS_PENDING_MAX,
    });

    // Get inviter profiles
    const proIds = invitations.filter((inv: any) => inv.inviter.role === 'PRO').map((inv: any) => inv.invitedBy);
    const riderIds = invitations.filter((inv: any) => inv.inviter.role !== 'PRO').map((inv: any) => inv.invitedBy);

    const proProfiles = proIds.length > 0
      ? await prisma.proProfile.findMany({
          where: { userId: { in: proIds } },
          select: { userId: true, businessName: true, photoUrl: true },
        })
      : [];

    const riderProfiles = riderIds.length > 0
      ? await prisma.riderProfile.findMany({
          where: { userId: { in: riderIds } },
          select: { userId: true, displayName: true, photoUrl: true },
        })
      : [];

    const proMap = new Map(proProfiles.map((p: any) => [p.userId, p]));
    const riderMap = new Map(riderProfiles.map((r: any) => [r.userId, r]));

    const results = invitations.map((inv: any) => {
      const isPro = inv.inviter.role === 'PRO';
      const profile = isPro ? proMap.get(inv.invitedBy) : riderMap.get(inv.invitedBy);
      const inviterName = isPro
        ? (profile as any)?.businessName || 'Professionnel'
        : (profile as any)?.displayName || 'Rider';

      return {
        id: inv.id,
        conversationId: inv.conversationId,
        inviterName,
        inviterPhotoUrl: (profile as any)?.photoUrl || null,
        memberCount: inv.conversation.members.length,
        createdAt: inv.createdAt,
      };
    });

    return res.json({ items: results });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_PENDING_INVITATIONS_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Accept or reject a conversation invitation
conversationsRouter.post('/invitations/:invitationId/respond', conversationInvitationRespondLimiter, async (req, res) => {
  const invitationId = req.params.invitationId;
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const body = z.object({ action: z.enum(['ACCEPT', 'REJECT']) }).parse(req.body);

    // Ownership is enforced in the query: non-invited users get the same neutral
    // response as unknown IDs, avoiding invitation enumeration.
    const invitation = await prisma.conversationInvitation.findFirst({
      where: { id: invitationId, invitedUserId: userId },
      select: {
        id: true,
        conversationId: true,
        invitedUserId: true,
        invitedBy: true,
        status: true,
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    // Check if invitation is still pending
    if (invitation.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invitation already processed' });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.conversationInvitation.updateMany({
        where: { id: invitationId, invitedUserId: userId, status: 'PENDING' },
        data: {
          status: body.action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
          respondedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw Object.assign(new Error('INVITATION_ALREADY_PROCESSED'), { _code: 'INVITATION_ALREADY_PROCESSED' });
      }

      if (body.action === 'ACCEPT') {
        // Add user to conversation
        await tx.conversationMember.createMany({
          data: [{ conversationId: invitation.conversationId, userId }],
          skipDuplicates: true,
        });

        // Get user info for system message
        const joinedUser = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        const joinedUserProfile = await (joinedUser?.role === 'PRO'
          ? tx.proProfile.findUnique({ where: { userId }, select: { businessName: true } })
          : tx.riderProfile.findUnique({ where: { userId }, select: { displayName: true } }));

        const joinedUserName = joinedUser?.role === 'PRO'
          ? (joinedUserProfile as any)?.businessName || 'Professionnel'
          : (joinedUserProfile as any)?.displayName || 'Rider';

        // Create system message
        await tx.message.create({
          data: {
            conversationId: invitation.conversationId,
            senderId: userId,
            type: 'TEXT',
            meta: { kind: 'SYSTEM' },
            content: `${joinedUserName} a rejoint la conversation`,
          },
        });

        // Update conversation timestamp
        await tx.conversation.update({
          where: { id: invitation.conversationId },
          data: { updatedAt: new Date() },
        });
      }
    });

    return res.json({
      ok: true,
      action: body.action,
      message: body.action === 'ACCEPT' ? 'Invitation acceptée' : 'Invitation refusée',
    });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    if (e?._code === 'INVITATION_ALREADY_PROCESSED') return res.status(400).json({ error: 'Invitation already processed' });
    if (e?.code === 'P2003' || e?.code === 'P2025') return res.status(404).json({ error: 'Invitation not found' });
    secureLogger.error('CONVERSATIONS_INVITATION_RESPONSE_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Remove a member from a conversation (or leave)
conversationsRouter.delete('/:id/members/:targetUserId', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id;
    const targetUserId = req.params.targetUserId;

    // Check if current user is a member
    const member = await prisma.conversationMember.findFirst({
      where: { conversationId: id, userId },
    });

    if (!member) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if target user exists in conversation
    const targetMember = await prisma.conversationMember.findFirst({
      where: { conversationId: id, userId: targetUserId },
    });

    if (!targetMember) {
      return res.status(404).json({ error: 'User is not a member' });
    }

    // Everyone can remove themselves or others (per user requirement)
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Delete member
      await tx.conversationMember.delete({
        where: {
          conversationId_userId: {
            conversationId: id,
            userId: targetUserId,
          } as any,
        },
      });

      // Get user info for system message
      const removedUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { role: true },
      });

      const removedUserProfile = await (removedUser?.role === 'PRO'
        ? tx.proProfile.findUnique({ where: { userId: targetUserId }, select: { businessName: true } })
        : tx.riderProfile.findUnique({ where: { userId: targetUserId }, select: { displayName: true } }));

      const removedUserName = removedUser?.role === 'PRO'
        ? (removedUserProfile as any)?.businessName || 'Professionnel'
        : (removedUserProfile as any)?.displayName || 'Rider';

      let systemMessage: string;
      if (userId === targetUserId) {
        // User left by themselves
        systemMessage = `${removedUserName} a quitté la conversation`;
      } else {
        // User was removed by someone else
        const removerProfile = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true },
        }).then(async (user: { role: string } | null) => {
          if (user?.role === 'PRO') {
            return tx.proProfile.findUnique({ where: { userId }, select: { businessName: true } });
          }
          return tx.riderProfile.findUnique({ where: { userId }, select: { displayName: true } });
        });

        const removerName = (removerProfile as any)?.businessName || (removerProfile as any)?.displayName || 'Un membre';
        systemMessage = `${removerName} a retiré ${removedUserName} de la conversation`;
      }

      // Create system message
      await tx.message.create({
        data: {
          conversationId: id,
          senderId: userId,
          type: 'TEXT',
          meta: { kind: 'SYSTEM' },
          content: systemMessage,
        },
      });

      // Update conversation timestamp
      await tx.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    });

    return res.json({ ok: true });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_MEMBER_REMOVE_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Archive / restore ────────────────────────────────────────────────────────

// Manually archive a conversation (user's membership only — not the other participant's).
conversationsRouter.patch('/:id/archive', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const conversationId = req.params.id;

    // Verify membership (prevents IDOR: only archive your own membership)
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true, archivedAt: true, trashedAt: true },
    });

    if (!member) return res.status(404).json({ error: 'Conversation not found' });
    if (member.trashedAt) return res.status(400).json({ error: 'Cannot archive a trashed conversation' });
    if (member.archivedAt) return res.status(409).json({ error: 'Already archived' });

    const now = new Date();
    const purgeAt = new Date(now);
    purgeAt.setMonth(purgeAt.getMonth() + 18);

    await prisma.conversationMember.update({
      where: { id: member.id },
      data: { archivedAt: now, purgeAt },
    });

    return res.json({ ok: true, archivedAt: now });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_ARCHIVE_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Restore an archived conversation back to active.
conversationsRouter.patch('/:id/restore', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const conversationId = req.params.id;

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true, archivedAt: true, trashedAt: true },
    });

    if (!member) return res.status(404).json({ error: 'Conversation not found' });
    if (!member.archivedAt && !member.trashedAt) return res.status(409).json({ error: 'Conversation is already active' });

    await prisma.conversationMember.update({
      where: { id: member.id },
      data: { archivedAt: null, trashedAt: null, purgeAt: null },
    });

    return res.json({ ok: true });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_RESTORE_FAILED', safeErrorMeta(e));
    return res.status(500).json({ error: 'Internal error' });
  }
});
