-- CreateTable
CREATE TABLE "OutreachDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "simDate" DATETIME NOT NULL,
    "draftTitle" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "logId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OutreachDecision_simDate_status_idx" ON "OutreachDecision"("simDate", "status");

-- CreateIndex
CREATE INDEX "OutreachDecision_participantId_idx" ON "OutreachDecision"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDecision_participantId_signal_simDate_key" ON "OutreachDecision"("participantId", "signal", "simDate");
