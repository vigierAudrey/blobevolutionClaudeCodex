/**
 * Surveillance de la fraîcheur des sauvegardes PostgreSQL (GAP-3).
 *
 * Lit l'état backup admin-safe exposé par GAP-2 (`last-backup.json`, jamais les
 * dumps) et maintient UNE alerte système dédupliquée :
 *   - backup OK récent      → résout l'alerte ouverte (si présente) ;
 *   - absent / illisible     → WARNING ;
 *   - trop ancien            → WARNING puis CRITICAL selon seuil ;
 *   - dernier run `failed`    → CRITICAL.
 *
 * Idempotent : `dedupeKey` stable, upsert (lastSeenAt/occurrenceCount), jamais de
 * doublon. Notification email (Brevo) optionnelle, avec cooldown anti-spam et
 * uniquement sur changement d'état / escalade / persistance critique.
 *
 * Aucun secret, chemin absolu ou nom de dump dans l'alerte, l'email ou les logs.
 * Aucune route HTTP. Déclenchement :
 *   - in-process (index.ts, BACKUP_MONITOR_INTERVAL_MINUTES — défaut 30 min en
 *     production, désactivé ailleurs) : le conteneur API monte /var/lib/blob/status
 *     en lecture seule, aucun tooling host requis ;
 *   - CLI apps/api/src/jobs/checkBackupFreshness.ts : run manuel ou cron externe.
 */

import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import { sendMail } from '../lib/mailer';
import {
  readBackupStateRaw,
  evaluateBackupState,
  type BackupStatus,
  type HealthLevel,
} from '../modules/admin/system-status.service';

export const BACKUP_ALERT_TYPE = 'BACKUP_FRESHNESS';
export const BACKUP_ALERT_DEDUPE_KEY = 'backup.postgres.freshness';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'security@blobsurf.com';
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:3002';

function emailEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.BACKUP_ALERT_EMAIL_ENABLED || '').trim().toLowerCase());
}
function cooldownMs(): number {
  const hours = Number(process.env.BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS);
  const clamped = Number.isFinite(hours) ? Math.max(1, Math.min(hours, 168)) : 12;
  return clamped * 3600 * 1000;
}

type Severity = 'WARNING' | 'CRITICAL';

export interface BackupMonitorResult {
  health: HealthLevel;
  action: 'resolved' | 'noop-ok' | 'created' | 'updated';
  severity: Severity | null;
  notified: boolean;
  alertId: string | null;
}

export interface BackupNotificationInput {
  severity: Severity;
  backup: BackupStatus;
}

export interface BackupMonitorDeps {
  now?: () => Date;
  readState?: () => Promise<unknown | null>;
  /** Injectable pour tester sans email réel. Défaut : email admin via Brevo. */
  sendNotification?: (input: BackupNotificationInput) => Promise<void>;
}

function humanAge(seconds: number | null): string {
  if (seconds == null) return 'inconnu';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${m.toString().padStart(2, '0')}`;
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Email admin-safe : pas de filename de dump, pas de chemin, pas de secret. */
async function defaultNotify({ severity, backup }: BackupNotificationInput): Promise<void> {
  const subject = `${severity === 'CRITICAL' ? '🚨' : '⚠️'} Alerte sauvegarde PostgreSQL — ${severity}`;
  const lines = [
    'ALERTE SAUVEGARDE — Blob',
    '',
    backup.message,
    '',
    `Gravité : ${severity}`,
    `État : ${backup.state}`,
    `Âge du dernier backup connu : ${humanAge(backup.ageSeconds)}`,
    backup.errorCode ? `Code : ${backup.errorCode}` : '',
    '',
    'Actions :',
    '1. Vérifier le cron de backup sur le VPS.',
    '2. Relancer scripts/backup-pg.sh et valider avec scripts/restore-pg.sh.',
    '',
    `Cockpit : ${WEB_BASE_URL}/admin/health`,
  ].filter(Boolean);
  await sendMail({
    to: ADMIN_EMAIL,
    subject,
    text: lines.join('\n'),
    type: 'system_alert',
  });
}

/**
 * Vérifie la fraîcheur du backup et met à jour l'alerte système en conséquence.
 * Ne lève jamais d'exception non gérée pour l'email (le job ne doit pas échouer
 * à cause d'un envoi raté).
 */
export async function checkBackupFreshness(deps: BackupMonitorDeps = {}): Promise<BackupMonitorResult> {
  const now = (deps.now ?? (() => new Date()))();
  const raw = await (deps.readState ?? readBackupStateRaw)();
  const backup = evaluateBackupState(raw, now);

  // ── Backup sain → résoudre toute alerte ouverte ────────────────────────────
  if (backup.health === 'ok') {
    const resolved = await prisma.systemAlert.updateMany({
      where: {
        type: BACKUP_ALERT_TYPE,
        dedupeKey: BACKUP_ALERT_DEDUPE_KEY,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      data: { status: 'RESOLVED', resolvedAt: now },
    });
    if (resolved.count > 0) {
      secureLogger.info('BACKUP_FRESHNESS_ALERT_RESOLVED', { count: resolved.count });
    }
    return { health: 'ok', action: resolved.count > 0 ? 'resolved' : 'noop-ok', severity: null, notified: false, alertId: null };
  }

  // ── Backup dégradé/critique → upsert idempotent de l'alerte ────────────────
  const severity: Severity = backup.health === 'critical' ? 'CRITICAL' : 'WARNING';
  const diagnostics = {
    kind: 'backup-freshness',
    state: backup.state,
    health: backup.health,
    ageSeconds: backup.ageSeconds,
    errorCode: backup.errorCode,
  };

  const { alertId, isNew, escalated, prevNotifiedAt } = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const existing = await tx.systemAlert.findFirst({
        where: {
          type: BACKUP_ALERT_TYPE,
          dedupeKey: BACKUP_ALERT_DEDUPE_KEY,
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        select: { id: true, severity: true, metadata: true },
      });

      if (!existing) {
        const created = await tx.systemAlert.create({
          data: {
            type: BACKUP_ALERT_TYPE,
            message: backup.message,
            severity,
            status: 'OPEN',
            dedupeKey: BACKUP_ALERT_DEDUPE_KEY,
            link: `${WEB_BASE_URL}/admin/health`,
            metadata: toJson({ ...diagnostics, lastNotifiedAt: null }),
            occurrenceCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          select: { id: true },
        });
        return { alertId: created.id, isNew: true, escalated: false, prevNotifiedAt: null as string | null };
      }

      const prevMeta =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      const prevNotified = typeof prevMeta.lastNotifiedAt === 'string' ? prevMeta.lastNotifiedAt : null;
      const wasEscalated = existing.severity !== 'CRITICAL' && severity === 'CRITICAL';

      await tx.systemAlert.update({
        where: { id: existing.id },
        data: {
          message: backup.message,
          severity,
          lastSeenAt: now,
          occurrenceCount: { increment: 1 },
          // Conserve lastNotifiedAt (cooldown) ; rafraîchit les diagnostics.
          metadata: toJson({ ...diagnostics, lastNotifiedAt: prevNotified }),
        },
      });
      return { alertId: existing.id, isNew: false, escalated: wasEscalated, prevNotifiedAt: prevNotified };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  // ── Notification email (cooldown + changement d'état) ──────────────────────
  const prevTs = prevNotifiedAt ? new Date(prevNotifiedAt).getTime() : 0;
  const cooldownPassed = !prevTs || now.getTime() - prevTs >= cooldownMs();
  const shouldNotify = isNew || escalated || (severity === 'CRITICAL' && cooldownPassed);

  let notified = false;
  if (shouldNotify && emailEnabled()) {
    try {
      await (deps.sendNotification ?? defaultNotify)({ severity, backup });
      notified = true;
      await prisma.systemAlert.update({
        where: { id: alertId },
        data: { metadata: toJson({ ...diagnostics, lastNotifiedAt: now.toISOString() }) },
      });
    } catch (error) {
      secureLogger.error('BACKUP_ALERT_EMAIL_FAILED', { error });
    }
  }

  secureLogger.warn('BACKUP_FRESHNESS_ALERT', {
    health: backup.health,
    severity,
    action: isNew ? 'created' : 'updated',
    notified,
  });

  return {
    health: backup.health,
    action: isNew ? 'created' : 'updated',
    severity,
    notified,
    alertId,
  };
}
