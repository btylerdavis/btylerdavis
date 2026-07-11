/**
 * Disclosure-control count banding (audit F-12, level-up 10).
 *
 * Partner-facing surfaces never release an exact participant count. Every
 * count leaves the system as a BAND — `<11 (suppressed)`, `11–20`, `21–50`,
 * `51–200`, `>200` — so the subtraction arithmetic that defeated pure
 * k-suppression (parent 21 − sibling 20 − sibling 0 = suppressed cell 1)
 * no longer resolves to a value: differencing banded intervals yields
 * intervals at least as wide as a band, never a number.
 *
 * A count of 0 is released as "0": an empty cell describes no individual.
 * Counts 1–10 are the k<11 small cells and stay suppressed exactly as
 * before. Banding is STATELESS and deterministic, so the same query always
 * releases the same band — repeated queries can never be averaged into a
 * tighter estimate.
 *
 * `ReleasedCount.min`/`max` carry the interval the release admits — exactly
 * what an attacker learns. The lattice auditor (lattice.ts) propagates these
 * intervals through every parent/child sum constraint and proves no
 * suppressed cell is reconstructable; when it ever would be, complementary
 * suppression (withholdCount) widens the released set until it is not.
 */

export interface CountBand {
  key: string;
  label: string;
  min: number;
  /** null = unbounded above */
  max: number | null;
}

/** k threshold below which a non-zero count is a small cell (unchanged). */
export const BAND_SUPPRESS_THRESHOLD = 11;

/** The released band ladder (level-up 10 / task spec). */
export const COUNT_BANDS: readonly CountBand[] = [
  { key: "suppressed", label: `<${BAND_SUPPRESS_THRESHOLD} (suppressed)`, min: 1, max: 10 },
  { key: "11-20", label: "11–20", min: 11, max: 20 },
  { key: "21-50", label: "21–50", min: 21, max: 50 },
  { key: "51-200", label: "51–200", min: 51, max: 200 },
  { key: ">200", label: ">200", min: 201, max: null },
];

export interface ReleasedCount {
  /** true when the count itself is withheld (small cell or complementary) */
  suppressed: boolean;
  /** band key: "0" | "suppressed" | "withheld" | "11-20" | "21-50" | ... */
  band: string;
  /** what surfaces render */
  display: string;
  /** lower bound the release admits */
  min: number;
  /** upper bound the release admits (null = unbounded) */
  max: number | null;
}

/**
 * Bands one count for release. Exact values never leave: only 0 (which
 * describes no individual) is released as itself.
 */
export function bandCount(n: number): ReleasedCount {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`bandCount: expected a non-negative integer count, got ${n}`);
  }
  if (n === 0) return { suppressed: false, band: "0", display: "0", min: 0, max: 0 };
  const band = COUNT_BANDS.find(
    (candidate) => n >= candidate.min && (candidate.max === null || n <= candidate.max)
  );
  if (!band) throw new Error(`bandCount: no band covers ${n}`); // unreachable
  if (band.key === "suppressed") {
    return { suppressed: true, band: band.key, display: band.label, min: band.min, max: band.max };
  }
  return { suppressed: false, band: band.key, display: band.label, min: band.min, max: band.max };
}

/**
 * Complementary (secondary) suppression: withholds an otherwise-releasable
 * cell so a neighbouring suppressed cell cannot be reconstructed. The
 * display deliberately says nothing about magnitude — the admitted interval
 * is [0, ∞).
 */
export function withholdCount(): ReleasedCount {
  return {
    suppressed: true,
    band: "withheld",
    display: "withheld (complementary suppression)",
    min: 0,
    max: null,
  };
}
