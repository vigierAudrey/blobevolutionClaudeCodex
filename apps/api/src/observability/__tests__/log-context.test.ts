import request from 'supertest';
import type { Request, Response } from 'express';
import { createApp } from '../../index';
import { requireAuth } from '../../modules/auth/auth.guard';
import { getAccessToken, TEST_PASSWORD } from '../../tests/helpers/auth';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import {
  createActorRef,
  getActorRef,
  getLogContext,
  getRequestId,
  runJobWithLogContext,
  runWithWsLogContext,
} from '../log-context';

describe('log context', () => {
  const app = createApp();

  app.get('/_test/log-context/public', (_req: Request, res: Response) => {
    res.json({
      requestId: getRequestId(),
      actorRef: getActorRef(),
      context: getLogContext(),
    });
  });

  app.get('/_test/log-context/authenticated', requireAuth, (req: Request, res: Response) => {
    res.json({
      requestId: getRequestId(),
      actorRef: getActorRef(),
      context: getLogContext(),
      userId: (req as Request & { user?: { id?: string } }).user?.id,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns distinct request ids to concurrent HTTP requests', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/_test/log-context/public').expect(200),
      request(app).get('/_test/log-context/public').expect(200),
    ]);

    expect(first.body.requestId).not.toBe(second.body.requestId);
    expect(first.body.actorRef).toBe('anonymous');
    expect(second.body.actorRef).toBe('anonymous');
    expect(first.body.context.source).toBe('http');
    expect(second.body.context.source).toBe('http');
  });

  it('binds authenticated actorRef into HTTP context', async () => {
    const { accessToken, userId } = await getAccessToken({
      app,
      email: 'log-context-admin@test.com',
      password: TEST_PASSWORD,
      role: Role.ADMIN,
      emailVerified: true,
    });

    const response = await request(app)
      .get('/_test/log-context/authenticated')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.body.actorRef).toBe(createActorRef(userId));
    expect(response.body.context.source).toBe('http');
    expect(response.body.userId).toBe(userId);
  });

  it('isolates critical job context', async () => {
    const first = await runJobWithLogContext('job:first', async () => ({
      requestId: getRequestId(),
      actorRef: getActorRef(),
      context: getLogContext(),
    }));
    const second = await runJobWithLogContext('job:second', async () => ({
      requestId: getRequestId(),
      actorRef: getActorRef(),
      context: getLogContext(),
    }));

    expect(first.requestId).not.toBe(second.requestId);
    expect(first.actorRef).toBe('system');
    expect(second.actorRef).toBe('system');
    expect(first.context.routeOrJob).toBe('job:first');
    expect(second.context.routeOrJob).toBe('job:second');
  });

  it('propagates context across websocket helper execution', async () => {
    const context = await runWithWsLogContext('ws:test-event', 'user-ws-1', async () => {
      await Promise.resolve();
      return getLogContext();
    });

    expect(context.source).toBe('ws');
    expect(context.routeOrJob).toBe('ws:test-event');
    expect(context.actorRef).toBe(createActorRef('user-ws-1'));
  });
});
