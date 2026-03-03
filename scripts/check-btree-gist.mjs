#!/usr/bin/env node
/**
 * check-btree-gist.mjs
 *
 * Vérifie l'état des contraintes et de l'extension btree_gist après migrate deploy.
 *
 * Modes:
 *   node scripts/check-btree-gist.mjs
 *     → Vérifie que l'extension btree_gist est disponible dans cette installation PostgreSQL.
 *
 *   node scripts/check-btree-gist.mjs --verify-constraints
 *     → Vérifie que les contraintes critiques existent après migrate deploy:
 *         - Contrainte unique ProAvailability_unique_slot (proUserId, startAt, endAt)
 *
 * Exige: DATABASE_URL dans l'environnement.
 * Dépendance: pg (root devDependencies).
 */

import pg from 'pg';

const { Client } = pg;

const mode = process.argv[2] ?? null;

if (mode !== null && mode !== '--verify-constraints') {
  console.error(`❌ check-btree-gist.mjs: unknown mode '${mode}'.`);
  console.error('   Usage: node scripts/check-btree-gist.mjs [--verify-constraints]');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ check-btree-gist.mjs: DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

async function main() {
  await client.connect();

  if (mode === '--verify-constraints') {
    await verifyConstraints();
  } else {
    await checkBtreeGistAvailable();
  }
}

/**
 * Vérifie que l'extension btree_gist est disponible dans pg_available_extensions.
 * N'exige PAS qu'elle soit installée — juste qu'elle soit installable.
 */
async function checkBtreeGistAvailable() {
  const { rows } = await client.query(
    `SELECT name FROM pg_available_extensions WHERE name = 'btree_gist'`
  );
  if (rows.length === 0) {
    console.error('❌ btree_gist extension is NOT available in this PostgreSQL installation.');
    console.error('   Install postgresql-contrib or use a PostgreSQL image that includes btree_gist.');
    process.exit(1);
  }
  console.log('✅ btree_gist extension is available (installable via CREATE EXTENSION).');
}

/**
 * Vérifie que les contraintes critiques existent après migrate deploy.
 *
 * Contraintes vérifiées:
 *   - ProAvailability_unique_slot (UNIQUE sur proUserId, startAt, endAt)
 *     Créée par la migration 20250918_booking_module.
 */
async function verifyConstraints() {
  const errors = [];

  // Contrainte unique ProAvailability_unique_slot
  const { rows: uniqueRows } = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '"ProAvailability"'::regclass
      AND conname = 'ProAvailability_unique_slot'
      AND contype = 'u'
  `);

  if (uniqueRows.length === 0) {
    // Fallback: check via pg_indexes in case it was created as an index, not a constraint
    const { rows: idxRows } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'ProAvailability'
        AND indexdef ILIKE '%"proUserId"%'
        AND indexdef ILIKE '%"startAt"%'
        AND indexdef ILIKE '%"endAt"%'
        AND indexdef ILIKE '%UNIQUE%'
    `);
    if (idxRows.length === 0) {
      errors.push('Missing unique constraint/index on ProAvailability(proUserId, startAt, endAt).');
    } else {
      console.log(`  ✓ Unique index found: ${idxRows[0].indexname}`);
    }
  } else {
    console.log(`  ✓ Unique constraint: ${uniqueRows[0].conname}`);
  }

  if (errors.length > 0) {
    console.error('❌ DB constraint verification FAILED after migrate deploy:');
    for (const err of errors) {
      console.error(`   - ${err}`);
    }
    console.error('   Run prisma migrate deploy (not db push) to apply missing migrations.');
    process.exit(1);
  }

  console.log('✅ check-btree-gist --verify-constraints: all critical constraints present.');
}

main()
  .catch((err) => {
    console.error('❌ check-btree-gist.mjs failed:', err.message);
    process.exit(1);
  })
  .finally(() => client.end());
