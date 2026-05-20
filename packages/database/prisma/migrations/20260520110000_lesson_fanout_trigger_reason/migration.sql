-- Ajout triggerReason (nullable) sur LessonFanout.
-- Raison : distinguer ACTIVATED / LOCATION_CHANGED / SPORT_CHANGED / MANUAL
-- en dashboard admin, sans donnée de rétro-compatibilité (NULL = fanout antérieur au sprint).
-- Nullable intentionnel : les lignes existantes (avant ce sprint) valent NULL.
ALTER TABLE "LessonFanout" ADD COLUMN "triggerReason" TEXT;
