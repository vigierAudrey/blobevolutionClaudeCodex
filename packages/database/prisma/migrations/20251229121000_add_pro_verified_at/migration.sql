-- Track when a pro profile becomes verified (TTFV reference)
ALTER TABLE "ProProfile" ADD COLUMN "verifiedAt" TIMESTAMPTZ;
