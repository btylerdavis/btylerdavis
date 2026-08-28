# Sleeptopia — GoHighLevel Build Plan

**Prepared for:** Ben (Cato Consulting Group), then Kevin (owner, Sleeptopia)
**Date:** 2026-08-26
**Scope:** Sleep clinic + DME with online shop, Wichita KS. Lead sources to track: referring physicians, The Mattress Hub retail partnership, 4 named sales reps, and website orders (site already POSTs order JSON to an env-configurable `ORDER_WEBHOOK_URL`).

**Honesty note:** Every feature named below exists in GoHighLevel today and was verified against GHL's help portal / developer docs or multiple independent write-ups (sources in the Appendix). Prices are quoted only where GHL or multiple sources publish them, and all should be re-confirmed in-app before Kevin commits — GHL changes billing periodically. Nothing in this document is built yet; this is a plan.

---

## 1. Ranked Feature List

Ranked by expected impact for Kevin. Effort = setup effort in a Ben-led build (Low ≈ under an hour, Medium ≈ a working session, High ≈ multiple sessions or ongoing maintenance).

| # | Feature | Why it matters for Kevin | Effort |
|---|---------|--------------------------|--------|
| 1 | **Pipelines & Opportunities** | The sales tracker itself — every patient/order becomes a card moving through named stages with a dollar value, an owner (rep), and a source. This is the thing Kevin looks at. | Low–Med |
| 2 | **Custom Fields & Tags** | The attribution backbone. Fields like `lead_source_type`, `referring_practice`, `sales_rep` are what make "where did this patient come from?" answerable in one click. Everything else depends on this being set up first and used consistently. | Low |
| 3 | **Inbound Webhook trigger + Workflows** | Receives the website's order JSON directly (the `ORDER_WEBHOOK_URL` design maps 1:1 onto GHL's Inbound Webhook workflow trigger), creates/updates the contact, and drops an opportunity into the pipeline automatically. Zero manual entry for online orders. Note: it's a "premium" trigger billed per execution from the agency wallet (reported at $0.01/execution with a small free allowance — confirm current rate in Agency Settings). | Med |
| 4 | **Forms & Surveys** | Per-practice physician referral form and a Mattress Hub partner form. GHL-native forms also feed GHL's built-in attribution (UTM capture), which third-party-created contacts don't get. | Low |
| 5 | **Dashboards & Reporting** | GHL's customizable dashboards include 17 Opportunities widget types filterable by pipeline, stage, status, **assignee** (per-rep) and **attribution source** — this is most of what Kevin asked for, no code. Two caveats in §3 (Option A): dashboard availability depends on the plan tier (verify in-app), and filtering on our contact-level custom fields is not explicitly documented — the workflows mirror attribution onto each opportunity as the hedge. | Low |
| 6 | **Attribution / UTM tracking + Trigger Links** | GHL natively stores utm_source/medium/campaign/term/content on contacts with First and Latest attribution. Trigger Links give per-rep/per-partner trackable links with server-side click logging. Caveat: contacts created via API/webhook often show "Third-Party" in native attribution — which is exactly why #2 (our own fields/tags) is ranked above this. | Low–Med |
| 7 | **SMS & Email (LC Phone/Email)** | Appointment reminders, "your sleep test shipped," resupply reminders, review requests. Requires A2P 10DLC brand/campaign registration before SMS sends reliably in the US — start that paperwork early. | Med |
| 8 | **Calendars & Booking** | Online booking for consults/setups; Round Robin calendar type can distribute bookings across the 4 reps automatically. Other types (Service, Class, Collective) exist if needed. | Low–Med |
| 9 | **Reputation Management + Review QR** | Automated Google review requests by SMS/email after a completed setup or paid invoice, plus GHL's built-in review QR code for the counter/packaging. High leverage for a local clinic competing on Google Maps. | Low |
| 10 | **Phone numbers & call tracking** | Dedicated GHL tracking numbers per source (one printed on Mattress Hub materials, one on physician referral pads) attribute inbound calls by source; call recording is available. Number *pools* (session-level swapping) also exist but are overkill at Sleeptopia's volume — start with one number per source. | Med |
| 11 | **Invoicing, Payments, Documents & Contracts** | Stripe-connected invoices (one-off and recurring), Text2Pay links, and e-sign documents that can auto-generate an invoice on signing. Useful for cash-pay DME and rental agreements. Insurance-billed claims stay in the existing billing system — GHL does not do medical claims. | Med |
| 12 | **Workflow AI / Conversation AI** | Conversation AI can answer common inbound SMS/webchat questions ("do you take my insurance?" → qualified answer + booking link). Billed usage-based or via GHL's "AI Employee" unlimited add-on (widely reported at $97/mo — verify current in-app pricing before enabling). Recommend phase 2, after the tracker works. | Med |
| 13 | **Voice AI** | An AI phone agent for after-hours calls exists and is priced per-minute (engine + TTS rates changed May 2026 — verify in-app). For a medical-adjacent business, keep humans on the phone initially; revisit only for after-hours overflow. | Med–High |
| 14 | **Memberships / Courses / Communities** | Exists and works, but honestly not a fit today. A future "CPAP basics" patient-education mini-course is plausible; a community is not. Skip for now. | — |

**Not recommended now:** Voice AI (13), Memberships/Communities (14), call-tracking number pools (within 10). Listed for completeness so Kevin knows they exist and why we're deferring.

**Compliance flag (decide early):** GHL offers a HIPAA compliance add-on with a signed BAA (reported at $297/mo at the agency level, activated per sub-account via an Advanced Settings toggle; activation can take up to 72 hours and GHL states it can't be downgraded once signed). Whether Sleeptopia needs it depends on what enters GHL: names + order info for shop products is one conversation; sleep-test status and physician-read results are protected health information territory. **Recommendation: assume the pipeline stages below will hold PHI-adjacent data and price the HIPAA add-on into the proposal; get Kevin's counsel/biller to confirm.** This is a legal question we should not answer for him.

---

## 2. Sales-Tracker Architecture

### 2.1 Data model

**One sub-account** (location) for Sleeptopia. All objects below live in it.

**Users (4 + admins):** each sales rep gets a GHL user seat. Rep attribution = the opportunity's **assigned user** — this is what per-rep dashboard widgets filter on. Kevin and Ben get admin seats.

**Contact custom fields** (Settings → Custom Fields):

| Field | Type | Purpose |
|---|---|---|
| `Lead Source Type` | Dropdown: Physician Referral / Mattress Hub / Sales Rep / Website Order / Other | The one field every report groups by |
| `Referring Practice` | Dropdown (one option per practice) | Per-practice physician reporting |
| `Referring Physician` | Text | Doctor-level detail within a practice |
| `Sales Rep (source)` | Dropdown: the 4 reps | Who *sourced* the lead (can differ from who *owns* the opportunity) |
| `Order ID` | Text | From website order JSON |
| `Order Total` | Monetary/number | From website order JSON |
| `Order Items` | Text | Human-readable summary from JSON |
| `Sleep Test Type` | Dropdown: HST / In-lab / N/A | Clinical routing |
| `Resupply Interval (days)` | Number | Drives resupply reminder workflow |

**Tags** (cheap, layerable, dashboard-filterable): `src:physician`, `src:physician:<practice-slug>`, `src:mattresshub`, `src:rep:<name>`, `src:website-order`, plus lifecycle tags like `resupply-active`.

Why both fields *and* tags: fields are clean for reporting dropdowns; tags are what workflows branch on and what quick contact filters use. Both are set by the same workflow, so no double entry.

**Mirror attribution onto the opportunity too:** the fields above live on the *contact*, and GHL's docs do not explicitly confirm that Opportunities dashboard widgets can filter on contact-level custom fields/tags (see the Option A caveat in §3). So every intake/ingest workflow below also stamps the source onto the **opportunity itself at creation** (opportunity-level custom fields / the opportunity's source value), keeping per-source widgets on opportunity-level data either way.

### 2.2 Pipeline: "Patient Journey"

One pipeline, stages matching Kevin's actual operational flow:

1. **New Referral / Intake** — lead exists, insurance/eligibility being verified
2. **Test Ordered** — sleep test dispatched or scheduled
3. **Test Completed** — data back from patient
4. **Physician Read** — interpretation returned by the reading physician
5. **Treatment Started** — CPAP/oral appliance setup done; invoice/payment attached
6. **Resupply Active** — recurring supply cadence running (terminal "won" stage for reporting; a workflow adds the `resupply-active` tag and starts the reminder loop)

Drop-offs are handled with GHL's built-in opportunity **Lost** status + lost-reason (e.g., "insurance denied", "patient declined", "no response") rather than extra stages — lost-reason breakdowns are a native dashboard widget.

**Second pipeline: "Shop Orders"** — for website DME/accessory orders that are *not* clinical patients: **Order Received → Fulfilled → Review Requested**. Keeping e-commerce out of the Patient Journey pipeline keeps Kevin's clinical conversion numbers honest. An order from an existing patient still updates the same contact (upsert by email/phone), so lifetime value stays on one record.

### 2.3 Source-by-source implementation

Each row states the exact GHL objects/automations involved.

**(a) Referring doctors — per-practice referral links/QR + referral form**

- **GHL Form** ("Physician Referral") with patient fields + hidden/prefilled practice field. One shared form; each practice gets its own URL with query parameters (`?practice=heartland-pulmonology&utm_source=physician&utm_campaign=heartland-pulmonology`). GHL forms capture UTM into native attribution, and the practice value maps to the `Referring Practice` field.
- **QR codes** printed on referral pads/rack cards per practice, each encoding that practice's URL. (GHL's built-in QR generator is aimed at review collection; for these referral QRs any static QR generator pointed at the parameterized form URL works — the tracking lives in the URL, not the QR.)
- **Workflow** ("Physician Referral Intake"): trigger = Form Submitted → set `Lead Source Type` = Physician Referral, set `Referring Practice`, add tags `src:physician` + `src:physician:<practice>` → Create Opportunity in Patient Journey @ New Referral / Intake (source mirrored onto the opportunity, §2.1) → notify assigned rep (round-robin or by territory) → send patient a welcome SMS/email.
- **Reporting:** dashboard widget = opportunities grouped/filtered by the practice attribution — the source mirrored onto the opportunity, or the `src:physician:*` tags / `Referring Practice` field where the widget builder supports contact-level filters (§2.1 note) → "which practices actually send us patients."

**(b) The Mattress Hub — dedicated QR/UTM + partner form**

- **GHL Form** ("Mattress Hub In-Store") — short: name, phone, "interested in: sleep test / snoring consult / shop." URL carries `utm_source=mattresshub&utm_medium=retail`.
- **QR standee/cards** in-store encoding that URL; optionally a **dedicated GHL phone number** printed on Mattress Hub materials so walk-in phone calls attribute correctly (inbound call on that number → workflow tags `src:mattresshub`).
- **Workflow** ("Mattress Hub Intake"): Form Submitted (or call on the dedicated number) → `Lead Source Type` = Mattress Hub, tag `src:mattresshub` → Create Opportunity @ New Referral / Intake (source mirrored onto the opportunity, §2.1) → fast-response SMS (retail leads go cold in hours, not days).
- **Reporting:** one widget filtered on the Mattress Hub attribution (the mirrored opportunity source, or the `src:mattresshub` tag where contact-level filters are supported — §2.1 note) = the partnership's actual pipeline value. This is the number that decides whether the partnership deal is worth renewing.

**(c) 4 sales reps — assigned user + per-rep tracking links**

- Each rep = **GHL user**; every opportunity they source or work is **assigned** to them (workflow sets assignee; manual entries default to the creating user).
- **Per-rep tracking links:** each rep gets personalized URLs (`utm_content=rep-jane`) for their outreach, built as GHL **Trigger Links** where used inside GHL emails/SMS (server-side click logging) or plain UTM URLs on their business cards/QRs. Submissions through a rep's link set `Sales Rep (source)` and tag `src:rep:<name>`.
- **Round Robin calendar** (optional) distributes inbound consult bookings across the 4 reps evenly.
- **Reporting:** Opportunities widgets natively filter by **assignee** — per-rep pipeline value, win rate, and stage aging come out of the box.

**(d) Website orders — `ORDER_WEBHOOK_URL` → Inbound Webhook → contact upsert + opportunity**

- **Workflow** ("Website Order Ingest") with trigger = **Inbound Webhook** (a GHL premium workflow trigger). Creating the trigger generates a unique URL; **that URL becomes the value of `ORDER_WEBHOOK_URL`** in the site's environment config. No site code changes needed — this is exactly the integration the site was built for.
- Payload: the site's existing order JSON. GHL requires one sample POST to learn the shape, then every field becomes mappable inside the workflow. JSON is the only accepted format — which the site already sends.
- **Workflow steps:** map payload → create/update contact by email/phone (dedupes returning customers onto one record) → set `Order ID` / `Order Total` / `Order Items` / `Lead Source Type` = Website Order, tag `src:website-order` → **Create/Update Opportunity** in Shop Orders @ Order Received with monetary value = order total and the source attribution mirrored onto the opportunity at creation (§2.1) → confirmation email/SMS → (later) review-request branch after fulfillment.
- **Attribution caveat (honest):** contacts created via webhook/API typically show "Third-Party" in GHL's *native* attribution report. Our own fields/tags carry the truth instead — and if the site captures UTM params at checkout, include them in the JSON payload and map them to fields, restoring marketing attribution for orders too.
- **Fallback option (only if needed):** if order payloads turn out to need transformation GHL's mapper can't do, point `ORDER_WEBHOOK_URL` at a ~50-line serverless relay that calls GHL **API v2** (`POST /contacts/upsert`, then the Opportunities create/upsert endpoint) using the Private Integration token server-side. Recommend trying the native inbound webhook first — no code, no credentials in play, mapping visible to Ben inside GHL.

### 2.4 Automations beyond intake (phase 1.5)

- **Stage-change nudges:** opportunity sits in Test Ordered > 10 days → task for the assigned rep + patient reminder SMS.
- **Resupply loop:** entering Resupply Active starts a recurring workflow (wait `Resupply Interval` days → reorder SMS with Text2Pay or shop link → repeat).
- **Review engine:** invoice paid / opportunity → Treatment Started or Shop Order Fulfilled → wait 3 days → Google review request (Reputation Management), plus the review QR at the front desk.

---

## 3. Dashboard Options Memo

**Kevin's actual asks:** (1) where patients/orders come from — by practice, Mattress Hub, rep, website — and (2) rep performance, both at a glance.

### Option A — GHL-native dashboards

**Pros**
- Ships in the first build session; zero code, zero hosting, and — **on a plan tier that includes custom dashboards** (see the tier caveat below) — no cost beyond the GHL subscription.
- Opportunities widgets (17 types) filter by pipeline, stage, status, **assignee**, and attribution source, with multiple chart types — per-rep and per-source views are directly supported, provided the attribution in §2.1 is populated (it is, by workflow, not by humans).
- Multiple dashboards with per-user permissions: a "Kevin" dashboard and a per-rep view (tier-dependent — see below).
- Maintained by GHL; when they add widgets, Kevin gets them at no extra charge.

**Cons**
- **Tier caveat (verify in-app before promising "free"):** multiple/custom dashboards have historically been gated to GHL's higher tiers (the $297/$497-era plan gating); their availability on the $97 Starter plan is unconfirmed. The recommendation stands either way, but "zero extra cost" is conditional on Kevin's plan tier actually including custom dashboards — confirm in-app (or with the agency plan's rebilling) during the first build session, before it's presented to Kevin as free.
- **Filter surface not explicitly documented:** GHL's docs confirm Opportunities widgets filter by pipeline/stage/status/assignee/attribution, but do **not** explicitly confirm filtering by *contact-level* custom fields/tags (where §2.1's attribution fields live). Mitigation, built into the architecture: the intake/ingest workflows mirror the attribution onto each **opportunity at creation** (§2.1), so per-source widgets can work from opportunity-level data; verify the exact widget filter surface in-app during the first build session.
- Design control is limited to GHL's widget grid — it will look like GHL, not like a bespoke report.
- Kevin views it logged into GHL, or on his phone via the LeadConnector app — which shows pipeline snapshots; whether custom widget dashboards render fully on mobile should be verified in-app. No public wall-mounted URL without a login.
- Cross-source blended custom metrics (e.g., "revenue per Mattress Hub dollar spent") are only as flexible as the widget/condition builder.
- Native *marketing* attribution is unreliable for webhook-created contacts (the "Third-Party" issue) — mitigated by our custom fields, but it means leaning on filtered widgets rather than the built-in attribution report.

### Option B — Custom dashboard on Vercel reading GHL API v2

**Pros**
- Total design control: exactly the layout Kevin wants, his branding, a big-screen mode for the office TV.
- Arbitrary computed metrics and blending with non-GHL data (e.g., Shopify history, ad spend).
- API v2 with a **Private Integration token** (created per sub-account under Settings → Private Integrations, sent as a Bearer token with a Version header) covers contacts, opportunities, and users — everything the views need. Documented rate limits (100 requests/10s burst, 200,000/day per app per location, with `X-RateLimit-*` headers) are far above Sleeptopia's volume; rate limits are a non-issue at this scale.

**Cons**
- Real build cost (est. 2–4 dev days for v1) and permanent maintenance: GHL API version bumps, pagination quirks, token rotation, uptime.
- Auth must be built (the token must live server-side in Vercel env vars — never in the browser — and the page itself needs login protection so pipeline data isn't public).
- Hosting is cheap-to-free at this scale on Vercel's hobby/pro tiers, but it's another vendor and another thing that can break at 7am.
- Data freshness: either poll (mind the daily limit — fine here) or wire GHL outbound webhooks into a store, which is more moving parts.

### Recommendation: **Option A now; revisit B only on a proven gap.**

Both of Kevin's stated asks — source attribution and rep performance at a glance — are directly served by native Opportunities widgets filtered on assignee and on the source attribution this architecture stamps on every record (contact *and* opportunity). Option A delivers that in the first build session at zero incremental cost **provided Kevin's plan tier includes custom dashboards — verify in-app (tier caveat above)** — and its weaknesses (visual polish, blended cross-vendor metrics) are not things Kevin has asked for. Building B first would spend Kevin's money on design control before we know he needs it. The architecture keeps the door open deliberately: because attribution lives in our own fields/tags (not GHL's native attribution report), a Vercel dashboard reading API v2 later needs **no data-model changes** — same fields, same pipeline, prettier glass. Decision trigger for revisiting B: Kevin asks for a login-free TV display, or a metric the widget builder demonstrably can't produce.

---

## 4. What's Needed from Ben / Kevin

### Access & credentials (Ben to provide separately — never in this doc, never in code; env vars only)

1. **GHL sub-account** for Sleeptopia (under Ben's agency) + **admin user invite** for the builder.
2. **Private Integration token** for that sub-account (Settings → Private Integrations → Create; scope it to contacts, opportunities, and users read at minimum — least privilege) + the **Location ID**. → Delivered via env vars / secret manager, not chat or docs.
3. **Premium Triggers & Actions enabled** at the agency level (required for the Inbound Webhook trigger) with rebilling settings confirmed.
4. Access to the website's deploy environment (or the person who has it) to set `ORDER_WEBHOOK_URL`, plus **one sample order JSON payload**.

### Decisions & materials (Kevin)

5. **HIPAA decision** (§1 compliance flag) — before any clinical data enters GHL.
6. The **4 reps' names/emails/mobiles**; the **list of referring practices** (for the dropdown + QR batch); Mattress Hub contact for placing in-store materials.
7. **Business details for A2P 10DLC SMS registration** (legal name, EIN, address, website) — submit day one; approval is not instant.
8. **Stripe account** connection approval (if cash-pay invoicing is in scope for phase 1).
9. Google Business Profile access (for review integration).

### First build session (ordered, once access lands)

1. Sub-account hygiene: business profile, timezone, users (4 reps + admins), A2P registration submitted.
2. Custom fields + tag conventions (§2.1) — everything else depends on these.
3. Pipelines: Patient Journey + Shop Orders, with lost reasons.
4. **Website Order Ingest workflow**: create Inbound Webhook trigger → send sample payload → map fields → contact upsert + opportunity + tags → hand the webhook URL to whoever sets `ORDER_WEBHOOK_URL` → end-to-end test with a real test order.
5. Physician Referral form + one pilot practice URL/QR; Mattress Hub form + QR.
6. Intake workflows (a) and (b) wired to the pipeline.
7. Dashboards: "Kevin" dashboard (pipeline value by source, per-rep board, lost reasons) + rep view.
8. Smoke test all four source paths; only then schedule session 2 (reminders, resupply loop, reviews, invoicing).

---

## Appendix — Verification sources

- Inbound Webhook workflow trigger (premium): [GHL Help — Workflow Trigger: Inbound Webhook](https://help.gohighlevel.com/support/solutions/articles/155000003147-workflow-trigger-inbound-webhook), [GHL Help — Inbound Webhook Premium Trigger](https://help.gohighlevel.com/support/solutions/articles/48001237383-how-to-use-the-inbound-webhook-workflow-premium-trigger)
- Premium triggers/actions enablement & rebilling: [GHL Help — LC Premium Triggers & Actions](https://help.gohighlevel.com/support/solutions/articles/48001231559-how-to-enable-and-rebill-lc-premium-triggers-actions-for-workflows)
- Opportunities dashboard widgets (filters incl. assignee/attribution): [GHL Help — Opportunities Widgets in Dashboards & Reports](https://help.gohighlevel.com/support/solutions/articles/155000008109-opportunities-widgets-in-dashboards-reports)
- Private Integration tokens: [GHL Marketplace docs — Private Integrations Token](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/)
- API v2 opportunities endpoints: [GHL Marketplace docs — Upsert Opportunity](https://marketplace.gohighlevel.com/docs/ghl/opportunities/upsert-opportunity/index.html), [Create Opportunity](https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity/index.html)
- Rate limits (100/10s burst, 200k/day per app per location): [GHL API guides](https://ghllogic.com/gohighlevel-api-documentation-guide/), corroborated by [grow-highlevel.com](https://www.grow-highlevel.com/blog/gohighlevel-api-guide)
- UTM/attribution behavior & third-party caveat: [GHLFocus — GoHighLevel Attribution Explained](https://ghlfocus.com/gohighlevel-attribution-explained/), [Automate the Journey — UTM tracking in GHL](https://automatethejourney.com/blog/how-to-track-utm-in-gohighlevel)
- Review QR code: [GHL Help — Digital QR Code for Review Generation](https://help.gohighlevel.com/support/solutions/articles/155000002775-how-to-set-up-digital-qr-code-for-maximising-review-generation)
- Recurring invoices / Text2Pay / Documents & Contracts: [GHL Help — Recurring Invoices](https://help.gohighlevel.com/support/solutions/articles/48001219440-how-to-create-and-manage-recurring-invoices-in-highlevel), [GHL Help — Auto-generate invoices from signed documents](https://help.gohighlevel.com/support/solutions/articles/155000004063-automatically-generate-invoices-from-signed-documents-contracts)
- HIPAA add-on & BAA: [GHL Help — HIPAA Compliance with HighLevel](https://help.gohighlevel.com/support/solutions/articles/48000983084-hipaa-compliance-with-highlevel)
- Call tracking / number pools: [Growthable — Call Tracking (Number Pool) in GHL](https://growthable.io/gohighlevel-tutorials/phone/how-to-set-up-call-tracking-number-pool-in-gohighlevel/)
- AI features & reported pricing (verify in-app): [netpartners — GHL AI pricing 2026](https://netpartners.marketing/gohighlevel-ai-pricing/), [aigohighlevel.com — AI pricing](https://aigohighlevel.com/gohighlevel-ai-pricing/)
