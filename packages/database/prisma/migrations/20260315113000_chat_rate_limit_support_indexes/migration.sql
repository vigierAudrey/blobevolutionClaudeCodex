CREATE INDEX "Conversation_updatedAt_id_idx"
ON "Conversation"("updatedAt" DESC, "id" DESC);

CREATE INDEX "ConversationMember_userId_trashedAt_conversationId_idx"
ON "ConversationMember"("userId", "trashedAt", "conversationId");

CREATE INDEX "Message_conversationId_senderId_createdAt_idx"
ON "Message"("conversationId", "senderId", "createdAt" DESC);
