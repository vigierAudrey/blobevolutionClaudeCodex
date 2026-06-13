-- Index composite (status, severity) sur SystemAlert (GAP-3).
-- Sert les requêtes du cockpit admin "État système" et de la liste d'alertes :
--   - comptage par gravité : WHERE status = 'OPEN' AND severity = 'CRITICAL'
--   - liste admin filtrée   : WHERE status = $1 AND severity = $2 ORDER BY createdAt DESC
-- Opération purement additive (CREATE INDEX) — aucune perte de données possible.
CREATE INDEX "SystemAlert_status_severity_idx" ON "SystemAlert"("status", "severity");
