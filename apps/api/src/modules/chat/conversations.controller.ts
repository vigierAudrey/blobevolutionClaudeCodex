import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.guard';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

export const conversationsRouter = Router();

// List conversations with last message + unread count (excludes trashed by default)
conversationsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const includeTrashed = String(req.query.includeTrashed || 'false').toLowerCase() === 'true';
    const convType = req.query.type as string | undefined; // 'RIDER_TO_RIDER' | 'RIDER_TO_PRO'

    const convs = await prisma.conversationMember.findMany({
      where: { userId, ...(includeTrashed ? {} : { trashedAt: null }) },
      select: {
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
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    // Filter by conversation type if specified
    const filteredConvs = convType ? convs.filter(cm => cm.conversation.type === convType) : convs;

    // === QUERY BATCHING: Load all data in 4 queries instead of N×4 ===

    // Step 1: Extract all other user IDs
    const otherUserIds = filteredConvs
      .map(cm => cm.conversation.members.find(m => m.userId !== userId)?.userId)
      .filter((id): id is string => !!id);

    // Step 2: Batch load all users (1 query)
    const users = otherUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: otherUserIds } },
          select: { id: true, role: true }
        })
      : [];

    // Step 3: Separate PRO and RIDER IDs
    const proIds = users.filter(u => u.role === 'PRO').map(u => u.id);
    const riderIds = users.filter(u => u.role !== 'PRO').map(u => u.id);

    // Step 4: Batch load PRO profiles (1 query)
    const proProfiles = proIds.length > 0
      ? await prisma.proProfile.findMany({
          where: { userId: { in: proIds } },
          select: { userId: true, businessName: true, photoUrl: true }
        })
      : [];

    // Step 5: Batch load RIDER profiles (1 query)
    const riderProfiles = riderIds.length > 0
      ? await prisma.riderProfile.findMany({
          where: { userId: { in: riderIds } },
          select: { userId: true, displayName: true, photoUrl: true }
        })
      : [];

    // Step 6: Batch load unread counts with a single query (1 query)
    const conversationIds = filteredConvs.map(cm => cm.conversation.id);
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
    const userMap = new Map<string, { id: string; role: string }>(users.map(u => [u.id, u]));
    const proMap = new Map<string, { userId: string; businessName: string | null; photoUrl: string | null }>(
      proProfiles.map(p => [p.userId, p])
    );
    const riderMap = new Map<string, { userId: string; displayName: string | null; photoUrl: string | null }>(
      riderProfiles.map(r => [r.userId, r])
    );
    const unreadMap = new Map<string, number>(unreadCountsRaw.map(u => [u.conversationId, Number(u.count)]));

    // Step 8: Build results without additional DB queries
    const results = filteredConvs.map(cm => {
      const conv = cm.conversation;
      const otherId = conv.members.find(m => m.userId !== userId)?.userId;

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
conversationsRouter.get('/:id/messages', requireAuth, async (req, res) => {
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
conversationsRouter.post('/:id/messages', requireAuth, async (req, res) => {
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
    return res.status(500).json({ error: 'Internal error' });
  }
});

conversationsRouter.post('/:id/unmatch', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const id = req.params.id;
    const conv = await prisma.conversation.findUnique({ where: { id }, include: { match: true, members: true } });
    if (!conv) return res.status(404).json({ error: 'Not found' });
    if (!conv.members.some((m) => m.userId === userId)) return res.status(403).json({ error: 'Forbidden' });
    if (conv.matchId) await prisma.match.update({ where: { id: conv.matchId }, data: { status: 'UNMATCHED' } });
    return res.json({ ok: true });
  } catch { return res.status(500).json({ error: 'Internal error' }); }
});

conversationsRouter.post('/:id/block', requireAuth, async (req, res) => {
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
conversationsRouter.post('/:id/trash', requireAuth, async (req, res) => {
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
conversationsRouter.post('/:id/favorite', requireAuth, async (req, res) => {
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

// Ensure a direct conversation exists with target user and return its id
conversationsRouter.post('/open', requireAuth, async (req, res) => {
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

    const myMemberships = await prisma.conversationMember.findMany({
      where: { userId: meId },
      select: { conversationId: true },
      take: 2000,
    });
    const convIds = myMemberships.map((m) => m.conversationId);
    if (convIds.length > 0) {
      const exists = await prisma.conversationMember.findFirst({
        where: { conversationId: { in: convIds }, userId: body.targetUserId },
        select: { conversationId: true },
      });
      if (exists) return res.status(200).json({ id: exists.conversationId });
    }

    const conv = await prisma.conversation.create({
      data: {
        type: conversationType as any
      }
    });
    await prisma.conversationMember.createMany({
      data: [
        { conversationId: conv.id, userId: meId },
        { conversationId: conv.id, userId: body.targetUserId },
      ],
      skipDuplicates: true,
    });
    return res.status(201).json({ id: conv.id });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    return res.status(500).json({ error: 'Internal error' });
  }
});
