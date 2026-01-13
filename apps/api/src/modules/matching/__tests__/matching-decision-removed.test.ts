import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

describe('POST /matching/decision removal', () => {
  const app = createApp();
  let session: TestSession;
  let accessToken = '';

  beforeEach(async () => {
    const auth = await getAccessToken({
      app,
      email: `removed-endpoint-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    session = auth.session;
    accessToken = auth.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns 410 with envelope error', async () => {
    const res = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({ targetProfileId: 'any', decision: 'ACCEPT' })
      .expect(410);

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-04-12T00:00:00Z');
    expect(res.headers['link']).toContain('/matching/decisions');
    expect(res.body).toMatchObject({
      ok: false,
      error: { code: 'GONE' },
    });
  });

  it('returns 410 with legacy JSON body', async () => {
    const res = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ targetProfileId: 'any', decision: 'ACCEPT' })
      .expect(410);

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-04-12T00:00:00Z');
    expect(res.headers['link']).toContain('/matching/decisions');
    expect(res.body).toMatchObject({
      error: expect.stringContaining('removed'),
      redirect: '/matching/decisions',
    });
  });
});
