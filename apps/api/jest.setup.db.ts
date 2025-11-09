import { clientPrisma as prisma } from '@blobinfini/database';
import { execSync } from 'child_process';
import path from 'node:path';

let dbSetupDone = false;
const repoRoot = path.resolve(__dirname, '..', '..');

// Touch Prisma client to satisfy no-unused-locals and ensure singleton initialises when tests run.
void prisma;

beforeAll(async () => {
  if (dbSetupDone) return;

  try {
    // Push le schéma Prisma dans la base de test
    console.log('⏳ Setting up test database schema...');
    // Générer le client Prisma
    execSync('npm run generate --workspace @blobinfini/database', {
      stdio: 'inherit',
      cwd: repoRoot
    });
    // Pusher le schéma vers la DB de test
    execSync('npm run db:push --workspace @blobinfini/database', {
      stdio: 'inherit',
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL
      }
    });
    console.log('✅ Database schema ready');

    dbSetupDone = true;
  } catch (error) {
    console.error('❌ Failed to setup database:', error);
    throw error;
  }
}, 60000); // Timeout de 60s pour le setup

// ⚠️ CLEANUP : Nettoyer les données entre chaque test pour éviter les contraintes uniques
// MAIS : certains tests (comme anti-overbooking.test.ts) gèrent leur propre cleanup
// avec des users créés dans beforeAll(). Pour ces tests, on skip le cleanup global.
afterEach(async () => {
  // Skip cleanup si le test gère son propre cycle de vie
  const testPath = expect.getState().testPath || '';
  const skipCleanupPatterns: string[] = [];

  const shouldSkipCleanup = skipCleanupPatterns.some(pattern => testPath.includes(pattern));

  if (shouldSkipCleanup) {
    // Le test gère son propre cleanup, on ne fait rien
    return;
  }

  // Cleanup standard : ordre important pour respecter les foreign keys
  // Supprimer d'abord les dépendances (enfants), puis les parents
  try {
    await prisma.message.deleteMany({});
    await prisma.conversationMember.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.matchDecision.deleteMany({});
    await prisma.match.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.bookingRequest.deleteMany({});
    await prisma.proAvailability.deleteMany({});
    await prisma.lastSearch.deleteMany({});
    await prisma.riderDiscipline.deleteMany({});
    await prisma.proOffer.deleteMany({});
    await prisma.profileReport.deleteMany({});
    await prisma.passwordResetToken.deleteMany({});
    await prisma.emailVerificationToken.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.adminProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.user.deleteMany({});
  } catch (error) {
    // En cas d'erreur de cleanup, logger mais ne pas faire échouer le test
    console.error('⚠️  Cleanup error (non-fatal):', error);
  }
});
