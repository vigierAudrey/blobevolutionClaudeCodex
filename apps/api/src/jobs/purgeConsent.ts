import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
import { clientPrisma as prisma } from '@blobinfini/database';

async function main() {
  const days = Number(process.env.CONSENT_PURGE_RETENTION_DAYS || 730); // ~24 mois
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const res = await prisma.user.updateMany({
    where: {
      consentIp: { not: null },
      consentedAt: { lt: threshold },
    },
    data: { consentIp: null },
  });
  // eslint-disable-next-line no-console
  console.log(`Purged consentIp on ${res.count} user(s) older than ${days} days.`);
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

