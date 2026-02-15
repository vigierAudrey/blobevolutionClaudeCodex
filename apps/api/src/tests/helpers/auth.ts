import request, { SuperAgentTest, Test as SupertestRequest } from 'supertest';
import bcrypt from 'bcryptjs';
import { clientPrisma as prisma, Role, User } from '@blobinfini/database';
import { jest } from '@jest/globals';
import { AVAILABLE_PERMISSIONS } from '../../modules/admin/permissions';

export const TEST_PASSWORD = 'Passw0rd!';
const CONSENT_VERSION = 'v1.0.0';

type SupertestAgent = SuperAgentTest;

export type TestSession = {
  agent: SupertestAgent;
  csrfToken: string;
  post: (path: string) => SupertestRequest;
  put: (path: string) => SupertestRequest;
  patch: (path: string) => SupertestRequest;
  delete: (path: string) => SupertestRequest;
  get: (path: string) => SupertestRequest;
};

export async function createTestSession(app: any): Promise<TestSession> {
  const agent = request.agent(app) as unknown as SuperAgentTest;
  const csrfRes = await agent.get('/csrf-token').expect(200);
  const csrfToken = csrfRes.body.csrfToken as string;

  const withCsrf = (req: SupertestRequest) => req.set('X-CSRF-Token', csrfToken);

  return {
    agent,
    csrfToken,
    post: (path: string) => withCsrf(agent.post(path)),
    put: (path: string) => withCsrf(agent.put(path)),
    patch: (path: string) => withCsrf(agent.patch(path)),
    delete: (path: string) => withCsrf(agent.delete(path)),
    get: (path: string) => agent.get(path),
  };
}

type GetOrCreateUserOptions = {
  email: string;
  password?: string;
  role?: Role;
  emailVerified?: boolean;
};

export async function getOrCreateUserByEmail({
  email,
  password = TEST_PASSWORD,
  role = Role.RIDER,
  emailVerified = true,
}: GetOrCreateUserOptions): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email } });

  let user: User;
  if (existing) {
    if (existing.role !== role || existing.emailVerified !== emailVerified) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { role, emailVerified },
      });
    } else {
      user = existing;
    }
  } else {
    const hashed = await bcrypt.hash(password, 12);
    user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role,
        consentedAt: new Date(),
        consentVersion: CONSENT_VERSION,
        emailVerified,
      },
    });
  }

  if (role === Role.ADMIN) {
    await prisma.adminProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: user.email,
        permissions: [...AVAILABLE_PERMISSIONS],
      },
      update: { permissions: [...AVAILABLE_PERMISSIONS] },
    });
  }

  return user;
}

type AccessTokenOptions = GetOrCreateUserOptions & {
  app: any;
  session?: TestSession;
};

export async function getAccessToken({
  app,
  session: providedSession,
  ...userOptions
}: AccessTokenOptions) {
  const session = providedSession ?? (await createTestSession(app));
  const { email, password = TEST_PASSWORD, role = Role.RIDER, emailVerified = true } = userOptions;

  await getOrCreateUserByEmail({ email, password, role, emailVerified });
  const user = await prisma.user.findUnique({ where: { email } });

  const login = await session
    .post('/auth/login')
    .send({ email, password, consentAccepted: true })
    .expect(200);

  return {
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
    session,
    userId: user?.id as string,
  };
}

export function silenceConsoleErrors() {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return () => spy.mockRestore();
}
