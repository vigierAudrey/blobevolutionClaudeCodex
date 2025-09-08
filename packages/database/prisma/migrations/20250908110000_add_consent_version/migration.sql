-- Add consentVersion to track which wording/version was accepted
ALTER TABLE "User" ADD COLUMN "consentVersion" TEXT;

