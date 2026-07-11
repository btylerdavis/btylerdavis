# August Demo — Proposal: The Whole Thing, Working, in Four Weeks

| | |
|---|---|
| **Version** | 0.1 (proposal — for Ben's approval) |
| **Date** | July 8, 2026 |
| **Deadline** | Demo-ready by **August 4, 2026** (Kevin returns) |
| **Companion documents** | [SPEC.md](SPEC.md) (the production blueprint this demo sells) · [DELIVERY.md](DELIVERY.md) (production timeline) |

---

## 1. What this is

A **working, end-to-end demonstration** of the full platform — every element of Kevin's vision visible and operating, from a customer walking into The Mattress Hub through to a published-study mockup and a partner dashboard. Not a slide deck, not a clickable mockup: a real application with a real database, real consent enforcement, and data flowing through it live during the demo.

**The honest line, drawn once:** the demo runs on a **synthetic cohort** (~2,000 realistic participants) plus a handful of real-data imports, because collecting real patient data requires the IRB/legal/vendor gates in [DELIVERY.md §2](DELIVERY.md) that don't fit in a month and shouldn't be faked. Every screen carries a discreet `DEMO DATA` watermark, and the demo script tells Kevin exactly which layers are real code versus simulated feeds. That honesty *is* the pitch: "everything you just touched is real software; the only thing simulated is the patients — and SPEC.md is the plan for the real ones."

**Reserve strategy per your instruction:** nothing is hidden wholesale. Every capability appears in the demo arc. The reserve line runs *inside* each capability — the working core is what Kevin sees unprompted; the reserve layer is revealed when his interest points there, and doubles as the menu for "what do you want to add?"

---

## 2. The demo arc (what Kevin experiences, ~25 minutes)

One narrative, two doors, one person: **"Marcus," 52, Wichita.**

| Act | What happens on screen |
|---|---|
| **1. The retail door** | Marcus shops for a Tempur-Pedic at The Mattress Hub. Associate shows him a QR code; on a phone *in the room*, Kevin takes the STOP-BANG screener himself. Marcus screens high-risk → the app offers a Sleeptopia home sleep test. Consumer consent flow, wearable connect, mattress SKU attaches at checkout with a delivery date ten days out. |
| **2. The clinic door** | Marcus's HST comes back: AHI 24, supine AHI 41 — positional OSA, flagged automatically from an uploaded HST report the system actually parses. Sleep-coach screen: combined consent + authorization e-signed, CPAP setup recorded, his retail record **links** to his clinical record (Lane C) with one more consent. |
| **3. Time machine** | The demo's engine: a simulation clock. Advance 10 days — his baseline wearable data accumulates *before* the mattress arrives and CPAP starts. Advance 90 days — nightly CPAP telemetry, wearable sleep, under-mattress sensor data, and day-30/90 surveys stream in; every dashboard recomputes in front of Kevin. |
| **4. Three views of Marcus** | Participant view (his own trends, on the phone); coach portal (adherence funnel, data-quality flags); and the before/after outcome card: supine time down, ESS down, adherence solid. |
| **5. The research engine** | Zoom out from Marcus to the cohort: 2,000 participants. The **positional-OSA flagship dashboard** — supine-time and outcome trends by mattress model and firmness, CPAP vs. appliance vs. combination comparisons. The money screen. |
| **6. The compliance spine** | Side-by-side: Marcus identified vs. Marcus in the research mart (dates shifted, identifiers gone). Then the finale of this act: **revoke Marcus's consent live** — watch his feeds stop and his record quarantine in real time. Not a slide. Enforcement Kevin can trigger himself. |
| **7. The business layer** | Partner portal ("Tempur-Sealy view"): de-identified outcomes by their models behind a DUA gate. AI recommendation cards with guardrail labels. The exec funnel: STOP-BANG screens → HST referrals → new Sleeptopia patients, with dollar estimates. A mock study abstract generated from the cohort. |
| **8. The reveal** | "Everything you touched is working software. Here's what's simulated, here's what's in reserve, and here's the plan ([SPEC.md](SPEC.md)/[DELIVERY.md](DELIVERY.md)) to make the patients real." |

---

## 3. Element-by-element: working core vs. reserve

Legend — **Working**: real code Kevin interacts with. **Powered by**: what feeds it (real vs. synthetic). **Reserve**: built or stubbed, revealed on interest; the "what to add" menu.

### Act 1–2: The two doors

| Capability | Working in the demo | Powered by | Held in reserve |
|---|---|---|---|
| STOP-BANG screener | Fully functional scoring + risk routing, mobile web, Kevin takes it live | Real published scoring rules | SMS follow-up sequences; multi-store analytics; Spanish version |
| Consumer consent (Lane B) | Real e-consent flow, plain-language, granular per-data-class toggles that actually gate collection; **now working: deletion-request workflow** — participant page files a "Request deletion", the compliance console (`/compliance/deletions`) executes it: every consent revoked, identified-tier rows hard-deleted with per-table counts, participant tombstoned, printable certificate issued; the append-only consent ledger survives and already-published de-identified releases are immutable (SPEC §9.4, stated on screen) | Draft instrument text (watermarked "pre-counsel") | Counsel-final language; versioned re-consent flow |
| Clinical consent + authorization (Lane A) | Coach-led enrollment screen with signature capture, consent recorded to the real consent engine | Built-in signature pad | E-signature vendor (DocuSign-class) integration; audit-grade document vault |
| HST intake | Upload a sample HST report → parsed → AHI/supine-AHI extracted → positional-OSA flag computed automatically | 2 report formats (one structured CSV, one PDF) | Format library for additional HST vendors; quarantine/human-verify queue UI |
| Lane C linkage | Retail record + clinic record joined on-screen after linkage consent | Real matching on the demo identity service | Probabilistic matching with review queue; the full segregated-ICS architecture (demo uses a simplified split) |
| Mattress SKU attach | POS mini-form with a **real catalog** — actual Tempur-Pedic lines + other Mattress Hub brands, firmness/material attributes | Public product data, hand-curated (~60 SKUs) | Full catalog import tooling; barcode scan; delivery-date webhook from POS |

### Act 3–4: Data in motion

| Capability | Working in the demo | Powered by | Held in reserve |
|---|---|---|---|
| Time machine | Simulation clock advancing days/weeks; all ingestion, rollups, and dashboards recompute live | Synthetic data engine (below) | — (demo-only mechanism, retired in production) |
| Synthetic cohort | ~2,000 participants with literature-realistic distributions: ~50% positional OSA, real adherence decay curves, plausible effect sizes, missingness patterns per SPEC §6.5; **now working: effect-size scenario switcher** — `SCENARIO=null npm run seed` rebuilds the same cohort with the mattress supine effect ≈ 0 (medium band flat; the selection-bias conversation) | Generator built on the [TECHNICAL.md §T2](TECHNICAL.md) data model — **this is the same synthetic generator production needs** for staging, so it isn't throwaway | Additional scenarios (effect-size sweeps, dropout stress tests) on the same switcher |
| Wearable data | Nightly sleep/HR/HRV/SpO2 streaming into dashboards; **plus a real import: Ben's own Apple Health export** — "this chart is my actual sleep" | Synthetic stream + Apple Health XML / Fitbit CSV import (real, working parsers) | **Live aggregator OAuth** (Terra/Vital sandbox — apply week 1, connect week 3 if granted; demo-day live-connect if stable); Garmin/Samsung specifics |
| CPAP telemetry | AirView-format file ingestion → adherence hours, residual AHI, leak dashboards; therapy-gap shown as an outcome | Synthetic files in the real AirView export format | **OSCAR SD-card parser run on a real card from the store** (stretch — the single most persuasive artifact for Kevin if a card can be obtained); myAir patient-consent mock flow |
| Under-mattress sensor | Nightly position/restlessness/snore data driving the supine-time trends | Synthetic stream in Withings Sleep Mat data shape | **A real Withings Sleep Mat (~$100 — recommend buying week 1)** under a bed at Ben's for the final two weeks: real nights, real mat, live in the demo |
| Oral appliance arm | Nightly wear self-report + dentist record-entry form + adherence chart; **now working: DentiTrac import preview** — a plausible wear-time export (bundled fixture or upload) parses live to nights + mean wear hours on /coach/import; preview only, no writes, "pilot integration" banner | Synthetic + PRO engine; DentiTrac fixture in the real export shape | DentiTrac live feed (vendor agreement → ingest through the consent gate); dentist-partner portal concept |
| PRO engine | ESS and ISI fully implemented with day-30/90 cadence firing in the time machine; scores trend on dashboards | Real instruments, real scoring | PSQI, FOSQ-10 (placeholders pending licensing — flag on screen); SMS delivery channel |

### Act 5–6: Research & compliance

| Capability | Working in the demo | Powered by | Held in reserve |
|---|---|---|---|
| Cohort explorer | Filter by severity, treatment, mattress model/firmness, demographics; counts and outcome summaries update live; **now working: saved cohorts** — name the current filter URL and keep it as a demo-prep bookmark on `/research` (consent-filtered count snapshotted at save, live count on open; stores the query string only, never participant ids) | Real queries on the synthetic cohort | Cross-user cohort sharing/permissions; full stats workbench/notebooks |
| Positional-OSA flagship dashboard | Supine-time % and outcome deltas by mattress model vs. baseline, with confidence intervals; the SPEC §6.3 study, visualized; **now working: power calculator** — `/research/power` makes the §6.3 sketch interactive (normal approximation, unit-tested: 10 pp / SD 20 → 63–64 per group) and overlays live consent-filtered instrumented counts per firmness band with powered / not-yet-powered chips; **now working: 95% CIs on the headline band deltas** — member-level pre→post supine change per firmness band, ± half-width and n, on the dashboard itself; **now working: bias & robustness views** — `/research/robustness`: missingness by data class (% of expected nights present, by month), the attrition/consent-change timeline projected straight from the immutable consent ledger (enrollments, full + per-class revocations, restores, re-consents, deletions per sim-month), a resting-HR negative control by firmness band (flat = reassuring, annotated why), an E-value sensitivity note for the flagship delta (VanderWeele–Ding, plain-language sentence), and a seed-stamped scenario banner that warns when the server's `SCENARIO` env disagrees with what the database was seeded with | Precomputed nightly on synthetic cohort; consent-aware aggregate modules | SAP viewer; pragmatic-trial design mock; negative-control *exposure* panels |
| Treatment comparisons | CPAP vs. appliance vs. mattress-only vs. combos, unadjusted means with the confounding caveat displayed; **now working: 95% CIs on arm deltas** — error bars on both outcome panels plus a mean ± CI (n) table | Precomputed analyses | Interactive covariate adjustment; propensity-score estimates; target-trial emulation walkthrough |
| Consent engine (the spine) | **Real**: every query path in the demo is gated by consent state — this is production semantics ([TECHNICAL.md §T2.6](TECHNICAL.md)), not a facade | Demo consent records | Full audit-log UI; BAA/DUA document management |
| Revocation | **Live kill switch**: revoke Marcus → feeds stop, record quarantines, mart tombstones — in front of Kevin, reversible for the next demo run; **now working: partial revocation** — a per-data-class toggle grid on the console (revoke only wearable sleep → wearable charts block while CPAP keeps flowing; append-only scope revisions, restore works); **now working: deletion + certificate** — `/compliance/deletions` executes the stronger right (hard delete + tombstone, ledger retained, no restore button on purpose) and issues a printable per-table-count certificate | Real enforcement code | Retention-policy scheduler; batch deletion tooling |
| De-identification | Side-by-side identified vs. de-identified record: date-shifting and suppression actually applied; mart extract downloads as CSV; **now working: OMOP bundle export** — DUA-gated zip of PERSON / OBSERVATION_PERIOD / MEASUREMENT / DEVICE_EXPOSURE CSVs mapped per TECHNICAL.md §T2.5 from de-identified data only | Real pipeline (simplified: date-shift + suppression, no ED opinion yet); custom OMOP vocabulary for concepts without standard codes | Full LOINC/SNOMED vocabulary alignment; expert-determination documentation panel; re-identification red-team report mock |

### Act 7: The business layer

| Capability | Working in the demo | Powered by | Held in reserve |
|---|---|---|---|
| Partner portal | "Tempur-Sealy view": DUA-gate splash → de-identified outcomes for their models vs. category average; **now working: sponsored-study proposal generator** — SPEC §6.3–6.4 preset questions + cohort filters + duration → printable one-pager with LIVE consent-filtered, k-suppressed feasibility counts and the §12.4 price band, "rough band, not a quote" line verbatim | Real queries, de-id tier only | Wearable-vendor validation view; payer outcomes view |
| AI recommendations | Recommendation cards for demo personas — comfort, adherence-support, "discuss with your provider" — each labeled with its guardrail class and the data behind it; **now working: "AI narrative (preview)" toggle** — multi-sentence drafted narratives composed per card from the participant's real data (deterministic templates, no network; banned-phrase tests cover them; each labeled "production uses a governed LLM, SPEC §10.4"); **now working: governed-LLM scaffolding (no LLM called)** — every card is generated evidence-first from a typed, consent-scoped EvidenceBundle ("View evidence" expander on each card: claim → data table → the gated query behind it), emitted through the zod `RecommendationDraft` schema, and screened by a SafetyCheck chain (banned-phrase denylist + claim–evidence-linkage check + guardrail-class validator); every check is logged per card to the ModelDecisionLog (`model=templates-v1`, version, checks, sim date) and visible read-only at `/compliance/model-log`; provider-class cards queue for clinician review (badge + "Mark reviewed (demo)" stub); `RECS_MODE=templates` is the documented permanent fallback engine | Rules-based engine (deterministic, defensible) + template narrative composer emitting through the governed pipeline | The governed LLM itself behind the same schema/chain/log (prompting, evaluation, semantic safety classifiers); real clinician-review workflow |
| Exec/business dashboard | Enrollment funnel, STOP-BANG → HST referral conversions with revenue estimate, cohort growth vs. §3.5 targets; **now working: revenue-model calculator** — §12.4 lines (studies / subscriptions / validation, counts × price with the honest bands shown) vs. a configurable operating-cost line, highlighting the §3.5 month-36 self-funding bar; URL-param scenarios like the funnel card | Real queries + configurable assumptions | Multi-site projection |
| Research output | Mock conference abstract auto-populated from live cohort stats | Template + real numbers | Methods-paper skeleton; ClinicalTrials.gov registration mock |

**What we deliberately do not build for the demo** (and say so): production security hardening, HIPAA-grade infrastructure, native mobile apps (participant view is responsive web shown on a phone), real vendor integrations beyond those listed, and anything that collects a real patient's data.

---

## 4. Build plan: four weeks, agent-staffed

Stack: **Next.js + TypeScript + Tailwind/shadcn + Postgres (Supabase), deployed to Vercel** — one URL, opens on a laptop and phone in the room, nothing to install. Demo code is scaffolding for production, not throwaway: the consent-gating semantics, data model subset, and synthetic generator carry straight into the [DELIVERY.md](DELIVERY.md) build.

| Week | Focus | Exit test |
|---|---|---|
| **1 (Jul 8–14)** | Scaffold + data model + **synthetic cohort generator** + consent engine + both enrollment flows. Apply for aggregator sandbox; order Withings mat; request a store SD card | Enroll a participant through both doors; consent gates provably block/allow queries |
| **2 (Jul 15–21)** | Time machine + all ingestion simulators (wearable/CPAP/sensor/PRO) + real-import parsers (Apple Health, AirView-format) + participant view + coach portal | Marcus's full 90-day arc runs clean, end to end |
| **3 (Jul 22–28)** | Research layer: cohort explorer, flagship dashboard, comparisons, de-id pipeline + mart view, revocation demo, recommendations, partner portal, exec dashboard | Every Act 5–7 screen live on synthetic cohort; revocation drill 5/5 |
| **4 (Jul 29–Aug 3)** | Polish, demo watermarks, reserve-layer toggles, seeded personas, **demo script + rehearsal ×3**, bug bash, deploy freeze Aug 1 | Full 25-min arc runs without touching a keyboard except where scripted; works on hotel wifi via phone hotspot |

**Agent staffing** (scaled-down [DELIVERY.md §3](DELIVERY.md)): **4–5 build agents** in parallel — (1) data model + synthetic generator, (2) enrollment/consent flows, (3) ingestion + time machine, (4) dashboards/analytics, (5) polish/integration — plus **1 verification agent** that never writes product code: it runs a demo-acceptance checklist daily (arc click-through completes, consent gates hold, revocation drill passes, every screen loads < 2s, phone rendering correct) and files failures as issues. **You are the review bottleneck as the only human** — that's why it's 5 agents, not 12; more would queue behind you.

**Buffer honesty:** week 4 contains no new features by design. If week 2 slips, the cut order is: LLM narrative toggle → live aggregator attempt → second HST format → oral-appliance dentist form (falls back to pre-seeded records). The demo arc itself is never cut.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Aggregator sandbox approval doesn't arrive in time | It's a reserve element; synthetic + real-file imports carry the wearable story |
| Scope creep from "just one more screen" | The reserve tables above are the scope fence; additions go to reserve, not to week 3 |
| Solo human review bandwidth | 5-agent cap; verification agent catches regressions daily; weeks have single themes |
| Demo-day fragility | Deploy freeze Aug 1; local fallback build on the laptop; seeded database snapshot restored before each run; rehearsed ×3 |
| Kevin asks "is this real patient data?" | The watermark and the Act 8 reveal answer it before he asks — trust preserved, production pitch teed up |

## 6. Decisions needed from you (this week)

1. **Approve the stack/hosting** (Vercel + Supabase; ~$0–25 for the month) — or say the word if you'd rather build it on a different platform.
2. **Buy the Withings Sleep Mat now** (~$100) so it has two weeks of real nights before the demo — recommended.
3. **Can you get a CPAP SD card** (yours, a willing friend's, or a store demo unit's) for the OSCAR stretch goal?
4. **Your Apple Health / Fitbit export** for the "this is my real sleep" moment — takes you five minutes; say yes and I'll include the import step in week 2.
5. **Demo date/format**: in-person at the store with laptop + phone, or screen-share? (Affects rehearsal setup only.)
