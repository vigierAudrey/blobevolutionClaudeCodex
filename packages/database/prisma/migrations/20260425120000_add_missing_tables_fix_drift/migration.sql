-- DANGEROUS-DDL-APPROVED: PartnerPref enum and its columns (RiderProfile.partnerPref,
-- LastSearch.partner) were removed from schema.prisma during the matching module
-- refactor. These columns contain no PII — partnerPref stored a preference enum
-- value (ALL/WOMEN/MEN), partner was nullable. Both columns are safe to drop;
-- all reads/writes were removed in the same schema refactor commit.

-- ---------------------------------------------------------------------------
-- 1. Drop obsolete PartnerPref columns before dropping the type
-- ---------------------------------------------------------------------------

-- RiderProfile.partnerPref was added in 20250904125135_add_rider_profile
ALTER TABLE "RiderProfile" DROP COLUMN IF EXISTS "partnerPref";

-- LastSearch.partner was added in 20250908105503_add_consent_fields
ALTER TABLE "LastSearch" DROP COLUMN IF EXISTS "partner";

-- ---------------------------------------------------------------------------
-- 2. Drop the PartnerPref enum (now unreferenced)
-- ---------------------------------------------------------------------------

DROP TYPE IF EXISTS "PartnerPref";

-- ---------------------------------------------------------------------------
-- 3. Create missing enums (in schema.prisma, never migrated)
-- ---------------------------------------------------------------------------

CREATE TYPE "ContactRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TYPE "ContactResponse" AS ENUM ('ACCEPT', 'REJECT');

CREATE TYPE "ConversationInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TYPE "UploadJobStatus" AS ENUM ('PENDING', 'FINALIZED', 'FAILED');

-- ---------------------------------------------------------------------------
-- 4. Create ConversationInvitation table
-- ---------------------------------------------------------------------------

CREATE TABLE "ConversationInvitation" (
    "id"             TEXT                        NOT NULL,
    "conversationId" TEXT                        NOT NULL,
    "invitedUserId"  TEXT                        NOT NULL,
    "invitedBy"      TEXT                        NOT NULL,
    "status"         "ConversationInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"      TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt"    TIMESTAMP(3),

    CONSTRAINT "ConversationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationInvitation_conversationId_invitedUserId_key"
    ON "ConversationInvitation"("conversationId", "invitedUserId");

CREATE INDEX "ConversationInvitation_invitedUserId_status_idx"
    ON "ConversationInvitation"("invitedUserId", "status");

CREATE INDEX "ConversationInvitation_conversationId_idx"
    ON "ConversationInvitation"("conversationId");

ALTER TABLE "ConversationInvitation"
    ADD CONSTRAINT "ConversationInvitation_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationInvitation"
    ADD CONSTRAINT "ConversationInvitation_invitedUserId_fkey"
    FOREIGN KEY ("invitedUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationInvitation"
    ADD CONSTRAINT "ConversationInvitation_invitedBy_fkey"
    FOREIGN KEY ("invitedBy") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Create ContactRequest table
-- ---------------------------------------------------------------------------

CREATE TABLE "ContactRequest" (
    "id"             TEXT                  NOT NULL,
    "proUserId"      TEXT                  NOT NULL,
    "conversationId" TEXT                  NOT NULL,
    "message"        TEXT,
    "status"         "ContactRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"      TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactRequest_proUserId_idx"    ON "ContactRequest"("proUserId");
CREATE INDEX "ContactRequest_conversationId_idx" ON "ContactRequest"("conversationId");
CREATE INDEX "ContactRequest_status_idx"       ON "ContactRequest"("status");

ALTER TABLE "ContactRequest"
    ADD CONSTRAINT "ContactRequest_proUserId_fkey"
    FOREIGN KEY ("proUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRequest"
    ADD CONSTRAINT "ContactRequest_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Create ContactRequestResponse table
-- ---------------------------------------------------------------------------

CREATE TABLE "ContactRequestResponse" (
    "id"               TEXT             NOT NULL,
    "contactRequestId" TEXT             NOT NULL,
    "riderUserId"      TEXT             NOT NULL,
    "response"         "ContactResponse" NOT NULL,
    "createdAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequestResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactRequestResponse_contactRequestId_riderUserId_key"
    ON "ContactRequestResponse"("contactRequestId", "riderUserId");

CREATE INDEX "ContactRequestResponse_contactRequestId_idx"
    ON "ContactRequestResponse"("contactRequestId");

CREATE INDEX "ContactRequestResponse_riderUserId_idx"
    ON "ContactRequestResponse"("riderUserId");

ALTER TABLE "ContactRequestResponse"
    ADD CONSTRAINT "ContactRequestResponse_contactRequestId_fkey"
    FOREIGN KEY ("contactRequestId") REFERENCES "ContactRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRequestResponse"
    ADD CONSTRAINT "ContactRequestResponse_riderUserId_fkey"
    FOREIGN KEY ("riderUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. Create UploadJob table
-- ---------------------------------------------------------------------------

CREATE TABLE "UploadJob" (
    "id"            TEXT             NOT NULL,
    "quarantineKey" TEXT             NOT NULL,
    "userId"        TEXT             NOT NULL,
    "status"        "UploadJobStatus" NOT NULL DEFAULT 'PENDING',
    "publishedKey"  TEXT,
    "attempts"      INTEGER          NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt"   TIMESTAMP(3),

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadJob_quarantineKey_key" ON "UploadJob"("quarantineKey");

CREATE INDEX "UploadJob_userId_idx" ON "UploadJob"("userId");

ALTER TABLE "UploadJob"
    ADD CONSTRAINT "UploadJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
