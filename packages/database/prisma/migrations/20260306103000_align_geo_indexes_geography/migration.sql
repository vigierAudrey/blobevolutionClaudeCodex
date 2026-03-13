-- Align geospatial indexes with runtime queries that cast points to geography.
-- NOTE: Prisma migrations run in a transaction, so CREATE INDEX CONCURRENTLY is not applicable here.

DROP INDEX IF EXISTS "ProAvailability_geog_idx";
CREATE INDEX "ProAvailability_geog_idx"
ON "ProAvailability" USING GIST (
  (ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography)
)
WHERE "spotLat" IS NOT NULL AND "spotLng" IS NOT NULL;

DROP INDEX IF EXISTS "ProProfile_geog_idx";
CREATE INDEX "ProProfile_geog_idx"
ON "ProProfile" USING GIST (
  (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography)
)
WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

ANALYZE "ProAvailability";
ANALYZE "ProProfile";
