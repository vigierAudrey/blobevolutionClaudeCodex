import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
import { clientPrisma as prisma } from '@blobinfini/database';

async function main() {
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

  // eslint-disable-next-line no-console
  console.log(`Purged consentIp on ${resRaw.count} user(s) and consentIpHash on ${resHash.count} user(s) older than ${days} days (RGPD retention).`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Purge job failed', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

