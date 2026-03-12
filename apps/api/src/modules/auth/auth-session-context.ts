import type { Request } from 'express';
import { randomUUID } from 'crypto';

export type AuthenticatedSessionContext = {
  sessionId: string;
  authContextId: string;
};

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function rotateAuthenticatedSession(
  req: Request,
  userId?: string,
): Promise<AuthenticatedSessionContext> {
  const csrfSecret = req.session?.csrfSecret;

  await regenerateSession(req);

  if (csrfSecret) {
    req.session.csrfSecret = csrfSecret;
  }

  const authContextId = randomUUID();
  req.session.authContextId = authContextId;
  req.session.authenticatedUserId = userId;

  await saveSession(req);

  return {
    sessionId: req.sessionID,
    authContextId,
  };
}

export async function bindAuthenticatedSessionUser(req: Request, userId: string): Promise<void> {
  req.session.authenticatedUserId = userId;
  await saveSession(req);
}

declare module 'express-session' {
  interface SessionData {
    authContextId?: string;
    authenticatedUserId?: string;
  }
}
