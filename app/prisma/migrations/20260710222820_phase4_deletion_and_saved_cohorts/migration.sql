-- AlterTable
ALTER TABLE "Participant" ADD COLUMN "deletedAt" DATETIME;

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "resolvedAt" DATETIME,
    "deletionCounts" TEXT,
    "ledgerRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletionRequest_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedCohort" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "matched" INTEGER NOT NULL,
    "cohortTotal" INTEGER NOT NULL,
    "clockDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DeletionRequest_participantId_status_idx" ON "DeletionRequest"("participantId", "status");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_requestedAt_idx" ON "DeletionRequest"("status", "requestedAt");
