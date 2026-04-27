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
-- ProAvailability — implicit index backing the UNIQUE TABLE CONSTRAINT
-- (ALTER INDEX works on constraint-backed implicit indexes in PostgreSQL)
-- ---------------------------------------------------------------------------

ALTER INDEX "ProAvailability_unique_slot" RENAME TO "ProAvailability_proUserId_startAt_endAt_key";
