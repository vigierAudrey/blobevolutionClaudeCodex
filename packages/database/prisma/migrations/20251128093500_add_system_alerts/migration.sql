CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "SystemAlert" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "link" TEXT,
    "dedupeKey" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "acknowledgedAt" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "SystemAlert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SystemAlert_status_idx" ON "SystemAlert"("status");
CREATE INDEX "SystemAlert_type_idx" ON "SystemAlert"("type");
CREATE INDEX "SystemAlert_createdAt_idx" ON "SystemAlert"("createdAt");
CREATE INDEX "SystemAlert_dedupeKey_idx" ON "SystemAlert"("dedupeKey");
