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
 * through the same k-suppression as every other partner surface, and every
 * proposal must carry the §12.4 "rough band, not a quote" honesty line.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
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

describe("loadProposal — consent-filtered live n", () => {
  it("counts only research-consented participants; revocation shrinks it; small cells suppress", async () => {
    const ids = await seedConsented(12);
    // The category preset applies no default filters → matched = whole tier.
    const inputs = parseProposalParams({ q: "sponsor-lines-vs-category" });

    const before = await loadProposal(inputs);
    expect(before.cohort.matched).toEqual({ suppressed: false, display: "12" });
    expect(before.cohort.total.display).toBe("12");
    // 12 << 2 × §6.3 sketch (≈ 63/group) → honestly "not met".
    expect(before.feasibility.met).toBe(false);
    expect(before.feasibility.nPerGroup).toBeGreaterThanOrEqual(63);
    expect(before.honestyLine).toBe(PRICE_HONESTY_LINE);
    expect(before.priceBand.min).toBeGreaterThan(0);

    // Revoke one participant — the live count drops on the next generate.
    await revokeConsent(ids[0], "LANE_A");
    const after = await loadProposal(inputs);
    expect(after.cohort.matched).toEqual({ suppressed: false, display: "11" });

    // One more revocation puts the cell under k=11 → suppressed, no leak,
    // and the feasibility verdict is withheld with it.
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
