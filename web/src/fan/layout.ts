// The Panthera fan as a rectangular tree (a classic cladogram), fixed in world
// units (y grows downwards, like the screen). Nothing here depends on the
// camera except which step grid the gray edge is drawn on (Steps, below):
// panning never changes a shape, and zooming only refines the steps.
//
//   - Each species is one straight vertical column (colLeft) from the bottom
//     of the world up to its tip: "now" for the living, its last appearance
//     if extinct. Below the fork (y = 0, the clade's origin) the columns keep
//     their width at the fork and go on straight down, through the clade's
//     ancestors, to the bottom of the world (STEM_BOTTOM_MA): the stem is as
//     wide as the stalks it carries (its gaps filled), so nothing jogs or
//     ends at the origin, and every green lane runs straight down to the root.
//     Columns sit side by side in tree order with a fixed gap between
//     neighbours (gapBetween): GAP_FRAC of the smaller one's base width, at
//     least MIN_GAP_FRAC of the stem's. Positions never change with time or view.
//
// Inside a column the green (alive) lane is a straight band on its left edge,
// constant width; the gray (dead) lane lies to its right and narrows as the
// dead peel off. Its right edge is the only edge that is not one straight line:
// a step function of height (Steps), all vertical and horizontal segments.
//
// Height = time: the fork is the clade's origin, "now" is y = −TIME_H, on a
// log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals: at height y a branch holds everyone whose strand passes
// through it (everyone not yet dead by then, remaining()), times one fixed
// world width per individual (linear) or per decade of individuals (log, g()).
// The steps hold that width averaged over each step's height, so a step's
// width is the individuals at some height inside it (exact there) and the
// area under the edge is preserved step by step.

import type { CladeRec, SpeciesRec } from './panthera';

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 110;
/** The bottom of the world: the stem (the clade's ancestors) runs down to here (Ma, ~first life). */
export const STEM_BOTTOM_MA = 4000;
/** The stem fades out from here down to the bottom (Ma). */
export const STEM_FADE_MA = 300;
/** Height = time: the fork (the clade's origin) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Kept for callers: the columns no longer jog at the fork (height 0 would divide by zero). */
export const JOG = 1;
/** Gap between neighbouring columns: this share of the smaller one's base width ... */
export const GAP_FRAC = 0.2;
/** ... but at least this share of the stem's width. */
export const MIN_GAP_FRAC = 0.025;
/**
 * Steps of the gray edge: a step grid of level k cuts the time axis into 2^k
 * equal heights (equal log-time bands; the grids nest). The level shown is
 * the one whose steps are STEP_PX..2·STEP_PX tall on screen; over the top
 * STEP_BLEND of that octave the steps morph into the next grid's (each step
 * slides to its two halves' widths), so zooming never pops.
 */
export const STEP_PX = 22;
export const STEP_BLEND = 0.4;
export const MAX_STEP_LEVEL = 36;
/**
 * Time axis offset (years). Height is log10(years before present + C). With
 * C = 10 years the axis resolves the last decades and centuries; it is close
 * to the mean lifespan of the living big cats (alive·span/ever ≈ 3–5 years).
 */
export const TIME_C = 10;

/** Time scale for a clade of age `originMa`: years before present ↔ height fraction (0 = origin, 1 = now). */
export class TimeScale {
  private readonly top: number;
  private readonly span: number;
  constructor(readonly originMa: number) {
    this.top = Math.log10(originMa * 1e6 + TIME_C);
    this.span = this.top - Math.log10(TIME_C);
  }
  /** Height fraction of an age given in Ma. */
  frac(ageMa: number): number {
    return (this.top - Math.log10(Math.max(0, ageMa) * 1e6 + TIME_C)) / this.span;
  }
  /** World y of an age in Ma. */
  y(ageMa: number): number {
    return -TIME_H * this.frac(ageMa);
  }
  /** Years per world unit of height at world y (the axis's local rate). */
  yearsPerUnit(y: number): number {
    return ((Math.LN10 * this.span) / TIME_H) * (this.ageAt(y) * 1e6 + TIME_C);
  }
  /** Age in Ma at world y. */
  ageAt(y: number): number {
    const f = -y / TIME_H;
    return Math.max(0, (Math.pow(10, this.top - f * this.span) - TIME_C) / 1e6);
  }
}

export interface Pt {
  x: number;
  y: number;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index among its siblings (tree order, left to right). */
  index: number;
  /** Width share among siblings and absolute width at the base (= individuals ever). */
  share: number;
  width: number;
  /** Alive lane fraction at the base (0 if extinct). */
  aliveFrac: number;
  /** Left edge below the fork: its column, which goes straight on down (= colLeft). */
  baseLeft: number;
  /** Left edge of its column, from the bottom of the world to its tip. */
  colLeft: number;
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's step grids, which draw its gray edge. */
  steps: Steps;
}

export interface Fan {
  clade: CladeRec;
  mode: WidthMode;
  trunkWidth: number;
  trunkBottom: Pt;
  branches: FanBranch[];
  time: TimeScale;
  steps: Steps;
  /** World x extent of the columns. */
  x0: number;
  x1: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Adaptive Simpson's rule for ∫ f over [a, b] to about `tol`. */
function integrate(f: (x: number) => number, a: number, b: number, tol: number): number {
  const simpson = (fa: number, fm: number, fb: number, h: number) => (h / 6) * (fa + 4 * fm + fb);
  const rec = (a: number, b: number, fa: number, fm: number, fb: number, whole: number, tol: number, depth: number): number => {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(fa, flm, fm, m - a);
    const right = simpson(fm, frm, fb, b - m);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(a, m, fa, flm, fm, left, tol / 2, depth - 1) + rec(m, b, fm, frm, fb, right, tol / 2, depth - 1);
  };
  // Start from 8 panels so a narrow feature isn't missed.
  let s = 0;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x0 = a + ((b - a) * i) / n;
    const x1 = a + ((b - a) * (i + 1)) / n;
    const f0 = f(x0);
    const f1 = f(x1);
    const fm = f((x0 + x1) / 2);
    s += rec(x0, x1, f0, fm, f1, simpson(f0, fm, f1, x1 - x0), tol / n, 14);
  }
  return s;
}

/**
 * The gray edge's step grids. Level k: steps of height TIME_H / 2^k from the
 * fork (y = 0) up to "now" (y = −TIME_H), so every grid's lines are lines of
 * the finer ones. A step's width is the branch's exact width averaged over the
 * step's height (clipped to the branch's span), cached forever: steps are
 * world-fixed. setScale picks the level for the time zoom on screen.
 */
export class Steps {
  /** Level shown and how far it has morphed into level k + 1 (0–1). */
  k = 0;
  t = 0;
  private readonly cache = new Map<FanBranch, Map<number, number>>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
  ) {}

  /** Pick the level for time zoom sy (px per world unit). */
  setScale(sy: number): void {
    const kf = Math.log2((TIME_H * sy) / STEP_PX);
    if (!Number.isFinite(kf) || kf <= 0) {
      this.k = 0;
      this.t = 0;
      return;
    }
    const k = Math.min(MAX_STEP_LEVEL, Math.floor(kf));
    this.k = k;
    this.t = k >= MAX_STEP_LEVEL ? 0 : smooth((kf - k - (1 - STEP_BLEND)) / STEP_BLEND);
  }

  /** Step height (world) of level k. */
  static dy(k: number): number {
    return TIME_H / Math.pow(2, k);
  }

  /** The finest level drawn right now (k, or k + 1 while morphing). */
  get level(): number {
    return this.t > 0 ? this.k + 1 : this.k;
  }

  /** Mean exact width of branch b over step i of level k (0 if the branch isn't there). */
  mean(b: FanBranch, k: number, i: number): number {
    let m = this.cache.get(b);
    if (!m) this.cache.set(b, (m = new Map()));
    const key = k * 2 ** 40 + i; // i < 2^k ≤ 2^36
    const hit = m.get(key);
    if (hit !== undefined) return hit;
    const d = Steps.dy(k);
    const yLo = -i * d; // bottom of the step
    const yHi = Math.max(b.tipY, -(i + 1) * d); // top, clipped to the tip
    let v = 0;
    if (yHi < yLo) {
      // Adaptive Simpson, split at the species' first appearance (where the width has a kink).
      const f = (y: number) => strandAt(b, this.time.ageAt(y), this.mode).w;
      const cuts = [yHi, yLo];
      const y0 = this.time.y(b.sp.t0);
      if (y0 > yHi && y0 < yLo) cuts.splice(1, 0, y0);
      let s = 0;
      for (let c = 0; c + 1 < cuts.length; c++) s += integrate(f, cuts[c], cuts[c + 1], b.width * (yLo - yHi) * 1e-7);
      v = s / (yLo - yHi);
    }
    if (m.size > 50000) m.clear();
    m.set(key, v);
    return v;
  }

  /** Index of the level-k step holding world y (−TIME_H ≤ y < 0). */
  static index(k: number, y: number): number {
    return Math.max(0, Math.min(2 ** k - 1, Math.floor(-y / Steps.dy(k))));
  }

  /** Stepped width of branch b at world y, at the current level (blended while morphing). */
  widthAt(b: FanBranch, y: number): number {
    if (y >= 0) return b.width;
    if (y < b.tipY) return 0;
    const a = this.mean(b, this.k, Steps.index(this.k, y));
    if (this.t <= 0) return a;
    const k1 = this.k + 1;
    return a + (this.mean(b, k1, Steps.index(k1, y)) - a) * this.t;
  }

  /**
   * World heights of the step lines drawn now, from y0 down to y1 (y0 < y1),
   * within the branch's span; at most `max` of them (null if there are more).
   */
  lines(b: FanBranch, y0: number, y1: number, max = 4000): number[] | null {
    const k = this.level;
    const d = Steps.dy(k);
    const lo = Math.max(y0, b.tipY);
    const hi = Math.min(y1, 0);
    const out: number[] = [];
    if (hi <= lo) return out;
    const i0 = Math.ceil(-hi / d);
    const i1 = Math.floor(-lo / d);
    if (i1 - i0 + 1 > max) return null;
    for (let i = i1; i >= i0; i--) {
      const y = -i * d;
      if (y > lo && y < hi) out.push(y);
    }
    return out;
  }
}

/** Left edge of a branch at world y: one straight column from the bottom of the world to the tip. */
export function leftAt(b: FanBranch, _y?: number): number {
  return b.colLeft;
}

/**
 * A branch's lanes at world y, as drawn: total width w (stepped), the green
 * lane's width gw (constant from the root to the tip) and its fraction f.
 */
export function laneAt(b: FanBranch, y: number): { w: number; gw: number; f: number } {
  const w = b.steps.widthAt(b, y);
  const green = b.sp.alive > 0 ? b.width * b.aliveFrac : 0;
  const gw = Math.min(w, green);
  return { w, gw, f: w > 0 ? gw / w : 0 };
}

/** Gap (world) between neighbouring columns a and b. */
export function gapBetween(a: FanBranch, b: FanBranch, stem: number): number {
  return Math.max(GAP_FRAC * Math.min(a.width, b.width), MIN_GAP_FRAC * stem);
}

export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : 1 + Math.max(0, Math.log10(n));
}

/**
 * Alive lane fraction at the base (everyone ever present): g(alive) / g(ever).
 * The living are present from the base to the tip, so their lane keeps this
 * absolute width all the way up; only the gray (the dead) peels off.
 */
export function aliveFrac(alive: number, ever: number, mode: WidthMode): number {
  if (!(alive > 0) || !(ever > 0)) return 0;
  return Math.min(1, g(alive, mode) / g(ever, mode));
}
/**
 * Individuals whose strands pass through age `ageMa` (not dead by then):
 * everyone ever before the species' first appearance, the living at the tip.
 * With a curated history that drives the counts, the dead peel off along its
 * real births curve (the share of all births after `ageMa`, procgen's own
 * ramps integrated); otherwise births are spread evenly over the species' span
 * (procgen's constant-size model). Either way the base is ever, the tip alive.
 */
export function remaining(sp: SpeciesRec, ageMa: number): number {
  if (ageMa >= sp.t0) return sp.ever;
  if (ageMa <= sp.t1) return sp.alive;
  const c = sp.births?.curve;
  const r = c ? Math.min(1, c.bornAfter((ageMa - sp.t1) * 1e6) / c.total) : (ageMa - sp.t1) / (sp.t0 - sp.t1);
  return sp.alive + (sp.ever - sp.alive) * r;
}

/**
 * Exact (unstepped) strand width and green fraction of a branch at age
 * `ageMa`. The green lane has the same absolute width along the whole strand
 * (width · g(alive)/g(ever), in both modes): the gray around it thins as the
 * dead peel off, so at the tip (only the living remain) the strand is all green.
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const sp = b.sp;
  const rem = remaining(sp, ageMa);
  const gEver = g(sp.ever, mode);
  const w = rem > 0 ? (b.width * g(rem, mode)) / gEver : 0;
  const green = sp.alive > 0 ? (b.width * g(sp.alive, mode)) / gEver : 0;
  return { w, f: w > 0 ? Math.min(1, green / w) : 0 };
}

export function layoutFan(clade: CladeRec, mode: WidthMode): Fan {
  const sp = clade.species;
  const gs = sp.map((s) => g(s.ever, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const W = TRUNK_WIDTH;
  const time = new TimeScale(clade.t0);
  const steps = new Steps(time, mode);
  let x = -W / 2;
  const branches: FanBranch[] = sp.map((s, i) => {
    const share = gs[i] / sum;
    const width = share * W;
    const baseLeft = x;
    x += width;
    return {
      sp: s,
      index: i,
      share,
      width,
      aliveFrac: aliveFrac(s.alive, s.ever, mode),
      baseLeft,
      colLeft: 0,
      tipY: time.y(s.t1),
      steps,
    };
  });
  // Columns side by side with their gaps, centred on the stem.
  let total = 0;
  for (let j = 0; j < branches.length; j++) total += branches[j].width + (j ? gapBetween(branches[j - 1], branches[j], W) : 0);
  let cx = -total / 2;
  for (let j = 0; j < branches.length; j++) {
    if (j) cx += gapBetween(branches[j - 1], branches[j], W);
    branches[j].colLeft = cx;
    branches[j].baseLeft = cx;
    cx += branches[j].width;
  }
  return {
    clade,
    mode,
    trunkWidth: W,
    trunkBottom: { x: 0, y: time.y(STEM_BOTTOM_MA) },
    branches,
    time,
    steps,
    x0: -total / 2,
    x1: total / 2,
  };
}
