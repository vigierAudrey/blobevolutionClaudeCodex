-- Fix LegalConsentArchive column types to match Prisma schema.prisma.
-- Migration 20251110150000 created the table with VARCHAR(N)/TIMESTAMP; Prisma
-- expects TEXT (String) and TIMESTAMP(3) (DateTime). This migration aligns them.
-- VARCHAR→TEXT and TIMESTAMP→TIMESTAMP(3) are safe casts in PostgreSQL (no data loss).

ALTER TABLE "LegalConsentArchive"
  ALTER COLUMN "originalUserId" TYPE TEXT,
  ALTER COLUMN "consentVersion" TYPE TEXT,
  ALTER COLUMN "consentIpHash"  TYPE TEXT,
  ALTER COLUMN "consentedAt"    TYPE TIMESTAMP(3),
  ALTER COLUMN "deletedAt"      TYPE TIMESTAMP(3),
  ALTER COLUMN "archivedAt"     TYPE TIMESTAMP(3);
