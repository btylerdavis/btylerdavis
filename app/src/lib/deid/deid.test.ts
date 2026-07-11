import { describe, expect, it } from "vitest";
import {
  ageBand5,
  ageBandFromYearOfBirth,
  buildSuppressedTable,
  DATE_SHIFT_MAX_DAYS,
  dateShiftDays,
  pseudonym,
  shiftDate,
  SMALL_CELL_THRESHOLD,
  suppressCount,
} from "./deid";

const DAY_MS = 86_400_000;
const PIDS = Array.from({ length: 200 }, (_, i) => `test-participant-${i}`);

describe("dateShiftDays", () => {
  it("is deterministic: the same participant always gets the same shift", () => {
    for (const pid of PIDS.slice(0, 20)) {
      expect(dateShiftDays(pid)).toBe(dateShiftDays(pid));
    }
  });

  it("stays inside ±30 days and is never 0", () => {
    for (const pid of PIDS) {
      const shift = dateShiftDays(pid);
      expect(Number.isInteger(shift)).toBe(true);
      expect(Math.abs(shift)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(shift)).toBeLessThanOrEqual(DATE_SHIFT_MAX_DAYS);
    }
  });

  it("varies across participants (both signs occur)", () => {
    const shifts = PIDS.map(dateShiftDays);
    expect(new Set(shifts).size).toBeGreaterThan(10);
    expect(shifts.some((s) => s > 0)).toBe(true);
    expect(shifts.some((s) => s < 0)).toBe(true);
  });
});

describe("shiftDate", () => {
  it("applies the participant's constant shift in whole days", () => {
    const pid = PIDS[0];
    const date = new Date(Date.UTC(2026, 3, 1));
    const shifted = shiftDate(pid, date);
    expect((shifted.getTime() - date.getTime()) / DAY_MS).toBe(dateShiftDays(pid));
  });

  it("preserves intervals exactly: shift(d2) − shift(d1) === d2 − d1", () => {
    for (const pid of PIDS.slice(0, 20)) {
      const enrollment = new Date(Date.UTC(2026, 3, 1));
      const hst = new Date(Date.UTC(2026, 3, 8)); // +7 days
      const delivery = new Date(Date.UTC(2026, 3, 14)); // +13 days
      const [se, sh, sd] = [enrollment, hst, delivery].map((d) => shiftDate(pid, d));
      expect(sh.getTime() - se.getTime()).toBe(hst.getTime() - enrollment.getTime());
      expect(sd.getTime() - se.getTime()).toBe(delivery.getTime() - enrollment.getTime());
    }
  });

  it("uses a different offset for different participants (dates diverge)", () => {
    const date = new Date(Date.UTC(2026, 5, 30));
    const shifted = new Set(PIDS.map((pid) => shiftDate(pid, date).getTime()));
    expect(shifted.size).toBeGreaterThan(10);
  });
});

describe("pseudonym", () => {
  it("is deterministic and formatted P- + 12 hex chars (level-up 10)", () => {
    for (const pid of PIDS.slice(0, 20)) {
      expect(pseudonym(pid)).toBe(pseudonym(pid));
      expect(pseudonym(pid)).toMatch(/^P-[0-9a-f]{12}$/);
      expect(pseudonym(pid)).toHaveLength(2 + 12);
      // The pseudonym must not embed any fragment of the raw id.
      expect(pseudonym(pid)).not.toContain(pid.slice(0, 6));
    }
  });

  it("does not collide across a beyond-demo-scale cohort sample", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `collision-probe-${i}`);
    expect(new Set(many.map(pseudonym)).size).toBe(many.length);
    expect(new Set(PIDS.map(pseudonym)).size).toBe(PIDS.length);
  });
});

describe("age bands", () => {
  it("generalizes to 5-year bands", () => {
    expect(ageBand5(52)).toBe("50–54");
    expect(ageBand5(50)).toBe("50–54");
    expect(ageBand5(54)).toBe("50–54");
    expect(ageBand5(30)).toBe("30–34");
    expect(ageBand5(90)).toBe("85+");
  });

  it("derives the band from year of birth at a reference date", () => {
    const at = new Date(Date.UTC(2026, 5, 30));
    expect(ageBandFromYearOfBirth(1974, at)).toBe("50–54"); // 52
    expect(ageBandFromYearOfBirth(1996, at)).toBe("30–34");
  });
});

describe("small-cell suppression", () => {
  it("suppresses counts from 1 to threshold−1 and shows the rest", () => {
    expect(suppressCount(0)).toEqual({ suppressed: false, display: "0" });
    expect(suppressCount(1)).toEqual({
      suppressed: true,
      display: `<${SMALL_CELL_THRESHOLD} (suppressed)`,
    });
    expect(suppressCount(10).suppressed).toBe(true);
    expect(suppressCount(11)).toEqual({ suppressed: false, display: "11" });
    expect(suppressCount(1500).display).toBe("1,500");
  });

  it("honors a custom threshold", () => {
    expect(suppressCount(4, 5).suppressed).toBe(true);
    expect(suppressCount(5, 5).suppressed).toBe(false);
  });

  it("builds a fully-populated table with suppression per cell", () => {
    const entries = [
      ...Array.from({ length: 12 }, () => ({ row: "Tempur-Pedic", col: "moderate" })),
      ...Array.from({ length: 8 }, () => ({ row: "PureTal", col: "severe" })),
    ];
    const table = buildSuppressedTable(entries, {
      rowKeys: ["Tempur-Pedic", "PureTal"],
      colKeys: ["moderate", "severe"],
    });
    expect(table.cells["Tempur-Pedic"]["moderate"]).toEqual({ suppressed: false, display: "12" });
    expect(table.cells["PureTal"]["severe"].suppressed).toBe(true);
    expect(table.cells["PureTal"]["severe"].display).toBe("<11 (suppressed)");
    // missing combination → 0, shown
    expect(table.cells["Tempur-Pedic"]["severe"]).toEqual({ suppressed: false, display: "0" });
    expect(table.suppressedCellCount).toBe(1);
  });
});
