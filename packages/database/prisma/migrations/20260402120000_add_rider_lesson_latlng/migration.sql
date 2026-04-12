-- Dissociation localisation profil vs localisation demande de cours.
-- lessonLat/lessonLng = source de vérité pour le pin BloboMap Pro.
--
-- Décision legacy : mode strict immédiat.
-- Les riders existants avec wantsLesson=true mais sans lessonLat/lessonLng
-- ne sont PAS bloqués par la migration (colonnes nullable), mais leurs
-- demandes n'apparaîtront plus sur la map. C'est cohérent : les pins
-- étaient déjà brisés avant ce patch (lat/lng jamais exposés dans la
-- réponse API /pro/near/lessons).
--
-- Nouveaux appels avec wantsLesson=true sans coords → rejetés 400 par l'API.

ALTER TABLE "RiderProfile" ADD COLUMN "lessonLat" DOUBLE PRECISION;
ALTER TABLE "RiderProfile" ADD COLUMN "lessonLng" DOUBLE PRECISION;

-- CHECK both-or-none au niveau DB (défense en profondeur).
-- Empêche les inserts/updates directs (migrations, scripts) qui fourniraient
-- une seule des deux colonnes. L'API enforces déjà cette règle via Zod,
-- mais la contrainte DB reste la dernière ligne de défense.
ALTER TABLE "RiderProfile"
  ADD CONSTRAINT "lesson_coords_both_or_none"
  CHECK (("lessonLat" IS NULL) = ("lessonLng" IS NULL));

-- Index GIST partiel sur le lieu de cours.
-- Le prédicat inclut wantsLesson=true car la requête BloboMap a systématiquement
-- cette condition dans son WHERE. Un index partiel dont le prédicat est un
-- sous-ensemble du WHERE de la requête est utilisable par le planner.
-- Sans wantsLesson=true dans le prédicat, l'index serait plus large et moins
-- sélectif (indexerait des riders qui ne peuvent jamais être retournés).
CREATE INDEX "RiderProfile_lesson_geog_idx"
ON "RiderProfile" USING GIST (
  (ST_SetSRID(ST_MakePoint("lessonLng", "lessonLat"), 4326)::geography)
)
WHERE "wantsLesson" = true
  AND "lessonLat" IS NOT NULL
  AND "lessonLng" IS NOT NULL;

ANALYZE "RiderProfile";

-- ROLLBACK (manuel, à exécuter en cas d'incident) :
-- DROP INDEX IF EXISTS "RiderProfile_lesson_geog_idx";
-- ALTER TABLE "RiderProfile" DROP CONSTRAINT IF EXISTS "lesson_coords_both_or_none";
-- ALTER TABLE "RiderProfile" DROP COLUMN IF EXISTS "lessonLng";
-- ALTER TABLE "RiderProfile" DROP COLUMN IF EXISTS "lessonLat";
