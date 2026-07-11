-- AlterTable
ALTER TABLE "Observation" ADD COLUMN "batchId" TEXT;

-- AlterTable
ALTER TABLE "SleepSession" ADD COLUMN "batchId" TEXT;

-- CreateTable
CREATE TABLE "PendingImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fileDigest" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "fileDigest" TEXT NOT NULL,
    "tokenId" TEXT,
    "consentInstrument" TEXT NOT NULL,
    "consentRevision" INTEGER NOT NULL,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SeedInfo" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "scenario" TEXT NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "clockDate" DATETIME NOT NULL
);
INSERT INTO "new_SeedInfo" ("clockDate", "cohortSize", "id", "scenario") SELECT "clockDate", "cohortSize", "id", "scenario" FROM "SeedInfo";
DROP TABLE "SeedInfo";
ALTER TABLE "new_SeedInfo" RENAME TO "SeedInfo";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PendingImport_token_key" ON "PendingImport"("token");

-- CreateIndex
CREATE INDEX "PendingImport_participantId_idx" ON "PendingImport"("participantId");

-- CreateIndex
CREATE INDEX "PendingImport_expiresAt_idx" ON "PendingImport"("expiresAt");

-- CreateIndex
CREATE INDEX "ImportBatch_participantId_createdAt_idx" ON "ImportBatch"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "Observation_batchId_idx" ON "Observation"("batchId");

-- CreateIndex
CREATE INDEX "SleepSession_batchId_idx" ON "SleepSession"("batchId");
