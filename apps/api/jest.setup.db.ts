import { prisma } from '@blobinfini/database';
import { execSync } from 'child_process';
import path from 'node:path';

let dbSetupDone = false;
const repoRoot = path.resolve(__dirname, '..', '..');

beforeAll(async () => {
  if (dbSetupDone) return;

  try {
    // Push le schéma Prisma dans la base de test
    console.log('⏳ Setting up test database schema...');
    execSync('npm run db:generate', {
      stdio: 'inherit',
      cwd: repoRoot
    });
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
