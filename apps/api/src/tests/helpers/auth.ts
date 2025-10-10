import request, { SuperAgentTest, Test as SupertestRequest } from 'supertest';
import bcrypt from 'bcrypt';
import { prisma } from '@blobinfini/database';
import { Role, User } from '@prisma/client';
import { jest } from '@jest/globals';

export const TEST_PASSWORD = 'Passw0rd!';
const CONSENT_VERSION = 'v1.0.0';

export type TestSession = {
  agent: SuperAgentTest;
  csrfToken: string;
  post: (path: string) => SupertestRequest;
  put: (path: string) => SupertestRequest;
  patch: (path: string) => SupertestRequest;
  delete: (path: string) => SupertestRequest;
  get: (path: string) => SupertestRequest;
};

export async function createTestSession(app: any): Promise<TestSession> {
  const agent = request.agent(app);
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
  if (existing) {
    return existing;
  }

  const hashed = await bcrypt.hash(password, 12);
  return prisma.user.create({
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

  const login = await session
    .post('/auth/login')
    .send({ email, password, consentAccepted: true })
    .expect(200);

  return {
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
    session,
  };
}

export function silenceConsoleErrors() {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return () => spy.mockRestore();
}
