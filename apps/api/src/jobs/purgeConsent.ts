import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
import { clientPrisma as prisma } from '@blobinfini/database';
import { runJobWithLogContext } from '../observability/log-context';
import { secureLogger } from '../utils/secure-logger';

async function main() {
  await runJobWithLogContext('consent-purge-cli', async () => {
    const days = Number(process.env.CONSENT_PURGE_RETENTION_DAYS || 730); // ~24 mois
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Purge raw consentIp (legacy, should be null after migration)
    const resRaw = await prisma.user.updateMany({
      where: {
        consentIp: { not: null },
        consentedAt: { lt: threshold },
      },
      data: { consentIp: null },
    });

    // Purge consentIpHash (HMAC v2) - RGPD data minimization
    const resHash = await prisma.user.updateMany({
      where: {
        consentIpHash: { not: null },
        consentedAt: { lt: threshold },
      },
      data: { consentIpHash: null },
    });

    secureLogger.info('CONSENT_PURGE_CLI_COMPLETED', {
      rawPurged: resRaw.count,
      hashPurged: resHash.count,
      retentionDays: days,
    });
  });
}

main()
  .catch((e) => {
    secureLogger.error('CONSENT_PURGE_CLI_FAILED', { error: e });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
