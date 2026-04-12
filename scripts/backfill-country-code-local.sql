-- Backfill countryCode = 'FR' pour les ProProfile locaux sans countryCode.
--
-- CONTEXTE : migration 20260329110000_add_pro_profile_country_code a ajouté la colonne
-- en nullable. Les profils créés avant cette date n'ont pas de countryCode.
-- Toutes les coordonnées locales (seeds, tests manuels) sont dans le polygon France.
--
-- SÉCURITÉ : ce script est UNIQUEMENT destiné à la base locale de développement.
-- En production réelle, ne jamais inférer le pays depuis les coordonnées sans
-- confirmation explicite de l'utilisateur.
--
-- Usage :
--   psql $DATABASE_URL -f scripts/backfill-country-code-local.sql
--
-- Idempotent : ne touche que les lignes WHERE countryCode IS NULL.

BEGIN;

UPDATE "ProProfile"
SET "countryCode" = 'FR'
WHERE "countryCode" IS NULL
  AND "lat" IS NOT NULL
  AND "lng" IS NOT NULL;

-- Rapport
SELECT
  COUNT(*) FILTER (WHERE "countryCode" = 'FR')  AS "countryCode_FR",
  COUNT(*) FILTER (WHERE "countryCode" IS NULL)  AS "countryCode_null",
  COUNT(*)                                        AS "total"
FROM "ProProfile";

COMMIT;
