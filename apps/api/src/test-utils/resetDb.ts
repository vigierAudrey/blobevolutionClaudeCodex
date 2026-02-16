/**
 * Test Database Reset Utility
 *
 * STRATÉGIE: deleteMany avec ordre FK-safe
 *
 * RAISON DU CHOIX (vs TRUNCATE):
 * - Prisma ne supporte pas bien TRUNCATE CASCADE avec sequences
 * - deleteMany respecte les FK et triggers Prisma
 * - Plus sûr pour les tests WebSocket (pas de restart sequences)
 * - Performance acceptable avec maxWorkers: 1
 *
 * ISOLATION:
 * - Supprime toutes les données métier entre tests
 * - Préserve les 2 users de seed (dev+admin@test.com, dev+rider@test.com)
 * - Ordre strict pour respecter les foreign keys
 *
 * CONFIGURATION:
 * - TEST_DB_RESET_DEBUG=true : Affiche logs détaillés
 * - TEST_DB_RESET=false : Désactive le reset (debug uniquement)
 */

import { clientPrisma as prisma } from '@blobinfini/database';

/**
 * Liste des tables à nettoyer (ordre important pour FK)
 *
 * Ordre: enfants → parents
 * - Message dépend de Conversation
 * - ConversationMember dépend de Conversation
 * - Conversation dépend de User
 * - Booking dépend de BookingRequest
 * - Match dépend de User
 * - Profiles dépendent de User
 * - User en dernier (sauf les 2 seeds)
 */
const CLEANUP_ORDER = [
  'message',
  'conversationMember',
  'conversation',
  'matchDecision',
  'match',
  'booking',
  'bookingRequest',
  'proAvailability',
  'lastSearch',
  'riderDiscipline',
  'proOffer',
  'profileReport',
  'passwordResetToken',
  'emailVerificationToken',
  'session',
  'refreshToken',
  'adminProfile',
  'riderProfile',
  'proProfile',
  'user' // Spécial: préserve les seeds
] as const;

/**
 * Emails des users de seed à préserver
 */
const SEED_USER_EMAILS = [
  'dev+admin@test.com',
  'dev+rider@test.com'
] as const;

/**
 * Reset la DB entre les tests
 *
 * @returns Nombre de records supprimés (pour logs debug)
 */
export async function resetDb(): Promise<number> {
  // Allow disabling reset for debugging
  if (process.env.TEST_DB_RESET === 'false') {
    if (process.env.TEST_DB_RESET_DEBUG === 'true') {
      console.log('⏸️  [resetDb] Skipped (TEST_DB_RESET=false)');
    }
    return 0;
  }

  const debug = process.env.TEST_DB_RESET_DEBUG === 'true';
  let totalDeleted = 0;

  try {
    if (debug) {
      console.log('♻️  [resetDb] Starting cleanup...');
    }

    // Cleanup dans l'ordre strict
    for (const table of CLEANUP_ORDER) {
      let deleted = 0;

      // Cas spécial: User (préserver les seeds)
      if (table === 'user') {
        const result = await prisma.user.deleteMany({
          where: {
            email: {
              notIn: [...SEED_USER_EMAILS]
            }
          }
        });
        deleted = result.count;
      } else {
        // Tables standards: tout supprimer
        const result = await (prisma[table] as any).deleteMany({});
        deleted = result.count;
      }

      totalDeleted += deleted;

      if (debug && deleted > 0) {
        console.log(`   ✓ ${table}: ${deleted} deleted`);
      }
    }

    if (debug) {
      console.log(`♻️  [resetDb] Complete (${totalDeleted} total deleted)`);
    }

    return totalDeleted;

  } catch (error) {
    // Non-fatal: logger mais ne pas faire échouer le test
    console.error('⚠️  [resetDb] Cleanup error (non-fatal):', error);
    return 0;
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
