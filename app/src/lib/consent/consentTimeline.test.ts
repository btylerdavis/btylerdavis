import { describe, expect, it } from "vitest";
import {
  computeConsentTimeline,
  monthKey,
  type TimelineLedgerEvent,
} from "./consentTimeline";
import type { ConsentScope } from "./types";

/**
 * Attrition/consent-change timeline (audit level-up 11): the pure ledger →
 * per-month projection. Events are replayed per (participant, instrument)
 * stream in revision order, so partial revocations and restores are counted
 * against the instrument's ACTUAL previous state.
 */

const scope = (dataClasses: string[]): string =>
  JSON.stringify(
    dataClasses.flatMap((dataClass) =>
      (["collect", "view_identified", "research_deid"] as const).map((use) => ({
        dataClass,
        use,
      }))
    ) as ConsentScope
  );

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function event(overrides: Partial<TimelineLedgerEvent>): TimelineLedgerEvent {
  return {
    participantId: "p1",
    instrumentType: "LANE_B",
    eventType: "grant",
    revision: 1,
    status: "granted",
    grantedAt: day("2026-04-10"),
    revokedAt: null,
    scope: scope(["wearable_sleep", "pro_responses"]),
    createdAt: day("2026-04-10"),
    ...overrides,
  };
}

describe("computeConsentTimeline", () => {
  it("buckets enrollments and executed deletions by month", () => {
    const rows = computeConsentTimeline({
      events: [],
      enrollments: [day("2026-04-01"), day("2026-04-20"), day("2026-06-05")],
      deletions: [day("2026-06-28")],
    });
    expect(rows.map((row) => row.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(rows[0].enrollments).toBe(2);
    expect(rows[1]).toMatchObject({ enrollments: 0, deletions: 0 }); // gap month zero-filled
    expect(rows[2]).toMatchObject({ enrollments: 1, deletions: 1 });
  });

  it("counts a full revocation in its revokedAt month; the enrollment grant is not a re-consent", () => {
    const rows = computeConsentTimeline({
      events: [
        event({ revision: 1 }),
        event({
          revision: 2,
          eventType: "revoke",
          status: "revoked",
          revokedAt: day("2026-05-14"),
          createdAt: day("2026-05-14"),
        }),
      ],
      enrollments: [day("2026-04-10")],
      deletions: [],
    });
    const may = rows.find((row) => row.month === "2026-05");
    expect(may?.fullRevocations).toBe(1);
    expect(rows.every((row) => row.reconsents === 0)).toBe(true);
  });

  it("scope_revision removing one class = 1 class revocation; adding it back = 1 restore", () => {
    const rows = computeConsentTimeline({
      events: [
        event({ revision: 1 }),
        event({
          revision: 2,
          eventType: "scope_revision",
          scope: scope(["pro_responses"]), // wearable_sleep removed
          grantedAt: day("2026-05-02"),
          createdAt: day("2026-05-02"),
        }),
        event({
          revision: 3,
          eventType: "scope_revision",
          scope: scope(["pro_responses", "wearable_sleep"]), // restored
          grantedAt: day("2026-06-09"),
          createdAt: day("2026-06-09"),
        }),
      ],
      enrollments: [],
      deletions: [],
    });
    expect(rows.find((row) => row.month === "2026-05")).toMatchObject({
      classRevocations: 1,
      restores: 0,
    });
    expect(rows.find((row) => row.month === "2026-06")).toMatchObject({
      classRevocations: 0,
      restores: 1,
    });
  });

  it("a restore after a FULL revocation re-adds every class from the empty state", () => {
    const rows = computeConsentTimeline({
      events: [
        event({ revision: 1 }),
        event({
          revision: 2,
          eventType: "revoke",
          status: "revoked",
          revokedAt: day("2026-05-01"),
          createdAt: day("2026-05-01"),
        }),
        event({
          revision: 3,
          eventType: "scope_revision",
          scope: scope(["wearable_sleep", "pro_responses"]),
          grantedAt: day("2026-05-20"),
          createdAt: day("2026-05-20"),
        }),
      ],
      enrollments: [],
      deletions: [],
    });
    const may = rows.find((row) => row.month === "2026-05");
    expect(may?.fullRevocations).toBe(1);
    expect(may?.restores).toBe(2); // both classes came back
    expect(may?.classRevocations).toBe(0);
  });

  it("a SIGNED grant after the first is a re-consent (the ceiling-extension event)", () => {
    const rows = computeConsentTimeline({
      events: [
        event({ revision: 1, grantedAt: day("2026-04-10") }),
        event({
          revision: 2,
          eventType: "revoke",
          status: "revoked",
          revokedAt: day("2026-05-01"),
          createdAt: day("2026-05-01"),
        }),
        event({
          revision: 3,
          eventType: "grant",
          scope: scope(["wearable_sleep", "pro_responses", "sleep_mat"]),
          grantedAt: day("2026-06-15"),
          createdAt: day("2026-06-15"),
        }),
      ],
      enrollments: [],
      deletions: [],
    });
    expect(rows.find((row) => row.month === "2026-06")?.reconsents).toBe(1);
  });

  it("streams are independent per participant and instrument", () => {
    const rows = computeConsentTimeline({
      events: [
        event({ participantId: "p1", instrumentType: "LANE_A", revision: 1 }),
        event({ participantId: "p2", instrumentType: "LANE_A", revision: 1 }),
        // p2's LANE_A revoke must not count against p1's stream.
        event({
          participantId: "p2",
          instrumentType: "LANE_A",
          revision: 2,
          eventType: "revoke",
          status: "revoked",
          revokedAt: day("2026-04-30"),
          createdAt: day("2026-04-30"),
        }),
      ],
      enrollments: [],
      deletions: [],
    });
    expect(rows.find((row) => row.month === "2026-04")?.fullRevocations).toBe(1);
  });

  it("empty input → empty timeline; monthKey is UTC", () => {
    expect(computeConsentTimeline({ events: [], enrollments: [], deletions: [] })).toEqual([]);
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});
