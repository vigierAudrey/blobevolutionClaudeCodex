-- Migration: add ipHash to LoginAttempt
-- HMAC-SHA256 hash of the client IP for RGPD-compliant login attempt audit
-- The raw IP can be purged while the hash is retained for security investigations
ALTER TABLE "LoginAttempt" ADD COLUMN IF NOT EXISTS "ipHash" TEXT;

CREATE INDEX IF NOT EXISTS "LoginAttempt_ipHash_idx" ON "LoginAttempt"("ipHash");
