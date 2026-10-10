// The Panthera fan as a rectangular dated tree, fixed in world units (y grows
// downwards, like the screen). Nothing here depends on the camera: panning or
// zooming never changes a shape or a width.
//
// The tree is splits.ts's: each split is one date where a parent population
// divides into its daughters (a clean split, a sharp Y).
//   - Each species is one strand from the bottom of the world up to its tip
//     ("now" for the living, its last appearance if extinct). Above its own
//     split (its start, b.t0) it is a leaf column (colLeft) as wide as its
//     room; the leaf columns sit side by side in tree order with a fixed gap
//     between neighbours (gapBetween): GAP_FRAC of the smaller one's room, at
//     least MIN_GAP_FRAC of the stem's.
//   - Below a split, its daughters' strands sit side by side, with no gaps, in
//     the parent's column (FanNode), centred under the daughters: the parent
//     column's width is the sum of its strands' founders, so at every split
//     the parent just below is exactly the daughters just above. The column
//     runs down to the parent's own split; the oldest split's (the root, the
//     clade's ancestors: the stem) runs down to the bottom of the world
//     (STEM_BOTTOM_MA). A strand jogs sideways at each split it passes: a
//     horizontal edge, every other edge vertical.
//
// Inside a leaf column, at every height, the lanes split the individuals alive
// then (population.ts): the green lane on its left edge holds those with living
// descendants today, the gray lane to its right those whose line ended (warm
// gray for an extinct species, all of it). In a parent column the green is the
// genealogy recurrence on the summed population (FanNode.q), drawn as one green
// prefix across its strands. Both edges are step functions of height (Steps),
// all vertical and horizontal segments.
//
// Height = time: the oldest split is at y = 0 ("the fork"), "now" at
// y = −TIME_H, on a log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals alive at that time (∝ births per unit time): N(t) times
// one fixed world width per individual (linear) or per decade of individuals
// (log, g()). A leaf column's room is its widest N. Below its split a strand
// holds its founders (constant): the parent population is the sum of its
// daughters' founders. The steps are the population's own (population.ts: a
// generation each where N or q changes), fixed in the world: a drop in N shows
// as a step at every zoom.

import type { CladeRec, SpeciesRec } from './panthera';
import { parentShare, population, type Population } from './population';
import { PANTHERA_TREE, type Split } from './splits';

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 110;
/** The bottom of the world: the stem (the clade's ancestors) runs down to here (Ma, ~first life). */
export const STEM_BOTTOM_MA = 4000;
/** The stem fades out from here down to the bottom (Ma). */
export const STEM_FADE_MA = 300;
/** Height = time: the oldest split (the fork) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Gap between neighbouring leaf columns: this share of the smaller one's room ... */
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


/** Where a strand sits in one ancestral column: from that split's height down (to the next split below). */
export interface PathSeg {
  /** The split's height: the strand is in this column for y ≥ y (down to the column's bottom). */
  y: number;
  /** The strand's left edge in it, and its offset from the column's left edge. */
  left: number;
  off: number;
  node: FanNode;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index in tree order (left to right; Fan.branches keeps the dataset's order). */
  index: number;
  /** Width share among the leaf columns and its room (world): its widest, at the most alive. */
  share: number;
  width: number;
  /** World width per individual (linear) or per decade of individuals (log). */
  unit: number;
  /** The species' population through time from its start (alive, and the share with living descendants). */
  pop: Population;
  /** The species' start (Ma): its split from its sister in the dated tree, and its height. */
  t0: number;
  splitY: number;
  /** Width below its split (its founders): its strand in the parent columns. */
  baseW: number;
  /** Left edge of its own column, from its split to its tip. */
  colLeft: number;
  /** The split it starts at (its parent column). */
  node: FanNode;
  /** Its place in each ancestral column, the parent's first (ascending y, down to the root). */
  path: PathSeg[];
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's step grids, which draw its edges. */
  steps: Steps;
}

/** A split of the dated tree and the parent column below it (the daughters' ancestors). */
export interface FanNode {
  split: Split;
  name: string;
  /** The split's date (Ma) and height: the column's top. */
  ageMa: number;
  y: number;
  /** The column's bottom: the parent's split (the root's: the bottom of the world). */
  yBot: number;
  parent: FanNode | null;
  /** Daughters, left to right: splits or species' strands. */
  kids: (FanNode | FanBranch)[];
  /** Every strand under it, left to right (the column's order). */
  strands: FanBranch[];
  /** Individuals alive in the column (the sum of its strands' founders) and their mean generation length (years). */
  n: number;
  genYears: number;
  /** World width (the sum of its strands' founders widths) and left edge. */
  width: number;
  left: number;
  /**
   * Share with living descendants by generation below the split: q[k] over
   * ages [ageMa + k·GL, ageMa + (k+1)·GL), the last one running on down the
   * column. The genealogy recurrence on the summed population (population.ts):
   * q[0] = the daughters' shares just above the split weighted by their sizes,
   * q[k+1] = parentShare(q[k], n, n).
   */
  q: Float64Array;
}

export interface Fan {
  clade: CladeRec;
  mode: WidthMode;
  trunkWidth: number;
  trunkBottom: Pt;
  /** One per species, in the dataset's order (clade.species). */
  branches: FanBranch[];
  /** The splits, parents before daughters; root = the oldest (the stem below it). */
  nodes: FanNode[];
  root: FanNode;
  time: TimeScale;
  steps: Steps;
  /** World x extent of the stem (the root's column). */
  stem: [number, number];
  /** World x extent of all the columns. */
  x0: number;
  x1: number;
}

export function isNode(k: FanNode | FanBranch): k is FanNode {
  return 'strands' in k;
}

/** A parent column's green share at age `ageMa` (Ma, at or below its split). */
export function nodeQ(v: FanNode, ageMa: number): number {
  const k = Math.floor(((ageMa - v.ageMa) * 1e6) / v.genYears);
  return v.q[Math.min(v.q.length - 1, Math.max(0, k))];
}

/** The column strand b is in at height y ≥ b.splitY: the deepest split at or above y. */
export function segAt(b: FanBranch, y: number): PathSeg {
  const p = b.path;
  let s = p[0];
  for (let k = 1; k < p.length && p[k].y <= y; k++) s = p[k];
  return s;
}

const clampW = (v: number, w: number) => Math.min(w, Math.max(0, v));

/**
 * The edges' steps, fixed in the world and never depending on the camera: each
 * branch's population steps above its split (population.ts Population.steps: a
 * generation each where N or q changes, one step over each constant stretch),
 * its jogs at the splits below it, and where the green prefix of a parent
 * column crosses it changes. At every zoom a column's width at a height is the
 * individuals alive then; steps that come out sub-pixel when zoomed out are
 * drawn as they are, never averaged away.
 */
export class Steps {
  /** Per branch: the step boundaries' world heights, ascending (top down), within its span. */
  private readonly ys = new Map<FanBranch, Float64Array>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly bottom = Infinity,
  ) {}

  /** World heights of branch b's step boundaries (ascending), from its tip down to the bottom of the world. */
  bounds(b: FanBranch): Float64Array {
    let v = this.ys.get(b);
    if (!v) {
      const out: number[] = [];
      const ages = b.pop.steps.ages;
      // (ages[0] is the tip; the last step runs on past its last boundary.)
      for (let k = 1; k < ages.length; k++) {
        if (!Number.isFinite(ages[k])) continue;
        const y = this.time.y(ages[k] / 1e6);
        if (y > b.tipY && y < b.splitY) out.push(y);
      }
      for (const s of b.path) {
        const nd = s.node;
        const bot = Math.min(nd.yBot, this.bottom);
        if (s.y > b.tipY && s.y < bot) out.push(s.y);
        // Where the column's green prefix crosses into or out of the strand.
        let gw = clampW(nd.q[0] * nd.width - s.off, b.baseW);
        for (let k = 1; k < nd.q.length; k++) {
          const g1 = clampW(nd.q[k] * nd.width - s.off, b.baseW);
          if (g1 === gw) continue;
          gw = g1;
          const y = this.time.y(nd.ageMa + (k * nd.genYears) / 1e6);
          if (y > s.y && y < bot) out.push(y);
        }
      }
      v = Float64Array.from(out.sort((p, q) => p - q));
      this.ys.set(b, v);
    }
    return v;
  }

  /** Width of branch b at world y and of its green lane: [w, gw] (the step there). */
  lanesAt(b: FanBranch, y: number): [number, number] {
    if (y < b.tipY) return [0, 0];
    const age = this.time.ageAt(y);
    if (y < b.splitY) {
      const { n, q } = b.pop.stepAt(age);
      const w = n > 0 ? b.unit * g(n, this.mode) : 0;
      return [w, w * q];
    }
    // In a parent column: its founders, green as far as the column's green prefix reaches.
    const s = segAt(b, y);
    return [b.baseW, clampW(nodeQ(s.node, age) * s.node.width - s.off, b.baseW)];
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

/** Left edge of a branch at world y: its own column above its split, then its place in each parent column below. */
export function leftAt(b: FanBranch, y: number): number {
  return y < b.splitY ? b.colLeft : segAt(b, y).left;
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

/**
 * World x intervals of the columns present at height y: the leaf columns
 * above their splits (their lanes' width), the parent columns over their span
 * (the stem below the oldest split).
 */
export function columnsAt(fan: Fan, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const b of fan.branches) {
    if (y < b.tipY || y >= b.splitY) continue;
    out.push([b.colLeft, b.colLeft + laneAt(b, y).w]);
  }
  for (const v of fan.nodes) if (y >= v.y && (y < v.yBot || (!v.parent && y <= v.yBot))) out.push([v.left, v.left + v.width]);
  return out;
}

/** Gap (world) between neighbouring columns a and b. */
export function gapBetween(a: FanBranch, b: FanBranch, stem: number): number {
  return Math.max(GAP_FRAC * Math.min(a.width, b.width), MIN_GAP_FRAC * stem);
}

export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : 1 + Math.max(0, Math.log10(n));
}

/** Individuals alive at age `ageMa` in a species (population.ts, from its first appearance): 0 after an extinct one's last. */
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

/** Generations a parent column's green recurrence runs before it is taken as settled, at most. */
const MAX_Q_GENS = 5000;

export function layoutFan(clade: CladeRec, mode: WidthMode, tree: Split = PANTHERA_TREE): Fan {
  const W = TRUNK_WIDTH;
  const time = new TimeScale(tree.ageMa);
  const yBottom = time.y(STEM_BOTTOM_MA);
  const steps = new Steps(time, mode, yBottom);
  const bySci = new Map(clade.species.map((s) => [s.sci, s]));
  const placed = new Set<string>();
  const branches: FanBranch[] = [];
  const nodes: FanNode[] = [];
  const strand = (sp: SpeciesRec, v: FanNode): FanBranch => {
    placed.add(sp.sci);
    const b: FanBranch = {
      sp,
      index: branches.length,
      share: 0,
      width: 0,
      unit: 0,
      pop: population(sp, v.ageMa),
      t0: v.ageMa,
      splitY: v.y,
      baseW: 0,
      colLeft: 0,
      node: v,
      path: [],
      tipY: time.y(sp.t1),
      steps,
    };
    branches.push(b);
    return b;
  };
  const build = (s: Split, parent: FanNode | null): FanNode => {
    const v: FanNode = { split: s, name: s.name, ageMa: s.ageMa, y: time.y(s.ageMa), yBot: parent ? parent.y : yBottom, parent, kids: [], strands: [], n: 0, genYears: 0, width: 0, left: 0, q: new Float64Array([0]) };
    nodes.push(v);
    for (const k of s.kids) {
      if (typeof k === 'string') {
        const sp = bySci.get(k);
        if (!sp) continue;
        const b = strand(sp, v);
        v.kids.push(b);
        v.strands.push(b);
      } else {
        const c = build(k, v);
        if (!c.strands.length) continue;
        v.kids.push(c);
        v.strands.push(...c.strands);
      }
    }
    return v;
  };
  const root = build(tree, null);
  // Species the tree does not place (none today): off the stem, at the oldest split.
  for (const sp of clade.species) {
    if (placed.has(sp.sci)) continue;
    const b = strand(sp, root);
    root.kids.push(b);
    root.strands.push(b);
  }
  // Widths: one unit for all (the leaf columns' rooms add up to the trunk's width).
  const gs = branches.map((b) => g(b.pop.max, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const unit = W / sum;
  branches.forEach((b, i) => {
    b.share = gs[i] / sum;
    b.width = b.share * W;
    b.unit = unit;
    b.baseW = unit * g(b.pop.founders, mode);
  });
  // Leaf columns side by side with their gaps, centred.
  let total = 0;
  for (let j = 0; j < branches.length; j++) total += branches[j].width + (j ? gapBetween(branches[j - 1], branches[j], W) : 0);
  let cx = -total / 2;
  for (let j = 0; j < branches.length; j++) {
    if (j) cx += gapBetween(branches[j - 1], branches[j], W);
    branches[j].colLeft = cx;
    cx += branches[j].width;
  }
  // Parent columns, daughters first: the sum of the strands' founders, centred under the daughters.
  const place = (v: FanNode): void => {
    for (const k of v.kids) if (isNode(k)) place(k);
    let n = 0;
    let gl = 0;
    let w = 0;
    for (const b of v.strands) {
      n += b.pop.founders;
      gl += b.pop.founders * b.sp.genYears;
      w += b.baseW;
    }
    v.n = n;
    v.genYears = n > 0 ? gl / n : 7;
    v.width = w;
    const first = v.kids[0];
    const last = v.kids[v.kids.length - 1];
    const lo = isNode(first) ? first.left : first.colLeft;
    const hi = isNode(last) ? last.left + last.width : last.colLeft + last.baseW;
    v.left = (lo + hi) / 2 - w / 2;
    // Green: the daughters' shares just above the split, by their sizes; then the genealogy back, generation by generation.
    let qn = 0;
    for (const k of v.kids) {
      if (isNode(k)) qn += nodeQ(k, v.ageMa) * k.n;
      else qn += k.pop.stepAt(Math.max(k.sp.t1, k.t0 - 1e-9)).q * k.pop.founders;
    }
    let h = n > 0 ? qn / n : 0;
    const q = [h];
    const gens = Math.min(MAX_Q_GENS, Math.ceil(((time.ageAt(v.yBot) - v.ageMa) * 1e6) / v.genYears));
    for (let k = 1; k < gens; k++) {
      const h1 = parentShare(h, n, n);
      if (Math.abs(h1 - h) < 1e-13) break;
      q.push(h1);
      h = h1;
    }
    v.q = Float64Array.from(q);
  };
  place(root);
  // Each strand's place in its ancestors' columns: offsets in the column's order.
  for (const v of nodes) {
    let off = 0;
    for (const b of v.strands) {
      b.path.push({ y: v.y, left: v.left + off, off, node: v });
      off += b.baseW;
    }
  }
  for (const b of branches) b.path.sort((p, q) => p.y - q.y);
  // The branches in the dataset's order (callers index them by species); `index` is the tree's order.
  const rank = new Map(clade.species.map((s, i) => [s, i]));
  branches.sort((p, q) => rank.get(p.sp)! - rank.get(q.sp)!);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of branches) {
    x0 = Math.min(x0, b.colLeft);
    x1 = Math.max(x1, b.colLeft + b.width);
  }
  for (const v of nodes) {
    x0 = Math.min(x0, v.left);
    x1 = Math.max(x1, v.left + v.width);
  }
  return {
    clade,
    mode,
    trunkWidth: W,
    trunkBottom: { x: root.left + root.width / 2, y: yBottom },
    branches,
    nodes,
    root,
    time,
    steps,
    stem: [root.left, root.left + root.width],
    x0,
    x1,
  };
}
