-- Create audit log table for admin security insights
CREATE TABLE "AuditLog" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    TEXT,
  "action"    TEXT NOT NULL,
  "resource"  TEXT NOT NULL,
  "metadata"  JSONB,
  "ip"        TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AuditLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog" ("userId");
