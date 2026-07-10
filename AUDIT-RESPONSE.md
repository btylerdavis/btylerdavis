# Audit Response — Codex Findings, Remediation & Independent Verification

Every finding from the external Codex audit was fixed at root cause (commits `2a3169c`+`b21fea6`+this), then an **independent agent that wrote none of the fixes** attempted to reproduce each finding on the fixed tree. Verdicts below are the verifier's, with its evidence.

| # | Finding | Fix | Independent verification |
|---|---|---|---|
| P0 | Participant snapshot leaked device details after revocation | New consent-gated `getDevices` reader (deviceClass→dataClass map, fail-closed on unknown classes); all five raw product-surface device reads replaced | **FIXED** — Marcus fully revoked: snapshot renders 6 blocked chips + device-blocked note; 0 device models, 0 identity strings; trends payload has 0 non-null series values |
| P0 | Coach roster kept revoked participants (roster/count/badges) | Roster membership now requires a **current** Lane A grant (`evaluateGrants` over full history — re-grant restores); all tiles/funnel/flags roster-scoped | **FIXED** — all 80 roster pages swept: Marcus absent everywhere; enrolled tile 2,000→1,999; funnel decremented |
| P1 | Test setup fragile; tests missed the leak | `vitest.globalSetup` hardened (explicit schema, actionable errors); new `revocationSurfaces.test.ts` sweeps every loader incl. roster count, armBadges, export rows, rows-at-rest | **FIXED** — assertions confirmed falsifiable (mutation reasoning); before/after sanity block prevents vacuous passes. Noted boundary: suite tests loaders, not rendered pages (see Follow-ups) |
| P1 | Seed determinism overstated (`now()` timestamps) | Made **true**: seed + time machine pin `createdAt = grantedAt`, `ingestedAt = effectiveDate + 1d`; two-seed hash test added | **FIXED** — two full seeds hashed identical over every value column incl. timestamps (SHA-256 `f276…0bff`) |
| P2 | `/dev/status` exposed UUIDs/identity internals | Rewritten: sanitized counts + PASS/FAIL gate chips on a throwaway probe participant deleted per request; removed from home demo map | **FIXED** — 3 fetches: no identifiers, participant count stable at 2,000; only remaining link is the footer "Build status" |
| P2 | De-id export was unlabeled row-level microdata | DUA-cookie gate (307 → /partner without it); CSV preamble names it de-identified microdata under DUA; new un-gated **aggregate** suppressed-table endpoint | **FIXED** — no-cookie → 307; with cookie → labeled CSV, revoked Marcus's pseudonym absent from all 1,999 rows, 0 UUIDs/names/emails; aggregate shows k<11 suppression markers |
| P3 | 1 GiB text-upload buffering | 25 MB cap checked via `file.size` **before** any `.text()`; XML path verified streaming | **FIXED** — code-path inspection confirmed on every branch |
| P3 | Google Fonts build-time fetch; PostCSS advisories | Fonts vendored (`next/font/local`, woff2 in repo — offline builds work); advisory documented | **FIXED** — 0 `next/font/google`/gstatic references; `npm audit` shows only GHSA-qx2v-qp2m-jg93 (moderate, PostCSS vendored in Next, **no non-breaking fix** — monitored) |

**Claim verdicts after remediation** (verifier's judgment): *consent enforcement is total* — holds; *revocation is complete* — holds (2,000→1,999 everywhere, rows sealed at rest, re-grant restores); *seed is deterministic* — now literally true; remaining claims unchanged from the original audit's positive verdicts.

**Gates at close**: tsc clean · lint clean · **117/117 tests** · build clean (21 routes) · deterministic seed verified twice.

## Follow-ups (open, minor — from the verifier)
1. Add one render-level revocation assertion on `/participant/[id]` and `/coach` so a future raw-read regression inside a page (bypassing loaders) is caught. (Current pages all route through loaders.)
2. DUA cookie is presence-only (declared demo-grade); production design is in SPEC §12.3/TECHNICAL — a versioned, signed acknowledgement.
