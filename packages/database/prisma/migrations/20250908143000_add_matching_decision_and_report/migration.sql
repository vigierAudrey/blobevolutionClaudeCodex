-- Decision enum
DO $$ BEGIN
  CREATE TYPE "DecisionKind" AS ENUM ('ACCEPT','REFUSE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- MatchDecision table
CREATE TABLE "MatchDecision" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "targetProfileId" TEXT NOT NULL,
  "decision" "DecisionKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchDecision_actor_target_unique" ON "MatchDecision"("actorUserId","targetProfileId");
CREATE INDEX "MatchDecision_actor_idx" ON "MatchDecision"("actorUserId");
CREATE INDEX "MatchDecision_target_idx" ON "MatchDecision"("targetProfileId");

ALTER TABLE "MatchDecision" ADD CONSTRAINT "MatchDecision_actor_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchDecision" ADD CONSTRAINT "MatchDecision_target_fkey"
  FOREIGN KEY ("targetProfileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ProfileReport table
CREATE TABLE "ProfileReport" (
  "id" TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "reportedProfileId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfileReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProfileReport_reporter_idx" ON "ProfileReport"("reporterUserId");
CREATE INDEX "ProfileReport_reported_idx" ON "ProfileReport"("reportedProfileId");

ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_reporter_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_reported_fkey"
  FOREIGN KEY ("reportedProfileId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

