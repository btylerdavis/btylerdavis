/**
 * Deterministic PRNG utilities. NO Math.random anywhere in the synthetic
 * pipeline — all randomness flows from mulberry32 seeded via fnv1a hashes,
 * so the cohort is exactly reproducible run-to-run, and the time machine
 * regenerates the same night a full seed would have produced.
 */

/** FNV-1a 32-bit hash — stable string → uint32 seed derivation. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, good-enough 32-bit seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper with distribution helpers. */
export class Rng {
  private next: () => number;

  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === "string" ? fnv1a(seed) : seed);
  }

  /** uniform [0, 1) */
  random(): number {
    return this.next();
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** normal via Box-Muller */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** normal clamped to [min, max] */
  clampedNormal(mean: number, sd: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.normal(mean, sd)));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** weighted pick: entries of [value, weight] */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** RFC-4122-shaped v4 UUID drawn from this PRNG (deterministic). */
  uuid(): string {
    const hex = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else if (i === 19) out += hex[8 + Math.floor(this.next() * 4)];
      else out += hex[Math.floor(this.next() * 16)];
    }
    return out;
  }
}
