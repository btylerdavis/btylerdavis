import { describe, expect, it } from "vitest";
import { SMALL_CELL_THRESHOLD } from "../deid";
import type { ResearchMember } from "../research/cohort";
import {
  bandMidpoint,
  buildPartnerDashboard,
  dashboardReleaseRecords,
  partnerLineOf,
  PARTNER_BRAND,
} from "./queries";

/**
 * Partner-portal aggregation: everything Tempur-Sealy sees must come out of
 * the research-tier members (already research_deid-filtered upstream)
 * released through the disclosure-control layer (audit F-12): rows and cells
 * under k=11 are withheld (means withheld with them), and every released
 * count is a BAND — never an exact number.
 *
 * NOTE (stage-2 assertion changes, justified): the pre-fix versions asserted
 * exact released displays ("12") — the release shape F-12 refutes. They now
 * assert the released band.
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
    enrollmentAnchor: CLOCK,
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
    // 12 releases as its band, never the exact count (F-12).
    expect(proAdapt?.n.display).toBe("11–20");
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
    // Released as bands (F-12) — the 30 null-brand members contribute nowhere.
    expect(dash.partnerPurchasers.display).toBe("11–20");
    expect(dash.otherPurchasers.display).toBe("0");
    // the null-brand members contribute to NO tile
    expect(dash.tiles[1].supineChange.n.display).toBe("11–20");
  });

  it("never releases an exact non-zero count anywhere on the dashboard (F-12)", () => {
    const members = [
      ...Array.from({ length: 37 }, () => partnerMember("TEMPUR-ProAdapt Medium", -12, -3)),
      ...Array.from({ length: 3 }, () => partnerMember("TEMPUR-LuxeAdapt Firm", -20, -6)),
      ...Array.from({ length: 250 }, () => otherMember(-2, -1)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);
    const releasedDisplays = [
      dash.partnerPurchasers,
      dash.otherPurchasers,
      ...dash.tiles.flatMap((tile) => [tile.supineChange.n, tile.essChange.n]),
      ...dash.distribution.flatMap((cell) => [cell.partner, cell.others]),
      ...dash.modelRows.map((row) => row.n),
    ].map((cell) => cell.display);
    const allowed = /^(0|<11 \(suppressed\)|11–20|21–50|51–200|>200|withheld \(complementary suppression\))$/;
    for (const display of releasedDisplays) {
      expect(display).toMatch(allowed);
    }
    // Spot-check the band edges: 40 partner purchasers → 21–50; 250 others → >200.
    expect(dash.partnerPurchasers.display).toBe("21–50");
    expect(dash.otherPurchasers.display).toBe(">200");
  });

  it("computes distribution shares from band midpoints — approximate by design", () => {
    const members = [
      ...Array.from({ length: 14 }, () => partnerMember("TEMPUR-ProAdapt Medium", -12, null)),
      ...Array.from({ length: 30 }, () => partnerMember("TEMPUR-ProAdapt Medium", -2, null)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);
    const bucket10 = dash.distribution.find((cell) => cell.bucket === "−15 to −10 pp");
    const bucket0 = dash.distribution.find((cell) => cell.bucket === "−5 to 0 pp");
    // 14 → band 11–20 (midpoint 15.5); 30 → band 21–50 (midpoint 35.5).
    expect(bandMidpoint(bucket10!.partner)).toBe(15.5);
    expect(bandMidpoint(bucket0!.partner)).toBe(35.5);
    // Shares derive from the midpoints, NOT the raw 14/44 vs 30/44.
    expect(bucket10?.partnerPct).toBe(30.4); // 15.5 / 51 — not 31.8 (=14/44)
    expect(bucket0?.partnerPct).toBe(69.6); // 35.5 / 51 — not 68.2 (=30/44)
  });

  it("shapes one release-ledger record per released count (manifest linkage)", () => {
    const members = [
      ...Array.from({ length: 12 }, () => partnerMember("TEMPUR-ProAdapt Medium", -12, -3)),
      ...Array.from({ length: 15 }, () => otherMember(-2, -1)),
    ];
    const dash = buildPartnerDashboard(members, CLOCK, 1);
    const records = dashboardReleaseRecords(dash, CLOCK);
    // 2 purchaser counts + 2 tiles × 2 + 5 buckets × 2 + 3 model rows = 19.
    expect(records).toHaveLength(19);
    for (const record of records) {
      expect(record.surface).toBe("partner_dashboard");
      expect(record.clockDate).toBe(CLOCK);
      // Bands only — never an exact non-zero count.
      expect(record.band).toMatch(
        /^(0|<11 \(suppressed\)|11–20|21–50|51–200|>200|withheld \(complementary suppression\))$/
      );
    }
    expect(records.map((record) => record.metric)).toContain("model:ProAdapt:n");
  });
});
