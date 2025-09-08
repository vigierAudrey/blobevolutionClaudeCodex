-- Speed up ST_DWithin/ST_DistanceSphere queries using a geography index
CREATE INDEX "RiderProfile_geog_idx" ON "RiderProfile" USING GIST (
  (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography)
);

