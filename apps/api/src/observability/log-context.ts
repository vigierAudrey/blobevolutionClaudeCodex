import { AsyncLocalStorage } from 'async_hooks';
import { createHmac, randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export type LogSource = 'http' | 'ws' | 'job';

export type LogContext = {
  requestId: string;
  actorRef: string;
  source: LogSource;
  routeOrJob?: string;
};

const ANONYMOUS_ACTOR_REF = 'anonymous';
const SYSTEM_ACTOR_REF = 'system';
const logContextStorage = new AsyncLocalStorage<LogContext>();
const UUID_PATH_SEGMENT_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

function resolveActorSecret(): string {
  const configured = process.env.LOG_ACTOR_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('LOG_ACTOR_SECRET must be configured in production');
  }

  return 'blobinfini-dev-log-actor-secret';
}

export function sanitizeHttpPath(path: string): string {
  return path.replace(UUID_PATH_SEGMENT_RE, '/:uuid');
}

function normalizeRoute(req: Request): string {
  const path = req.path || req.originalUrl || '/';
  return `${req.method.toUpperCase()} ${sanitizeHttpPath(path)}`;
}

export function createActorRef(userId?: string | null): string {
  if (!userId) {
    return ANONYMOUS_ACTOR_REF;
  }

  return `act_${createHmac('sha256', resolveActorSecret()).update(userId).digest('hex').slice(0, 24)}`;
}

export function createLogContext(
  source: LogSource,
  routeOrJob?: string,
  actorRef: string = ANONYMOUS_ACTOR_REF,
): LogContext {
  return {
    requestId: randomUUID(),
    actorRef,
    source,
    routeOrJob,
  };
}

export function getLogContext(): LogContext {
  return (
    logContextStorage.getStore() ?? {
      requestId: randomUUID(),
      actorRef: SYSTEM_ACTOR_REF,
      source: 'job',
      routeOrJob: 'system',
    }
  );
}

export function getRequestId(): string {
  return getLogContext().requestId;
}

export function getActorRef(): string {
  return getLogContext().actorRef;
}

export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return logContextStorage.run(context, callback);
}

export function updateLogContext(patch: Partial<LogContext>): LogContext {
  const current = getLogContext();
  const store = logContextStorage.getStore();
  const nextContext = { ...current, ...patch };

  if (store) {
    Object.assign(store, nextContext);
    return store;
  }

  return nextContext;
}

export function setActorRefForUser(userId?: string | null): string {
  const actorRef = createActorRef(userId);
  updateLogContext({ actorRef });
  return actorRef;
}

export function runJobWithLogContext<T>(jobName: string, callback: () => T): T {
  return runWithLogContext(createLogContext('job', jobName, SYSTEM_ACTOR_REF), callback);
}

export function withHttpLogContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const context: LogContext = {
    requestId,
    actorRef: ANONYMOUS_ACTOR_REF,
    source: 'http',
    routeOrJob: normalizeRoute(req),
  };

  res.setHeader('X-Request-Id', requestId);
  runWithLogContext(context, next);
}

export function runWithWsLogContext<T>(
  routeOrJob: string,
  actorUserId: string | undefined,
  callback: () => T,
): T {
  return runWithLogContext(
    createLogContext('ws', routeOrJob, createActorRef(actorUserId)),
    callback,
  );
}
