/**
 * Tests P0 Step 2.1 : Auth Hardening
 *
 * OBJECTIF:
 * - Vérifier que user soft-deleted est bloqué
 * - Vérifier que token trop gros est rejeté
 *
 * STABILITÉ:
 * - Tests rapides (<5sec)
 * - Cleanup complet
 */

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { initializeSocket } from '../socket';
import { clientPrisma as prisma } from '@blobinfini/database';
import bcrypt from 'bcryptjs';
import { resetAuthCache } from '../socket-auth-cache';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const TEST_PORT = 4097;
const TEST_EMAIL_DELETED = 'ws-deleted-test@test.com';

describe('WebSocket Auth Hardening (P0 Step 2.1)', () => {
  let httpServer: any;
  let serverIO: SocketIOServer;
  let testUserId: string;
  let clients: ClientSocket[] = [];

  beforeAll(async () => {
    // Créer user fixture (sera soft-deleted dans un test)
    const password = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.upsert({
      where: { email: TEST_EMAIL_DELETED },
      update: {},
      create: {
        email: TEST_EMAIL_DELETED,
        password,
        role: 'RIDER',
        emailVerified: true
      }
    });
    testUserId = user.id;

    // Setup serveur WebSocket
    httpServer = createServer();
    serverIO = initializeSocket(httpServer);
    httpServer.listen(TEST_PORT);

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    // Cleanup
    clients.forEach((c) => {
      try {
        c.disconnect();
      } catch (e) {
        // Ignore
      }
    });

    if (serverIO) serverIO.close();
    if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    // Cleanup DB
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL_DELETED } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Disconnect clients
    for (const client of clients) {
      try {
        if (client.connected) client.disconnect();
      } catch (e) {
        // Ignore
      }
    }
    clients = [];

    // Reset cache
    resetAuthCache();

    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  const createAuthToken = (userId: string) => {
    return jwt.sign({ sub: userId, role: 'RIDER' }, JWT_SECRET, { expiresIn: '1h' });
  };

  const connectClient = (token: string): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${TEST_PORT}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false
      });

      const timeout = setTimeout(() => {
        client.disconnect();
        reject(new Error('Connection timeout'));
      }, 3000);

      client.on('connect', () => {
        clearTimeout(timeout);
        resolve(client);
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  };

  // ==========================================================================
  // TEST P0 STEP 2.1-1: Deleted user blocked
  // ==========================================================================

  it('should BLOCK soft-deleted user (deletedAt set)', async () => {
    // Soft-delete le user
    await prisma.user.update({
      where: { id: testUserId },
      data: { deletedAt: new Date() }
    });

    // Tenter connexion avec token valide mais user deleted
    const token = createAuthToken(testUserId);

    await expect(connectClient(token)).rejects.toThrow(/User not found/i);
  }, 10000);

  // ==========================================================================
  // TEST P0 STEP 2.1-2: Token trop gros rejeté
  // ==========================================================================

  it('should BLOCK token > 4096 chars (DoS protection)', async () => {
    // Générer token énorme (padding avec payload fictif)
    const hugePayload = { sub: testUserId, role: 'RIDER', padding: 'A'.repeat(5000) };
    const hugeToken = jwt.sign(hugePayload, JWT_SECRET);

    // Vérifier que le token fait bien > 4096 chars
    expect(hugeToken.length).toBeGreaterThan(4096);

    // Tenter connexion avec token énorme
    await expect(connectClient(hugeToken)).rejects.toThrow();
  }, 10000);

});

/*
 * TEST ADDITIONNEL (P1):
 *
 * 3. Token normal OK (pas de régression)
 *    → Couvert par tests existants (socket-connection-limits.test.ts)
 *    → Pas de régression observée
 *
 * TESTS P0 CRITIQUES VALIDÉS: ✅ Deleted user blocked, Token size guard
 */
