/**
 * Tests d'intégration — surveillance fraîcheur backup → SystemAlert (GAP-3).
 * DB réelle (test), email Brevo MOCKÉ (jamais d'envoi réel), état backup injecté.
 */
import { clientPrisma as prisma } from '@blobinfini/database';
import {
  checkBackupFreshness,
  BACKUP_ALERT_TYPE,
  BACKUP_ALERT_DEDUPE_KEY,
} from '../backup-monitor.service';

const NOW = new Date('2026-06-13T12:00:00.000Z');
const iso = (d: Date) => d.toISOString();
const minus = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3600 * 1000;

const okRecent = () => ({ status: 'ok', timestamp: iso(minus(1 * H)), sizeBytes: 2048, sha256: 'a'.repeat(64) });
const okTooOld = () => ({ status: 'ok', timestamp: iso(minus(80 * H)) });
const failed = () => ({ status: 'failed', timestamp: iso(minus(1 * H)), errorCode: 'BACKUP_FAILED' });

async function openAlerts() {
  return prisma.systemAlert.findMany({
    where: { type: BACKUP_ALERT_TYPE, dedupeKey: BACKUP_ALERT_DEDUPE_KEY, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
  });
}

describe('checkBackupFreshness', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.BACKUP_ALERT_EMAIL_ENABLED = 'false';
    process.env.BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS = '12';
  });
  afterEach(() => {
    process.env.BACKUP_ALERT_EMAIL_ENABLED = savedEnv.BACKUP_ALERT_EMAIL_ENABLED;
    process.env.BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS = savedEnv.BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS;
  });

  it('backup OK récent → aucune alerte ouverte', async () => {
    const r = await checkBackupFreshness({ now: () => NOW, readState: async () => okRecent() });
    expect(r.health).toBe('ok');
    expect(r.action).toBe('noop-ok');
    expect(await openAlerts()).toHaveLength(0);
  });

  it('backup absent → alerte WARNING ouverte', async () => {
    const r = await checkBackupFreshness({ now: () => NOW, readState: async () => null });
    expect(r.severity).toBe('WARNING');
    expect(r.action).toBe('created');
    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('WARNING');
    expect(alerts[0].status).toBe('OPEN');
  });

  it('backup trop vieux → alerte CRITICAL', async () => {
    const r = await checkBackupFreshness({ now: () => NOW, readState: async () => okTooOld() });
    expect(r.severity).toBe('CRITICAL');
    expect((await openAlerts())[0].severity).toBe('CRITICAL');
  });

  it('dernier backup failed → alerte CRITICAL', async () => {
    const r = await checkBackupFreshness({ now: () => NOW, readState: async () => failed() });
    expect(r.severity).toBe('CRITICAL');
    expect((await openAlerts())[0].severity).toBe('CRITICAL');
  });

  it('JSON invalide → pas de crash, alerte WARNING', async () => {
    const r = await checkBackupFreshness({ now: () => NOW, readState: async () => ({ garbage: true }) });
    expect(r.severity).toBe('WARNING');
    expect(await openAlerts()).toHaveLength(1);
  });

  it('idempotence : deux runs ne créent pas deux alertes', async () => {
    await checkBackupFreshness({ now: () => NOW, readState: async () => failed() });
    await checkBackupFreshness({ now: () => NOW, readState: async () => failed() });
    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].occurrenceCount).toBe(2);
  });

  it('résolution automatique quand le backup redevient OK', async () => {
    await checkBackupFreshness({ now: () => NOW, readState: async () => failed() });
    expect(await openAlerts()).toHaveLength(1);

    const r = await checkBackupFreshness({ now: () => new Date(NOW.getTime() + H), readState: async () => okRecent() });
    expect(r.action).toBe('resolved');
    expect(await openAlerts()).toHaveLength(0);

    const resolved = await prisma.systemAlert.findFirst({
      where: { type: BACKUP_ALERT_TYPE, status: 'RESOLVED' },
    });
    expect(resolved?.resolvedAt).toBeTruthy();
  });

  it('escalade WARNING → CRITICAL conserve une seule alerte', async () => {
    await checkBackupFreshness({ now: () => NOW, readState: async () => null }); // WARNING
    await checkBackupFreshness({ now: () => NOW, readState: async () => failed() }); // CRITICAL
    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('CRITICAL');
  });

  describe('notification email (mockée, cooldown)', () => {
    it('email désactivé → jamais de notification', async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const r = await checkBackupFreshness({ now: () => NOW, readState: async () => failed(), sendNotification: send });
      expect(send).not.toHaveBeenCalled();
      expect(r.notified).toBe(false);
    });

    it('email activé → notifie à la création puis respecte le cooldown', async () => {
      process.env.BACKUP_ALERT_EMAIL_ENABLED = 'true';
      process.env.BACKUP_ALERT_NOTIFY_COOLDOWN_HOURS = '12';
      const send = jest.fn().mockResolvedValue(undefined);

      // 1er run : nouvelle alerte → notifie
      const r1 = await checkBackupFreshness({ now: () => NOW, readState: async () => failed(), sendNotification: send });
      expect(r1.notified).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);

      // 2e run 1 h plus tard : encore critique mais < cooldown → pas de notif
      const r2 = await checkBackupFreshness({ now: () => new Date(NOW.getTime() + 1 * H), readState: async () => failed(), sendNotification: send });
      expect(r2.notified).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);

      // 3e run 13 h plus tard : cooldown dépassé → notifie de nouveau
      const r3 = await checkBackupFreshness({ now: () => new Date(NOW.getTime() + 13 * H), readState: async () => failed(), sendNotification: send });
      expect(r3.notified).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('un échec d\'envoi email ne fait pas échouer le job', async () => {
      process.env.BACKUP_ALERT_EMAIL_ENABLED = 'true';
      const send = jest.fn().mockRejectedValue(new Error('smtp down'));
      const r = await checkBackupFreshness({ now: () => NOW, readState: async () => failed(), sendNotification: send });
      expect(r.notified).toBe(false);
      expect(r.alertId).toBeTruthy(); // l'alerte est tout de même créée
    });
  });

  it('anti-fuite : ni secret ni chemin absolu dans message/metadata', async () => {
    await checkBackupFreshness({
      now: () => NOW,
      readState: async () => ({ status: 'failed', timestamp: iso(minus(H)), errorCode: 'BACKUP_FAILED', filename: '/var/backups/blob/secretpath/dump.sql.gz' }),
    });
    const alert = (await openAlerts())[0];
    const serialized = JSON.stringify({ message: alert.message, metadata: alert.metadata });
    expect(serialized).not.toMatch(/\/var\/backups|secretpath|password|postgres(ql)?:\/\//i);
  });
});
