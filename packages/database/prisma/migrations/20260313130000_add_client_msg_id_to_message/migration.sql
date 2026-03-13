-- Add clientMsgId column to Message table for idempotent message sending
ALTER TABLE "Message" ADD COLUMN "clientMsgId" VARCHAR(255);

-- Add unique constraint to prevent duplicate client-generated messages
CREATE UNIQUE INDEX "conversation_client_msg_unique" ON "Message"("conversationId", "clientMsgId");
