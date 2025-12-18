-- Track unique riders clicking on pro offers
CREATE TABLE "ProOfferClick" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "proOfferId" TEXT NOT NULL,
  "riderUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProOfferClick_proOfferId_fkey"
    FOREIGN KEY ("proOfferId") REFERENCES "ProOffer"("id") ON DELETE CASCADE,
  CONSTRAINT "ProOfferClick_riderUserId_fkey"
    FOREIGN KEY ("riderUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Ensure one row per rider/offer and accelerate lookups
CREATE UNIQUE INDEX "ProOfferClick_proOfferId_riderUserId_key"
  ON "ProOfferClick" ("proOfferId", "riderUserId");
CREATE INDEX "ProOfferClick_proOfferId_idx" ON "ProOfferClick" ("proOfferId");
