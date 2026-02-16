/**
 * Jest Global Setup - Préparation DB une seule fois par run
 *
 * RESPONSABILITÉS:
 * 1. Vérifier contexte test (sécurité)
 * 2. Générer Prisma Client (1 fois)
 * 3. Préparer schéma DB (CI: migrate deploy / local: safe-db-push)
 * 4. Vérifier connexion Postgres
 * 5. Seed minimal (2 users test)
 *
 * SÉCURITÉ:
 * - Gardes identiques à jest.setup.db.ts
 * - Local: passe par safe-db-push.mjs (porte unique)
 * - CI: n'utilise jamais ALLOW_ACCEPT_DATA_LOSS
 */

const { execSync } = require('child_process');
const path = require('path');

module.exports = async function globalSetup() {
  console.log('\n🔧 [Global Setup] Starting Jest DB preparation...\n');

  const repoRoot = path.resolve(__dirname, '..', '..');

  // ============================================================================
  // SECURITY GUARD: Verify test environment before db:push
  // ============================================================================
  const APP_ENV = process.env.APP_ENV;
  const CI_PROD = process.env.CI_PROD;
  const NODE_ENV = process.env.NODE_ENV;
  const CI = process.env.CI;

  // Hard deny if production environment
  if (APP_ENV === 'production' || CI_PROD === 'true') {
    throw new Error(
      '❌ BLOCKED: Cannot run db:push in production context.\n' +
      `   APP_ENV=${APP_ENV}, CI_PROD=${CI_PROD}\n` +
      '   This is a CRITICAL security violation.'
    );
  }

  // Verify test context
  if (NODE_ENV !== 'test' && APP_ENV !== 'test') {
    throw new Error(
      '❌ BLOCKED: Database schema setup requires test environment.\n' +
      `   Current NODE_ENV=${NODE_ENV}, APP_ENV=${APP_ENV}\n` +
      '   Set NODE_ENV=test or APP_ENV=test to proceed.'
    );
  }

  try {
    // ============================================================================
    // STEP 1: Generate Prisma Client (1 fois pour tout le run)
    // ============================================================================
    console.log('📦 [1/4] Generating Prisma Client...');
    execSync('npm run generate --workspace @blobinfini/database', {
      stdio: 'inherit',
      cwd: repoRoot
    });

    // ============================================================================
    // STEP 2: Prepare schema (CI: migrate deploy / local: safe-db-push)
    // ============================================================================
    const setupEnv = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL,
      NODE_ENV: 'test' // Ensure test context
    };

    // CI must never rely on ALLOW_ACCEPT_DATA_LOSS.
    delete setupEnv.ALLOW_ACCEPT_DATA_LOSS;

    if (CI === 'true') {
      console.log('\n🗃️  [2/4] CI=true detected: applying schema via migrate deploy...');
      execSync('npm run migrate:deploy --workspace @blobinfini/database', {
        stdio: 'inherit',
        cwd: repoRoot,
        env: setupEnv
      });
    } else {
      console.log('\n🗃️  [2/4] Local test mode: pushing schema to test DB...');
      execSync('npm run db:push --workspace @blobinfini/database', {
        stdio: 'inherit',
        cwd: repoRoot,
        env: {
          ...setupEnv,
          ALLOW_ACCEPT_DATA_LOSS: 'true' // Explicit unlock for local test setup
        }
      });
    }

    // ============================================================================
    // STEP 3: Verify Postgres connection
    // ============================================================================
    console.log('\n🔌 [3/4] Verifying Postgres connection...');

    // Dynamic import de Prisma pour vérifier la connexion
    // Note: on utilise require() car on est dans un .cjs
    const { clientPrisma } = require('@blobinfini/database');

    // Test simple: query pour vérifier que le schéma est prêt
    await clientPrisma.$queryRaw`SELECT 1 as connected`;
    console.log('✅ Postgres connection verified');

    // ============================================================================
    // STEP 4: Seed minimal users (2 users test)
    // ============================================================================
    console.log('\n🌱 [4/4] Seeding minimal test users...');

    const adminEmail = 'dev+admin@test.com';
    const riderEmail = 'dev+rider@test.com';

    // Seed Admin (upsert pour idempotence)
    await clientPrisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password: 'hash',
        role: 'ADMIN',
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      }
    });

    // Seed Rider
    await clientPrisma.user.upsert({
      where: { email: riderEmail },
      update: {},
      create: {
        email: riderEmail,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      }
    });

    await clientPrisma.$disconnect();

    console.log('✅ Seed complete (2 test users)');
    console.log('\n🎉 [Global Setup] DB schema prepared successfully!\n');

  } catch (error) {
    console.error('\n❌ [Global Setup] Failed to setup database:', error.message);
    throw error;
  }
};
