-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "yearOfBirth" INTEGER NOT NULL,
    "sex" TEXT NOT NULL,
    "enrollmentTouchpoint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DemoIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    CONSTRAINT "DemoIdentity_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "instrumentType" TEXT NOT NULL,
    "instrumentVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "scope" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentRecord_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "protocolPhase" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    CONSTRAINT "Episode_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TreatmentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL,
    "detail" TEXT NOT NULL,
    CONSTRAINT "TreatmentEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "deviceClass" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL,
    "returnedAt" DATETIME,
    CONSTRAINT "Device_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MattressCatalog" (
    "sku" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "firmnessRating" INTEGER NOT NULL,
    "materialClass" TEXT NOT NULL,
    "size" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MattressPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "purchaseDate" DATETIME NOT NULL,
    "deliveryDate" DATETIME,
    "storeId" TEXT NOT NULL,
    CONSTRAINT "MattressPurchase_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MattressPurchase_sku_fkey" FOREIGN KEY ("sku") REFERENCES "MattressCatalog" ("sku") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SleepSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deviceId" TEXT,
    "startTs" DATETIME NOT NULL,
    "endTs" DATETIME NOT NULL,
    "summary" TEXT NOT NULL,
    CONSTRAINT "SleepSession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SleepSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deviceId" TEXT,
    "concept" TEXT NOT NULL,
    "valueNumeric" REAL,
    "valueText" TEXT,
    "unit" TEXT,
    "effectiveDate" DATETIME NOT NULL,
    "grain" TEXT NOT NULL,
    "qualityFlags" TEXT NOT NULL,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Observation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Observation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "instrumentVersion" TEXT NOT NULL,
    "administeredAt" DATETIME NOT NULL,
    "itemScores" TEXT NOT NULL,
    "totalScore" REAL NOT NULL,
    CONSTRAINT "ProResponse_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimClock" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "currentDate" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoIdentity_participantId_key" ON "DemoIdentity"("participantId");

-- CreateIndex
CREATE INDEX "ConsentRecord_participantId_instrumentType_idx" ON "ConsentRecord"("participantId", "instrumentType");

-- CreateIndex
CREATE INDEX "Episode_participantId_idx" ON "Episode"("participantId");

-- CreateIndex
CREATE INDEX "TreatmentEvent_participantId_type_idx" ON "TreatmentEvent"("participantId", "type");

-- CreateIndex
CREATE INDEX "Device_participantId_deviceClass_idx" ON "Device"("participantId", "deviceClass");

-- CreateIndex
CREATE INDEX "MattressPurchase_participantId_idx" ON "MattressPurchase"("participantId");

-- CreateIndex
CREATE INDEX "SleepSession_participantId_startTs_idx" ON "SleepSession"("participantId", "startTs");

-- CreateIndex
CREATE INDEX "Observation_participantId_concept_effectiveDate_idx" ON "Observation"("participantId", "concept", "effectiveDate");

-- CreateIndex
CREATE INDEX "Observation_concept_effectiveDate_idx" ON "Observation"("concept", "effectiveDate");

-- CreateIndex
CREATE INDEX "ProResponse_participantId_instrument_administeredAt_idx" ON "ProResponse"("participantId", "instrument", "administeredAt");
