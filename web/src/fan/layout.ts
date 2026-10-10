// The Panthera fan as one partitioned band, fixed in world units (y grows
// downwards, like the screen). Nothing here depends on the camera: panning or
// zooming never changes a shape or a width.
//
// The tree is splits.ts's: each split is one date where a parent population
// divides into its daughters (a clean split, a sharp Y).
//   - At every height the whole clade is one band, split edge to edge into the
//     species' strands in tree order, with no gaps. Each species is one strand
//     from the bottom of the world up to its tip ("now" for the living, its
//     last appearance if extinct).
//   - Above its split (its start, b.t0) a strand is the species' own column,
//     as wide as the individuals alive then. Below it, it holds its founders
//     (its width at the split, constant), side by side with its sisters' in the
//     parent column: at every split the parent just below is exactly the
//     daughters just above, and nothing moves sideways there. A split is only
//     where a separator (a hairline between neighbouring strands, view.ts)
//     starts: below its lineages' last common split two neighbours are one
//     column. The stem is the band below the oldest split.
//   - An extinct species' width pinches to zero over the last stretch of its
//     span (RAMP_H, at most RAMP_FRAC of it), ending at its last appearance: a
//     ramp, not a cut. Above it its neighbours meet.
//
// Every edge is a continuous, piecewise linear function of height: the band is
// evaluated exactly at its knots (Band.ys: every strand's own population
// points, its split and tip, and a few generations of each parent column's
// genealogy), and every edge, width and lane is the straight line between
// neighbouring knots. The population model is that same interpolant (nAt):
// width = individuals alive, exactly, at every height.
//
// Anchoring: the band's centre of mass (each strand's centre weighted by its
// width) stays on x = 0 at every height. Of all the ways to place a band
// whose widths change, this one moves the strands sideways the least (it
// minimises the width-weighted squared drift of their centres), so a change
// in one strand is shared out and the big living columns barely drift; the
// stem, uniform, is centred on x = 0.
//
// Inside a strand, at every height, the lanes split the individuals alive then
// (population.ts): the green lane on its left edge holds those with living
// descendants today, the gray lane to its right those whose line ended (warm
// gray for an extinct species, all of it above its split). In a parent column
// the green is the genealogy recurrence on the summed population (FanNode.q),
// drawn as one green prefix across its strands.
//
// Height = time: the oldest split is at y = 0 ("the fork"), "now" at
// y = −TIME_H, on a log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals alive at that time (∝ births per unit time): N(t) times
// one fixed world width per individual (linear) or per decade of individuals
// (log, g()). Between two knots the width is linear in height, i.e. N(t) is
// linear in log time (linear widths) or log N is (log widths): the edges are
// straight lines in (x, log t), slanting where the population changes.

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
/** An extinct species pinches to zero over this much height (world) before its last appearance ... */
export const RAMP_H = 14;
/** ... at most this share of its own column's height. */
export const RAMP_FRAC = 0.35;
/** Below a split its column's green blends from the daughters' lanes into one prefix over this much height, at most (blendH). */
export const BLEND_H = 20;
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
  /** The split's height: the strand is in this column for y > y (down to the column's bottom). */
  y: number;
  /** The strand's offset from the column's left edge. */
  off: number;
  node: FanNode;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index in tree order (left to right; Fan.branches keeps the dataset's order). */
  index: number;
  /** Width share and its room (world): its widest, at the most alive. */
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
  /** The split it starts at (its parent column). */
  node: FanNode;
  /** Its place in each ancestral column, the parent's first (ascending y, down to the root). */
  path: PathSeg[];
  /** The tip (last appearance) height. */
  tipY: number;
  /** The band (its knots draw its edges). */
  steps: Band;
  /** Its own column's knots (above its split): heights ascending, width and green width there. */
  ky: Float64Array;
  kw: Float64Array;
  kg: Float64Array;
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
  /** World width (the sum of its strands' founders widths) and left edge at its split. */
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
  steps: Band;
  /** World x extent of the stem (the band below the oldest split). */
  stem: [number, number];
  /** World x extent of the band at any height. */
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

/** The column strand b is in just above height y > b.splitY (at a split's own height: the daughters' column, the one ending there). */
function segAbove(b: FanBranch, y: number): PathSeg {
  const p = b.path;
  let s = p[0];
  for (let k = 1; k < p.length && p[k].y < y; k++) s = p[k];
  return s;
}

const clampW = (v: number, w: number) => Math.min(w, Math.max(0, v));

/** Index k of the knot interval [ys[k], ys[k+1]] holding y (clamped to the ends). */
function seek(ys: Float64Array, y: number): number {
  let lo = 0;
  let hi = ys.length - 2;
  if (hi < 0) return 0;
  if (y <= ys[0]) return 0;
  if (y >= ys[hi + 1]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ys[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Linear interpolation of knot values v (stride `st`, column `c`) at y. */
function lerpAt(ys: Float64Array, v: Float64Array, st: number, c: number, y: number): number {
  if (ys.length === 1) return v[c];
  const k = seek(ys, y);
  const y0 = ys[k];
  const y1 = ys[k + 1];
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const a = v[k * st + c];
  const b = v[(k + 1) * st + c];
  return t === 0 ? a : t === 1 ? b : a + (b - a) * t;
}

/**
 * The band, fixed in the world and never depending on the camera: at each
 * knot (ys, ascending: top down) the strands' edges in tree order (edges: n + 1
 * per knot) and their green lanes' widths (green: n per knot); every edge and
 * lane is linear in y between neighbouring knots.
 */
export class Band {
  ys = new Float64Array(0);
  edges = new Float64Array(0);
  green = new Float64Array(0);
  /** The strands in tree order. */
  order: FanBranch[] = [];

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly bottom = Infinity,
  ) {}

  get n(): number {
    return this.order.length;
  }

  /** World x of edge i (0: the band's left; i: between strands i − 1 and i in tree order; n: its right) at y. */
  edgeAt(i: number, y: number): number {
    return lerpAt(this.ys, this.edges, this.n + 1, i, y);
  }

  /** World heights of the knots inside branch b's span (its tip down to the bottom of the world), ascending. */
  bounds(b: FanBranch): Float64Array {
    let lo = 0;
    while (lo < this.ys.length && this.ys[lo] <= b.tipY) lo++;
    let hi = this.ys.length;
    while (hi > lo && this.ys[hi - 1] >= this.bottom) hi--;
    return this.ys.subarray(lo, hi);
  }

  /** Width of branch b at world y and of its green lane: [w, gw]. */
  lanesAt(b: FanBranch, y: number): [number, number] {
    if (y < b.tipY) return [0, 0];
    const n = this.n;
    const w = lerpAt(this.ys, this.edges, n + 1, b.index + 1, y) - lerpAt(this.ys, this.edges, n + 1, b.index, y);
    return [Math.max(0, w), clampW(lerpAt(this.ys, this.green, n, b.index, y), Math.max(0, w))];
  }

  /** Width of branch b at world y (lanesAt's first). */
  widthAt(b: FanBranch, y: number): number {
    return this.lanesAt(b, y)[0];
  }

  /**
   * World heights of the knots from y0 down to y1 (y0 < y1) where branch b's
   * edges may bend, ascending; at most `max` of them (null if there are more).
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

/** @deprecated name: the band is the fan's steps object. */
export type Steps = Band;

/** Left edge of a branch at world y: its place in the band. */
export function leftAt(b: FanBranch, y: number): number {
  return b.steps.edgeAt(b.index, y);
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

/** Individuals alive in branch b at world y: the width's own interpolant (width = unit · g(N), exactly). */
export function nAt(b: FanBranch, y: number): number {
  return gInv(laneAt(b, y).w / b.unit, b.steps.mode);
}

/** World x intervals of the strands present at height y (side by side, edge to edge). */
export function columnsAt(fan: Fan, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const b of fan.branches) {
    if (y < b.tipY || y > fan.trunkBottom.y) continue;
    const w = laneAt(b, y).w;
    if (w > 0) {
      const l = leftAt(b, y);
      out.push([l, l + w]);
    }
  }
  return out;
}

/** The last common split of two strands (the deepest node over both). */
export function commonSplit(a: FanBranch, b: FanBranch): FanNode | null {
  const up = new Set(a.path.map((s) => s.node));
  for (const s of b.path) if (up.has(s.node)) return s.node;
  return null;
}

/**
 * Width units of n individuals: n (linear) or 1 + log10 n (log), which for
 * fewer than one individual (an extinct species' last pinch) falls linearly
 * to 0, so it is continuous.
 */
export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  if (mode === 'linear') return n;
  return n <= 1 ? n : 1 + Math.log10(n);
}

/** Inverse of g: individuals of v width units. */
export function gInv(v: number, mode: WidthMode): number {
  if (!(v > 0)) return 0;
  if (mode === 'linear') return v;
  return v <= 1 ? v : Math.pow(10, v - 1);
}

/** Individuals alive at age `ageMa` in a species (population.ts, from its first appearance): 0 after an extinct one's last. */
export function aliveAt(sp: SpeciesRec, ageMa: number): number {
  return population(sp).aliveAt(ageMa);
}

/**
 * Strand width and green fraction of a branch at age `ageMa`, as drawn: w =
 * the individuals alive then (g() in log widths) times the unit, f = the share
 * of them with living descendants today.
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  void mode;
  const L = laneAt(b, b.steps.time.y(ageMa));
  return { w: L.w, f: L.f };
}

/** Generations a parent column's green recurrence runs before it is taken as settled, at most. */
const MAX_Q_GENS = 5000;

/** A strand's own knots, above its split: heights ascending (tip first), width and green width. */
function ownKnots(b: FanBranch, time: TimeScale, mode: WidthMode): void {
  const P = b.pop;
  const sp = b.sp;
  const ages: number[] = [];
  const ns: number[] = [];
  const qs: number[] = [];
  if (sp.extinct || !(sp.alive > 0)) {
    // Withered all of it; pinching to nobody over the ramp up to its last appearance.
    const rampH = Math.min(RAMP_H, RAMP_FRAC * (b.splitY - b.tipY));
    const tr = time.ageAt(b.tipY + rampH);
    ages.push(sp.t1, tr, b.t0);
    ns.push(0, P.aliveAt(tr), P.founders);
    qs.push(0, 0, 0);
  } else {
    const st = P.steps.ages;
    ages.push(sp.t1);
    ns.push(P.aliveAt(sp.t1));
    qs.push(P.stepAt(sp.t1).q);
    for (let k = 1; k < st.length; k++) {
      const a = st[k] / 1e6;
      if (!Number.isFinite(a) || a <= sp.t1 || a >= b.t0) continue;
      ages.push(a);
      ns.push(P.aliveAt(a));
      // (The share of the generation that ends here: green never dips below a generation's own
      // share inside it, so the living, all green, stay in the green lane.)
      qs.push(P.stepAt(a * (1 - 1e-12)).q);
    }
    ages.push(b.t0);
    ns.push(P.founders);
    qs.push(P.qBase);
  }
  const ys: number[] = [];
  const ws: number[] = [];
  const gs: number[] = [];
  for (let k = 0; k < ages.length; k++) {
    const y = k === 0 ? b.tipY : k === ages.length - 1 ? b.splitY : time.y(ages[k]);
    if (ys.length && !(y > ys[ys.length - 1])) continue;
    const w = b.unit * g(ns[k], mode);
    ys.push(y);
    ws.push(w);
    gs.push(w * qs[k]);
  }
  b.ky = Float64Array.from(ys);
  b.kw = Float64Array.from(ws);
  b.kg = Float64Array.from(gs);
}

/**
 * Height (world) below a split over which its column's green turns from the
 * daughters' own lanes (each strand green on its left, as just above) into
 * the column's one green prefix: the same individuals with living
 * descendants, the total the genealogy's at every height, only laid out
 * differently, so the colours flow through the split instead of cutting.
 */
export function blendH(v: FanNode): number {
  return Math.min(BLEND_H, 0.5 * (v.yBot - v.y));
}

/** Generations below a split where its column's green is sampled (then linear between): 0, 1, 2, 3, 4, 6, 8, 12, ... */
function qGens(len: number): number[] {
  const out = [0];
  for (let k = 1; k < len; k = k < 4 ? k + 1 : Math.round(k * 1.5)) out.push(k);
  if (len > 1) out.push(len);
  return out;
}

export function layoutFan(clade: CladeRec, mode: WidthMode, tree: Split = PANTHERA_TREE): Fan {
  const W = TRUNK_WIDTH;
  const time = new TimeScale(tree.ageMa);
  const yBottom = time.y(STEM_BOTTOM_MA);
  const band = new Band(time, mode, yBottom);
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
      node: v,
      path: [],
      tipY: time.y(sp.t1),
      steps: band,
      ky: new Float64Array(0),
      kw: new Float64Array(0),
      kg: new Float64Array(0),
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
  // Widths: one unit for all (the strands' rooms add up to the trunk's width).
  const gs = branches.map((b) => g(b.pop.max, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const unit = W / sum;
  branches.forEach((b, i) => {
    b.share = gs[i] / sum;
    b.width = b.share * W;
    b.unit = unit;
    b.baseW = unit * g(b.pop.founders, mode);
    ownKnots(b, time, mode);
  });
  // Parent columns, daughters first: the sum of the strands' founders; their green by the genealogy.
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
      b.path.push({ y: v.y, off, node: v });
      off += b.baseW;
    }
  }
  for (const b of branches) b.path.sort((p, q) => p.y - q.y);
  // The knots: every strand's own, the splits, a few generations of each column's green, now and the bottom.
  const ky = new Set<number>([time.y(0), yBottom]);
  for (const b of branches) for (const y of b.ky) ky.add(y);
  for (const v of nodes) {
    ky.add(v.y);
    ky.add(v.y + blendH(v));
    for (const k of qGens(v.q.length)) {
      const y = time.y(v.ageMa + (k * v.genYears) / 1e6);
      if (y > v.y && y < v.yBot) ky.add(y);
    }
  }
  const ys = Float64Array.from([...ky].sort((p, q) => p - q));
  const order = [...branches].sort((p, q) => p.index - q.index);
  const n = order.length;
  const edges = new Float64Array(ys.length * (n + 1));
  const green = new Float64Array(ys.length * n);
  const ws = new Float64Array(n);
  /** Per split: its strands' green just above it, and their gray. */
  const aboveSum = new Map<FanNode, [number, number]>();
  for (let k = 0; k < ys.length; k++) {
    const y = ys[k];
    const age = time.ageAt(y);
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const b = order[i];
      let w = 0;
      let gw = 0;
      if (y < b.tipY) {
        // (Above an extinct species' tip: nobody.)
      } else if (y <= b.splitY) {
        w = lerpAt(b.ky, b.kw, 1, 0, y);
        gw = lerpAt(b.ky, b.kg, 1, 0, y);
      } else {
        // In a parent column: its founders, green as far as the column's green prefix reaches;
        // just below the split, blending from the daughters' own green lanes (blendH).
        const s = segAbove(b, y);
        const v = s.node;
        w = b.baseW;
        const qa = nodeQ(v, Math.min(age, time.ageAt(v.yBot)));
        const pre = clampW(qa * v.width - s.off, b.baseW);
        const u = Math.min(1, (y - v.y) / blendH(v));
        if (u >= 1) gw = pre;
        else {
          // The daughters' lanes as just above the split, holding the column's green total (qa·W): if the
          // genealogy adds green (it climbs back over the first generations), it fills each strand's gray
          // in proportion; if it takes some, each green shrinks in proportion. Never past a strand's width.
          const k0 = seek(ys, v.y) * n;
          let sa = aboveSum.get(v);
          if (!sa) {
            sa = [0, 0];
            for (const s2 of v.strands) {
              sa[0] += green[k0 + s2.index];
              sa[1] += s2.baseW - green[k0 + s2.index];
            }
            aboveSum.set(v, sa);
          }
          const above = green[k0 + i];
          const want = qa * v.width;
          const a = want >= sa[0] ? above + (sa[1] > 0 ? ((b.baseW - above) * (want - sa[0])) / sa[1] : 0) : sa[0] > 0 ? (above * want) / sa[0] : 0;
          gw = (1 - u) * clampW(a, b.baseW) + u * pre;
        }
      }
      ws[i] = w;
      green[k * n + i] = gw;
      tot += w;
    }
    // The band's centre of mass on x = 0.
    let m = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      m += ws[i] * (acc + ws[i] / 2);
      acc += ws[i];
    }
    let x = tot > 0 ? -m / tot : 0;
    const o = k * (n + 1);
    for (let i = 0; i < n; i++) {
      edges[o + i] = x;
      x += ws[i];
    }
    edges[o + n] = x;
  }
  band.ys = ys;
  band.edges = edges;
  band.green = green;
  band.order = order;
  for (const v of nodes) v.left = band.edgeAt(v.strands[0].index, v.y);
  // The branches in the dataset's order (callers index them by species); `index` is the tree's order.
  const rank = new Map(clade.species.map((s, i) => [s, i]));
  branches.sort((p, q) => rank.get(p.sp)! - rank.get(q.sp)!);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let k = 0; k < ys.length; k++) {
    x0 = Math.min(x0, edges[k * (n + 1)]);
    x1 = Math.max(x1, edges[k * (n + 1) + n]);
  }
  const stem: [number, number] = [band.edgeAt(0, yBottom), band.edgeAt(n, yBottom)];
  return {
    clade,
    mode,
    trunkWidth: W,
    trunkBottom: { x: (stem[0] + stem[1]) / 2, y: yBottom },
    branches,
    nodes,
    root,
    time,
    steps: band,
    stem,
    x0,
    x1,
  };
}
