-- AlterTable: rendre lessonRequestId obligatoire.
-- Contexte : table créée hier (20260519), aucune donnée de production existante.
-- COUNT(DISTINCT lessonRequestId) doit toujours avoir une valeur — un NULL
-- serait silencieusement ignoré et ferait disparaître la demande des métriques.
ALTER TABLE "LessonFanout" ALTER COLUMN "lessonRequestId" SET NOT NULL;
