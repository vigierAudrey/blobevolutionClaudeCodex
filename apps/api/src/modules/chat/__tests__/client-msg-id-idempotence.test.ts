import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { randomUUID } from 'crypto';

const app = createApp();

describe('POST /conversations/:id/messages (clientMsgId idempotence)', () => {
  let session: TestSession;
  let accessToken = '';
  let actorUserId = '';
  let conversationId = '';

  const resetDb = async () => {
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['idempotent-actor@test.com', 'idempotent-target@test.com'],
        },
      },
    });
  };

  const seedConversation = async () => {
    const actorAuth = await getAccessToken({
      app,
      email: 'idempotent-actor@test.com',
      role: Role.RIDER,
    });
    session = actorAuth.session;
    accessToken = actorAuth.accessToken;
    actorUserId = actorAuth.userId;

    const targetAuth = await getAccessToken({
      app,
      email: 'idempotent-target@test.com',
      role: Role.RIDER,
    });

    const conversation = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          createMany: {
            data: [
              { userId: actorUserId },
              { userId: targetAuth.userId },
            ],
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    conversationId = conversation.id;
  };

  beforeEach(async () => {
    await resetDb();
    await seedConversation();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Scenario 1: Sans clientMsgId (backward compatibility)
  it('creates message without clientMsgId (classic behavior)', async () => {
    const res = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Hello without clientMsgId' })
      .expect(201);

    expect(res.body).toMatchObject({
      ok: true,
      data: { id: expect.any(String), content: 'Hello without clientMsgId', type: 'TEXT' },
    });

    // Vérifier en DB que clientMsgId est null
    const msg = await prisma.message.findUnique({
      where: { id: res.body.data.id },
      select: { clientMsgId: true },
    });
    expect(msg?.clientMsgId).toBeNull();
  });

  // Scenario 2: Avec clientMsgId (1er envoi) - create
  it('creates message with clientMsgId (first send)', async () => {
    const clientMsgId = randomUUID();

    const res = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Hello with clientMsgId', clientMsgId })
      .expect(201);

    expect(res.body).toMatchObject({
      ok: true,
      data: { id: expect.any(String), content: 'Hello with clientMsgId', type: 'TEXT' },
    });

    // Vérifier en DB que clientMsgId est sauvegardé
    const msg = await prisma.message.findUnique({
      where: { id: res.body.data.id },
      select: { clientMsgId: true, content: true },
    });
    expect(msg?.clientMsgId).toBe(clientMsgId);
    expect(msg?.content).toBe('Hello with clientMsgId');
  });

  // Scenario 3: Avec même clientMsgId (replay) - idempotent return
  it('returns existing message on replay (same clientMsgId)', async () => {
    const clientMsgId = randomUUID();

    // 1er envoi
    const res1 = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Original message', clientMsgId })
      .expect(201);

    const firstMsgId = res1.body.data.id;

    // 2ème envoi (replay avec même clientMsgId, contenu différent)
    const res2 = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Should be ignored', clientMsgId })
      .expect(201); // Toujours 201 (idempotent)

    // Le 2ème appel doit retourner le message original (pas de modification)
    expect(res2.body).toMatchObject({
      ok: true,
      data: { id: firstMsgId, content: 'Original message', type: 'TEXT' },
    });

    // Vérifier qu'un seul message existe en DB
    const count = await prisma.message.count({
      where: { conversationId, clientMsgId },
    });
    expect(count).toBe(1);

    // Vérifier que le contenu n'a pas été modifié
    const msg = await prisma.message.findUnique({
      where: { id: firstMsgId },
      select: { content: true },
    });
    expect(msg?.content).toBe('Original message'); // Pas "Should be ignored"
  });

  // Scenario 4: Concurrence (2 POST simultanés avec même clientMsgId)
  it('handles concurrent requests with same clientMsgId (only 1 message created)', async () => {
    const clientMsgId = randomUUID();

    // Envoyer 2 requêtes en parallèle avec le même clientMsgId
    const [res1, res2] = await Promise.all([
      session
        .post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-API-ENVELOPE', '1')
        .send({ type: 'TEXT', content: 'Concurrent message 1', clientMsgId }),
      session
        .post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-API-ENVELOPE', '1')
        .send({ type: 'TEXT', content: 'Concurrent message 2', clientMsgId }),
    ]);

    // Les deux doivent retourner 201 OK
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // Les deux doivent retourner le même message ID
    const id1 = res1.body.data.id;
    const id2 = res2.body.data.id;
    expect(id1).toBe(id2);

    // Vérifier qu'un seul message existe en DB
    const count = await prisma.message.count({
      where: { conversationId, clientMsgId },
    });
    expect(count).toBe(1);
  });

  // Scenario 5: clientMsgId différents créent des messages distincts
  it('creates distinct messages with different clientMsgIds', async () => {
    const clientMsgId1 = randomUUID();
    const clientMsgId2 = randomUUID();

    const res1 = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Message 1', clientMsgId: clientMsgId1 })
      .expect(201);

    const res2 = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Message 2', clientMsgId: clientMsgId2 })
      .expect(201);

    // Vérifier que les IDs sont différents
    const id1 = res1.body.data.id;
    const id2 = res2.body.data.id;
    expect(id1).not.toBe(id2);

    // Vérifier que 2 messages existent
    const count = await prisma.message.count({
      where: { conversationId },
    });
    expect(count).toBe(2);
  });

  // Bonus: Même clientMsgId dans différentes conversations
  it('allows same clientMsgId in different conversations', async () => {
    // Créer une 2ème conversation
    const targetAuth = await getAccessToken({
      app,
      email: 'idempotent-target@test.com',
      role: Role.RIDER,
    });

    const conversation2 = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          createMany: {
            data: [
              { userId: actorUserId },
              { userId: targetAuth.userId },
            ],
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    const clientMsgId = randomUUID();

    // Envoyer le même clientMsgId dans 2 conversations différentes
    const res1 = await session
      .post(`/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Message conv1', clientMsgId })
      .expect(201);

    const res2 = await session
      .post(`/conversations/${conversation2.id}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'Message conv2', clientMsgId })
      .expect(201);

    // Vérifier que les IDs sont différents
    expect(res1.body.data.id).not.toBe(res2.body.data.id);

    // Vérifier que les contenus sont différents
    expect(res1.body.data.content).toBe('Message conv1');
    expect(res2.body.data.content).toBe('Message conv2');

    // Vérifier qu'un message par conversation existe
    const count1 = await prisma.message.count({
      where: { conversationId, clientMsgId },
    });
    const count2 = await prisma.message.count({
      where: { conversationId: conversation2.id, clientMsgId },
    });
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});
