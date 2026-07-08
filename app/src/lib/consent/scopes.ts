import type { ConsentScope, DataClass, InstrumentType } from "./types";

/**
 * Default scope templates per consent instrument (SPEC §4.2 lanes, demo cut).
 *
 * - LANE_A: clinical consent + authorization (Sleeptopia door). Covers the
 *   clinical data classes and registry-provisioned devices.
 * - LANE_B: consumer consent (Mattress Hub door). Covers consumer-collected
 *   data classes including the mattress purchase record.
 * - LANE_C: linkage authorization — joining a person's retail-originated and
 *   clinic-originated records. Without it the join is refused.
 */
export const INSTRUMENT_SCOPES: Record<InstrumentType, ConsentScope> = {
  LANE_A: crossProduct(
    ["hst_clinical", "cpap_telemetry", "wearable_sleep", "sleep_mat", "pro_responses"],
    ["collect", "view_identified", "research_deid"]
  ),
  LANE_B: crossProduct(
    ["wearable_sleep", "sleep_mat", "mattress_purchase", "pro_responses"],
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
 * ("airview", "aggregator:garmin", "healthkit", "sleep_mat", "hst", "pro", "pos").
 */
export function sourceToDataClass(source: string): DataClass {
  if (source === "hst") return "hst_clinical";
  if (source === "airview" || source === "sd_card") return "cpap_telemetry";
  if (source === "sleep_mat") return "sleep_mat";
  if (source === "pro") return "pro_responses";
  if (source === "pos") return "mattress_purchase";
  // healthkit, aggregator:<provider>, wearable:<provider>
  return "wearable_sleep";
}
