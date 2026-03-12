import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { getSessionData } from '../../lib/auth-session-store';
import { cacheService } from '../../services/cache.service';
import { getClientIp } from '../../lib/client-ip';
import { secureLogger } from '../../utils/secure-logger';
import { resolveLiveSessionAuthBinding } from '../auth/auth.guard';

export const ADMIN_STEP_UP_TTL_SECONDS = 5 * 60;
const ADMIN_STEP_UP_PROOF_PREFIX = 'admin:step-up:proof:v2';
const ADMIN_STEP_UP_INDEX_PREFIX = 'admin:step-up:index:v2';

export type AdminStepUpBinding = {
  userId: string;
  sessionId: string;
  sessionHash: string;
  authContextId: string;
  authContextHash: string;
  accessTokenJti: string;
  accessTokenJtiHash: string;
  sessionVersion: number;
  credentialsVersion: number;
};

type StoredAdminStepUpProof = {
  grantedAt: number;
  stepUpUntil: number;
  sessionVersion: number;
  credentialsVersion: number;
};

type AdminStepUpGrantFailureReason =
  | 'FORBIDDEN'
  | 'INVALID_BINDING'
  | 'STORAGE_UNAVAILABLE';

type AdminStepUpCheckFailureReason =
  | 'INVALID_BINDING'
  | 'MISSING_OR_STALE'
  | 'STORAGE_UNAVAILABLE';

type LiveAdminPolicy = {
  allowedIps: string[];
};

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

export function isAdminIpEnforcementEnabled(): boolean {
  return parseBooleanEnv(process.env.ADMIN_ENFORCE_ALLOWED_IPS, true);
}

export function isAdminStepUpRequiredEnabled(): boolean {
  const defaultValue = process.env.NODE_ENV === 'production';
  return parseBooleanEnv(process.env.ADMIN_REQUIRE_STEP_UP, defaultValue);
}

async function getLiveAdminPolicy(userId: string): Promise<LiveAdminPolicy | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      deletedAt: true,
      adminProfile: {
        select: {
          allowedIPs: true,
        },
      },
    },
  });

  if (!user || user.role !== 'ADMIN' || user.deletedAt) {
    return null;
  }

  return {
    allowedIps: user.adminProfile?.allowedIPs ?? [],
  };
}

export async function isAdminIpAllowedForUser(userId: string, clientIp: string | undefined): Promise<boolean> {
  if (!isAdminIpEnforcementEnabled()) {
    return true;
  }

  const policy = await getLiveAdminPolicy(userId);
  if (policy === null || policy.allowedIps.length === 0) {
    return true;
  }

  return Boolean(clientIp && policy.allowedIps.includes(clientIp));
}

function getCachedLiveAdminPolicy(req: Request): LiveAdminPolicy | undefined {
  return (req as Request & { liveAdminPolicy?: LiveAdminPolicy }).liveAdminPolicy;
}

function cacheLiveAdminPolicy(req: Request, policy: LiveAdminPolicy): void {
  (req as Request & { liveAdminPolicy?: LiveAdminPolicy }).liveAdminPolicy = policy;
}

export async function revalidateAdminRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user?.id || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  try {
    const policy = await getLiveAdminPolicy(user.id);
    if (!policy) {
      secureLogger.warn('ADMIN_ROLE_REVOKED_MIDREQUEST', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Accès admin révoqué' });
      return;
    }

    cacheLiveAdminPolicy(req, policy);
    next();
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_ROLE_REVALIDATION_ERROR', {
      userId: user.id,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(403).json({ error: 'Admin role revalidation failed closed' });
  }
}

export async function enforceAdminAllowedIp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user?.id || user.role !== 'ADMIN') {
    next();
    return;
  }

  try {
    const clientIp = getClientIp(req);
    const policy = getCachedLiveAdminPolicy(req) ?? await getLiveAdminPolicy(user.id);
    if (!policy) {
      secureLogger.warn('ADMIN_ROLE_REVOKED_MIDREQUEST', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Accès admin révoqué' });
      return;
    }
    cacheLiveAdminPolicy(req, policy);

    const ipEnforced = isAdminIpEnforcementEnabled();
    const allowed = !ipEnforced || policy.allowedIps.length === 0 || Boolean(clientIp && policy.allowedIps.includes(clientIp));

    if (!allowed) {
      secureLogger.warn('ADMIN_ALLOWED_IP_DENIED', {
        userId: user.id,
        path: req.path,
        ip: clientIp,
      });
      res.status(403).json({
        error: 'IP non autorisée',
        message: 'Votre adresse IP n\'est pas autorisée pour ce compte admin',
      });
      return;
    }

    next();
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_ALLOWED_IP_CHECK_ERROR', {
      userId: user.id,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(403).json({ error: 'Admin IP enforcement failed closed' });
  }
}

function hashBindingPart(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getProofKey(userId: string, binding: AdminStepUpBinding): string {
  return [
    ADMIN_STEP_UP_PROOF_PREFIX,
    userId,
    binding.sessionHash,
    binding.authContextHash,
    binding.accessTokenJtiHash,
  ].join(':');
}

function getProofIndexKey(userId: string): string {
  return `${ADMIN_STEP_UP_INDEX_PREFIX}:${userId}`;
}

type RedisCommandClient = {
  sendCommand(args: string[]): Promise<unknown>;
};

function getRedisClient(): RedisCommandClient | null {
  return cacheService.getClient() as RedisCommandClient | null;
}

async function redisSAdd(client: RedisCommandClient, key: string, member: string): Promise<void> {
  await client.sendCommand(['SADD', key, member]);
}

async function redisExpire(client: RedisCommandClient, key: string, ttlSeconds: number): Promise<void> {
  await client.sendCommand(['EXPIRE', key, String(ttlSeconds)]);
}

async function redisSMembers(client: RedisCommandClient, key: string): Promise<string[]> {
  const result = await client.sendCommand(['SMEMBERS', key]);
  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('utf8');
      }
      return null;
    })
    .filter((value): value is string => value !== null);
}

async function redisDel(client: RedisCommandClient, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  await client.sendCommand(['DEL', ...keys]);
}

function parseStoredAdminStepUpProof(raw: unknown): StoredAdminStepUpProof | null {
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<StoredAdminStepUpProof>;
    if (
      typeof parsed.grantedAt !== 'number' ||
      !Number.isFinite(parsed.grantedAt) ||
      typeof parsed.stepUpUntil !== 'number' ||
      !Number.isFinite(parsed.stepUpUntil) ||
      typeof parsed.sessionVersion !== 'number' ||
      !Number.isInteger(parsed.sessionVersion) ||
      parsed.sessionVersion < 1 ||
      typeof parsed.credentialsVersion !== 'number' ||
      !Number.isInteger(parsed.credentialsVersion) ||
      parsed.credentialsVersion < 1
    ) {
      return null;
    }

    return {
      grantedAt: parsed.grantedAt,
      stepUpUntil: parsed.stepUpUntil,
      sessionVersion: parsed.sessionVersion,
      credentialsVersion: parsed.credentialsVersion,
    };
  } catch {
    return null;
  }
}

export function resolveAdminStepUpBinding(req: Request): AdminStepUpBinding | null {
  const binding = resolveLiveSessionAuthBinding(req);
  if (!binding) {
    return null;
  }

  const { payload, sessionId, authContextId } = binding;
  if (
    typeof payload.jti !== 'string' ||
    typeof payload.sv !== 'number' ||
    typeof payload.cv !== 'number'
  ) {
    return null;
  }

  return {
    userId: payload.sub,
    sessionId,
    sessionHash: hashBindingPart(sessionId),
    authContextId,
    authContextHash: hashBindingPart(authContextId),
    accessTokenJti: payload.jti,
    accessTokenJtiHash: hashBindingPart(payload.jti),
    sessionVersion: payload.sv,
    credentialsVersion: payload.cv,
  };
}

export async function grantAdminStepUp(
  userId: string,
  binding: AdminStepUpBinding | null,
): Promise<
  | { ok: true; stepUpUntil: number }
  | { ok: false; reason: AdminStepUpGrantFailureReason }
> {
  if (!isAdminStepUpRequiredEnabled()) {
    return { ok: true, stepUpUntil: Date.now() };
  }

  if (!binding || binding.userId !== userId) {
    return { ok: false, reason: 'INVALID_BINDING' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      deletedAt: true,
      sessionVersion: true,
      credentialsVersion: true,
    },
  });

  if (
    !user ||
    user.role !== 'ADMIN' ||
    user.deletedAt ||
    user.sessionVersion !== binding.sessionVersion ||
    user.credentialsVersion !== binding.credentialsVersion
  ) {
    return { ok: false, reason: 'FORBIDDEN' };
  }

  const redisClient = getRedisClient();
  if (!redisClient) {
    secureLogger.error('ADMIN_STEP_UP_STORE_UNAVAILABLE', {
      userId,
      sessionHash: binding.sessionHash.slice(0, 12),
    });
    return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  }

  const now = Date.now();
  const stepUpUntil = now + (ADMIN_STEP_UP_TTL_SECONDS * 1000);

  try {
    const proofKey = getProofKey(userId, binding);
    const stored = await cacheService.set(
      proofKey,
      {
        grantedAt: now,
        stepUpUntil,
        sessionVersion: user.sessionVersion,
        credentialsVersion: user.credentialsVersion,
      } satisfies StoredAdminStepUpProof,
      ADMIN_STEP_UP_TTL_SECONDS,
    );
    if (!stored) {
      throw new Error('CACHE_SET_FAILED');
    }
    await redisSAdd(redisClient, getProofIndexKey(userId), proofKey);
    await redisExpire(redisClient, getProofIndexKey(userId), ADMIN_STEP_UP_TTL_SECONDS + 60);
  } catch (error) {
    secureLogger.error('ADMIN_STEP_UP_STORE_ERROR', {
      userId,
      sessionHash: binding.sessionHash.slice(0, 12),
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  }

  return { ok: true, stepUpUntil };
}

export async function checkAdminStepUp(
  userId: string,
  binding: AdminStepUpBinding | null,
): Promise<
  | { ok: true; stepUpUntil: number }
  | { ok: false; reason: AdminStepUpCheckFailureReason }
> {
  if (!isAdminStepUpRequiredEnabled()) {
    return { ok: true, stepUpUntil: Date.now() };
  }

  if (!binding || binding.userId !== userId) {
    return { ok: false, reason: 'INVALID_BINDING' };
  }

  let sessionData;
  try {
    sessionData = await getSessionData(userId);
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_STEP_UP_SESSION_STATE_ERROR', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  }

  if (
    !sessionData ||
    sessionData.deletedAt ||
    sessionData.version !== binding.sessionVersion ||
    sessionData.credentialsVersion !== binding.credentialsVersion
  ) {
    return { ok: false, reason: 'MISSING_OR_STALE' };
  }

  if (!getRedisClient()) {
    secureLogger.security('CRITICAL_ADMIN_STEP_UP_CACHE_UNAVAILABLE', {
      userId,
      sessionHash: binding.sessionHash.slice(0, 12),
    });
    return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  }

  try {
    const proofKey = getProofKey(userId, binding);
    const proof = parseStoredAdminStepUpProof(await cacheService.get<StoredAdminStepUpProof>(proofKey));
    if (!proof) {
      return { ok: false, reason: 'MISSING_OR_STALE' };
    }

    if (
      proof.stepUpUntil <= Date.now() ||
      proof.sessionVersion !== binding.sessionVersion ||
      proof.credentialsVersion !== binding.credentialsVersion ||
      proof.sessionVersion !== sessionData.version ||
      proof.credentialsVersion !== sessionData.credentialsVersion
    ) {
      return { ok: false, reason: 'MISSING_OR_STALE' };
    }

    return { ok: true, stepUpUntil: proof.stepUpUntil };
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_STEP_UP_CHECK_ERROR', {
      userId,
      sessionHash: binding.sessionHash.slice(0, 12),
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  }
}

export async function invalidateAdminStepUpProofs(userId: string): Promise<void> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return;
  }

  const indexKey = getProofIndexKey(userId);

  try {
    const proofKeys = await redisSMembers(redisClient, indexKey);
    if (proofKeys.length > 0) {
      await redisDel(redisClient, [...proofKeys, indexKey]);
      return;
    }
    await redisDel(redisClient, [indexKey]);
  } catch (error) {
    secureLogger.warn('ADMIN_STEP_UP_INVALIDATE_FAILED', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function requireAdminStepUp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user?.id || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  try {
    if (!isAdminStepUpRequiredEnabled()) {
      next();
      return;
    }

    const result = await checkAdminStepUp(user.id, resolveAdminStepUpBinding(req));
    if (!result.ok) {
      if (result.reason === 'STORAGE_UNAVAILABLE') {
        res.status(503).json({ error: 'Admin step-up unavailable' });
        return;
      }
      secureLogger.warn('ADMIN_STEP_UP_REQUIRED', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Step-up authentication required' });
      return;
    }

    next();
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_STEP_UP_MIDDLEWARE_ERROR', {
      userId: user.id,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ error: 'Admin step-up unavailable' });
  }
}
