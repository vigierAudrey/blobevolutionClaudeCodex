-- Create table for user disciplines (sport + level)
CREATE TABLE "RiderDiscipline" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "sport" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RiderDiscipline_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "RiderDiscipline_profileId_idx" ON "RiderDiscipline"("profileId");
CREATE INDEX "RiderDiscipline_sport_level_idx" ON "RiderDiscipline"("sport", "level");

-- FK
ALTER TABLE "RiderDiscipline" ADD CONSTRAINT "RiderDiscipline_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

