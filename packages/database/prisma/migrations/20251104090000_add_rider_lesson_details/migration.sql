-- Ensure rider lesson planning fields exist
ALTER TABLE "RiderProfile"
  ADD COLUMN IF NOT EXISTS "lessonLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "lessonDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lessonPlace" TEXT;
