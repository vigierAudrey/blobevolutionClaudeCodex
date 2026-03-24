-- Migration: add_booking_cancelled_at
-- Adds nullable cancelledAt timestamp to Booking for audit/traceability.
-- Non-destructive: all existing rows get NULL (correct — no cancellation occurred yet).

ALTER TABLE "Booking" ADD COLUMN "cancelledAt" TIMESTAMP(3);
