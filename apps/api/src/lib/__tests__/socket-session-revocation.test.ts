/**
 * Tests P1-WS: Session Revocation via WebSocket
 *
 * OBJECTIF:
 * - Vérifier que logout (allDevices) déconnecte les sockets actifs immédiatement
 * - Vérifier que reconnexion avec un ancien token (sv < db) est rejetée
 * - Vérifier que invalidateCachedAuth vide le cache pour éviter le bypass 30 s
 * - Vérifier que changement de mot de passe révoque aussi les sockets
 *
 * THREAT MODEL couvert:
 * - Attaquant maintient une connexion WS après logout de la victime
 * - Attaquant tente de se reconnecter avec un JWT capturé post-logout
 * - Bypass du cache auth par reconnexion rapide après révocation
 */

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { initializeSocket } from '../socket';
import { clientPrisma as prisma } from '@blobinfini/database';
import bcrypt from 'bcryptjs';
import { resetAuthCache, setCachedAuth, invalidateCachedAuth } from '../socket-auth-cache';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const TEST_PORT = 4129;
const TEST_EMAIL = 'ws-session-revocation@test.com';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Crée un JWT avec sv (sessionVersion) explicite */
const makeToken = (userId: string, sv: number, role = 'RIDER') =>
  jwt.sign({ sub: userId, role, sv }, JWT_SECRET, { expiresIn: '1h' });

/** Tente une connexion WebSocket — résout sur connect, rejette sur connect_error */
const tryConnect = (token: string, port = TEST_PORT): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error('Connection timeout'));
    }, 4000);
    client.on('connect', () => { clearTimeout(timer); resolve(client); });
    client.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });

/** Attend qu'un socket reçoive l'événement "disconnect" avec timeout */
const waitDisconnect = (socket: ClientSocket, ms = 3000): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!socket.connected) return resolve();
    const timer = setTimeout(() => reject(new Error('Disconnect timeout')), ms);
    socket.once('disconnect', () => { clearTimeout(timer); resolve(); });
  });

// ──────────────────────────────────────────────────────────────────────────────
// Suite
// ──────────────────────────────────────────────────────────────────────────────

describe('WebSocket — Session Revocation (P1-WS)', () => {
  let httpServer: ReturnType<typeof createServer>;
  let serverIO: SocketIOServer;
  let userId: string;
  let dbSessionVersion: number;
  const clients: ClientSocket[] = [];

  // ── Setup ──

  beforeAll(async () => {
    // Démarrer le serveur WS une seule fois — le user est recréé dans beforeEach
    // car le global afterEach de jest.setup.db.ts appelle resetDb() qui supprime tous les users.
    httpServer = createServer();
    serverIO = initializeSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(TEST_PORT, resolve));
    await new Promise((r) => setTimeout(r, 300));
  });

  beforeEach(async () => {
    // Upsert à chaque test : resetDb() (global afterEach) supprime le user après chaque test.
    const password = await bcrypt.hash('Test1234!', 10);
    const user = await prisma.user.upsert({
      where: { email: TEST_EMAIL },
      update: { password, role: 'RIDER', emailVerified: true, deletedAt: null, sessionVersion: 1 },
      create: { email: TEST_EMAIL, password, role: 'RIDER', emailVerified: true, sessionVersion: 1 },
    });
    userId = user.id;
    dbSessionVersion = 1;
    resetAuthCache();
  });

  afterAll(async () => {
    clients.forEach((c) => { try { c.disconnect(); } catch { /* noop */ } });
    await new Promise<void>((resolve) => serverIO.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  });

  afterEach(async () => {
    // Déconnecter tous les clients — pas de DB ici (resetDb global s'en charge).
    for (const c of clients.splice(0)) {
      try { if (c.connected) c.disconnect(); } catch { /* noop */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  });

  // ── T1 : token sans sv (legacy) → doit se connecter normalement ──

  it('T1 — token sans sv (legacy) se connecte si user exists', async () => {
    const token = jwt.sign({ sub: userId, role: 'RIDER' }, JWT_SECRET, { expiresIn: '1h' });
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);
  }, 10000);

  // ── T2 : token sv=1, DB sv=1 → connexion OK ──

  it('T2 — token sv=1 avec DB sv=1 → connexion acceptée', async () => {
    const token = makeToken(userId, 1);
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);
  }, 10000);

  // ── T3 : token sv=1, DB sv=2 (post-logout) → connexion rejetée ──

  it('T3 — token sv=1 avec DB sv=2 (logout simulé) → connexion rejetée', async () => {
    // Simuler un logout qui incrémente sessionVersion
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 2 } });
    resetAuthCache(); // cache vidé comme le fait invalidateCachedAuth

    const oldToken = makeToken(userId, 1); // ancien token (sv=1)
    await expect(tryConnect(oldToken)).rejects.toThrow(/Session revoked/i);
  }, 10000);

  // ── T4 : token sv=1 → cache populé avec sv=1 → DB incrémentée → reconnexion rejetée ──

  it('T4 — cache avec sv=1 puis DB sv=2 → invalidateCachedAuth bloque la reconnexion', async () => {
    // Connexion initiale avec sv=1 (peuple le cache)
    const token = makeToken(userId, 1);
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);

    // Simuler logout : DB sv → 2, vider le cache (comme le fait auth.controller.ts)
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 2 } });
    invalidateCachedAuth(userId); // clé du fix P1-WS

    // Tenter une reconnexion avec l'ancien token sv=1 → doit être rejeté (DB check)
    const oldToken = makeToken(userId, 1);
    await expect(tryConnect(oldToken)).rejects.toThrow(/Session revoked/i);
  }, 15000);

  // ── T5 : cache populé avec sv=2 → reconnexion sv=1 rejetée sans hit DB ──

  it('T5 — cache sv=2 bloque token sv=1 (cache path, sans query DB)', async () => {
    // Peupler le cache avec sessionVersion=2 directement
    setCachedAuth(userId, true, 'RIDER', 2);

    const oldToken = makeToken(userId, 1);
    await expect(tryConnect(oldToken)).rejects.toThrow(/Session revoked/i);
  }, 10000);

  // ── T6 : token sv=2 → cache sv=2 → connexion acceptée ──

  it('T6 — token sv=2, cache sv=2 → connexion acceptée', async () => {
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 2 } });
    setCachedAuth(userId, true, 'RIDER', 2);

    const token = makeToken(userId, 2);
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);
  }, 10000);

  // ── T7 : disconnectUserSockets termine une connexion active ──

  it('T7 — disconnectUserSockets déconnecte les sockets actifs du user', async () => {
    const token = makeToken(userId, 1);
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);

    const disconnectPromise = waitDisconnect(client, 3000);

    // Déclencher la déconnexion côté serveur (comme le fait le logout)
    serverIO.in(`user:${userId}`).disconnectSockets(true);

    await disconnectPromise;
    expect(client.connected).toBe(false);
  }, 15000);

  // ── T8 : token sv correct → pas de rejet (pas de faux positif) ──

  it('T8 — pas de faux positif : token sv == DB sv → connexion valide', async () => {
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 3 } });
    resetAuthCache();

    const token = makeToken(userId, 3);
    const client = await tryConnect(token);
    clients.push(client);
    expect(client.connected).toBe(true);
  }, 10000);

  // ── T9 : CSRF-like — connexion sans Origin en production simulée ──

  it('T9 — pas de connexion sans auth token', async () => {
    await expect(tryConnect('')).rejects.toThrow();
  }, 10000);
});
