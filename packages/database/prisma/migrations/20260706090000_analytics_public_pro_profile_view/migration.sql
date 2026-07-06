-- AlterEnum: ajouter la valeur PUBLIC_PRO_PROFILE_VIEW
-- ALTER TYPE ... ADD VALUE est non-transactionnel en PostgreSQL ;
-- Prisma l'exécute hors transaction (comportement attendu).
ALTER TYPE "AnalyticsEventType" ADD VALUE 'PUBLIC_PRO_PROFILE_VIEW';
