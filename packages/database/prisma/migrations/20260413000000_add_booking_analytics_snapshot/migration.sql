-- Migration : BookingAnalyticsSnapshot
-- Objectif : stocker les métriques booking-dépendantes après gel, pour permettre
--            la suppression de BookingRequest et ProAvailability sans régression admin.
-- Non destructive : aucune table existante n'est modifiée.

CREATE TABLE "BookingAnalyticsSnapshot" (
  "id"                  TEXT NOT NULL,
  "period"              TEXT NOT NULL,
  "snapshotAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "frozen"              BOOLEAN NOT NULL DEFAULT false,
  -- TTFV Riders
  "ttfvRiderSampleSize" INTEGER NOT NULL DEFAULT 0,
  "ttfvRiderMedianMin"  DOUBLE PRECISION,
  "ttfvRiderP90Min"     DOUBLE PRECISION,
  "ttfvRiderMasked"     BOOLEAN NOT NULL DEFAULT true,
  -- TTFV Pros
  "ttfvProSampleSize"   INTEGER NOT NULL DEFAULT 0,
  "ttfvProMedianMin"    DOUBLE PRECISION,
  "ttfvProP90Min"       DOUBLE PRECISION,
  "ttfvProMasked"       BOOLEAN NOT NULL DEFAULT true,
  -- Marketplace JSON
  "marketplaceJson"     JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "BookingAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingAnalyticsSnapshot_period_key"
  ON "BookingAnalyticsSnapshot"("period");
