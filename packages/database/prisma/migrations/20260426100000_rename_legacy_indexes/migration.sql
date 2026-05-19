-- Rename legacy abbreviated index names from the booking module migration
-- (20250918_booking_module) to the Prisma-standard names that schema.prisma declares.
-- These were missed in the earlier rename pass (20250913075337) because the booking
-- module was added after that migration.
-- Using ALTER INDEX … RENAME TO (atomic, no lock escalation, no data loss).

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

ALTER INDEX "Booking_availability_idx"  RENAME TO "Booking_availabilityId_idx";
ALTER INDEX "Booking_rider_idx"         RENAME TO "Booking_riderUserId_idx";

-- ---------------------------------------------------------------------------
-- BookingRequest
-- ---------------------------------------------------------------------------

ALTER INDEX "BookingRequest_availability_idx" RENAME TO "BookingRequest_availabilityId_idx";
ALTER INDEX "BookingRequest_rider_idx"        RENAME TO "BookingRequest_riderUserId_idx";
ALTER INDEX "BookingRequest_unique_pending"   RENAME TO "BookingRequest_riderUserId_availabilityId_status_key";

-- ---------------------------------------------------------------------------
-- ProAvailability — UNIQUE TABLE CONSTRAINT (created via CONSTRAINT clause in
-- 20250918_booking_module). ALTER INDEX renames the backing index but leaves the
-- pg_constraint row with the old name, causing Prisma migrate diff to see residual
-- drift. ALTER TABLE … RENAME CONSTRAINT renames the constraint (and its backing
-- index together) atomically in PostgreSQL — no lock escalation, no data change.
-- ---------------------------------------------------------------------------

ALTER TABLE "ProAvailability"
  RENAME CONSTRAINT "ProAvailability_unique_slot"
  TO "ProAvailability_proUserId_startAt_endAt_key";
