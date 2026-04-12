CREATE TYPE "ConversationBlockAction" AS ENUM ('BLOCK', 'UNBLOCK');
CREATE TYPE "ConversationBlockSource" AS ENUM ('USER_SELF', 'ADMIN_SINGLE', 'ADMIN_BULK', 'LEGACY_UNKNOWN');
CREATE TYPE "ConversationBlockActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');
CREATE TYPE "RetentionExportScope" AS ENUM ('AUDIT_LOG');
CREATE TYPE "RetentionExportFormat" AS ENUM ('NDJSON');
CREATE TYPE "RetentionExportStatus" AS ENUM ('GENERATING', 'READY', 'VERIFIED', 'FAILED', 'EXPIRED');

CREATE TABLE "ConversationBlockEvent" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorType" "ConversationBlockActorType" NOT NULL,
  "action" "ConversationBlockAction" NOT NULL,
  "source" "ConversationBlockSource" NOT NULL,
  "batchId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationBlockEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetentionExportArtifact" (
  "id" TEXT NOT NULL,
  "scope" "RetentionExportScope" NOT NULL,
  "format" "RetentionExportFormat" NOT NULL DEFAULT 'NDJSON',
  "fromDate" TIMESTAMP(3) NOT NULL,
  "toDate" TIMESTAMP(3) NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "sha256" TEXT,
  "storageKey" TEXT,
  "status" "RetentionExportStatus" NOT NULL DEFAULT 'GENERATING',
  "error" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),

  CONSTRAINT "RetentionExportArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationMember_blockedAt_id_idx"
ON "ConversationMember"("blockedAt", "id");

CREATE INDEX "ConversationBlockEvent_conversationId_createdAt_idx"
ON "ConversationBlockEvent"("conversationId", "createdAt");

CREATE INDEX "ConversationBlockEvent_userId_createdAt_idx"
ON "ConversationBlockEvent"("userId", "createdAt");

CREATE INDEX "ConversationBlockEvent_source_createdAt_idx"
ON "ConversationBlockEvent"("source", "createdAt");

CREATE INDEX "ConversationBlockEvent_batchId_idx"
ON "ConversationBlockEvent"("batchId");

CREATE INDEX "RetentionExportArtifact_scope_status_createdAt_idx"
ON "RetentionExportArtifact"("scope", "status", "createdAt");

CREATE INDEX "RetentionExportArtifact_createdByAdminId_createdAt_idx"
ON "RetentionExportArtifact"("createdByAdminId", "createdAt");

ALTER TABLE "ConversationBlockEvent"
ADD CONSTRAINT "ConversationBlockEvent_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationBlockEvent"
ADD CONSTRAINT "ConversationBlockEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationBlockEvent"
ADD CONSTRAINT "ConversationBlockEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RetentionExportArtifact"
ADD CONSTRAINT "RetentionExportArtifact_createdByAdminId_fkey"
FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
