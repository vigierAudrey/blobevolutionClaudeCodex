import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { secureLogger } from '../../utils/secure-logger';
import { recordServerAnalyticsEvent } from '../../services/analytics/events.service';
import { notifyGroupInvitation, notifyNewMessage } from '../push/push.controller';
import { notifyUser } from '../../lib/socket';
import { sendError, sendOk, wantsEnvelope } from '../../utils/api-response';
import { ERROR_CODES } from '../../utils/error-codes';

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

// List conversations with last message + unread count (excludes trashed by default)
conversationsRouter.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const includeTrashed = String(req.query.includeTrashed || 'false').toLowerCase() === 'true';
    const convType = req.query.type as string | undefined; // 'RIDER_TO_RIDER' | 'RIDER_TO_PRO'

    const convs: ConversationMemberWithRelations[] = await prisma.conversationMember.findMany({
      where: { userId, ...(includeTrashed ? {} : { trashedAt: null }) },
      select: conversationMemberSelect,
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    // Filter by conversation type if specified
    const filteredConvs: ConversationMemberWithRelations[] = convType
      ? convs.filter((cm: ConversationMemberWithRelations) => cm.conversation.type === convType)
      : convs;

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
        favorite: !!cm.favoritedAt,
        blocked: !!cm.blockedAt,
        memberCount,
        isGroup,
        matchedAt: conv.match?.createdAt ?? null,
      };
    });

    return res.json({ items: results });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_LIST_FAILED', { error: e });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Fetch messages (paginated by createdAt)
conversationsRouter.get('/:id/messages', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null;
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const member = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Not found' });

    const msgs = await prisma.message.findMany({
      where: { conversationId: id, createdAt: cursor ? { lt: cursor } : undefined },
      orderBy: { createdAt: 'desc' },
      take: limit,
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
    return res.json({ items: messagesWithSenders.reverse(), nextCursor: msgs.length === limit ? msgs[msgs.length - 1].createdAt : null });
  } catch (e) {
    secureLogger.error('CONVERSATIONS_MESSAGES_FETCH_FAILED', { error: e, conversationId: req.params.id });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Send message
conversationsRouter.post('/:id/messages', async (req, res) => {
  const envelope = wantsEnvelope(req);
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const body = z
      .object({
        type: z.enum(['TEXT', 'PROPOSAL']).default('TEXT'),
        content: z.string().min(1).max(1000),
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
        } else {
          // Autre erreur, propager
          throw e;
        }
      }
    } else {
      // Sans clientMsgId: création classique
      msg = await prisma.message.create({
        data: { conversationId: id, senderId: userId as string, type: body.type as any, content: body.content, meta: body.meta },
        select: { id: true, content: true, type: true, createdAt: true },
      });
      wasCreated = true;
    }
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });

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
        const errorMessage = error instanceof Error ? error.message : String(error);
        secureLogger.error('Failed to send push notification for message', { error: errorMessage, userId: member.userId });
      });
    }

    // Retourner 201 si création, 200 si replay
    const statusCode = wasCreated ? 201 : 200;
    return envelope ? sendOk(res, statusCode, msg) : res.status(statusCode).json({ id: msg.id });
  } catch (e: any) {
    if (e?.name === 'ZodError') return envelope ? sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid input', e.errors) : res.status(400).json({ error: 'Invalid input' });
    secureLogger.error('Open conversation error', { error: e });
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
    const id = req.params.id;
    const action = String((req.body?.action || 'block')).toLowerCase();
    const blockedAt = action === 'unblock' ? null : new Date();
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } as any }, data: { blockedAt } });
    return res.json({ ok: true, blocked: action === 'block' });
  } catch { return res.status(500).json({ error: 'Internal error' }); }
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
    secureLogger.error('CONVERSATIONS_EMPTY_TRASH_FAILED', { error: e });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Ensure a direct conversation exists with target user and return its id
const MESSAGE_COOLDOWN_MS = 30_000;
const openConversationLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.' },
  keyGenerator: (req, res) => {
    const userId = (req as any).user?.id as string | undefined;
    return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? '');
  },
  handler: (req, res) => {
    const rateLimitInfo = (req as { rateLimit?: { resetTime?: Date } }).rateLimit;
    const retryAfterSeconds =
      typeof rateLimitInfo?.resetTime?.getTime === 'function'
        ? Math.max(1, Math.ceil((rateLimitInfo.resetTime.getTime() - Date.now()) / 1000))
        : 60;
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    const envelope = wantsEnvelope(req as Request);
    if (envelope) {
      return sendError(
        res,
        429,
        ERROR_CODES.RATE_LIMITED,
        'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.',
        { reason: 'RATE_LIMIT', retryAfterSeconds }
      );
    }
    return res.status(429).json({
      code: 'RATE_LIMIT',
      message: 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.',
      retryAfterSeconds,
    });
  },
});

conversationsRouter.post('/open', openConversationLimiter, async (req, res) => {
  const envelope = wantsEnvelope(req);
  let directKey: string | null = null;
  try {
    const meId = (req as any).user?.id as string | undefined;
    if (!meId) {
      return envelope
        ? sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
        : res.status(401).json({ error: 'Unauthorized' });
    }
    const body = z.object({ targetUserId: z.string().uuid() }).parse(req.body);

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
    const participants = [meId, body.targetUserId].sort();
    directKey = `direct:${participants[0]}:${participants[1]}:${conversationType}`;

    const existingForCooldown = await prisma.conversation.findFirst({
      where: {
        type: conversationType as any,
        AND: [
          { members: { some: { userId: meId } } },
          { members: { some: { userId: body.targetUserId } } },
          { members: { every: { userId: { in: [meId, body.targetUserId] } } } },
        ],
      },
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
      const existing = await tx.conversation.findFirst({
        where: {
          type: conversationType as any,
          AND: [
            { members: { some: { userId: meId } } },
            { members: { some: { userId: body.targetUserId } } },
            { members: { every: { userId: { in: [meId, body.targetUserId] } } } },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        return { id: existing.id, isNew: false };
      }

      const created = await tx.conversation.create({
        data: {
          type: conversationType as any,
          directKey,
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
    });

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
conversationsRouter.get('/:id/members', async (req, res) => {
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
    secureLogger.error('CONVERSATIONS_MEMBERS_FETCH_FAILED', { error: e, conversationId: req.params.id });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Search users by display name or business name
conversationsRouter.get('/users/search', async (req, res) => {
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
    secureLogger.error('CONVERSATIONS_USER_SEARCH_FAILED', { error: e });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Send an invitation to add a member to a conversation
conversationsRouter.post('/:id/members', async (req, res) => {
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      secureLogger.error('Failed to send group invitation push notification', { error: errorMessage, userId: body.userId });
    });

    // Send Socket.io real-time notification
    notifyUser(body.userId, 'group-invitation', {
      invitationId,
      conversationId: id,
      inviterName,
      memberCount
    });

    return res.status(201).json({ ok: true, message: 'Invitation envoyée' });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    secureLogger.error('CONVERSATIONS_INVITATION_SEND_FAILED', { error: e, conversationId: req.params.id });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get pending invitations for the current user
conversationsRouter.get('/invitations/pending', async (req, res) => {
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
    secureLogger.error('CONVERSATIONS_PENDING_INVITATIONS_FAILED', { error: e });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Accept or reject a conversation invitation
conversationsRouter.post('/invitations/:invitationId/respond', async (req, res) => {
  const invitationId = req.params.invitationId;
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const body = z.object({ action: z.enum(['ACCEPT', 'REJECT']) }).parse(req.body);

    // Get the invitation
    const invitation = await prisma.conversationInvitation.findUnique({
      where: { id: invitationId },
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

    // Check if user is the invited one
    if (invitation.invitedUserId !== userId) {
      return res.status(403).json({ error: 'Not authorized to respond to this invitation' });
    }

    // Check if invitation is still pending
    if (invitation.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invitation already processed' });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update invitation status
      await tx.conversationInvitation.update({
        where: { id: invitationId },
        data: {
          status: body.action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
          respondedAt: new Date(),
        },
      });

      if (body.action === 'ACCEPT') {
        // Add user to conversation
        await tx.conversationMember.create({
          data: {
            conversationId: invitation.conversationId,
            userId: userId,
          },
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
    secureLogger.error('CONVERSATIONS_INVITATION_RESPONSE_FAILED', { error: e, invitationId });
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
    secureLogger.error('CONVERSATIONS_MEMBER_REMOVE_FAILED', { error: e, conversationId: req.params.id });
    return res.status(500).json({ error: 'Internal error' });
  }
});
