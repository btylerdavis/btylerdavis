-- Consent-state-machine v2 + terminal lifecycle + data-class lineage
-- (audit remediation F-01, F-02, F-03, F-05, F-06, F-08, F-09, F-11, F-14).

-- 1. Terminal participant lifecycle (F-01). Existing tombstones map to
--    "deleted"; everyone else is "active".
ALTER TABLE "Participant" ADD COLUMN "lifecycleState" TEXT NOT NULL DEFAULT 'active';
UPDATE "Participant" SET "lifecycleState" = 'deleted' WHERE "deletedAt" IS NOT NULL;

-- 2. Immutable consent events with a per-instrument monotonic revision
--    (F-02/F-05/F-14). Backfill: revision = 1-based rank of the record within
--    its (participant, instrument) history ordered by grantedAt, createdAt,
--    id — the exact ordering the old projection used. Legacy rows that were
--    revoked in place (pre-v2 flip) become "revoke" events; they keep their
--    signed scope so the authorized ceiling still covers what was signed.
ALTER TABLE "ConsentRecord" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'grant';
ALTER TABLE "ConsentRecord" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
UPDATE "ConsentRecord" SET "revision" = (
  SELECT COUNT(*) FROM "ConsentRecord" c2
  WHERE c2."participantId" = "ConsentRecord"."participantId"
    AND c2."instrumentType" = "ConsentRecord"."instrumentType"
    AND (
      c2."grantedAt" < "ConsentRecord"."grantedAt"
      OR (c2."grantedAt" = "ConsentRecord"."grantedAt" AND c2."createdAt" < "ConsentRecord"."createdAt")
      OR (c2."grantedAt" = "ConsentRecord"."grantedAt" AND c2."createdAt" = "ConsentRecord"."createdAt" AND c2."id" <= "ConsentRecord"."id")
    )
);
UPDATE "ConsentRecord" SET "eventType" = 'revoke' WHERE "status" = 'revoked';
CREATE UNIQUE INDEX "ConsentRecord_participantId_instrumentType_revision_key"
  ON "ConsentRecord"("participantId", "instrumentType", "revision");

-- 3. Data-class lineage columns (F-03/F-06/F-09). NULL = unclassified and is
--    never readable (fail closed); the backfill classifies every known row.
ALTER TABLE "Device" ADD COLUMN "dataClass" TEXT;
UPDATE "Device" SET "dataClass" = CASE "deviceClass"
  WHEN 'wearable' THEN 'wearable_sleep'
  WHEN 'cpap' THEN 'cpap_telemetry'
  WHEN 'sleep_mat' THEN 'sleep_mat'
  WHEN 'appliance' THEN 'hst_clinical'
  ELSE NULL
END;

ALTER TABLE "TreatmentEvent" ADD COLUMN "dataClass" TEXT;
UPDATE "TreatmentEvent" SET "dataClass" = CASE "type"
  WHEN 'cpap_setup' THEN 'cpap_telemetry'
  WHEN 'titration_change' THEN 'cpap_telemetry'
  WHEN 'therapy_stop' THEN 'cpap_telemetry'
  WHEN 'appliance_delivery' THEN 'hst_clinical'
  WHEN 'mattress_delivery' THEN 'mattress_purchase'
  ELSE NULL
END;

-- Episodes take the class of their treatment anchor (the same rule
-- enrollmentRows uses: cpap wins over appliance wins over mattress; a
-- participant with no exposure change anchors on the clinical protocol).
ALTER TABLE "Episode" ADD COLUMN "dataClass" TEXT;
UPDATE "Episode" SET "dataClass" = CASE
  WHEN EXISTS (SELECT 1 FROM "TreatmentEvent" te WHERE te."participantId" = "Episode"."participantId" AND te."type" = 'cpap_setup') THEN 'cpap_telemetry'
  WHEN EXISTS (SELECT 1 FROM "TreatmentEvent" te WHERE te."participantId" = "Episode"."participantId" AND te."type" = 'appliance_delivery') THEN 'hst_clinical'
  WHEN EXISTS (SELECT 1 FROM "TreatmentEvent" te WHERE te."participantId" = "Episode"."participantId" AND te."type" = 'mattress_delivery') THEN 'mattress_purchase'
  ELSE 'hst_clinical'
END;

-- 4. Deletion workflow hardening (F-08): database-unique active request per
--    participant + execution-snapshot ledger count for the certificate.
ALTER TABLE "DeletionRequest" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "DeletionRequest" ADD COLUMN "ledgerCount" INTEGER;
UPDATE "DeletionRequest" SET "activeKey" = "participantId" WHERE "status" IN ('pending', 'executing');
CREATE UNIQUE INDEX "DeletionRequest_activeKey_key" ON "DeletionRequest"("activeKey");
