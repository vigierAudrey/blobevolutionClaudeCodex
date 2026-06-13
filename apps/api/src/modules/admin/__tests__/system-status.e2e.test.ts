/**
 * Tests E2E — GET /admin/system-status (GAP-2).
 * AuthN/AuthZ server-side, no-store, shape, anti-fuite (secret/chemin absolu).
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';
import { AVAILABLE_PERMISSIONS } from '../permissions';

const app = createApp();

const EMAILS = ['sysstatus-rider@test.local', 'sysstatus-admin@test.local'];

const ensureSecrets = () => {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
};
const signToken = (userId: string, role: 'RIDER' | 'PRO' | 'ADMIN') =>
  jwt.sign({ sub: userId, role }, process.env.JWT_SECRET as string, { expiresIn: '1h' });

describe('GET /admin/system-status', () => {
  let riderToken = '';
  let adminToken = '';

  beforeAll(() => {
    ensureSecrets();
  });

  // Le setup DB global tronque les tables après chaque test → reseed en beforeEach.
  beforeEach(async () => {
    const rider = await prisma.user.create({
      data: { email: EMAILS[0], password: 'hash', role: 'RIDER', emailVerified: true },
    });
    riderToken = signToken(rider.id, 'RIDER');

    const admin = await prisma.user.create({
      data: { email: EMAILS[1], password: 'hash', role: 'ADMIN', emailVerified: true },
    });
    await prisma.adminProfile.create({
      data: { userId: admin.id, permissions: [...AVAILABLE_PERMISSIONS] },
    });
    adminToken = signToken(admin.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuse un appel non authentifié (401)', async () => {
    await request(app).get('/admin/system-status').expect(401);
  });

  it('refuse un utilisateur non-admin (403)', async () => {
    await request(app)
      .get('/admin/system-status')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('autorise un admin et retourne le cockpit complet', async () => {
    const res = await request(app)
      .get('/admin/system-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ['alerts', 'backup', 'disk', 'generatedAt', 'readiness', 'version'],
    );
    expect(res.body.readiness.checks).toHaveProperty('database');
    expect(['ok', 'failed', 'unknown']).toContain(res.body.backup.state);
    expect(['ok', 'warn', 'critical', 'unknown']).toContain(res.body.disk.health);
    expect(typeof res.body.version.commit).toBe('string');
    expect(typeof res.body.alerts.open).toBe('number');
  });

  it('est no-store', async () => {
    const res = await request(app)
      .get('/admin/system-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ne fuit ni secret ni chemin absolu', async () => {
    const res = await request(app)
      .get('/admin/system-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/password|secret|postgres(ql)?:\/\/|redis:\/\//i);
    // Aucun chemin absolu de système de fichiers (le chemin disque/backup ne doit jamais sortir).
    expect(body).not.toMatch(/"\/(var|etc|home|root|usr)\b/);
    expect(body).not.toMatch(/DISK_MONITOR_PATH|BACKUP_STATE_FILE/);
  });
});
