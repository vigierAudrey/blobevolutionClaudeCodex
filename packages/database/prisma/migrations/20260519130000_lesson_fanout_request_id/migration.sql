-- AlterTable: ajouter lessonRequestId pour dédupliquer les fanouts d'une même demande.
-- sha256(riderId + UTC-date)[:16] — grouper les fanouts du même rider-jour.
-- Nullable : les lignes antérieures (aucune en pratique, table créée aujourd'hui)
-- ne sont pas affectées.
ALTER TABLE "LessonFanout" ADD COLUMN "lessonRequestId" TEXT;

-- Index couvrant sur lessonRequestId pour COUNT(DISTINCT) efficace.
CREATE INDEX "LessonFanout_lessonRequestId_idx" ON "LessonFanout"("lessonRequestId");
