# Audit Response v2 — ChatGPT Full Audit: Remediation & Certification

The ChatGPT audit (2026-07-11: 1 Critical, 7 High, 5 Medium, 1 Low + 12 level-ups) was remediated in three staged builds (commits `20ed581`, `de96bae`, `578173b`), then a final independent verification agent — which wrote none of the fixes — re-ran **all nine of the audit's adversarial reproductions verbatim** plus the attack surfaces each builder flagged. **Verdict: certified.** Every reproduction now fails; every previously refuted claim holds.

## Reproductions re-run (all FIXED)
1. Zero-consent CPAP setup → refused, zero rows written.
2. Deletion resurrection (CPAP setup / restoreAll / re-enroll / ingest on a tombstone) → all refused (LifecycleError/ConsentError); certificate hash-verified from stored snapshot only.
3. `mattress_delivery` under `mattress_purchase` revocation → gated out (per-event lineage; `cpap_setup` gates on `cpap_telemetry`).
4. Wearable-only activity/nights after wearable revocation → excluded from coach + exec aggregates.
5. OMOP OBSERVATION_PERIOD after `hst_clinical` revocation → absent.
6. `airveiw` typo source → quarantined (fail-closed), surfaced as unclassified.
7. Mid-deletion fault → rolls back to retryable `pending` with attempt metadata; retry executes. Never wedged.
8. Concurrent per-class revocations → both persist (CAS + DB-unique revisions).
9. 21−20−0=1 differencing attack → banded release + complementary suppression; lattice auditor proves **zero inferable cells** (and flags 45 on the pre-fix policy, proving it isn't vacuous).

## What was rebuilt (per audit fix-priority list)
Terminal DB-enforced participant lifecycle · consent as immutable events with monotonic DB-unique revisions, CAS, and a **signed-scope ceiling** (never_authorized is a distinct state; expansion only via participant-facing re-consent) · data-class lineage on Device/TreatmentEvent/Episode + `registry_demographics` class · central policy repository for every subject-data write with an ESLint-enforced boundary · consent-aware aggregate primitives everywhere · atomic observable deletion with attempt tracking and SHA-256 tamper-evident certificates · banded disclosure with in-path interval-propagation audit + release ledger + approved query families · participant scope history + consent receipts · coverage-denominator strips · robustness views (missingness, attrition, CIs, negative control, E-value) · governed-recommendation pipeline (evidence bundles, zod schema, safety chain, model decision log, clinician-review stubs). Generator corrected so the mattress channel is position-only — making the negative control honest.

## Claim table after remediation (final verifier's judgment)
Claims 1–4 and 8 (consent totality, revocation completeness, terminal atomic deletion, leak-free de-identification, test honesty): **now hold** under the audit's own tests. Claims 5–7 (identity split, determinism incl. null scenario, guardrails/clamps): **remain verified**, with fresh two-run determinism hashes for both scenarios.

## Gates at certification
tsc clean · lint clean (policy boundary active) · **269/269 tests** · build clean (31 routes) · both scenario seeds byte-identical across double runs · all six new pages render.

## Open LOW items (disclosed)
1. Model-log "Logged (UTC)" column is wall-clock beside sim-date — cosmetic, clearly labeled.
2. Band-boundary crossing under cross-snapshot differencing is theoretically observable to an attacker holding compound (partner + console) privileges outside the demo threat model — inherent to banding; documented.
3. Console full-revocation events use wall-clock `revokedAt` in the timeline view (stage-3 note) — ledger-truth question for production, no enforcement impact.
