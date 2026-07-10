# Sleep Outcomes Platform — Demo App

Week 1 foundation of the [DEMO.md](../DEMO.md) build: Next.js (App Router) + TypeScript + Tailwind + Prisma. SQLite locally; the schema is Postgres-compatible and swaps to Supabase Postgres at deploy.

## Quickstart

```bash
cp .env.example .env && npm install   # install (generates the Prisma client)
npx prisma migrate dev                # create/migrate the local SQLite db
npm run seed                          # deterministic ~2,000-participant synthetic cohort (~75s)
npm test                              # vitest: consent engine + time machine
npm run dev                           # then open http://localhost:3000/dev/status
```

## What's here

- `prisma/schema.prisma` — demo subset of the TECHNICAL.md §T2 data model. Display fields live only in `DemoIdentity` (mirrors the production identity split); consent history is append-only.
- `src/lib/consent/` — the consent engine (production semantics, TECHNICAL.md §T2.6): `(dataClass, use)` scope grants per instrument (Lane A/B/C), `assertIngestAllowed` ingest gate on every write path, consent-gated read helpers (`getObservations`, `getSleepSessions`, `getLinkedProfile` — the only DemoIdentity join in the codebase), and `revokeConsent`/`grantConsent` (revoke flips status + `revokedAt`; re-grant appends a new record).
- `src/lib/synthetic/` — deterministic cohort generator (seeded PRNG, no `Math.random`): OSA severity 35/40/25, ~50% supine-predominant, five treatment arms, adherence decay with `therapy_gap` outcomes, nightly wearable/CPAP/sleep-mat observations with literature-plausible treatment effects (supine-time −8..15 pts post medium-firm-hybrid delivery; ESS −3..5 on adherent CPAP), 15% wearable missingness, ESS/ISI/STOP-BANG PROs. Marcus Reed's id is exported as `MARCUS_REED_PARTICIPANT_ID`.
- `src/lib/simclock.ts` — the time machine: `advanceDays(n)` generates the newly-elapsed nights for all participants (same deterministic nightly logic as the seed) and respects revoked consent.
- `/dev/status` — server-rendered build check: sanitized aggregate counts, the sim-clock date, and pass/fail consent-gate indicators exercised on a throwaway probe participant (no cohort participant identifiers appear).

Re-seeding is safe and reproducible: `npm run seed` wipes and regenerates identical data — every column, including `createdAt`/`ingestedAt` timestamps, is pinned to deterministic values.
