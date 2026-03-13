-- Migration: add credentialsVersion to User
-- Used to invalidate destructive step-up proofs after password rotation.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "credentialsVersion" INTEGER NOT NULL DEFAULT 1;
