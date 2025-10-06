-- Ajout d'indexes PostGIS pour optimiser les requêtes géospatiales
-- Migration: 20250921000000_add_postgis_indexes

-- Index géospatial GIST pour ProAvailability (spots de cours)
-- Optimise les requêtes ST_DWithin dans booking.repository.ts
CREATE INDEX IF NOT EXISTS "ProAvailability_geog_idx"
ON "ProAvailability" USING GIST (
  ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)
) WHERE "spotLat" IS NOT NULL AND "spotLng" IS NOT NULL;

-- Index géospatial GIST pour ProOffer (offres géolocalisées)
-- Optimise les recherches d'offres par localisation
CREATE INDEX IF NOT EXISTS "ProOffer_geog_idx"
ON "ProOffer" USING GIST (
  ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)
);

-- Index géospatial GIST pour ProProfile (position des pros)
-- Optimise les recherches de pros par géolocalisation
CREATE INDEX IF NOT EXISTS "ProProfile_geog_idx"
ON "ProProfile" USING GIST (
  ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)
) WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

-- Index géospatial GIST pour LastSearch (cache des recherches)
-- Optimise les recherches récurrentes par géolocalisation
CREATE INDEX IF NOT EXISTS "LastSearch_geog_idx"
ON "LastSearch" USING GIST (
  ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)
) WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

-- Suppression de l'index B-tree composite sur ProOffer (remplacé par GIST)
DROP INDEX IF EXISTS "ProOffer_lat_lng_idx";

-- Statistiques pour l'optimiseur de requêtes PostgreSQL
ANALYZE "ProAvailability";
ANALYZE "ProOffer";
ANALYZE "ProProfile";
ANALYZE "LastSearch";