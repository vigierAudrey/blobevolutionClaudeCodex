/**
 * LOT 4.1 — Brute-Force Detection via Redis
 *
 * Design constraints (see LOT 4 design doc):
 * - TTL FIXE depuis la première tentative (NX — EXPIRE posé uniquement si count==1)
 * - Compteurs: bf:ip:{hash} + bf:em:{hash} — TTL 24h par défaut
 * - Flags suspects: bf:sus:ip:{hash} + bf:sus:em:{hash} — TTL 1h par défaut
 * - Sémantique null: Redis down OU hash failure → null (inconnu), jamais 0
 * - Fail-open: Redis down ne bloque JAMAIS le flux login
 * - Jamais de PII (email brut, IP brute) dans les logs ou les clés Redis
 * - Ce module n'émet que des signaux observables — il ne décide pas d'un blocage HTTP
 *
 * Complémentarité avec LOT 3:
 * - LOT 3 (loginEmailLimiter): fenêtre courte (15min, 10 tentatives) → blocage express-rate-limit
 * - LOT 4 (brute-force-detector): fenêtre longue (24h, 5/20 tentatives) → signal suspect + log
 * - Même hashEmailHmac() utilisé — aucune redondance de hash
 *
 * @see apps/api/src/lib/redis-client.ts — singleton Redis partagé
 * @see apps/api/src/lib/hash-email.ts  — HMAC-SHA256 email (32 hex chars)
 * @see apps/api/src/lib/hash-ip.ts     — HMAC-SHA256 IP (24 hex chars)
 */

import { getRedisClient } from './redis-client';
import { hashEmailHmac } from './hash-email';
import { hashIpHmac } from './hash-ip';
import { secureLogger } from '../utils/secure-logger';

// ─── Lua script: INCR avec TTL fixe (NX) ────────────────────────────────────
// Le TTL est posé UNE SEULE FOIS à la première tentative (count == 1).
// Il n'est JAMAIS remis à zéro — la fenêtre est fixe depuis la première tentative.
//
// Pourquoi TTL fixe et non glissant :
// - Fenêtre glissante = mémoire quasi-infinie tant que l'attaquant reste actif
// - Fenêtre fixe = "X tentatives dans les dernières 24h" — sémantique claire et testable
// - Un attaquant lent (1/23h) contourne le glissant mais est comptabilisé dans le fixe
//
// KEYS[1] = clé Redis (bf:ip:... ou bf:em:...)
// ARGV[1] = TTL en secondes
const LUA_INCR_FIXED_TTL = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, ttl)
end
return count
`;

// ─── Configuration (lecture des variables d'env avec defaults sûrs) ──────────
// Defaults conservateurs : email à 5 (attaque ciblée d'un compte), IP à 20 (NAT tolérance).
// Pas de fail-fast si absent — config opérationnelle, non critique sécurité.
function getBfConfig() {
  return {
    ipThreshold:         Number(process.env.BF_IP_THRESHOLD)          || 20,
    emailThreshold:      Number(process.env.BF_EMAIL_THRESHOLD)        || 5,
    ipTtlSeconds:        Number(process.env.BF_IP_TTL_SECONDS)         || 86400,
    emailTtlSeconds:     Number(process.env.BF_EMAIL_TTL_SECONDS)      || 86400,
    suspectIpTtlSeconds: Number(process.env.BF_SUSPECT_IP_TTL_SECONDS) || 3600,
    suspectEmailTtlSeconds: Number(process.env.BF_SUSPECT_EMAIL_TTL_SECONDS) || 3600,
  };
}

// ─── Throttle pour les logs d'erreur répétitifs ───────────────────────────────
// Évite le flood de logs BF_REDIS_UNAVAILABLE / BF_HASH_FAILURE à chaque tentative.
// La Map est petite (≤3 entrées) — aucun cleanup nécessaire.
type ThrottleEntry = { nextLogAtMs: number };
const throttleState = new Map<string, ThrottleEntry>();
const LOG_THROTTLE_MS = 60_000; // 1 minute

function shouldLogThrottled(key: string): boolean {
  const now = Date.now();
  const entry = throttleState.get(key);
  if (!entry || now >= entry.nextLogAtMs) {
    throttleState.set(key, { nextLogAtMs: now + LOG_THROTTLE_MS });
    return true;
  }
  return false;
}

function parseRedisCounter(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

// ─── Primitives Redis ─────────────────────────────────────────────────────────

/**
 * Incrémente un compteur Redis avec TTL fixe (NX).
 * Retourne le nouveau count, ou null si Redis est indisponible / erreur.
 * null ≠ 0 : null = état inconnu, 0 = "aucune tentative connue"
 */
async function incrWithFixedTtl(key: string, ttlSeconds: number): Promise<number | null> {
  const client = getRedisClient();
  if (!client) {
    if (shouldLogThrottled('BF_REDIS_UNAVAILABLE')) {
      secureLogger.warn('BF_REDIS_UNAVAILABLE', {
        reason: 'Redis client not available — brute-force detection inactive (fail-open)',
      });
    }
    return null;
  }

  try {
    const result = await client.sendCommand([
      'EVAL',
      LUA_INCR_FIXED_TTL,
      '1',
      key,
      String(ttlSeconds),
    ]);
    return parseRedisCounter(result);
  } catch (err) {
    if (shouldLogThrottled('BF_REDIS_UNAVAILABLE')) {
      secureLogger.warn('BF_REDIS_UNAVAILABLE', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Pose un flag suspect en Redis (best-effort, jamais bloquant).
 * Payload JSON compact (<256 bytes) : flaggedAt, reason, count.
 */
async function setFlag(key: string, ttlSeconds: number, payload: object): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.sendCommand([
      'SET',
      key,
      JSON.stringify(payload),
      'EX',
      String(ttlSeconds),
    ]);
  } catch {
    // Flag best-effort — ne jamais faire échouer le flux login
  }
}

/**
 * Vérifie si une clé de flag suspect existe en Redis.
 * Retourne false (fail-open) si Redis est indisponible.
 */
async function checkFlag(key: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const result = await client.sendCommand(['EXISTS', key]);
    return Number(result) === 1;
  } catch {
    return false; // fail-open
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Signale un échec d'authentification.
 * Incrémente les compteurs Redis IP et email hashés.
 * Si un seuil est atteint, pose un flag suspect et émet un log WARN.
 *
 * CONTRAINTES:
 * - Appelé uniquement sur echec UNAUTHORIZED (pas sur succès, pas sur 429)
 * - Fire-and-forget : l'appelant fait `.catch(() => {})`, jamais de throw propagé
 * - Aucune décision de blocage HTTP — signal d'observation uniquement
 */
export async function onLoginFailure({
  ip,
  email,
}: {
  ip?: string;
  email: string;
}): Promise<void> {
  const cfg = getBfConfig();
  const now = new Date().toISOString();

  // ── Compteur email ──────────────────────────────────────────────────────────
  let emailHash: string | undefined;
  try {
    emailHash = hashEmailHmac(email);
    // hashEmailHmac retourne toujours un string ou throw — jamais null
  } catch {
    if (shouldLogThrottled('BF_HASH_FAILURE_email')) {
      secureLogger.warn('BF_HASH_FAILURE', {
        hashType: 'email',
        reason: 'EMAIL_HASH_SECRET unavailable — email counter skipped',
      });
    }
  }

  if (emailHash) {
    const emailKey = `bf:em:${emailHash}`;
    const emailCount = await incrWithFixedTtl(emailKey, cfg.emailTtlSeconds);

    if (emailCount !== null && emailCount >= cfg.emailThreshold) {
      secureLogger.warn('BF_SUSPECT_DETECTED', {
        type: 'email',
        emailHash,
        count: emailCount,
        threshold: cfg.emailThreshold,
      });
      await setFlag(`bf:sus:em:${emailHash}`, cfg.suspectEmailTtlSeconds, {
        flaggedAt: now,
        reason: 'email_threshold_exceeded',
        count: emailCount,
      });
    }
  }

  // ── Compteur IP ─────────────────────────────────────────────────────────────
  // hashIpHmac retourne null si l'IP est invalide, throw si IP_HASH_SECRET absent
  let ipHash: string | null = null;
  if (ip) {
    try {
      ipHash = hashIpHmac(ip);
      // null ici = IP malformée (ex: localhost sans normalisation) — pas d'erreur
    } catch {
      if (shouldLogThrottled('BF_HASH_FAILURE_ip')) {
        secureLogger.warn('BF_HASH_FAILURE', {
          hashType: 'ip',
          reason: 'IP_HASH_SECRET unavailable — IP counter skipped',
        });
      }
    }

    if (ipHash) {
      const ipKey = `bf:ip:${ipHash}`;
      const ipCount = await incrWithFixedTtl(ipKey, cfg.ipTtlSeconds);

      if (ipCount !== null && ipCount >= cfg.ipThreshold) {
        secureLogger.warn('BF_SUSPECT_DETECTED', {
          type: 'ip',
          ipHash,
          count: ipCount,
          threshold: cfg.ipThreshold,
        });
        await setFlag(`bf:sus:ip:${ipHash}`, cfg.suspectIpTtlSeconds, {
          flaggedAt: now,
          reason: 'ip_threshold_exceeded',
          count: ipCount,
        });
      }
    }
  }
}

/**
 * Retourne le compteur brute-force actuel pour une IP.
 *
 * Sémantique de retour:
 * - number : compteur réel (0 si aucune tentative connue dans la fenêtre)
 * - null   : état inconnu (Redis indisponible, hash impossible, erreur Redis)
 *
 * null ≠ 0 — ne pas coercer null en 0 chez l'appelant.
 */
export async function getIpCount(ip: string): Promise<number | null> {
  let ipHash: string | null = null;
  try {
    ipHash = hashIpHmac(ip);
  } catch {
    if (shouldLogThrottled('BF_HASH_FAILURE_ip')) {
      secureLogger.warn('BF_HASH_FAILURE', {
        hashType: 'ip',
        reason: 'IP_HASH_SECRET unavailable',
      });
    }
    return null;
  }
  if (!ipHash) return null; // IP malformée

  const client = getRedisClient();
  if (!client) return null;

  try {
    const result = await client.sendCommand(['GET', `bf:ip:${ipHash}`]);
    if (result === null) return 0; // clé absente = aucune tentative dans la fenêtre (état connu)
    return parseRedisCounter(result);
  } catch {
    return null;
  }
}

/**
 * Retourne le compteur brute-force actuel pour un email.
 *
 * Sémantique de retour identique à getIpCount().
 */
export async function getEmailCount(email: string): Promise<number | null> {
  let emailHash: string | undefined;
  try {
    emailHash = hashEmailHmac(email);
  } catch {
    if (shouldLogThrottled('BF_HASH_FAILURE_email')) {
      secureLogger.warn('BF_HASH_FAILURE', {
        hashType: 'email',
        reason: 'EMAIL_HASH_SECRET unavailable',
      });
    }
    return null;
  }

  const client = getRedisClient();
  if (!client) return null;

  try {
    const result = await client.sendCommand(['GET', `bf:em:${emailHash}`]);
    if (result === null) return 0; // clé absente = aucune tentative dans la fenêtre (état connu)
    return parseRedisCounter(result);
  } catch {
    return null;
  }
}

/**
 * Vérifie si une IP ou un email est flagué comme suspect.
 * Retourne false (fail-open) si Redis est indisponible.
 *
 * Usage: enrichissement de logs ou signal pour décisions futures (LOT 5+).
 * Ne doit PAS être utilisé seul comme gate de blocage HTTP en LOT 4.
 */
export async function isSuspect(type: 'ip' | 'email', rawValue: string): Promise<boolean> {
  try {
    let hash: string | null = null;
    if (type === 'ip') {
      hash = hashIpHmac(rawValue);
    } else {
      hash = hashEmailHmac(rawValue);
    }
    if (!hash) return false;

    const key = type === 'ip' ? `bf:sus:ip:${hash}` : `bf:sus:em:${hash}`;
    return checkFlag(key);
  } catch {
    return false; // fail-open : secret absent ou Redis down
  }
}
