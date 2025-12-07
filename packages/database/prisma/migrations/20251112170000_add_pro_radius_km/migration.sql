-- Add radiusKm column to ProProfile with default 25 km
ALTER TABLE "ProProfile"
  ADD COLUMN IF NOT EXISTS "radiusKm" INTEGER NOT NULL DEFAULT 25;
