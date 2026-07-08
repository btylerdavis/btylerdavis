import { describe, expect, it } from "vitest";
import { SMALL_CELL_THRESHOLD } from "../deid";
import type { ResearchMember } from "../research/cohort";
import {
  buildPartnerDashboard,
  partnerLineOf,
  PARTNER_BRAND,
} from "./queries";

/**
 * Partner-portal aggregation: everything Tempur-Sealy sees must come out of
 * the research-tier members (already research_deid-filtered upstream) with
 * k-anonymity suppression applied to every released count — rows and cells
 * under k=11 are withheld, and means are withheld with them.
 */

const CLOCK = new Date(Date.UTC(2026, 5, 30));

function member(overrides: Partial<ResearchMember>): ResearchMember {
  return {
    id: crypto.randomUUID(),
    sex: "male",
    yearOfBirth: 1974,
    age: 52,
    door: "retail",
    enrollmentDate: CLOCK,
    grants: new Set<string>(),
    ahi: null,
    severity: null,
    supinePredominant: null,
    hstDate: null,
    arm: null,
    brand: null,
    model: null,
    materialClass: null,
    firmnessRating: null,
    firmnessBand: null,
    purchaseDate: null,
    deliveryDate: null,
    essBaseline: null,
    essDay90: null,
    essChange90: null,
    essChangeFollowup: null,
    cpapAdherencePct: null,
    supinePre: null,
    supinePost: null,
    supineChange: null,
    seffBaseline: null,
    seffDay90: null,
    seffChange: null,
    ...overrides,
  };
}

const partnerMember = (model: string, supineChange: number | null, ess: number | null) =>
  member({
    brand: PARTNER_BRAND,
    model,
    supineChange,
    essChangeFollowup: ess,
  });

const otherMember = (supineChange: number | null, ess: number | null) =>
  member({ brand: "Serta", model: "iSeries Hybrid 3000 Medium", supineChange, essChangeFollowup: ess });

describe("partnerLineOf", () => {
  it("matches ProAdapt/LuxeAdapt before the bare Adapt line", () => {
    expect(partnerLineOf("TEMPUR-ProAdapt Medium Hybrid")).toBe("ProAdapt");
    expect(partnerLineOf("TEMPUR-LuxeAdapt Firm")).toBe("LuxeAdapt");
    expect(partnerLineOf("TEMPUR-Adapt Medium")).toBe("Adapt");
    expect(partnerLineOf("iSeries Hybrid 3000")).toBeNull();
  });
});

describe("buildPartnerDashboard suppression", () => {
  it("suppresses model-line rows under k and withholds their means", () => {
    const members = [
      // 12 ProAdapt members (released), strong improvement
      ...Array.from({ length: 12 }, () =>
        partnerMember("TEMPUR-ProAdapt Medium Hybrid", -12, -3)
      ),
      // 3 LuxeAdapt members (suppressed)
      ...Array.from({ length: 3 }, () => partnerMember("TEMPUR-LuxeAdapt Firm", -20, -6)),
      // 15 others so the category side exists
      ...Array.from({ length: 15 }, () => otherMember(-2, -1)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);

    const proAdapt = dash.modelRows.find((row) => row.line === "ProAdapt");
    expect(proAdapt?.n.suppressed).toBe(false);
    expect(proAdapt?.n.display).toBe("12");
    expect(proAdapt?.meanSupineChange).toBe(-12);
    expect(proAdapt?.meanEssChange).toBe(-3);

    const luxeAdapt = dash.modelRows.find((row) => row.line === "LuxeAdapt");
    expect(luxeAdapt?.n.suppressed).toBe(true);
    expect(luxeAdapt?.n.display).toBe(`<${SMALL_CELL_THRESHOLD} (suppressed)`);
    expect(luxeAdapt?.meanSupineChange).toBeNull();
    expect(luxeAdapt?.meanEssChange).toBeNull();

    // zero-count line shows 0 (an empty cell reveals nothing)
    const adapt = dash.modelRows.find((row) => row.line === "Adapt");
    expect(adapt?.n.suppressed).toBe(false);
    expect(adapt?.n.display).toBe("0");

    expect(dash.suppressedModelRows).toBe(1);
  });

  it("suppresses small distribution cells and computes shares from released counts only", () => {
    const members = [
      // partner: 14 in one bucket (released), 2 in another (suppressed)
      ...Array.from({ length: 14 }, () => partnerMember("TEMPUR-ProAdapt Medium", -12, null)),
      ...Array.from({ length: 2 }, () => partnerMember("TEMPUR-ProAdapt Medium", -20, null)),
      // others: 22 mild responses (released)
      ...Array.from({ length: 22 }, () => otherMember(-2, null)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);

    const bucket15 = dash.distribution.find((cell) => cell.bucket === "≤ −15 pp");
    expect(bucket15?.partner.suppressed).toBe(true);
    expect(bucket15?.partner.display).toContain("suppressed");
    expect(bucket15?.partnerPct).toBeNull();

    const bucket10 = dash.distribution.find((cell) => cell.bucket === "−15 to −10 pp");
    expect(bucket10?.partner.suppressed).toBe(false);
    // 14 of 14 RELEASED partner members — the suppressed 2 leak nothing
    expect(bucket10?.partnerPct).toBe(100);

    const bucket5 = dash.distribution.find((cell) => cell.bucket === "−5 to 0 pp");
    expect(bucket5?.others.suppressed).toBe(false);
    expect(bucket5?.othersPct).toBe(100);

    expect(dash.suppressedDistributionCells).toBeGreaterThanOrEqual(1);
  });

  it("suppresses outcome tiles when the contributing n is under k", () => {
    const members = [
      // only 4 partner members with outcomes → tile must suppress
      ...Array.from({ length: 4 }, () => partnerMember("TEMPUR-Adapt Medium", -9, -4)),
      ...Array.from({ length: 20 }, () => otherMember(-3, -1)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);

    const partnerTile = dash.tiles[0];
    expect(partnerTile.group).toBe(PARTNER_BRAND);
    expect(partnerTile.supineChange.n.suppressed).toBe(true);
    expect(partnerTile.supineChange.mean).toBeNull();

    const categoryTile = dash.tiles[1];
    expect(categoryTile.supineChange.n.suppressed).toBe(false);
    expect(categoryTile.supineChange.mean).toBe(-4); // (4×−9 + 20×−3) / 24
  });

  it("ignores members without a readable purchase (no brand → not a purchaser)", () => {
    const members = [
      ...Array.from({ length: 12 }, () => partnerMember("TEMPUR-Adapt Medium", -8, -2)),
      // consent-scoped-out purchases: brand is null upstream
      ...Array.from({ length: 30 }, () => member({ supineChange: -10 })),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);
    expect(dash.partnerPurchasers.display).toBe("12");
    expect(dash.otherPurchasers.display).toBe("0");
    // the null-brand members contribute to NO tile
    expect(dash.tiles[1].supineChange.n.display).toBe("12");
  });
});
