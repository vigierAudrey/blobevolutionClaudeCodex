-- Migration : BookingLegalArchive
-- Archive légale minimale des bookings, indépendante des cascades User/Pro/Availability.
-- Conservée 10 ans. Aucune FK active. PII exclues (hashes pseudonymisés).
-- RGPD : Art. 5.1.e (conservation limitée) + obligation comptable Art. L123-22 Code commerce.

CREATE TABLE "BookingLegalArchive" (
    "id"           TEXT         NOT NULL,
    "bookingId"    TEXT         NOT NULL,
    "riderHash"    TEXT         NOT NULL,
    "proHash"      TEXT         NOT NULL,
    "sport"        "Sport"      NOT NULL,
    "bookedAt"     TIMESTAMP(3) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL,
    "closedAt"     TIMESTAMP(3) NOT NULL,
    "finalStatus"  TEXT         NOT NULL,
    "priceDecimal" DECIMAL(8,2),
    "archivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingLegalArchive_pkey" PRIMARY KEY ("id")
);

-- Unicité sur bookingId pour garantir l'idempotence des inserts
CREATE UNIQUE INDEX "BookingLegalArchive_bookingId_key"
    ON "BookingLegalArchive"("bookingId");

-- Index pour les requêtes de recherche par partie
CREATE INDEX "BookingLegalArchive_riderHash_idx"
    ON "BookingLegalArchive"("riderHash");

CREATE INDEX "BookingLegalArchive_proHash_idx"
    ON "BookingLegalArchive"("proHash");

-- Index pour le job de purge automatique (purgeAt)
CREATE INDEX "BookingLegalArchive_purgeAt_idx"
    ON "BookingLegalArchive"("purgeAt");

CREATE INDEX "BookingLegalArchive_archivedAt_idx"
    ON "BookingLegalArchive"("archivedAt");
