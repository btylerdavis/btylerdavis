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

// ---------------------------------------------------------------------------
// Reference-label collision planning (pure, tested)
// ---------------------------------------------------------------------------

/** Events at most this many days apart share one combined label. */
export const LABEL_COMBINE_DAYS = 3;
/** Label anchors closer than this stagger vertically instead. */
export const LABEL_STAGGER_DAYS = 14;
/** Vertical offset per stagger level, px. */
export const LABEL_STAGGER_DY = 14;

export interface PlannedEventLine {
  day: string;
  type: string;
  /** null = draw the reference line without a label */
  label: string | null;
  /** vertical offset for the label, px */
  dy: number;
}

const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.abs(dayMs(a) - dayMs(b)) / 86_400_000;

/**
 * Plans one reference line per event so labels never collide: events within
 * LABEL_COMBINE_DAYS of each other merge into a single combined label
 * ("Mattress + CPAP" — Marcus's delivery and setup are a day apart) carried
 * by the group's first line, and label anchors that still land within
 * LABEL_STAGGER_DAYS of the previous label alternate heights. Events with
 * empty labels keep their line but never contribute label text.
 */
export function planEventReferenceLines(
  events: { day: string; type: string; label: string }[]
): PlannedEventLine[] {
  const sorted = [...events].sort((a, b) => a.day.localeCompare(b.day));

  // Group runs of events where each is within LABEL_COMBINE_DAYS of the last.
  const groups: (typeof sorted)[] = [];
  for (const event of sorted) {
    const group = groups[groups.length - 1];
    if (group && daysBetween(group[group.length - 1].day, event.day) <= LABEL_COMBINE_DAYS) {
      group.push(event);
    } else {
      groups.push([event]);
    }
  }

  const planned: PlannedEventLine[] = [];
  let previousAnchor: string | null = null;
  let level = 0;
  for (const group of groups) {
    const text = group
      .map((event) => event.label)
      .filter((label) => label.length > 0)
      .join(" + ");
    const anchorDay = group[0].day;
    if (text.length > 0) {
      level =
        previousAnchor !== null && daysBetween(previousAnchor, anchorDay) <= LABEL_STAGGER_DAYS
          ? (level + 1) % 2
          : 0;
      previousAnchor = anchorDay;
    }
    group.forEach((event, index) => {
      planned.push({
        day: event.day,
        type: event.type,
        label: index === 0 && text.length > 0 ? text : null,
        dy: level * LABEL_STAGGER_DY,
      });
    });
  }
  return planned;
}
