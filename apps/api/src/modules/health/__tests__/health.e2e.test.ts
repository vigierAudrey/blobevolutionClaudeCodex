/**
 * Tests e2e des sondes de santé publiques.
 * Vérifie : accès public (sans auth), format stable, en-têtes no-store,
 * absence de fuite (secret/host/string de connexion), sémantique 200/503.
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

// Aucune chaîne sensible ne doit apparaître dans une réponse de santé.
const FORBIDDEN_PATTERNS = [
  /postgres(ql)?:\/\//i,
  /redis:\/\//i,
  /password/i,
  /secret/i,
  /\bpassword\b/i,
  /BEGIN [A-Z ]*PRIVATE KEY/i,
];

function assertNoLeak(bodyText: string) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(bodyText).not.toMatch(pattern);
  }
}

describe('GET /health (compat héritée)', () => {
  it('répond 200 { status: ok } sans authentification', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/live (liveness)', () => {
  it('répond 200 avec un payload stable, sans authentification', async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('api');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBe(new Date(res.body.timestamp).toISOString());
  });

  it('est marqué no-store (pas de cache CDN/proxy)', async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("n'expose que les clés attendues et aucun secret", async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'timestamp', 'uptimeSeconds']);
    assertNoLeak(JSON.stringify(res.body));
  });
});

describe('GET /health/ready (readiness)', () => {
  it('expose le format canonique status + checks + timestamp', async () => {
    const res = await request(app).get('/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(Object.keys(res.body).sort()).toEqual(['checks', 'status', 'timestamp']);
    expect(Object.keys(res.body.checks).sort()).toEqual(['database', 'redis', 'storage']);
    expect(['ok', 'degraded', 'critical']).toContain(res.body.status);
  });

  it('voit la base de test comme ok → pas critical, HTTP 200', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.checks.database).toBe('ok');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('en test, le storage est sans appel réseau (ok si bucket configuré, sinon not_configured)', async () => {
    const res = await request(app).get('/health/ready');
    expect(['ok', 'not_configured']).toContain(res.body.checks.storage);
  });

  it('chaque statut de check appartient à l\'énumération autorisée', async () => {
    const allowed = ['ok', 'degraded', 'critical', 'not_configured'];
    const res = await request(app).get('/health/ready');
    expect(allowed).toContain(res.body.checks.database);
    expect(allowed).toContain(res.body.checks.redis);
    expect(allowed).toContain(res.body.checks.storage);
  });

  it('est no-store et ne fuit aucun secret ni host interne', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.headers['cache-control']).toBe('no-store');
    assertNoLeak(JSON.stringify(res.body));
  });
});
