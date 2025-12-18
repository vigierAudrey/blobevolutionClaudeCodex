-- Supprime les doublons pour garantir une seule offre par profil pro
WITH ranked_offers AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "proProfileId" ORDER BY "createdAt" DESC, "id" DESC) AS row_num
  FROM "ProOffer"
)
DELETE FROM "ProOffer"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_offers
  WHERE row_num > 1
);

-- Contrainte d'unicité
ALTER TABLE "ProOffer"
ADD CONSTRAINT "ProOffer_proProfileId_key" UNIQUE ("proProfileId");
