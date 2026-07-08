/**
 * Deterministic PRNG utilities. NO Math.random anywhere in the synthetic
 * pipeline — all randomness flows from sfc32 generators seeded via the
 * cyrb128 string hash, so the cohort is exactly reproducible run-to-run and
 * the time machine regenerates the same night a full seed would have
 * produced. sfc32's 128-bit state (vs. a mulberry32-style 32-bit state)
 * keeps millions of independently-seeded streams collision-free — the
 * generator mints ~1M UUIDs per seed run.
 */

/** cyrb128 — 128-bit string hash for PRNG seeding. */
export function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32 — small fast counter PRNG, 128-bit state. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Convenience wrapper with distribution helpers. */
export class Rng {
  private next: () => number;

  constructor(seed: number | string) {
    const [a, b, c, d] = cyrb128(String(seed));
    this.next = sfc32(a, b, c, d);
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
