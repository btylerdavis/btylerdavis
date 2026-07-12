import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { advanceDays, setSimClock } from "./simclock";
import { enrollmentRows } from "./synthetic/enrollment";
import { addDays, buildProfile, DEMO_EPOCH, MARCUS_REED_PARTICIPANT_ID } from "./synthetic/profiles";
import { MATTRESS_CATALOG } from "./synthetic/catalog";
import { enrollRetail, recordMattressPurchase, connectWearable } from "@/app/enroll/retail/actions";
import {
  enrollClinicPatient,
  confirmHstIntake,
  loadSampleHst,
  recordCpapSetup,
} from "@/app/enroll/clinic/actions";
import type { StopBangAnswers } from "./stopbang";

const MARCUS_ANSWERS: StopBangAnswers = {
  snoring: true, tiredness: true, observed_apnea: true, pressure: true,
  bmi: false, age: true, neck: true, gender: true,
};
const ALL_ON = { wearable_sleep: true, sleep_mat: true, mattress_purchase: true, pro_responses: true };

async function wipe() {
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

async function insertSeeded(profile: ReturnType<typeof buildProfile>) {
  const rows = enrollmentRows(profile);
  await prisma.participant.create({ data: rows.participant });
  await prisma.consentRecord.createMany({ data: rows.consentRecords });
  await prisma.device.createMany({ data: rows.devices });
}

describe("REPRO: advance after live enroll", () => {
  beforeEach(async () => {
    await wipe();
    await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });
  });

  it("advanceDays throws after a live retail+clinic enrollment", async () => {
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    await insertSeeded(marcus);

    await setSimClock(new Date(Date.UTC(2026, 5, 30))); // 2026-06-30

    // Full live enrollment: retail -> clinic -> HST -> CPAP -> mattress.
    const retail = await enrollRetail({ displayName: "Live Larry", answers: MARCUS_ANSWERS, toggles: ALL_ON });
    await connectWearable(retail.participantId, "apple");
    await recordMattressPurchase(retail.participantId, "TP-PROADAPT-MH-Q");
    const clinic = await enrollClinicPatient({ mode: "existing", participantId: retail.participantId }, true);
    const sample = await loadSampleHst("report");
    if (sample.ok) await confirmHstIntake(clinic.participantId, sample.parsed);
    await recordCpapSetup(clinic.participantId, "airsense11");

    // Set clock to day 90 (seed's initial clock). Every derived profile has
    // enrollmentDate <= DEMO_EPOCH+75, so the window (90, 97] is always after
    // enrollment and nights always generate — deterministic reproduction.
    await setSimClock(addDays(DEMO_EPOCH, 90));

    const liveProfile = buildProfile(retail.participantId);
    console.log("REPRO live profile enrollmentDate:", liveProfile.enrollmentDate.toISOString().slice(0, 10),
      "hasCpap:", liveProfile.hasCpap, "wearableDeviceId:", liveProfile.wearableDeviceId);
    console.log("REPRO real devices:", (await prisma.device.findMany({ where: { participantId: retail.participantId }, select: { id: true, deviceClass: true } })));

    let caught: unknown = null;
    try {
      await advanceDays(7);
    } catch (e) {
      caught = e;
    }
    if (caught) {
      const err = caught as Error;
      console.log("REPRO ERROR NAME:", err.name);
      console.log("REPRO ERROR MSG:", err.message);
      console.log("REPRO ERROR CODE:", (err as { code?: string }).code);
      console.log("REPRO ERROR STACK:", err.stack?.split("\n").slice(0, 12).join("\n"));
    } else {
      console.log("REPRO: advanceDays did NOT throw");
    }
    expect(caught).not.toBeNull();
  });
});
