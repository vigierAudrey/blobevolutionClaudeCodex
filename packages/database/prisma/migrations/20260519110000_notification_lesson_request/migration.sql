-- AlterEnum: ajouter la valeur LESSON_REQUEST_NEARBY
-- ALTER TYPE ... ADD VALUE est non-transactionnel en PostgreSQL ;
-- Prisma l'exécute hors transaction (comportement attendu).
ALTER TYPE "NotificationType" ADD VALUE 'LESSON_REQUEST_NEARBY';

-- AlterTable: champ data JSONB optionnel pour les métadonnées de notification
ALTER TABLE "Notification" ADD COLUMN "data" JSONB;
