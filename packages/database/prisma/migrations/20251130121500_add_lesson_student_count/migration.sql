-- Allow riders to indiquer le nombre d'élèves souhaité pour un cours
ALTER TABLE "RiderProfile"
  ADD COLUMN IF NOT EXISTS "lessonStudentCount" INTEGER DEFAULT 1;
