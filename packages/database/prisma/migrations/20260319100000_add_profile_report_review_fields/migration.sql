-- F07: Add review fields to ProfileReport
-- Purpose: replace hard-delete on moderation with soft-review to preserve audit trail
--          and enable accurate pending-only counters.
-- Safety: all three columns are nullable → zero impact on existing rows (all become pending=reviewedAt IS NULL).

ALTER TABLE "ProfileReport"
  ADD COLUMN "reviewedAt"        TIMESTAMP(3),
  ADD COLUMN "reviewedByAdminId" TEXT,
  ADD COLUMN "reviewedAction"    TEXT;

CREATE INDEX "ProfileReport_reviewedAt_idx" ON "ProfileReport"("reviewedAt");
