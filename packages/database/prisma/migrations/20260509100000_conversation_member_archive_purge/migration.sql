-- Migration: Add archivedAt + purgeAt to ConversationMember
-- Non-destructive: only adds nullable columns and indexes.
-- No data loss. No existing rows affected. Safe for production.
--
-- Business rules encoded by this migration:
--   archivedAt IS NULL  AND trashedAt IS NULL  => active
--   archivedAt IS NOT NULL AND trashedAt IS NULL => archived (auto after >100 actives, purge after 18 months)
--   trashedAt IS NOT NULL                        => trashed (user action, purge after 30 days)
--
-- DANGEROUS-DDL-APPROVED: ADD COLUMN on nullable column — zero table rewrite on PG 11+.
-- Existing rows implicitly get NULL for both columns (active state). No backfill needed.

-- 1. Add archivedAt column (nullable — NULL means not archived)
ALTER TABLE "ConversationMember"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- 2. Add purgeAt column (nullable — set on archive = now+18m, on trash = now+30d)
ALTER TABLE "ConversationMember"
  ADD COLUMN IF NOT EXISTS "purgeAt" TIMESTAMP(3);

-- 3. Composite index: hot-path for listing active conversations
--    WHERE userId = $1 AND archivedAt IS NULL AND trashedAt IS NULL
--    Also covers COUNT used by maybeAutoArchive.
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_archivedAt_idx"
  ON "ConversationMember"("userId", "archivedAt");

-- 4. Partial index for purge job: find all expired members across all users
--    WHERE purgeAt IS NOT NULL AND purgeAt <= $now
--    Partial (WHERE purgeAt IS NOT NULL) keeps index small — only archived/trashed rows.
CREATE INDEX IF NOT EXISTS "ConversationMember_purgeAt_idx"
  ON "ConversationMember"("purgeAt")
  WHERE "purgeAt" IS NOT NULL;
