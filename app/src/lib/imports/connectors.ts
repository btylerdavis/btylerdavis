import { sourceToDataClass } from "../consent/scopes";
import type { DataClass } from "../consent/types";
import type { ImportObservationRow, ImportSessionRow } from "./appleHealth";

/**
 * Server-owned connector schemas (audit v2 HIGH fix, prioritized fix 3).
 *
 * ONE module defines, per import connector: the canonical `source` string
 * persisted rows carry, the data class those rows are consent-gated under,
 * the allowed concept/unit pairs with value bounds, required fields, and
 * session semantics. Parser output is validated against this schema BEFORE a
 * PendingImport row is staged, and again before ingest — so no payload can
 * pair an `apple_health` authorization with `airview` lineage, smuggle an
 * unknown concept/unit under a trusted source, or write rows whose values
 * are out of physical range. Violations are refused with named reasons.
 *
 * DentiTrac is deliberately ABSENT: it is a preview-only pilot with no
 * ingest path (see PREVIEW_ONLY_KINDS) — a payload claiming that kind is
 * refused before persistence.
 */

export const IMPORT_KINDS = ["apple_health", "airview"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Connector kinds that may be parsed and previewed but NEVER ingested. */
export const PREVIEW_ONLY_KINDS = ["dentitrac"] as const;

export interface ConceptRule {
  /** exact unit string the connector emits for this concept */
  unit: string;
  min: number;
  max: number;
}

export interface ConnectorSchema {
  kind: ImportKind;
  /** canonical Observation/SleepSession `source` — the ONLY value persisted */
  canonicalSource: string;
  /** consent class of every row this connector produces */
  dataClass: DataClass;
  /** stamped on PendingImport + ImportBatch provenance receipts */
  parserVersion: string;
  /** allowed concept → unit + value bounds (anything else is refused) */
  concepts: Record<string, ConceptRule>;
  /** whether the connector emits SleepSession rows (nightly summaries) */
  sessions: "nightly_summary" | "none";
  maxRows: number;
}

const MAX_ROWS = 100_000;
/** a folded night can straddle segments; nothing sane exceeds 36 h */
const MAX_SESSION_SPAN_MS = 36 * 3_600_000;
const MAX_SESSION_MINUTES = 36 * 60;

export const CONNECTOR_SCHEMAS: Record<ImportKind, ConnectorSchema> = {
  apple_health: {
    kind: "apple_health",
    canonicalSource: "healthkit",
    dataClass: "wearable_sleep",
    parserVersion: "apple-health-xml-v1",
    concepts: {
      sleep_duration_min: { unit: "min", min: 0, max: 1440 },
      sleep_efficiency: { unit: "%", min: 0, max: 100 },
      resting_hr: { unit: "bpm", min: 20, max: 250 },
      hrv_sdnn: { unit: "ms", min: 0, max: 500 },
      spo2_mean: { unit: "%", min: 50, max: 100 },
    },
    sessions: "nightly_summary",
    maxRows: MAX_ROWS,
  },
  airview: {
    kind: "airview",
    canonicalSource: "airview",
    dataClass: "cpap_telemetry",
    parserVersion: "airview-csv-v1",
    concepts: {
      cpap_usage_minutes: { unit: "min", min: 0, max: 1440 },
      residual_ahi: { unit: "events/h", min: 0, max: 150 },
      mask_leak_p95: { unit: "L/min", min: 0, max: 120 },
      pressure_p95: { unit: "cmH2O", min: 3, max: 30 },
    },
    sessions: "none",
    maxRows: MAX_ROWS,
  },
};

/** connector kind → consent class, derived from the single schema source. */
export const IMPORT_DATA_CLASS: Record<ImportKind, DataClass> = Object.fromEntries(
  IMPORT_KINDS.map((kind) => [kind, CONNECTOR_SCHEMAS[kind].dataClass])
) as Record<ImportKind, DataClass>;

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConnectorViolation {
  /** stable machine-readable reason, e.g. "unknown_concept" */
  code: string;
  detail: string;
}

/** The exact payload shape the ingest path accepts (see ingest.ts). */
export interface ImportPayloadShape {
  kind: string;
  source: string;
  observations: ImportObservationRow[];
  sessions?: ImportSessionRow[];
  firstDay: string | null;
  lastDay: string | null;
}

export type ConnectorValidation =
  | { ok: true; schema: ConnectorSchema }
  | { ok: false; violations: ConnectorViolation[] };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Strict ISO calendar day inside a sane demo range ("2026-02-30" fails). */
function isValidDay(day: unknown): day is string {
  if (typeof day !== "string" || !ISO_DAY.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  const year = parsed.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Validates a normalized import payload against the server-owned connector
 * schema. EVERY violation is reported with a named reason; a payload with
 * any violation must never reach a PendingImport row or the ingest gate.
 */
export function validateImportPayload(parsed: ImportPayloadShape): ConnectorValidation {
  const violations: ConnectorViolation[] = [];
  const refuse = (code: string, detail: string) => violations.push({ code, detail });

  if (!isImportKind(parsed.kind)) {
    if ((PREVIEW_ONLY_KINDS as readonly string[]).includes(parsed.kind)) {
      refuse("preview_only_kind", `"${parsed.kind}" is preview-only — it has no ingest path`);
    } else {
      refuse("unknown_kind", `unknown import kind "${parsed.kind}"`);
    }
    return { ok: false, violations };
  }
  const schema = CONNECTOR_SCHEMAS[parsed.kind];

  // Exact kind → canonical source pairing (audit minimum patch).
  if (parsed.source !== schema.canonicalSource) {
    refuse(
      "source_mismatch",
      `kind "${schema.kind}" requires source "${schema.canonicalSource}", got "${parsed.source}"`
    );
  }

  // Self-check the schema's own lineage: the canonical source must map to
  // the connector's class in the fail-closed source map (defense in depth —
  // a drifted schema fails every import loudly instead of misclassifying).
  if (sourceToDataClass(schema.canonicalSource) !== schema.dataClass) {
    refuse(
      "lineage_mismatch",
      `canonical source "${schema.canonicalSource}" does not map to class "${schema.dataClass}"`
    );
  }

  const observations = Array.isArray(parsed.observations) ? parsed.observations : [];
  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  if (!Array.isArray(parsed.observations)) refuse("malformed_payload", "observations is not an array");
  if (parsed.sessions !== undefined && !Array.isArray(parsed.sessions)) {
    refuse("malformed_payload", "sessions is not an array");
  }

  const rowCount = observations.length + sessions.length;
  if (rowCount === 0) refuse("empty_payload", "the file held no usable nights");
  if (rowCount > schema.maxRows) {
    refuse("too_many_rows", `${rowCount} rows exceeds the ${schema.maxRows}-row limit`);
  }
  if (schema.sessions === "none" && sessions.length > 0) {
    refuse("sessions_not_supported", `connector "${schema.kind}" emits no sleep sessions`);
  }

  const days: string[] = [];
  for (const row of observations) {
    if (!isValidDay(row.day)) {
      refuse("invalid_day", `observation day "${String(row.day)}" is not a valid ISO day`);
      continue;
    }
    days.push(row.day);
    const rule = schema.concepts[row.concept];
    if (!rule) {
      refuse("unknown_concept", `concept "${String(row.concept)}" is not allowed for "${schema.kind}"`);
      continue;
    }
    if (row.unit !== rule.unit) {
      refuse("unit_mismatch", `concept "${row.concept}" requires unit "${rule.unit}", got "${String(row.unit)}"`);
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < rule.min || row.value > rule.max) {
      refuse(
        "value_out_of_bounds",
        `concept "${row.concept}" value ${String(row.value)} outside [${rule.min}, ${rule.max}] ${rule.unit}`
      );
    }
  }

  for (const session of sessions) {
    if (!isValidDay(session.day)) {
      refuse("invalid_day", `session day "${String(session.day)}" is not a valid ISO day`);
      continue;
    }
    days.push(session.day);
    const startMs = Date.parse(session.startIso);
    const endMs = Date.parse(session.endIso);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      refuse("invalid_session", `session ${session.day} has unparseable start/end timestamps`);
      continue;
    }
    if (endMs <= startMs) {
      refuse("invalid_session", `session ${session.day} ends before it starts`);
    }
    if (endMs - startMs > MAX_SESSION_SPAN_MS) {
      refuse("session_out_of_bounds", `session ${session.day} spans more than 36 h`);
    }
    const summary = session.summary;
    const efficiency = summary?.efficiency;
    const durationMin = summary?.durationMin;
    const stages = summary?.stages;
    if (
      typeof efficiency !== "number" || !Number.isFinite(efficiency) || efficiency < 0 || efficiency > 100 ||
      typeof durationMin !== "number" || !Number.isFinite(durationMin) || durationMin < 0 || durationMin > MAX_SESSION_MINUTES ||
      !stages ||
      ([stages.deep, stages.rem, stages.core] as unknown[]).some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || (v as number) < 0 || (v as number) > MAX_SESSION_MINUTES
      )
    ) {
      refuse("session_out_of_bounds", `session ${session.day} summary fields missing or out of bounds`);
    }
  }

  // Required fields: the declared date range must exactly cover the rows.
  if (days.length > 0) {
    const sorted = [...days].sort();
    if (parsed.firstDay !== sorted[0] || parsed.lastDay !== sorted[sorted.length - 1]) {
      refuse(
        "date_range_mismatch",
        `declared range ${String(parsed.firstDay)}–${String(parsed.lastDay)} does not match row days ` +
          `${sorted[0]}–${sorted[sorted.length - 1]}`
      );
    }
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, schema };
}

/** Thrown when a payload fails connector-schema validation (named reasons). */
export class ImportValidationError extends Error {
  readonly code = "IMPORT_VALIDATION_FAILED";
  readonly violations: ConnectorViolation[];

  constructor(violations: ConnectorViolation[]) {
    super(
      `Import payload failed connector-schema validation: ${violations
        .map((violation) => `${violation.code} (${violation.detail})`)
        .join("; ")}`
    );
    this.name = "ImportValidationError";
    this.violations = violations;
  }
}
