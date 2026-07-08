import { buildPositionalDashboard } from "./positional";
import { loadResearchCohort, meanOf } from "./cohort";

/**
 * Mock conference abstract (DEMO.md Act 7 — "research output"), AASM SLEEP
 * style. The prose is a template; every number in Results is a LIVE query
 * against the consent-filtered research cohort, so advancing the time
 * machine changes the abstract. Production abstracts follow the
 * pre-specified SAP and the JV authorship policy (SPEC §11.2).
 */

export interface AbstractSection {
  heading: string;
  text: string;
}

export interface MockAbstract {
  clockIso: string;
  title: string;
  authors: string;
  affiliations: string;
  sections: AbstractSection[];
  stats: {
    cohortN: number;
    retailN: number;
    clinicN: number;
    supinePredominantN: number;
    flagshipN: number;
    instrumentedN: number;
    mediumBandDropPp: number | null;
    respondersN: number;
    respondersEss: number | null;
    nonRespondersEss: number | null;
    cpapAdherenceMean: number | null;
    cpapAdherenceN: number;
    essChangeMean: number | null;
    essChangeN: number;
  };
  /** plain-text rendering for the "Copy as text" button */
  plainText: string;
  queryMs: number;
}

const fmtSigned = (value: number, digits = 1): string =>
  `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;

export async function loadMockAbstract(): Promise<MockAbstract> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  const positional = buildPositionalDashboard(cohort);

  const members = cohort.members;
  const cohortN = members.length;
  const retailN = members.filter((m) => m.door === "retail").length;
  const clinicN = cohortN - retailN;
  const supinePredominantN = members.filter((m) => m.supinePredominant === true).length;
  const adherence = meanOf(members.map((m) => m.cpapAdherencePct));
  const essChange = meanOf(members.map((m) => m.essChangeFollowup));

  const stats: MockAbstract["stats"] = {
    cohortN,
    retailN,
    clinicN,
    supinePredominantN,
    flagshipN: positional.cohortCount,
    instrumentedN: positional.instrumentedCount,
    mediumBandDropPp: positional.mediumBandDropPp,
    respondersN: positional.respondersN,
    respondersEss: positional.respondersEssMean,
    nonRespondersEss: positional.nonRespondersEssMean,
    cpapAdherenceMean: adherence.mean,
    cpapAdherenceN: adherence.n,
    essChangeMean: essChange.mean,
    essChangeN: essChange.n,
  };

  const n = (value: number) => value.toLocaleString("en-US");

  const title =
    "Mattress Firmness and Supine Sleep Time in Positional Obstructive Sleep Apnea: " +
    "Early Results From a Linked Retail–Clinical Sleep Outcomes Registry";
  const authors = "Kunz K, Davis B, et al.";
  const affiliations =
    "Sleeptopia, Inc. and The Mattress Hub, Wichita, KS (joint-venture sleep outcomes registry)";

  const sections: AbstractSection[] = [
    {
      heading: "Introduction",
      text:
        "Positional obstructive sleep apnea (OSA) — apnea substantially worse in the supine " +
        "position — is common, yet the sleep surface itself is rarely measured as an exposure. " +
        "We describe a dual-door registry that links retail mattress purchases with clinical " +
        "sleep care, and report early supine-time outcomes after a mattress change in " +
        "supine-predominant OSA.",
    },
    {
      heading: "Methods",
      text:
        "Participants enroll through a retail door (STOP-BANG screening at mattress purchase, " +
        "consumer consent) or a clinical door (home sleep testing [HST], combined consent and " +
        "HIPAA authorization), with an optional linkage authorization joining the two records. " +
        "Nightly exposure and outcome data (under-mattress sensor supine time, CPAP telemetry, " +
        "wearable sleep, ESS at baseline/day 30/day 90) flow into a two-tier store; analyses run " +
        "on the de-identified research tier under per-data-class consent scopes. " +
        "Supine-predominant OSA was defined as supine AHI ≥ 2× non-supine AHI on the HST " +
        "position channel. Pre/post windows around mattress delivery excluded a 7-night " +
        "adjustment ramp; supine-time responders were defined a priori as a ≥ 8 percentage-point " +
        "(pp) reduction.",
    },
    {
      heading: "Results",
      text:
        `The registry holds ${n(cohortN)} consented participants (${n(clinicN)} clinic-enrolled, ` +
        `${n(retailN)} retail-enrolled); ${n(supinePredominantN)} are supine-predominant on HST. ` +
        `The flagship sub-cohort — supine-predominant OSA with a delivered mattress change — ` +
        `comprises ${n(stats.flagshipN)} participants, ${n(stats.instrumentedN)} instrumented ` +
        `with under-mattress sensors. ` +
        (stats.mediumBandDropPp !== null
          ? `Among purchasers of medium-firmness surfaces (5–7/10), mean nightly supine time ` +
            `fell ${stats.mediumBandDropPp.toFixed(1)} pp from the pre-delivery baseline. `
          : `Medium-firmness pre/post windows are still accruing. `) +
        (stats.respondersEss !== null && stats.nonRespondersEss !== null
          ? `Supine-time responders (n=${n(stats.respondersN)}) showed a mean ESS change of ` +
            `${fmtSigned(stats.respondersEss)} versus ${fmtSigned(stats.nonRespondersEss)} in ` +
            `non-responders. `
          : ``) +
        (stats.cpapAdherenceMean !== null
          ? `Mean CPAP adherence (nights ≥ 4 h, all post-setup nights) was ` +
            `${stats.cpapAdherenceMean.toFixed(0)}% across ${n(stats.cpapAdherenceN)} CPAP users` +
            (stats.essChangeMean !== null
              ? `, and cohort-wide ESS changed ${fmtSigned(stats.essChangeMean)} points from ` +
                `baseline to latest follow-up (n=${n(stats.essChangeN)})`
              : ``) +
            `.`
          : ``),
    },
    {
      heading: "Conclusion",
      text:
        "A consent-provenanced registry linking mattress exposure with clinical sleep outcomes " +
        "is feasible, and early signals suggest sleep-surface characteristics may modify supine " +
        "time in positional OSA. These observational findings are hypothesis-generating; " +
        "confirmatory analyses follow the registry's pre-specified statistical analysis plan.",
    },
  ];

  const plainText = [
    title,
    "",
    authors,
    affiliations,
    "",
    ...sections.map((section) => `${section.heading}: ${section.text}`),
    "",
    `Illustrative demonstration output — synthetic cohort, as of ${cohort.clock
      .toISOString()
      .slice(0, 10)}. Production abstracts follow the SAP and authorship policy (SPEC §11).`,
  ].join("\n");

  return {
    clockIso: cohort.clock.toISOString().slice(0, 10),
    title,
    authors,
    affiliations,
    sections,
    stats,
    plainText,
    queryMs: Math.round(performance.now() - startedAt),
  };
}
