-- RenameForeignKey
ALTER TABLE "Conversation" RENAME CONSTRAINT "Conversation_match_fkey" TO "Conversation_matchId_fkey";

-- RenameForeignKey
ALTER TABLE "ConversationMember" RENAME CONSTRAINT "ConversationMember_conversation_fkey" TO "ConversationMember_conversationId_fkey";

-- RenameForeignKey
ALTER TABLE "ConversationMember" RENAME CONSTRAINT "ConversationMember_user_fkey" TO "ConversationMember_userId_fkey";

-- RenameForeignKey
ALTER TABLE "Match" RENAME CONSTRAINT "Match_userOne_fkey" TO "Match_userOneId_fkey";

-- RenameForeignKey
ALTER TABLE "Match" RENAME CONSTRAINT "Match_userTwo_fkey" TO "Match_userTwoId_fkey";

-- RenameForeignKey
ALTER TABLE "MatchDecision" RENAME CONSTRAINT "MatchDecision_actor_fkey" TO "MatchDecision_actorUserId_fkey";

-- RenameForeignKey
ALTER TABLE "MatchDecision" RENAME CONSTRAINT "MatchDecision_target_fkey" TO "MatchDecision_targetProfileId_fkey";

-- RenameForeignKey
ALTER TABLE "Message" RENAME CONSTRAINT "Message_conversation_fkey" TO "Message_conversationId_fkey";

-- RenameForeignKey
ALTER TABLE "Message" RENAME CONSTRAINT "Message_sender_fkey" TO "Message_senderId_fkey";

-- RenameForeignKey
ALTER TABLE "ProfileReport" RENAME CONSTRAINT "ProfileReport_reported_fkey" TO "ProfileReport_reportedProfileId_fkey";

-- RenameForeignKey
ALTER TABLE "ProfileReport" RENAME CONSTRAINT "ProfileReport_reporter_fkey" TO "ProfileReport_reporterUserId_fkey";

-- RenameIndex
ALTER INDEX "MatchDecision_actor_idx" RENAME TO "MatchDecision_actorUserId_idx";

-- RenameIndex
ALTER INDEX "MatchDecision_actor_target_unique" RENAME TO "MatchDecision_actorUserId_targetProfileId_key";

-- RenameIndex
ALTER INDEX "MatchDecision_target_idx" RENAME TO "MatchDecision_targetProfileId_idx";

-- RenameIndex
ALTER INDEX "ProfileReport_reported_idx" RENAME TO "ProfileReport_reportedProfileId_idx";

-- RenameIndex
ALTER INDEX "ProfileReport_reporter_idx" RENAME TO "ProfileReport_reporterUserId_idx";
