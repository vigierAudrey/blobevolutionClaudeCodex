import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });

import { clientPrisma as prisma } from '@blobinfini/database';
import { runJobWithLogContext } from '../observability/log-context';
import { secureLogger } from '../utils/secure-logger';
import { checkBackupFreshness } from '../services/backup-monitor.service';

/**
 * checkBackupFreshness — Job de surveillance de la fraîcheur des backups PostgreSQL.
 *
 * Déclenché par cron côté VPS (PAS de route HTTP). Idempotent.
 * Recommandé : flock pour empêcher tout recouvrement de deux exécutions.
 * Exemple de cron (toutes les 30 min) et procédure : voir docs/ops/system-alerts.md.
 */
async function main(): Promise<void> {
  await runJobWithLogContext('check-backup-freshness-cli', async () => {
    const result = await checkBackupFreshness();
    secureLogger.info('backup.freshness.run_metrics', {
      health: result.health,
      action: result.action,
      severity: result.severity,
      notified: result.notified,
    });
  });
}

if (require.main === module) {
  main()
    .catch((e) => {
      secureLogger.error('backup.freshness.job_failed', { message: e instanceof Error ? e.message : String(e) });
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as runCheckBackupFreshness };
