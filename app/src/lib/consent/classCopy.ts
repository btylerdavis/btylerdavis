import type { DataClass } from "./types";

/**
 * Participant-facing copy per data class (level-up 7): the display label and
 * the PREVIEW of what turning the class off disables. Rendered on the
 * participant scope-history section and the printable consent receipt, so a
 * participant sees the concrete consequence of each change before (and
 * after) making it.
 */

export const CLASS_LABELS: Record<DataClass, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  hst_clinical: "Home sleep test",
  mattress_purchase: "Mattress purchase",
  sleep_mat: "Under-mattress sensor",
  pro_responses: "Questionnaires",
  linkage: "Record linkage",
  registry_demographics: "Registry demographics",
};

/** What revoking (or never authorizing) each class disables — the preview. */
export const CLASS_DISABLES: Record<DataClass, string> = {
  wearable_sleep:
    "Stops collection of watch/ring sleep data; hides wearable nights from your trends and the coach view; removes wearable rows from research exports.",
  cpap_telemetry:
    "Stops collection of CPAP usage and residual-AHI data; hides CPAP charts and adherence tracking from your record and the coach view; removes CPAP rows from research exports.",
  hst_clinical:
    "Seals your home-sleep-test results and clinical treatment history; severity and study values disappear from every view and from research cohorts.",
  mattress_purchase:
    "Seals your mattress purchase details (model, firmness, delivery); mattress-related events leave your timeline and research comparisons.",
  sleep_mat:
    "Stops collection from the under-mattress sensor; position/restlessness nights leave your trends and the positional research study.",
  pro_responses:
    "Stops questionnaire collection (screeners, 30/90-day check-ins); existing responses are sealed from every view and export.",
  linkage:
    "Unlinks your store-side and clinic-side records: staff see a pseudonymous id instead of your name, and the joined journey view is refused.",
  registry_demographics:
    "Seals your base registry record (birth year, sex, enrollment door and date) from identified views and removes those fields from research exports.",
};
