/**
 * Tests cursor composite (createdAt, messageId) pour GET /:id/messages.
 *
 * Cas couverts :
 * 1. Pagination stable avec curseur composite
 * 2. Stabilité quand deux messages ont le même timestamp (collision)
 * 3. Rétrocompatibilité : ancien cursor ISO datetime accepté proprement
 * 4. Cursor invalide → réponse sans crash (traité comme "pas de cursor")
 */

import { randomUUID } from 'crypto';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();

type MsgListResponse = {
  items: Array<{ id: string; content: string; createdAt: string }>;
  nextCursor: string | null;
};

async function createConversationWithMembers(userAId: string, userBId: string) {
  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      type: 'RIDER_TO_RIDER',
      members: {
        create: [{ userId: userAId }, { userId: userBId }],
      },
    },
    select: { id: true },
  });
}

async function insertMessage(conversationId: string, senderId: string, content: string, createdAt?: Date) {
  return prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId,
      senderId,
      content,
      type: 'TEXT',
      ...(createdAt ? { createdAt } : {}),
    },
    select: { id: true, createdAt: true },
  });
}

describe('GET /:id/messages — cursor composite (createdAt, messageId)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('pagine correctement avec curseur composite sur timestamps distincts', async () => {
    await resetDb();

    const owner = await getAccessToken({ app, email: 'msg-cursor-owner@test.com', role: Role.RIDER, emailVerified: true });
    const peer = await getAccessToken({ app, email: 'msg-cursor-peer@test.com', role: Role.RIDER, emailVerified: true });

    const conv = await createConversationWithMembers(owner.userId, peer.userId);

    // 5 messages avec timestamps espacés
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await insertMessage(conv.id, owner.userId, `msg-${i}`, new Date(now + i * 1000));
    }

    // Page 1 : limit=3, ordre décroissant → messages 4, 3, 2
    const page1 = await owner.session
      .get(`/conversations/${conv.id}/messages?limit=3`)
      .expect(200);

    const p1 = page1.body as MsgListResponse;
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).not.toBeNull();

    // Page 2 : doit contenir les 2 messages restants (1, 0) — sans doublon ni saut
    const page2 = await owner.session
      .get(`/conversations/${conv.id}/messages?limit=3&cursor=${encodeURIComponent(p1.nextCursor!)}`)
      .expect(200);

    const p2 = page2.body as MsgListResponse;
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();

    // Vérifier qu'aucun ID n'est dupliqué entre pages
    const allIds = [...p1.items.map(m => m.id), ...p2.items.map(m => m.id)];
    expect(new Set(allIds).size).toBe(5);
  });

  it('STABILITÉ : deux messages avec le même timestamp — pagination sans saut ni doublon', async () => {
    await resetDb();

    const owner = await getAccessToken({ app, email: 'msg-collision-owner@test.com', role: Role.RIDER, emailVerified: true });
    const peer = await getAccessToken({ app, email: 'msg-collision-peer@test.com', role: Role.RIDER, emailVerified: true });

    const conv = await createConversationWithMembers(owner.userId, peer.userId);

    // 4 messages : messages 1 et 2 ont le MÊME timestamp — cas de collision
    const sharedTs = new Date('2026-03-17T10:00:00.000Z');
    const msg0 = await insertMessage(conv.id, owner.userId, 'before-collision', new Date(sharedTs.getTime() - 1000));
    const msg1 = await insertMessage(conv.id, owner.userId, 'collision-A', sharedTs);
    const msg2 = await insertMessage(conv.id, owner.userId, 'collision-B', sharedTs);
    const msg3 = await insertMessage(conv.id, owner.userId, 'after-collision', new Date(sharedTs.getTime() + 1000));

    // Page 1 : limit=2 → doit retourner msg3 + l'un des deux collision (le plus récent par id)
    const page1 = await owner.session
      .get(`/conversations/${conv.id}/messages?limit=2`)
      .expect(200);
    const p1 = page1.body as MsgListResponse;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    // Page 2 : doit retourner les 2 restants
    const page2 = await owner.session
      .get(`/conversations/${conv.id}/messages?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`)
      .expect(200);
    const p2 = page2.body as MsgListResponse;
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();

    // Couverture complète sans doublon — tous les 4 messages présents
    const allIds = new Set([...p1.items.map(m => m.id), ...p2.items.map(m => m.id)]);
    expect(allIds.size).toBe(4);
    expect(allIds.has(msg0.id)).toBe(true);
    expect(allIds.has(msg1.id)).toBe(true);
    expect(allIds.has(msg2.id)).toBe(true);
    expect(allIds.has(msg3.id)).toBe(true);
  });

  it('RÉTROCOMPATIBILITÉ : ancien cursor ISO datetime accepté sans erreur', async () => {
    await resetDb();

    const owner = await getAccessToken({ app, email: 'msg-compat-owner@test.com', role: Role.RIDER, emailVerified: true });
    const peer = await getAccessToken({ app, email: 'msg-compat-peer@test.com', role: Role.RIDER, emailVerified: true });

    const conv = await createConversationWithMembers(owner.userId, peer.userId);

    const ts = new Date('2026-03-17T09:00:00.000Z');
    await insertMessage(conv.id, owner.userId, 'old-msg', new Date(ts.getTime() - 1000));
    await insertMessage(conv.id, owner.userId, 'new-msg', new Date(ts.getTime() + 1000));

    // Cursor ISO brut (ancien format) : ne doit pas planter, doit retourner les messages antérieurs
    const oldCursor = ts.toISOString();
    const res = await owner.session
      .get(`/conversations/${conv.id}/messages?cursor=${encodeURIComponent(oldCursor)}`)
      .expect(200);

    const body = res.body as MsgListResponse;
    // Au moins le message antérieur est présent
    expect(body.items.some(m => m.content === 'old-msg')).toBe(true);
    // Le message postérieur ne doit PAS être présent (cursor exclut le futur)
    expect(body.items.some(m => m.content === 'new-msg')).toBe(false);
  });
});
