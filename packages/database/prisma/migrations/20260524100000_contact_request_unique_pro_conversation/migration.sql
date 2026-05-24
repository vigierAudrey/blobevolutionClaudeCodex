-- Contrainte unique (proUserId, conversationId) sur ContactRequest.
-- Règle métier : un pro ne peut envoyer qu'une seule demande de contact par conversation.
-- Raison sécurité : sans cette contrainte, deux requêtes concurrentes depuis le même JWT
-- peuvent toutes deux passer le findFirst (null) et créer deux lignes (race condition TOCTOU).
-- La contrainte est purement additive — aucune perte de données.
-- Risque prod : échouera si des lignes dupliquées existent déjà (à vérifier avant deploy).
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_proUserId_conversationId_key" UNIQUE ("proUserId", "conversationId");
