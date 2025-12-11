-- Remove blobosphereContributor column as feature is being discontinued
ALTER TABLE "RiderProfile"
  DROP COLUMN IF EXISTS "blobosphereContributor";
