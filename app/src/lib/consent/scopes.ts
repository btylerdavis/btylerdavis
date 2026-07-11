import { isDataClass, type ConsentScope, type DataClass, type InstrumentType } from "./types";

/**
 * Default scope templates per consent instrument (SPEC §4.2 lanes, demo cut).
 *
 * - LANE_A: clinical consent + authorization (Sleeptopia door). Covers the
 *   clinical data classes, registry-provisioned devices, and the base
 *   registry record (registry_demographics).
 * - LANE_B: consumer consent (Mattress Hub door). Covers consumer-collected
 *   data classes including the mattress purchase record and the base
 *   registry record.
 * - LANE_C: linkage authorization — joining a person's retail-originated and
 *   clinic-originated records. Without it the join is refused. Linkage alone
 *   authorizes NO demographic fields (audit F-11).
 */
export const INSTRUMENT_SCOPES: Record<InstrumentType, ConsentScope> = {
  LANE_A: crossProduct(
    [
      "hst_clinical",
      "cpap_telemetry",
      "wearable_sleep",
      "sleep_mat",
      "pro_responses",
      "registry_demographics",
    ],
    ["collect", "view_identified", "research_deid"]
  ),
  LANE_B: crossProduct(
    [
      "wearable_sleep",
      "sleep_mat",
      "mattress_purchase",
      "pro_responses",
      "registry_demographics",
    ],
    ["collect", "view_identified", "research_deid"]
  ),
  LANE_C: crossProduct(["linkage"], ["collect", "view_identified", "research_deid"]),
};

function crossProduct(
  dataClasses: DataClass[],
  uses: ("collect" | "view_identified" | "research_deid")[]
): ConsentScope {
  return dataClasses.flatMap((dataClass) => uses.map((use) => ({ dataClass, use })));
}

/**
 * Maps an Observation/SleepSession `source` to the data class whose consent
 * grant gates it. Sources follow TECHNICAL.md §T2.3 naming
 * ("airview", "aggregator:garmin", "healthkit", "sleep_mat", "hst", "pro",
 * "pos").
 *
 * FAIL CLOSED (audit F-10): an unrecognized source returns null. Readers and
 * exports must treat null as unclassified — omit the row and surface a
 * quarantine flag — so a typo'd connector name can never move clinical data
 * into a less restrictive class.
 */
export function sourceToDataClass(source: string): DataClass | null {
  if (source === "hst") return "hst_clinical";
  if (source === "airview" || source === "sd_card") return "cpap_telemetry";
  if (source === "sleep_mat") return "sleep_mat";
  if (source === "pro") return "pro_responses";
  if (source === "pos") return "mattress_purchase";
  if (
    source === "healthkit" ||
    source.startsWith("aggregator:") ||
    source.startsWith("wearable:")
  ) {
    return "wearable_sleep";
  }
  return null; // unknown source: unclassified, never readable
}

/**
 * Row-level lineage derivation for batched subject-data writes (audit v2
 * HIGH fix, prioritized fix 2): the class a batch is authorized under is
 * derived from the rows' OWN persisted `source` lineage — never from a
 * caller-supplied operation label. Fail closed on principle:
 *
 * - any row with an unknown source → refuse the WHOLE batch ("unknown_source");
 * - rows spanning more than one class → refuse the WHOLE batch ("mixed_batch").
 *
 * No quarantine writes: a refused batch never reaches the primary tables.
 */
export function uniformRowDataClass(
  rows: readonly { source: string }[]
):
  | { ok: true; dataClass: DataClass }
  | { ok: false; code: "empty_batch" | "unknown_source" | "mixed_batch"; detail: string } {
  if (rows.length === 0) return { ok: false, code: "empty_batch", detail: "no rows in batch" };
  const classes = new Set<DataClass>();
  for (const row of rows) {
    const dataClass = sourceToDataClass(row.source);
    if (dataClass === null) {
      return {
        ok: false,
        code: "unknown_source",
        detail: `row source "${row.source}" maps to no data class (fail closed)`,
      };
    }
    classes.add(dataClass);
  }
  if (classes.size > 1) {
    return {
      ok: false,
      code: "mixed_batch",
      detail: `batch spans classes ${[...classes].sort().join(", ")} — refused whole`,
    };
  }
  return { ok: true, dataClass: [...classes][0] };
}

/**
 * Exhaustive treatment-event classification (audit F-06). Each event type is
 * consent-owned by the data class of the therapy/exposure it records:
 * CPAP lifecycle events under cpap_telemetry, appliance delivery under the
 * clinical lane, mattress delivery under the purchase record it stems from.
 * Unknown event types map to null and are NEVER readable (fail closed).
 */
export const TREATMENT_EVENT_DATA_CLASSES = {
  cpap_setup: "cpap_telemetry",
  titration_change: "cpap_telemetry",
  therapy_stop: "cpap_telemetry",
  appliance_delivery: "hst_clinical",
  mattress_delivery: "mattress_purchase",
} as const satisfies Record<string, DataClass>;

export type TreatmentEventType = keyof typeof TREATMENT_EVENT_DATA_CLASSES;

export function treatmentEventTypeToDataClass(type: string): DataClass | null {
  return TREATMENT_EVENT_DATA_CLASSES[type as TreatmentEventType] ?? null;
}

/**
 * Validates a persisted lineage column (Device/TreatmentEvent/Episode
 * .dataClass): anything but a known data class reads as unclassified (null)
 * and fails closed everywhere.
 */
export function storedDataClass(value: string | null): DataClass | null {
  return isDataClass(value) ? value : null;
}
