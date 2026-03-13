-- Migration: add notificationPreferences to ProProfile
-- JSON column for per-pro push/email notification granular config
-- Replaces the separate NotificationPreferences table for pro-specific settings
ALTER TABLE "ProProfile" ADD COLUMN IF NOT EXISTS "notificationPreferences" JSONB;
