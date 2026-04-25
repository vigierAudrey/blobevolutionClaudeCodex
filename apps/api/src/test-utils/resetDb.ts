/**
 * Test Database Reset Utility
 *
 * STRATEGIE:
 * - Truncate l'ensemble des tables metier connues par Postgres
 * - Exclut uniquement les tables systeme a conserver (_prisma_migrations, spatial_ref_sys)
 * - Rehydrate les deux users seed requis par certains tests
 *
 * Pourquoi ce choix:
 * - Une liste statique de deleteMany derive du schema et finit par diverger
 * - Les oublis de tables produisent des faux verts/faux rouges inter-suites
 * - TRUNCATE ... CASCADE supprime l'etat complet, y compris les tables ajoutees apres coup
 *
 * CONFIGURATION:
 * - TEST_DB_RESET_DEBUG=true : Affiche logs detailles
 * - TEST_DB_RESET=false : Desactive le reset (debug uniquement)
 */

import { clientPrisma as prisma } from '@blobinfini/database';

const EXCLUDED_TABLES = ['_prisma_migrations', 'spatial_ref_sys'] as const;

/**
 * Emails des users de seed a restaurer apres reset complet
 */
const SEED_USER_EMAILS = [
  'dev+admin@test.com',
  'dev+rider@test.com'
] as const;

const TEST_SEED_USERS = [
  {
    email: SEED_USER_EMAILS[0],
    role: 'ADMIN' as const,
  },
  {
    email: SEED_USER_EMAILS[1],
    role: 'RIDER' as const,
  },
] as const;

type TableRow = { tablename: string };

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function getResettableTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<TableRow[]>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (${EXCLUDED_TABLES.map((table) => `'${table}'`).join(', ')})
    ORDER BY tablename ASC
  `);

  return rows.map((row: TableRow) => row.tablename);
}

async function ensureSeedUsers(): Promise<void> {
  for (const seedUser of TEST_SEED_USERS) {
    await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {},
      create: {
        email: seedUser.email,
        password: 'hash',
        role: seedUser.role,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });
  }
}

/**
 * Reset la DB entre les tests
 *
 * @returns Nombre de tables truncatees
 */
export async function resetDb(): Promise<number> {
  if (process.env.TEST_DB_RESET === 'false') {
    if (process.env.TEST_DB_RESET_DEBUG === 'true') {
      console.log('⏸️  [resetDb] Skipped (TEST_DB_RESET=false)');
    }
    return 0;
  }

  const debug = process.env.TEST_DB_RESET_DEBUG === 'true';
  let totalDeleted = 0;

  try {
    const tables = await getResettableTables();

    if (debug) {
      console.log(`♻️  [resetDb] Starting cleanup (${tables.length} tables)...`);
    }

    if (tables.length > 0) {
      const truncateSql = `TRUNCATE TABLE ${tables
        .map((table) => `${quoteIdentifier('public')}.${quoteIdentifier(table)}`)
        .join(', ')} RESTART IDENTITY CASCADE`;

      await prisma.$executeRawUnsafe(truncateSql);
      totalDeleted = tables.length;
    }

    await ensureSeedUsers();

    if (debug) {
      console.log(`♻️  [resetDb] Complete (${totalDeleted} tables truncated, seeds restored)`);
    }

    return totalDeleted;
  } catch (error) {
    console.error('❌ [resetDb] Cleanup error:', error);
    throw error;
  }
}

/**
 * Vérifie que les seeds sont présents
 * Utile pour diagnostiquer les problèmes de setup
 */
export async function verifySeedUsers(): Promise<boolean> {
  try {
    const admin = await prisma.user.findUnique({ where: { email: SEED_USER_EMAILS[0] } });
    const rider = await prisma.user.findUnique({ where: { email: SEED_USER_EMAILS[1] } });
    return !!(admin && rider);
  } catch (error) {
    console.error('⚠️  [verifySeedUsers] Error:', error);
    return false;
  }
}
