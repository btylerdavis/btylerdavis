import { SEMANTIC, SERIES } from "./theme";

/**
 * Treatment-event display mapping shared by the (server-rendered) timeline
 * band and the (client) chart reference lines — kept directive-free so both
 * sides can import it.
 */

export const EVENT_LABELS: Record<string, string> = {
  cpap_setup: "CPAP setup",
  mattress_delivery: "Mattress delivered",
  appliance_delivery: "Oral appliance",
  therapy_stop: "Therapy stopped",
  titration_change: "Titration change",
};

export const EVENT_SHORT_LABELS: Record<string, string> = {
  cpap_setup: "CPAP",
  mattress_delivery: "Mattress",
  appliance_delivery: "Appliance",
  therapy_stop: "Therapy stop",
  titration_change: "Titration",
};

export function eventColor(type: string): string {
  return type === "therapy_stop" ? SEMANTIC.danger : SERIES.secondary;
}

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}
