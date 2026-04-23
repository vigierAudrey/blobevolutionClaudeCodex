-- LOT-INV-002: ConversationInvitation, ContactRequest, ContactRequestResponse + index drift
-- Scope strict: aucune modification hors de ces 3 modèles + RefreshToken.tokenHash + MatchDecision composite
-- Note: IF NOT EXISTS utilisé car le dev DB a été avancé via db push; migrations appliquées en ordre sur DB fraîche

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "ContactRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ContactResponse" AS ENUM ('ACCEPT', 'REJECT');
CREATE TYPE "ConversationInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ConversationInvitation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ConversationInvitation" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "invitedUserId"  TEXT NOT NULL,
    "invitedBy"      TEXT NOT NULL,
    "status"         "ConversationInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ContactRequest
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ContactRequest" (
    "id"             TEXT NOT NULL,
    "proUserId"      TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "message"        TEXT,
    "status"         "ContactRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactRequest_proUserId_idx"
    ON "ContactRequest"("proUserId");

CREATE INDEX "ContactRequest_conversationId_idx"
    ON "ContactRequest"("conversationId");

CREATE INDEX "ContactRequest_status_idx"
    ON "ContactRequest"("status");

ALTER TABLE "ContactRequest"
    ADD CONSTRAINT "ContactRequest_proUserId_fkey"
    FOREIGN KEY ("proUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRequest"
    ADD CONSTRAINT "ContactRequest_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ContactRequestResponse
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ContactRequestResponse" (
    "id"               TEXT NOT NULL,
    "contactRequestId" TEXT NOT NULL,
    "riderUserId"      TEXT NOT NULL,
    "response"         "ContactResponse" NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RefreshToken.tokenHash — index drift (existait en schema, absent des migrations)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "RefreshToken_tokenHash_idx"
    ON "RefreshToken"("tokenHash");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MatchDecision composite (actorUserId, createdAt DESC) — index drift
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "MatchDecision_actorUserId_createdAt_idx"
    ON "MatchDecision"("actorUserId", "createdAt" DESC);
