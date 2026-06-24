-- Add in-app channel master switch to NotificationPreferences.
-- Defaults true so existing rows keep current behaviour (in-app always on).
ALTER TABLE "NotificationPreferences"
  ADD COLUMN "inAppEnabled" BOOLEAN NOT NULL DEFAULT true;
