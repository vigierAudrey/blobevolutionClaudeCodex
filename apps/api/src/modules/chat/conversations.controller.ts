import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { secureLogger } from '../../utils/secure-logger';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth, requireVerifiedEmail);

const conversationMemberSelect = {
  conversation: {
    select: {
      id: true,
      type: true,
      updatedAt: true,
      match: {
        select: { userOneId: true, userTwoId: true },
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
      ? await prisma.$queryRaw<Array<{ conversationId: string; count: bigint }>>`
          SELECT
            m."conversationId",
            COUNT(*) as count
          FROM "Message" m
          INNER JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId"
          WHERE
            m."conversationId" IN (${Prisma.join(conversationIds)})
            AND m."senderId" != ${userId}
            AND cm."userId" = ${userId}
            AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
          GROUP BY m."conversationId"
        `
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
      const otherId = conv.members.find((m: ConversationParticipant) => m.userId !== userId)?.userId;

      let otherDisplayName = 'Profil';
      let otherRole = 'RIDER';
      let otherPhotoUrl: string | null = null;

      if (otherId) {
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
      };
    });

    return res.json({ items: results });
  } catch (e) {
    console.error('Conversations list error:', e);
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
      select: { id: true, senderId: true, type: true, content: true, meta: true, createdAt: true },
    });
    // mark read
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId } as any }, data: { lastReadAt: new Date() } });
    return res.json({ items: msgs.reverse(), nextCursor: msgs.length === limit ? msgs[msgs.length - 1].createdAt : null });
  } catch (e) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Send message
conversationsRouter.post('/:id/messages', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const body = z.object({ type: z.enum(['TEXT', 'PROPOSAL']).default('TEXT'), content: z.string().min(1).max(1000), meta: z.any().optional() }).parse(req.body);
    // Access check + block
    const me = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId } });
    if (!me) return res.status(404).json({ error: 'Not found' });
    const other = await prisma.conversationMember.findFirst({ where: { conversationId: id, userId: { not: userId } } });
    if (other?.blockedAt) return res.status(403).json({ error: 'You are blocked' });
    const msg = await prisma.message.create({ data: { conversationId: id, senderId: userId as string, type: body.type as any, content: body.content, meta: body.meta } });
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    return res.status(201).json({ id: msg.id });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    secureLogger.error('Open conversation error', { error: e });
    return res.status(500).json({ error: 'Internal error' });
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
    console.error('Empty trash error:', e);
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
    return res.status(429).json({
      code: 'RATE_LIMIT',
      message: 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.',
      retryAfterSeconds,
    });
  },
});

conversationsRouter.post('/open', openConversationLimiter, async (req, res) => {
  let directKey: string | null = null;
  try {
    const meId = (req as any).user?.id as string | undefined;
    if (!meId) return res.status(401).json({ error: 'Unauthorized' });
    const body = z.object({ targetUserId: z.string().uuid() }).parse(req.body);

    // Determine conversation type based on target user's role
    const targetUser = await prisma.user.findUnique({
      where: { id: body.targetUserId },
      select: { role: true }
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
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
      return res.status(429).json({
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

    return res.status(conv.isNew ? 201 : 200).json({ id: conv.id });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    return res.status(500).json({ error: 'Internal error' });
  }
});
