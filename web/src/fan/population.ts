// A species' population through time, as the fan draws it: how many are alive
// at each moment (N, the column's width) and what share of them have living
// descendants today (q, the green lane's share; the rest, whose line ended, is
// the gray lane).
//
// N(t), individuals alive at age t (the procgen model's own: births per
// generation × mean lifespan ÷ generation length, i.e. births per unit time ×
// lifespan):
//   - a curated history that drives the counts (rec.births): the compiled
//     segments' points, so the recent declines are the real ones; before the
//     history its modelled pre-decline baseline, held back to the species'
//     first appearance (the baseline segment). Between two points N is
//     linear in log time (log10(years + TIME_C), the fan's height): a ramp is
//     a straight slanted edge, never a stair. Where two segments do not meet
//     (a jump in the data), the older one's end is moved a generation back,
//     so the jump is a one-generation ramp;
//   - otherwise the dataset's constant-size model: the living species held at
//     today's count (the pipeline's N_ever = alive ÷ lifespan × span), an extinct
//     one at ever × lifespan ÷ span (lifespan = half a generation) until its
//     last appearance, then 0. Its end tapers: over the last TAPER_FRAC of
//     its start's log depth (at most TAPER_MAX of its own log span), its
//     drawn width falls linearly in log time to 0 at its last appearance (a
//     straight pinch, not a cut): N itself in linear widths; 1 + log10 N in
//     log widths (N = 10^(G − 1), then G below one individual). The model
//     follows the drawing, so width = N holds in the taper too.
//   - below its start (its split from its sister lineage in the dated tree,
//     splits.ts; by default its first appearance) a species holds its
//     founders: its N at its start, constant. A parent population is the sum
//     of its daughters' founders (layout.ts), so the stem (the clade's
//     ancestors) is the sum of everyone's founders. An extinct species holds
//     its constant model from its last appearance back to its start, and the
//     same founders below it.
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
// What the fan draws (greenAt, fixed in the world, never depending on the
// view) is q interpolated, linearly in log time, between the generations'
// midpoints: h_k at the middle of generation k, 1 over the newest half
// generation, qBase past the last; so the green edge ramps too.
//
// The steps (strides of the mesh's slot lattice, twigs.ts):
// generation k back from now, ages [k·GL, (k+1)·GL), holds n_k = N at its young
// edge (the history's own points at the segment boundaries) and q = h_k; steps
// with the same n and q merge, so a constant stretch is one step. Past the
// last change (the baseline, settled q) one step runs on to the species'
// start and its founders below it. Extinct species: q = 0 from the tip back to
// the start. Below its start a species' founders are part of the parent
// population, whose green the layout works out on the summed column (layout.ts
// FanNode); here they keep the species' own settled value (Q_STAR for an
// extinct one's).

import type { SpeciesRec } from './panthera';

/**
 * Time axis offset (years). The fan's height is log10(years before present +
 * C). With C = 10 years the axis resolves the last decades and centuries; it
 * is close to the mean lifespan of the living big cats (alive·span/ever ≈ 3–5
 * years).
 */
export const TIME_C = 10;
/** The fan's log time of an age in years before present: log10(years + TIME_C). Ramps are linear in it. */
export function dex(years: number): number {
  return Math.log10(Math.max(0, years) + TIME_C);
}
/** An extinct species' end tapers over this share of its start's log depth (dex(start) − dex(0)) ... */
export const TAPER_FRAC = 0.05;
/** ... but at most this share of its own log span (start to last appearance). */
export const TAPER_MAX = 0.3;

/** Linear interpolation of v over knots xs (ascending), clamped at the ends; xs in the same units as x. */
function interp(xs: number[] | Float64Array, v: number[] | Float64Array, x: number): number {
  const n = xs.length;
  if (!(x > xs[0])) return v[0];
  if (x >= xs[n - 1]) return v[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return v[lo] + (v[hi] - v[lo]) * t;
}

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
  /** Individuals alive at the species' start (its split): its share of the parent column below it. */
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
  /** The history's points: log times (dex, ascending from now) and N there (alive). */
  private readonly kx: number[] = [];
  private readonly kn: number[] = [];
  /** An extinct species' taper: log times of its last appearance and of the taper's start (dex). */
  private readonly tx0: number = 0;
  private readonly tx1: number = 0;
  /** q's knots: the generations' midpoints (dex, ascending) and h there. */
  private readonly qx: Float64Array;

  /**
   * @param startMa the species' start (Ma): its split in the dated tree, where
   * its own column begins (by default its first appearance).
   */
  constructor(
    readonly sp: SpeciesRec,
    readonly startMa = sp.t0,
    /** The fan's width mode: the shape of an extinct species' taper (straight in the drawn width). */
    readonly taper: 'linear' | 'log' = 'linear',
  ) {
    const GL = sp.genYears;
    this.GL = GL;
    // (The constant model spreads the dataset's estimate over its own span, first to last appearance.)
    const years = Math.max(1, (sp.t0 - sp.t1) * 1e6);
    const c = sp.births;
    if (c) {
      this.lg = c.lifespan / GL;
      this.nConst = 0;
      let mx = 0;
      for (const s of c.segments) mx = Math.max(mx, s.startSize, s.endSize);
      this.max = mx * this.lg;
      // The points, newest first: each segment's young end (endSize) and old end (startSize).
      let x = 0;
      const pts: [number, number][] = [];
      for (let j = c.segments.length - 1; j >= 0; j--) {
        const s = c.segments[j];
        const len = s.generations * GL;
        const last = pts[pts.length - 1];
        if (!last) pts.push([x, s.endSize]);
        else if (last[1] !== s.endSize) pts.push([x + Math.min(GL, len / 2), s.endSize]);
        pts.push([x + len, s.startSize]);
        x += len;
      }
      for (const [yrs, n] of pts) {
        const d = dex(yrs);
        if (this.kx.length && d <= this.kx[this.kx.length - 1]) continue;
        this.kx.push(d);
        this.kn.push(n * this.lg);
      }
    } else {
      // procgen's constant-size model (twigs.ts speciesModel): N per generation over ~years/GL generations.
      this.lg = sp.alive > 0 ? (sp.alive * years) / sp.ever / GL : 0.5;
      this.nConst = sp.alive > 0 ? sp.alive : (sp.ever * GL * this.lg) / years;
      this.max = this.nConst;
      if (sp.extinct || !(sp.alive > 0)) {
        const a = dex(sp.t1 * 1e6);
        const b = dex(startMa * 1e6);
        this.tx0 = a;
        this.tx1 = a + Math.min(TAPER_FRAC * (b - dex(0)), TAPER_MAX * (b - a));
      }
    }
    this.founders = this.aliveAt(startMa);
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
      const own = Math.max(1, (startMa - sp.t1) * 1e6);
      this.h = shareBack((k) => this.aliveAt(ago(k) / 1e6), varGens, Math.min(2e5, Math.ceil(own / GL)));
      this.qBase = this.h[this.h.length - 1];
    }
    // q's knots: 1 over the newest half generation, h_k at the middle of generation k.
    const qx = [dex(0)];
    for (let k = 0; k < this.h.length; k++) qx.push(dex((k + 0.5) * GL));
    this.qx = Float64Array.from(qx);
    this.qv = Float64Array.from([this.h[0], ...this.h]);
  }

  private readonly qv: Float64Array;

  /**
   * Ages (Ma, ascending) where N or q has a knot, from the tip back to the
   * start: between two of them both are linear in log time. Past the last,
   * both are constant.
   */
  get knots(): number[] {
    const sp = this.sp;
    const out = new Set<number>();
    const add = (d: number) => {
      const a = (Math.pow(10, d) - TIME_C) / 1e6;
      if (a > sp.t1 && a < this.startMa) out.add(a);
    };
    for (const d of this.kx) add(d);
    if (this.tx1 > this.tx0) add(this.tx1);
    if (!(sp.extinct || !(sp.alive > 0))) for (const d of this.qx) add(d);
    return [...out].sort((p, q) => p - q);
  }

  /** Individuals alive at age `ageMa` (Ma): 0 after an extinct species' last appearance; its founders before its start. */
  aliveAt(ageMa: number): number {
    const sp = this.sp;
    if (ageMa < sp.t1) return 0;
    const a = Math.min(ageMa, sp.t0, this.startMa);
    if (this.kx.length) return interp(this.kx, this.kn, dex(a * 1e6));
    if (this.tx1 > this.tx0) {
      const d = dex(ageMa * 1e6);
      if (d < this.tx1) {
        const u = Math.max(0, d - this.tx0) / (this.tx1 - this.tx0);
        if (this.taper === 'linear') return this.nConst * u;
        const G = u * (this.nConst < 1 ? this.nConst : 1 + Math.log10(this.nConst));
        return G < 1 ? G : Math.pow(10, G - 1);
      }
    }
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
      // Withered from its tip back to its start; its founders below.
      push(this.startMa * 1e6, this.aliveAt((this.startMa + sp.t1) / 2), 0);
      push(Infinity, this.founders, this.qBase);
    } else {
      const GL = this.GL;
      const span = (this.startMa - sp.t1) * 1e6;
      const c = sp.births;
      let varGens = 0;
      if (c) for (let j = c.segments.length - 1; j > 0; j--) varGens += c.segments[j].generations;
      const K = Math.min(Math.floor(span / GL), Math.max(varGens, this.h.length - 1));
      for (let k = 0; k < K; k++) push((k + 1) * GL, this.aliveAt((k * GL) / 1e6), this.h[Math.min(k, this.h.length - 1)]);
      // The baseline on to the start (and its founders below, held constant).
      push(Infinity, this.founders, this.qBase);
    }
    return (this._steps = { ages: Float64Array.from(ages), n: Float64Array.from(n), q: Float64Array.from(q) });
  }

  private _steps?: { ages: Float64Array; n: Float64Array; q: Float64Array };

  /** The step at age `ageMa` (Ma): the individuals alive and the green share; 0 after the tip. */
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
   * Share of those alive at `ageMa` with living descendants today (0–1), as
   * drawn: h_k at the middle of generation k, linear in log time between.
   */
  greenAt(ageMa: number): number {
    const sp = this.sp;
    if (sp.extinct) return ageMa > this.startMa ? this.qBase : 0;
    if (ageMa >= this.startMa) return this.qBase;
    if (ageMa < sp.t1) return 0;
    return interp(this.qx, this.qv, dex(ageMa * 1e6));
  }
}

const cache = new Map<string, Population>();
/** The population model of a species starting at `startMa` (by default its first appearance; cached by gid, start and taper). */
export function population(sp: SpeciesRec, startMa = sp.t0, taper: 'linear' | 'log' = 'linear'): Population {
  const key = `${sp.gid}:${startMa}:${taper}`;
  let p = cache.get(key);
  if (!p || p.sp !== sp) cache.set(key, (p = new Population(sp, startMa, taper)));
  return p;
}
