// A small seeded random-number generator (mulberry32). Its whole state is one 32-bit number,
// so a run can save it and carry on exactly where it left off.

export class Rng {
  constructor(public state: number) { this.state = state >>> 0; }

  /** A float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }

  /** Pick an index by weight. */
  weighted(weights: number[]): number {
    const t = weights.reduce((a, b) => a + b, 0);
    let x = this.next() * t;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }
}

/** A seed from a string the player can type ("Hogarth") or a number. */
export function seedFrom(s: string | number): number {
  if (typeof s === 'number') return s >>> 0;
  if (/^\d+$/.test(s.trim())) return Number(s.trim()) >>> 0;
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Pick a segment index from Wheel odds. */
export function pickSegment(p: number[], x: number): number {
  let acc = 0;
  for (let i = 0; i < p.length; i++) { acc += p[i]; if (x < acc) return i; }
  return p.length - 1;
}
