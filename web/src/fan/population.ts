// A species' population through time, as the fan draws it: how many are alive
// at each moment (N, the column's width) and what share of them have living
// descendants today (q, the green lane's share; the rest, whose line ended, is
// the gray lane).
//
// N(t), individuals alive at age t (the procgen model's own: births per
// generation × mean lifespan ÷ generation length, i.e. births per unit time ×
// lifespan):
//   - a curated history that drives the counts (rec.births): its births curve,
//     the compiled segments, so the recent declines are the real ones; before
//     the history its modelled pre-decline baseline, held back to the species'
//     first appearance (the baseline segment);
//   - otherwise the dataset's constant-size model: the living species held at
//     today's count (the pipeline's N_ever = alive ÷ lifespan × span), an extinct
//     one at ever × lifespan ÷ span (lifespan = half a generation) until its
//     last appearance, then 0.
//   - below its first appearance (down to the fork and through the stem)
//     every species' column, living or extinct, holds its founders: its N at
//     first appearance, constant (its own ancestors). A parent population
//     splits among its daughters in proportion to their founding sizes, so the
//     stem (the clade's ancestors) is the sum of the founders. So an extinct
//     species' column runs from the fork to its extinction like any other.
//
// q(t), alive at t with living descendants today through any mix of mothers and
// fathers. A genealogy of whole generations counted back from now, mixed at
// random (each child has two parents drawn from the generation before):
//   h_0 = 1 (the living), and for the generation before one with h_k of its
//   n_k members carrying the line, each of the n_{k+1} parents is drawn by
//   none of those 2·h_k·n_k parent draws with probability
//   (1 − 1/n_{k+1})^(2 h_k n_k) ≈ exp(−2 h_k n_k / n_{k+1}), so
//       h_{k+1} = 1 − exp(−2 · h_k · n_k / n_{k+1}).
// Limits: a constant size settles to the fixed point of q = 1 − e^(−2q),
// Q_STAR ≈ 0.797 (the identical-ancestors share: the rest left no descendants),
// within a few generations; a bottleneck n_s ≪ n before it leaves only
// ~2·n_s·q of the larger population green (the whole column narrows, the green
// most), recovering over ~log2(n/n_s) generations further back; a decline
// towards now (n_k < n_{k+1}) holds q below Q_STAR, growth above it.
//
// The steps (what the fan draws, fixed in the world, never depending on the view):
// generation k back from now, ages [k·GL, (k+1)·GL), holds n_k = N at its young
// edge (the history's own points at the segment boundaries) and q = h_k; steps
// with the same n and q merge, so a constant stretch is one step. Past the
// last change (the baseline, settled q) one step runs on to the species'
// first appearance and its founders below it. Extinct species: q = 0 from
// their extinction all the way down to the fork (after the split their
// ancestors are theirs alone, and none has living descendants), one step.
// Below the fork, in the stem, the founders' ancestors are everybody's, green
// by the same rule through any living daughter: the living species' own
// settled value, Q_STAR for an extinct one's (qBase, drawn by the layout).

import type { SpeciesRec } from './panthera';

/** The fixed point of q = 1 − e^(−2q): the share of a constant, well-mixed population with descendants far in the future. */
export const Q_STAR = (() => {
  let q = 1;
  for (let k = 0; k < 400; k++) q = 1 - Math.exp(-2 * q);
  return q;
})();

/** One step of the genealogy back a generation: parents' share with living descendants, from the children's share and the sizes. */
export function parentShare(qChild: number, nChild: number, nParent: number): number {
  if (!(qChild > 0) || !(nChild > 0) || !(nParent > 0)) return 0;
  return -Math.expm1((-2 * qChild * nChild) / nParent);
}

/**
 * The share with living descendants, generation by generation back from now
 * (h[0] = 1 at now), for births per generation n(k) of generation k back
 * (k = 0 the newest). Stops once n has been constant past `varGens` and h has
 * settled, or after `maxGens`.
 */
export function shareBack(n: (k: number) => number, varGens: number, maxGens: number): Float64Array {
  const out: number[] = [1];
  let h = 1;
  for (let k = 0; k < maxGens; k++) {
    const h1 = parentShare(h, n(k), n(k + 1));
    out.push(h1);
    const settled = Math.abs(h1 - h) < 1e-13;
    h = h1;
    if (k > varGens + 2 && settled) break;
  }
  return Float64Array.from(out);
}

export class Population {
  /** Individuals alive at the species' first appearance: its column below it, and its share of the stem. */
  readonly founders: number;
  /** The most alive at any moment (the column's room). */
  readonly max: number;
  /** q below the first appearance (and after the genealogy has settled). */
  readonly qBase: number;
  /** Mean lifespan ÷ generation length (alive per birth per generation). */
  private readonly lg: number;
  private readonly nConst: number;
  private readonly h: Float64Array;
  private readonly GL: number;

  constructor(readonly sp: SpeciesRec) {
    const GL = sp.genYears;
    this.GL = GL;
    const years = Math.max(1, (sp.t0 - sp.t1) * 1e6);
    const c = sp.births;
    if (c) {
      this.lg = c.lifespan / GL;
      this.nConst = 0;
      let mx = 0;
      for (const s of c.segments) mx = Math.max(mx, s.startSize, s.endSize);
      this.max = mx * this.lg;
    } else {
      // procgen's constant-size model (twigs.ts speciesModel): N per generation over ~years/GL generations.
      this.lg = sp.alive > 0 ? (sp.alive * years) / sp.ever / GL : 0.5;
      this.nConst = sp.alive > 0 ? sp.alive : (sp.ever * GL * this.lg) / years;
      this.max = this.nConst;
    }
    this.founders = this.aliveAt(sp.t0);
    if (sp.extinct || !(sp.alive > 0)) {
      this.h = new Float64Array([0]);
      this.qBase = Q_STAR;
    } else {
      const ago = (k: number) => k * GL;
      // Generations over which the size changes (the history's recent segments), counted back from now.
      let varGens = 0;
      if (c) {
        const segs = c.segments;
        for (let j = segs.length - 1; j > 0; j--) varGens += segs[j].generations;
      }
      this.h = shareBack((k) => this.aliveAt(ago(k) / 1e6), varGens, Math.min(2e5, Math.ceil(years / GL)));
      this.qBase = this.h[this.h.length - 1];
    }
  }

  /** Individuals alive at age `ageMa` (Ma): 0 after an extinct species' last appearance; its founders before its first (down to the fork and through the stem). */
  aliveAt(ageMa: number): number {
    const sp = this.sp;
    if (ageMa < sp.t1) return 0;
    const a = Math.min(ageMa, sp.t0);
    const c = sp.births;
    if (c) return c.curve.sizeAt(Math.min(a * 1e6, c.curve.years)) * this.lg;
    return this.nConst;
  }

  /**
   * The steps the fan draws: boundaries in years before present (ascending,
   * from the tip; the last step runs on past the last boundary), with the
   * individuals alive (n) and the share with living descendants (q) of each.
   */
  get steps(): { ages: Float64Array; n: Float64Array; q: Float64Array } {
    if (this._steps) return this._steps;
    const sp = this.sp;
    const ages: number[] = [sp.t1 * 1e6];
    const n: number[] = [];
    const q: number[] = [];
    const push = (a1: number, nn: number, qq: number) => {
      const k = n.length - 1;
      if (k >= 0 && Math.abs(n[k] - nn) <= 1e-12 * Math.max(nn, 1) && Math.abs(q[k] - qq) <= 1e-12) {
        ages[k + 1] = a1;
        return;
      }
      n.push(nn);
      q.push(qq);
      ages.push(a1);
    };
    if (sp.extinct || !(sp.alive > 0)) {
      // One step from its extinction down to the fork (its founders below its first appearance): nobody with living descendants.
      push(Infinity, this.aliveAt((sp.t0 + sp.t1) / 2), 0);
    } else {
      const GL = this.GL;
      const span = (sp.t0 - sp.t1) * 1e6;
      const c = sp.births;
      let varGens = 0;
      if (c) for (let j = c.segments.length - 1; j > 0; j--) varGens += c.segments[j].generations;
      const K = Math.min(Math.floor(span / GL), Math.max(varGens, this.h.length - 1));
      for (let k = 0; k < K; k++) push((k + 1) * GL, this.aliveAt((k * GL) / 1e6), this.h[Math.min(k, this.h.length - 1)]);
      // The baseline on to the first appearance (and its founders below, held constant).
      push(Infinity, this.founders, this.qBase);
    }
    return (this._steps = { ages: Float64Array.from(ages), n: Float64Array.from(n), q: Float64Array.from(q) });
  }

  private _steps?: { ages: Float64Array; n: Float64Array; q: Float64Array };

  /** The step drawn at age `ageMa` (Ma): the individuals alive and the green share; 0 outside the column. */
  stepAt(ageMa: number): { n: number; q: number } {
    const sp = this.sp;
    if (ageMa < sp.t1) return { n: 0, q: 0 };
    const { ages, n, q } = this.steps;
    const yrs = ageMa * 1e6;
    let lo = 0;
    let hi = n.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ages[mid + 1] > yrs) hi = mid;
      else lo = mid + 1;
    }
    return { n: n[lo], q: q[lo] };
  }

  /**
   * Share of those alive at `ageMa` with living descendants today (0–1): h_k
   * of its generation, as drawn. An extinct species': 0 over its whole column
   * (down to the fork; the stem below it is the layout's, at qBase).
   */
  greenAt(ageMa: number): number {
    const sp = this.sp;
    if (sp.extinct) return 0;
    if (ageMa >= sp.t0) return this.qBase;
    if (ageMa < sp.t1) return 0;
    return this.stepAt(ageMa).q;
  }
}

const cache = new Map<number, Population>();
/** The population model of a species (cached by gid). */
export function population(sp: SpeciesRec): Population {
  let p = cache.get(sp.gid);
  if (!p || p.sp !== sp) cache.set(sp.gid, (p = new Population(sp)));
  return p;
}
