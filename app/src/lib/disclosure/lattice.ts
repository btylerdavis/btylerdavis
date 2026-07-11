import { bandCount, withholdCount, type ReleasedCount } from "./bands";

/**
 * Query-lattice disclosure control (audit F-12, level-up 10).
 *
 * The proposal generator's filters (severity × supine × arm × firmness) form
 * a query LATTICE: every filter combination is a cell, every unfiltered
 * dimension makes a cell the sum of its children along that dimension. The
 * audit's differencing attack worked one such edge: parent 21 − sibling 20 −
 * sibling 0 = suppressed cell 1.
 *
 * This module releases the ENTIRE lattice at once, not one cell at a time:
 *
 * 1. every cell is BANDED (bands.ts) — exact counts never leave;
 * 2. an adversarial audit (auditLatticeRelease) propagates the released
 *    intervals through every parent/children constraint to a fixpoint,
 *    assuming the attacker knows the release rules AND the schema's
 *    structural facts (which partitions are exact — the knowledge the
 *    original attack used);
 * 3. while any suppressed cell's feasible interval collapses to a single
 *    value, COMPLEMENTARY SUPPRESSION withholds the neighbouring cell that
 *    pins it, and the audit reruns — the released lattice ships only when
 *    the audit proves ZERO inferable cells.
 *
 * Because banding is stateless and the release is computed lattice-wide,
 * any sequence of proposal queries a partner issues sees one consistent,
 * differencing-safe view of the same snapshot.
 */

export const LATTICE_DIMENSIONS = {
  severity: ["mild", "moderate", "severe"],
  supine: ["y", "n"],
  arm: ["cpap", "appliance", "mattress_only", "cpap_mattress", "appliance_mattress"],
  firmness: ["soft", "medium", "firm"],
} as const;

export const LATTICE_DIM_ORDER = ["severity", "supine", "arm", "firmness"] as const;
export type LatticeDimension = (typeof LATTICE_DIM_ORDER)[number];

/** A lattice cell address: any subset of the four dimensions, value-fixed. */
export type LatticeFilters = Partial<Record<LatticeDimension, string>>;

/**
 * One research-tier member's disclosure-relevant attributes. `null` means
 * the attribute is unreadable/absent (consent-scoped out or no purchase):
 * the member counts in parents but in no child along that dimension —
 * exactly how the cohort explorer's filters treat them.
 */
export interface DisclosureMemberAttrs {
  severity: string | null;
  supine: "y" | "n" | null;
  arm: string | null;
  firmness: string | null;
}

/** Canonical cell key, e.g. "severity=moderate&supine=y" (root = ""). */
export function latticeKey(filters: LatticeFilters): string {
  return LATTICE_DIM_ORDER.filter((dim) => filters[dim] !== undefined)
    .map((dim) => `${dim}=${filters[dim]}`)
    .join("&");
}

function isDimValue(dim: LatticeDimension, value: string | null): boolean {
  return value !== null && (LATTICE_DIMENSIONS[dim] as readonly string[]).includes(value);
}

/** Every cell of the lattice (all value choices incl. "unset" per dim). */
export function allLatticeFilters(): LatticeFilters[] {
  let cells: LatticeFilters[] = [{}];
  for (const dim of LATTICE_DIM_ORDER) {
    const next: LatticeFilters[] = [];
    for (const cell of cells) {
      next.push(cell);
      for (const value of LATTICE_DIMENSIONS[dim]) {
        next.push({ ...cell, [dim]: value });
      }
    }
    cells = next;
  }
  return cells;
}

/**
 * Exact member counts for EVERY lattice cell. A member with a null (or
 * unknown — fail closed) attribute matches no child cell of that dimension
 * but still counts in the parent, which is why parent/children constraints
 * carry a remainder.
 */
export function buildCountLattice(members: DisclosureMemberAttrs[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of allLatticeFilters()) counts.set(latticeKey(cell), 0);

  for (const member of members) {
    // Every cell this member matches: per dimension, either "unset" or the
    // member's own (valid) value.
    let keys: LatticeFilters[] = [{}];
    for (const dim of LATTICE_DIM_ORDER) {
      const value = member[dim];
      const next: LatticeFilters[] = [];
      for (const cell of keys) {
        next.push(cell);
        if (isDimValue(dim, value)) next.push({ ...cell, [dim]: value as string });
      }
      keys = next;
    }
    for (const cell of keys) {
      const key = latticeKey(cell);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** One parent = Σ children (+ remainder ≥ 0) constraint of the lattice. */
export interface LatticePartition {
  parentKey: string;
  parentFilters: LatticeFilters;
  dim: LatticeDimension;
  childKeys: string[];
}

/** All parent/children partitions (every cell × every unset dimension). */
export function latticePartitions(): LatticePartition[] {
  const partitions: LatticePartition[] = [];
  for (const cell of allLatticeFilters()) {
    for (const dim of LATTICE_DIM_ORDER) {
      if (cell[dim] !== undefined) continue;
      partitions.push({
        parentKey: latticeKey(cell),
        parentFilters: cell,
        dim,
        childKeys: LATTICE_DIMENSIONS[dim].map((value) =>
          latticeKey({ ...cell, [dim]: value })
        ),
      });
    }
  }
  return partitions;
}

/** Treatment arms that structurally imply a readable mattress purchase. */
const MATTRESS_ARMS = ["mattress_only", "cpap_mattress", "appliance_mattress"];

/**
 * Where the attacker STRUCTURALLY knows a partition's remainder is zero —
 * i.e. the children exactly partition the parent. This is the knowledge the
 * audit's differencing attack used: every member matching a
 * mattress-including arm has a readable purchase, hence a non-null firmness
 * band, so parent = soft + medium + firm exactly. Everywhere else the
 * remainder (members with a null attribute) is an unknown ≥ 0 — an attacker
 * cannot reconstruct across those edges, only bound them.
 */
export function partitionIsExact(partition: LatticePartition): boolean {
  return (
    partition.dim === "firmness" &&
    partition.parentFilters.arm !== undefined &&
    MATTRESS_ARMS.includes(partition.parentFilters.arm)
  );
}

interface Interval {
  lo: number;
  hi: number; // Infinity = unbounded
}

function intervalOf(released: ReleasedCount): Interval {
  return { lo: released.min, hi: released.max ?? Infinity };
}

export interface LatticeAuditResult {
  /** suppressed cells whose exact value the released lattice pins */
  inferable: { key: string; value: number }[];
  /** the feasible interval per cell after constraint propagation */
  intervals: Map<string, Interval>;
  /** checker soundness: every true count sits inside its final interval */
  sound: boolean;
}

/**
 * Differencing audit: interval constraint propagation over every partition
 * of the lattice, under an attacker who knows the release rules and the
 * STRUCTURAL facts of the schema (which partitions are exact —
 * partitionIsExact). Exact partitions propagate as equalities (the audit's
 * subtraction attack); all others as `Σ children ≤ parent` inequalities,
 * because their remainder (members with a null attribute) is an unknown
 * ≥ 0 the attacker cannot observe. A suppressed cell whose feasible
 * interval collapses to one value is INFERABLE — the released lattice must
 * have none.
 */
export function auditLatticeRelease(
  released: Map<string, ReleasedCount>,
  counts: Map<string, number>
): LatticeAuditResult {
  const partitions = latticePartitions();
  const intervals = new Map<string, Interval>();
  for (const [key, release] of released) intervals.set(key, intervalOf(release));

  const clamp = (key: string, lo: number, hi: number): boolean => {
    const current = intervals.get(key);
    if (!current) return false;
    const nextLo = Math.max(current.lo, lo);
    const nextHi = Math.min(current.hi, hi);
    if (nextLo === current.lo && nextHi === current.hi) return false;
    intervals.set(key, { lo: nextLo, hi: nextHi });
    return true;
  };

  // Defensive soundness check: a partition is treated as exact only when the
  // structural claim actually holds in the data (it always should).
  const exactPartition = (partition: LatticePartition): boolean => {
    if (!partitionIsExact(partition)) return false;
    const parent = counts.get(partition.parentKey) ?? 0;
    const childSum = partition.childKeys.reduce(
      (sum, key) => sum + (counts.get(key) ?? 0),
      0
    );
    return parent === childSum;
  };
  const exactness = new Map(
    partitions.map((partition) => [
      `${partition.parentKey}|${partition.dim}`,
      exactPartition(partition),
    ])
  );

  // Propagate to a fixpoint:
  //   exact:   t(parent) = Σ t(children)
  //   default: t(parent) ≥ Σ t(children)   (remainder unknown, ≥ 0)
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (const partition of partitions) {
      const isExact = exactness.get(`${partition.parentKey}|${partition.dim}`) as boolean;
      const children = partition.childKeys.map((key) => intervals.get(key) as Interval);
      const parent = intervals.get(partition.parentKey) as Interval;

      const sumLo = children.reduce((sum, child) => sum + child.lo, 0);
      const sumHi = children.reduce((sum, child) => sum + child.hi, 0);
      changed = clamp(partition.parentKey, sumLo, isExact ? sumHi : Infinity) || changed;

      partition.childKeys.forEach((childKey, index) => {
        // Sum the OTHER children directly — subtracting child.hi from sumHi
        // is NaN when both are Infinity (unbounded bands).
        let othersLo = 0;
        let othersHi = 0;
        for (let j = 0; j < children.length; j++) {
          if (j === index) continue;
          othersLo += children[j].lo;
          othersHi += children[j].hi;
        }
        // Upper bound holds regardless of the remainder; the lower bound
        // exists only when the partition is exact.
        changed =
          clamp(
            childKey,
            isExact ? parent.lo - othersHi : 0,
            parent.hi - othersLo
          ) || changed;
      });
    }
    if (!changed) break;
  }

  const inferable: { key: string; value: number }[] = [];
  let sound = true;
  for (const [key, release] of released) {
    const interval = intervals.get(key) as Interval;
    const truth = counts.get(key) ?? 0;
    if (truth < interval.lo || truth > interval.hi) sound = false;
    if (release.suppressed && interval.lo === interval.hi) {
      inferable.push({ key, value: interval.lo });
    }
  }
  return { inferable, intervals, sound };
}

export interface LatticeRelease {
  released: Map<string, ReleasedCount>;
  /** cells withheld by the complementary pass (beyond primary suppression) */
  complementaryKeys: string[];
  /** final audit — inferable is empty by construction */
  audit: LatticeAuditResult;
}

/**
 * Releases the whole lattice: bands every cell, then runs the differencing
 * audit and applies complementary suppression until ZERO cells are
 * inferable. `release` is the per-cell policy (bandCount in production; the
 * tests also drive the complementary machinery with a hostile exact-count
 * policy to prove the loop repairs even that).
 */
export function releaseLattice(
  counts: Map<string, number>,
  opts: { release?: (n: number) => ReleasedCount } = {}
): LatticeRelease {
  const release = opts.release ?? bandCount;
  const released = new Map<string, ReleasedCount>();
  for (const [key, count] of counts) released.set(key, release(count));

  const partitions = latticePartitions();
  const complementaryKeys: string[] = [];

  let audit = auditLatticeRelease(released, counts);
  // Each pass withholds ≥1 more cell, so the loop terminates well before
  // every cell is withheld.
  for (let pass = 0; pass <= counts.size && audit.inferable.length > 0; pass++) {
    for (const cell of audit.inferable) {
      const victim = pickComplementaryVictim(cell.key, released, counts, partitions);
      if (victim !== null && released.get(victim)?.band !== "withheld") {
        released.set(victim, withholdCount());
        complementaryKeys.push(victim);
      }
    }
    audit = auditLatticeRelease(released, counts);
  }
  if (audit.inferable.length > 0) {
    // Fail closed: never ship an inferable lattice.
    throw new Error(
      `releaseLattice: complementary suppression did not converge — ` +
        `${audit.inferable.length} cell(s) still inferable`
    );
  }
  return { released, complementaryKeys, audit };
}

/**
 * The cell to withhold so `key` stops being pinned: the smallest released
 * sibling in one of the partitions containing the cell, else the parent,
 * else (when the cell is itself a parent) its smallest released child.
 */
function pickComplementaryVictim(
  key: string,
  released: Map<string, ReleasedCount>,
  counts: Map<string, number>,
  partitions: LatticePartition[]
): string | null {
  const candidates: { key: string; count: number; tier: number }[] = [];
  for (const partition of partitions) {
    if (partition.childKeys.includes(key)) {
      for (const sibling of partition.childKeys) {
        if (sibling === key) continue;
        const release = released.get(sibling);
        if (release && !release.suppressed) {
          const count = counts.get(sibling) ?? 0;
          // Prefer small non-zero siblings; zero siblings before the parent.
          candidates.push({ key: sibling, count, tier: count > 0 ? 0 : 1 });
        }
      }
      const parentRelease = released.get(partition.parentKey);
      if (parentRelease && !parentRelease.suppressed) {
        candidates.push({
          key: partition.parentKey,
          count: counts.get(partition.parentKey) ?? 0,
          tier: 2,
        });
      }
    }
    if (partition.parentKey === key) {
      for (const child of partition.childKeys) {
        const release = released.get(child);
        if (release && !release.suppressed) {
          candidates.push({ key: child, count: counts.get(child) ?? 0, tier: 3 });
        }
      }
    }
  }
  candidates.sort((a, b) => a.tier - b.tier || a.count - b.count || a.key.localeCompare(b.key));
  return candidates[0]?.key ?? null;
}

/**
 * Test/demonstration policy: the PRE-FIX release shape (exact counts with
 * per-cell k-suppression only). auditLatticeRelease finds the audit's
 * subtraction attack against this immediately — and releaseLattice's
 * complementary pass must repair even a lattice released this badly.
 */
export function exactCountRelease(n: number): ReleasedCount {
  if (n > 0 && n < 11) {
    return { suppressed: true, band: "suppressed", display: "<11 (suppressed)", min: 1, max: 10 };
  }
  return { suppressed: false, band: "exact", display: String(n), min: n, max: n };
}
