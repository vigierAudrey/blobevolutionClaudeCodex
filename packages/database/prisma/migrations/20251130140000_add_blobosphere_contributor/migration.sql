-- Allow riders to indiquer s'ils souhaitent contribuer à la Blobosphère
ALTER TABLE "RiderProfile"
  ADD COLUMN IF NOT EXISTS "blobosphereContributor" BOOLEAN NOT NULL DEFAULT false;
