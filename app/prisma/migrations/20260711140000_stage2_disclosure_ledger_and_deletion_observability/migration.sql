-- Stage-2 remediation (audit F-12 + level-ups 6, 8, 10).

-- 1. Observable deletion workflow (level-up 8): per-attempt metadata recorded
--    outside the atomic execution transaction (a failed attempt leaves a
--    trace while the request rolls back to `pending`), plus the immutable
--    certificate content hash stored at execution.
ALTER TABLE "DeletionRequest" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeletionRequest" ADD COLUMN "lastAttemptAt" DATETIME;
ALTER TABLE "DeletionRequest" ADD COLUMN "lastAttemptError" TEXT;
ALTER TABLE "DeletionRequest" ADD COLUMN "contentHash" TEXT;

-- 2. Disclosure-control release ledger (audit F-12, level-up 10): one row per
--    partner-facing count release (surface, canonical query, metric, band,
--    sim-clock date).
CREATE TABLE "ReleaseLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "surface" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "clockDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ReleaseLedgerEntry_surface_createdAt_idx" ON "ReleaseLedgerEntry"("surface", "createdAt");
