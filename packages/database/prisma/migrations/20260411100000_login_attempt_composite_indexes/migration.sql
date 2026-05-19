-- Migration: LoginAttempt — composite indexes + drop unused single-column indexes
--
-- STRATEGY (production safety):
--   Step 1 — Create new composite indexes FIRST (queries still use old indexes during this window).
--   Step 2 — Drop old single-column indexes (now covered by composites or fully unused).
--
-- WARNING — CONCURRENTLY:
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
--   Prisma runs migrations in a transaction by default.
--   For production on a large table (>1M rows), apply this migration with:
--     BEGIN; ... COMMIT; disabled, i.e. run the SQL statements manually outside a transaction.
--   For dev/test (small tables), the standard migration transaction is fine.
--
-- The DDL below uses plain CREATE INDEX (transaction-safe) for Prisma compatibility.
-- For production, replace with CONCURRENTLY variant run outside a transaction:
--   CREATE INDEX CONCURRENTLY "LoginAttempt_success_createdAt_idx" ON "LoginAttempt" (success, "createdAt" DESC);
--   etc.

-- Step 1: Create composite indexes (covering actual query patterns)

-- Main admin list query: WHERE success = [bool] ORDER BY createdAt DESC
CREATE INDEX "LoginAttempt_success_createdAt_idx"
  ON "LoginAttempt" (success, "createdAt" DESC);

-- suspiciousOnly GROUP BY: WHERE success = false AND createdAt >= J-1 AND ipHash IS NOT NULL
CREATE INDEX "LoginAttempt_success_ipHash_createdAt_idx"
  ON "LoginAttempt" (success, "ipHash", "createdAt" DESC);

-- suspiciousOnly GROUP BY: WHERE success = false AND createdAt >= J-1 AND emailHash IS NOT NULL
CREATE INDEX "LoginAttempt_success_emailHash_createdAt_idx"
  ON "LoginAttempt" (success, "emailHash", "createdAt" DESC);

-- Step 2: Drop old single-column indexes (unused or now covered by composites above)

-- email: always NULL in production (RGPD design) — pure write overhead
DROP INDEX IF EXISTS "LoginAttempt_email_idx";

-- emailHash: covered by (success, emailHash, createdAt)
DROP INDEX IF EXISTS "LoginAttempt_emailHash_idx";

-- ip: always NULL in production (RGPD design) — pure write overhead
DROP INDEX IF EXISTS "LoginAttempt_ip_idx";

-- ipHash: covered by (success, ipHash, createdAt)
DROP INDEX IF EXISTS "LoginAttempt_ipHash_idx";

-- createdAt: covered by composite indexes above
DROP INDEX IF EXISTS "LoginAttempt_createdAt_idx";

-- success: covered by composite indexes above
DROP INDEX IF EXISTS "LoginAttempt_success_idx";
