# setup-ghl.mjs — Sleeptopia GHL provisioning runbook

Provisions the data model from `ghl-plan.md` (§2.1–§2.2) into the Sleeptopia
sub-account via GoHighLevel API v2. Idempotent — re-running never duplicates;
existing objects are reported as "exists, skipped".

## Prerequisites

- Node 18+ (uses built-in `fetch`; zero npm dependencies).
- A `ghl.env` file (never committed) containing:
  `GHL_PIT_TOKEN` — Private Integration token (Settings > Private Integrations),
  scoped at minimum to `locations/customFields.readonly` + `.write`,
  `locations/tags.readonly` + `.write`, `opportunities.readonly`.
  `GHL_LOCATION_ID` — the sub-account's Location ID.
- CONFIG state (top of the script), as of Aug 28:
  - `TEAM` — filled from Kevin's Aug 27 "Sales" email (7 addresses). Two
    display names are known; the rest fall back to the email local-part and
    print as "confirm display name". `SALES_REPS` is derived from this list.
  - `SCRIPT_ROUTING` — filled from Kevin's Aug 27 routing email
    (fax 888-510-0314 / Orders@Sleeptopia.com); drives checklist step 2.
  - `REFERRING_PRACTICES` — still empty, pending Kevin's practice list.
    While empty, the dropdowns and `src:physician:*` tags that depend on it
    are skipped with a "needs input" note — fill and re-run any time.

## Run (dry run first, always)

```sh
set -a; . ./ghl.env; set +a
node setup-ghl.mjs --dry-run   # read-only: GETs + "would create" report
node setup-ghl.mjs             # provision for real
```

Exit code 1 means at least one object failed; raw API error bodies are in the
report. Token is never printed (masked to 8 chars).

## What it creates

- **Contact custom fields:** Lead Source Type, Referring Practice, Referring
  Physician, Sales Rep (source), Order ID, Order Total, Order Items, Sleep
  Test Type, Resupply Interval (days), UTM Source/Medium/Campaign/Term/Content.
- **Opportunity custom fields** (the audit hedge — dashboards filter on
  opportunity-level data): mirrors of Lead Source Type, Referring Practice,
  Sales Rep (source). UTM detail intentionally stays contact-level.
- **Tags:** `src:physician`, `src:mattresshub`, `src:website-order`,
  `resupply-active`, plus `src:physician:<practice>` / `src:rep:<name>`
  generated from CONFIG.
- No custom values are created — nothing in the plan needs one.

## What it deliberately leaves for the in-app session (and why)

- **Pipelines ("Patient Journey", "Shop Orders") and lost reasons:** the
  public API v2 is read-only here — `GET /opportunities/pipelines` and
  `GET /opportunities/lost-reason` exist, but there is no create endpoint
  (confirmed against GHL's official OpenAPI specs; creation is an open
  feature request, GoHighLevel/highlevel-api-docs#248). The script verifies
  both pipelines' exact stages and prints creation steps if missing.
- **Workflows (incl. the Inbound Webhook trigger), forms, QR links,
  dashboards:** no public provisioning API. The script ends with a numbered
  in-app checklist pre-filled with the field keys, tag names and stage names
  it just created, including where the webhook URL goes (`ORDER_WEBHOOK_URL`).

## API ambiguities we documented instead of guessing

1. **Dropdown options on create:** the documented create schema for
   `POST /locations/{id}/customFields` has **no options property**, while the
   read schema returns `picklistOptions`. The script sends `options:
   [strings]` (the long-standing v1/community shape), then **verifies** by
   re-reading the field; if the options didn't persist it flags the field
   "needs attention" with the exact values to add in-app (~30 seconds).
2. **Pipeline `stages` element shape** is under-documented in the spec; the
   verifier accepts both string and `{name}` elements.
3. **Custom Fields V2 API** (`/custom-fields/`) explicitly supports only
   Custom Objects and Company today — contact/opportunity fields must go
   through the locations endpoint, which is what the script uses.
4. `MONETORY` is GHL's documented spelling for the monetary field type; the
   script uses it as-is for Order Total.

## Handoff note

The Private Integration token used for this build gets **rotated and
re-scoped (least privilege, read-mostly) at handoff** — delete the build
token in Settings > Private Integrations and issue a fresh one for whatever
stays automated.
