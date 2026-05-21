/**
 * Tests API admin — GET /admin/analytics/supply-diagnostics
 *
 * Valide :
 *   - 401 sans token
 *   - 403 pour rider et pro non-admin
 *   - 200 avec les métriques attendues pour un admin
 *   - Structure de la réponse (tous les champs présents, types corrects)
 *   - Cas zéro pro (table vide)
 *   - Pro sans coordonnées (verifiedProsMissingLocation > 0)
 *   - Opt-out global (notifyLessonRequests=false)
 *   - Opt-out surf uniquement (notifyForSurf=false)
 *   - Opt-out kitesurf uniquement (notifyForKitesurf=false)
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN  = 'supply-diag-admin@test.com';
const EMAIL_RIDER  = 'supply-diag-rider@test.com';
const EMAIL_PRO    = 'supply-diag-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET     ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAuth() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({ data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true } }),
    prisma.user.create({ data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true } }),
    prisma.user.create({ data: { email: EMAIL_PRO,   password: 'hash', role: 'PRO',   emailVerified: true } }),
  ]);
  await Promise.all([
    prisma.adminProfile.create({ data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] } }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({ data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 } }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken:   signToken(proUser.id,   'PRO'),
  };
}

async function createVerifiedPro(emailSuffix: string, opts?: { lat?: number | null; lng?: number | null }) {
  const user = await prisma.user.create({
    data: { email: `supply-pro-${emailSuffix}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
  });
  const lat = opts?.lat !== undefined ? opts.lat : 44.8;
  const lng = opts?.lng !== undefined ? opts.lng : -1.2;
  await prisma.proProfile.create({ data: { userId: user.id, lat, lng, radiusKm: 20, verified: true } });
  return user.id;
}

async function setNotificationPrefs(userId: string, prefs: {
  notifyLessonRequests?: boolean;
  notifyForSurf?: boolean;
  notifyForKitesurf?: boolean;
}) {
  await prisma.notificationPreferences.create({ data: { userId, ...prefs } });
}

beforeAll(() => { ensureSecrets(); });

// ─── AuthN / AuthZ ────────────────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app).get('/admin/analytics/supply-diagnostics').expect(401);
  });

  it('returns 403 for a rider', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('returns 403 for a pro', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });

  it('returns 200 for an admin', async () => {
    const { adminToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});

// ─── Response structure ───────────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — response shape', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('returns all required top-level fields', async () => {
    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('verifiedProsTotal');
    expect(body).toHaveProperty('verifiedProsWithLocation');
    expect(body).toHaveProperty('verifiedProsMissingLocation');
    expect(body).toHaveProperty('verifiedProsNotifyLessonEnabled');
    expect(body).toHaveProperty('verifiedProsLessonOptOut');
    expect(body).toHaveProperty('bySport');

    const bySport = body.bySport as Record<string, unknown>;
    expect(bySport).toHaveProperty('surf');
    expect(bySport).toHaveProperty('kitesurf');

    for (const sport of ['surf', 'kitesurf']) {
      const s = bySport[sport] as Record<string, unknown>;
      expect(s).toHaveProperty('prosVerified');
      expect(s).toHaveProperty('prosWithLocation');
      expect(s).toHaveProperty('prosNotifyEnabled');
    }
  });

  it('all count fields are numbers (not bigint strings)', async () => {
    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    for (const key of [
      'verifiedProsTotal', 'verifiedProsWithLocation', 'verifiedProsMissingLocation',
      'verifiedProsNotifyLessonEnabled', 'verifiedProsLessonOptOut',
    ]) {
      expect(typeof body[key]).toBe('number');
    }
    const bySport = body.bySport as Record<string, Record<string, unknown>>;
    for (const sport of ['surf', 'kitesurf']) {
      expect(typeof bySport[sport].prosVerified).toBe('number');
      expect(typeof bySport[sport].prosWithLocation).toBe('number');
      expect(typeof bySport[sport].prosNotifyEnabled).toBe('number');
    }
  });

  it('verifiedProsTotal = verifiedProsWithLocation + verifiedProsMissingLocation', async () => {
    await createVerifiedPro('shape-loc');
    await createVerifiedPro('shape-noloc', { lat: null, lng: null });

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsTotal).toBe(body.verifiedProsWithLocation + body.verifiedProsMissingLocation);
  });

  it('verifiedProsTotal = verifiedProsNotifyLessonEnabled + verifiedProsLessonOptOut', async () => {
    const userId = await createVerifiedPro('shape-optout');
    await setNotificationPrefs(userId, { notifyLessonRequests: false });

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsTotal).toBe(body.verifiedProsNotifyLessonEnabled + body.verifiedProsLessonOptOut);
  });
});

// ─── Cas zéro pro ─────────────────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — cas zéro pro', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('returns all zeros when no verified ProProfile exists', async () => {
    // Le proUser créé par seedAuth() est verified=false par défaut.
    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsTotal).toBe(0);
    expect(body.verifiedProsWithLocation).toBe(0);
    expect(body.verifiedProsMissingLocation).toBe(0);
    expect(body.verifiedProsNotifyLessonEnabled).toBe(0);
    expect(body.verifiedProsLessonOptOut).toBe(0);

    const bySport = (res.body as Record<string, Record<string, Record<string, number>>>).bySport;
    for (const sport of ['surf', 'kitesurf']) {
      expect(bySport[sport].prosVerified).toBe(0);
      expect(bySport[sport].prosWithLocation).toBe(0);
      expect(bySport[sport].prosNotifyEnabled).toBe(0);
    }
  });
});

// ─── Pro sans coordonnées ──────────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — pro sans coordonnées', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('increments verifiedProsMissingLocation for pros with null lat/lng', async () => {
    await createVerifiedPro('with-loc');                       // lat/lng définis
    await createVerifiedPro('no-loc', { lat: null, lng: null }); // aucune coordonnée

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsTotal).toBe(2);
    expect(body.verifiedProsWithLocation).toBe(1);
    expect(body.verifiedProsMissingLocation).toBe(1);
  });

  it('pro with only lat set (lng null) is counted as missing location', async () => {
    await createVerifiedPro('lat-only', { lat: 44.8, lng: null });

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsWithLocation).toBe(0);
    expect(body.verifiedProsMissingLocation).toBe(1);
  });
});

// ─── Opt-out global ───────────────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — opt-out global', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('counts pros with notifyLessonRequests=false as opted out', async () => {
    const userId = await createVerifiedPro('global-optout');
    await setNotificationPrefs(userId, { notifyLessonRequests: false });
    await createVerifiedPro('global-enabled'); // pas de prefs → défaut true

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsTotal).toBe(2);
    expect(body.verifiedProsLessonOptOut).toBe(1);
    expect(body.verifiedProsNotifyLessonEnabled).toBe(1);
  });

  it('pros without NotificationPreferences record are counted as enabled (defaults true)', async () => {
    await createVerifiedPro('no-prefs-a');
    await createVerifiedPro('no-prefs-b');

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    expect(body.verifiedProsLessonOptOut).toBe(0);
    expect(body.verifiedProsNotifyLessonEnabled).toBe(2);
  });

  it('opt-out global removes pro from both surf and kitesurf prosNotifyEnabled', async () => {
    const userId = await createVerifiedPro('global-both-out');
    await setNotificationPrefs(userId, { notifyLessonRequests: false });

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bySport = (res.body as Record<string, Record<string, Record<string, number>>>).bySport;
    expect(bySport.surf.prosNotifyEnabled).toBe(0);
    expect(bySport.kitesurf.prosNotifyEnabled).toBe(0);
  });
});

// ─── Opt-out surf uniquement ──────────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — surf uniquement', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('notifyForSurf=false removes pro from surf but not kitesurf prosNotifyEnabled', async () => {
    const userId = await createVerifiedPro('surf-optout');
    await setNotificationPrefs(userId, { notifyForSurf: false }); // kitesurf reste true par défaut
    await createVerifiedPro('surf-enabled'); // pas de prefs → tout activé

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bySport = (res.body as Record<string, Record<string, Record<string, number>>>).bySport;
    expect(bySport.surf.prosVerified).toBe(2);
    expect(bySport.surf.prosNotifyEnabled).toBe(1);      // seulement surf-enabled
    expect(bySport.kitesurf.prosNotifyEnabled).toBe(2);  // les deux sont kitesurf-enabled
  });

  it('verifiedProsNotifyLessonEnabled is not affected by surf-only opt-out', async () => {
    const userId = await createVerifiedPro('surf-only-out');
    await setNotificationPrefs(userId, { notifyForSurf: false });

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, number>;
    // notifyLessonRequests n'est pas false → pro compte comme enabled globalement
    expect(body.verifiedProsNotifyLessonEnabled).toBe(1);
    expect(body.verifiedProsLessonOptOut).toBe(0);
  });
});

// ─── Opt-out kitesurf uniquement ──────────────────────────────────────────────

describe('GET /admin/analytics/supply-diagnostics — kitesurf uniquement', () => {
  let adminToken: string;

  beforeEach(async () => { ({ adminToken } = await seedAuth()); });

  it('notifyForKitesurf=false removes pro from kitesurf but not surf prosNotifyEnabled', async () => {
    const userId = await createVerifiedPro('kite-optout');
    await setNotificationPrefs(userId, { notifyForKitesurf: false }); // surf reste true par défaut
    await createVerifiedPro('kite-enabled'); // pas de prefs → tout activé

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bySport = (res.body as Record<string, Record<string, Record<string, number>>>).bySport;
    expect(bySport.kitesurf.prosVerified).toBe(2);
    expect(bySport.kitesurf.prosNotifyEnabled).toBe(1);  // seulement kite-enabled
    expect(bySport.surf.prosNotifyEnabled).toBe(2);      // les deux sont surf-enabled
  });

  it('notifyForSurf=false and notifyForKitesurf=false each remove from their respective sport only', async () => {
    const userId1 = await createVerifiedPro('kite-a');
    await setNotificationPrefs(userId1, { notifyForKitesurf: false });

    const userId2 = await createVerifiedPro('surf-a');
    await setNotificationPrefs(userId2, { notifyForSurf: false });

    await createVerifiedPro('both-enabled'); // pas de prefs → tout activé

    const res = await request(app)
      .get('/admin/analytics/supply-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bySport = (res.body as Record<string, Record<string, Record<string, number>>>).bySport;
    expect(bySport.surf.prosNotifyEnabled).toBe(2);     // kite-a a surf activé, both-enabled aussi
    expect(bySport.kitesurf.prosNotifyEnabled).toBe(2); // surf-a a kitesurf activé, both-enabled aussi
  });
});
