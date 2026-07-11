import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { grantConsent, revokeConsent } from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  loadProposal,
  parseProposalParams,
  PRICE_HONESTY_LINE,
  PROPOSAL_PRESETS,
  proposalTimeline,
} from "./proposal";

/**
 * Proposal generator: the feasibility n must be a LIVE consent-filtered
 * research-tier count (revoke someone and the proposal shrinks), released
 * through the DISCLOSURE-CONTROL layer (audit F-12): banded counts (never
 * exact), approved query families, and a release-ledger row for every count
 * released. Every proposal must carry the §12.4 "rough band, not a quote"
 * honesty line.
 *
 * NOTE (stage-2 assertion changes, justified): the pre-fix versions of these
 * tests asserted EXACT released counts ("12", "11") — the very release shape
 * audit F-12 refutes. They now assert the released BAND.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
  await prisma.releaseLedgerEntry.deleteMany();
  await prisma.deletionRequest.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.sleepSession.deleteMany();
  await prisma.proResponse.deleteMany();
  await prisma.mattressPurchase.deleteMany();
  await prisma.mattressCatalog.deleteMany();
  await prisma.device.deleteMany();
  await prisma.treatmentEvent.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.demoIdentity.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.simClock.deleteMany();
}

async function seedConsented(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    await prisma.participant.create({
      data: {
        id,
        yearOfBirth: 1970 + i,
        sex: i % 2 === 0 ? "male" : "female",
        enrollmentTouchpoint: "clinic",
        createdAt: addDays(SIM_TODAY, -60),
      },
    });
    await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -60) });
    ids.push(id);
  }
  return ids;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("parseProposalParams", () => {
  it("defaults to the flagship preset with its cohort filters and 6 months", () => {
    const inputs = parseProposalParams({});
    expect(inputs.preset.key).toBe("positional-firmness");
    expect(inputs.filters).toEqual({ supine: "y" }); // preset default applies
    expect(inputs.durationMonths).toBe(6);
  });

  it("validates preset, filter subset and duration; junk drops", () => {
    const inputs = parseProposalParams({
      q: "combo-vs-cpap",
      severity: "moderate",
      arm: "not-an-arm",
      firmness: "medium",
      dur: "12",
    });
    expect(inputs.preset.key).toBe("combo-vs-cpap");
    // explicit choices win; the preset's default arm fills the gap left by junk
    expect(inputs.filters).toEqual({ severity: "moderate", firmness: "medium", arm: "cpap_mattress" });
    expect(inputs.durationMonths).toBe(12);
    expect(parseProposalParams({ q: "nope", dur: "7" }).preset.key).toBe("positional-firmness");
  });
});

describe("proposalTimeline", () => {
  it("phases always sum to the requested duration", () => {
    for (const months of [3, 6, 9, 12]) {
      const timeline = proposalTimeline(months);
      expect(timeline.reduce((sum, phase) => sum + phase.months, 0)).toBe(months);
      expect(timeline.every((phase) => phase.months >= 1)).toBe(true);
    }
  });
});

describe("loadProposal — consent-filtered live n, released as bands (F-12)", () => {
  it("counts only research-consented participants; releases bands, never exact; revocation still bites", async () => {
    const ids = await seedConsented(12);
    // The category preset applies no default filters → matched = whole tier.
    const inputs = parseProposalParams({ q: "sponsor-lines-vs-category" });

    const before = await loadProposal(inputs);
    // 12 members release as the 11–20 BAND — never the exact count
    // (pre-fix this asserted display "12"; that was the F-12 defect).
    expect(before.cohort.matched.suppressed).toBe(false);
    expect(before.cohort.matched.band).toBe("11-20");
    expect(before.cohort.matched.display).toBe("11–20");
    expect(before.cohort.matched.display).not.toContain("12");
    expect(before.cohort.total.display).toBe("11–20");
    // 12 << 2 × §6.3 sketch (≈ 63/group) → the band's max (20) decides "not met".
    expect(before.feasibility.met).toBe(false);
    expect(before.feasibility.nPerGroup).toBeGreaterThanOrEqual(63);
    expect(before.honestyLine).toBe(PRICE_HONESTY_LINE);
    expect(before.priceBand.min).toBeGreaterThan(0);

    // Revoke one participant — 11 stays inside the same band (bands are the
    // point: single-participant changes are not observable)...
    await revokeConsent(ids[0], "LANE_A");
    const after = await loadProposal(inputs);
    expect(after.cohort.matched.suppressed).toBe(false);
    expect(after.cohort.matched.band).toBe("11-20");

    // ...but one more revocation puts the cell under k=11 → suppressed, no
    // leak, and the feasibility verdict is withheld with it.
    await revokeConsent(ids[1], "LANE_A");
    const suppressed = await loadProposal(inputs);
    expect(suppressed.cohort.matched.suppressed).toBe(true);
    expect(suppressed.cohort.matched.display).not.toContain("10");
    expect(suppressed.feasibility.met).toBeNull();
  });

  it("single-group presets skip the two-group feasibility verdict", async () => {
    await seedConsented(12);
    const proposal = await loadProposal(parseProposalParams({ q: "sensor-validation" }));
    expect(proposal.feasibility.met).toBeNull();
  });

  it("shows the firmness sub-count breakdown from the same lattice — banded, and only when firmness is unfiltered", async () => {
    await seedConsented(12);
    const withBreakdown = await loadProposal(
      parseProposalParams({ q: "sponsor-lines-vs-category" })
    );
    expect(withBreakdown.firmnessBreakdown).not.toBeNull();
    expect(withBreakdown.firmnessBreakdown).toHaveLength(3);
    for (const row of withBreakdown.firmnessBreakdown ?? []) {
      // No purchases in this fixture: every firmness cell is an honest 0 —
      // and never an exact non-zero count.
      expect(row.released.display).toBe("0");
    }

    const filtered = await loadProposal(
      parseProposalParams({ q: "sponsor-lines-vs-category", firmness: "medium" })
    );
    expect(filtered.firmnessBreakdown).toBeNull();
  });

  it("logs every released count to the release ledger (manifest linkage, level-up 6/10)", async () => {
    await seedConsented(12);
    const inputs = parseProposalParams({ q: "sponsor-lines-vs-category", severity: "moderate" });
    const proposal = await loadProposal(inputs);

    const entries = await prisma.releaseLedgerEntry.findMany({
      orderBy: { createdAt: "asc" },
    });
    // matched + cohort_total + 3 firmness sub-counts, all from this render.
    expect(proposal.releasesLogged).toBe(5);
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((entry) => entry.surface))).toEqual(
      new Set(["partner_proposal"])
    );
    expect(entries.map((entry) => entry.metric).sort()).toEqual([
      "cohort_total",
      "firmness:firm",
      "firmness:medium",
      "firmness:soft",
      "matched",
    ]);
    for (const entry of entries) {
      expect(entry.query).toBe("q=sponsor-lines-vs-category&severity=moderate&dur=6");
      expect(entry.clockDate).toEqual(SIM_TODAY);
      // The ledger records BANDS, never exact non-zero counts.
      expect(["0", "11–20", "<11 (suppressed)"]).toContain(entry.band);
    }
    // The whole tier (12) releases as its band; the severity-filtered
    // matched cell in this fixture is an honest 0 (no HST data seeded).
    const total = entries.find((entry) => entry.metric === "cohort_total");
    expect(total?.band).toBe("11–20");
    const matched = entries.find((entry) => entry.metric === "matched");
    expect(matched?.band).toBe("0");
  });
});

describe("approved query families (level-up 6)", () => {
  it("drops filters outside the preset's family — free combination only within it", () => {
    // The flagship positional family is severity × supine × firmness: an
    // `arm` filter (which would rebuild the audit's 4-dimension differencing
    // query) is ignored.
    const inputs = parseProposalParams({
      q: "positional-firmness",
      severity: "moderate",
      arm: "appliance_mattress",
      firmness: "soft",
    });
    expect(inputs.preset.family.filterKeys).toEqual(["severity", "supine", "firmness"]);
    expect(inputs.filters).toEqual({ severity: "moderate", supine: "y", firmness: "soft" });
    expect(inputs.filters.arm).toBeUndefined();
  });

  it("every preset declares its family, and defaults stay inside it", () => {
    for (const preset of PROPOSAL_PRESETS) {
      expect(preset.family.filterKeys.length).toBeGreaterThan(0);
      expect(preset.family.label.length).toBeGreaterThan(0);
      for (const key of Object.keys(preset.defaultFilters)) {
        expect(preset.family.filterKeys).toContain(key);
      }
    }
  });
});

describe("presets", () => {
  it("every preset names its SPEC anchor and carries a price band", () => {
    for (const preset of PROPOSAL_PRESETS) {
      expect(preset.specRef).toMatch(/SPEC §/);
      expect(preset.priceBand.min).toBeGreaterThan(0);
      expect(preset.priceBand.max).toBeGreaterThan(preset.priceBand.min);
      expect(preset.primaryEndpoint.length).toBeGreaterThan(0);
    }
  });
});
