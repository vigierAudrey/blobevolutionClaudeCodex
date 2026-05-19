-- Index global sur createdAt (sans userId) requis pour la purge TTL batch.
-- L'index composite existant (userId, createdAt DESC) n'est pas utilisé
-- pour un DELETE WHERE createdAt < cutoff sans filtre userId.
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
