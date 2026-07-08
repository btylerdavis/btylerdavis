import type { DataClass } from "./consent";

/**
 * Shared enrollment-flow option lists — kept out of the "use server" action
 * modules (which may only export async functions) so both the client
 * steppers and the server actions can import them.
 */

/** The four data classes the consumer consent (Lane B) screen toggles. */
export const LANE_B_TOGGLEABLE_CLASSES = [
  "wearable_sleep",
  "sleep_mat",
  "mattress_purchase",
  "pro_responses",
] as const satisfies readonly DataClass[];

export type LaneBToggleClass = (typeof LANE_B_TOGGLEABLE_CLASSES)[number];
export type LaneBToggles = Record<LaneBToggleClass, boolean>;

/** Plain-language descriptions for the consumer consent toggles. */
export const LANE_B_CLASS_COPY: Record<
  LaneBToggleClass,
  { title: string; description: string }
> = {
  wearable_sleep: {
    title: "Wearable sleep data",
    description:
      "Nightly sleep, heart rate, and oxygen readings from a watch or ring you connect.",
  },
  sleep_mat: {
    title: "Under-mattress sensor",
    description:
      "Sleep position and restlessness from a thin sensor under the mattress — nothing worn, nothing to charge.",
  },
  mattress_purchase: {
    title: "Mattress purchase details",
    description:
      "The model and firmness you buy, so researchers can study mattresses and sleep together.",
  },
  pro_responses: {
    title: "Questionnaires",
    description:
      "Short check-ins like tonight's sleep screener, plus follow-ups at 30 and 90 days.",
  },
};

/** Wearable connect tiles (stub — live OAuth held in reserve). */
export const WEARABLE_PROVIDERS = [
  { key: "apple", label: "Apple Watch", make: "Apple", model: "Apple Watch" },
  { key: "garmin", label: "Garmin", make: "Garmin", model: "Garmin watch" },
  { key: "fitbit", label: "Fitbit", make: "Fitbit", model: "Fitbit tracker" },
  { key: "oura", label: "Oura", make: "Oura", model: "Oura Ring" },
  { key: "withings", label: "Withings", make: "Withings", model: "ScanWatch" },
  { key: "samsung", label: "Samsung", make: "Samsung", model: "Galaxy Watch" },
] as const;

export type WearableProviderKey = (typeof WEARABLE_PROVIDERS)[number]["key"];

/** CPAP make/model picker for the clinic door's setup step. */
export const CPAP_MODELS = [
  { key: "airsense11", make: "ResMed", model: "AirSense 11 AutoSet" },
  { key: "airsense10", make: "ResMed", model: "AirSense 10 AutoSet" },
  { key: "dreamstation2", make: "Philips Respironics", model: "DreamStation 2 Auto" },
] as const;

export type CpapModelKey = (typeof CPAP_MODELS)[number]["key"];
