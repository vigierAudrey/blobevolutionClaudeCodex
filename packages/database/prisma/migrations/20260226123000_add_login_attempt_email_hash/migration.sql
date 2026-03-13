-- RGPD hardening: avoid plaintext email persistence in LoginAttempt (production path uses emailHash only)
ALTER TABLE "LoginAttempt" ADD COLUMN "emailHash" TEXT;

ALTER TABLE "LoginAttempt" ALTER COLUMN "email" DROP NOT NULL;

CREATE INDEX "LoginAttempt_emailHash_idx" ON "LoginAttempt"("emailHash");
