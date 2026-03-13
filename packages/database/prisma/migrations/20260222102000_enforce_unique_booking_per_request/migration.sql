-- Enforce invariant: a BookingRequest can produce at most one Booking
ALTER TABLE "Booking"
  ADD COLUMN "bookingRequestId" TEXT;

CREATE UNIQUE INDEX "Booking_bookingRequestId_key"
  ON "Booking"("bookingRequestId");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_bookingRequestId_fkey"
  FOREIGN KEY ("bookingRequestId") REFERENCES "BookingRequest"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
