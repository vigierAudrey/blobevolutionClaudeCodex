/**
 * Service "État système" admin (GAP-2).
 *
 * Agrège un cockpit pré-prod *en lecture seule* pour l'admin :
 *  - readiness (DB/Redis/storage) — réutilise les checks GAP-1 ;
 *  - fraîcheur du dernier backup PostgreSQL — via un fichier d'état JSON écrit
 *    par `scripts/backup-pg.sh` (jamais en parcourant le dossier de backups) ;
 *  - usage disque du volume data — via `fs.statfs` sur un chemin *configuré*,
 *    jamais exposé côté réponse ;
 *  - version déployée — `GIT_COMMIT_SHA` (court) ;
 *  - compteurs d'alertes ouvertes (lecture seule).
 *
 * Règles : aucune écriture DB ici (GAP-3 traitera SystemAlert/Brevo), aucun
 * secret/chemin absolu/stack trace exposé, lectures bornées + fallback propre,
 * jamais d'exception propagée hors de `buildSystemStatus`.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../../utils/secure-logger';
import { buildReadiness, type ReadinessResponse } from '../health/health.checks';

export type HealthLevel = 'ok' | 'warn' | 'critical' | 'unknown';

// ── Configuration (env, defaults sûrs) ──────────────────────────────────────
const BACKUP_STATE_FILE = process.env.BACKUP_STATE_FILE?.trim() || '/var/lib/blob/status/last-backup.json';
const BACKUP_STATE_MAX_BYTES = clampInt(process.env.BACKUP_STATE_MAX_BYTES, 4096, 256, 65536);
const BACKUP_WARN_HOURS = clampInt(process.env.BACKUP_MAX_AGE_WARN_HOURS, 26, 1, 24 * 30);
const BACKUP_CRITICAL_HOURS = clampInt(process.env.BACKUP_MAX_AGE_CRITICAL_HOURS, 50, 2, 24 * 60);

const DISK_MONITOR_PATH = process.env.DISK_MONITOR_PATH?.trim() || '/';
const DISK_WARN_PERCENT = clampInt(process.env.DISK_WARN_PERCENT, 80, 1, 99);
const DISK_CRITICAL_PERCENT = clampInt(process.env.DISK_CRITICAL_PERCENT, 90, 2, 100);

const IO_TIMEOUT_MS = clampInt(process.env.SYSTEM_STATUS_IO_TIMEOUT_MS, 1500, 200, 5000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

/** Borne une promesse IO : résout `fallback` au lieu de bloquer/throw. */
async function withIoTimeout<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    fn().then(done).catch(() => done(fallback));
  });
}

// ── Backup ───────────────────────────────────────────────────────────────────

/** Schéma admin-safe du fichier d'état. Champs sensibles rejetés implicitement. */
const backupStateSchema = z.object({
  status: z.enum(['ok', 'failed']),
  timestamp: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  filename: z.string().max(256).optional(),
  errorCode: z.string().max(64).optional(),
});
type BackupState = z.infer<typeof backupStateSchema>;

export interface BackupStatus {
  state: 'ok' | 'failed' | 'unknown';
  health: HealthLevel;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  sizeBytes: number | null;
  sizeHuman: string | null;
  hasChecksum: boolean;
  durationMs: number | null;
  filename: string | null;
  errorCode: string | null;
  message: string;
}

export function humanBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Évalue un état backup (fonction pure, testable). `raw` est le JSON parsé OU
 * `null` (fichier absent/illisible/invalide).
 */
export function evaluateBackupState(
  raw: unknown | null,
  now: Date = new Date(),
  thresholds = { warnHours: BACKUP_WARN_HOURS, criticalHours: BACKUP_CRITICAL_HOURS },
): BackupStatus {
  const base: BackupStatus = {
    state: 'unknown',
    health: 'warn',
    lastBackupAt: null,
    ageSeconds: null,
    sizeBytes: null,
    sizeHuman: null,
    hasChecksum: false,
    durationMs: null,
    filename: null,
    errorCode: null,
    message: 'Aucun état de backup disponible.',
  };

  if (raw == null) return base;

  const parsed = backupStateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...base, message: 'État de backup illisible ou invalide.' };
  }

  const data: BackupState = parsed.data;
  const ts = new Date(data.timestamp);
  if (Number.isNaN(ts.getTime())) {
    return { ...base, message: 'Horodatage de backup invalide.' };
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - ts.getTime()) / 1000));

  if (data.status === 'failed') {
    return {
      state: 'failed',
      health: 'critical',
      lastBackupAt: ts.toISOString(),
      ageSeconds,
      sizeBytes: data.sizeBytes ?? null,
      sizeHuman: humanBytes(data.sizeBytes),
      hasChecksum: Boolean(data.sha256),
      durationMs: data.durationMs ?? null,
      filename: basenameOnly(data.filename),
      errorCode: data.errorCode ?? 'BACKUP_FAILED',
      message: 'Le dernier backup a échoué.',
    };
  }

  const ageHours = ageSeconds / 3600;
  let health: HealthLevel = 'ok';
  let message = 'Backup récent et valide.';
  if (ageHours > thresholds.criticalHours) {
    health = 'critical';
    message = `Backup trop ancien (> ${thresholds.criticalHours} h).`;
  } else if (ageHours > thresholds.warnHours) {
    health = 'warn';
    message = `Backup vieillissant (> ${thresholds.warnHours} h).`;
  }

  return {
    state: 'ok',
    health,
    lastBackupAt: ts.toISOString(),
    ageSeconds,
    sizeBytes: data.sizeBytes ?? null,
    sizeHuman: humanBytes(data.sizeBytes),
    hasChecksum: Boolean(data.sha256),
    durationMs: data.durationMs ?? null,
    filename: basenameOnly(data.filename),
    errorCode: null,
    message,
  };
}

function basenameOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  // Défense en profondeur : ne jamais renvoyer un chemin, seulement le basename.
  return path.basename(value);
}

/** Lit + parse le fichier d'état backup, borné en taille et en temps. Jamais d'exception. */
export async function readBackupStateRaw(): Promise<unknown | null> {
  return withIoTimeout<unknown | null>(
    async () => {
      const stat = await fs.stat(BACKUP_STATE_FILE);
      if (!stat.isFile() || stat.size === 0 || stat.size > BACKUP_STATE_MAX_BYTES) {
        return null;
      }
      const content = await fs.readFile(BACKUP_STATE_FILE, 'utf8');
      return JSON.parse(content);
    },
    IO_TIMEOUT_MS,
    null,
  ).catch(() => null);
}

// ── Disque ─────────────────────────────────────────────────────────────────

export interface DiskStatus {
  health: HealthLevel;
  usedPercent: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  message: string;
}

interface StatfsLike {
  bsize: number;
  blocks: number;
  bfree: number;
}

/** Évalue l'usage disque (fonction pure, testable). `stat` null = mesure indisponible. */
export function evaluateDisk(
  stat: StatfsLike | null,
  thresholds = { warnPercent: DISK_WARN_PERCENT, criticalPercent: DISK_CRITICAL_PERCENT },
): DiskStatus {
  if (!stat || !Number.isFinite(stat.blocks) || stat.blocks <= 0 || stat.bsize <= 0) {
    return {
      health: 'unknown',
      usedPercent: null,
      totalBytes: null,
      freeBytes: null,
      message: 'Mesure disque indisponible.',
    };
  }
  const totalBytes = stat.blocks * stat.bsize;
  const freeBytes = Math.max(0, stat.bfree * stat.bsize);
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));

  let health: HealthLevel = 'ok';
  let message = 'Espace disque suffisant.';
  if (usedPercent >= thresholds.criticalPercent) {
    health = 'critical';
    message = `Disque presque plein (≥ ${thresholds.criticalPercent} %).`;
  } else if (usedPercent >= thresholds.warnPercent) {
    health = 'warn';
    message = `Disque à surveiller (≥ ${thresholds.warnPercent} %).`;
  }

  return { health, usedPercent, totalBytes, freeBytes, message };
}

/** Mesure l'usage disque via fs.statfs, bornée. Jamais d'exception, jamais le chemin exposé. */
export async function readDiskUsage(): Promise<DiskStatus> {
  const stat = await withIoTimeout<StatfsLike | null>(
    async () => {
      const s = await fs.statfs(DISK_MONITOR_PATH);
      return { bsize: Number(s.bsize), blocks: Number(s.blocks), bfree: Number(s.bfree) };
    },
    IO_TIMEOUT_MS,
    null,
  ).catch(() => null);
  return evaluateDisk(stat);
}

// ── Version déployée ─────────────────────────────────────────────────────────

export interface VersionInfo {
  commit: string;
  deployedAt: string | null;
}

export function resolveVersion(): VersionInfo {
  const sha = (process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || '').trim();
  const commit = /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : 'unknown';
  const deployRaw = (process.env.DEPLOY_TIMESTAMP || '').trim();
  let deployedAt: string | null = null;
  if (deployRaw) {
    const d = new Date(deployRaw);
    if (!Number.isNaN(d.getTime())) deployedAt = d.toISOString();
  }
  return { commit, deployedAt };
}

// ── Alertes (compteurs, lecture seule) ───────────────────────────────────────

export interface AlertSummary {
  open: number;
  warningOpen: number;
  criticalOpen: number;
}

async function readAlertSummary(): Promise<AlertSummary> {
  try {
    // 3 COUNT indexés (@@index([status, severity])) — pas de scan, pas de N+1.
    const [open, warningOpen, criticalOpen] = await Promise.all([
      prisma.systemAlert.count({ where: { status: 'OPEN' } }),
      prisma.systemAlert.count({ where: { status: 'OPEN', severity: 'WARNING' } }),
      prisma.systemAlert.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
    ]);
    return { open, warningOpen, criticalOpen };
  } catch (error) {
    secureLogger.error('SYSTEM_STATUS_ALERT_SUMMARY_FAILED', { error });
    return { open: 0, warningOpen: 0, criticalOpen: 0 };
  }
}

// ── Agrégation ────────────────────────────────────────────────────────────────

export interface SystemStatusResponse {
  generatedAt: string;
  readiness: ReadinessResponse;
  backup: BackupStatus;
  disk: DiskStatus;
  version: VersionInfo;
  alerts: AlertSummary;
}

export interface SystemStatusDeps {
  readiness?: () => Promise<ReadinessResponse>;
  backupRaw?: () => Promise<unknown | null>;
  disk?: () => Promise<DiskStatus>;
  alerts?: () => Promise<AlertSummary>;
  now?: () => Date;
}

export async function buildSystemStatus(deps: SystemStatusDeps = {}): Promise<SystemStatusResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const [readiness, backupRaw, disk, alerts] = await Promise.all([
    (deps.readiness ?? buildReadiness)(),
    (deps.backupRaw ?? readBackupStateRaw)(),
    (deps.disk ?? readDiskUsage)(),
    (deps.alerts ?? readAlertSummary)(),
  ]);

  return {
    generatedAt: now.toISOString(),
    readiness,
    backup: evaluateBackupState(backupRaw, now),
    disk,
    version: resolveVersion(),
    alerts,
  };
}
