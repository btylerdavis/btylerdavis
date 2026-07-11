-- Stage-3 remediation (audit level-ups 11 + 12).

-- 1. Governed-model decision log (level-up 12): one row per rendered
--    recommendation card per sim date — engine id + version, zod schema
--    validity, the SafetyCheck chain results (denylist, claim-evidence
--    linkage, guardrail-class validator), and the clinician-review stub for
--    provider-class cards. Read-only surface: /compliance/model-log.
CREATE TABLE "ModelDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "guardrail" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "schemaValid" BOOLEAN NOT NULL,
    "checks" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "simDate" DATETIME NOT NULL,
    "reviewQueued" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ModelDecisionLog_participantId_ruleId_model_modelVersion_simDate_key"
    ON "ModelDecisionLog"("participantId", "ruleId", "model", "modelVersion", "simDate");
CREATE INDEX "ModelDecisionLog_createdAt_idx" ON "ModelDecisionLog"("createdAt");
CREATE INDEX "ModelDecisionLog_reviewQueued_reviewedAt_idx"
    ON "ModelDecisionLog"("reviewQueued", "reviewedAt");

-- 2. Seed-stamped scenario marker (level-up 11 scenario sweep hook): which
--    effect-size scenario the database was seeded with, written by
--    `npm run seed`; deterministic (sim-clock date, no wall clock).
CREATE TABLE "SeedInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenario" TEXT NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "clockDate" DATETIME NOT NULL
);
