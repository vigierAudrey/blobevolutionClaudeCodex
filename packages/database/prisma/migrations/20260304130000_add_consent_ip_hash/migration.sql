-- Migration: add consentIpHash to User
-- HMAC-SHA256 hash of consentIp for RGPD-compliant consent audit trail
-- The raw IP (consentIp) can be purged while the hash is retained for legal proof
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "consentIpHash" TEXT;
