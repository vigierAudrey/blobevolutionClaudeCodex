/**
 * Jest Setup DB - Test isolation & cleanup
 *
 * NOTE: DB schema preparation (generate + db:push + seed) is now handled
 * by jest.global-setup.cjs (executed ONCE per Jest run).
 *
 * This file only handles:
 * - Test data cleanup between tests (afterEach)
 */

import { clientPrisma as prisma } from '@blobinfini/database';

// Touch Prisma client to satisfy no-unused-locals and ensure singleton initialises when tests run.
void prisma;

// ============================================================================
// TEST ISOLATION: Reset DB between tests
// ============================================================================

import { resetDb } from './src/test-utils/resetDb';

/**
 * Reset DB after each test to ensure isolation
 *
 * SKIP CLEANUP:
 * - Certains tests gèrent leur propre cleanup (ex: anti-overbooking.test.ts)
 * - Ajoutez le nom du fichier dans skipCleanupPatterns pour désactiver
 *
 * CONFIGURATION:
 * - TEST_DB_RESET=false : Désactive le reset (debug uniquement)
 * - TEST_DB_RESET_DEBUG=true : Affiche logs détaillés
 */
afterEach(async () => {
  // Skip cleanup si le test gère son propre cycle de vie
  const testPath = expect.getState().testPath || '';
  const skipCleanupPatterns: string[] = [];

  const shouldSkipCleanup = skipCleanupPatterns.some(pattern => testPath.includes(pattern));

  if (shouldSkipCleanup) {
    // Le test gère son propre cleanup
    return;
  }

  // Reset DB via helper (FK-safe, préserve seeds)
  await resetDb();
});
