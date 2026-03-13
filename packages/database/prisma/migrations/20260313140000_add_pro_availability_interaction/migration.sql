-- Create InteractionType enum
CREATE TYPE "InteractionType" AS ENUM ('VIEW', 'CLICK', 'REQUEST', 'BOOKING');

-- Create ProAvailabilityInteraction table for tracking rider interactions with pro availabilities
CREATE TABLE "ProAvailabilityInteraction" (
    "id"             TEXT NOT NULL,
    "availabilityId" TEXT NOT NULL,
    "riderUserId"    TEXT NOT NULL,
    "eventType"      "InteractionType" NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProAvailabilityInteraction_pkey" PRIMARY KEY ("id")
);

-- Add unique constraint (one event type per rider per availability)
CREATE UNIQUE INDEX "ProAvailabilityInteraction_availabilityId_riderUserId_eventType_key"
    ON "ProAvailabilityInteraction"("availabilityId", "riderUserId", "eventType");

-- Add indexes
CREATE INDEX "ProAvailabilityInteraction_availabilityId_idx" ON "ProAvailabilityInteraction"("availabilityId");
CREATE INDEX "ProAvailabilityInteraction_riderUserId_idx" ON "ProAvailabilityInteraction"("riderUserId");
CREATE INDEX "ProAvailabilityInteraction_eventType_idx" ON "ProAvailabilityInteraction"("eventType");

-- Add foreign keys
ALTER TABLE "ProAvailabilityInteraction"
    ADD CONSTRAINT "ProAvailabilityInteraction_availabilityId_fkey"
    FOREIGN KEY ("availabilityId") REFERENCES "ProAvailability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProAvailabilityInteraction"
    ADD CONSTRAINT "ProAvailabilityInteraction_riderUserId_fkey"
    FOREIGN KEY ("riderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
