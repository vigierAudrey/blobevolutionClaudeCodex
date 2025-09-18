-- Booking module schema

CREATE TYPE "AvailabilityStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "BookingRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED_RIDER', 'CANCELLED_PRO');

CREATE TABLE "ProAvailability" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "proUserId"    TEXT NOT NULL,
  "sport"        "Sport" NOT NULL,
  "levels"       TEXT[] NOT NULL,
  "startAt"      TIMESTAMPTZ NOT NULL,
  "endAt"        TIMESTAMPTZ NOT NULL,
  "capacity"     INTEGER NOT NULL DEFAULT 1,
  "bookedCount"  INTEGER NOT NULL DEFAULT 0,
  "status"       "AvailabilityStatus" NOT NULL DEFAULT 'OPEN',
  "spotName"     TEXT,
  "spotLat"      DOUBLE PRECISION,
  "spotLng"      DOUBLE PRECISION,
  "price"        DECIMAL(8,2),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProAvailability_proUserId_fkey"
    FOREIGN KEY ("proUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "ProAvailability_unique_slot"
    UNIQUE ("proUserId", "startAt", "endAt"),
  CONSTRAINT "ProAvailability_capacity_check"
    CHECK ("capacity" > 0 AND "bookedCount" >= 0)
);

CREATE TABLE "BookingRequest" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "riderUserId"    TEXT NOT NULL,
  "availabilityId" TEXT NOT NULL,
  "message"        TEXT,
  "status"         "BookingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "respondedAt"    TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "BookingRequest_riderUserId_fkey"
    FOREIGN KEY ("riderUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "BookingRequest_availabilityId_fkey"
    FOREIGN KEY ("availabilityId") REFERENCES "ProAvailability"("id") ON DELETE CASCADE
);

CREATE TABLE "Booking" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "availabilityId" TEXT NOT NULL,
  "riderUserId"    TEXT NOT NULL,
  "status"         "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Booking_availabilityId_fkey"
    FOREIGN KEY ("availabilityId") REFERENCES "ProAvailability"("id") ON DELETE CASCADE,
  CONSTRAINT "Booking_riderUserId_fkey"
    FOREIGN KEY ("riderUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "ProAvailability_proUserId_idx" ON "ProAvailability" ("proUserId");
CREATE INDEX "ProAvailability_sport_idx" ON "ProAvailability" ("sport");
CREATE INDEX "ProAvailability_startAt_idx" ON "ProAvailability" ("startAt");
CREATE INDEX "BookingRequest_rider_idx" ON "BookingRequest" ("riderUserId");
CREATE INDEX "BookingRequest_availability_idx" ON "BookingRequest" ("availabilityId");
CREATE INDEX "Booking_availability_idx" ON "Booking" ("availabilityId");
CREATE INDEX "Booking_rider_idx" ON "Booking" ("riderUserId");

-- prevent duplicate pending requests per rider / availability
CREATE UNIQUE INDEX "BookingRequest_unique_pending"
  ON "BookingRequest" ("riderUserId", "availabilityId", "status");

-- TODO: add trigger to cap bookedCount vs capacity (handled in service for now)
