// The Panthera fan as a dated tree of straight lines that lean (Ita's sketch,
// #46 variant d), fixed in world units (y grows downwards, like the screen).
// Nothing here depends on the camera: panning or zooming never changes a shape
// or a width.
//
//     |  |  |        read upwards: the right line is the parent, running
//     \ _|  |        straight on through the split; the daughter peels off
//         \ |        its side and leans out "for a bit" to its own column,
//          \|        then runs straight up.
//
// The tree is splits.ts's: each split is one date where a parent population
// divides into its daughters (a clean split).
//   - Every line is a band whose horizontal width at time t is the individuals
//     alive then: N(t) times one fixed world width per individual (linear) or
//     per decade of individuals (log, g()). A species' band above its split
//     follows its population (population.ts: procgen's ramps, an extinct one's
//     taper to 0); below it the band holds its founders (constant), so a
//     parent band (FanNode) is the sum of its daughters' founders, side by
//     side, and at every split the parent just below is exactly the daughters
//     just above.
//   - At a split one daughter continues straight (FanNode.main: the larger
//     band at the split, so the most ink stays put): its band is its part of
//     the parent's, which keeps running vertically. Each other daughter leaves
//     from its own part of the parent's band, on the side it leans towards,
//     and leans out along a straight diagonal (its edges stay parallel for a
//     node, whose width is constant) until it reaches its own column, then
//     runs straight up. Nothing jumps: every edge is a continuous function of
//     height, straight between its kinks (the splits, the lean ends, the
//     population's knots) except where N itself curves.
//   - A species' own column is anchored at its centre: as N changes the band
//     grows or shrinks about it (the room, b.width, is its widest).
//   - The lean (design calls): it runs LEAN_RISE world heights per world unit
//     sideways, but takes at most LEAN_MAX_FRAC of the height from the split
//     to the next event of either daughter (its next split or its tip), so a
//     lean always ends before anything else starts and leans never meet;
//     where room is short it is flatter (a near-horizontal hop, the sketch's
//     "_|").
//   - The columns: each subtree's extent (the union of everything it ever
//     draws) is worked out bottom-up; a leaning daughter goes just far enough
//     to clear its sibling's whole subtree by a gap (gapBetween). Which side
//     each daughter is on is chosen once, for the whole tree, to make the
//     leans' total sideways run the least (all orders tried; ties keep the
//     table's), so leans are short and, sitting in disjoint extents, never
//     cross.
//
// Inside a band, at every height, the lanes split the individuals alive then
// (population.ts): the green lane on its left edge holds those with living
// descendants today, the gray lane to its right those whose line ended (warm
// gray for an extinct species, all of it). In a parent band the green is the
// genealogy recurrence on the summed population (FanNode.q), drawn as one green
// prefix across its strands. The green share is linear between generations'
// middles: no steps anywhere. Through a split the lanes are continuous too:
// just below it the parent band shows its daughters' lanes side by side (each
// strand green as far as it was just above); over FanNode.blendH (as far down
// as the daughters took to lean out above) each strand's green moves linearly
// to its part of the one prefix, and the band's share from the daughters' to
// the recurrence's with it (which settles within a few generations, far under
// a pixel that deep: drawn as it is it would read as a jump).
//
// Height = time: the oldest split is at y = 0 ("the fork"), "now" at
// y = −TIME_H, on a log years-before-present scale offset by TIME_C (TimeScale).
// The stem (the oldest split's band) runs down to the bottom of the world
// (STEM_BOTTOM_MA).

import type { CladeRec, SpeciesRec } from './panthera';
import { lerpGen, parentShare, population, type Population } from './population';
import { PANTHERA_TREE, type Split } from './splits';

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 110;
/** The bottom of the world: the stem (the clade's ancestors) runs down to here (Ma, ~first life). */
export const STEM_BOTTOM_MA = 4000;
/** The stem fades out from here down to the bottom (Ma). */
export const STEM_FADE_MA = 300;
/** Height = time: the oldest split (the fork) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Gap between a leaning daughter's subtree and its neighbour's: this share of the smaller band ... */
export const GAP_FRAC = 0.3;
/** ... but at least this share of the stem's width. */
export const MIN_GAP_FRAC = 0.025;
/** A lean's slope: world heights per world unit sideways (about 45° on screen at the home view) ... */
export const LEAN_RISE = 3;
/** ... taking at most this share of the height to the next event of either daughter. */
export const LEAN_MAX_FRAC = 0.5;
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

/** Where a strand sits in one ancestral band: from that split's height down (to the next split below). */
export interface PathSeg {
  /** The split's height: the strand is in this band for y ≥ y (down to the band's bottom). */
  y: number;
  /** The strand's offset from the band's left edge. */
  off: number;
  node: FanNode;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index in tree order, left to right as drawn (Fan.branches keeps the dataset's order). */
  index: number;
  /** Width share among the species and its room (world): its widest, at the most alive. */
  share: number;
  width: number;
  /** World width per individual (linear) or per decade of individuals (log). */
  unit: number;
  /** The species' population through time from its start (alive, and the share with living descendants). */
  pop: Population;
  /** The species' start (Ma): its split from its sister in the dated tree, and its height. */
  t0: number;
  splitY: number;
  /** Width below its split (its founders): its strand in the parent bands. */
  baseW: number;
  /** Left edge of its founders' slot at its split (where its own band starts). */
  x0: number;
  /** Centre of its own column (after the lean), and the lean: how far the centre moves sideways (0: it continues straight). */
  cx: number;
  lean: number;
  /** Where the lean ends (world y; its split's if it does not lean). */
  leanY: number;
  /** Left edge of its room (cx − width / 2): where its column sits, at its widest. */
  colLeft: number;
  /** The split it starts at (its parent band). */
  node: FanNode;
  /** Its place in each ancestral band, the parent's first (ascending y, down to the root). */
  path: PathSeg[];
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's kinks, which draw its edges. */
  steps: Steps;
}

/** A split of the dated tree and the parent band below it (the daughters' ancestors). */
export interface FanNode {
  split: Split;
  name: string;
  /** The split's date (Ma) and height: the band's top. */
  ageMa: number;
  y: number;
  /** The band's bottom: the parent's split (the root's: the bottom of the world). */
  yBot: number;
  parent: FanNode | null;
  /** Daughters, left to right as drawn: splits or species' strands. */
  kids: (FanNode | FanBranch)[];
  /** The daughter that continues straight through the split. */
  main: FanNode | FanBranch;
  /** Every strand under it, left to right (the band's order). */
  strands: FanBranch[];
  /** Individuals alive in the band (the sum of its strands' founders) and their mean generation length (years). */
  n: number;
  genYears: number;
  /** World width (the sum of its strands' founders widths). */
  width: number;
  /** Left edge at its bottom (its slot in the parent's band), where its lean ends, and its left edge after it (up to its split). */
  x0: number;
  leanY: number;
  left: number;
  /**
   * Share with living descendants by generation below the split: q[k] at the
   * middle of the generation k below it (ages ageMa + (k + ½)·GL), linear
   * between. The genealogy recurrence on the summed population (population.ts):
   * q[0] = the daughters' shares just above the split weighted by their sizes,
   * q[k+1] = parentShare(q[k], n, n).
   */
  q: Float64Array;
  /** Below the split, the height over which its strands' lanes turn from the daughters' side by side into the one prefix. */
  blendH: number;
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
  /** World x extent of the stem (the root's band). */
  stem: [number, number];
  /** World x extent of everything drawn. */
  x0: number;
  x1: number;
}

export function isNode(k: FanNode | FanBranch): k is FanNode {
  return 'strands' in k;
}

/** A parent band's green share at age `ageMa` (Ma, at or below its split): linear between the generations' middles. */
export function nodeQ(v: FanNode, ageMa: number): number {
  return lerpGen(v.q, ((ageMa - v.ageMa) * 1e6) / v.genYears);
}

/** The band strand b is in at height y ≥ b.splitY: the deepest split at or above y. */
export function segAt(b: FanBranch, y: number): PathSeg {
  const p = b.path;
  let s = p[0];
  for (let k = 1; k < p.length && p[k].y <= y; k++) s = p[k];
  return s;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampW = (v: number, w: number) => Math.min(w, Math.max(0, v));

/** How far along its lean a band is at height y (0 at its bottom, 1 from the lean's end up). */
function leanU(yBot: number, leanY: number, y: number): number {
  return leanY < yBot ? clamp01((yBot - y) / (yBot - leanY)) : 1;
}

/** Left edge of a parent band at height y (its lean near its bottom, then straight). */
export function nodeLeft(v: FanNode, y: number): number {
  return v.x0 + (v.left - v.x0) * leanU(v.yBot, v.leanY, y);
}

/**
 * Where a branch's edges have kinks (their slope changes), fixed in the world:
 * its tip, its population's knots and taper, its lean's end, its split, and
 * the splits and lean ends of the bands it passes below. Between kinks the
 * edges are smooth; the drawing follows them in chords (edgeSamples).
 */
export class Steps {
  /** Per branch: the kinks' world heights, ascending (top down), within its span. */
  private readonly ys = new Map<FanBranch, Float64Array>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly bottom = Infinity,
  ) {}

  /** World heights of branch b's kinks (ascending), from its tip down to the bottom of the world (both excluded). */
  bounds(b: FanBranch): Float64Array {
    let v = this.ys.get(b);
    if (!v) {
      const out = new Set<number>();
      const add = (y: number) => {
        if (y > b.tipY && y < this.bottom) out.add(y);
      };
      for (const a of b.pop.kinks) add(this.time.y(a));
      if (b.leanY < b.splitY) add(b.leanY);
      for (const s of b.path) {
        add(s.y);
        if (s.node.leanY < s.node.yBot) add(s.node.leanY);
        if (s.node.blendH > 0) add(s.y + s.node.blendH);
      }
      v = Float64Array.from([...out].sort((p, q) => p - q));
      this.ys.set(b, v);
    }
    return v;
  }

  /** Width of branch b at world y and of its green lane: [w, gw]. */
  lanesAt(b: FanBranch, y: number): [number, number] {
    if (y < b.tipY) return [0, 0];
    const age = this.time.ageAt(y);
    if (y < b.splitY) {
      const n = b.pop.aliveAt(age);
      const w = n > 0 ? b.unit * g(n, this.mode) : 0;
      return [w, w * b.pop.greenAt(age)];
    }
    // In a parent band: its founders, green as far as the band's green prefix reaches ...
    const s = segAt(b, y);
    const v = s.node;
    const q = nodeQ(v, age);
    const pre = clampW(q * v.width - s.off, b.baseW);
    const beta = v.blendH > 0 ? clamp01((y - v.y) / v.blendH) : 1;
    if (beta >= 1) return [b.baseW, pre];
    // ... from its own lane just above the split, linearly over blendH (the band's share moves
    // from the daughters' to the recurrence's with it: the recurrence settles within a few
    // generations below a split, far under a pixel there, so drawn as it is it would be a jump).
    return [b.baseW, this.sideGreen(b, v) * (1 - beta) + pre * beta];
  }

  private readonly sides = new Map<FanBranch, Map<FanNode, number>>();
  /** Branch b's green lane just above split v (its own column's, or its place in a daughter band's). */
  private sideGreen(b: FanBranch, v: FanNode): number {
    let m = this.sides.get(b);
    if (!m) this.sides.set(b, (m = new Map()));
    let g = m.get(v);
    if (g === undefined) {
      g = this.lanesAt(b, v.y - 1e-9 * Math.max(1, Math.abs(v.y)))[1];
      m.set(v, g);
    }
    return g;
  }

  /** Width of branch b at world y (lanesAt's first). */
  widthAt(b: FanBranch, y: number): number {
    return this.lanesAt(b, y)[0];
  }

  /**
   * World heights of branch b's kinks from y0 down to y1 (y0 < y1),
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

/** Left edge of a branch at world y: its own band above its split (centred on its lean), its place in each parent band below. */
export function leftAt(b: FanBranch, y: number): number {
  if (y < b.splitY) {
    const c = b.x0 + b.baseW / 2 + b.lean * leanU(b.splitY, b.leanY, y);
    return c - b.steps.lanesAt(b, y)[0] / 2;
  }
  const s = segAt(b, y);
  return nodeLeft(s.node, y) + s.off;
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
 * World heights to draw branch b's edges between y0 < y1 as straight chords,
 * ascending: the ends, its kinks between, and wherever a chord would miss the
 * left edge, the width or the green lane by more than `tol` (world x),
 * halving until it does not.
 */
export function edgeSamples(b: FanBranch, y0: number, y1: number, tol: number, maxDepth = 14): number[] {
  const at = (y: number) => {
    const [w, gw] = b.steps.lanesAt(b, y);
    return [leftAt(b, y), w, gw];
  };
  const cuts = [y0, ...(b.steps.lines(b, y0, y1) ?? []), y1];
  const out: number[] = [y0];
  const rec = (ya: number, pa: number[], yb: number, pb: number[], depth: number) => {
    if (depth < maxDepth && yb - ya > 1e-9 * Math.max(1, Math.abs(ya))) {
      for (const f of [0.5, 0.25, 0.75]) {
        const y = ya + (yb - ya) * f;
        const p = at(y);
        if (p.some((v, i) => Math.abs(v - (pa[i] + (pb[i] - pa[i]) * f)) > tol)) {
          const ym = (ya + yb) / 2;
          const pm = at(ym);
          rec(ya, pa, ym, pm, depth + 1);
          rec(ym, pm, yb, pb, depth + 1);
          return;
        }
      }
    }
    out.push(yb);
  };
  for (let k = 0; k + 1 < cuts.length; k++) {
    // (Each side of a kink on its own: a lane may change course there.)
    const ya = cuts[k];
    const yb = cuts[k + 1];
    if (!(yb > ya)) continue;
    rec(ya, at(ya + 1e-9 * Math.max(1, Math.abs(ya))), yb, at(yb - 1e-9 * Math.max(1, Math.abs(yb))), 0);
  }
  return out;
}

/** World x intervals of what is drawn at height y: every band there (merged where they touch). */
export function columnsAt(fan: Fan, y: number): [number, number][] {
  const iv: [number, number][] = [];
  if (y > fan.trunkBottom.y) return iv;
  for (const b of fan.branches) {
    if (y < b.tipY) continue;
    const w = laneAt(b, y).w;
    if (!(w > 0)) continue;
    const l = leftAt(b, y);
    iv.push([l, l + w]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, c] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-9 * Math.max(1, Math.abs(a))) last[1] = Math.max(last[1], c);
    else out.push([a, c]);
  }
  return out;
}

/** Gap (world) between a leaning daughter's subtree and its neighbour's, by their bands' widths at the split. */
export function gapBetween(wa: number, wb: number, stem: number): number {
  return Math.max(GAP_FRAC * Math.min(wa, wb), MIN_GAP_FRAC * stem);
}

/** Width per unit of individuals: n (linear), else 1 + log10 n, continued linearly to 0 below one individual (log). */
export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : n < 1 ? n : 1 + Math.log10(n);
}

/** Individuals alive at age `ageMa` in a species (population.ts, from its first appearance): 0 after an extinct one's last. */
export function aliveAt(sp: SpeciesRec, ageMa: number): number {
  return population(sp).aliveAt(ageMa);
}

/**
 * Strand width and green fraction of a branch at age `ageMa`: w = the
 * individuals alive then (g() in log widths) times the unit, f = the share of
 * them with living descendants today (population.ts).
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const n = b.pop.aliveAt(ageMa);
  const w = n > 0 ? b.unit * g(n, mode) : 0;
  return { w, f: w > 0 ? b.pop.greenAt(ageMa) : 0 };
}

/** Generations a parent band's green recurrence runs before it is taken as settled, at most. */
const MAX_Q_GENS = 5000;

/** A subtree's arrangement for one choice of sides: each daughter's slot and lean, the subtree's extent and the leans' total run. */
interface Plan {
  /** Per daughter (in the drawn order): its offset in the parent's band, its lean (left edge, or centre for a species). */
  order: (FanNode | FanBranch)[];
  off: number[];
  dx: number[];
  /** Extent relative to the band's left edge after its lean (a species: its room's left). */
  a: number;
  b: number;
  cost: number;
}

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
      x0: 0,
      cx: 0,
      lean: 0,
      leanY: v.y,
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
    const yBot = parent ? parent.y : yBottom;
    const v = { split: s, name: s.name, ageMa: s.ageMa, y: time.y(s.ageMa), yBot, parent, kids: [], strands: [], n: 0, genYears: 0, width: 0, x0: 0, leanY: yBot, left: 0, q: new Float64Array([0]), blendH: 0 } as unknown as FanNode;
    nodes.push(v);
    for (const k of s.kids) {
      if (typeof k === 'string') {
        const sp = bySci.get(k);
        if (sp) v.kids.push(strand(sp, v));
      } else {
        const c = build(k, v);
        if (c.kids.length) v.kids.push(c);
      }
    }
    return v;
  };
  const root = build(tree, null);
  // Species the tree does not place (none today): off the stem, at the oldest split.
  for (const sp of clade.species) if (!placed.has(sp.sci)) root.kids.push(strand(sp, root));
  const under = (v: FanNode): FanBranch[] => v.kids.flatMap((k) => (isNode(k) ? under(k) : [k]));
  // Widths: one unit for all (the rooms add up to the trunk's width).
  const gs = branches.map((b) => g(b.pop.max, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const unit = W / sum;
  branches.forEach((b, i) => {
    b.share = gs[i] / sum;
    b.width = b.share * W;
    b.unit = unit;
    b.baseW = unit * g(b.pop.founders, mode);
  });
  // Parent bands, daughters first: the sum of the strands' founders; green by the genealogy.
  const sizes = (v: FanNode): void => {
    for (const k of v.kids) if (isNode(k)) sizes(k);
    let n = 0;
    let gl = 0;
    let w = 0;
    for (const b of under(v)) {
      n += b.pop.founders;
      gl += b.pop.founders * b.sp.genYears;
      w += b.baseW;
    }
    v.n = n;
    v.genYears = n > 0 ? gl / n : 7;
    v.width = w;
    // The daughter that continues straight: the larger band at the split (the first of equals).
    const bandW = (k: FanNode | FanBranch) => (isNode(k) ? k.width : k.baseW);
    v.main = v.kids.reduce((m, k) => (bandW(k) > bandW(m) ? k : m), v.kids[0]);
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
  sizes(root);

  // Arrangement: which side each daughter is on (a flip per split: its daughters reversed), the leans clearing the neighbours' subtrees.
  const flippable = nodes.filter((v) => v.kids.length > 1);
  const roomW = (k: FanNode | FanBranch) => (isNode(k) ? k.width : k.width);
  const bandAt = (k: FanNode | FanBranch) => (isNode(k) ? k.width : k.baseW);
  // A daughter's left edge after its lean, relative to its slot's left, before any lean (a species: its room centred on its slot).
  const nat = (k: FanNode | FanBranch) => (isNode(k) ? 0 : k.baseW / 2 - k.width / 2);
  const plan = (v: FanNode, flip: Set<FanNode>, plans: Map<FanNode, Plan>): Plan => {
    const order = flip.has(v) ? [...v.kids].reverse() : [...v.kids];
    const sub = (k: FanNode | FanBranch): [number, number, number] => {
      if (!isNode(k)) return [0, k.width, 0];
      const p = plan(k, flip, plans);
      return [p.a, p.b, p.cost];
    };
    const off: number[] = [];
    let o = 0;
    for (const k of order) {
      off.push(o);
      o += bandAt(k);
    }
    const ext = order.map(sub);
    const dx = order.map(() => 0);
    const im = order.indexOf(v.main);
    const base = (i: number) => off[i] + nat(order[i]);
    let lo = base(im) + ext[im][0];
    let hi = base(im) + ext[im][1];
    let prev = 0;
    for (let i = im + 1; i < order.length; i++) {
      const gap = gapBetween(roomW(order[i - 1]), roomW(order[i]), W);
      dx[i] = Math.max(prev, hi + gap - (base(i) + ext[i][0]), 0);
      prev = dx[i];
      hi = base(i) + dx[i] + ext[i][1];
    }
    prev = 0;
    for (let i = im - 1; i >= 0; i--) {
      const gap = gapBetween(roomW(order[i + 1]), roomW(order[i]), W);
      dx[i] = Math.min(prev, lo - gap - (base(i) + ext[i][1]), 0);
      prev = dx[i];
      lo = base(i) + dx[i] + ext[i][0];
    }
    const cost = ext.reduce((c, e) => c + e[2], 0) + dx.reduce((c, d) => c + Math.abs(d), 0);
    const p: Plan = { order, off, dx, a: Math.min(lo, 0), b: Math.max(hi, v.width), cost };
    plans.set(v, p);
    return p;
  };
  let best: { cost: number; flips: number; plans: Map<FanNode, Plan> } | null = null;
  for (let mask = 0; mask < 1 << flippable.length; mask++) {
    const flip = new Set(flippable.filter((_, i) => mask & (1 << i)));
    const plans = new Map<FanNode, Plan>();
    const cost = plan(root, flip, plans).cost;
    // (Equal runs within a hair: the fewer flips, the table's order.)
    if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && flip.size < best.flips)) best = { cost, flips: flip.size, plans };
  }
  const plans = best!.plans;
  // Place it: the root's band at 0, then each daughter from its slot (absolute), centred at the end.
  const nextEvent = (k: FanNode | FanBranch) => (isNode(k) ? k.y : k.tipY);
  const place = (v: FanNode): void => {
    const p = plans.get(v)!;
    v.kids = p.order;
    // The leans end before either daughter's next event.
    const room = Math.min(...p.order.map((k) => v.y - nextEvent(k)));
    p.order.forEach((k, i) => {
      const x0 = v.left + p.off[i];
      const d = p.dx[i];
      const leanY = d ? v.y - Math.min(Math.abs(d) * LEAN_RISE, LEAN_MAX_FRAC * room) : v.y;
      if (isNode(k)) {
        k.x0 = x0;
        k.left = x0 + d;
        k.leanY = leanY;
        place(k);
      } else {
        k.x0 = x0;
        k.lean = d;
        k.cx = x0 + k.baseW / 2 + d;
        k.colLeft = k.cx - k.width / 2;
        k.leanY = leanY;
      }
    });
  };
  root.x0 = root.left = 0;
  place(root);
  // The lanes' blend below each split: as far down as its daughters lean out above it (at most half its band).
  for (const v of nodes) v.blendH = Math.min(Math.max(0, ...v.kids.map((k) => v.y - k.leanY)), 0.5 * (v.yBot - v.y));
  const rp = plans.get(root)!;
  const shift = -(rp.a + rp.b) / 2;
  for (const v of nodes) {
    v.x0 += shift;
    v.left += shift;
  }
  for (const b of branches) {
    b.x0 += shift;
    b.cx += shift;
    b.colLeft += shift;
  }
  // Each strand's place in its ancestors' bands: offsets in the band's (drawn) order.
  for (const v of nodes) {
    v.strands = under(v);
    let off = 0;
    for (const b of v.strands) {
      b.path.push({ y: v.y, off, node: v });
      off += b.baseW;
    }
  }
  for (const b of branches) b.path.sort((p, q) => p.y - q.y);
  root.strands.forEach((b, i) => (b.index = i));
  // The branches in the dataset's order (callers index them by species); `index` is the drawn order.
  const rank = new Map(clade.species.map((s, i) => [s, i]));
  branches.sort((p, q) => rank.get(p.sp)! - rank.get(q.sp)!);
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
    x0: rp.a + shift,
    x1: rp.b + shift,
  };
}
