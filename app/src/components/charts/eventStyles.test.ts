import { describe, expect, it } from "vitest";
import {
  LABEL_STAGGER_DY,
  planEventReferenceLines,
  type PlannedEventLine,
} from "./eventStyles";

const byDay = (lines: PlannedEventLine[], day: string): PlannedEventLine => {
  const line = lines.find((entry) => entry.day === day);
  if (!line) throw new Error(`no planned line for ${day}`);
  return line;
};

describe("planEventReferenceLines", () => {
  it("combines events within 3 days into one label on the first line (Marcus: mattress day 13, CPAP day 14)", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-13", type: "mattress_delivery", label: "Mattress" },
      { day: "2026-04-14", type: "cpap_setup", label: "CPAP" },
    ]);
    expect(lines).toHaveLength(2); // both reference lines still draw
    expect(byDay(lines, "2026-04-13").label).toBe("Mattress + CPAP");
    expect(byDay(lines, "2026-04-14").label).toBeNull();
  });

  it("combines regardless of input order", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-14", type: "cpap_setup", label: "CPAP" },
      { day: "2026-04-13", type: "mattress_delivery", label: "Mattress" },
    ]);
    expect(byDay(lines, "2026-04-13").label).toBe("Mattress + CPAP");
    expect(byDay(lines, "2026-04-14").label).toBeNull();
  });

  it("staggers labels that are separate but still near each other", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-01", type: "mattress_delivery", label: "Mattress" },
      { day: "2026-04-08", type: "cpap_setup", label: "CPAP" },
    ]);
    expect(byDay(lines, "2026-04-01").label).toBe("Mattress");
    expect(byDay(lines, "2026-04-01").dy).toBe(0);
    expect(byDay(lines, "2026-04-08").label).toBe("CPAP");
    expect(byDay(lines, "2026-04-08").dy).toBe(LABEL_STAGGER_DY);
  });

  it("keeps far-apart labels at the same height", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-01", type: "mattress_delivery", label: "Mattress" },
      { day: "2026-06-01", type: "therapy_stop", label: "Therapy stop" },
    ]);
    expect(lines.map((line) => line.dy)).toEqual([0, 0]);
    expect(lines.map((line) => line.label)).toEqual(["Mattress", "Therapy stop"]);
  });

  it("chains a 3-event cluster into one combined label", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-13", type: "mattress_delivery", label: "Mattress" },
      { day: "2026-04-14", type: "cpap_setup", label: "CPAP" },
      { day: "2026-04-16", type: "appliance_delivery", label: "Appliance" },
    ]);
    expect(byDay(lines, "2026-04-13").label).toBe("Mattress + CPAP + Appliance");
    expect(byDay(lines, "2026-04-14").label).toBeNull();
    expect(byDay(lines, "2026-04-16").label).toBeNull();
  });

  it("draws lines but no labels for label-stripped events (quiet lower panels)", () => {
    const lines = planEventReferenceLines([
      { day: "2026-04-13", type: "mattress_delivery", label: "" },
      { day: "2026-04-14", type: "cpap_setup", label: "" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.label === null)).toBe(true);
  });
});
