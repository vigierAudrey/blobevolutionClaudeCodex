-- CreateTable: LessonFanout — observabilité opérationnelle des fanouts de notifications cours
-- Une ligne par déclenchement (jamais pour les cooldowns bloqués).
-- riderRef : SHA-256 tronqué, non-réversible (privacy by design).
CREATE TABLE "LessonFanout" (
  "id"           TEXT NOT NULL,
  "riderRef"     TEXT NOT NULL,
  "sport"        TEXT,
  "prosFound"    INTEGER NOT NULL DEFAULT 0,
  "prosNotified" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LessonFanout_pkey" PRIMARY KEY ("id")
);

-- Index sur createdAt : toutes les requêtes métriques filtrent sur une fenêtre de temps.
CREATE INDEX "LessonFanout_createdAt_idx" ON "LessonFanout"("createdAt");
