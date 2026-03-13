-- Create ConsentLevel enum
CREATE TYPE "ConsentLevel" AS ENUM ('personalized', 'npa', 'limited', 'none');

-- Create ConsentSignal enum
CREATE TYPE "ConsentSignal" AS ENUM ('granted', 'denied');

-- Create UserConsent table for CMP consent storage
CREATE TABLE "UserConsent" (
    "id"                 TEXT NOT NULL,
    "userHash"           TEXT NOT NULL,
    "consentLevel"       "ConsentLevel" NOT NULL,
    "ad_storage"         "ConsentSignal" NOT NULL,
    "ad_user_data"       "ConsentSignal" NOT NULL,
    "ad_personalization" "ConsentSignal" NOT NULL,
    "cmpVersion"         TEXT,
    "tokenExpiresAt"     TIMESTAMP(3),
    "tokenUsedAt"        TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on userHash (one consent record per user hash)
CREATE UNIQUE INDEX "UserConsent_userHash_key" ON "UserConsent"("userHash");

-- Indexes for purge jobs
CREATE INDEX "UserConsent_updatedAt_idx" ON "UserConsent"("updatedAt");
CREATE INDEX "UserConsent_tokenExpiresAt_idx" ON "UserConsent"("tokenExpiresAt");
