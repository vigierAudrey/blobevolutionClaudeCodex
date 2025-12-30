-- CreateTable
CREATE TABLE "NotificationPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
    "notifyMatches" BOOLEAN NOT NULL DEFAULT true,
    "notifyInvitations" BOOLEAN NOT NULL DEFAULT true,
    "notifyLessonRequests" BOOLEAN NOT NULL DEFAULT true,
    "notifyBookingAccepted" BOOLEAN NOT NULL DEFAULT true,
    "notifyBookingRejected" BOOLEAN NOT NULL DEFAULT true,
    "notifyProMessages" BOOLEAN NOT NULL DEFAULT true,
    "notifyForSurf" BOOLEAN NOT NULL DEFAULT true,
    "notifyForKitesurf" BOOLEAN NOT NULL DEFAULT true,
    "emailDigestFrequency" TEXT NOT NULL DEFAULT 'NEVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreferences_userId_idx" ON "NotificationPreferences"("userId");

-- AddForeignKey
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing emailNotif values from RiderProfile and ProProfile
INSERT INTO "NotificationPreferences" ("id", "userId", "emailEnabled", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    "userId",
    "emailNotif",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "RiderProfile"
WHERE "userId" NOT IN (SELECT "userId" FROM "NotificationPreferences")
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "NotificationPreferences" ("id", "userId", "emailEnabled", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    "userId",
    "emailNotif",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ProProfile"
WHERE "userId" NOT IN (SELECT "userId" FROM "NotificationPreferences")
ON CONFLICT ("userId") DO NOTHING;

-- Note: Don't drop emailNotif columns yet, will do in separate migration after verification
