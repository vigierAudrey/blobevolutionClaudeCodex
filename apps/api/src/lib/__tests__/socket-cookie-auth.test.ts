/**
 * Tests P0 — Socket.IO cookie-only authentication
 *
 * Prouve que :
 * 1. Un utilisateur authentifié via cookie httpOnly peut se connecter
 * 2. Un utilisateur sans cookie/token est rejeté
 * 3. Un cookie avec JWT invalide est rejeté
 * 4. Bearer token (tests/SDK) continue de fonctionner (non-régression)
 * 5. Aucun token JWT n'est requis côté JS dans socket.handshake.auth
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
const TEST_PORT = 4098;
const TEST_EMAIL = 'ws-cookie-auth@test.com';

describe('Socket.IO cookie-only auth (P0)', () => {
  let httpServer: ReturnType<typeof createServer>;
  let serverIO: SocketIOServer;
  let testUserId: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    serverIO = initializeSocket(httpServer);
    httpServer.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  // beforeEach obligatoire : le global afterEach (jest.setup.db.ts) appelle resetDb()
  // qui supprime les fixtures DB après chaque test.
  beforeEach(async () => {
    const password = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.upsert({
      where: { email: TEST_EMAIL },
      update: { password, role: 'RIDER', emailVerified: true, deletedAt: null },
      create: { email: TEST_EMAIL, password, role: 'RIDER', emailVerified: true }
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    clients.forEach((c) => { try { c.disconnect(); } catch { /* ignore */ } });
    if (serverIO) serverIO.close();
    if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    for (const client of clients) {
      try { if (client.connected) client.disconnect(); } catch { /* ignore */ }
    }
    clients.length = 0;
    resetAuthCache();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  const makeJwt = (userId: string) =>
    jwt.sign({ sub: userId, role: 'RIDER' }, JWT_SECRET, { expiresIn: '1h' });

  /**
   * Connexion via cookie httpOnly (simule le navigateur avec withCredentials).
   * En Node.js on passe le cookie manuellement via extraHeaders.
   */
  const connectWithCookie = (cookieValue: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${TEST_PORT}`, {
        extraHeaders: { Cookie: `accessToken=${cookieValue}` },
        // Pas de auth.token — prouve que le cookie seul suffit
        transports: ['websocket'],
        reconnection: false
      });
      clients.push(client);

      const t = setTimeout(() => { client.disconnect(); reject(new Error('Timeout')); }, 4000);
      client.on('connect', () => { clearTimeout(t); resolve(client); });
      client.on('connect_error', (err) => { clearTimeout(t); reject(err); });
    });

  /**
   * Connexion via Bearer token (non-régression tests/SDK).
   */
  const connectWithBearer = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${TEST_PORT}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false
      });
      clients.push(client);

      const t = setTimeout(() => { client.disconnect(); reject(new Error('Timeout')); }, 4000);
      client.on('connect', () => { clearTimeout(t); resolve(client); });
      client.on('connect_error', (err) => { clearTimeout(t); reject(err); });
    });

  /**
   * Connexion sans aucun token ni cookie.
   */
  const connectWithNothing = (): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        reconnection: false
      });
      clients.push(client);

      const t = setTimeout(() => { client.disconnect(); reject(new Error('Timeout')); }, 4000);
      client.on('connect', () => { clearTimeout(t); resolve(client); });
      client.on('connect_error', (err) => { clearTimeout(t); reject(err); });
    });

  // ─── TEST 1 ──────────────────────────────────────────────────────────────────
  it('PASS: connexion avec cookie httpOnly valide (mode navigateur cookie-only)', async () => {
    const cookieJwt = makeJwt(testUserId);
    const client = await connectWithCookie(cookieJwt);
    expect(client.connected).toBe(true);
  }, 10000);

  // ─── TEST 2 ──────────────────────────────────────────────────────────────────
  it('REJECT: aucun token, aucun cookie → Authentication required', async () => {
    await expect(connectWithNothing()).rejects.toThrow(/Authentication required/i);
  }, 10000);

  // ─── TEST 3 ──────────────────────────────────────────────────────────────────
  it('REJECT: cookie avec JWT invalide (mauvaise signature)', async () => {
    const badJwt = jwt.sign({ sub: testUserId, role: 'RIDER' }, 'wrong-secret');
    await expect(connectWithCookie(badJwt)).rejects.toThrow(/Authentication failed/i);
  }, 10000);

  // ─── TEST 4 ──────────────────────────────────────────────────────────────────
  it('REJECT: cookie avec valeur non-JWT ("1" = session hint)', async () => {
    // Prouve que le session hint côté JS ("1") ne donne PAS accès au socket
    await expect(connectWithCookie('1')).rejects.toThrow();
  }, 10000);

  // ─── TEST 5 (non-régression) ──────────────────────────────────────────────────
  it('PASS: Bearer token dans handshake.auth (tests/SDK) continue de fonctionner', async () => {
    const bearerJwt = makeJwt(testUserId);
    const client = await connectWithBearer(bearerJwt);
    expect(client.connected).toBe(true);
  }, 10000);

  // ─── TEST 6 ──────────────────────────────────────────────────────────────────
  it('REJECT: cookie avec JWT expiré', async () => {
    const expiredJwt = jwt.sign({ sub: testUserId, role: 'RIDER' }, JWT_SECRET, { expiresIn: '-1s' });
    await expect(connectWithCookie(expiredJwt)).rejects.toThrow(/Authentication failed/i);
  }, 10000);

  // ─── TEST 7 ──────────────────────────────────────────────────────────────────
  it('PASS: cookie prioritaire sur auth.token vide (pas de token JS requis)', async () => {
    const cookieJwt = makeJwt(testUserId);
    // Simule le cas exact du frontend cookie-only : auth.token absent/undefined
    const client = await new Promise<ClientSocket>((resolve, reject) => {
      const c = ioClient(`http://localhost:${TEST_PORT}`, {
        extraHeaders: { Cookie: `accessToken=${cookieJwt}` },
        // auth intentionnellement absent — pas de token JS
        transports: ['websocket'],
        reconnection: false
      });
      clients.push(c);

      const t = setTimeout(() => { c.disconnect(); reject(new Error('Timeout')); }, 4000);
      c.on('connect', () => { clearTimeout(t); resolve(c); });
      c.on('connect_error', (err) => { clearTimeout(t); reject(err); });
    });
    expect(client.connected).toBe(true);
  }, 10000);
});
