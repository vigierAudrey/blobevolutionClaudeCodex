-- Create legal consent archive table for PostgreSQL
CREATE TABLE "LegalConsentArchive" (
    "id" SERIAL PRIMARY KEY,
    "originalUserId" VARCHAR(255) NOT NULL,
    "consentedAt" TIMESTAMP NULL,
    "consentVersion" VARCHAR(50),
    "consentIpHash" VARCHAR(64),
    "deletedAt" TIMESTAMP NOT NULL,
    "archivedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "LegalConsentArchive_originalUserId_deletedAt_key"
    ON "LegalConsentArchive" ("originalUserId", "deletedAt");

CREATE INDEX "LegalConsentArchive_originalUserId_idx"
    ON "LegalConsentArchive" ("originalUserId");

CREATE INDEX "LegalConsentArchive_consentedAt_idx"
    ON "LegalConsentArchive" ("consentedAt");

CREATE INDEX "LegalConsentArchive_archivedAt_idx"
    ON "LegalConsentArchive" ("archivedAt");
