-- Add directKey column to Conversation table
-- Required by conversations.controller.ts for direct (non-match) conversations
ALTER TABLE "Conversation" ADD COLUMN "directKey" TEXT;
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
