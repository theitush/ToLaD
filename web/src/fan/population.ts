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

/** The settled share for a steady ratio r = n_child / n_parent per generation: the root of q = 1 − e^(−2qr) (0 when 2r ≤ 1). */
export function settledShare(r: number): number {
  if (!(2 * r > 1)) return 0;
  // f(q) = q − 1 + e^(−2qr) is convex with f(0) = 0: Newton from q = 1 falls monotonically onto the other root.
  let q = 1;
  for (let i = 0; i < 60; i++) {
    const e = Math.exp(-2 * q * r);
    const dq = (q - 1 + e) / (1 - 2 * r * e);
    q -= dq;
    if (Math.abs(dq) < 1e-15) break;
  }
  return q;
}

/** Most samples one species' genealogy keeps (it needs a few hundred; the cap only guards the worst case). */
export const MAX_SHARE_SAMPLES = 4000;
/** A jump over settled generations is taken when the settled share moves less than this over it ... */
const JUMP_TOL = 2e-5;
/** ... and is linear across it within this (the share is interpolated linearly between samples). */
const JUMP_LIN = 2e-7;
/** The longest jump, in decades of the time axis (log10 of years + TIME_C). */
const JUMP_AXIS = 0.01;

/**
 * The share with living descendants back from now, sampled: generation k
 * (counted back, k = 0 the newest, h = 1) at the generations `k` with shares
 * `h`, linear in between. Exactly the per-generation genealogy (shareBack)
 * while the share still moves from one generation to the next; once it has
 * settled onto the steady share of the local size ratio (a slow log-linear
 * change, a long fillet, a held stretch), it follows that steady share in
 * jumps that double while the share stays within JUMP_TOL and linear across
 * them (and never over JUMP_AXIS of the time axis), so a deep past of 10⁵–10⁶ generations is a few hundred samples, not
 * one per generation. Stops at `maxGens`, or once the size is constant past
 * `varGens` and the share has settled (the held stretch before the history).
 */
export function shareBackSampled(n: (k: number) => number, varGens: number, maxGens: number, genYears = 1): { k: Float64Array; h: Float64Array } {
  const ks: number[] = [0];
  const hs: number[] = [1];
  const r = (k: number) => {
    const a = n(k - 1);
    const b = n(k);
    return a > 0 && b > 0 ? a / b : 0;
  };
  let h = 1;
  let k = 0;
  let J = 2;
  while (k < maxGens && ks.length < MAX_SHARE_SAMPLES) {
    const settled = k > 0 && Math.abs(h - settledShare(r(k))) < 1e-10;
    if (settled && k > varGens + 2 && r(k) === 1) {
      // Constant from here to the start: the share holds.
      break;
    }
    let jumped = false;
    if (settled) {
      // (At most JUMP_AXIS of the time axis at a time, so a turn of the size, a fillet, is never jumped over.)
      const far = Math.floor(((k * genYears + TIME_C) * (Math.pow(10, JUMP_AXIS) - 1)) / genYears);
      for (let j = Math.min(J, far, maxGens - k); j >= 2; j >>= 1) {
        const qEnd = settledShare(r(k + j));
        if (Math.abs(qEnd - h) > JUMP_TOL) continue;
        const qMid = settledShare(r(k + (j >> 1)));
        if (Math.abs(qMid - (h + qEnd) / 2) > JUMP_LIN) continue;
        k += j;
        h = qEnd;
        J = Math.min(j * 2, 1 << 30);
        jumped = true;
        break;
      }
    }
    if (!jumped) {
      // One generation exactly (the share still moves, or the size turns too fast to jump).
      h = parentShare(h, n(k), n(k + 1));
      k += 1;
      J = 2;
    }
    ks.push(k);
    hs.push(h);
  }
  return { k: Float64Array.from(ks), h: Float64Array.from(hs) };
}

/** One history point: age (years before present), ln N, its corner's half-window (years) and the slope of ln N (per year) on to the next older point. */
interface Knot {
  ago: number;
  ln: number;
  H: number;
  m: number;
}

/** Slopes and corner windows of a history's knots (newest first): CORNER_HALF of the axis below each corner, and under half the way to its neighbours (`end`, years ago, the species' start, beyond the oldest). */
function fillet(K: Knot[], end: number): void {
  for (let k = 0; k + 1 < K.length; k++) K[k].m = (K[k + 1].ln - K[k].ln) / (K[k + 1].ago - K[k].ago);
  for (let k = 1; k < K.length; k++) {
    const prev = K[k].ago - K[k - 1].ago;
    const next = k + 1 < K.length ? K[k + 1].ago - K[k].ago : end - K[k].ago;
    K[k].H = Math.max(0, Math.min((K[k].ago + TIME_C) * (1 - Math.pow(10, -CORNER_HALF)), 0.45 * prev, 0.45 * next));
  }
}

/**
 * A species' census before its history's points (years before present, individuals alive), cited: what its
 * width follows back to its start (held at the oldest). ToLaD#289: humans were not 8 billion 300,000 years ago.
 */
export const DEEP_PAST: Record<string, { ya: number; n: number; lo: number; hi: number; cite: string; url: string; note: string }[]> = {
  'Homo sapiens': [
    {
      ya: 21_000,
      n: 2.5e6,
      lo: 2.12e6,
      hi: 2.95e6,
      cite: 'Gautney & Holliday 2015, J. Archaeol. Sci. 58:103-112',
      url: 'https://doi.org/10.1016/j.jas.2015.03.008',
      note: 'Last Glacial Maximum, Africa and Eurasia: 2.12-2.95 million from carnivore-based densities (3.0-8.3 million from hunter-gatherer densities).',
    },
    {
      ya: 130_000,
      n: 2e5,
      lo: 1e5,
      hi: 3e5,
      cite: 'Sjödin, Sjöstrand, Jakobsson & Blum 2012, Mol. Biol. Evol. 29:1851-1860',
      url: 'https://doi.org/10.1093/molbev/mss061',
      note: 'Penultimate glacial: effective size 10,000-30,000, census of early Homo sapiens roughly 100,000-300,000; held back to the species\' start.',
    },
  ],
};

/** Whether a species' width follows its display-only history: a history of the whole species (component "total", humans) that does not drive the counts. */
export function shapes(sp: SpeciesRec): boolean {
  const h = sp.history;
  return !!h && !sp.births && !sp.extinct && h.use === 'display' && h.component === 'total' && h.points.length > 0;
}

/** The points a shaping history's width runs through, newest first (years ago, alive): today's count, its points, its deep past. */
export function shapePoints(sp: SpeciesRec): { ago: number; n: number }[] {
  const h = sp.history!;
  const out: { ago: number; n: number }[] = [];
  const pts = h.points.map((p) => ({ ago: Math.max(0, h.nowYear - p.year), n: p.n })).sort((a, b) => a.ago - b.ago);
  if (sp.alive > 0 && !(pts[0].ago <= 0)) out.push({ ago: 0, n: sp.alive });
  for (const p of pts) if (!out.length || p.ago > out[out.length - 1].ago) out.push(p);
  for (const d of DEEP_PAST[sp.sci] ?? []) if (d.ya > out[out.length - 1].ago) out.push({ ago: d.ya, n: d.n });
  return out;
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
  /** The genealogy's samples: generations back (k, ascending from 0) and the share h there (shareBackSampled). */
  private readonly hk: Float64Array;
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
   * @param weight what one individual weighs in the widths (ToLaD#276): 1 counts individuals, the adult body mass
   * (kg) weighs them. founders, max and aliveAt are scaled by it; the genealogy (the green share) stays the
   * individuals' own (it is the one of weight 1, shared).
   */
  constructor(
    readonly sp: SpeciesRec,
    readonly startMa = sp.t0,
    readonly weight = 1,
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
      fillet(this.knots, end);
    } else if (shapes(sp)) {
      // The whole species' history, shown only (humans: the counts stay PRB's), shapes the width: its points
      // and, before them, the cited deep past (DEEP_PAST); today's count at now. Births stay the constant model's.
      this.lg = sp.alive > 0 ? (sp.alive * years) / sp.ever / GL : 0.5;
      this.nConst = 0;
      for (const p of shapePoints(sp)) this.knots.push({ ago: p.ago, ln: Math.log(Math.max(1e-9, p.n)), H: 0, m: 0 });
      fillet(this.knots, end);
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
    // The room: the most alive over its own span (a fillet never rises above its corner; log-linear
    // between points, so the most is at a point inside the span or at its ends).
    let mx = this.nConst;
    if (this.knots.length) {
      const lo = sp.t1 * 1e6;
      for (const p of this.knots) if (p.ago >= lo && p.ago <= end) mx = Math.max(mx, Math.exp(p.ln));
      mx = Math.max(mx, Math.exp(this.lnHistory(end)), Math.exp(this.lnHistory(lo)));
    }
    this.max = mx * weight;
    this.founders = this.aliveAt(startMa);
    if (weight !== 1) {
      const base = population(sp, startMa);
      this.hk = base.hk;
      this.h = base.h;
      this.qBase = base.qBase;
    } else if (sp.extinct || !(sp.alive > 0)) {
      this.hk = new Float64Array([0]);
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
      // (A shaping history's size changes back to its oldest point.)
      else if (this.knots.length) varGens = Math.ceil(this.knots[this.knots.length - 1].ago / GL);
      const own = Math.max(1, (startMa - sp.t1) * 1e6);
      // Sampled (bounded: per generation only where the share moves, ToLaD#70), back to the species' start.
      const g = shareBackSampled((k) => this.count(ago(k) / 1e6), varGens, Math.ceil(own / GL), GL);
      this.hk = g.k;
      this.h = g.h;
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
    return this.count(ageMa) * this.weight;
  }

  /** The individuals alive at `ageMa` (aliveAt with weight 1). */
  private count(ageMa: number): number {
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

  /** The genealogy's samples (how many steps of the green share the fan keeps for this species). */
  get shareSamples(): number {
    return this.h.length;
  }

  /** Share of those alive at `ageMa` with living descendants today (0–1): h_k at the middle of generation k, linear in between (and between samples). */
  greenAt(ageMa: number): number {
    const sp = this.sp;
    if (sp.extinct) return ageMa > this.startMa ? this.qBase : 0;
    if (ageMa >= this.startMa) return this.qBase;
    if (ageMa < sp.t1) return 0;
    const x = (ageMa * 1e6) / this.GL - 0.5;
    const h = this.h;
    const K = this.hk;
    if (x <= 0) return h[0];
    if (x >= K[K.length - 1]) return this.qBase;
    // The sample at or below x (per generation near now: start from its floor).
    let a = Math.min(Math.floor(x), K.length - 1);
    if (K[a] > x) {
      let z = a;
      a = 0;
      while (z - a > 1) {
        const m = (a + z) >> 1;
        if (K[m] <= x) a = m;
        else z = m;
      }
    }
    return h[a] + ((h[a + 1] - h[a]) * (x - K[a])) / (K[a + 1] - K[a]);
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
      // (A corner where the slope hardly turns, as between the sub-spans of one log-linear stretch, needs no fillet samples.)
      const turn = k > 0 && k + 1 < K.length ? Math.abs(c.m - K[k - 1].m) : k > 0 ? Math.abs(K[k - 1].m) : 0;
      if (c.H > 0 && turn * c.H > 1e-4) for (let i = -16; i <= 16; i++) out.push(c.ago + (c.H * i) / 16);
      if (k + 1 < K.length && Math.abs(c.m * (K[k + 1].ago - c.ago)) > 1e-6) {
        // Along the stretch to the next point (a held one is flat): ~every 0.005 of the axis.
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
    // The green share: its samples (every generation middle while it moves; bounded, see shareBackSampled).
    const h = this.h;
    let last = h.length - 1;
    while (last > 0 && Math.abs(h[last] - h[last - 1]) < 1e-5) last--;
    for (let k = 0; k <= Math.min(last + 1, h.length - 1); k++) out.push((this.hk[k] + 0.5) * this.GL);
    const lo = this.sp.t1 * 1e6;
    const hi = Math.min(this.sp.t0, this.startMa) * 1e6;
    return out.filter((a) => a >= lo && a <= hi).sort((p, q) => p - q);
  }
}

const cache = new Map<string, Population>();
/** The population model of a species starting at `startMa` (by default its first appearance; cached by gid and start). */
export function population(sp: SpeciesRec, startMa = sp.t0, weight = 1): Population {
  const key = weight === 1 ? `${sp.gid}:${startMa}` : `${sp.gid}:${startMa}:${weight}`;
  let p = cache.get(key);
  if (!p || p.sp !== sp) cache.set(key, (p = new Population(sp, startMa, weight)));
  return p;
}
