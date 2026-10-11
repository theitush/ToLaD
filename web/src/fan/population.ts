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
// Smooth, as the fan draws it (fixed in the world, never depending on the view):
//   - N between the history's points is log-linear in time (log N a straight
//     line in years, as the card's sparkline draws it); each corner (a point
//     where the trend changes, the oldest one where it meets the constant
//     baseline) is filleted: over a window [t_k − H, t_k + H] the slope of
//     log N turns from one trend's to the next by a smootherstep, so log N is
//     the earlier trend plus (m_next − m_prev)·2H·P(u), P(u) = u⁶ − 3u⁵ + 2.5u⁴
//     (P' the smootherstep), u = (t − t_k + H) / 2H. It meets the next trend
//     exactly at the window's end and never overshoots the corner. H is
//     CORNER_HALF decades of the time axis (s = log10(years ago + TIME_C), the
//     fan's height) below the point, at most under half the way to its
//     neighbours. So N(t) is C2 in time; the fan's widths are this N, exactly.
//   - an extinct species tapers smoothly to nobody at its last appearance: its
//     constant N times a smoothstep over the last TAPER_FRAC of its span in s;
//     a domestic stock grows out of nobody at its split, domestication, over
//     the first EMERGE_FRAC (its founders are 0: the tamed few are counted in
//     the wild column below).
//   - q is h_k at the middle of generation k, linear in between (h_0 = 1 for
//     the newest half generation; the settled value past the last).
// Below its start a species' founders are part of the parent population, whose
// green the layout works out on the summed column (layout.ts FanNode); here
// they keep the species' own settled value (Q_STAR for an extinct one's).

import type { SpeciesRec } from './panthera';

/**
 * Time axis offset (years): the fan's height is log10(years before present + TIME_C)
 * (layout.ts TimeScale), and the population's corners are rounded in it.
 */
export const TIME_C = 10;
/** Most of the time axis (decades of years + TIME_C) a population corner is rounded over, either side. */
export const CORNER_HALF = 0.08;
/** An extinct species tapers to nobody over this share of its span (on the time axis) before its last appearance. */
export const TAPER_FRAC = 0.35;
/**
 * A domestic stock (a tamed form, its curated history `component = "domestic"`)
 * grows out of its wild founders: N ramps up from nobody at its split
 * (domestication) over this share of its span on the time axis, as
 * N^e − 1 with e a smootherstep from 0 to 1 (a ramp in log N). Its births model starts at a level already far above any founding
 * group (the pipeline shapes it like human births and has no founding count),
 * so without the ramp the tamed stock would sit in its wild ancestors' column.
 */
export const EMERGE_FRAC = 0.1;

/** The time axis's coordinate of an age in years: log10(years + TIME_C). */
export const axisS = (years: number) => Math.log10(Math.max(0, years) + TIME_C);
/** Smootherstep (C2): 0 below 0, 1 above 1. */
export const smoother = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));
/** Smoothstep (C1). */
export const smooth3 = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

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

/** One history point: age (years before present), ln N, its corner's half-window (years) and the slope of ln N (per year) on to the next older point. */
interface Knot {
  ago: number;
  ln: number;
  H: number;
  m: number;
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
  /** The history's points, newest first (none without a history). */
  private readonly knots: Knot[] = [];
  /** An extinct species' taper: the axis coordinates of its last appearance and of the taper's start. */
  private readonly taper: [number, number] | null = null;
  /** A domestic stock's ramp up from its split: the axis coordinates of the split and of the ramp's end. */
  private readonly emerge: [number, number] | null = null;

  /**
   * @param startMa the species' start (Ma): its split in the dated tree, where
   * its own column begins (by default its first appearance).
   */
  constructor(
    readonly sp: SpeciesRec,
    readonly startMa = sp.t0,
  ) {
    const GL = sp.genYears;
    this.GL = GL;
    // (The constant model spreads the dataset's estimate over its own span, first to last appearance.)
    const years = Math.max(1, (sp.t0 - sp.t1) * 1e6);
    const c = sp.births;
    const end = Math.min(sp.t0, startMa) * 1e6;
    if (c) {
      this.lg = c.lifespan / GL;
      this.nConst = 0;
      // (Where procgen's segments meet at different sizes, the older one's end moves half a generation back: a ramp, not a jump.)
      const pts = c.curve.points();
      for (let k = 1; k < pts.length; k++) {
        if (pts[k].ago > pts[k - 1].ago) continue;
        const next = k + 1 < pts.length ? pts[k + 1].ago : pts[k].ago + 4 * GL;
        pts[k] = { ago: pts[k - 1].ago + Math.min(0.5 * GL, 0.25 * (next - pts[k - 1].ago)), size: pts[k].size };
      }
      for (const p of pts) this.knots.push({ ago: p.ago, ln: Math.log(Math.max(1e-9, p.size * this.lg)), H: 0, m: 0 });
      const K = this.knots;
      for (let k = 0; k + 1 < K.length; k++) K[k].m = (K[k + 1].ln - K[k].ln) / (K[k + 1].ago - K[k].ago);
      // Each corner's window: CORNER_HALF of the axis below it, and under half the way to its neighbours (the species' start beyond the oldest).
      for (let k = 1; k < K.length; k++) {
        const prev = K[k].ago - K[k - 1].ago;
        const next = k + 1 < K.length ? K[k + 1].ago - K[k].ago : end - K[k].ago;
        K[k].H = Math.max(0, Math.min((K[k].ago + TIME_C) * (1 - Math.pow(10, -CORNER_HALF)), 0.45 * prev, 0.45 * next));
      }
    } else {
      // procgen's constant-size model (twigs.ts speciesModel): N per generation over ~years/GL generations.
      this.lg = sp.alive > 0 ? (sp.alive * years) / sp.ever / GL : 0.5;
      this.nConst = sp.alive > 0 ? sp.alive : (sp.ever * GL * this.lg) / years;
    }
    if (sp.extinct || !(sp.alive > 0)) {
      const s1 = axisS(sp.t1 * 1e6);
      this.taper = [s1, s1 + TAPER_FRAC * Math.max(0, axisS(end) - s1)];
    }
    if (c && sp.history?.component === 'domestic' && !sp.extinct) {
      const s0 = axisS(end);
      this.emerge = [s0, s0 - EMERGE_FRAC * Math.max(0, s0 - axisS(sp.t1 * 1e6))];
    }
    // The room: the most alive (a fillet never rises above its corner).
    let mx = this.nConst;
    for (const p of this.knots) mx = Math.max(mx, Math.exp(p.ln));
    this.max = mx;
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
  }

  /** ln N of the history at `yrs` years ago, its corners filleted (see the header). */
  private lnHistory(yrs: number): number {
    const K = this.knots;
    // The trend holding it (knots newest first; the last runs on as the baseline).
    let j = 0;
    while (j + 1 < K.length && K[j + 1].ago <= yrs) j++;
    for (const k of [j, j + 1]) {
      if (k < 1 || k >= K.length) continue;
      const c = K[k];
      if (!(c.H > 0) || Math.abs(yrs - c.ago) >= c.H) continue;
      const u = (yrs - c.ago + c.H) / (2 * c.H);
      const P = u * u * u * u * (u * (u - 3) + 2.5);
      const mPrev = K[k - 1].m;
      const mNext = k + 1 < K.length ? c.m : 0;
      return c.ln + mPrev * (yrs - c.ago) + (mNext - mPrev) * 2 * c.H * P;
    }
    return K[j].ln + (j + 1 < K.length ? K[j].m * (yrs - K[j].ago) : 0);
  }

  /**
   * Individuals alive at age `ageMa` (Ma): 0 after an extinct species' last
   * appearance, tapering smoothly to it; its founders before its start.
   * Smooth in time (see the header): the fan's width is exactly this.
   */
  /**
   * A domestic stock's ramp up from nobody: the ages (Ma) of its split and of
   * the ramp's end, or null. (The layout's fork must open no slower than it
   * grows, or the stock would spill into its wild sibling's column.)
   */
  emergeAges(): [number, number] | null {
    if (!this.emerge) return null;
    const ma = (s: number) => Math.max(0, Math.pow(10, s) - TIME_C) * 1e-6;
    return [ma(this.emerge[0]), ma(this.emerge[1])];
  }

  aliveAt(ageMa: number): number {
    const sp = this.sp;
    if (ageMa < sp.t1) return 0;
    const a = Math.min(ageMa, sp.t0, this.startMa);
    let n = this.knots.length ? Math.exp(this.lnHistory(a * 1e6)) : this.nConst;
    if (this.taper) {
      const [s1, s2] = this.taper;
      if (s2 > s1) n *= smooth3((axisS(a * 1e6) - s1) / (s2 - s1));
    }
    if (this.emerge) {
      const [s0, s1] = this.emerge;
      // (In log N: N^e − 1, e a smootherstep, so the log widths too leave nobody at the split with zero slope.)
      n = s0 > s1 && n > 1 ? Math.pow(n, smoother((s0 - axisS(a * 1e6)) / (s0 - s1))) - 1 : 0;
    }
    return n;
  }

  /** The individuals alive and the green share at age `ageMa` (Ma): aliveAt and greenAt; 0 after the tip. */
  stepAt(ageMa: number): { n: number; q: number } {
    if (ageMa < this.sp.t1) return { n: 0, q: 0 };
    return { n: this.aliveAt(ageMa), q: this.greenAt(ageMa) };
  }

  /** Share of those alive at `ageMa` with living descendants today (0–1): h_k at the middle of generation k, linear in between. */
  greenAt(ageMa: number): number {
    const sp = this.sp;
    if (sp.extinct) return ageMa > this.startMa ? this.qBase : 0;
    if (ageMa >= this.startMa) return this.qBase;
    if (ageMa < sp.t1) return 0;
    const x = (ageMa * 1e6) / this.GL - 0.5;
    const h = this.h;
    if (x <= 0) return h[0];
    const k = Math.floor(x);
    if (k + 1 >= h.length) return this.qBase;
    return h[k] + (h[k + 1] - h[k]) * (x - k);
  }

  /**
   * Where the population's shape changes, as ages (years before present,
   * ascending) for the fan's tessellation (layout.ts): its history's points
   * and corner windows, samples along its log-linear stretches, the
   * generations where its green share still moves, and its taper.
   */
  features(): number[] {
    const out: number[] = [];
    const yrs = (s: number) => Math.pow(10, s) - TIME_C;
    const K = this.knots;
    for (let k = 0; k < K.length; k++) {
      const c = K[k];
      out.push(c.ago);
      if (c.H > 0) for (let i = -16; i <= 16; i++) out.push(c.ago + (c.H * i) / 16);
      if (k + 1 < K.length) {
        // Along the stretch to the next point: ~every 0.005 of the axis.
        const s0 = axisS(c.ago);
        const s1 = axisS(K[k + 1].ago);
        const n = Math.min(400, Math.ceil((s1 - s0) / 0.005));
        for (let i = 1; i < n; i++) out.push(yrs(s0 + ((s1 - s0) * i) / n));
      }
    }
    if (this.taper) {
      const [s1, s2] = this.taper;
      for (let i = 0; i <= 48; i++) out.push(yrs(s1 + ((s2 - s1) * i) / 48));
    }
    if (this.emerge) {
      const [s0, s1] = this.emerge;
      for (let i = 0; i <= 48; i++) out.push(yrs(s1 + ((s0 - s1) * i) / 48));
    }
    // The green share: every generation middle while it moves (its kinks).
    const h = this.h;
    let last = h.length - 1;
    while (last > 0 && Math.abs(h[last] - h[last - 1]) < 1e-5) last--;
    const stride = Math.max(1, Math.ceil(last / 20000));
    for (let k = 0; k <= last + 1; k += stride) out.push((k + 0.5) * this.GL);
    const lo = this.sp.t1 * 1e6;
    const hi = Math.min(this.sp.t0, this.startMa) * 1e6;
    return out.filter((a) => a >= lo && a <= hi).sort((p, q) => p - q);
  }
}

const cache = new Map<string, Population>();
/** The population model of a species starting at `startMa` (by default its first appearance; cached by gid and start). */
export function population(sp: SpeciesRec, startMa = sp.t0): Population {
  const key = `${sp.gid}:${startMa}`;
  let p = cache.get(key);
  if (!p || p.sp !== sp) cache.set(key, (p = new Population(sp, startMa)));
  return p;
}
