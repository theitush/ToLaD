// The Panthera fan as a dated tree, fixed in world units (y grows downwards,
// like the screen). Nothing here depends on the camera: panning or zooming
// never changes a shape or a width.
//
// Two designs share everything but the edges' geometry (EdgeStyle, the
// viewer's toggle): 'curved', a smooth river (#46 variant C, described just
// below), and 'straight', lines that lean (#46 variant D, Ita's sketch; see
// placeLean). Shared: the population (population.ts: N(t), the green share, the
// extinct taper), the parent columns and their green (FanNode.q), the lanes'
// blend below a split (segGreen), the tessellation (Tess) and the mesh's
// shear (mesh.ts). Per design: where the columns sit (placeRiver, placeLean)
// and how a column moves from its slot in the parent to its own place above a
// split (ease: a smootherstep S-curve, or a straight line).
//
// The tree is splits.ts's: each split is one date where a parent population
// divides into its daughters.
//   - Centres. Each species has a world-fixed centre line (FanBranch.cx), the
//     species in one left-to-right order for both designs (chooseSides),
//     packed as close as their columns allow at every height (Packer: by a gap
//     that is a share of the facing columns' widths there, not of their widest
//     ever, so the columns part as the zoom allows). Its column is symmetric
//     about it: [cx − w/2, cx + w/2], w = the individuals alive then; its
//     room (FanBranch.width, colLeft) is its widest.
//   - Parent columns (FanNode). Below a split its daughters' strands sit side
//     by side, with no gaps, in the parent's column: as wide as the sum of its
//     strands' founders (constant), centred under its daughters' rooms
//     (FanNode.left, cx). It runs down to the parent's own split; the oldest
//     split's (the root: the clade's ancestors, the stem) to the bottom of the
//     world (STEM_BOTTOM_MA).
//   - Forks. At a split the daughters tile the parent column exactly (each
//     strand at its offset, the parent's width = the sum of the daughters'
//     just above). Above it each daughter peels off to its own centre along
//     an S-curve: its centre moves from its tile's centre to its own by
//     smootherstep(u) (6u⁵ − 15u⁴ + 10u³, C2 with zero slope at both ends),
//     u = height above the split ÷ the split's fork span (FanNode.fork:
//     FORK_FRAC of the shortest run of any daughter before its own split or
//     tip, at most FORK_MAX; the height is log time, so the curve is a quintic
//     in log t). All daughters of a split share u, so they part without ever
//     overlapping (each is a convex blend of two non-overlapping placements).
//     A nested parent column rides the same curve; each strand inside it is
//     at its fixed offset from the column's (moving) left edge.
//   - The stem runs straight up into the oldest split and its daughters flow
//     out of it.
//   - Widths are the population's own (population.ts): N(t) log-linear
//     between history points with its corners rounded in N itself, and an
//     extinct species tapering smoothly to nobody at its last appearance. So
//     every edge is a continuous (C1) function of the height: no jog, step or
//     detached block anywhere.
//
// Inside a leaf column, at every height, the lanes split the individuals alive
// then (population.ts): the green lane on its left edge holds those with living
// descendants today, the gray lane to its right those whose line ended (warm
// gray for an extinct species, all of it). In a parent column the green is the
// genealogy recurrence on the summed population (FanNode.q), drawn as one green
// prefix across its strands. Just below a split the parent column is drawn as
// its daughters side by side, each with its own green share as just above
// the split (PathSeg.gAbove), turning into the parent's own prefix deeper
// down by a smootherstep over FanNode.blend: the lanes' boundary is as
// continuous as the edges. The widths stay exact.
//
// Drawing: the edges are exact functions of the height (leftAt, laneAt); the
// view samples them at world-fixed heights (Tess: the features of each strand
// plus a dyadic grid fine enough on screen), so the curves are crisp at every
// zoom and every sample lies on the same curve whatever the zoom.
//
// Height = time: the oldest split is at y = 0 ("the fork"), "now" at
// y = −TIME_H, on a log years-before-present scale offset by TIME_C (TimeScale).
//
// Width = individuals alive at that time (∝ births per unit time): N(t) times
// one fixed world width per individual (linear) or per decade of individuals
// (log, g()). A leaf column's room is its widest N. Below its split a strand
// holds its founders (constant): the parent population is the sum of its
// daughters' founders.

import type { CladeRec, SpeciesRec } from './panthera';
import { parentShare, population, smoother, TIME_C, type Population } from './population';
import { FELIDAE_TREE, type Split } from './splits';

export { TIME_C };

export type WidthMode = 'log' | 'linear';
/** The edges' design: smooth S-curved forks (a river), or straight lines whose daughters lean out. */
export type EdgeStyle = 'curved' | 'straight';

export const TRUNK_WIDTH = 110;
/** The bottom of the world: the stem (the clade's ancestors) runs down to here (Ma, ~first life). */
export const STEM_BOTTOM_MA = 4000;
/** The stem fades out from here down to the bottom (Ma). */
export const STEM_FADE_MA = 300;
/** Height = time: the oldest split (the fork) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Curved: gap between neighbouring columns at a height, this share of the narrower facing one there (Packer) ... */
export const GAP_FRAC = 0.3;
/** ... but at least this share of the stem's width (both designs; a hair: the gap goes by the columns, so they part as the zoom allows). */
export const MIN_GAP_FRAC = 0.001;
/** A split's fork span: this share of the shortest run of its daughters (to their own split or tip) ... */
export const FORK_FRAC = 0.85;
/** ... at most this (world units of height: ~0.4 decades of time). */
export const FORK_MAX = 60;
/** Straight: gap between a leaning daughter's subtree and its neighbour's at a height, this share of the narrower facing column there ... */
export const LEAN_GAP_FRAC = 0.45;
/** ... its slope, world heights per world unit sideways (steeper than 45° on screen at the home view) ... */
export const LEAN_RISE = 2;
/** ... taking at most this share of the height to the next event of either daughter. */
export const LEAN_MAX_FRAC = 0.5;
/* Time axis offset TIME_C (years, population.ts): height is log10(years before present + C). With
 * C = 10 years the axis resolves the last decades and centuries; it is close
 * to the mean lifespan of the living big cats (alive·span/ever ≈ 3–5 years). */

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
  /** The strand's left edge there (at the split), and its offset from the column's left edge (the same all down the column). */
  left: number;
  off: number;
  node: FanNode;
  /** The strand's width here (its founders), and its green just above the split (its own share there). */
  w: number;
  gAbove: number;
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
  /** Left edge of its room, and its centre line (the column is symmetric about it once it has peeled off). */
  colLeft: number;
  cx: number;
  /** Left edge of its founders' slot in the parent column at its split (where it peels off from), and where its peel ends (world y; its split's if it does not move). */
  x0: number;
  leanY: number;
  /** The split it starts at (its parent column). */
  node: FanNode;
  /** Its place in each ancestral column, the parent's first (ascending y, down to the root). */
  path: PathSeg[];
  /** The tip (last appearance) height. */
  tipY: number;
  /** The fan's tessellation, which samples its edges. */
  tess: Tess;
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
  /** World width (the sum of its strands' founders widths); its left edge and centre once it has peeled off its parent. */
  width: number;
  left: number;
  cx: number;
  /** Its left edge where it starts: its tile in the parent column at the parent's split (the root: left). */
  tile: number;
  /** Where its peel from the tile to its own place ends (world y, above yBot; yBot if it does not move), and the edges' design. */
  leanY: number;
  edge: EdgeStyle;
  /** Height below the split over which its strands' green turns from the daughters' own shares into its prefix. */
  blend: number;
  /**
   * Share with living descendants by generation below the split: q[k] at the
   * middle of generation k below it (ages ageMa + (k + ½)·GL), linear in
   * between, the last one running on down the column. The genealogy
   * recurrence on the summed population (population.ts): q[0] = the
   * daughters' shares just above the split weighted by their sizes,
   * q[k+1] = parentShare(q[k], n, n).
   */
  q: Float64Array;
}

export interface Fan {
  clade: CladeRec;
  mode: WidthMode;
  edge: EdgeStyle;
  trunkWidth: number;
  trunkBottom: Pt;
  /** One per species, in the dataset's order (clade.species). */
  branches: FanBranch[];
  /** The splits, parents before daughters; root = the oldest (the stem below it). */
  nodes: FanNode[];
  root: FanNode;
  time: TimeScale;
  tess: Tess;
  /** World x extent of the stem (the root's column). */
  stem: [number, number];
  /** World x extent of all the columns. */
  x0: number;
  x1: number;
}

export function isNode(k: FanNode | FanBranch): k is FanNode {
  return 'strands' in k;
}

/** A parent column's green share at age `ageMa` (Ma, at or below its split): q at generation middles, linear in between. */
export function nodeQ(v: FanNode, ageMa: number): number {
  const x = Math.max(0, ((ageMa - v.ageMa) * 1e6) / v.genYears - 0.5);
  const k = Math.floor(x);
  if (k + 1 >= v.q.length) return v.q[v.q.length - 1];
  return v.q[k] + (v.q[k + 1] - v.q[k]) * (x - k);
}

/** The column strand b is in at height y ≥ b.splitY: the deepest split at or above y. */
export function segAt(b: FanBranch, y: number): PathSeg {
  const p = b.path;
  let s = p[0];
  for (let k = 1; k < p.length && p[k].y <= y; k++) s = p[k];
  return s;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The one per-design curve: a column's move from its slot (u = 0) to its own place (u = 1). Curved: smootherstep (C2, flat at both ends); straight: a line. */
export function ease(edge: EdgeStyle, u: number): number {
  return edge === 'curved' ? smoother(u) : clamp01(u);
}

/** How far a column has moved at height y: 0 at its bottom (yBot), 1 from its peel's end (leanY) up. */
export function peelU(edge: EdgeStyle, yBot: number, leanY: number, y: number): number {
  return leanY < yBot ? ease(edge, (yBot - y) / (yBot - leanY)) : 1;
}

/** A parent column's left edge at height y (in its span): from its tile in the parent to its own left (peelU). */
export function nodeLeftAt(v: FanNode, y: number): number {
  return v.tile + (v.left - v.tile) * peelU(v.edge, v.yBot, v.leanY, y);
}

const clampW = (v: number, w: number) => Math.min(w, Math.max(0, v));

/**
 * Branch b's width and green lane's width at world y: [w, gw], exact. Above
 * its split: the individuals alive then (population.ts, smooth) times the
 * unit, green by its share; in a parent column: its founders, green as far as
 * the column's green prefix reaches.
 */
export function lanesAt(b: FanBranch, y: number, mode: WidthMode = b.tess.mode): [number, number] {
  if (y < b.tipY) return [0, 0];
  const age = b.tess.time.ageAt(y);
  if (y < b.splitY) {
    const n = b.pop.aliveAt(age);
    const w = n > 0 ? b.unit * g(n, mode) : 0;
    return [w, w * b.pop.greenAt(age)];
  }
  const s = segAt(b, y);
  return [b.baseW, segGreen(s, age, y)];
}

/** A strand's green in a parent column at height y: from its own share at the split into the column's prefix (see FanNode.blend). */
function segGreen(s: PathSeg, age: number, y: number): number {
  const gw = clampW(nodeQ(s.node, age) * s.node.width - s.off, s.w);
  const u = s.node.blend > 0 ? smoother((y - s.node.y) / s.node.blend) : 1;
  return u >= 1 ? gw : s.gAbove + (gw - s.gAbove) * u;
}

/**
 * Where a strand's shape is sampled, fixed in the world and never depending
 * on the camera: its features (Tess.bounds: the splits it passes, the fork
 * spans it peels through, its population's history points, rounded corners,
 * log-linear stretches, green-share changes and taper, its tip and the
 * bottom of the world), and between them a dyadic grid of heights (spacing
 * 2^-k world units, the same points at every zoom that uses that k) fine
 * enough that no chord is more than a few pixels on screen (Tess.cuts). The
 * edges themselves are exact functions (leftAt, laneAt): every sample lies on
 * the same curve at every zoom.
 */
export class Tess {
  private readonly ys = new Map<FanBranch, Float64Array>();

  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly bottom = Infinity,
    readonly edge: EdgeStyle = 'curved',
  ) {}

  /** World heights of branch b's features, ascending, from its tip down to the bottom of the world. */
  bounds(b: FanBranch): Float64Array {
    let v = this.ys.get(b);
    if (v) return v;
    const out: number[] = [b.tipY];
    const add = (y: number) => {
      if (y >= b.tipY && y <= this.bottom) out.push(y);
    };
    // A peel: its ends (a straight one's kinks) and samples along it (a curved one's S).
    const peel = (yBot: number, leanY: number) => {
      if (leanY < yBot) for (let i = 0; i <= 48; i++) add(yBot - ((yBot - leanY) * i) / 48);
    };
    // Its own peel, and each ancestral column's (where its column peels off the one below).
    peel(b.splitY, b.leanY);
    for (const s of b.path) {
      add(s.y);
      if (s.node.parent) peel(s.node.yBot, s.node.leanY);
      // Where the column's green share still moves (its first generations below the split).
      const q = s.node.q;
      const n = Math.min(q.length, 64);
      for (let k = 0; k < n; k++) add(this.time.y(s.node.ageMa + ((k + 0.5) * s.node.genYears) / 1e6));
    }
    for (const a of b.pop.features()) {
      const y = this.time.y(a / 1e6);
      if (y < b.splitY) add(y);
    }
    add(this.bottom);
    out.sort((p, q) => p - q);
    const u: number[] = [];
    for (const y of out) if (!u.length || y - u[u.length - 1] > 1e-9) u.push(y);
    v = Float64Array.from(u);
    this.ys.set(b, v);
    return v;
  }

  /**
   * World x that branch b's strand stays within between heights y0 < y1
   * (for culling: conservative, not tight). Its own column: about its centre
   * (which moves monotonically along its peel), at most its widest ever
   * (Population.max); each parent column's slice: its place at both ends of
   * the stretch (nodeLeftAt is monotonic too).
   */
  xRange(b: FanBranch, y0: number, y1: number): [number, number] {
    const lo = Math.max(y0, b.tipY);
    const hi = Math.min(y1, this.bottom);
    let L = Infinity;
    let R = -Infinity;
    if (!(hi >= lo)) return [L, R];
    if (lo < b.splitY) {
      const tc = b.x0 + b.baseW / 2;
      const c = (y: number) => tc + (b.cx - tc) * peelU(this.edge, b.splitY, b.leanY, y);
      const ca = c(lo);
      const cb = c(Math.min(hi, b.splitY));
      const hw = (b.unit * g(b.pop.max, this.mode)) / 2;
      L = Math.min(ca, cb) - hw;
      R = Math.max(ca, cb) + hw;
    }
    const p = b.path;
    for (let k = 0; k < p.length; k++) {
      const a = Math.max(lo, p[k].y);
      const z = Math.min(hi, k + 1 < p.length ? p[k + 1].y : this.bottom);
      if (!(z >= a)) continue;
      for (const y of [a, z]) {
        const x = nodeLeftAt(p[k].node, y) + p[k].off;
        L = Math.min(L, x);
        R = Math.max(R, x + b.baseW);
      }
    }
    // (A hair of slack for rounding.)
    const pad = 1e-6 * Math.max(1, Math.abs(L), Math.abs(R)) + (R - L) * 1e-3;
    return [L - pad, R + pad];
  }

  private readonly splits = new Map<FanBranch, Set<number>>();
  /** The heights of the splits branch b passes (a cut always falls on each). */
  private splitYs(b: FanBranch): Set<number> {
    let v = this.splits.get(b);
    if (!v) this.splits.set(b, (v = new Set(b.path.map((s) => s.y))));
    return v;
  }

  /**
   * The heights to draw branch b at between y0 < y1 (world), ascending,
   * y0 and y1 included: its features there (thinned to a few per px) and
   * the dyadic grid at the finest spacing over `maxPx` screen px (sy: px per
   * world unit of height).
   */
  cuts(b: FanBranch, y0: number, y1: number, sy: number, maxPx = 6): number[] {
    const lo = Math.max(y0, b.tipY);
    const hi = Math.min(y1, this.bottom);
    if (!(hi > lo)) return [];
    const f = this.bounds(b);
    const feat: number[] = [];
    // Features (bisect to the first above lo).
    let a = 0;
    let z = f.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (f[m] <= lo) a = m + 1;
      else z = m;
    }
    // Features closer on screen than a quarter of maxPx are thinned (a history can hold thousands, most
    // sub-pixel when zoomed out): at most one per cell of a dyadic grid that fine, so the same ones at
    // every pan; the splits (the green lane steps there) are always kept.
    const cell = Math.pow(2, Math.floor(Math.log2(Math.max(1e-12, maxPx / 4 / Math.max(1e-12, sy)))));
    const keep = this.splitYs(b);
    let last = NaN;
    for (let k = a; k < f.length && f[k] < hi; k++) {
      const c = Math.floor(f[k] / cell);
      if (c === last && !keep.has(f[k])) continue;
      last = c;
      feat.push(f[k]);
    }
    // The grid, merged with the features (both ascending) and deduplicated.
    const step = Math.pow(2, Math.floor(Math.log2(Math.max(1e-9, maxPx / Math.max(1e-12, sy)))));
    const u: number[] = [lo];
    const put = (y: number) => {
      if (y - u[u.length - 1] > 1e-9 * Math.max(1, Math.abs(y))) u.push(y);
    };
    let j = 0;
    if ((hi - lo) / step < 20000)
      for (let y = Math.floor(lo / step + 1) * step; y < hi; y += step) {
        while (j < feat.length && feat[j] <= y) put(feat[j++]);
        put(y);
      }
    while (j < feat.length) put(feat[j++]);
    put(hi);
    if (u[u.length - 1] < hi) u.push(hi);
    return u;
  }
}

/** Left edge of a branch at world y: its own column (about its centre, peeling off its parent) above its split, then its place in each parent column below. (w: its width there, if known: lanesAt(b, y)[0].) */
export function leftAt(b: FanBranch, y: number, w?: number): number {
  if (y < b.splitY) {
    const tc = b.x0 + b.baseW / 2;
    const c = tc + (b.cx - tc) * peelU(b.tess.edge, b.splitY, b.leanY, y);
    return c - (w ?? lanesAt(b, y)[0]) / 2;
  }
  const s = segAt(b, y);
  return nodeLeftAt(s.node, y) + s.off;
}

/**
 * A branch's lanes at world y, as drawn: total width w (the individuals alive
 * then), the green lane's width gw (those with living descendants today) and
 * its fraction f.
 */
export function laneAt(b: FanBranch, y: number): { w: number; gw: number; f: number } {
  const [w, gw] = lanesAt(b, y);
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
    const l = leftAt(b, y);
    out.push([l, l + laneAt(b, y).w]);
  }
  for (const v of fan.nodes) {
    if (!(y >= v.y && (y < v.yBot || (!v.parent && y <= v.yBot)))) continue;
    const l = nodeLeftAt(v, y);
    out.push([l, l + v.width]);
  }
  return out;
}

/** Packing (both designs): the heights from now (−TIME_H) down to the oldest split (0), in this many cells. */
const CELLS = 1024;
const CELL_H = TIME_H / CELLS;

/**
 * A subtree's outline, cell by cell of height: its leftmost and rightmost
 * edge there (L, R; empty: +∞, −∞) and the widths of the columns on those
 * edges (lw, rw; the gap goes by them).
 */
interface Contour {
  L: Float64Array;
  R: Float64Array;
  lw: Float64Array;
  rw: Float64Array;
}

/**
 * Packs subtrees side by side as close as their columns allow at every height
 * (no wider than they are there, not their widest ever): the least shift that
 * keeps one subtree's outline clear of another's by the gap at every height
 * both have columns. Fixed in the world: it depends only on the tree and the
 * widths, never on the camera.
 */
class Packer {
  private readonly leaves = new Map<FanBranch, Contour>();
  constructor(
    readonly time: TimeScale,
    readonly mode: WidthMode,
    readonly W: number,
  ) {}
  private empty(): Contour {
    return { L: new Float64Array(CELLS).fill(Infinity), R: new Float64Array(CELLS).fill(-Infinity), lw: new Float64Array(CELLS), rw: new Float64Array(CELLS) };
  }
  /** The cells over heights [y0, y1] (y0 above), clipped to the grid. */
  private cells(y0: number, y1: number): [number, number] {
    return [Math.max(0, Math.floor((y0 + TIME_H) / CELL_H)), Math.min(CELLS - 1, Math.floor((y1 + TIME_H) / CELL_H))];
  }
  /** A species' column about its centre line at 0, from its tip down to its split: its widest in each cell. */
  leaf(b: FanBranch): Contour {
    let c = this.leaves.get(b);
    if (c) return c;
    c = this.empty();
    const [j0, j1] = this.cells(b.tipY, b.splitY);
    for (let j = j0; j <= j1; j++) {
      const a = Math.max(b.tipY, -TIME_H + j * CELL_H);
      const z = Math.min(b.splitY, -TIME_H + (j + 1) * CELL_H);
      let w = 0;
      for (let k = 0; k <= 6; k++) {
        const n = b.pop.aliveAt(this.time.ageAt(a + ((z - a) * k) / 6));
        if (n > 0) w = Math.max(w, b.unit * g(n, this.mode));
      }
      c.L[j] = -w / 2;
      c.R[j] = w / 2;
      c.lw[j] = c.rw[j] = w;
    }
    this.leaves.set(b, c);
    return c;
  }
  shift(c: Contour, dx: number): Contour {
    const L = new Float64Array(CELLS);
    const R = new Float64Array(CELLS);
    for (let j = 0; j < CELLS; j++) {
      L[j] = c.L[j] + dx;
      R[j] = c.R[j] + dx;
    }
    return { L, R, lw: c.lw.slice(), rw: c.rw.slice() };
  }
  copy(c: Contour): Contour {
    return { L: c.L.slice(), R: c.R.slice(), lw: c.lw.slice(), rw: c.rw.slice() };
  }
  /** Adds c, shifted by a then b, into `into` (the outline of both). (The shifts in place, no copy: shift(shift(c, a), b), to the bit.) */
  union(into: Contour, c: Contour, a = 0, b = 0): void {
    for (let j = 0; j < CELLS; j++) {
      const l = c.L[j] + a + b;
      const r = c.R[j] + a + b;
      if (l < into.L[j]) {
        into.L[j] = l;
        into.lw[j] = c.lw[j];
      }
      if (r > into.R[j]) {
        into.R[j] = r;
        into.rw[j] = c.rw[j];
      }
    }
  }
  /** Adds a band [x0, x1] over heights [y0, y1] (each cell's outline spans to cover it), its facing columns w wide. */
  bar(into: Contour, x0: number, x1: number, y0: number, y1: number, w = x1 - x0): void {
    const [j0, j1] = this.cells(y0, y1);
    for (let j = j0; j <= j1; j++) {
      if (x0 < into.L[j]) {
        into.L[j] = x0;
        into.lw[j] = w;
      }
      if (x1 > into.R[j]) {
        into.R[j] = x1;
        into.rw[j] = w;
      }
    }
  }
  /** Gap (world) between two facing columns of widths wa and wb: `frac` of the narrower, at least MIN_GAP_FRAC of the stem. */
  gap(frac: number, wa: number, wb: number): number {
    return Math.max(frac * Math.min(wa, wb), MIN_GAP_FRAC * this.W);
  }
  /** The least shift that puts c (shifted by a) to the right of `acc` by the gap wherever both have columns (−∞: nowhere). */
  right(acc: Contour, c: Contour, frac: number, a = 0): number {
    let d = -Infinity;
    for (let j = 0; j < CELLS; j++) if (acc.R[j] > -Infinity && c.L[j] < Infinity) d = Math.max(d, acc.R[j] + this.gap(frac, acc.rw[j], c.lw[j]) - (c.L[j] + a));
    return d;
  }
  /** The least shift (most negative) that puts c (shifted by a) to the left of `acc` by the gap (+∞: nowhere). */
  left(acc: Contour, c: Contour, frac: number, a = 0): number {
    let d = Infinity;
    for (let j = 0; j < CELLS; j++) if (acc.L[j] < Infinity && c.R[j] > -Infinity) d = Math.min(d, acc.L[j] - this.gap(frac, acc.lw[j], c.rw[j]) - (c.R[j] + a));
    return d;
  }
  /** Whether a lies inside b at every height (never makes a neighbour move further). */
  inside(a: Contour, b: Contour): boolean {
    for (let j = 0; j < CELLS; j++) if (a.L[j] < b.L[j] - 1e-12 || a.R[j] > b.R[j] + 1e-12) return false;
    return true;
  }
  extent(c: Contour): [number, number] {
    let a = Infinity;
    let b = -Infinity;
    for (let j = 0; j < CELLS; j++) {
      a = Math.min(a, c.L[j]);
      b = Math.max(b, c.R[j]);
    }
    return [a, b];
  }
}

export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  // (Log: below one individual the width goes on down to 0 with n, so a taper closes.)
  return mode === 'linear' ? n : n < 1 ? n : 1 + Math.log10(n);
}

/** Individuals alive at age `ageMa` in a species (population.ts, from its first appearance): 0 after an extinct one's last. */
export function aliveAt(sp: SpeciesRec, ageMa: number): number {
  return population(sp).aliveAt(ageMa);
}

/**
 * Exact strand width and green fraction of a branch at age `ageMa` (its own
 * population): w = the individuals alive then (g() in log widths) times the
 * unit, f = the share of them with living descendants today (population.ts).
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const n = b.pop.aliveAt(ageMa);
  const w = n > 0 ? b.unit * g(n, mode) : 0;
  return { w, f: w > 0 ? b.pop.greenAt(ageMa) : 0 };
}

/** Generations a parent column's green recurrence runs before it is taken as settled, at most. */
const MAX_Q_GENS = 5000;

type Kid = FanNode | FanBranch;
const under = (v: FanNode): FanBranch[] => v.kids.flatMap((k) => (isNode(k) ? under(k) : [k]));

/**
 * A daughter that grows out of nobody at its split (a domestic stock,
 * population.ts emergeAges): the longest fork (or lean) span over which its
 * move off its slot (ease) stays ahead of its width's share of its reach at
 * every height of its ramp, else Infinity. `reach`: twice the room it moves
 * into (how much further its centre ends from its neighbour's than it
 * starts). Its sibling's column stays where its founders were while the
 * stock moves out of the way at least as fast as it grows, so it never spills
 * into its sibling's column. (The log widths jump to one unit at the first
 * individual: the ramp in N alone is not enough.)
 */
function emergeRun(k: Kid, time: TimeScale, mode: WidthMode, edge: EdgeStyle, reach: number): number {
  const e = isNode(k) ? null : k.pop.emergeAges();
  if (isNode(k) || !e || !(k.width > 0)) return Infinity;
  if (!(reach > 0)) return 0;
  const E = Math.abs(time.y(e[1]) - time.y(e[0]));
  const xs = Array.from({ length: 96 }, (_, i) => (E * (i + 1)) / 96);
  const share = xs.map((x) => (k.unit * g(k.pop.aliveAt(time.ageAt(k.splitY - x)), mode)) / reach);
  const ok = (F: number) => xs.every((x, i) => ease(edge, x / F) >= share[i]);
  if (ok(E)) return E;
  let lo = 0;
  let hi = E;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function layoutFan(clade: CladeRec, mode: WidthMode, tree: Split = FELIDAE_TREE, edge: EdgeStyle = 'curved'): Fan {
  const W = TRUNK_WIDTH;
  const time = new TimeScale(tree.ageMa);
  const yBottom = time.y(STEM_BOTTOM_MA);
  const tess = new Tess(time, mode, yBottom, edge);
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
      cx: 0,
      x0: 0,
      leanY: v.y,
      node: v,
      path: [],
      tipY: time.y(sp.t1),
      tess,
    };
    branches.push(b);
    return b;
  };
  const build = (s: Split, parent: FanNode | null): FanNode => {
    const yBot = parent ? parent.y : yBottom;
    const v: FanNode = { split: s, name: s.name, ageMa: s.ageMa, y: time.y(s.ageMa), yBot, parent, kids: [], strands: [], n: 0, genYears: 0, width: 0, left: 0, cx: 0, tile: 0, leanY: yBot, edge, blend: 0, q: new Float64Array([0]) };
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
  // Parent columns, daughters first: the sum of the strands' founders; green by the genealogy.
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
    // Green: the daughters' shares just above the split, by their sizes; then the genealogy back, generation by generation.
    let qn = 0;
    for (const k of v.kids) {
      if (isNode(k)) qn += nodeQ(k, v.ageMa) * k.n;
      else qn += k.pop.greenAt(Math.max(k.sp.t1, k.t0 - 1e-9)) * k.pop.founders;
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
  // Where everything sits (per design): each node's left and peel end, each leaf's centre and peel end, the lanes' blend.
  // One left-to-right order for both designs (chooseSides), then where everything sits per design.
  let byTree = SIDES.get(clade);
  if (!byTree) SIDES.set(clade, (byTree = new Map()));
  let byMode = byTree.get(tree);
  if (!byMode) byTree.set(tree, (byMode = new Map()));
  const P = new Packer(time, mode, W);
  const { plans, sides } = chooseSides(root, P, byMode.get(mode));
  byMode.set(mode, sides);
  if (edge === 'curved') placeRiver(root, P, time, mode);
  else placeLean(root, nodes, plans, time, mode);
  // Each strand's place in its ancestors' columns (offsets in the column's order), each column's tile in its parent, each leaf's slot.
  for (const v of nodes) v.strands = under(v);
  for (const v of nodes) {
    let off = 0;
    for (const k of v.kids) {
      if (isNode(k)) k.tile = v.left + off;
      else k.x0 = v.left + off;
      for (const b of isNode(k) ? k.strands : [k]) {
        b.path.push({ y: v.y, left: v.left + off, off, node: v, w: b.baseW, gAbove: 0 });
        off += b.baseW;
      }
    }
  }
  root.tile = root.left;
  root.leanY = root.yBot;
  root.strands.forEach((b, i) => (b.index = i));
  for (const b of branches) {
    b.path.sort((p, q) => p.y - q.y);
    // Each strand's green just above each split it passes: its own share (the species'), or its place in the daughter column's prefix.
    b.path.forEach((s, k) => {
      if (k === 0) s.gAbove = b.baseW * b.pop.greenAt(Math.max(b.sp.t1, b.t0 - 1e-9));
      else {
        const d = b.path[k - 1];
        s.gAbove = segGreen(d, s.node.ageMa, s.node.y);
      }
    });
  }
  // The branches in the dataset's order (callers index them by species); `index` is the drawn order.
  const rank = new Map(clade.species.map((s, i) => [s, i]));
  branches.sort((p, q) => rank.get(p.sp)! - rank.get(q.sp)!);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of branches) {
    x0 = Math.min(x0, b.colLeft);
    x1 = Math.max(x1, b.colLeft + b.width);
  }
  for (const v of nodes) {
    x0 = Math.min(x0, v.left, v.tile);
    x1 = Math.max(x1, v.left + v.width, v.tile + v.width);
  }
  return {
    clade,
    mode,
    edge,
    trunkWidth: W,
    trunkBottom: { x: root.left + root.width / 2, y: yBottom },
    branches,
    nodes,
    root,
    time,
    tess,
    stem: [root.left, root.left + root.width],
    x0,
    x1,
  };
}

/**
 * Curved (the river): bottom up, each split's daughters side by side in the
 * shared order (chooseSides), each as close to the ones before it as their
 * columns allow at every height (Packer: by the gap, GAP_FRAC of the narrower
 * facing column there, at least MIN_GAP_FRAC of the stem's), so the columns
 * stand apart by what they are at each height, not by their widest ever. Each
 * parent column sits where its daughters' peels are the shortest (the middle
 * of the least and the most any daughter moves off its slot); all the
 * daughters of a split peel off together over its fork span (FORK_FRAC of
 * their shortest run, at most FORK_MAX); the lanes blend below a split over at
 * most FORK_MAX. A subtree's outline covers its columns' places above its
 * fork and the hull of its column and its daughters' over the fork (every
 * column there is a blend of its slot and its place), so nothing ever meets.
 */
function placeRiver(root: FanNode, P: Packer, time: TimeScale, mode: WidthMode): void {
  const pack = (v: FanNode): Contour => {
    let acc: Contour | null = null;
    for (const k of v.kids) {
      let c: Contour;
      if (isNode(k)) c = pack(k);
      else {
        k.cx = 0;
        k.colLeft = -k.width / 2;
        c = P.leaf(k);
      }
      if (!acc) acc = P.copy(c);
      else {
        const dx = P.right(acc, c, GAP_FRAC);
        move(k, dx);
        P.union(acc, c, dx);
      }
    }
    // Its column: where the farthest peels left and right are equal.
    let o = 0;
    let d0 = Infinity;
    let d1 = -Infinity;
    for (const k of v.kids) {
      const d = (isNode(k) ? k.left : k.cx - k.baseW / 2) - o;
      d0 = Math.min(d0, d);
      d1 = Math.max(d1, d);
      o += bandW(k);
    }
    const [e0, e1] = span(v);
    v.left = Math.min(e1 - v.width, Math.max(e0, (d0 + d1) / 2));
    v.cx = v.left + v.width / 2;
    // The fork span: a share of the shortest run of a daughter before it splits again or ends; slower for one that grows out of nobody.
    let run = Infinity;
    for (const k of v.kids) run = Math.min(run, v.y - (isNode(k) ? k.y : k.tipY));
    const emerge = v.kids.map((k, i) => {
      // Its reach: twice the least room it moves into from either neighbour (centres ending further apart than they start).
      let r = Infinity;
      for (const n of [v.kids[i - 1], v.kids[i + 1]]) if (n) r = Math.min(r, 2 * (Math.abs(n.cx - k.cx) - (bandW(n) + bandW(k)) / 2));
      return emergeRun(k, time, mode, 'curved', r);
    });
    const fork = Math.max(0, Math.min(FORK_MAX, FORK_FRAC * run, ...emerge));
    for (const k of v.kids) k.leanY = v.y - fork;
    v.blend = Math.max(0, Math.min(FORK_MAX, 0.45 * (v.yBot - v.y)));
    // Its outline: the daughters', and over its fork and down to its parent's split the whole band its column may take (boundPeels).
    const out = acc!;
    P.bar(out, e0, e1, v.y - fork, v.yBot, v.width);
    return out;
  };
  const [a, b] = P.extent(pack(root));
  move(root, -(a + b) / 2);
  boundPeels(root);
}

/** Where a parent column may sit: between its outermost daughters' places (a species': its founders' width about its centre line; a split's: its own span). */
function span(k: Kid): [number, number] {
  if (!isNode(k)) return [k.cx - k.baseW / 2, k.cx + k.baseW / 2];
  let a = Infinity;
  let b = -Infinity;
  for (const c of k.kids) {
    const [p, q] = span(c);
    a = Math.min(a, p);
    b = Math.max(b, q);
  }
  return [a, b];
}

/** A daughter's band in its parent column (a split's: its column; a species': its founders). */
const bandW = (k: Kid) => (isNode(k) ? k.width : k.baseW);

/** Curved: the steepest a peeling edge may run (world units sideways per height), where the tree allows. */
export const PEEL_SLOPE = 8;

/**
 * Curved, where two splits come close in time (Felinae's 10.65 and 10.32 Ma):
 * where its daughters' peels are the shortest, a parent's daughters would
 * have to fly apart over the short fork before the next split. But a parent
 * column may sit anywhere between its outermost daughters (span: the packing
 * keeps that whole band clear, so nothing can meet): this moves each one off
 * its place, as little as needed,
 * so that every peel's edge runs at most PEEL_SLOPE (the smootherstep's
 * steepest is 1.875 times its mean) — or, if the tree cannot, at the least
 * slope it can. The species stay where they are.
 */
function boundPeels(root: FanNode): void {
  type Iv = [number, number];
  const ext = new Map<FanNode, Iv>();
  const fill = (v: FanNode): void => {
    for (const k of v.kids) if (isNode(k)) fill(k);
    ext.set(v, span(v));
  };
  fill(root);
  const offs = (v: FanNode) => {
    let o = 0;
    return v.kids.map((k) => ((o += isNode(k) ? k.width : k.baseW), o - (isNode(k) ? k.width : k.baseW)));
  };
  const fork = (v: FanNode) => v.y - v.kids[0].leanY;
  // Where each column's left may be with every peel below it at most `s` steep (empty: lo > hi).
  const feasible = (s: number) => {
    const iv = new Map<FanNode, Iv>();
    const go = (v: FanNode): Iv => {
      const m = (s * fork(v)) / 1.875;
      const [e0, e1] = ext.get(v)!;
      let lo = e0;
      let hi = e1 - v.width;
      const off = offs(v);
      v.kids.forEach((k, i) => {
        const [a, b] = isNode(k) ? go(k) : [k.cx - k.baseW / 2, k.cx - k.baseW / 2];
        lo = Math.max(lo, a - off[i] - m);
        hi = Math.min(hi, b - off[i] + m);
      });
      iv.set(v, [lo, hi]);
      return [lo, hi];
    };
    const r = go(root);
    return { iv, ok: [...iv.values()].every(([a, b]) => a <= b + 1e-9) && r[0] <= r[1] + 1e-9 };
  };
  let slope = PEEL_SLOPE;
  let f = feasible(slope);
  if (!f.ok) {
    let lo = PEEL_SLOPE;
    let hi = PEEL_SLOPE * 2;
    while (!feasible(hi).ok && hi < 1e6) hi *= 2;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid).ok) hi = mid;
      else lo = mid;
    }
    slope = hi;
    f = feasible(slope);
    if (!f.ok) return;
  }
  const clamp = (x: number, [a, b]: Iv) => Math.min(b, Math.max(a, x));
  // Top down: each column as near its centred place as its own peel and its daughters' allow.
  const set = (v: FanNode, at: Iv): void => {
    v.left = clamp(v.left, at);
    v.cx = v.left + v.width / 2;
    const off = offs(v);
    v.kids.forEach((k, i) => {
      if (!isNode(k)) return;
      const mk = (slope * fork(v)) / 1.875;
      const [a, b] = f.iv.get(k)!;
      set(k, [Math.max(a, v.left + off[i] - mk), Math.min(b, v.left + off[i] + mk)]);
    });
  };
  set(root, f.iv.get(root)!);
}

/** Moves a subtree sideways, whole. */
function move(k: Kid, dx: number): void {
  if (isNode(k)) {
    k.left += dx;
    k.cx += dx;
    for (const c of k.kids) move(c, dx);
  } else {
    k.cx += dx;
    k.colLeft += dx;
  }
}

/** One choice of sides for a subtree (each daughter's slot and straight-design lean, its extent, the leans' total run). */
interface Plan {
  order: Kid[];
  off: number[];
  dx: number[];
  /** Extent relative to the band's left edge after its lean, and its outline. */
  a: number;
  b: number;
  out: Contour;
  cost: number;
}

/** A candidate for a subtree's sides: its plan, how many splits it mirrors, and the daughters' own candidates (table order). */
interface Cand extends Plan {
  flip: boolean;
  flips: number;
  kids: (Cand | null)[];
}

/**
 * Most candidates kept per subtree, the least-run ones (Panthera's subtrees
 * never come near it; on a random 40-species tree it finds the same least run
 * as 256, in a fraction of the time).
 */
const MAX_CANDS = 16;

/** The sides chosen (mirrored or not, per split) per clade, tree and width mode: the toggle reuses them, no search. */
const SIDES = new WeakMap<CladeRec, Map<Split, Map<WidthMode, Map<Split, boolean>>>>();

/**
 * The species' left-to-right order, the same in both designs (the toggle only
 * reshapes the edges): each split's daughters on the sides that make the
 * straight design's leans (placeLean) the least total sideways run; equal runs
 * keep the table's order (the fewer mirrored splits). It depends only on the
 * tree and the widths. Exact for any tree: per subtree, every choice of sides
 * not beaten on all of its extent's left, its right, its run and its mirrored
 * splits is kept (a wider or longer-run subtree never makes its parent's leans
 * shorter) and combined at its parent, both ways round, keeping at most
 * MAX_CANDS. `known`: sides already chosen for the same tree and widths (the
 * other design's layout), only planned. Sets each node's kids in that order;
 * returns each node's plan and the sides.
 */
function chooseSides(root: FanNode, P: Packer, known?: Map<Split, boolean>): { plans: Map<FanNode, Plan>; sides: Map<Split, boolean> } {
  const better = (p: Cand, q: Cand) => (Math.abs(p.cost - q.cost) > 1e-9 ? p.cost - q.cost : p.flips - q.flips);
  // One choice at v: its daughters (table order), their candidates, mirrored or not.
  // A species' outline on its slot (read only: the same for every plan).
  const leaves = new Map<FanBranch, Contour>();
  const leafOut = (b: FanBranch): Contour => {
    let c = leaves.get(b);
    if (!c) leaves.set(b, (c = P.shift(P.leaf(b), b.baseW / 2)));
    return c;
  };
  const plan = (v: FanNode, kc: (Cand | null)[], flip: boolean): Cand => {
    const idx = v.kids.map((_, i) => i);
    if (flip) idx.reverse();
    const order = idx.map((i) => v.kids[i]);
    // Each daughter's outline relative to its slot's left, before any lean (a species: its column centred on its slot).
    const outl = idx.map((i): Contour => {
      const c = kc[i];
      const k = v.kids[i];
      return c ? c.out : leafOut(k as FanBranch);
    });
    const off: number[] = [];
    let o = 0;
    for (const k of order) {
      off.push(o);
      o += bandW(k);
    }
    const dx = order.map(() => 0);
    // The larger daughter runs straight on (the first of equals in the table); each other leans out just clear of the ones nearer it.
    const main = v.kids.reduce((m, k) => (bandW(k) > bandW(m) ? k : m), v.kids[0]);
    const im = order.indexOf(main);
    const out = P.shift(outl[im], off[im]);
    let prev = 0;
    for (let i = im + 1; i < order.length; i++) {
      dx[i] = Math.max(prev, P.right(out, outl[i], LEAN_GAP_FRAC, off[i]), 0);
      prev = dx[i];
      P.union(out, outl[i], off[i], dx[i]);
    }
    prev = 0;
    for (let i = im - 1; i >= 0; i--) {
      dx[i] = Math.min(prev, P.left(out, outl[i], LEAN_GAP_FRAC, off[i]), 0);
      prev = dx[i];
      P.union(out, outl[i], off[i], dx[i]);
    }
    // Its outline: the daughters' after their leans, their hull with its band over the leans (at most LEAN_MAX_FRAC of the
    // height to a daughter's next event), its band down to its parent's split.
    const room = Math.min(...order.map((k) => v.y - (isNode(k) ? k.y : k.tipY)));
    P.bar(out, 0, v.width, v.y - LEAN_MAX_FRAC * room, v.yBot);
    const [a, b] = P.extent(out);
    const cost = kc.reduce((n, c) => n + (c ? c.cost : 0), 0) + dx.reduce((c, d) => c + Math.abs(d), 0);
    const flips = (flip ? 1 : 0) + kc.reduce((n, c) => n + (c ? c.flips : 0), 0);
    return { order, off, dx, a, b, out, cost, flip, flips, kids: kc };
  };
  const cands = (v: FanNode): Cand[] => {
    const fronts = v.kids.map((k) => (isNode(k) ? cands(k) : [null]));
    // Every combination of the daughters' candidates, each both ways round (one daughter: no sides to choose).
    let combos: (Cand | null)[][] = [[]];
    for (const f of fronts) combos = combos.flatMap((c) => f.map((x) => [...c, x]));
    const all: Cand[] = [];
    for (const kc of combos) {
      all.push(plan(v, kc, false));
      if (v.kids.length > 1) all.push(plan(v, kc, true));
    }
    all.sort(better);
    // Keep those no kept one beats on all of left, right, run and mirrored splits.
    const keep: Cand[] = [];
    for (const c of all) {
      if (keep.some((k) => k.cost <= c.cost + 1e-9 && k.flips <= c.flips && P.inside(k.out, c.out))) continue;
      keep.push(c);
      if (keep.length >= MAX_CANDS) break;
    }
    return keep;
  };
  const fixed = (v: FanNode, sides: Map<Split, boolean>): Cand =>
    plan(v, v.kids.map((k) => (isNode(k) ? fixed(k, sides) : null)), v.kids.length > 1 && !!sides.get(v.split));
  const plans = new Map<FanNode, Plan>();
  const sides = new Map<Split, boolean>();
  const apply = (v: FanNode, c: Cand): void => {
    // (The daughters' candidates are in table order: read them before reordering.)
    v.kids.forEach((k, i) => {
      if (isNode(k)) apply(k, c.kids[i]!);
    });
    v.kids = c.order;
    plans.set(v, c);
    sides.set(v.split, c.flip);
  };
  apply(root, known ? fixed(root, known) : cands(root)[0]);
  return { plans, sides };
}

/**
 * Straight (lines that lean, Ita's sketch):
 *
 *     |  |  |        read upwards: the right line is the parent, running
 *     \ _|  |        straight on through the split; the daughter peels off
 *         \ |        its side and leans out "for a bit" to its own column,
 *          \|        then runs straight up.
 *
 * At a split the larger daughter continues straight (the most ink stays put);
 * each other one leaves from its own part of the parent's band, on the side it
 * leans towards, along a straight diagonal (LEAN_RISE heights per unit
 * sideways, at most LEAN_MAX_FRAC of the height to either daughter's next
 * event, so leans end before anything else starts and never meet), just far
 * enough to clear its sibling's subtree by a gap at every height (Packer, LEAN_GAP_FRAC). Which side
 * each daughter is on is the shared order's (chooseSides: the leans' least
 * total sideways run). A species' column is centred on its slot's centre plus
 * its lean. The lanes blend below a split as far down as its daughters lean
 * out above it (at most half its band).
 */
function placeLean(root: FanNode, nodes: FanNode[], plans: Map<FanNode, Plan>, time: TimeScale, mode: WidthMode): void {
  const rp = plans.get(root)!;
  // Place it: the whole centred on 0, then each daughter from its slot in its parent's band.
  const nextEvent = (k: Kid) => (isNode(k) ? k.y : k.tipY);
  const place = (v: FanNode): void => {
    const p = plans.get(v)!;
    v.cx = v.left + v.width / 2;
    const room = Math.min(...p.order.map((k) => v.y - nextEvent(k)));
    // (A stock growing out of nobody: its reach is its own lean, or its sibling's away from it if it runs straight on.)
    const far = Math.max(...p.dx.map(Math.abs));
    const emerge = Math.min(...p.order.map((k, i) => emergeRun(k, time, mode, 'straight', 2 * (p.dx[i] ? Math.abs(p.dx[i]) : far))));
    p.order.forEach((k, i) => {
      const x0 = v.left + p.off[i];
      const d = p.dx[i];
      k.leanY = d ? v.y - Math.min(Math.abs(d) * LEAN_RISE, LEAN_MAX_FRAC * room, emerge) : v.y;
      if (isNode(k)) {
        k.left = x0 + d;
        place(k);
      } else {
        k.cx = x0 + k.baseW / 2 + d;
        k.colLeft = k.cx - k.width / 2;
      }
    });
  };
  root.left = -(rp.a + rp.b) / 2;
  place(root);
  for (const v of nodes) v.blend = Math.min(Math.max(0, ...v.kids.map((k) => v.y - k.leanY)), 0.5 * (v.yBot - v.y));
}
