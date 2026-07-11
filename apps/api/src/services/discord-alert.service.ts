/**
 * Canal d'alerte Discord pour les alertes APPLICATIVES (API).
 *
 * Pendant de scripts/alert.sh (crons VPS) : même webhook (DISCORD_WEBHOOK_URL),
 * mêmes niveaux, même format d'embed — le salon Discord reste homogène quel que
 * soit l'émetteur (cron ou API).
 *
 * Contrat de robustesse (identique à alert.sh) :
 *   - fail-silent : ne throw JAMAIS, ne bloque JAMAIS l'appelant ;
 *   - sans DISCORD_WEBHOOK_URL : no-op (log debug) — l'admin/DB/email restent
 *     les canaux de vérité ;
 *   - timeout borné : un Discord injoignable ne ralentit pas l'API ;
 *   - l'URL du webhook n'apparaît JAMAIS dans les logs (c'est un secret) ;
 *   - filtre ALERT_MIN_LEVEL partagé avec alert.sh (défaut : tout envoyer).
 *
 * Contrat de contenu — responsabilité de l'APPELANT :
 *   le message ne doit contenir NI PII (email, userId, IP), NI secret, NI chemin
 *   sensible. Discord est un canal de réveil : les détails vivent dans
 *   /admin/alerts et l'email admin.
 */

import { hostname } from 'os';
import { secureLogger } from '../utils/secure-logger';

export type DiscordAlertLevel = 'ok' | 'warning' | 'critical' | 'emergency';

export const DISCORD_ALERT_TIMEOUT_MS = 5000;

const LEVEL_RANK: Record<DiscordAlertLevel, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
  emergency: 3,
};

// Couleurs alignées sur scripts/alert.sh (vert / jaune / rouge / rouge sombre).
const LEVEL_COLOR: Record<DiscordAlertLevel, number> = {
  ok: 3066993,
  warning: 16776960,
  critical: 15158332,
  emergency: 10038562,
};

const LEVEL_LABEL: Record<DiscordAlertLevel, string> = {
  ok: '✅ OK',
  warning: '⚠️ WARNING',
  critical: '🔴 CRITICAL',
  emergency: '🚨 EMERGENCY',
};

function safeErrorMeta(error: unknown): { errorName?: string } {
  return error instanceof Error ? { errorName: error.name } : {};
}

/** Webhook configuré et bien formé (https). Jamais loggé. */
function resolveWebhookUrl(): string | null {
  const raw = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function minLevelRank(): number {
  const raw = (process.env.ALERT_MIN_LEVEL || 'ok').trim().toLowerCase();
  return raw in LEVEL_RANK ? LEVEL_RANK[raw as DiscordAlertLevel] : LEVEL_RANK.ok;
}

function alertHost(): string {
  const fromEnv = process.env.ALERT_HOSTNAME?.trim();
  if (fromEnv) return fromEnv;
  try {
    return hostname() || 'blob-api';
  } catch {
    return 'blob-api';
  }
}

/** Le canal est-il actif (webhook valide présent) ? */
export function isDiscordAlertEnabled(): boolean {
  return resolveWebhookUrl() !== null;
}

/**
 * Envoie une alerte sur le salon Discord ops.
 * Retourne true uniquement si Discord a accepté le message (2xx).
 * false = désactivé, filtré par niveau, ou échec réseau — jamais de throw.
 */
export async function sendDiscordAlert(
  level: DiscordAlertLevel,
  message: string,
  context = 'api',
): Promise<boolean> {
  const url = resolveWebhookUrl();
  if (!url) {
    secureLogger.debug('DISCORD_ALERT_SKIPPED', { reason: 'no_webhook', level, context });
    return false;
  }

  if (LEVEL_RANK[level] < minLevelRank()) return false;

  const now = new Date();
  const payload = {
    embeds: [
      {
        title: `${LEVEL_LABEL[level]} — ${alertHost()}`,
        description: message,
        color: LEVEL_COLOR[level],
        footer: {
          text: `${context} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        },
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCORD_ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Statut seul — jamais le corps ni l'URL (risque d'écho du webhook).
      secureLogger.warn('DISCORD_ALERT_REJECTED', { status: res.status, level, context });
      return false;
    }
    return true;
  } catch (error: unknown) {
    secureLogger.warn('DISCORD_ALERT_SEND_FAILED', { level, context, ...safeErrorMeta(error) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Variante fire-and-forget : pour les chemins qui ne doivent jamais attendre. */
export function sendDiscordAlertSilent(
  level: DiscordAlertLevel,
  message: string,
  context = 'api',
): void {
  void sendDiscordAlert(level, message, context).catch(() => {
    // sendDiscordAlert ne throw pas — ceinture et bretelles.
  });
}
