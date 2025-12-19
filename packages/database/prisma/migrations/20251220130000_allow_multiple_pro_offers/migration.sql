-- Autorise plusieurs offres par profil pro (retrait de la contrainte d'unicité)
ALTER TABLE "ProOffer"
DROP CONSTRAINT IF EXISTS "ProOffer_proProfileId_key";

-- Réintroduit un index simple pour préserver les performances de filtrage
CREATE INDEX IF NOT EXISTS "ProOffer_proProfileId_idx"
ON "ProOffer"("proProfileId");
