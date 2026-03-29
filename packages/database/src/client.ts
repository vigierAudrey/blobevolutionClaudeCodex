import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Valide que DATABASE_URL contient sslmode=require en production
 * Conformité ROADMAP.md Phase 2: Database SSL obligatoire
 */
function validateDatabaseSSL(): void {
  // Exemptions : environnements Docker internes où postgres est sur un réseau
  // privé non exposé (172.20.0.0/16 pre-vps, 172.21.0.0/16 vps). SSL géré
  // par nginx TLS pour les connexions externes. Un VPS réel avec postgres
  // distant DOIT utiliser un APP_ENV différent (ex: 'production') et avoir sslmode.
  if (process.env.NODE_ENV === 'production' &&
      process.env.APP_ENV !== 'pre-vps' &&
      process.env.APP_ENV !== 'vps') {
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      throw new Error(
        'DATABASE_URL must be set in production environment'
      );
    }

    // Vérifier la présence de sslmode=require dans l'URL
    const hasSSLMode = dbUrl.includes('sslmode=require') || dbUrl.includes('sslmode=verify-full');

    if (!hasSSLMode) {
      throw new Error(
        'DATABASE_URL must include "?sslmode=require" (or sslmode=verify-full) in production to enforce encrypted connections.\n' +
        'Current DATABASE_URL does not enforce SSL.\n' +
        'Example: postgresql://user:pass@host:5432/db?sslmode=require'
      );
    }

    console.log('[Database] SSL mode validated: connection will be encrypted');
  }
}

// Valider avant d'instancier le client
validateDatabaseSSL();

export const clientPrisma =
  globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn']
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = clientPrisma;

export default clientPrisma;
