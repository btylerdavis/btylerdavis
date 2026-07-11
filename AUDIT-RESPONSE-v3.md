# Audit Response v3 — Import Trust Boundary (ChatGPT re-audit HIGH)

The ChatGPT re-audit (`3aeb5aa1-sleeptopiareauditv2report.md`) verified **13 of 14** prior findings fixed and all 12 level-ups, and raised **one new HIGH**: import confirmation authorized the operation's `kind` while persisting a caller-supplied `source`, so a forged payload could store CPAP-classified rows under a wearable consent check. Fixed and independently certified.

## The fix (ChatGPT's preferred design, not the minimum patch)
- **Server-owned confirmation.** Parsed previews persist to a single-use, token-keyed `PendingImport`; `confirmImport` accepts only `(token, participantId, alignToSimClock)`. The client-round-tripped payload is gone — the server action has no parameter to carry a forged `source` or rows.
- **Connector schemas.** Per kind: canonical source, allowed concept/unit pairs, value bounds. Parser output is validated before a pending record exists.
- **Row-level lineage authorization.** The guarded writer re-derives each row's class from its own canonical `source` via `sourceToDataClass` and asserts it equals the connector's class inside the write transaction; unknown, mixed, or mismatched batches are refused before persistence.
- **Provenance receipts.** Each import creates an `ImportBatch` (file SHA-256, parser version, admitted consent instrument+revision, consumed token id); rows link to it. A consent-impact preview states the class and authorizing grant before confirmation.
- **Adversarial suite** (`trustBoundary.test.ts`): every forged kind/source cross-product, tampered concept/unit/bound, participant swap, and expired/replayed token proven to write zero rows — with positive-path assertions so it can't pass by refusing everything.

## Independent certification (verifier wrote none of the fix)
Exact re-audit repro **BLOCKED** (source_mismatch + unknown_concept; 0 rows). Client can no longer influence stored row class at all (server action arity has no payload). Token attacks (forge/expire/reuse/cross-participant/concurrent double-confirm) all blocked; single-use is atomic (one ImportBatch, count not doubled). All 53 disagreeing kind×source pairs → zero rows. Legitimate AirView + Apple Health imports still work with full provenance. Prior 9 audit reproductions + deletion terminality + per-class revocation spot-checked green. Gates: tsc clean · lint clean · **295/295 tests** · build clean (31 routes). **Verdict: CERTIFY.**

## Claim table, final
All eight requested claims now hold. Claim 1 (consent enforcement total) — the last remaining refutation — is closed: authorization and persisted lineage can no longer disagree on any path.
