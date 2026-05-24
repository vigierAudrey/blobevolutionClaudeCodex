-- Script de diagnostic à exécuter AVANT la migration en production.
-- Vérifie l'absence de doublons (proUserId, conversationId) dans ContactRequest.
-- Si COUNT(*) > 0, la migration ALTER TABLE ... ADD CONSTRAINT UNIQUE échouera.
-- Action requise si des lignes sont retournées : dédupliquer manuellement avant deploy.
SELECT "proUserId", "conversationId", COUNT(*)
FROM "ContactRequest"
GROUP BY "proUserId", "conversationId"
HAVING COUNT(*) > 1;
