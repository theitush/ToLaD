// The Panthera fan as a dated tree of thick branches, fixed in world units (y
// grows downwards, like the screen). Nothing here depends on the camera:
// panning or zooming never changes a shape or a width. Every edge is a
// continuous function of height, made of straight segments in (x, log t).
//
// The tree is splits.ts's: each split is one date where a parent population
// divides into its daughters.
//   - Every column (a species' own, above its split; a split's parent lineage,
//     FanNode, from its split down to the parent's split) has a world-fixed
//     centre line x_c. Its width is the individuals alive then and grows and
//     shrinks symmetrically about x_c: a population change is a slanted ramp
//     on both edges (population.ts: N linear in log time between the
//     history's points), never a stair.
//   - At a split the parent's interval divides into the daughters'
//     sub-intervals, in the table's order (their widths add up: the parent is
//     the sum of the daughters' founders). Above it, over the fork span F
//     (FORK_FRAC of the split's log depth below now, shortened to fit: at most
//     FORK_NEST of the gap to a daughter's own split, FORK_LEAF of a
//     daughter's own life), each daughter's centre runs straight from its
//     sub-interval's centre out to its own x_c, so both its edges are straight
//     slanted segments and the gap between daughters opens as a V. One F per
//     split, so the V is symmetric and its edges never cross.
//   - The stem: the oldest split's parent column, centred, down to the bottom
//     of the world (STEM_BOTTOM_MA); its top is the sum of its daughters.
//   - An extinct species forks off the same way and ends in a taper
//     (population.ts: N falls linearly in log time to 0 at its last
//     appearance): a pinch, not a cut.
// Placement: the species' columns sit side by side in the table's order
// (splits.ts, a left-to-right order of the tree, so no fork crosses another),
// each centred in a slot as wide as its room (its widest) with a gap between
// neighbours (gapBetween). A parent column's centre is the width-weighted mean
// of its daughters' centres (their widths at the split): the daughters move
// out from it by as little as the slots allow, both ways, so forks are short
// and balanced.
//
// Each species is one strand from the bottom of the world up to its tip: its
// own column above its split, and below it its slice of each parent column
// (its founders, side by side with its sisters' in the table's order, no
// gaps), which moves with the column. The mesh draws strands, so every
// individual's slot maps through the column's left edge and width at its
// height and slides with the edges.
//
// Inside a column, at every height, the lanes split the individuals alive
// then (population.ts): the green lane on its left edge holds those with
// living descendants today, the gray lane to its right those whose line ended
// (warm gray for an extinct species, all of it). In a parent column the green
// is the genealogy recurrence on the summed population (FanNode.q), drawn as
// one green prefix across its strands, linear in log time between its
// generations' midpoints.
//
// Height = time: the oldest split is at y = 0 ("the fork"), "now" at
// y = −TIME_H, on a log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals alive at that time (∝ births per unit time): N(t) times
// one fixed world width per individual (linear) or per decade of individuals
// (log, g()). A species' room is its widest N. Below its split a strand
// holds its founders (constant). Knots (Steps.bounds): the heights between
// which a strand's left edge and lanes are linear in y (exactly in linear
// widths; log widths add sub-knots so the curve is followed closely).

import type { CladeRec, SpeciesRec } from './panthera';
import { parentShare, population, TIME_C, type Population } from './population';
import { PANTHERA_TREE, type Split } from './splits';

export { TIME_C };

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 110;
/** The bottom of the world: the stem (the clade's ancestors) runs down to here (Ma, ~first life). */
export const STEM_BOTTOM_MA = 4000;
/** The stem fades out from here down to the bottom (Ma). */
export const STEM_FADE_MA = 300;
/** Height = time: the oldest split (the fork) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Gap between neighbouring species' slots: this share of the smaller one's room ... */
export const GAP_FRAC = 0.35;
/** ... but at least this share of the stem's width. */
export const MIN_GAP_FRAC = 0.04;
/** The fork span: this share of the split's height below now ... */
export const FORK_FRAC = 0.07;
/** ... at most this share of the gap from the split to a daughter's own split ... */
export const FORK_NEST = 0.5;
/** ... and this share of a daughter species' own life (split to tip). */
export const FORK_LEAF = 0.4;

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

/** Where a strand sits in one parent column: from that split's height down (to the next split below). */
export interface PathSeg {
  /** The split's height: the strand is in this column for y ≥ y (down to the column's bottom). */
  y: number;
  /** Its offset from the column's left edge (constant), and its left edge where the column is centred. */
  off: number;
  left: number;
  node: FanNode;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index in tree order (left to right; Fan.branches keeps the dataset's order). */
  index: number;
  /** Width share among the species' columns and its room (world): its widest, at the most alive. */
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
  /** Its own column's centre line (world-fixed) and its room's left edge (xc − width / 2). */
  xc: number;
  colLeft: number;
  /** Its offset in the parent column at its split (its sub-interval there), and the top of its fork: centred on xc from here up. */
  subOff: number;
  forkY: number;
  /** The split it starts at (its parent column). */
  node: FanNode;
  /** Its place in each parent column, the parent's first (ascending y, down to the root). */
  path: PathSeg[];
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's knots, which draw its edges. */
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
  /** World width (the sum of its strands' founders widths, constant). */
  width: number;
  /** Centre line (world-fixed) and the left edge where it is centred (xc − width / 2). */
  xc: number;
  left: number;
  /** Its offset in its parent's column at the parent's split, and the top of its fork (the root: none, its bottom). */
  subOff: number;
  forkY: number;
  /** The fork span of its daughters (world height above its split). */
  fork: number;
  /**
   * Share with living descendants by generation below the split: q[k] at the
   * middle of generation k below it (ages ageMa + (k + ½)·GL), linear in log
   * time between, the last one running on down the column. The genealogy
   * recurrence on the summed population (population.ts): q[0] = the
   * daughters' shares just above the split weighted by their sizes,
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

/** log10(years + TIME_C) of an age in Ma: the axis's log time. */
const dexMa = (ageMa: number) => Math.log10(Math.max(0, ageMa) * 1e6 + TIME_C);

/** A parent column's green share at age `ageMa` (Ma, at or below its split): q by generation, linear in log time between their midpoints. */
export function nodeQ(v: FanNode, ageMa: number): number {
  const q = v.q;
  const kf = ((ageMa - v.ageMa) * 1e6) / v.genYears - 0.5;
  const k = Math.floor(kf);
  if (k < 0) return q[0];
  if (k >= q.length - 1) return q[q.length - 1];
  const a0 = v.ageMa + ((k + 0.5) * v.genYears) / 1e6;
  const a1 = v.ageMa + ((k + 1.5) * v.genYears) / 1e6;
  const t = (dexMa(ageMa) - dexMa(a0)) / (dexMa(a1) - dexMa(a0));
  return q[k] + (q[k + 1] - q[k]) * Math.min(1, Math.max(0, t));
}

/** The column strand b is in at height y ≥ b.splitY: the deepest split at or above y. */
export function segAt(b: FanBranch, y: number): PathSeg {
  const p = b.path;
  let s = p[0];
  for (let k = 1; k < p.length && p[k].y <= y; k++) s = p[k];
  return s;
}

const clampW = (v: number, w: number) => Math.min(w, Math.max(0, v));

/** Left edge of parent column v at height y (within its span): centred on its xc, but over its fork sliding straight out of its sub-interval of its parent. */
export function nodeLeftAt(v: FanNode, y: number): number {
  const p = v.parent;
  if (!p || y <= v.forkY) return v.left;
  const sub = p.left + v.subOff;
  const u = Math.min(1, Math.max(0, (v.yBot - y) / (v.yBot - v.forkY)));
  return sub + (v.left - sub) * u;
}

/** Centre of branch b's own column at height y < b.splitY: xc, but over its fork straight out from its sub-interval's centre. */
export function ownCentreAt(b: FanBranch, y: number): number {
  if (y <= b.forkY) return b.xc;
  const c0 = b.node.left + b.subOff + b.baseW / 2;
  const u = Math.min(1, Math.max(0, (b.splitY - y) / (b.splitY - b.forkY)));
  return c0 + (b.xc - c0) * u;
}

/** Sub-knots per stretch where a log width curves (N linear in log time is not linear in log N). */
const LOG_SUB = 12;

/**
 * The knots, fixed in the world and never depending on the camera: per
 * branch, the heights between which its left edge and both lanes are linear
 * in y (the population's points and its green's generation midpoints, its
 * fork's top, the splits below it, its parent columns' forks and the
 * generations where their green prefix crosses it). The mesh and the lanes
 * are drawn as straight pieces between them.
 */
export class Steps {
  /** Per branch: the knots' world heights, ascending (top down), within its span. */
  private readonly ys = new Map<FanBranch, Float64Array>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly bottom = Infinity,
  ) {}

  /** World heights of branch b's knots (ascending), from its tip down to the bottom of the world (both excluded). */
  bounds(b: FanBranch): Float64Array {
    let v = this.ys.get(b);
    if (!v) {
      const out: number[] = [];
      const own: number[] = [];
      for (const a of b.pop.knots) {
        const y = this.time.y(a);
        if (y > b.tipY && y < b.splitY) own.push(y);
      }
      if (b.forkY > b.tipY && b.forkY < b.splitY) own.push(b.forkY);
      own.sort((p, q) => p - q);
      out.push(...own);
      if (this.mode === 'log') {
        // A changing log width curves between knots: follow it with sub-knots.
        const e = [b.tipY, ...own, b.splitY];
        for (let k = 0; k + 1 < e.length; k++) {
          const d = (e[k + 1] - e[k]) * 1e-6;
          const n0 = b.pop.aliveAt(this.time.ageAt(e[k] + d));
          const n1 = b.pop.aliveAt(this.time.ageAt(e[k + 1] - d));
          if (Math.abs(n1 - n0) <= 1e-9 * Math.max(n0, n1)) continue;
          for (let j = 1; j < LOG_SUB; j++) out.push(e[k] + ((e[k + 1] - e[k]) * j) / LOG_SUB);
        }
      }
      for (const s of b.path) {
        const nd = s.node;
        const bot = Math.min(nd.yBot, this.bottom);
        if (s.y > b.tipY && s.y < bot) out.push(s.y);
        if (nd.parent && nd.forkY > s.y && nd.forkY < bot) out.push(nd.forkY);
        // Where the column's green prefix in the strand changes slope: around each generation midpoint where it moves.
        const cw = (k: number) => clampW(nd.q[Math.min(nd.q.length - 1, Math.max(0, k))] * nd.width - s.off, b.baseW);
        for (let k = 0; k < nd.q.length; k++) {
          if (cw(k - 1) === cw(k) && cw(k) === cw(k + 1)) continue;
          const y = this.time.y(nd.ageMa + ((k + 0.5) * nd.genYears) / 1e6);
          if (y > s.y && y < bot) out.push(y);
        }
      }
      v = Float64Array.from(out.sort((p, q) => p - q).filter((y, i, a) => i === 0 || y !== a[i - 1]));
      this.ys.set(b, v);
    }
    return v;
  }

  /** Width of branch b at world y and of its green lane: [w, gw]. */
  lanesAt(b: FanBranch, y: number): [number, number] {
    if (y < b.tipY) return [0, 0];
    const age = this.time.ageAt(y);
    if (y < b.splitY) {
      const w = b.unit * g(b.pop.aliveAt(age), this.mode);
      return [w, b.sp.extinct ? 0 : w * b.pop.greenAt(age)];
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
   * World heights of branch b's knots from y0 down to y1 (y0 < y1),
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

/** Left edge of a branch at world y: its own column above its split (its width about its centre line), then its slice of each parent column below. */
export function leftAt(b: FanBranch, y: number): number {
  if (y < b.splitY) return ownCentreAt(b, y) - b.steps.widthAt(b, y) / 2;
  const s = segAt(b, y);
  return nodeLeftAt(s.node, y) + s.off;
}

/**
 * A branch's lanes at world y, as drawn: total width w (the individuals alive
 * then), the green lane's width gw (those with living descendants today) and
 * its fraction f.
 */
export function laneAt(b: FanBranch, y: number): { w: number; gw: number; f: number } {
  const [w, gw] = b.steps.lanesAt(b, y);
  return { w, gw, f: w > 0 ? gw / w : 0 };
}

/**
 * World x intervals of the columns present at height y: the species' own
 * columns above their splits, the parent columns over their span (the stem
 * below the oldest split).
 */
export function columnsAt(fan: Fan, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const b of fan.branches) {
    if (y < b.tipY || y >= b.splitY) continue;
    const l = leftAt(b, y);
    out.push([l, l + laneAt(b, y).w]);
  }
  for (const v of fan.nodes) {
    if (y >= v.y && (y < v.yBot || (!v.parent && y <= v.yBot))) {
      const l = nodeLeftAt(v, y);
      out.push([l, l + v.width]);
    }
  }
  return out;
}

/** Gap (world) between neighbouring species' slots a and b. */
export function gapBetween(a: FanBranch, b: FanBranch, stem: number): number {
  return Math.max(GAP_FRAC * Math.min(a.width, b.width), MIN_GAP_FRAC * stem);
}

/** Width of n individuals: n (linear), or 1 + log10 n (log; below one, n, so it falls continuously to 0). */
export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' || n < 1 ? n : 1 + Math.log10(n);
}

/** Individuals alive at age `ageMa` in a species (population.ts, from its first appearance): 0 after an extinct one's last. */
export function aliveAt(sp: SpeciesRec, ageMa: number): number {
  return population(sp).aliveAt(ageMa);
}

/**
 * Strand width and green fraction of a branch at age `ageMa` in its own
 * column: w = the individuals alive then (g() in log widths) times the unit,
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
  const yNow = time.y(0);
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
      pop: population(sp, v.ageMa, mode),
      t0: v.ageMa,
      splitY: v.y,
      baseW: 0,
      xc: 0,
      colLeft: 0,
      subOff: 0,
      forkY: v.y,
      node: v,
      path: [],
      tipY: time.y(sp.t1),
      steps,
    };
    branches.push(b);
    return b;
  };
  const build = (s: Split, parent: FanNode | null): FanNode => {
    const y = time.y(s.ageMa);
    const yBot = parent ? parent.y : yBottom;
    const v: FanNode = { split: s, name: s.name, ageMa: s.ageMa, y, yBot, parent, kids: [], strands: [], n: 0, genYears: 0, width: 0, xc: 0, left: 0, subOff: 0, forkY: yBot, fork: 0, q: new Float64Array([0]) };
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
  // Widths: one unit for all (the species' rooms add up to the trunk's width).
  const gs = branches.map((b) => g(b.pop.max, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const unit = W / sum;
  branches.forEach((b, i) => {
    b.share = gs[i] / sum;
    b.width = b.share * W;
    b.unit = unit;
    b.baseW = unit * g(b.pop.founders, mode);
  });
  // The species' slots side by side in tree order with their gaps, centred on 0: each column's centre line.
  let total = 0;
  for (let j = 0; j < branches.length; j++) total += branches[j].width + (j ? gapBetween(branches[j - 1], branches[j], W) : 0);
  let cx = -total / 2;
  for (let j = 0; j < branches.length; j++) {
    if (j) cx += gapBetween(branches[j - 1], branches[j], W);
    branches[j].colLeft = cx;
    branches[j].xc = cx + branches[j].width / 2;
    cx += branches[j].width;
  }
  // A daughter's width at its split: its founders (a species) or its column (a split).
  const kidW = (k: FanNode | FanBranch) => (isNode(k) ? k.width : k.baseW);
  // Parent columns, daughters first: the sum of the strands' founders, centred on the daughters' width-weighted mean centre.
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
    let m = 0;
    let mw = 0;
    for (const k of v.kids) {
      m += kidW(k) * k.xc;
      mw += kidW(k);
    }
    v.xc = mw > 0 ? m / mw : 0;
    v.left = v.xc - w / 2;
    // Green: the daughters' shares just above the split, by their sizes; then the genealogy back, generation by generation.
    let qn = 0;
    for (const k of v.kids) {
      if (isNode(k)) qn += nodeQ(k, v.ageMa) * k.n;
      else qn += (k.sp.extinct ? 0 : k.pop.greenAt(Math.max(k.sp.t1, k.t0 - 1e-9))) * k.pop.founders;
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
  // The forks: the daughters' sub-intervals at each split (in order, widths adding up to the parent's), one fork span per split.
  for (const v of nodes) {
    let F = FORK_FRAC * (v.y - yNow);
    for (const k of v.kids) F = Math.min(F, isNode(k) ? FORK_NEST * (v.y - k.y) : FORK_LEAF * (v.y - k.tipY));
    v.fork = F;
    let off = 0;
    for (const k of v.kids) {
      k.subOff = off;
      k.forkY = v.y - F;
      off += kidW(k);
    }
  }
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
    trunkBottom: { x: root.xc, y: yBottom },
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
