/**
 * Per-species population model: births per generation N(g), cumulative C(g),
 * all integer (BigInt), built from a piecewise-linear size profile.
 *
 * Segment s covers generations [g0, g0 + L) and its births ramp linearly from
 * A (at its start) to B (at its end). We define the cumulative count first
 * (research/04 §6.1, "cumulative first"):
 *
 *   C(g0 + t) = C0 + floor((2·L·A·t + (B − A)·t²) / (2·L)),   0 ≤ t ≤ L
 *
 * which is the floor of the exact integral of the linear ramp. N(g) = C(g+1) − C(g)
 * is therefore consistent by construction, and N(g) ≥ min(A, B) ≥ 1 because the
 * real-valued increment is always between A and B. The segment total
 * C0' − C0 = floor(L·(A + B)/2) feeds the next segment's C0 (prefix table).
 */

export interface Segment {
  /** Number of generations in this segment (≥ 1). */
  generations: number;
  /** Births per generation at the start of the segment (≥ 1, ≥ 2 if sexual). */
  startSize: bigint | number;
  /** Births per generation at the end of the segment (defaults to startSize). */
  endSize?: bigint | number;
}

interface CompiledSegment {
  g0: number;
  L: number;
  LB: bigint;
  A: bigint;
  B: bigint;
  C0: bigint;
}

export class PopulationModel {
  /** Total number of generations G; valid generations are [0, G). */
  readonly generations: number;
  /** Total individuals ever, C(G). */
  readonly totalEver: bigint;
  private readonly segs: CompiledSegment[];

  constructor(segments: readonly Segment[], minSize: bigint) {
    if (segments.length === 0) throw new RangeError('PopulationModel: no segments');
    const segs: CompiledSegment[] = [];
    let g0 = 0;
    let C0 = 0n;
    for (const s of segments) {
      const L = s.generations;
      if (!Number.isSafeInteger(L) || L < 1) throw new RangeError(`bad segment length ${L}`);
      const A = BigInt(s.startSize);
      const B = BigInt(s.endSize ?? s.startSize);
      if (A < minSize || B < minSize) throw new RangeError(`segment sizes must be ≥ ${minSize}`);
      segs.push({ g0, L, LB: BigInt(L), A, B, C0 });
      C0 += (BigInt(L) * (A + B)) / 2n;
      g0 += L;
      if (!Number.isSafeInteger(g0)) throw new RangeError('too many generations');
    }
    this.segs = segs;
    this.generations = g0;
    this.totalEver = C0;
  }

  private segIndexOfGen(g: number): number {
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segs[mid]!.g0 <= g) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private static cum(s: CompiledSegment, t: bigint): bigint {
    const twoL = 2n * s.LB;
    return s.C0 + (twoL * s.A * t + (s.B - s.A) * t * t) / twoL;
  }

  /** C(g): individuals born before generation g. Defined for 0 ≤ g ≤ G. */
  cumulative(g: number): bigint {
    if (!Number.isSafeInteger(g) || g < 0 || g > this.generations) {
      throw new RangeError(`generation ${g} out of [0, ${this.generations}]`);
    }
    if (g === this.generations) return this.totalEver;
    const s = this.segs[this.segIndexOfGen(g)]!;
    return PopulationModel.cum(s, BigInt(g - s.g0));
  }

  /** N(g) = C(g+1) − C(g): births in generation g. */
  size(g: number): bigint {
    if (!Number.isSafeInteger(g) || g < 0 || g >= this.generations) {
      throw new RangeError(`generation ${g} out of [0, ${this.generations})`);
    }
    return this.cumulative(g + 1) - this.cumulative(g);
  }

  /** Generation containing global ordinal k ∈ [0, totalEver): binary search. */
  generationOf(k: bigint): number {
    if (k < 0n || k >= this.totalEver) throw new RangeError(`ordinal ${k} out of range`);
    // segment by prefix table
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segs[mid]!.C0 <= k) lo = mid;
      else hi = mid - 1;
    }
    const s = this.segs[lo]!;
    // largest t in [0, L) with cum(t) ≤ k
    let tlo = 0;
    let thi = s.L - 1;
    while (tlo < thi) {
      const mid = tlo + Math.ceil((thi - tlo) / 2);
      if (PopulationModel.cum(s, BigInt(mid)) <= k) tlo = mid;
      else thi = mid - 1;
    }
    return s.g0 + tlo;
  }
}
