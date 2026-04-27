-- Rename 3 unique indexes where PostgreSQL auto-truncated the Prisma-generated name to
-- exactly 63 characters (max identifier length) differently from the name the current
-- Prisma version now generates.
--
-- Root cause: the original CREATE UNIQUE INDEX statements used names > 63 chars.
-- PostgreSQL silently truncated them at column 63 (plain cut). The current Prisma
-- engine preserves the trailing "_key" suffix and truncates earlier in the middle.
--
-- All three are standalone indexes created with CREATE UNIQUE INDEX, NOT table
-- CONSTRAINT clauses. ALTER INDEX … RENAME TO is atomic, no lock escalation, no data.
--
-- 1. AnalyticsDailyAgg (migration 20251229120000_add_analytics_events)
--    Original intended: AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_zoneLarge_key (72 chars)
--    PG stored:         AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_zoneL        (63 chars — plain cut, ends in capital L)
--    Prisma now wants:  AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_z_key        (63 chars — suffix-preserving cut)
--    Note: the CI logs show "zoneI" which is a font rendering of capital L in some terminals.
ALTER INDEX "AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_zoneL"
  RENAME TO "AnalyticsDailyAgg_day_actorType_eventType_contentId_sport_z_key";

-- 2. Message (migration 20260313130000_add_client_msg_id_to_message)
--    Original intended: conversation_client_msg_unique  (custom hand-written name)
--    PG stored:         conversation_client_msg_unique
--    Prisma now wants:  Message_conversationId_clientMsgId_key  (auto-generated default)
ALTER INDEX "conversation_client_msg_unique"
  RENAME TO "Message_conversationId_clientMsgId_key";

-- 3. ProAvailabilityInteraction (migration 20260313140000_add_pro_availability_interaction)
--    Original intended: ProAvailabilityInteraction_availabilityId_riderUserId_eventType_key (68 chars)
--    PG stored:         ProAvailabilityInteraction_availabilityId_riderUserId_eventType     (63 chars — plain cut)
--    Prisma now wants:  ProAvailabilityInteraction_availabilityId_riderUserId_event_key     (63 chars — suffix-preserving cut)
ALTER INDEX "ProAvailabilityInteraction_availabilityId_riderUserId_eventType"
  RENAME TO "ProAvailabilityInteraction_availabilityId_riderUserId_event_key";
