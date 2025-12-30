-- Analytics events + daily aggregates (RGPD-safe)
DO $$ BEGIN
  CREATE TYPE "AnalyticsActorType" AS ENUM ('ANON', 'RIDER', 'PRO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnalyticsEventType" AS ENUM (
    'RIDER_SEARCH_PROS',
    'RIDER_BOOKING_REQUEST',
    'RIDER_MATCH_DECISION',
    'MESSAGE_SENT',
    'PRO_BOOKING_RESPONSE',
    'PRO_PROFILE_UPDATE',
    'PRO_SLOTS_UPDATE',
    'PRO_DASHBOARD_OPEN',
    'BLOBOSPHERE_VIEW',
    'BLOBOSPHERE_OUTBOUND',
    'BLOBOSPHERE_SIGNUP'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "AnalyticsEvent" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "actorType" "AnalyticsActorType" NOT NULL,
  "actorHash" TEXT,
  "eventType" "AnalyticsEventType" NOT NULL,
  "contentId" TEXT,
  "sport" "Sport",
  "zoneLarge" TEXT,
  "metadata" JSONB,
  "consented" BOOLEAN NOT NULL DEFAULT false,
  "dedupeKey" TEXT UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent" ("occurredAt");
CREATE INDEX "AnalyticsEvent_actorType_idx" ON "AnalyticsEvent" ("actorType");
CREATE INDEX "AnalyticsEvent_actorHash_idx" ON "AnalyticsEvent" ("actorHash");
CREATE INDEX "AnalyticsEvent_eventType_idx" ON "AnalyticsEvent" ("eventType");
CREATE INDEX "AnalyticsEvent_contentId_idx" ON "AnalyticsEvent" ("contentId");
CREATE INDEX "AnalyticsEvent_sport_idx" ON "AnalyticsEvent" ("sport");
CREATE INDEX "AnalyticsEvent_zoneLarge_idx" ON "AnalyticsEvent" ("zoneLarge");

CREATE TABLE "AnalyticsDailyAgg" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "day" TIMESTAMPTZ NOT NULL,
  "actorType" "AnalyticsActorType" NOT NULL,
  "eventType" "AnalyticsEventType" NOT NULL,
  "contentId" TEXT,
  "sport" "Sport",
  "zoneLarge" TEXT,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_zoneLarge_key"
  ON "AnalyticsDailyAgg" ("day", "actorType", "eventType", "contentId", "sport", "zoneLarge");

CREATE INDEX "AnalyticsDailyAgg_day_idx" ON "AnalyticsDailyAgg" ("day");
CREATE INDEX "AnalyticsDailyAgg_actorType_idx" ON "AnalyticsDailyAgg" ("actorType");
CREATE INDEX "AnalyticsDailyAgg_eventType_idx" ON "AnalyticsDailyAgg" ("eventType");
CREATE INDEX "AnalyticsDailyAgg_contentId_idx" ON "AnalyticsDailyAgg" ("contentId");
CREATE INDEX "AnalyticsDailyAgg_sport_idx" ON "AnalyticsDailyAgg" ("sport");
CREATE INDEX "AnalyticsDailyAgg_zoneLarge_idx" ON "AnalyticsDailyAgg" ("zoneLarge");
