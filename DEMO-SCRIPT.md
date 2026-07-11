# DEMO-SCRIPT.md — the rehearsal document

Ben: this is the script. Rehearse from it end to end at least three times. Every URL, button
label, and number below was verified against the built app. Marcus's participant id, inline
everywhere you need it: `d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17`.

---

## 1. Pre-demo runbook (the hour before)

Work from `app/` in the repo. Do these in order; total ~10 minutes plus rehearsal margin.

1. **Kill stray servers** (a stale server serving an old build already bit us once):
   ```
   ps aux | grep "[n]ext-server" | awk '{print $2}' | xargs -r kill -9
   ```
   Then confirm port 3000 is free: `lsof -i :3000` should print nothing.
2. **Pristine cohort**: `npm run seed` — takes ~80 s, deterministic (same numbers every
   run). Watch the last lines: clock lands at **June 30, 2026 = day 90**, and
   `Marcus Reed: d81a5f64-… (cpap_mattress, AHI 24, supine 41)`. If that line is wrong, stop
   and re-run before doing anything else.
3. **Production build + start**: `npm run build` then `npm run start`. Never demo `next dev`.
4. **Warm every route once** (primes caches; also your smoke test — every line must say 200):
   ```
   M=d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17
   for r in / /enroll/retail /enroll/clinic /timemachine /coach /coach/import /research \
     /research/positional /research/compare /research/deid /research/abstract \
     /research/power /research/robustness /compliance/revocation /compliance/deletions \
     /compliance/model-log /partner /partner/releases /exec /dev/status \
     /participant/$M /participant/$M/trends /participant/$M/recommendations \
     /participant/$M/receipt; do
     curl -s -o /dev/null -w "%{http_code} $r\n" "http://localhost:3000$r"; done
   ```
5. **Open the bookmark set**, one tab, in this order (the demo is bookmark → click → talk):
   - `http://localhost:3000/` — the demo map lives at the bottom of the home page
   - `http://localhost:3000/enroll/clinic`
   - `http://localhost:3000/timemachine`
   - `http://localhost:3000/participant/d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17/trends`
   - `http://localhost:3000/coach`
   - `http://localhost:3000/research`
   - **Pre-filtered cohorts worth their own bookmarks** (filters live in the URL — say so):
     - `http://localhost:3000/research?supine=y&arm=mattress_only` — supine-predominant, mattress only: the flagship question
     - `http://localhost:3000/research?severity=moderate&arm=cpap_mattress` — people like Marcus
     - `http://localhost:3000/research?door=retail` — everyone the store door produced
   - `http://localhost:3000/research/positional`
   - `http://localhost:3000/research/deid`
   - `http://localhost:3000/compliance/revocation`
   - `http://localhost:3000/partner`
   - `http://localhost:3000/exec`
   - `http://localhost:3000/participant/d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17/recommendations`
   - `http://localhost:3000/research/abstract`
   - `http://localhost:3000/dev/status`
6. **Phone on the same wifi** for the Act 1 screener beat: find the laptop's LAN address
   (`ipconfig getifaddr en0` on macOS, `hostname -I` on Linux), open
   `http://<laptop-ip>:3000/enroll/retail` on the phone, leave it on the welcome step.
   Optional but good theater: a printed QR code pointing at that URL — "this is what's by
   the pillow wall."
7. **Fallbacks staged**: during final rehearsal, screenshot every act into
   `demo-screenshots/` at the repo root (one per act, named `act1.png` … `act8.png`), and
   print `/research/abstract` (browser Print — it has a print stylesheet, comes out as a
   clean one-pager). Screenshots folder + printed abstract on the desktop before Kevin sits down.
8. **Quiet the machine**: close every other tab and app, Do Not Disturb on laptop AND phone,
   power connected, volume off.

---

## 2. The 25-minute arc

Eight acts, one person — Marcus, 52, Wichita. Timing budget sums to ~25:00. The clock is
seeded at day 90, so Marcus's whole 90-day story is already in the data; Kevin creates a
*second* participant (himself) live along the way.

### Act 1 — The retail door (3:30) · phone: `/enroll/retail`
1. Hand Kevin the phone on the welcome step. He types his name, taps **Start my sleep check**.
2. He answers the eight STOP-BANG questions himself, taps **See my result**.
3. On the risk card, tap **Yes — set me up with a home sleep test**.
4. On "Your data, your call," flip **one toggle off** — any one — then **I agree — create my profile**.
5. Tap one wearable tile (note the on-screen line: "simulated connection — live OAuth in reserve"), **Continue**.
6. Search the catalog ("Tempur"), pick a mattress, **Record my purchase**.

**Narration:** "This is the store floor. A QR code by the pillow wall, eight friendly
questions, and the app just told you whether a sleep test is worth your time. Notice what it
asked you before it took anything — every toggle you just saw is enforced by the platform,
not filed in a drawer."

**Watch for:** the consent step — if Kevin toggles off questionnaires, the confirmation
screen tells him his screener answers were *dropped at the door*. Point at it. That's the
consent engine, thirty seconds in.

### Act 2 — The clinic door (3:30) · `/enroll/clinic`
1. On **Patient intake**, use the lookup: type Kevin's name, find the retail record just created.
2. **Consent & authorization**: sign the pad with the trackpad — theatrically bad signature is fine.
3. **Home sleep test**: click **Use sample CSV export** — AHI and supine AHI parse out, the
   positional-OSA flag computes on screen.
4. **CPAP setup**: record it.
5. **Record linkage**: one more consent joins the store record to the clinic record.

**Narration:** "Same person, other door. The coach reads a real home-sleep-test file — the
system parsed it, found the apnea is positional, and flagged it, no human squinting at a PDF.
And that last click is the interesting one: the store half and the clinic half of this person
only connect because they said yes a second time."

**Watch for:** the positional flag appearing automatically after the HST parse.

### Act 3 — The time machine (2:00) · `/timemachine`
1. Point at the big date — June 30, day 90 of Marcus's journey.
2. Click **+7 days**. It runs ~21 seconds, chunked, date walking forward.

**Narration while it runs (fills the wait — do not stand in silence):** "The platform is
generating a week of nights for two thousand people right now — wearable sleep, CPAP
telemetry, the under-mattress sensor, questionnaires coming due — and every single row is
passing through the same consent gates production will use. This is the demo's engine: the
patients are synthetic, the plumbing is real."

**Watch for:** the registry totals card recomputing when the run finishes — observations up
by tens of thousands.

### Act 4 — Three views of Marcus (4:00) · trends bookmark, then `/coach`
1. Open Marcus's **trends** page. Walk top to bottom: treatment timeline, sleep, CPAP bars,
   time-on-back, HR/HRV, SpO2, ESS/ISI columns.
2. Point at the dashed markers: mattress delivered April 14, CPAP April 15 — one combined
   "Mattress + CPAP" label.
3. Open the **coach portal**. Funnel tiles, adherence funnel, data-quality flags, patient list —
   Marcus by name (Lane C), most others as pseudonymous ids.

**Narration:** "This is Marcus's own phone view. Watch the time-on-back line — that's the
under-mattress sensor, and it drops right at the delivery marker. His new Tempur-ProAdapt
did that, and we can *see* it. Now the same person from his coach's chair: two thousand
consented patients, both doors, and the ones whose wearable went quiet or whose CPAP sat
unused for five nights float to the top. Names only appear where a linkage consent exists —
that's why most of this list is codes, not people."

**Watch for:** the supine-time line stepping down at the delivery marker; hollow red columns
on the CPAP chart — "abandonment is an outcome we measure, not missing data."

### Act 5 — The research engine (4:00) · `/research`, then filtered bookmarks, then `/research/positional`
1. Cohort explorer: show the headline count, click two filter pills, or jump straight to the
   pre-filtered bookmarks.
2. Open the **positional flagship dashboard**.
3. If time allows, one beat on `/research/compare` — the confounding callout card.

**Narration:** "Zoom out from Marcus to all two thousand. Every filter is a URL — any cohort
is a bookmark I can send a researcher. And here's the money screen: supine sleep time by
week, one line per firmness band. The medium band drops about eleven points and stays down;
soft and firm don't move. That's the study Kevin has been describing for years, running on
this platform — on synthetic patients, with the honest caveats printed on the card, n's and
all."

**Watch for:** the medium-firmness line diving at week 0 while soft and firm stay flat.

### Act 6 — The compliance spine (3:30) · `/research/deid`, then `/compliance/revocation`
1. De-identification: Marcus identified on the left, his research-mart self on the right —
   dates shifted, identifiers gone. Click **Export research extract (CSV)**.
2. Revocation console: click **Revoke all consents — Marcus Reed**. Read the before/after
   table out loud. Flip to `/coach` or `/research` if you want the drop shown live elsewhere.
3. Click the purple **Restore consents (demo reset)** before leaving the page. Every time.

**Narration:** "Same person, two truths: the clinic sees Marcus, research sees a shifted,
stripped record. And now the part nobody demos — Marcus changes his mind. [click] Feeds
stop, the cohort count just went down by one, his name vanished from the coach's list, and
the write gates now throw errors. That's not a policy document; you just watched enforcement.
[restore] And the audit trail keeps every step — revocation flips records, it never deletes."

**Watch for:** the red "←" arrows in the before/after table; the research-cohort count
decrementing; ingest probes flipping from "allows" to "throws."

### Act 7 — The business layer (3:00) · `/partner`, `/exec`, recommendations, `/research/abstract`
1. Partner portal: the DUA gate — **Accept & enter (demo)** — then the Tempur-Sealy dashboard.
2. Exec dashboard: the funnel — 796 screens → 743 at-risk → 743 HSTs → 597 therapy patients →
   **$767,700** at default assumptions. Change one assumption, **Recompute**.
3. Marcus's recommendations — two cards, each with a guardrail badge.
4. The abstract: "every number on this page is a live query."

**Narration:** "Tempur-Sealy sees outcomes for their models — behind a signed agreement,
de-identified, no cell smaller than eleven people. Your funnel: those 796 screens include
the one you took twenty minutes ago, and the dollar figure is your assumptions, editable,
not my promises. And this abstract wrote itself from the live cohort — advance the clock and
the numbers change."

**Watch for:** the funnel's screen count ticking up by one from Kevin's Act 1 screener.

### Act 8 — The reveal (1:30) · `/dev/status` + the honesty crib below
Read the crib (section 4). Close with SPEC/DELIVERY.

---

## 3. Reserve-reveal cheat sheet ("if Kevin asks about X")

| If Kevin asks about… | Say (the honest one-liner) | Exists today | To build it for real |
|---|---|---|---|
| **Live wearable OAuth** (Apple/Fitbit/Garmin) | "Connections are simulated today, but the file importers are real — I can show you a real Apple Health export parsing right now." | Simulated connect in enrollment; working Apple Health XML + AirView CSV parsers at `/coach/import` (sample buttons) | Terra/Vital sandbox app + OAuth + webhooks; ~1–2 weeks of work, gated on vendor approval |
| **CPAP SD-card parse** | "We ingest the AirView export format for real; reading a raw SD card from a store machine is the next artifact on the list." | AirView-format ingestion working end to end | OSCAR-style card parser; days of work once a real card is in hand |
| **Real Sleep Mat** | "The sensor stream is synthetic tonight, but it's in the exact Withings data shape — a $100 mat under a real bed makes it real data." | Synthetic stream in Withings Sleep Mat shape driving every supine chart | Buy the mat, Withings API OAuth, two weeks of real nights before the next demo |
| **LLM / "real AI" narratives** | **Now working — show it:** "Flip the purple 'AI narrative (preview)' toggle on Marcus's recommendations — every card grows a drafted narrative composed from his real numbers. Then open 'View evidence' on any card: every claim links to the exact data and the consent-gated query behind it. Every card you just saw went through a zod schema and a three-layer safety chain — denylist, claim–evidence linkage, guardrail class — and `/compliance/model-log` shows the check trail per card, with provider-class cards queued for clinician review. Deliberately template-based today (`RECS_MODE=templates` is the permanent fallback); a governed LLM would slot behind the same schema, chain, and log (SPEC §10.4)." | Narrative toggle + evidence expanders live on `/participant/<id>/recommendations`; schema + safety chain + ModelDecisionLog live at `/compliance/model-log` (model=templates-v1); banned-phrase discipline is now a runtime check AND a test | The governed LLM itself behind the same schema/chain/log (prompting, evaluation, semantic safety classifiers); real clinician-review workflow; days to prototype, governance is the real work — and its rails are already up |
| **DentiTrac** (appliance telemetry) | **Now working — show it:** "Open the DentiTrac tab on `/coach/import` and load the bundled export — nights and mean wear hours parse live. Preview only by design: the write path waits on the vendor agreement." | DentiTrac tab with bundled fixture, parse + preview (no DB writes), pilot banner | Vendor agreement + live feed, then ingest through the same consent gate |
| **PSQI / FOSQ questionnaires** | "ESS and ISI are fully implemented — PSQI and FOSQ are flagged on screen as pending licensing, which we won't fake." | ESS + ISI real instruments, real scoring, day-30/90 cadence | License the instruments; the PRO engine is generic, days each to add |
| **Partial revocation** (per-data-class) | **Now working — show it:** "On the revocation console, toggle just 'Wearable sleep' off — his wearable charts block everywhere while CPAP keeps flowing, and the ledger shows the appended scope revision. Restore it the same way." | Per-class toggle grid on `/compliance/revocation` (append-only scope revisions, full before/after report), enforcement tests across every surface | Retention-policy scheduler; batch tooling |
| **Deletion / "right to be forgotten"** | **Now working — show it:** "File 'Request deletion' on a participant page, then execute it on `/compliance/deletions` — every consent revokes, every identified-tier row hard-deletes with per-table counts on screen, and the printable certificate cites the retained append-only ledger. Stronger than revocation, and there's no restore button on purpose. One honest limit, stated in the consent: already-published de-identified releases can't be recalled (SPEC §9.4)." | Request → execute → certificate live end to end; tombstoned participant page; tests prove hard delete + ledger survival + every gated surface serving nothing | Counsel-final deletion terms per instrument; retention-policy automation |
| **"Is the study big enough?" / power** | **Now working — show it:** "`/research/power` is the SPEC §6.3 sketch, interactive — 10 pp at SD 20 lands at 63–64 per group (unit-tested), and the firmness bands below it are live consent-filtered counts with powered / not-yet chips." | Power calculator on the normal approximation + live instrumented-band overlay | SAP viewer; pragmatic-trial design mock |
| **Sponsored studies / "what would one cost?"** | **Now working — show it:** "On the partner dashboard, 'Draft a study proposal' — pick a §6.3–6.4 question, narrow the cohort, and the one-pager fills in live consent-filtered feasibility n (k-suppressed like everything a partner sees) and the §12.4 band, with 'rough band, not a quote' printed on it." | Proposal generator behind the DUA gate, printable; feasibility n consent-filtered and suppression-tested | Contracting/SOW workflow; wearable-vendor validation view |
| **Revenue model / "when does it pay for itself?"** | **Now working — show it:** "The revenue-model calculator on `/exec` — §12.4 lines with their honest bands against a configurable operating-cost line; the chip turns green exactly at §3.5's month-36 bar (partner revenue covers operating costs). Assumptions, not bookings — it says so." | Calculator with URL-param scenarios on the exec dashboard | Multi-site projection; bottoms-up cost model |
| **Saved cohorts / demo prep** | **Now working — show it:** "Any filtered cohort on `/research` can be named and saved — the bookmarks list links straight back, with the consent-filtered count snapshotted at save time. It stores the filter URL, never participant ids." | Save/list/delete on `/research` (query string + count snapshot only) | Cross-user sharing/permissions; stats workbench |
| **OMOP / registry-standard export** | **Now working — show it:** "On `/research/deid`, 'Export OMOP bundle' downloads a DUA-gated zip — PERSON, OBSERVATION_PERIOD, MEASUREMENT, DEVICE_EXPOSURE, mapped per TECHNICAL.md §T2.5 from de-identified rows only." | OMOP bundle export live behind the DUA gate; leakage-scanned in tests | Full LOINC/SNOMED vocabulary alignment; ED documentation panel |
| **Effect-size scenarios** ("what if mattresses do nothing?") | **Now working — show it (offline):** "`SCENARIO=null npm run seed` rebuilds the identical cohort with the mattress effect zeroed — the medium band on the flagship dashboard goes flat. That's the selection-bias conversation, runnable. The seed stamps the scenario into the database, and `/research/robustness` states which scenario is loaded — with a warning banner if the server's `SCENARIO` env disagrees. Re-seed with the default before the demo." | Null-effect scenario seed, deterministic, labeled on the seed output ("scenario: null") + seed-stamped scenario banner with env-mismatch warning | More scenarios (effect sweeps, dropout stress) on the same switcher |
| **"Can I trust these dashboards?" / bias & robustness** | **Now working — show it:** "`/research/robustness` interrogates the flagship result before believing it: missingness by data class per month, consent churn charted straight from the append-only ledger, a resting-heart-rate negative control by firmness band — flat, and the page explains why flat is the reassuring answer — and an E-value sensitivity note saying how strong a hidden confounder would have to be to explain the delta away. The flagship dashboard and treatment comparisons now carry 95% CIs too." | Full robustness page live, consent-filtered end to end; CI error bars/± text on `/research/positional` and `/research/compare`; negative-control flatness and E-value math unit-tested | Negative-control exposures; propensity diagnostics; pre-registered SAP viewer |
| **Native mobile apps** | "Everything you held tonight is responsive web — that's a deliberate demo choice, and the production plan covers apps." | Phone-ready web for every participant surface | Production decision per SPEC/DELIVERY; months, not a demo item |
| **Tempur-Sealy API / full catalog** | "Tonight's catalog is sixty real SKUs, hand-curated. The portal they'd log into is the thing you just used." | DUA-gated partner portal on live de-id queries; real product data | Partner integration agreement, catalog feed + POS delivery webhook; weeks once they engage |

Rhythm for every row: *honest one-liner → show what exists → name the build.* Never say
"that's fake" — say "that's the reserve layer, and here's what it takes."

### The audit-pedigree card ("how do I know it's solid?")

Kevin may ask, in some form, "this is impressive, but how do I know it actually works and
isn't just a pretty shell?" This is the strongest answer you have, and it's true:

"Before you saw it, this codebase was attacked four separate ways. Two outside auditors — one
running on Codex, one on ChatGPT — went at it adversarially, plus independent AI reviewers who
wrote none of the code and were told to *break* the consent and deletion enforcement. Every
round found something real. Every finding is in the repo with its fix and the evidence that the
fix holds — `AUDIT-RESPONSE.md` and `AUDIT-RESPONSE-v2.md`. The consent engine got rebuilt from
the ground up after the second audit: deletion is genuinely irreversible, consent can never be
restored beyond what a person actually signed, and the partner-facing numbers are banded so no
one can subtract their way back to an individual. Two hundred and ninety-five automated tests
run on every change. That paper trail *is* the answer — this isn't 'trust me,' it's 'here's the
folder.'" (If he wants proof on screen: `/compliance/model-log` for the AI governance trail,
`/compliance/revocation` for the live per-class enforcement, and the two `AUDIT-RESPONSE` files
for the pedigree.)

---

## 4. The honesty crib (Act 8 — read it nearly verbatim)

"Let me draw the line for you exactly, because the line is the pitch.

**Real code — you touched it tonight:** both enrollment doors; the consent engine gating
every single read and write you saw; the STOP-BANG scoring; the HST parser that flagged
Marcus; the Apple Health and AirView file importers; the de-identification pipeline, its
CSV export and the OMOP bundle; the revocation enforcement you triggered yourself — down to
a single data class; the drafted AI narratives on the recommendation cards; every dashboard,
running live queries; the abstract that wrote itself.

**Synthetic — and labeled that way on every screen:** the two thousand patients and every
night of their data. The distributions are from the literature — half positional, realistic
adherence decay, realistic dropout — and the funnel models full referral acceptance, which
real life won't. Marcus is scripted. The watermark in the corner never lied to you.

**In reserve — built to the seam, shown on request:** live wearable connections, the SD-card
parse, a real sleep mat, the governed LLM behind the narrative toggle (the drafted preview is
live), the DentiTrac live feed (its import preview is live), the licensed questionnaires,
native apps, and the Tempur-Sealy integration.

Everything you touched is working software. The only simulated thing is the patients — and
SPEC.md is the blueprint for making them real, with DELIVERY.md as the timeline. That's the
conversation I want to have next."

---

## 5. Failure playbook

| Symptom | Do this |
|---|---|
| A page hangs or renders oddly | Refresh once. Still broken → keep talking, open `demo-screenshots/` (repo root), narrate from the act's screenshot, return to the live app at the next act. |
| Time machine interrupted mid-advance | It's chunked in ≤7-day server actions — the clock stopped safely at a chunk boundary. Just click again; it continues from where it stopped. |
| Marcus left revoked from a previous run | `/compliance/revocation` → purple **Restore consents (demo reset)**. Check `/coach` shows his name again. (This is why the runbook re-seeds: seed always restores him.) |
| Wrong numbers / stale build suspicion | You're on an old server. Kill by PID (runbook step 1), `npm run start`, re-warm. If time allows, re-seed first. |
| Total app failure | Screenshots folder + the printed abstract. The arc still works as a talk: doors → time machine → Marcus → cohort → kill switch → business. Close with the honesty crib — it needs no software. |
| Phone won't reach the app | Laptop and phone on the same network, no VPN, use the LAN IP not localhost. Worst case: do Act 1 in a narrow browser window on the laptop and hand Kevin the trackpad. |

One rule under pressure: **never debug in front of Kevin.** Fall back, keep the story moving,
fix it after.
