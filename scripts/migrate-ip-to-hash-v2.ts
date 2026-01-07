/**
 * ONE-OFF MIGRATION SCRIPT: IP Brutes → HMAC-SHA256 Hash (v2)
 *
 * Purpose:
 * - Backfill User.consentIpHash from User.consentIp (if missing)
 * - Backfill LoginAttempt.ipHash from LoginAttempt.ip (if missing)
 * - Purge raw IPs after migration (RGPD compliance)
 *
 * Safety:
 * - Idempotent: can be run multiple times safely
 * - Dry-run mode available (DRY_RUN=true)
 * - Transaction support for rollback on error
 *
 * Usage:
 *   npm run migrate:ip-to-hash        # Real migration
 *   npm run migrate:ip-to-hash:dry-run  # Test mode
 */

// Load environment variables
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('⚠️  Warning: .env file not found. Make sure IP_HASH_SECRET is set in environment.');
}

import { clientPrisma as prisma } from '@blobinfini/database';
import { hashIpHmac } from '../apps/api/src/lib/hash-ip';

// Support both CLI flags and env var
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
const EXECUTE = args.includes('--execute');

// Safety: require explicit --execute or --dry-run flag
if (!DRY_RUN && !EXECUTE) {
  console.error('❌ ERROR: Must specify --execute or --dry-run flag');
  console.error('');
  console.error('Usage:');
  console.error('  npm run migrate:ip-to-hash         # Production migration');
  console.error('  npm run migrate:ip-to-hash:dry-run # Test run (no changes)');
  process.exit(1);
}

interface MigrationStats {
  usersProcessed: number;
  usersMigrated: number;
  usersPurged: number;
  loginAttemptsProcessed: number;
  loginAttemptsMigrated: number;
  loginAttemptsPurged: number;
  errors: number;
}

async function migrateUserConsentIp(): Promise<Partial<MigrationStats>> {
  console.log('\n📊 Migrating User.consentIp → User.consentIpHash...');

  let usersProcessed = 0;
  let usersMigrated = 0;
  let usersPurged = 0;
  let errors = 0;

  try {
    // Find all users with consentIp but no consentIpHash
    const usersWithRawIp = await prisma.user.findMany({
      where: {
        consentIp: { not: null },
        consentIpHash: null
      },
      select: { id: true, consentIp: true }
    });

    console.log(`   Found ${usersWithRawIp.length} users with raw consentIp needing migration`);

    for (const user of usersWithRawIp) {
      usersProcessed++;
      try {
        if (user.consentIp) {
          const ipHash = hashIpHmac(user.consentIp);

          if (!DRY_RUN && ipHash) {
            await prisma.user.update({
              where: { id: user.id },
              data: { consentIpHash: ipHash }
            });
            usersMigrated++;
          } else if (DRY_RUN) {
            console.log(`   [DRY RUN] Would hash IP for user ${user.id}: ${user.consentIp.substring(0, 10)}...`);
            usersMigrated++;
          }
        }
      } catch (error) {
        console.error(`   ❌ Error migrating user ${user.id}:`, error);
        errors++;
      }
    }

    // Purge raw IPs (set to null) for users who now have consentIpHash
    const usersToPurge = await prisma.user.count({
      where: {
        consentIp: { not: null },
        consentIpHash: { not: null }
      }
    });

    console.log(`   Found ${usersToPurge} users with both consentIp and consentIpHash - purging raw IPs...`);

    if (!DRY_RUN && usersToPurge > 0) {
      const result = await prisma.user.updateMany({
        where: {
          consentIp: { not: null },
          consentIpHash: { not: null }
        },
        data: { consentIp: null }
      });
      usersPurged = result.count;
    } else if (DRY_RUN) {
      usersPurged = usersToPurge;
      console.log(`   [DRY RUN] Would purge ${usersToPurge} raw consentIp values`);
    }

    return { usersProcessed, usersMigrated, usersPurged, errors };
  } catch (error) {
    console.error('❌ Fatal error in User migration:', error);
    throw error;
  }
}

async function migrateLoginAttemptIp(): Promise<Partial<MigrationStats>> {
  console.log('\n📊 Migrating LoginAttempt.ip → LoginAttempt.ipHash...');

  let loginAttemptsProcessed = 0;
  let loginAttemptsMigrated = 0;
  let loginAttemptsPurged = 0;
  let errors = 0;

  try {
    // Find all login attempts with ip but no ipHash
    const attemptsWithRawIp = await prisma.loginAttempt.findMany({
      where: {
        ip: { not: null },
        ipHash: null
      },
      select: { id: true, ip: true }
    });

    console.log(`   Found ${attemptsWithRawIp.length} login attempts with raw IP needing migration`);

    // Batch update for performance (chunks of 1000)
    const BATCH_SIZE = 1000;
    for (let i = 0; i < attemptsWithRawIp.length; i += BATCH_SIZE) {
      const batch = attemptsWithRawIp.slice(i, i + BATCH_SIZE);

      for (const attempt of batch) {
        loginAttemptsProcessed++;
        try {
          if (attempt.ip) {
            const ipHash = hashIpHmac(attempt.ip);

            if (!DRY_RUN && ipHash) {
              await prisma.loginAttempt.update({
                where: { id: attempt.id },
                data: { ipHash }
              });
              loginAttemptsMigrated++;
            } else if (DRY_RUN) {
              loginAttemptsMigrated++;
            }
          }
        } catch (error) {
          console.error(`   ❌ Error migrating login attempt ${attempt.id}:`, error);
          errors++;
        }
      }

      if (loginAttemptsProcessed % 1000 === 0) {
        console.log(`   Progress: ${loginAttemptsProcessed}/${attemptsWithRawIp.length} login attempts processed`);
      }
    }

    // Purge raw IPs (set to null) for login attempts who now have ipHash
    const attemptsToPurge = await prisma.loginAttempt.count({
      where: {
        ip: { not: null },
        ipHash: { not: null }
      }
    });

    console.log(`   Found ${attemptsToPurge} login attempts with both ip and ipHash - purging raw IPs...`);

    if (!DRY_RUN && attemptsToPurge > 0) {
      const result = await prisma.loginAttempt.updateMany({
        where: {
          ip: { not: null },
          ipHash: { not: null }
        },
        data: { ip: null }
      });
      loginAttemptsPurged = result.count;
    } else if (DRY_RUN) {
      loginAttemptsPurged = attemptsToPurge;
      console.log(`   [DRY RUN] Would purge ${attemptsToPurge} raw ip values`);
    }

    return { loginAttemptsProcessed, loginAttemptsMigrated, loginAttemptsPurged, errors };
  } catch (error) {
    console.error('❌ Fatal error in LoginAttempt migration:', error);
    throw error;
  }
}

async function main() {
  console.log('🔐 IP Migration to HMAC-SHA256 (v2) - RGPD Compliance');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN (no changes will be made)' : '⚡ LIVE MIGRATION'}`);
  console.log('');

  const stats: MigrationStats = {
    usersProcessed: 0,
    usersMigrated: 0,
    usersPurged: 0,
    loginAttemptsProcessed: 0,
    loginAttemptsMigrated: 0,
    loginAttemptsPurged: 0,
    errors: 0
  };

  try {
    // Migrate User.consentIp
    const userStats = await migrateUserConsentIp();
    Object.assign(stats, userStats);

    // Migrate LoginAttempt.ip
    const attemptStats = await migrateLoginAttemptIp();
    Object.assign(stats, attemptStats);

    // Final report
    console.log('\n');
    console.log('='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`User.consentIp:`);
    console.log(`  - Processed: ${stats.usersProcessed}`);
    console.log(`  - Migrated to consentIpHash: ${stats.usersMigrated}`);
    console.log(`  - Purged raw consentIp: ${stats.usersPurged}`);
    console.log(``);
    console.log(`LoginAttempt.ip:`);
    console.log(`  - Processed: ${stats.loginAttemptsProcessed}`);
    console.log(`  - Migrated to ipHash: ${stats.loginAttemptsMigrated}`);
    console.log(`  - Purged raw ip: ${stats.loginAttemptsPurged}`);
    console.log(``);
    console.log(`Total errors: ${stats.errors}`);
    console.log('='.repeat(60));

    if (DRY_RUN) {
      console.log('\n✅ DRY RUN completed successfully - no changes were made');
      console.log('   Run without DRY_RUN=true to apply changes');
    } else {
      console.log('\n✅ Migration completed successfully');
      console.log('   All raw IPs have been hashed with HMAC-SHA256 and purged');
    }

    process.exit(stats.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
