/**
 * Tests API admin — GET /admin/analytics/overview — geoBreakdown (Sprint C7)
 *
 * Valide :
 *   1.  geoBreakdown vide si aucun fanout
 *   2.  geoBreakdown vide si fanouts sans zoneLarge (données pré-C7)
 *   3.  une zone avec PRIVACY_THRESHOLD demandes → présente dans geoBreakdown
 *   4.  plusieurs zones — présentes et triées par requests7d décroissant
 *   5.  couverture correcte — covered7d = demandes avec prosFound > 0
 *   6.  conversion correcte — contacted7d via ContactRequest
 *   7.  anti double comptage — N fanouts même lessonRequestId = 1 demande
 *   8.  401 sans token
 *   9.  403 rôle RIDER
 *  10.  403 rôle PRO
 *  11.  403 admin sans permission analytics.view
 *  12.  confidentialité — zone < PRIVACY_THRESHOLD exclue, zone >= PRIVACY_THRESHOLD présente
 *
 * PRIVACY_THRESHOLD = 20 (défini dans analytics/definitions.ts).
 * Les zones avec < 20 demandes uniques (COUNT DISTINCT lessonRequestId) sont exclues
 * par le HAVING clause SQL — jamais retournées à l'appelant.
 *
 * Pattern : global afterEach resetDb() purge toutes les tables après chaque test.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'geo-overview-admin@test.com';
const EMAIL_RIDER = 'geo-overview-rider@test.com';
const EMAIL_PRO   = 'geo-overview-pro@test.com';

const PRIVACY_THRESHOLD = 20;

function ensureSecrets() {
  process.env.JWT_SECRET             ||= 'test-jwt-secret';
  process.env.SESSION_SECRET         ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS    = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAuth() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({
      data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_PRO, password: 'hash', role: 'PRO', emailVerified: true },
    }),
  ]);
  await Promise.all([
    prisma.adminProfile.create({
      data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] },
    }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({
      data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 },
    }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken:   signToken(proUser.id,   'PRO'),
  };
}

// Compteur global incrémental — garantit des lessonRequestIds distincts entre appels
// (y compris dans le même test). Réinitialisé implicitement par afterEach resetDb().
let _geoIdCounter = 0;

/**
 * Crée n fanouts avec des lessonRequestId et riderRef distincts dans la zone donnée.
 * Retourne les lessonRequestIds créés pour permettre des joins dans les tests.
 */
async function createFanoutsInZone(
  n: number,
  zone: string,
  opts?: { prosFound?: number },
): Promise<string[]> {
  const lessonRequestIds: string[] = [];
  const data = Array.from({ length: n }, () => {
    const id = ++_geoIdCounter;
    const lr  = String(id).padStart(16, '0');
    const ref = String(id).padStart(24, '0');
    lessonRequestIds.push(lr);
    return {
      riderRef:        ref,
      lessonRequestId: lr,
      sport:           'surf' as const,
      prosFound:       opts?.prosFound ?? 0,
      prosNotified:    0,
      failureCount:    0,
      zoneLarge:       zone,
    };
  });
  await prisma.lessonFanout.createMany({ data });
  return lessonRequestIds;
}

beforeAll(() => { ensureSecrets(); });

// ─── 8-11 : AuthN / AuthZ ──────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — auth (C7)', () => {
  it('8. returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/overview')
      .expect(401);
  });

  it('9. returns 403 for a RIDER', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('10. returns 403 for a PRO', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });

  it('11. returns 403 for admin without analytics.view permission', async () => {
    process.env.JWT_SECRET     ||= 'test-jwt-secret';
    process.env.SESSION_SECRET ||= 'test-session-secret';
    // Email non inclus dans PRIMARY_ADMIN_EMAILS → permissions depuis la DB uniquement
    process.env.PRIMARY_ADMIN_EMAILS = 'other-primary@test.com';

    const nopermUser = await prisma.user.create({
      data: { email: 'geo-noperm-admin@test.com', password: 'hash', role: 'ADMIN', emailVerified: true },
    });
    const permissionsWithout = AVAILABLE_PERMISSIONS.filter((p) => p !== 'analytics.view');
    await prisma.adminProfile.create({
      data: { userId: nopermUser.id, permissions: permissionsWithout },
    });
    const token = signToken(nopermUser.id, 'ADMIN');

    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});

// ─── 1-7 & 12 : geoBreakdown ─────────────────────────────────────────────────

describe('GET /admin/analytics/overview — geoBreakdown (C7)', () => {
  it('1. geoBreakdown vide si aucun fanout', async () => {
    const { adminToken } = await seedAuth();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.geoBreakdown).toEqual([]);
    // Garantie : champs C4/C5/C6 intacts
    expect(res.body).toHaveProperty('requests7d');
    expect(res.body).toHaveProperty('bySport');
    expect(res.body).toHaveProperty('reasonBreakdown');
  });

  it('2. geoBreakdown vide si fanouts sans zoneLarge (données pré-C7)', async () => {
    const { adminToken } = await seedAuth();

    // Fanouts sans zoneLarge (= NULL) : ignorés par le GROUP BY
    await prisma.lessonFanout.createMany({
      data: Array.from({ length: PRIVACY_THRESHOLD }, (_, i) => ({
        riderRef:        `nozone-ref-${String(i).padStart(8, '0')}`.slice(0, 24),
        lessonRequestId: `nozonesuf${String(i).padStart(6, '0')}`,
        sport:           'surf',
        prosFound:       1,
        prosNotified:    1,
        failureCount:    0,
        // zoneLarge omis → NULL en base
      })),
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.geoBreakdown).toEqual([]);
  });

  it('3. une zone avec PRIVACY_THRESHOLD demandes → présente dans geoBreakdown', async () => {
    const { adminToken } = await seedAuth();
    await createFanoutsInZone(PRIVACY_THRESHOLD, 'Z43:1', { prosFound: 0 });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.geoBreakdown).toHaveLength(1);
    expect(res.body.geoBreakdown[0].zone).toBe('Z43:1');
    expect(res.body.geoBreakdown[0].requests7d).toBe(PRIVACY_THRESHOLD);
    // Aucune donnée PII
    expect(res.body.geoBreakdown[0]).not.toHaveProperty('userId');
    expect(res.body.geoBreakdown[0]).not.toHaveProperty('riderRef');
  });

  it('4. plusieurs zones — présentes et triées par requests7d décroissant', async () => {
    const { adminToken } = await seedAuth();
    // Zone 1 : 30 demandes, Zone 2 : 20 demandes
    await createFanoutsInZone(30, 'Z44:2');
    await createFanoutsInZone(PRIVACY_THRESHOLD, 'Z43:1');

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.geoBreakdown).toHaveLength(2);
    // Tri décroissant : 30 avant 20
    expect(res.body.geoBreakdown[0].zone).toBe('Z44:2');
    expect(res.body.geoBreakdown[0].requests7d).toBe(30);
    expect(res.body.geoBreakdown[1].zone).toBe('Z43:1');
    expect(res.body.geoBreakdown[1].requests7d).toBe(PRIVACY_THRESHOLD);
  });

  it('5. couverture correcte — covered7d = demandes avec prosFound > 0', async () => {
    const { adminToken } = await seedAuth();

    // Zone Z46:4 : 15 fanouts couverts (prosFound=3) + 5 non couverts (prosFound=0) = 20 demandes
    await createFanoutsInZone(15, 'Z46:4', { prosFound: 3 });
    await createFanoutsInZone(5, 'Z46:4', { prosFound: 0 });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const zone = res.body.geoBreakdown.find((z: { zone: string }) => z.zone === 'Z46:4');
    expect(zone).toBeDefined();
    expect(zone.requests7d).toBe(20);
    expect(zone.covered7d).toBe(15);
    // 15/20 * 100 = 75 %
    expect(zone.coverageRatePct).toBeCloseTo(75.0, 0);
  });

  it('6. conversion correcte — contacted7d via ContactRequest', async () => {
    const { adminToken } = await seedAuth();

    const lessonRequestIds = await createFanoutsInZone(PRIVACY_THRESHOLD, 'Z47:5', { prosFound: 1 });

    // ContactRequest pour le premier lessonRequestId uniquement
    const targetLR = lessonRequestIds[0];
    const proUser = await prisma.user.create({
      data: { email: 'geo-pro-conv-c7@test.com', password: 'hash', role: 'PRO', emailVerified: true },
    });
    const riderUser = await prisma.user.create({
      data: { email: 'geo-rider-conv-c7@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    const conv = await prisma.conversation.create({
      data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
    });
    await prisma.contactRequest.create({
      data: { proUserId: proUser.id, conversationId: conv.id, lessonRequestId: targetLR },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const zone = res.body.geoBreakdown.find((z: { zone: string }) => z.zone === 'Z47:5');
    expect(zone).toBeDefined();
    expect(zone.contacted7d).toBe(1);
    // 1/20 * 100 = 5 %
    expect(zone.contactRatePct).toBeCloseTo(5.0, 0);
  });

  it('7. anti double comptage — N fanouts même lessonRequestId = 1 demande', async () => {
    const { adminToken } = await seedAuth();

    // 3 fanouts pour le même lessonRequestId (3 déclenchements le même jour)
    const sharedLR  = String(++_geoIdCounter).padStart(16, '0');
    const sharedRef = String(_geoIdCounter).padStart(24, '0');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: sharedRef, lessonRequestId: sharedLR, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, zoneLarge: 'Z48:6', triggerReason: 'ACTIVATED' },
        { riderRef: sharedRef, lessonRequestId: sharedLR, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, zoneLarge: 'Z48:6', triggerReason: 'LOCATION_CHANGED' },
        { riderRef: sharedRef, lessonRequestId: sharedLR, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, zoneLarge: 'Z48:6', triggerReason: 'SPORT_CHANGED' },
      ],
    });
    // Compléter jusqu'à PRIVACY_THRESHOLD - 1 demandes uniques supplémentaires
    await createFanoutsInZone(PRIVACY_THRESHOLD - 1, 'Z48:6');

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const zone = res.body.geoBreakdown.find((z: { zone: string }) => z.zone === 'Z48:6');
    expect(zone).toBeDefined();
    // 1 (sharedLR dedup) + (PRIVACY_THRESHOLD - 1) autres = PRIVACY_THRESHOLD
    expect(zone.requests7d).toBe(PRIVACY_THRESHOLD);
    // sharedLR a prosFound > 0 sur au moins un fanout → comptée couverte (1 fois)
    expect(zone.covered7d).toBe(1);
  });

  it('12. confidentialité — zone < PRIVACY_THRESHOLD exclue, zone = PRIVACY_THRESHOLD présente', async () => {
    const { adminToken } = await seedAuth();

    // Zone Z50:9 : 19 demandes (< seuil) → exclue
    await createFanoutsInZone(PRIVACY_THRESHOLD - 1, 'Z50:9', { prosFound: 1 });
    // Zone Z51:10 : 20 demandes (= seuil) → présente
    await createFanoutsInZone(PRIVACY_THRESHOLD, 'Z51:10');

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const zoneExcluded = res.body.geoBreakdown.find((z: { zone: string }) => z.zone === 'Z50:9');
    const zoneIncluded = res.body.geoBreakdown.find((z: { zone: string }) => z.zone === 'Z51:10');

    expect(zoneExcluded).toBeUndefined();
    expect(zoneIncluded).toBeDefined();
    expect(zoneIncluded.requests7d).toBe(PRIVACY_THRESHOLD);
    // Aucun identifiant individuel dans la réponse
    expect(JSON.stringify(res.body)).not.toMatch(/@test\.com/);
    expect(JSON.stringify(res.body)).not.toMatch(/userId/);
  });
});
