import { prisma } from '@blobinfini/database';
import { execSync } from 'child_process';

let dbSetupDone = false;

beforeAll(async () => {
  if (dbSetupDone) return;

  try {
    // Push le schéma Prisma dans la base de test
    console.log('⏳ Setting up test database schema...');
    execSync('npm run db:generate', { stdio: 'inherit', cwd: process.cwd() + '/../..' });
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
    });
    console.log('✅ Database schema ready');

    dbSetupDone = true;
  } catch (error) {
    console.error('❌ Failed to setup database:', error);
    throw error;
  }
}, 60000); // Timeout de 60s pour le setup
