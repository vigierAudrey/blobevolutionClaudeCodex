import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { getSessionData } from '../../lib/auth-session-store';
import { secureLogger } from '../../utils/secure-logger';
import { setActorRefForUser } from '../../observability/log-context';

export type VerifiedAccessTokenPayload = {
  sub: string;
  role: string;
  jti?: string;
  sid?: string;
  ctx?: string;
  sv?: number;
  cv?: number;
};

type AuthenticatedUser = {
  id: string;
  role: string;
};

type AuthSensitiveOptions = {
  allowDeleted?: boolean;
};

type AccessTokenResolution =
  | { ok: true; token: string }
  | { ok: false; reason: 'MISSING' | 'CONFLICT' };

type AuthenticatedPayloadResolution =
  | { ok: true; payload: VerifiedAccessTokenPayload }
  | { ok: false; reason: 'MISSING' | 'CONFLICT' | 'INVALID' };

export type LiveSessionAuthBinding = {
  payload: VerifiedAccessTokenPayload;
  sessionId: string;
  authContextId: string;
  authenticatedUserId: string;
};

export function resolveAccessToken(req: Request): AccessTokenResolution {
  const auth = req.headers.authorization;
  let bearerToken: string | null = null;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const candidate = auth.slice('Bearer '.length).trim();
    // Ignore non-JWT-shaped strings: 'undefined', 'null', session hint '1', etc.
    // A JWT always has exactly 3 dot-separated parts (header.payload.signature).
    // Sending a non-JWT Bearer alongside a valid cookie would trigger the CONFLICT
    // check below — ignoring it here lets the cookie path take over cleanly.
    const isJwtShaped = candidate.split('.').length === 3;
    bearerToken = isJwtShaped ? candidate : null;
  }

  const cookieToken = req.cookies?.accessToken;
  const normalizedCookieToken =
    typeof cookieToken === 'string' && cookieToken.trim().length > 0
      ? cookieToken.trim()
      : null;

  if (bearerToken && normalizedCookieToken && bearerToken !== normalizedCookieToken) {
    return { ok: false, reason: 'CONFLICT' };
  }

  if (bearerToken) {
    return { ok: true, token: bearerToken };
  }

  if (normalizedCookieToken) {
    return { ok: true, token: normalizedCookieToken };
  }

  return { ok: false, reason: 'MISSING' };
}

export function extractAccessToken(req: Request): string | null {
  const resolved = resolveAccessToken(req);
  return resolved.ok ? resolved.token : null;
}

export function verifyAccessToken(token: string): VerifiedAccessTokenPayload | null {
  const payload = jwt.verify(token, process.env.JWT_SECRET as string);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const { sub, role, jti, sid, ctx, sv, cv } = payload as jwt.JwtPayload;
  if (typeof sub !== 'string' || typeof role !== 'string') {
    return null;
  }

  const sessionVersion =
    typeof sv === 'number' && Number.isInteger(sv) && sv >= 1
      ? sv
      : undefined;
  const credentialsVersion =
    typeof cv === 'number' && Number.isInteger(cv) && cv >= 1
      ? cv
      : undefined;

  return {
    sub,
    role,
    jti: typeof jti === 'string' ? jti : undefined,
    sid: typeof sid === 'string' ? sid : undefined,
    ctx: typeof ctx === 'string' ? ctx : undefined,
    sv: sessionVersion,
    cv: credentialsVersion,
  };
}

function setAuthenticatedContext(req: Request, payload: VerifiedAccessTokenPayload) {
  (req as Request & { user?: AuthenticatedUser; auth?: VerifiedAccessTokenPayload }).user = {
    id: payload.sub,
    role: payload.role,
  };
  (req as Request & { user?: AuthenticatedUser; auth?: VerifiedAccessTokenPayload }).auth = payload;
  setActorRefForUser(payload.sub);
}

function resolveAuthenticatedPayload(req: Request): AuthenticatedPayloadResolution {
  const existing = (req as Request & { auth?: VerifiedAccessTokenPayload }).auth;
  if (existing) {
    return { ok: true, payload: existing };
  }

  const resolved = resolveAccessToken(req);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  try {
    const payload = verifyAccessToken(resolved.token);
    if (!payload) {
      return { ok: false, reason: 'INVALID' };
    }

    setAuthenticatedContext(req, payload);
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
}

function hasStrongSensitiveClaims(payload: VerifiedAccessTokenPayload): boolean {
  return (
    typeof payload.jti === 'string' &&
    typeof payload.sid === 'string' &&
    typeof payload.ctx === 'string' &&
    typeof payload.sv === 'number' &&
    typeof payload.cv === 'number'
  );
}

function rejectAuthResolution(res: Response, resolution: AuthenticatedPayloadResolution): Response {
  if (resolution.ok) {
    return res.status(500).json({ error: 'Internal error' });
  }

  if (resolution.reason === 'CONFLICT') {
    return res.status(401).json({ error: 'Ambiguous token sources' });
  }

  if (resolution.reason === 'INVALID') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  return res.status(401).json({ error: 'Missing token' });
}

export function resolveLiveSessionAuthBinding(req: Request): LiveSessionAuthBinding | null {
  const resolution = resolveAuthenticatedPayload(req);
  if (!resolution.ok) {
    return null;
  }

  const payload = resolution.payload;
  if (!hasStrongSensitiveClaims(payload)) {
    return null;
  }

  const sessionId = req.sessionID?.trim();
  const authContextId = req.session?.authContextId?.trim();
  const authenticatedUserId = req.session?.authenticatedUserId?.trim();
  const requestUserId = ((req as Request & { user?: AuthenticatedUser }).user?.id)?.trim();

  if (!sessionId || !authContextId || !authenticatedUserId || !requestUserId) {
    return null;
  }

  if (
    payload.sid !== sessionId ||
    payload.ctx !== authContextId ||
    payload.sub !== authenticatedUserId ||
    payload.sub !== requestUserId
  ) {
    return null;
  }

  return {
    payload,
    sessionId,
    authContextId,
    authenticatedUserId,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const resolution = resolveAuthenticatedPayload(req);
  if (!resolution.ok) {
    return rejectAuthResolution(res, resolution);
  }

  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const resolved = resolveAccessToken(req);
  if (!resolved.ok) {
    return next();
  }
  try {
    const payload = verifyAccessToken(resolved.token);
    if (!payload) {
      return next();
    }
    setAuthenticatedContext(req, payload);
  } catch {
    // Ignore invalid tokens for optional auth routes.
  }
  next();
}

export function requireAuthSensitive(options: AuthSensitiveOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const resolution = resolveAuthenticatedPayload(req);
    if (!resolution.ok) {
      return rejectAuthResolution(res, resolution);
    }

    const payload = resolution.payload;
    if (!hasStrongSensitiveClaims(payload)) {
      return res.status(401).json({ error: 'Reauthentication required' });
    }

    if (!resolveLiveSessionAuthBinding(req)) {
      return res.status(401).json({ error: 'Reauthentication required' });
    }

    try {
      const sessionData = await getSessionData(payload.sub);
      if (!sessionData) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (sessionData.version !== payload.sv || sessionData.credentialsVersion !== payload.cv) {
        return res.status(401).json({ error: 'Reauthentication required' });
      }

      if (sessionData.deletedAt && !options.allowDeleted) {
        return res.status(403).json({ error: 'Account unavailable' });
      }

      return next();
    } catch (error) {
      secureLogger.security('AUTH_SENSITIVE_STATE_CHECK_FAILED', {
        userId: payload.sub,
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(503).json({ error: 'Authentication state unavailable' });
    }
  };
}

export function requireRole(role: 'RIDER' | 'PRO' | 'ADMIN') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id: string; role: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as { id: string } | undefined;
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const found = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } });
    if (!found) return res.status(401).json({ error: 'Unauthorized' });
    if (!found.emailVerified) return res.status(403).json({ error: 'Email not verified' });
    return next();
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}

// Helper pour les middlewares admin
export const requireAdmin = requireRole('ADMIN');
export const requirePro = requireRole('PRO');
export const requireRider = requireRole('RIDER');
