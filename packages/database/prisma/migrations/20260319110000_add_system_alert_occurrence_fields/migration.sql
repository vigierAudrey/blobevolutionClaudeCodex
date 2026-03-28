-- Migration: add occurrence tracking fields to SystemAlert
-- Backward-safe: existing rows receive default values (occurrenceCount=1, timestamps=creation/update time)

ALTER TABLE "SystemAlert"
  ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "firstSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: align firstSeenAt/lastSeenAt with actual creation/update dates for existing rows
UPDATE "SystemAlert"
SET "firstSeenAt" = "createdAt",
    "lastSeenAt"  = "updatedAt";
