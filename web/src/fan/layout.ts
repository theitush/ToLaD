// The Panthera fan as a rectangular tree (a classic cladogram), fixed in world
// units (y grows downwards, like the screen). Nothing here depends on the
// camera: panning or zooming never changes a shape or a width.
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
// Inside a column, at every height, the lanes split the individuals alive
// then (population.ts): the green lane on its left edge holds those with living
// descendants today, the gray lane to its right those whose line ended (warm
// gray for an extinct species, all of it). Both edges are step functions of
// height (Steps), all vertical and horizontal segments.
//
// Height = time: the fork is the clade's origin, "now" is y = −TIME_H, on a
// log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals alive at that time (∝ births per unit time): N(t) times
// one fixed world width per individual (linear) or per decade of individuals
// (log, g()). A column's room is its widest N. Below a living species' first
// appearance its column holds its founders (constant) down to the fork, living
// or extinct (an extinct one's all gray: after the split its ancestors have no
// living descendants). Through the stem, the clade's ancestors, every column
// goes on at its founders' width (the stem is the sum of the founders). The
// steps are the population's own (population.ts: a generation each where N or
// q changes), fixed in the world: a drop in N shows as a step at every zoom.

import type { CladeRec, SpeciesRec } from './panthera';
import { population, type Population } from './population';

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
  /** Width share among siblings and the column's room (world): its widest, at the most alive. */
  share: number;
  width: number;
  /** World width per individual (linear) or per decade of individuals (log). */
  unit: number;
  /** The species' population through time (alive, and the share with living descendants). */
  pop: Population;
  /** Width and green share below its first appearance (its founders), down the stem. */
  baseW: number;
  baseQ: number;
  /** Left edge below the fork: its column, which goes straight on down (= colLeft). */
  baseLeft: number;
  /** Left edge of its column, from the bottom of the world to its tip. */
  colLeft: number;
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's step grids, which draw its edges. */
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

/**
 * The edges' steps, fixed in the world and never depending on the camera: each
 * branch's population steps (population.ts Population.steps: a generation each
 * where N or q changes, one step over each constant stretch). At every zoom a
 * column's width at a height is the individuals alive then; steps that come out
 * sub-pixel when zoomed out are drawn as they are, never averaged away.
 */
export class Steps {
  /** Per branch: the step boundaries' world heights, ascending (top down), within its span. */
  private readonly ys = new Map<FanBranch, Float64Array>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
  ) {}

  /** World heights of branch b's step boundaries (ascending), between its tip and the fork. */
  bounds(b: FanBranch): Float64Array {
    let v = this.ys.get(b);
    if (!v) {
      const out: number[] = [];
      const ages = b.pop.steps.ages;
      // (ages[0] is the tip; the last step runs on past its last boundary.)
      for (let k = 1; k < ages.length; k++) {
        if (!Number.isFinite(ages[k])) continue;
        const y = this.time.y(ages[k] / 1e6);
        if (y > b.tipY && y < 0) out.push(y);
      }
      v = Float64Array.from(out.sort((p, q) => p - q));
      this.ys.set(b, v);
    }
    return v;
  }

  /** Width of branch b at world y and of its green lane: [w, gw] (the step there). */
  lanesAt(b: FanBranch, y: number): [number, number] {
    if (y >= 0) return [b.baseW, b.baseW * b.baseQ];
    if (y < b.tipY) return [0, 0];
    const { n, q } = b.pop.stepAt(this.time.ageAt(y));
    const w = n > 0 ? b.unit * g(n, this.mode) : 0;
    return [w, w * q];
  }

  /** Width of branch b at world y (lanesAt's first). */
  widthAt(b: FanBranch, y: number): number {
    return this.lanesAt(b, y)[0];
  }

  /**
   * World heights of branch b's step lines from y0 down to y1 (y0 < y1),
   * ascending; at most `max` of them (null if there are more).
   */
  lines(b: FanBranch, y0: number, y1: number, max = 4000): number[] | null {
    const v = this.bounds(b);
    const out: number[] = [];
    for (const y of v) {
      if (y <= y0) continue;
      if (y >= y1) break;
      out.push(y);
    }
    return out.length > max ? null : out;
  }
}

/** Left edge of a branch at world y: one straight column from the bottom of the world to the tip. */
export function leftAt(b: FanBranch, _y?: number): number {
  return b.colLeft;
}

/**
 * A branch's lanes at world y, as drawn: total width w (the individuals alive
 * then, stepped), the green lane's width gw (those with living descendants
 * today, stepped alike) and its fraction f.
 */
export function laneAt(b: FanBranch, y: number): { w: number; gw: number; f: number } {
  const [w, gw] = b.steps.lanesAt(b, y);
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

/** Individuals alive at age `ageMa` in a species (population.ts): its founders before its first appearance, 0 after an extinct one's last. */
export function aliveAt(sp: SpeciesRec, ageMa: number): number {
  return population(sp).aliveAt(ageMa);
}

/**
 * Exact (unstepped) strand width and green fraction of a branch at age
 * `ageMa`: w = the individuals alive then (g() in log widths) times the unit,
 * f = the share of them with living descendants today (population.ts).
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const n = b.pop.aliveAt(ageMa);
  const w = n > 0 ? b.unit * g(n, mode) : 0;
  return { w, f: w > 0 ? b.pop.greenAt(ageMa) : 0 };
}

export function layoutFan(clade: CladeRec, mode: WidthMode): Fan {
  const sp = clade.species;
  const pops = sp.map((s) => population(s));
  const gs = pops.map((p) => g(p.max, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const W = TRUNK_WIDTH;
  const unit = W / sum;
  const time = new TimeScale(clade.t0);
  const steps = new Steps(time, mode);
  const branches: FanBranch[] = sp.map((s, i) => {
    const share = gs[i] / sum;
    const pop = pops[i];
    return {
      sp: s,
      index: i,
      share,
      width: share * W,
      unit,
      pop,
      baseW: unit * g(pop.founders, mode),
      baseQ: pop.qBase,
      baseLeft: 0,
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
