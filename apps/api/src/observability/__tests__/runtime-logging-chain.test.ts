import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';
import { globalErrorHandler } from '../../index';
import { audit } from '../../middleware/audit';
import { createActorRef, setActorRefForUser, withHttpLogContext } from '../log-context';
import {
  flushLogTransport,
  resetLogTransportForTests,
  setLogWriterForTests,
} from '../log-transport';

type StructuredLog = {
  event: string;
  requestId: string;
  actorRef: string;
  source: string;
  routeOrJob?: string;
  context?: Record<string, unknown>;
};

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
  };
};

describe('runtime logging chain', () => {
  const capturedLogs: StructuredLog[] = [];

  beforeEach(() => {
    capturedLogs.length = 0;
    setLogWriterForTests(async (line) => {
      capturedLogs.push(JSON.parse(line) as StructuredLog);
    });
  });

  afterEach(async () => {
    await flushLogTransport(200);
    resetLogTransportForTests();
    setLogWriterForTests(null);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('routes audit middleware failures through the canonical logger with ALS context', async () => {
    const app = express();
    app.use(withHttpLogContext);
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.user = { id: 'audit-user-1' };
      setActorRefForUser(req.user.id);
      next();
    });
    app.get('/_test/audit-failure', audit('test:audit'), (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    jest.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('audit-db-down'));

    await request(app).get('/_test/audit-failure').expect(200);
    await new Promise((resolve) => setImmediate(resolve));
    await flushLogTransport(200);

    expect(capturedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'AUDIT_LOG_WRITE_FAILED',
          actorRef: createActorRef('audit-user-1'),
          source: 'http',
          routeOrJob: 'GET /_test/audit-failure',
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        }),
      ]),
    );
  });

  it('routes uncaught request errors through the canonical global error handler', async () => {
    const app = express();
    app.use(withHttpLogContext);
    app.get('/_test/error', (_req: Request, _res: Response, next: NextFunction) => {
      next(new Error('boom\r\nfrom [2001:db8::1] stack-forgery'));
    });
    app.use(globalErrorHandler);

    await request(app).get('/_test/error').expect(500);
    await flushLogTransport(200);

    expect(capturedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'GLOBAL_ERROR_HANDLER_TRIGGERED',
          actorRef: 'anonymous',
          source: 'http',
          routeOrJob: 'GET /_test/error',
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
          context: expect.objectContaining({
            method: 'GET',
            path: '/_test/error',
            error: expect.objectContaining({
              message: expect.stringMatching(/^boom\s+from \[REDACTED_IP\]\s+stack-forgery$/),
            }),
          }),
        }),
      ]),
    );
  });
});
