-- Champ archivedByPro sur ContactRequest (Sprint C20).
-- Préférence UI du pro pour masquer les demandes traitées de sa vue active.
-- N'affecte pas le status métier (PENDING/ACCEPTED/REJECTED) ni les analytics.
-- NOT NULL DEFAULT false : aucun backfill, toutes les lignes existantes passent à false.
-- Opération purement additive — aucune perte de données possible.
ALTER TABLE "ContactRequest" ADD COLUMN "archivedByPro" BOOLEAN NOT NULL DEFAULT false;

-- Index composite (proUserId, archivedByPro, createdAt DESC) pour le hot path complet :
--   WHERE proUserId = $1 AND archivedByPro = $2 ORDER BY createdAt DESC
-- Les trois colonnes couvrent filtre + tri en un seul index-scan — pas de sort séparé
-- quand les demandes grossissent (un pro actif peut accumuler des centaines de lignes).
CREATE INDEX "ContactRequest_proUserId_archivedByPro_createdAt_idx"
  ON "ContactRequest"("proUserId", "archivedByPro", "createdAt" DESC);
