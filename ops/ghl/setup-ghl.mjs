#!/usr/bin/env node
/**
 * setup-ghl.mjs — Sleeptopia GoHighLevel provisioning script
 *
 * Implements the data model from ghl-plan.md (§2.1–§2.2) against the
 * GoHighLevel / LeadConnector public API v2.
 *
 *   node setup-ghl.mjs --dry-run   # read-only preview (GETs only, no writes)
 *   node setup-ghl.mjs             # provision for real
 *
 * Credentials come from the environment only (never hard-code, never commit):
 *   set -a; . ./ghl.env; set +a; node setup-ghl.mjs
 *
 * Required env vars:
 *   GHL_PIT_TOKEN    Private Integration token (Settings > Private Integrations)
 *   GHL_LOCATION_ID  Sub-account / location id
 *
 * What it provisions (idempotent — safe to re-run any number of times):
 *   1. Contact custom fields (attribution + order + clinical, per plan §2.1)
 *   2. Opportunity custom fields mirroring the attribution fields
 *      (the audit hedge: dashboards filter on opportunity-level data,
 *       nothing depends on unconfirmed contact-field widget filtering)
 *   3. Tags (src:* + lifecycle)
 *   4. Pipelines: VERIFIED ONLY. The public API v2 has no create-pipeline
 *      endpoint (GET /opportunities/pipelines is the only pipeline route in
 *      the official OpenAPI spec; creation is an open feature request,
 *      GoHighLevel/highlevel-api-docs#248). The script checks whether the
 *      two pipelines exist with the plan's exact stages and prints precise
 *      in-app creation steps if not.
 *   5. Prints the manual, in-app checklist for everything the public API
 *      cannot provision (workflows/inbound webhook, forms, QR links,
 *      dashboards, lost reasons), pre-filled with the field keys, tag names
 *      and stage names it just created/verified.
 *
 * Zero npm dependencies. Node 18+ (built-in fetch). ESM.
 */

// ---------------------------------------------------------------------------
// CONFIG — what comes from Kevin (plan §4, item 6). The script is
// idempotent, so a re-run only adds what is missing: fill a list whenever
// he sends it and run again. While a list is empty, the fields and tags
// that depend on it are reported as "skipped (needs input)" instead of
// being created with made-up values.
//   TEAM + SCRIPT_ROUTING  — filled Aug 28 from his two Aug 27 emails.
//   REFERRING_PRACTICES    — still outstanding.
// ---------------------------------------------------------------------------

const REFERRING_PRACTICES = [
  // "Heartland Pulmonology",
  // "Example Sleep & Lung Clinic",
];

// The team that needs GHL seats (Kevin, Aug 27, subject "Sales"). Addresses
// are his verbatim. Display names: the two we know for real, and the email
// local-part for the rest (Ben, Aug 28: "just use the first part of the
// emails") — a placeholder nobody will mistake for a legal name, easy to
// correct in-app and here.
const TEAM = [
  { email: "lyan@sleeptopia.com", name: "Lyan", placeholder: true },
  { email: "martyr@sleeptopia.com", name: "Marty Roche" },
  { email: "johnm@sleeptopia.com", name: "Johnm", placeholder: true },
  { email: "Victorg@sleeptopia.com", name: "Victorg", placeholder: true },
  { email: "Cholem@sleeptopia.com", name: "Cholem", placeholder: true },
  { email: "kkunz@sleeptopia.com", name: "Kevin Kunz" },
  { email: "jamif@sleeptopia.com", name: "Jamif", placeholder: true },
];

// Where a patient's uploaded prescription has to land (Kevin, Aug 27:
// "either to Fax 888-510-0314 or Orders@Sleeptopia.com"). Ben, Aug 28:
// build the email route only for now; the email-to-fax relay is his
// question for Kevin at their meeting today.
const SCRIPT_ROUTING = {
  email: "Orders@Sleeptopia.com",
  fax: "888-510-0314",
  buildFaxRelay: false,
};

// Attribution dropdown values. Everyone on the team list is included: an
// unused option costs nothing, a missing one loses attribution. Trim in-app
// (or here, then re-run) once Kevin says who carries a book of business.
const teamLabel = (m) => m.name ?? m.email.split("@")[0].toLowerCase();
const SALES_REPS = TEAM.map(teamLabel);

// ---------------------------------------------------------------------------
// Constants — API + plan data model
// ---------------------------------------------------------------------------

const API_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28"; // required Version header on every call

const LEAD_SOURCE_OPTIONS = [
  "Physician Referral",
  "Mattress Hub",
  "Sales Rep",
  "Website Order",
  "Other",
];

// Contact custom fields — plan §2.1 table + UTM capture fields (§2.3d:
// the site includes UTM params in the order JSON; these fields receive them,
// since native attribution shows "Third-Party" for webhook-created contacts).
const CONTACT_FIELDS = [
  { name: "Lead Source Type",         dataType: "SINGLE_OPTIONS", options: LEAD_SOURCE_OPTIONS },
  { name: "Referring Practice",       dataType: "SINGLE_OPTIONS", options: REFERRING_PRACTICES, needsInput: "REFERRING_PRACTICES" },
  { name: "Referring Physician",      dataType: "TEXT" },
  { name: "Sales Rep (source)",       dataType: "SINGLE_OPTIONS", options: SALES_REPS, needsInput: "SALES_REPS" },
  { name: "Order ID",                 dataType: "TEXT" },
  { name: "Order Total",              dataType: "MONETORY" }, // GHL's documented spelling of monetary
  { name: "Order Items",              dataType: "LARGE_TEXT" },
  { name: "Sleep Test Type",          dataType: "SINGLE_OPTIONS", options: ["HST", "In-lab", "N/A"] },
  { name: "Resupply Interval (days)", dataType: "NUMERICAL" },
  { name: "UTM Source",               dataType: "TEXT" },
  { name: "UTM Medium",               dataType: "TEXT" },
  { name: "UTM Campaign",             dataType: "TEXT" },
  { name: "UTM Term",                 dataType: "TEXT" },
  { name: "UTM Content",              dataType: "TEXT" },
];

// Opportunity mirrors of the three attribution fields (plan §2.1 "Mirror
// attribution onto the opportunity too"). Same display names — the fieldKey
// namespace differs by model (contact.* vs opportunity.*), so no collision.
// UTM detail deliberately stays contact-level; per-source widgets only need
// these three on the opportunity.
const OPPORTUNITY_FIELDS = [
  { name: "Lead Source Type",   dataType: "SINGLE_OPTIONS", options: LEAD_SOURCE_OPTIONS },
  { name: "Referring Practice", dataType: "SINGLE_OPTIONS", options: REFERRING_PRACTICES, needsInput: "REFERRING_PRACTICES" },
  { name: "Sales Rep (source)", dataType: "SINGLE_OPTIONS", options: SALES_REPS, needsInput: "SALES_REPS" },
];

// Tags — plan §2.1. Per-practice / per-rep tags are generated from CONFIG.
const STATIC_TAGS = [
  "src:physician",
  "src:mattresshub",
  "src:website-order",
  "resupply-active",
];

// Pipelines — plan §2.2. Verify-only (no public create endpoint, see header).
const PIPELINES = [
  {
    name: "Patient Journey",
    stages: [
      "New Referral / Intake",
      "Test Ordered",
      "Test Completed",
      "Physician Read",
      "Treatment Started",
      "Resupply Active",
    ],
  },
  {
    name: "Shop Orders",
    stages: ["Order Received", "Fulfilled", "Review Requested"],
  },
];

// Lost reasons — plan §2.2 (read-only endpoint; verified, not created).
const LOST_REASONS = ["Insurance denied", "Patient declined", "No response"];

// ---------------------------------------------------------------------------
// Bootstrap: flags + env. Refuse to start without credentials; never print
// the token (masked to its first 8 characters everywhere).
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");

const TOKEN = process.env.GHL_PIT_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!TOKEN || !LOCATION_ID) {
  console.error("ERROR: GHL_PIT_TOKEN and GHL_LOCATION_ID must be set in the environment.");
  console.error("Run it like this (ghl.env is the untracked file holding both):");
  console.error("  set -a; . ./ghl.env; set +a; node setup-ghl.mjs --dry-run");
  process.exit(1);
}

const maskedToken = TOKEN.slice(0, 8) + "…";
console.log(`GoHighLevel provisioning for Sleeptopia ${DRY_RUN ? "(DRY RUN — no writes)" : ""}`);
console.log(`  location: ${LOCATION_ID}`);
console.log(`  token:    ${maskedToken} (masked)`);
console.log("");

// ---------------------------------------------------------------------------
// Tiny API client + run report
// ---------------------------------------------------------------------------

/**
 * Call the GHL v2 API. Returns parsed JSON. Throws an Error carrying the raw
 * response body on failure so the report can show the API's own words.
 * Retries once on 429, honoring Retry-After if present (documented limits are
 * 100 req/10s burst — this script stays far below, but be polite anyway).
 */
async function api(method, path, body, _retried = false) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: API_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (res.status === 429 && !_retried) {
    const wait = Number(res.headers.get("retry-after")) || 10;
    console.log(`  (rate limited; waiting ${wait}s and retrying once)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api(method, path, body, true);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}\n  API response body: ${text || "(empty)"}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} -> HTTP ${res.status} but non-JSON body: ${text.slice(0, 500)}`);
  }
}

// Report buckets. Every provisioned/verified object lands in exactly one.
const report = {
  created: [],       // created this run (or "would create" in dry run)
  exists: [],        // already there, skipped
  needsInput: [],    // waiting on CONFIG lists from Kevin
  needsAttention: [],// created/exists but something to double-check in-app
  manual: [],        // cannot be done via public API — see checklist
  failed: [],        // API call failed; raw error captured
};

function logStatus(bucket, label, detail = "") {
  const prefix = {
    created: DRY_RUN ? "WOULD CREATE" : "CREATED",
    exists: "EXISTS, SKIPPED",
    needsInput: "SKIPPED (NEEDS INPUT)",
    needsAttention: "NEEDS ATTENTION",
    manual: "MANUAL STEP",
    failed: "FAILED",
  }[bucket];
  report[bucket].push({ label, detail });
  console.log(`  [${prefix}] ${label}${detail ? ` — ${detail}` : ""}`);
}

// Lowercased, trimmed comparison — GHL is case-insensitive about tag names
// (it stores them lowercased) and we don't want "Lead Source type" duplicates.
const norm = (s) => String(s ?? "").trim().toLowerCase();

// "Heartland Pulmonology" -> "heartland-pulmonology" (for src:* tags and URLs)
const slugify = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Field keys discovered along the way ("contact.lead_source_type", ...),
// used to pre-fill the printed checklist.
const fieldKeys = {}; // `${model}:${normName}` -> fieldKey or placeholder

// ---------------------------------------------------------------------------
// 1 + 2. Custom fields (contact, then opportunity mirrors)
// ---------------------------------------------------------------------------

async function provisionCustomFields() {
  console.log("== Custom fields ==");

  // One list call covers both models; each item carries its `model`.
  const listing = await api("GET", `/locations/${LOCATION_ID}/customFields?model=all`);
  const existing = listing.customFields ?? [];

  for (const [model, defs] of [
    ["contact", CONTACT_FIELDS],
    ["opportunity", OPPORTUNITY_FIELDS],
  ]) {
    for (const def of defs) {
      const label = `custom field [${model}] "${def.name}"`;
      const found = existing.find(
        // Items without an explicit model are contact fields (the API's default).
        (f) => norm(f.name) === norm(def.name) && (f.model ?? "contact") === model
      );

      if (found) {
        fieldKeys[`${model}:${norm(def.name)}`] = found.fieldKey ?? "(key not returned)";
        logStatus("exists", label, `key: ${found.fieldKey ?? "?"}`);
        // If it's a picklist, make sure the existing options cover the plan's.
        if (def.options?.length && Array.isArray(found.picklistOptions)) {
          const have = found.picklistOptions.map(norm);
          const missing = def.options.filter((o) => !have.includes(norm(o)));
          if (missing.length) {
            logStatus("needsAttention", label,
              `existing dropdown is missing option(s): ${missing.join(", ")} — add them in-app (Settings > Custom Fields)`);
          }
        }
        continue;
      }

      // Dropdown fields whose option list comes from Kevin: don't invent values.
      if (def.needsInput && !def.options?.length) {
        logStatus("needsInput", label,
          `fill CONFIG.${def.needsInput} at the top of this script and re-run (idempotent)`);
        fieldKeys[`${model}:${norm(def.name)}`] = "(created after CONFIG is filled)";
        continue;
      }

      const body = { name: def.name, dataType: def.dataType, model };
      // AMBIGUITY, handled openly (see README): the official create schema for
      // POST /locations/{id}/customFields documents no property for dropdown
      // options, while the read schema returns them as `picklistOptions`.
      // The v1 API and common practice use `options: [...strings]` on create,
      // so we send that — and then VERIFY below instead of trusting it.
      if (def.options?.length) body.options = def.options;

      if (DRY_RUN) {
        logStatus("created", label, `body: ${JSON.stringify(body)}`);
        fieldKeys[`${model}:${norm(def.name)}`] = "(created on real run)";
        continue;
      }

      try {
        const created = (await api("POST", `/locations/${LOCATION_ID}/customFields`, body)).customField ?? {};
        fieldKeys[`${model}:${norm(def.name)}`] = created.fieldKey ?? "(key not returned)";
        logStatus("created", label, `key: ${created.fieldKey ?? "?"}`);

        // Verify dropdown options actually landed (see AMBIGUITY note above).
        if (def.options?.length) {
          let opts = created.picklistOptions;
          if (!Array.isArray(opts) && created.id) {
            const fetched = await api("GET", `/locations/${LOCATION_ID}/customFields/${created.id}`);
            opts = fetched.customField?.picklistOptions;
          }
          const have = (opts ?? []).map(norm);
          const missing = def.options.filter((o) => !have.includes(norm(o)));
          if (missing.length) {
            logStatus("needsAttention", label,
              `API did not store dropdown option(s): ${missing.join(", ")} — add them in-app (Settings > Custom Fields > ${def.name})`);
          }
        }
      } catch (err) {
        logStatus("failed", label, err.message);
      }
    }
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 3. Tags
// ---------------------------------------------------------------------------

async function provisionTags() {
  console.log("== Tags ==");

  const wanted = [
    ...STATIC_TAGS,
    ...REFERRING_PRACTICES.map((p) => `src:physician:${slugify(p)}`),
    ...SALES_REPS.map((r) => `src:rep:${slugify(r)}`),
  ];

  const listing = await api("GET", `/locations/${LOCATION_ID}/tags`);
  const have = new Set((listing.tags ?? []).map((t) => norm(t.name)));

  for (const tag of wanted) {
    const label = `tag "${tag}"`;
    if (have.has(norm(tag))) {
      logStatus("exists", label);
      continue;
    }
    if (DRY_RUN) {
      logStatus("created", label);
      continue;
    }
    try {
      await api("POST", `/locations/${LOCATION_ID}/tags`, { name: tag });
      logStatus("created", label);
    } catch (err) {
      logStatus("failed", label, err.message);
    }
  }

  if (!REFERRING_PRACTICES.length) {
    logStatus("needsInput", "per-practice tags (src:physician:<practice>)",
      "fill CONFIG.REFERRING_PRACTICES and re-run");
  }
  if (!SALES_REPS.length) {
    logStatus("needsInput", "per-rep tags (src:rep:<name>)",
      "fill CONFIG.SALES_REPS and re-run");
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 4. Pipelines + lost reasons — VERIFY ONLY (public API v2 is read-only here)
// ---------------------------------------------------------------------------

async function verifyPipelines() {
  console.log("== Pipelines (verify only — no public create endpoint) ==");

  let existing = [];
  try {
    existing = (await api("GET", `/opportunities/pipelines?locationId=${LOCATION_ID}`)).pipelines ?? [];
  } catch (err) {
    logStatus("failed", "list pipelines", err.message);
    return;
  }

  for (const want of PIPELINES) {
    const label = `pipeline "${want.name}"`;
    const found = existing.find((p) => norm(p.name) === norm(want.name));
    if (!found) {
      logStatus("manual", label,
        `create in-app (Opportunities > Pipelines) with stages, in order: ${want.stages.join(" > ")}`);
      continue;
    }
    // Docs are vague about the stages array's element shape; accept both
    // plain strings and {name} objects defensively.
    const stageNames = (found.stages ?? [])
      .map((s) => (typeof s === "string" ? s : s?.name))
      .filter(Boolean);
    const haveNorm = stageNames.map(norm);
    const missing = want.stages.filter((s) => !haveNorm.includes(norm(s)));
    if (missing.length) {
      logStatus("needsAttention", label,
        `exists but is missing stage(s): ${missing.join(", ")}. Current stages: ${stageNames.join(" > ") || "(none reported)"}`);
    } else {
      logStatus("exists", label, `all ${want.stages.length} planned stages present`);
    }
  }

  // Lost reasons (plan §2.2) — the endpoint is read-only too.
  try {
    const lr = await api("GET", `/opportunities/lost-reason?locationId=${LOCATION_ID}`);
    const have = (lr.lostReasons ?? []).map((r) => norm(r.name));
    const missing = LOST_REASONS.filter((r) => !have.includes(norm(r)));
    if (missing.length) {
      logStatus("manual", "opportunity lost reasons",
        `add in-app (Opportunities settings): ${missing.join(", ")}`);
    } else {
      logStatus("exists", "opportunity lost reasons", LOST_REASONS.join(", "));
    }
  } catch (err) {
    // Non-fatal: some plans/tokens may not expose this read; the checklist covers it.
    logStatus("manual", "opportunity lost reasons",
      `could not verify via API (${err.message.split("\n")[0]}) — ensure these exist in-app: ${LOST_REASONS.join(", ")}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 5. The in-app checklist (everything the public API cannot provision)
// ---------------------------------------------------------------------------

function key(model, name) {
  return fieldKeys[`${model}:${norm(name)}`] ?? "(unknown — check Settings > Custom Fields)";
}

function printChecklist() {
  const practices = REFERRING_PRACTICES.length
    ? REFERRING_PRACTICES.map((p) => `${p} -> ?practice=${slugify(p)}&utm_source=physician&utm_campaign=${slugify(p)}`)
    : ["(practice list pending — fill CONFIG.REFERRING_PRACTICES and re-run for the exact URLs)"];

  console.log(`
============================================================
 IN-APP CHECKLIST — things the public API cannot provision
 (do these in GHL, in this order; paste-ready values below)
============================================================

 1. USERS (Settings > My Staff > Add Employee). Seats for the team Kevin
    listed; do this FIRST — assignment and per-rep dashboards need them:
${TEAM.map((m) => `         ${m.email}  ->  ${m.name}${m.placeholder ? "   (placeholder from the address; swap in the real name when Kevin gives it)" : ""}`).join("\n")}
    Give each "User" role unless Kevin says admin. The display name here
    must match the "Sales Rep (source)" option spelling, or the per-rep
    dashboard filters and the dropdown will disagree.

 2. SCRIPT UPLOAD ROUTING (Kevin, Aug 27). A patient's uploaded
    prescription must reach ${SCRIPT_ROUTING.fax} (fax) or ${SCRIPT_ROUTING.email}.
    a. Form/field: file-upload field "Prescription" on the intake form
       (and on the site's Submit Rx path).
    b. Workflow "Script Received": trigger = that form submitted ->
       Send Email to ${SCRIPT_ROUTING.email} with the file attached and the
       patient name + phone in the subject -> add tag rx-received ->
       move/create opportunity to "Test Ordered" (or "New Referral /
       Intake" if none exists yet) -> internal notification to the
       assigned rep.
    c. Fax path: NOT BUILT for now (Ben, Aug 28). GHL sends no faxes
       natively, and the email route above already satisfies the "either"
       in Kevin's message — staff forward from ${SCRIPT_ROUTING.email} if a
       fax to ${SCRIPT_ROUTING.fax} is needed. Open question for Kevin:
       does he want a paid email-to-fax relay wired up? If yes, set
       SCRIPT_ROUTING.buildFaxRelay = true and add the relay address as a
       second Send Email action in the same workflow.
    d. Verify the file actually attaches (GHL sends upload links rather
       than attachments on some plans — if so, the email carries a link
       and the checklist item is "link is accessible to Orders@").

 3. PIPELINES (if reported MANUAL above): Opportunities > Pipelines.
    - "Patient Journey" stages, in order:
        ${PIPELINES[0].stages.join("  >  ")}
    - "Shop Orders" stages, in order:
        ${PIPELINES[1].stages.join("  >  ")}
    - Lost reasons (opportunity settings): ${LOST_REASONS.join(" / ")}

 4. WEBSITE ORDER INGEST workflow (plan §2.3d):
    a. Agency settings: enable "Premium Triggers & Actions" (Inbound
       Webhook is a premium trigger, billed per execution).
    b. New workflow "Website Order Ingest"; trigger = Inbound Webhook.
       Copy the generated URL — that URL is the new value of the
       website's ORDER_WEBHOOK_URL env var.
    c. Send ONE sample order JSON to the URL so GHL learns the payload
       shape, then map fields in the workflow:
         - create/update contact by email/phone (upsert)
         - ${key("contact", "Order ID")}  <- order id
         - ${key("contact", "Order Total")}  <- order total
         - ${key("contact", "Order Items")}  <- items summary
         - ${key("contact", "Lead Source Type")}  <- "Website Order"
         - ${key("contact", "UTM Source")} / _medium / _campaign / _term /
           _content  <- UTM values if present in the payload
         - add tag: src:website-order
       Then: Create/Update Opportunity -> pipeline "Shop Orders",
       stage "Order Received", monetary value = order total, and set the
       opportunity mirror fields:
         - ${key("opportunity", "Lead Source Type")}  <- "Website Order"

 5. PHYSICIAN REFERRAL form + workflow (plan §2.3a):
    a. Form "Physician Referral" with patient fields + hidden "practice".
    b. Per-practice URLs (one QR each, any static QR generator):
${practices.map((p) => `         ${p}`).join("\n")}
    c. Workflow "Physician Referral Intake": Form Submitted ->
       set ${key("contact", "Lead Source Type")} = "Physician Referral",
       set ${key("contact", "Referring Practice")},
       add tags src:physician + src:physician:<practice-slug> ->
       Create Opportunity in "Patient Journey" @ "New Referral / Intake",
       mirror onto opportunity: ${key("opportunity", "Lead Source Type")},
       ${key("opportunity", "Referring Practice")} ->
       notify assigned rep -> patient welcome SMS/email.

 6. MATTRESS HUB form + workflow (plan §2.3b):
    a. Short form "Mattress Hub In-Store"; URL carries
       ?utm_source=mattresshub&utm_medium=retail (QR standee encodes it).
    b. Workflow "Mattress Hub Intake": Form Submitted ->
       ${key("contact", "Lead Source Type")} = "Mattress Hub", tag src:mattresshub ->
       Create Opportunity @ "New Referral / Intake" (mirror source onto
       opportunity) -> fast-response SMS.

 7. REP ATTRIBUTION (plan §2.3c): each rep is a GHL user; workflows set
    the opportunity ASSIGNEE (per-rep dashboards filter on assignee).
    Rep outreach links carry utm_content=rep-<slug>; submissions set
    ${key("contact", "Sales Rep (source)")} + tag src:rep:<slug>.

 8. DASHBOARDS (plan §3, Option A): build "Kevin" dashboard with
    Opportunities widgets filtered on the OPPORTUNITY-LEVEL mirror fields
    (${key("opportunity", "Lead Source Type")}, ${key("opportunity", "Referring Practice")},
    ${key("opportunity", "Sales Rep (source)")}) and on assignee; add the
    lost-reasons widget. Verify in-app that your plan tier includes
    custom dashboards, and check the widget filter surface while there.
============================================================`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

try {
  await provisionCustomFields();
  await provisionTags();
  await verifyPipelines();
} catch (err) {
  // A throw that escapes a section (e.g. the initial list call) lands here.
  logStatus("failed", "provisioning run", err.message);
}

console.log("== Run report ==");
for (const [bucket, items] of Object.entries(report)) {
  if (!items.length) continue;
  console.log(`  ${bucket} (${items.length}):`);
  for (const { label, detail } of items) {
    console.log(`    - ${label}${detail ? `: ${detail.split("\n")[0]}` : ""}`);
  }
}

printChecklist();

console.log(`
NEXT STEPS
  1. ${DRY_RUN ? "Re-run without --dry-run to actually provision." : "Work through the in-app checklist above (webhook workflow first)."}
  2. Point the website's ORDER_WEBHOOK_URL at the Inbound Webhook URL
     from checklist step 4b, then send one sample order payload and map
     the fields (step 4c). End-to-end test with a real test order.
  3. When Kevin sends the practice list and rep names, fill the CONFIG
     block at the top of this script and re-run (idempotent).
  4. After handoff, rotate/re-scope the Private Integration token.
`);

if (report.failed.length) {
  console.error(`${report.failed.length} object(s) FAILED — full API error bodies above.`);
  process.exit(1);
}
