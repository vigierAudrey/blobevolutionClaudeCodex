/**
 * E2E tests: admin_session cookie — vrai flow applicatif
 *
 * Ces tests frappent le vrai POST /auth/login et POST /auth/logout
 * via createApp() + base de données réelle. Aucun stub de route.
 *
 * Preuves :
 * 1. POST /auth/login (ADMIN) → admin_session posé avec bons attributs
 * 2. POST /auth/login (RIDER) → admin_session absent
 * 3. POST /auth/logout → admin_session effacé (clearCookie)
 * 4. admin_session n'est jamais lu côté API pour autoriser une action
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { createTestSession, getOrCreateUserByEmail, TEST_PASSWORD } from '../../../tests/helpers/auth';

process.env.AUTH_REQUIRE_2FA = 'false';
process.env.AUTH_REQUIRE_VERIFIED = 'false';
process.env.ADMIN_ENFORCE_ALLOWED_IPS = 'false';
process.env.ADMIN_REQUIRE_STEP_UP = 'false';
// PRIMARY_ADMIN_EMAILS doit correspondre à l'email admin pour que le guard passe
process.env.PRIMARY_ADMIN_EMAILS = 'admin-cookie-flow@test.com';

const app = createApp();

const ADMIN_EMAIL = 'admin-cookie-flow@test.com';
const RIDER_EMAIL = 'rider-cookie-flow@test.com';

function parseSetCookieHeader(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  return [raw as string];
}

function findCookieLine(cookies: string[], name: string): string | undefined {
  return cookies.find((c) => c.startsWith(`${name}=`));
}

async function cleanupUsers() {
  for (const email of [ADMIN_EMAIL, RIDER_EMAIL]) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    await prisma.loginAttempt.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.adminProfile.deleteMany({ where: { userId: user.id } });
    await prisma.riderProfile.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

beforeEach(async () => {
  await cleanupUsers();
  await getOrCreateUserByEmail({ email: ADMIN_EMAIL, password: TEST_PASSWORD, role: Role.ADMIN, emailVerified: true });
  await getOrCreateUserByEmail({ email: RIDER_EMAIL, password: TEST_PASSWORD, role: Role.RIDER, emailVerified: true });
});

afterEach(async () => {
  await cleanupUsers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Suite 1 : login ADMIN → admin_session posé ───────────────────────────────

describe('POST /auth/login ADMIN → admin_session cookie', () => {
  it('est présent dans Set-Cookie', async () => {
    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    expect(adminCookie).toBeDefined();
    expect(adminCookie).toMatch(/^admin_session=1;/);
  });

  it('a httpOnly', async () => {
    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    expect(adminCookie).toContain('HttpOnly');
  });

  it('a SameSite=Lax', async () => {
    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    expect(adminCookie?.toLowerCase()).toContain('samesite=lax');
  });

  it('a Path=/', async () => {
    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    expect(adminCookie).toContain('Path=/');
  });

  it('n\'a PAS Secure en NODE_ENV=test', async () => {
    // En test NODE_ENV=test → IS_PROD=false → pas de Secure
    expect(process.env.NODE_ENV).toBe('test');

    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    // En test (http localhost), Secure DOIT être absent pour que le cookie fonctionne
    expect(adminCookie).not.toContain('Secure');
  });
});

// ── Suite 2 : login RIDER → admin_session absent ─────────────────────────────

describe('POST /auth/login RIDER → admin_session absent', () => {
  it('aucun admin_session dans Set-Cookie', async () => {
    const session = await createTestSession(app);
    const res = await session.post('/auth/login')
      .send({ email: RIDER_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const cookies = parseSetCookieHeader(res as { headers: Record<string, unknown> });
    const adminCookie = findCookieLine(cookies, 'admin_session');

    expect(adminCookie).toBeUndefined();
  });
});

// ── Suite 3 : logout → admin_session effacé ──────────────────────────────────

describe('POST /auth/logout → admin_session effacé', () => {
  it('clearCookie produit Max-Age=0 sur admin_session', async () => {
    const session = await createTestSession(app);

    // Login pour obtenir le cookie
    const loginRes = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const loginCookies = parseSetCookieHeader(loginRes as { headers: Record<string, unknown> });
    expect(findCookieLine(loginCookies, 'admin_session')).toBeDefined();

    // Récupérer l'accessToken pour l'en-tête Authorization
    const accessTokenCookie = loginCookies.find((c) => c.startsWith('accessToken='));
    const accessToken = accessTokenCookie?.split(';')[0]?.replace('accessToken=', '');

    // Logout
    const logoutRes = await session.post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ allDevices: true });

    const logoutCookies = parseSetCookieHeader(logoutRes as { headers: Record<string, unknown> });
    const cleared = findCookieLine(logoutCookies, 'admin_session');

    expect(cleared).toBeDefined();
    // Express clearCookie pose Max-Age=0 pour forcer la suppression navigateur
    expect(cleared).toMatch(/Max-Age=0|admin_session=;/i);
  });

  it('logout sans re-login ne pose PAS de nouveau admin_session', async () => {
    const session = await createTestSession(app);

    const loginRes = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const loginCookies = parseSetCookieHeader(loginRes as { headers: Record<string, unknown> });
    const accessTokenCookie = loginCookies.find((c) => c.startsWith('accessToken='));
    const accessToken = accessTokenCookie?.split(';')[0]?.replace('accessToken=', '');

    const logoutRes = await session.post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ allDevices: true });

    const logoutCookies = parseSetCookieHeader(logoutRes as { headers: Record<string, unknown> });
    // Le cookie effacé ne doit pas avoir la valeur '1' (ce serait un re-set)
    const adminCookie = findCookieLine(logoutCookies, 'admin_session');
    expect(adminCookie).not.toMatch(/^admin_session=1;/);
  });
});

// ── Suite 4 : admin_session jamais utilisé comme auth côté API ────────────────

describe('admin_session — non utilisé comme auth réelle côté API', () => {
  it('une requête admin avec cookie admin_session mais sans JWT → 401', async () => {
    // Prouve que admin_session seul ne suffit pas à accéder à l'API admin.
    // La vraie auth est le JWT accessToken.
    const session = await createTestSession(app);

    const res = await session.get('/admin/users')
      .set('Cookie', 'admin_session=1');
    // Sans JWT valide, le guard JWT renvoie 401
    expect(res.status).toBe(401);
  });

  it('une requête admin avec JWT valide mais sans admin_session → accès API OK', async () => {
    // Prouve que admin_session n'est PAS vérifié côté API.
    // Le middleware Next.js le lit, pas l'API Express.
    const session = await createTestSession(app);
    const loginRes = await session.post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const loginCookies = parseSetCookieHeader(loginRes as { headers: Record<string, unknown> });
    const accessToken = loginCookies.find((c) => c.startsWith('accessToken='))
      ?.split(';')[0]?.replace('accessToken=', '');

    // Appel sans cookie admin_session, mais avec JWT → API ne bloque pas
    const res = await session.get('/admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', ''); // on vide les cookies intentionnellement

    // 200 ou 403 (permissions) mais pas 401 (auth JWT OK même sans admin_session)
    expect(res.status).not.toBe(401);
  });
});
