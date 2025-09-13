-- Add lesson intent fields to RiderProfile
ALTER TABLE "RiderProfile"
  ADD COLUMN IF NOT EXISTS "wantsLesson" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lessonSport" TEXT;
