# Audit Brief — Sleeptopia Demo Platform (Full Build, v2)

**To the auditor** (any external tool — this round: ChatGPT). You are auditing a demo application built by an AI agent team (Claude). A prior external audit (Codex) ran against an earlier tree; its findings were fixed and independently verified — see `AUDIT-RESPONSE.md`. **This brief covers the FULL current build**, including two feature phases added after that audit. You built none of this; find what's wrong.

## What this is
Next.js 16 + TypeScript + Prisma (SQLite) demo of a consented sleep-outcomes registry: two enrollment flows, consent-gated database of ~2,000 **synthetic** participants, longitudinal dashboards, de-identification pipeline (CSV microdata + OMOP zip), revocation console with **per-data-class partial revocation**, **deletion-request workflow** with hard-delete + printable certificate, AI recommendation cards with template narratives, DUA-gated partner portal + **study-proposal generator**, exec dashboard with **revenue calculator**, research **power calculator**, saved cohorts, scenario seeds. Demo-grade by design — audit against `DEMO.md` §3, not production HIPAA.

## How to run
```
cd app && npm install && cp .env.example .env
npx prisma db push && npm run seed     # ~80s; expect "Marcus Reed: d81a5f64-..."
npm test                               # expect 155 passing
npm run build && npm run start         # demo map at bottom of /
```

## Claims to attack (each previously verified — re-verify adversarially)
1. **Consent enforcement is total** — every write via `assertIngestAllowed`, every read via gated readers/consent-filtered aggregates (`app/src/lib/consent/`), incl. the device reader added post-audit. Hunt raw `prisma.` reads on product surfaces.
2. **Revocation is complete** — full AND per-class (`reviseConsentScope`): revoke one class, only that class blocks everywhere; full revoke drops the participant from every count, export, roster; ledger append-only.
3. **Deletion is stronger than revocation** (`app/src/lib/compliance/deletion.ts`) — atomic claim guards double-execute (race was found+fixed: certificate counts zeroing); hard-delete of 8 tables, tombstone, surviving ledger, accurate certificate. Attack concurrency, mid-history deletion, post-deletion surfaces.
4. **De-identification is leak-free** — CSV microdata + OMOP zip (`app/src/lib/deid/`, `research/omopExport.ts`): date-shift interval preservation, k<11 suppression (incl. proposal generator's released counts), zero identifiers in any export.
5. **Identity split holds** — `DemoIdentity` only via `getLinkedProfile` + `identity.ts`.
6. **Seed is deterministic** — two seeds byte-identical incl. timestamps; `SCENARIO=null` variant flat-effect and equally deterministic.
7. **Guardrails hold** — recommendations + AI narratives never emit diagnosis/therapy-change wording (banned-phrase lists in tests); calculators clamp junk/hostile params.
8. **Tests are honest** — 155 tests: do assertions match claims; any unfalsifiable tests?

## Known accepted limits (don't report as findings)
No auth; DUA cookie is presence-only (declared demo-grade); SQLite; no rate limiting; native apps/live vendor integrations are documented reserve (`DEMO.md` §3); PostCSS advisory GHSA-qx2v-qp2m-jg93 monitored (no non-breaking fix); loader-level (not render-level) revocation test coverage noted in `AUDIT-RESPONSE.md`; power-page "≈64 vs 63" prose nit and unvalidated-but-escaped brand filter value are known LOW items.

## Requested output
Severity-ranked findings (file:line, repro, fix); verdict per claim (verified/refuted/not assessed) with evidence; one-paragraph judgment: safe to demo to a client as working software on synthetic data?
