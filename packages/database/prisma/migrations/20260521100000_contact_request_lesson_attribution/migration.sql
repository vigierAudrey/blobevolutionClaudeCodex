-- Ajout lessonRequestId (nullable) sur ContactRequest.
-- Raison : permettre la corrélation ContactRequest ↔ LessonFanout pour les métriques de conversion
-- des demandes de cours (Sprint C — fanout → contact attribution analytics).
-- Nullable intentionnel : les ContactRequest antérieures à ce sprint gardent NULL
-- et restent entièrement compatibles.
ALTER TABLE "ContactRequest" ADD COLUMN "lessonRequestId" TEXT;

-- Index pour les agrégats SQL du dashboard de conversion (COUNT / GROUP BY).
CREATE INDEX "ContactRequest_lessonRequestId_idx" ON "ContactRequest"("lessonRequestId");
