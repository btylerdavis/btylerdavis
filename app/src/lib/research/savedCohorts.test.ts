import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import {
  deleteSavedCohort,
  filterSummary,
  listSavedCohorts,
  normalizeCohortQuery,
  saveCohort,
} from "./savedCohorts";

/**
 * Saved cohorts: a bookmark is a validated filter query string plus a
 * consent-filtered count snapshot — junk params never round-trip into the
 * database, names are validated, and no participant ids are stored anywhere.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
  await prisma.deletionRequest.deleteMany();
  await prisma.savedCohort.deleteMany();
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

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

afterAll(async () => {
  await prisma.savedCohort.deleteMany();
});

describe("normalizeCohortQuery / filterSummary", () => {
  it("round-trips valid filters and drops junk params and values", () => {
    const { filters, query } = normalizeCohortQuery(
      "supine=y&firmness=medium&bogus=1&severity=nope&sex=female"
    );
    expect(filters).toEqual({ supine: "y", firmness: "medium", sex: "female" });
    expect(query).toBe("supine=y&firmness=medium&sex=female");
    expect(normalizeCohortQuery("").query).toBe("");
    expect(filterSummary(filters)).toBe("supine-predominant · Medium (5–7) · female");
    expect(filterSummary({})).toBe("All research-consented participants");
  });
});

describe("saveCohort / listSavedCohorts / deleteSavedCohort", () => {
  it("stores the normalized query with a recomputed snapshot; list links back; delete removes", async () => {
    const saved = await saveCohort("  Demo bookmark  ", "supine=y&firmness=medium&bogus=1");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.cohort.name).toBe("Demo bookmark");
    expect(saved.cohort.query).toBe("supine=y&firmness=medium");
    // Empty test cohort → snapshot recomputed server-side as 0, not trusted
    // from any client-supplied number.
    expect(saved.cohort.matched).toBe(0);
    expect(saved.cohort.cohortTotal).toBe(0);
    expect(saved.cohort.clockDate).toEqual(SIM_TODAY);

    const list = await listSavedCohorts();
    expect(list).toHaveLength(1);
    expect(list[0].href).toBe("/research?supine=y&firmness=medium");
    expect(list[0].summary).toBe("supine-predominant · Medium (5–7)");

    expect(await deleteSavedCohort(list[0].id)).toBe(true);
    expect(await listSavedCohorts()).toHaveLength(0);
    expect(await deleteSavedCohort(list[0].id)).toBe(false); // idempotent
  });

  it("refuses empty and over-long names", async () => {
    expect(await saveCohort("   ", "")).toEqual({ ok: false, error: "Give the cohort a name" });
    const long = await saveCohort("x".repeat(61), "");
    expect(long.ok).toBe(false);
    expect(await prisma.savedCohort.count()).toBe(0);
  });
});
