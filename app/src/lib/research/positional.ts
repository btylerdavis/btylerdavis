import {
  loadResearchCohort,
  meanOf,
  type FirmnessBand,
  type ResearchCohort,
  type ResearchMember,
} from "./cohort";

/**
 * Positional-OSA flagship dashboard (SPEC §6.3 visualized; DEMO.md Act 5's
 * money screen). Everything is computed from the consent-filtered research
 * cohort: supine-predominant participants with a mattress change, their
 * nightly under-mattress supine % bucketed by week relative to delivery,
 * per-brand before/after pairs, and the ESS outcome split for supine
 * responders vs non-responders.
 */

/** Weeks charted relative to delivery (week 0 = first post-delivery week). */
export const WEEK_MIN = -4;
export const WEEK_MAX = 8;

/** Groups below this n are greyed as "insufficient n" (scientific honesty). */
export const MIN_GROUP_N = 15;

/** A responder's supine time drops ≥ 8 percentage points pre→post. */
export const RESPONDER_DROP_PP = 8;

export interface WeeklyBandPoint {
  week: number;
  soft: number | null;
  medium: number | null;
  firm: number | null;
}

export interface BrandPair {
  brand: string;
  pre: number;
  post: number;
  n: number;
  insufficient: boolean;
}

export interface EssDistBucket {
  bucket: string;
  /** % of each group's participants landing in this ESS-change bucket */
  respondersPct: number;
  nonRespondersPct: number;
  respondersCount: number;
  nonRespondersCount: number;
}

export interface PositionalDashboard {
  clockIso: string;
  /** supine-predominant members with a mattress delivery (consent-filtered) */
  cohortCount: number;
  /** …of whom this many have under-mattress sensor nights in the window */
  instrumentedCount: number;
  weekly: WeeklyBandPoint[];
  bandN: Record<FirmnessBand, number>;
  /** medium-band supine drop, pre-mean − post-mean (headline effect size) */
  mediumBandDropPp: number | null;
  brandPairs: BrandPair[];
  essDist: EssDistBucket[];
  respondersN: number;
  nonRespondersN: number;
  respondersEssMean: number | null;
  nonRespondersEssMean: number | null;
  queryMs: number;
}

/** The flagship cohort: supine-predominant + delivered mattress change. */
export function isFlagshipMember(member: ResearchMember): boolean {
  return member.supinePredominant === true && member.deliveryDate !== null;
}

const ESS_BUCKETS = [
  { bucket: "≤ −6", test: (d: number) => d <= -6 },
  { bucket: "−5 to −4", test: (d: number) => d >= -5.5 && d < -3.5 },
  { bucket: "−3 to −2", test: (d: number) => d >= -3.5 && d < -1.5 },
  { bucket: "−1 to 0", test: (d: number) => d >= -1.5 && d <= 0.5 },
  { bucket: "≥ +1", test: (d: number) => d > 0.5 },
];

export function buildPositionalDashboard(cohort: ResearchCohort): PositionalDashboard {
  const flagship = cohort.members.filter(isFlagshipMember);
  const flagshipIds = new Set(flagship.map((member) => member.id));

  // --- weekly supine % by firmness band -------------------------------------
  // Per participant-week mean first, then average across participants, so a
  // participant with more recorded nights doesn't dominate the line.
  const perWeek = new Map<string, { sum: number; n: number }>(); // "pid|week"
  const withNights = new Set<string>();
  for (const night of cohort.supineNights) {
    if (!flagshipIds.has(night.participantId)) continue;
    withNights.add(night.participantId);
    const week = Math.floor(night.dayOffset / 7);
    if (week < WEEK_MIN || week > WEEK_MAX) continue;
    const key = `${night.participantId}|${week}`;
    const agg = perWeek.get(key) ?? { sum: 0, n: 0 };
    agg.sum += night.value;
    agg.n += 1;
    perWeek.set(key, agg);
  }

  const bandOf = new Map(flagship.map((member) => [member.id, member.firmnessBand]));
  const weekBand = new Map<string, { sum: number; n: number }>(); // "band|week"
  for (const [key, agg] of perWeek) {
    const [pid, weekStr] = key.split("|");
    const band = bandOf.get(pid);
    if (!band) continue;
    const bandKey = `${band}|${weekStr}`;
    const bucket = weekBand.get(bandKey) ?? { sum: 0, n: 0 };
    bucket.sum += agg.sum / agg.n;
    bucket.n += 1;
    weekBand.set(bandKey, bucket);
  }

  const weekly: WeeklyBandPoint[] = [];
  for (let week = WEEK_MIN; week <= WEEK_MAX; week++) {
    const point: WeeklyBandPoint = { week, soft: null, medium: null, firm: null };
    for (const band of ["soft", "medium", "firm"] as const) {
      const bucket = weekBand.get(`${band}|${week}`);
      if (bucket && bucket.n > 0) point[band] = round1(bucket.sum / bucket.n);
    }
    weekly.push(point);
  }

  const bandN: Record<FirmnessBand, number> = { soft: 0, medium: 0, firm: 0 };
  for (const member of flagship) {
    if (member.firmnessBand && withNights.has(member.id)) bandN[member.firmnessBand] += 1;
  }

  // Headline effect: medium-band mean of pre weeks vs post weeks +2..+8
  // (week 0–1 is the adjustment ramp).
  const mediumPre = meanOf(
    weekly.filter((p) => p.week < 0).map((p) => p.medium)
  );
  const mediumPost = meanOf(
    weekly.filter((p) => p.week >= 2).map((p) => p.medium)
  );
  const mediumBandDropPp =
    mediumPre.mean !== null && mediumPost.mean !== null
      ? round1(mediumPre.mean - mediumPost.mean)
      : null;

  // --- per-brand before/after pairs ------------------------------------------
  const byBrand = new Map<string, { pres: number[]; posts: number[] }>();
  for (const member of flagship) {
    if (member.brand === null || member.supinePre === null || member.supinePost === null) continue;
    const entry = byBrand.get(member.brand) ?? { pres: [], posts: [] };
    entry.pres.push(member.supinePre);
    entry.posts.push(member.supinePost);
    byBrand.set(member.brand, entry);
  }
  const brandPairs: BrandPair[] = [...byBrand.entries()]
    .map(([brand, { pres, posts }]) => ({
      brand,
      pre: round1(pres.reduce((a, b) => a + b, 0) / pres.length),
      post: round1(posts.reduce((a, b) => a + b, 0) / posts.length),
      n: pres.length,
      insufficient: pres.length < MIN_GROUP_N,
    }))
    .sort((a, b) => b.n - a.n || a.brand.localeCompare(b.brand));

  // --- ESS change: responders vs non-responders -------------------------------
  const outcomes = flagship.filter(
    (member) => member.supineChange !== null && member.essChangeFollowup !== null
  );
  const responders = outcomes.filter(
    (member) => (member.supineChange as number) <= -RESPONDER_DROP_PP
  );
  const nonResponders = outcomes.filter(
    (member) => (member.supineChange as number) > -RESPONDER_DROP_PP
  );

  const essDist: EssDistBucket[] = ESS_BUCKETS.map(({ bucket, test }) => {
    const respondersCount = responders.filter((m) => test(m.essChangeFollowup as number)).length;
    const nonRespondersCount = nonResponders.filter((m) =>
      test(m.essChangeFollowup as number)
    ).length;
    return {
      bucket,
      respondersCount,
      nonRespondersCount,
      respondersPct: responders.length
        ? round1((respondersCount / responders.length) * 100)
        : 0,
      nonRespondersPct: nonResponders.length
        ? round1((nonRespondersCount / nonResponders.length) * 100)
        : 0,
    };
  });

  return {
    clockIso: cohort.clock.toISOString().slice(0, 10),
    cohortCount: flagship.length,
    instrumentedCount: withNights.size,
    weekly,
    bandN,
    mediumBandDropPp,
    brandPairs,
    essDist,
    respondersN: responders.length,
    nonRespondersN: nonResponders.length,
    respondersEssMean: meanOf(responders.map((m) => m.essChangeFollowup)).mean,
    nonRespondersEssMean: meanOf(nonResponders.map((m) => m.essChangeFollowup)).mean,
    queryMs: cohort.queryMs,
  };
}

export async function loadPositionalDashboard(): Promise<PositionalDashboard> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  const dashboard = buildPositionalDashboard(cohort);
  return { ...dashboard, queryMs: Math.round(performance.now() - startedAt) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
