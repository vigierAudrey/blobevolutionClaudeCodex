-- Migration: add sessionVersion to User
-- Used to invalidate all access tokens on forced logout (session revocation)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 1;
