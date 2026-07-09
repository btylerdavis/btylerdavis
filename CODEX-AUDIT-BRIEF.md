# Audit Brief — Sleeptopia Demo Platform

**To the auditor.** You are auditing a demonstration application built by an AI agent team (Claude) for a sleep-outcomes data platform. The commissioning consultant (Ben Davis) wants independent adversarial verification before this is demonstrated to the client. You did not build this; nothing here is yours to defend. Find what's wrong.

## What this is

A Next.js 16 + TypeScript + Prisma (SQLite) demo of a consented sleep-outcomes registry: two enrollment flows, a consent-gated database of ~2,000 **synthetic** participants, longitudinal dashboards, a de-identification pipeline, a consent-revocation control room, and business/partner views. It is **demo-grade by design** (see scope limits below). The product spec is `SPEC.md`; the demo's own bar is `DEMO.md` §3 (working core vs. reserve tables) — audit against that bar.

## How to run it

```
cd app
npm install            # ~1 min
cp .env.example .env   # Windows: copy .env.example .env
npx prisma db push
npm run seed           # ~80s; expect: "Marcus Reed: d81a5f64-... (cpap_mattress, AHI 24, supine 41)"
npm test               # expect 115 passing
npm run build && npm run start   # http://localhost:3000, demo map at page bottom
```

## Claims to verify adversarially

These are the claims the builders make. Attack each one.

1. **Consent enforcement is total.** Claimed: every data write passes `assertIngestAllowed` and every participant-data read goes through consent-gated readers (`app/src/lib/consent/engine.ts`, `gatedQueries.ts`) or consent-filtered aggregates (`app/src/lib/coach/queries.ts`, `app/src/lib/research/cohort.ts`). **Attack**: grep pages/actions/routes for direct `prisma.` access that bypasses the gates; construct a participant with revoked/partial grants and try every route and server action for leakage.
2. **The identity split holds.** Claimed: `DemoIdentity` (names/emails) is joined only in `getLinkedProfile` (double-gated: linkage + use) and `identity.ts` (name→id matching, returns no outcomes). **Attack**: find any other access path; check whether identity data leaks through the de-id CSV export, error messages, or page props.
3. **De-identification is correct.** Claimed: per-participant constant date shift (±30d, interval-preserving), pseudonyms, 5-year age bands, k<11 small-cell suppression, and a leakage-free CSV export (`app/src/lib/deid/`, `app/src/app/research/deid/export/route.ts`). **Attack**: verify interval preservation across record types; check suppressed cells can't be back-derived from released marginals; scan the export for names/emails/UUIDs/raw dates.
4. **Revocation is complete.** Claimed: after `revokeConsent` (all instruments), no route, action, aggregate, funnel, partner view, or recommendation serves that participant's data, while rows remain at rest ("sealed, not deleted"). **Attack**: revoke a participant, then hit every surface, including the exec funnel, partner dashboard, cohort explorer URLs, and the CSV export.
5. **The tests are honest.** Claimed: 115 tests covering consent round-trips, de-id determinism, suppression, parsers, scoring bands, revocation. **Attack**: read the assertions — do they test the claim or a strawman? Any tests that can't fail? Coverage gaps on the consent paths?
6. **The seed is deterministic.** Claimed: identical DB (counts and values) on every `npm run seed`. **Attack**: run twice, diff aggregate queries; check for hidden `Math.random`/`Date.now` in `app/src/lib/synthetic/` and `simclock.ts`.
7. **Demo honesty is systematic.** Claimed: every page carries a DEMO DATA watermark and a synthetic-cohort footer; consent instruments are watermarked "pre-counsel"; research pages carry methods/limitations caveats. **Attack**: find a route without them.
8. **General code health.** Injection risk in the raw SQL (`app/src/lib/coach/queries.ts` uses epoch-ms arithmetic; check parameterization), unsafe parsing of uploaded files (HST CSV/text, Apple Health XML — `app/src/lib/hst/parse.ts`, `app/src/lib/imports/`), dependency vulnerabilities, and anything in `next.config`/server actions that widens the attack surface beyond demo needs.

## Known judgment calls (flagged during the build — confirm they hold rather than rediscover them)

- Treatment events were originally ungated in the linked profile; fixed to gate on `hst_clinical`. Verify the fix covers all consumers of treatment events.
- Cohort "arm" derivation treats a missing `mattress_purchase` grant as "no mattress arm" (not "unknown"); per-class partial revocation is declared reserve scope.
- The partner portal's DUA gate is a presence-only session cookie — demo-grade by declaration.
- Marcus (the scripted persona) intentionally receives a positive-reinforcement adherence card; problem-rules fire only on genuinely degraded data.
- The exec funnel intersects the HST stage with the at-risk stage to stay monotonic (synthetic cohort models full referral acceptance; footnoted on screen).

## Out of scope (demo-grade by design — do not report as findings)

No authentication/user accounts; no HIPAA-grade infrastructure (this is synthetic data on SQLite); no rate limiting; no production deployment hardening; native mobile apps; live third-party integrations (wearable OAuth, CPAP vendor feeds). These are documented reserve/production items in `DEMO.md` §3 and `DELIVERY.md`.

## Requested output

1. Findings ranked by severity, each with file:line, reproduction steps, and a suggested fix.
2. An explicit list of which of the 8 claims you verified, refuted, or could not assess — with evidence.
3. A one-paragraph overall judgment: is this safe to demo to a client as "working software on synthetic data"?
