import { createApp } from '../../../index';
import request, { SuperAgentTest } from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { ensureProProfile, ensureRiderProfile, createUser } from '../../../tests/helpers/prismaFactories';
import { Role } from '@prisma/client';
import { prisma } from '@blobinfini/database';

describe('Conversations E2E', () => {
  const app = createApp();
  let agent: SuperAgentTest;
  let csrfToken: string;
  const post = (path: string) => agent.post(path).set('X-CSRF-Token', csrfToken);
  let riderAccessToken: string;
  let proAccessToken: string;
  let otherProAccessToken: string;
  let riderId: string;
  let proId: string;
  let otherRiderId: string;
  let otherProId: string;

  const resolveUserId = async (
    response: SupertestResponse,
    email: string,
    role: Role,
  ) => {
    if (response.body?.userId) {
      return response.body.userId as string;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return existing.id;
    }

    const fallback = await createUser(
      prisma,
      { email, role },
      { rawPassword: 'Passw0rd!' },
    );
    return fallback.id;
  };

  beforeAll(async () => {
    agent = request.agent(app);
    const csrfRes = await agent.get('/csrf-token').expect(200);
    csrfToken = csrfRes.body.csrfToken as string;

    // Nettoyer la DB
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();

    // Créer un rider
    const riderRes = await post('/auth/register')
      .send({ email: 'rider@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);
    riderId = await resolveUserId(riderRes, 'rider@test.com', Role.RIDER);

    // Créer un autre rider
    const otherRiderRes = await post('/auth/register')
      .send({ email: 'rider2@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);
    otherRiderId = await resolveUserId(otherRiderRes, 'rider2@test.com', Role.RIDER);

    // Créer un PRO
    const proRes = await post('/auth/register')
      .send({ email: 'pro@test.com', password: 'Passw0rd!', role: 'PRO', consentAccepted: true })
      .expect(201);
    proId = await resolveUserId(proRes, 'pro@test.com', Role.PRO);

    // Créer un autre PRO
    const otherProRes = await post('/auth/register')
      .send({ email: 'pro2@test.com', password: 'Passw0rd!', role: 'PRO', consentAccepted: true })
      .expect(201);
    otherProId = await resolveUserId(otherProRes, 'pro2@test.com', Role.PRO);

    // Login rider
    const riderLogin = await post('/auth/login')
      .send({ email: 'rider@test.com', password: 'Passw0rd!' })
      .expect(200);
    riderAccessToken = riderLogin.body.accessToken;

    // Login PRO
    const proLogin = await post('/auth/login')
      .send({ email: 'pro@test.com', password: 'Passw0rd!' })
      .expect(200);
    proAccessToken = proLogin.body.accessToken;

    // Login autre PRO
    const otherProLogin = await post('/auth/login')
      .send({ email: 'pro2@test.com', password: 'Passw0rd!' })
      .expect(200);
    otherProAccessToken = otherProLogin.body.accessToken;

    // Créer les profils
    await ensureRiderProfile(prisma, {
      userId: riderId,
      profile: { displayName: 'Rider Test' },
    });

    await ensureRiderProfile(prisma, {
      userId: otherRiderId,
      profile: { displayName: 'Other Rider' },
    });

    await ensureProProfile(prisma, {
      userId: proId,
      profile: { businessName: 'Pro Business' },
    });

    await ensureProProfile(prisma, {
      userId: otherProId,
      profile: { businessName: 'Other Pro Business' },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Opening conversations', () => {
    it('should create RIDER_TO_RIDER conversation', async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId })
        .expect(201);

      expect(res.body).toHaveProperty('id');

      // Vérifier le type de conversation
      const conv = await prisma.conversation.findUnique({
        where: { id: res.body.id }
      });
      expect(conv?.type).toBe('RIDER_TO_RIDER');
    });

    it('should create RIDER_TO_PRO conversation', async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: proId })
        .expect(201);

      expect(res.body).toHaveProperty('id');

      // Vérifier le type de conversation
      const conv = await prisma.conversation.findUnique({
        where: { id: res.body.id }
      });
      expect(conv?.type).toBe('RIDER_TO_PRO');
    });

    it('should create PRO_TO_PRO conversation', async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ targetUserId: otherProId })
        .expect(201);

      expect(res.body).toHaveProperty('id');

      // Vérifier le type de conversation
      const conv = await prisma.conversation.findUnique({
        where: { id: res.body.id }
      });
      expect(conv?.type).toBe('PRO_TO_PRO');
    });

    it('should create RIDER_TO_PRO conversation when PRO contacts RIDER', async () => {
      // Un PRO qui contacte un RIDER doit créer une conversation RIDER_TO_PRO
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ targetUserId: riderId })
        .expect((res) => {
          expect([200, 201]).toContain(res.status);
        });

      expect(res.body).toHaveProperty('id');

      // Vérifier le type de conversation
      const conv = await prisma.conversation.findUnique({
        where: { id: res.body.id }
      });
      expect(conv?.type).toBe('RIDER_TO_PRO');
    });
  });

  describe('Listing conversations', () => {
    let riderToRiderConvId: string;
    let riderToProConvId: string;
    let proToProConvId: string;

    beforeAll(async () => {
      // Créer les conversations de test
      const r2rRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId });
      riderToRiderConvId = r2rRes.body.id;

      const r2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: proId });
      riderToProConvId = r2pRes.body.id;

      const p2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ targetUserId: otherProId });
      proToProConvId = p2pRes.body.id;

      // Ajouter des messages pour tester
      await post(`/conversations/${riderToRiderConvId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ content: 'Hello other rider!' });

      await post(`/conversations/${riderToProConvId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ content: 'Hello pro!' });

      await post(`/conversations/${proToProConvId}/messages`)
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ content: 'Hello other pro!' });
    });

    it('should list all conversations', async () => {
      const res = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);

      // Vérifier que les types sont correctement retournés
      const riderConv = res.body.items.find((c: any) => c.type === 'RIDER_TO_RIDER');
      const proConv = res.body.items.find((c: any) => c.type === 'RIDER_TO_PRO');

      expect(riderConv).toBeDefined();
      expect(riderConv.otherDisplayName).toBe('Other Rider');
      expect(riderConv.otherRole).toBe('RIDER');

      expect(proConv).toBeDefined();
      expect(proConv.otherDisplayName).toBe('Pro Business');
      expect(proConv.otherRole).toBe('PRO');
    });

    it('should filter by RIDER_TO_RIDER type', async () => {
      const res = await agent
        .get('/conversations?type=RIDER_TO_RIDER')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe('RIDER_TO_RIDER');
      expect(res.body.items[0].otherRole).toBe('RIDER');
    });

    it('should filter by RIDER_TO_PRO type', async () => {
      const res = await agent
        .get('/conversations?type=RIDER_TO_PRO')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe('RIDER_TO_PRO');
      expect(res.body.items[0].otherRole).toBe('PRO');
    });

    it('should filter by PRO_TO_PRO type', async () => {
      const res = await agent
        .get('/conversations?type=PRO_TO_PRO')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe('PRO_TO_PRO');
      expect(res.body.items[0].otherRole).toBe('PRO');
      expect(res.body.items[0].otherDisplayName).toBe('Other Pro Business');
    });

    it('should show PRO conversations correctly for pros', async () => {
      // Un PRO doit voir à la fois ses conversations avec des riders ET avec d'autres pros
      const res = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2); // 1 RIDER_TO_PRO + 1 PRO_TO_PRO

      const riderToProConv = res.body.items.find((c: any) => c.type === 'RIDER_TO_PRO');
      const proToProConv = res.body.items.find((c: any) => c.type === 'PRO_TO_PRO');

      expect(riderToProConv).toBeDefined();
      expect(riderToProConv.otherRole).toBe('RIDER');
      expect(riderToProConv.otherDisplayName).toBe('Rider Test');

      expect(proToProConv).toBeDefined();
      expect(proToProConv.otherRole).toBe('PRO');
      expect(proToProConv.otherDisplayName).toBe('Other Pro Business');
    });
  });

  describe('Sending messages', () => {
    let conversationId: string;

    beforeAll(async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: proId });
      conversationId = res.body.id;
    });

    it('should send message in conversation', async () => {
      const res = await post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ content: 'Test message', type: 'TEXT' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should get messages from conversation', async () => {
      const res = await agent
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items[0]).toHaveProperty('content');
      expect(res.body.items[0]).toHaveProperty('senderId');
    });
  });

  describe('Conversation management', () => {
    let conversationId: string;

    beforeAll(async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId });
      conversationId = res.body.id;
    });

    it('should favorite conversation', async () => {
      const res = await post(`/conversations/${conversationId}/favorite`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ value: true })
        .expect(200);

      expect(res.body.favorite).toBe(true);
    });

    it('should trash conversation', async () => {
      await post(`/conversations/${conversationId}/trash`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ action: 'trash' })
        .expect(200);

      // Vérifier que la conversation n'apparaît plus dans la liste normale
      const listRes = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const trashedConv = listRes.body.items.find((c: any) => c.id === conversationId);
      expect(trashedConv).toBeUndefined();
    });

    it('should show trashed conversation with includeTrashed=true', async () => {
      const res = await agent
        .get('/conversations?includeTrashed=true')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const trashedConv = res.body.items.find((c: any) => c.id === conversationId);
      expect(trashedConv).toBeDefined();
      expect(trashedConv.trashed).toBe(true);
    });

    it('should untrash conversation', async () => {
      await post(`/conversations/${conversationId}/trash`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ action: 'untrash' })
        .expect(200);

      // Vérifier que la conversation réapparaît dans la liste normale
      const listRes = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const untrashedConv = listRes.body.items.find((c: any) => c.id === conversationId);
      expect(untrashedConv).toBeDefined();
      expect(untrashedConv.trashed).toBe(false);
    });
  });

  describe('Blocking system', () => {
    let conversationId: string;

    beforeAll(async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId });
      conversationId = res.body.id;
    });

    it('should block conversation', async () => {
      const res = await post(`/conversations/${conversationId}/block`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ action: 'block' })
        .expect(200);

      expect(res.body.blocked).toBe(true);
    });

    it('should show blocked status in conversation list', async () => {
      const listRes = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const blockedConv = listRes.body.items.find((c: any) => c.id === conversationId);
      expect(blockedConv).toBeDefined();
      expect(blockedConv.blocked).toBe(true);
    });

    it('should prevent blocked user from sending messages', async () => {
      // L'autre rider (qui est bloqué) ne peut plus envoyer de messages
      const otherRiderLogin = await post('/auth/login')
        .send({ email: 'rider2@test.com', password: 'Passw0rd!' });
      const otherRiderToken = otherRiderLogin.body.accessToken;

      await post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${otherRiderToken}`)
        .send({ content: 'This should be blocked!' })
        .expect(403);
    });

    it('should allow unblocking conversation', async () => {
      const res = await post(`/conversations/${conversationId}/block`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ action: 'unblock' })
        .expect(200);

      expect(res.body.blocked).toBe(false);

      // Vérifier que le statut est mis à jour
      const listRes = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const unblockedConv = listRes.body.items.find((c: any) => c.id === conversationId);
      expect(unblockedConv.blocked).toBe(false);
    });

    it('should allow messages after unblocking', async () => {
      // L'autre rider peut maintenant envoyer des messages
      const otherRiderLogin = await post('/auth/login')
        .send({ email: 'rider2@test.com', password: 'Passw0rd!' });
      const otherRiderToken = otherRiderLogin.body.accessToken;

      await post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${otherRiderToken}`)
        .send({ content: 'Message after unblock' })
        .expect(201);
    });

    it('should allow blocking PRO_TO_PRO conversations', async () => {
      // Créer une conversation PRO_TO_PRO
      const p2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ targetUserId: otherProId });
      const p2pConvId = p2pRes.body.id;

      // Bloquer la conversation
      await post(`/conversations/${p2pConvId}/block`)
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ action: 'block' })
        .expect(200);

      // Vérifier que l'autre PRO ne peut plus envoyer de messages
      await post(`/conversations/${p2pConvId}/messages`)
        .set('Authorization', `Bearer ${otherProAccessToken}`)
        .send({ content: 'Blocked PRO message' })
        .expect(403);
    });

    it('should allow blocking RIDER_TO_PRO conversations from PRO side', async () => {
      // Créer une conversation RIDER_TO_PRO
      const r2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: proId });
      const r2pConvId = r2pRes.body.id;

      // Le PRO bloque la conversation
      await post(`/conversations/${r2pConvId}/block`)
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ action: 'block' })
        .expect(200);

      // Vérifier que le RIDER ne peut plus envoyer de messages
      await post(`/conversations/${r2pConvId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ content: 'Blocked by PRO' })
        .expect(403);
    });

    it('should allow blocking RIDER_TO_PRO conversations from RIDER side', async () => {
      // Créer une nouvelle conversation RIDER_TO_PRO
      const r2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherProId });
      const r2pConvId = r2pRes.body.id;

      // Le RIDER bloque la conversation
      await post(`/conversations/${r2pConvId}/block`)
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ action: 'block' })
        .expect(200);

      // Vérifier que l'autre PRO ne peut plus envoyer de messages
      await post(`/conversations/${r2pConvId}/messages`)
        .set('Authorization', `Bearer ${otherProAccessToken}`)
        .send({ content: 'Blocked by RIDER' })
        .expect(403);
    });
  });

  describe('Conversation filtering by type', () => {
    let riderToRiderConvId: string;
    let riderToProConvId: string;
    let proToProConvId: string;

    beforeAll(async () => {
      // Créer une conversation RIDER_TO_RIDER
      const r2rRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId });
      riderToRiderConvId = r2rRes.body.id;

      // Créer une conversation RIDER_TO_PRO
      const r2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: proId });
      riderToProConvId = r2pRes.body.id;

      // Créer une conversation PRO_TO_PRO
      const p2pRes = await post('/conversations/open')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .send({ targetUserId: otherProId });
      proToProConvId = p2pRes.body.id;
    });

    it('should filter PRO conversations by RIDER_TO_PRO type', async () => {
      const res = await agent
        .get('/conversations?type=RIDER_TO_PRO')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .expect(200);

      const riderToProConvs = res.body.items.filter((c: any) => c.type === 'RIDER_TO_PRO');
      expect(riderToProConvs.length).toBeGreaterThan(0);

      // Vérifier qu'il n'y a que des conversations RIDER_TO_PRO
      res.body.items.forEach((conv: any) => {
        expect(conv.type).toBe('RIDER_TO_PRO');
      });
    });

    it('should filter PRO conversations by PRO_TO_PRO type', async () => {
      const res = await agent
        .get('/conversations?type=PRO_TO_PRO')
        .set('Authorization', `Bearer ${proAccessToken}`)
        .expect(200);

      const proToProConvs = res.body.items.filter((c: any) => c.type === 'PRO_TO_PRO');
      expect(proToProConvs.length).toBeGreaterThan(0);

      // Vérifier qu'il n'y a que des conversations PRO_TO_PRO
      res.body.items.forEach((conv: any) => {
        expect(conv.type).toBe('PRO_TO_PRO');
      });
    });

    it('should filter RIDER conversations by RIDER_TO_RIDER type', async () => {
      const res = await agent
        .get('/conversations?type=RIDER_TO_RIDER')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      // Vérifier qu'il n'y a que des conversations RIDER_TO_RIDER
      res.body.items.forEach((conv: any) => {
        expect(conv.type).toBe('RIDER_TO_RIDER');
      });
    });

    it('should filter RIDER conversations by RIDER_TO_PRO type', async () => {
      const res = await agent
        .get('/conversations?type=RIDER_TO_PRO')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      // Vérifier qu'il n'y a que des conversations RIDER_TO_PRO
      res.body.items.forEach((conv: any) => {
        expect(conv.type).toBe('RIDER_TO_PRO');
      });
    });
  });

  describe('Unread message count', () => {
    let conversationId: string;

    beforeAll(async () => {
      const res = await post('/conversations/open')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .send({ targetUserId: otherRiderId });
      conversationId = res.body.id;
    });

    it('should track unread messages correctly', async () => {
      // Faire lire les messages existants d'abord
      await agent
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${riderAccessToken}`);

      // Simuler qu'un autre user envoie un message
      const otherRiderLogin = await post('/auth/login')
        .send({ email: 'rider2@test.com', password: 'Passw0rd!' });
      const otherRiderToken = otherRiderLogin.body.accessToken;

      await post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${otherRiderToken}`)
        .send({ content: 'Unread message!' });

      // Vérifier le count non lu
      const listRes = await agent
        .get('/conversations')
        .set('Authorization', `Bearer ${riderAccessToken}`)
        .expect(200);

      const conv = listRes.body.items.find((c: any) => c.id === conversationId);
      expect(conv.unread).toBe(1);
    });
  });
});
