/**
 * Healthcheck primitives — liveness & readiness.
 *
 * Design rules (pré-prod / orchestrateur) :
 *  - `/health/live` ne dépend d'AUCUNE infrastructure (DB/Redis/storage).
 *  - `/health/ready` vérifie les dépendances *réellement requises* pour servir
 *    le trafic, avec un timeout court et borné par check.
 *  - Aucune information sensible n'est exposée : pas de string de connexion,
 *    pas de host interne, pas de détail SQL, pas de stack trace. Les checks
 *    ne renvoient QUE des statuts (`ok | degraded | critical | not_configured`).
 *  - Aucun check ne lève d'exception : toute erreur/timeout est mappée en statut.
 */

import { Prisma, clientPrisma as prisma } from '@blobinfini/database';
import { cacheService } from '../../services/cache.service';
import { checkBucketReachable } from '../../lib/s3';

export type CheckStatus = 'ok' | 'degraded' | 'critical' | 'not_configured';
export type DatabaseStatus = 'ok' | 'degraded' | 'critical';
export type OverallStatus = 'ok' | 'degraded' | 'critical';

export interface ReadinessChecks {
  database: DatabaseStatus;
  redis: CheckStatus;
  storage: CheckStatus;
}

export interface ReadinessResponse {
  status: OverallStatus;
  checks: ReadinessChecks;
  timestamp: string;
}

export interface LivenessResponse {
  status: 'ok';
  service: 'api';
  uptimeSeconds: number;
  timestamp: string;
}

/** Timeout par check (ms). Borné pour qu'une dépendance lente ne bloque pas la sonde. */
export const DEFAULT_CHECK_TIMEOUT_MS = Math.max(
  250,
  Math.min(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000, 5000),
);

/**
 * Exécute `fn` avec un timeout. Ne rejette jamais : en cas d'erreur OU de
 * dépassement de délai, résout la valeur `fallback`.
 */
async function runCheck<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    // Le timer ne doit pas maintenir le process en vie.
    if (typeof timer.unref === 'function') timer.unref();
    fn().then(finish).catch(() => finish(fallback));
  });
}

/**
 * Redis est considéré comme *attendu* (donc une panne = `degraded`, pas
 * `not_configured`) si une URL explicite est fournie ou si on tourne en stack
 * Docker (compose fournit toujours un service redis). En dev local sans Redis,
 * une absence se signale `not_configured` plutôt que `degraded`.
 */
function redisExpected(): boolean {
  return Boolean(process.env.REDIS_URL?.trim()) || process.env.DOCKER === 'true';
}

/** PostgreSQL : `SELECT 1`. Dépendance dure → l'échec est `critical`. */
export async function checkDatabase(timeoutMs = DEFAULT_CHECK_TIMEOUT_MS): Promise<DatabaseStatus> {
  return runCheck<DatabaseStatus>(
    async () => {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return 'ok';
    },
    timeoutMs,
    'critical',
  );
}

/**
 * Redis : ping via le cache service. Dépendance souple (fallback mémoire pour
 * le rate-limiting) → une panne est `degraded`, pas `critical`.
 */
export async function checkRedis(timeoutMs = DEFAULT_CHECK_TIMEOUT_MS): Promise<CheckStatus> {
  const fallback: CheckStatus = redisExpected() ? 'degraded' : 'not_configured';
  return runCheck<CheckStatus>(
    async () => {
      const health = await cacheService.healthCheck();
      if (health.status === 'healthy') return 'ok';
      if (health.status === 'error') return 'degraded'; // client présent, ping KO
      // 'disabled' : pas de client → soit non configuré, soit échec au démarrage
      return redisExpected() ? 'degraded' : 'not_configured';
    },
    timeoutMs,
    fallback,
  );
}

/**
 * Stockage objet (MinIO/S3) : non requis pour servir le trafic cœur
 * (auth/matching/messagerie). Une panne est donc `degraded`, jamais `critical`.
 * Non configuré (pas de bucket) → `not_configured`.
 */
export async function checkStorage(timeoutMs = DEFAULT_CHECK_TIMEOUT_MS): Promise<CheckStatus> {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return 'not_configured';
  // Pas d'appel réseau en test : on ne probe pas un MinIO inexistant.
  if (process.env.NODE_ENV === 'test') return 'ok';
  return runCheck<CheckStatus>(
    async () => ((await checkBucketReachable(timeoutMs)) ? 'ok' : 'degraded'),
    timeoutMs,
    'degraded',
  );
}

/** Agrège les statuts en un verdict global. DB = dépendance dure. */
export function resolveOverall(checks: ReadinessChecks): OverallStatus {
  if (checks.database === 'critical') return 'critical';
  if (checks.database === 'degraded') return 'degraded';
  if (checks.redis === 'degraded' || checks.redis === 'critical') return 'degraded';
  if (checks.storage === 'degraded' || checks.storage === 'critical') return 'degraded';
  return 'ok';
}

/** Dépendances injectables — permet des tests unitaires sans réseau ni DB. */
export interface ReadinessDeps {
  database?: () => Promise<DatabaseStatus>;
  redis?: () => Promise<CheckStatus>;
  storage?: () => Promise<CheckStatus>;
}

export async function buildReadiness(deps: ReadinessDeps = {}): Promise<ReadinessResponse> {
  const [database, redis, storage] = await Promise.all([
    (deps.database ?? checkDatabase)(),
    (deps.redis ?? checkRedis)(),
    (deps.storage ?? checkStorage)(),
  ]);
  const checks: ReadinessChecks = { database, redis, storage };
  return {
    status: resolveOverall(checks),
    checks,
    timestamp: new Date().toISOString(),
  };
}

export function buildLiveness(): LivenessResponse {
  return {
    status: 'ok',
    service: 'api',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
