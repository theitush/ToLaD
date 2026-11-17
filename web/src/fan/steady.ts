// The steady layout (ToLaD#259): a branch moves sideways only at its own splits, as an invariant.
//
// The fold (fold.ts) packs the columns side by side at every height, so every change of a population (a room's
// bend) pushes the columns beside it, and at the mammal level thousands of small pushes add up to a wave. Here
// the rooms are fixed instead, nested:
//
//   - A species' room is its widest ever (FanBranch.width): its column stands centred in it from the end of its
//     peel to its tip, narrowing and widening about one centre. A population change fills or empties its own
//     room only; nothing beside it moves.
//   - A clade's room is its daughters' rooms side by side with the gaps between them (the fold's gaps by
//     switch: a * pairGap, fixed, or by relatedness and opening with the width zoom), the same at every height. Its parent
//     column (its founders, below its split) stands at one place in it, where its daughters' peels are least
//     (their founders' mean move nil), so it runs straight from its own peel up to its split.
//   - At a split the daughters peel off from their founders' slots to their own places on the S-curve (ease), all
//     with one u (they never cross), over the river's fork (FanNode leanY), at least a bend (ROOM_BEND), at most
//     STEADY_RUN of the shortest daughter's run, so it ends well before the next split: the same height at every
//     zoom (a peel a few px tall reads as a ledge at home).
//
// So at a given zoom every strand's centre is constant between its own splits (steady.test.ts asserts it to under
// half a pixel at all three levels). The cost is honest empty space: a species below its peak (a decline, the dog
// before its boom) stands narrower in its room. A gap's opening (the zoom) moves things only at the split it
// belongs to; the camera keeps the point under the fingers (follow). Positions do not depend on what is on screen,
// so there is no anchor (the fold had one), and a row is one walk down the tree: no refolding.
//
// It is the view's layout (fan.tess.fold; its base, fold.ts, holds the splits' gaps and their openness by zoom), the
// only one since ToLaD#300 retired the fold's own packing. At the cats' level (the view's `folds` off) every split is open, at every zoom.

import { ease, g, isNode, laneW, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { Fold, ROOM_BEND, gapMode, type FoldState, type GapMode } from './fold';
import { lodIndexOn } from './lod';

/** A split's fork is at most this share of its shortest daughter's run (to its own split or tip). */
export const STEADY_RUN = 0.85;

/**
 * Rooms by life: the gap between two daughters where one is a fossil is at most this share of the narrower one's extent
 * while both lived (ToLaD#289: of the two together, a fossil beside its sister's parent column, the founders of all its
 * species, stood ~13 px off at Hominins with a 0.3 px column; of the narrower, ~4 px columns there).
 */
export const LIFE_GAP = 0.5;

/**
 * Territory rows (Steady.cell, ToLaD#333): the world height between them, fixed in the world, a power of two. At a
 * phone's home time scale (SY_HOME) ~20 px, the draw's coarsest grid there (the mammals' while moving), so at every
 * deeper time zoom they are rows the draw samples too (one cache, by world y). A resolution, not a look.
 */
export const TERR_H = 32;
/** The [first, last] pair of `W` (sorted, apart) holding i, as its first's offset, or -1. */
function rangeAt(W: Int32Array, i: number): number {
  for (let w = 0; w < W.length; w += 2) if (i >= W[w] && i <= W[w + 1]) return w;
  return -1;
}
const inRanges = (W: Int32Array, i: number) => rangeAt(W, i) >= 0;

/** How many layouts the fold keeps by their a's (Steady.cur, ToLaD#279): a still frame's own and the frames it works out. */
const LAYS_KEPT = 8;

/** Rooms by life: a strand's widest over a window is laneW at this many steps (and its ends). */
const LIFE_SAMPLES = 48;

/**
 * How a fork is drawn (ToLaD#377, `?forks=`; a look only: positions, frames and taps stay the peels' own). `thin` (ToLaD#402):
 * `flat`, and a stem wider than it is tall a line too. `flat`: the corners of a rectangular tree where a peel has too
 * little height for its move. `peel`: every daughter a ribbon on its S (the way back).
 */
export type ForkMode = 'thin' | 'flat' | 'peel';
/** Whether the "line ended" part of a branch with living descendants is drawn (ToLaD#410): a look only, what is extinct drawn gray either way, the rooms and frames the same. Off, with no switch in the app (ToLaD#439). */
let grayNow = false;
export const grayOn = (): boolean => grayNow;
export const setGrayOn = (on: boolean): void => {
  grayNow = on;
};
/** The chip's steps (ToLaD#439); `flat` stays what `thin` is built on, no longer a choice. */
export const FORK_MODES: ForkMode[] = ['thin', 'peel'];
let forkModeNow: ForkMode = 'thin';
export const forkMode = (): ForkMode => forkModeNow;
export const setForkMode = (m: ForkMode): void => {
  forkModeNow = m;
};

/**
 * The peel's mean slope on screen (px across per px up) at which a ribbon stops reading as a ribbon: at or under
 * RIBBON_SLOPE it is one, whole; from there it narrows, and at LINE_SLOPE it has gone, a rectangular tree's corner in its place.
 */
export const RIBBON_SLOPE = 2;
export const LINE_SLOPE = 4;
/** A species' label's pill, px across (ToLaD#396): the shortest thing on screen that holds a name. */
export const LABEL_PILL = 22;
/**
 * A stem's width on screen over its height on screen (ToLaD#402): at or under STEM_WHOLE it is a column, whole; at
 * STEM_LINE it has gone, a line in its place. What counts is what the eye reads as a plate, a sliver; so a width counts
 * only up to LABEL_PILL: a stem as tall as a name's pill stands however wide it runs, and only one under half of that can go.
 */
export const STEM_WHOLE = 1;
export const STEM_LINE = 2;

/**
 * How many equal steps of a peel's height draw its S (ease) straight within a fifth of a pixel, for its move on screen (px; a
 * chord over 1/n of an S strays at most move * 5.77 / (8 n^2)): a power of two, so that a zoom's coarser steps are its finer ones'.
 */
export function peelSteps(movePx: number): number {
  let n = 2;
  while (n < 256 && (movePx * 5.77) / (8 * n * n) > 0.2) n *= 2;
  return n;
}

/** A stretch's share of its width at this zoom, by how far it runs across per px up (across and h world): 1 whole, 0 a line. */
function share(across: number, h: number, sx: number, sy: number, whole: number, line: number): number {
  const m = Math.abs(across) * sx;
  if (!(m > 0)) return 1;
  if (!(h > 0)) return 0;
  const s = m / (h * sy);
  return s <= whole ? 1 : s >= line ? 0 : (line - s) / (line - whole);
}

/** A peel's ribbon's share of its width at this zoom: 1 a whole ribbon, 0 a corner. */
export function ribbonShare(move: number, h: number, sx: number, sy: number): number {
  return share(move, h, sx, sy, RIBBON_SLOPE, LINE_SLOPE);
}

/** A stem's share of its width at this zoom (width and height world): 1 a whole column, 0 a line. */
export function stemShare(w: number, h: number, sx: number, sy: number): number {
  return share(Math.min(w, LABEL_PILL / sx), h, sx, sy, STEM_WHOLE, STEM_LINE);
}

/** The rooms and places at one set of a's and width zoom (world x, the stem's centre on Fold.home). */
interface Lay {
  ver: number;
  /** The a's it was laid out at (a copy): follow finds a snapshot's layout among those it has. */
  A: Float64Array;
  /** Per node (fan.nodes' order): its column's left edge (once peeled), its room's left edge and width, its split's fork height. */
  colL: Float64Array;
  roomL: Float64Array;
  roomW: Float64Array;
  h: Float64Array;
  /** Per strand (drawn order): its own column's centre (its room's). */
  C: Float64Array;
  /** The row walk's per-version constants (prep()): per node its tile in its parent (colL[p] + off) and its peel's
   * move (colL - tile); per strand its founders' slot centre (colL + tcOff) and its peel's move (C - that). */
  tile?: Float64Array;
  dl?: Float64Array;
  tc?: Float64Array;
  dc?: Float64Array;
  /**
   * The rooms' bounds (bounds(), once per layout, ToLaD#502), world x, a hair wide: per node its column's reach over its
   * span (cLo, cHi: its tile to its own place, its strands' founders across) and its lineages' above its split (aLo, aHi:
   * every column and own column under it, at any height above its split, at its widest). The range answers prune by them.
   */
  cLo?: Float64Array;
  cHi?: Float64Array;
  aLo?: Float64Array;
  aHi?: Float64Array;
  /** Per node, over its subtree (splitsOn's walk, ToLaD#502): the highest fork's top (nY - h) and the rooms' reach (roomL to roomL + roomW). */
  sFork?: Float64Array;
  sRoomL?: Float64Array;
  sRoomR?: Float64Array;
}

/** The last grid row k (world y = k * h) with y at most `lim`, by the very product the rows make (-Infinity: none). */
function lastAtMost(lim: number, h: number): number {
  if (!(lim < Infinity)) return lim === Infinity ? Infinity : -Infinity;
  let k = Math.floor(lim / h);
  while (k * h > lim) k--;
  while ((k + 1) * h <= lim) k++;
  return k;
}

/** The last grid row k with k * h below `lim`. */
function lastBelow(lim: number, h: number): number {
  if (!(lim < Infinity)) return lim === Infinity ? Infinity : -Infinity;
  let k = Math.ceil(lim / h) - 1;
  while (k * h >= lim) k--;
  while ((k + 1) * h < lim) k++;
  return k;
}

export class Steady extends Fold {
  /** Per node: its index's parent (-1 for the root), its column's offset in its parent's, its fork's cap (world). */
  private readonly par: Int32Array;
  private readonly off: Float64Array;
  private readonly cap: Float64Array;
  /** Per node, per daughter after the first: the pair whose gap stands before it (its left sister's last strand). */
  private readonly kidPair: Int32Array[];
  /** Per strand: its room (its widest), its split's node index, and its path's node indices (b.path's order). */
  private readonly room: Float64Array;
  private readonly bNode: Int32Array;
  private readonly pIdx: Int32Array[];
  /** Per strand its path's splits' heights and its offsets in their columns (b.path's, flat: left() bisects them). */
  private readonly pY: Float64Array[];
  private readonly pOff: Float64Array[];
  private readonly pLin: Uint8Array;
  private readonly idx = new Map<FanNode, number>();
  /** Flat copies for the row walk (row(): ~5,900 strands a row at the mammal level): per node its split's height, its
   * strands' run [first, last] and its daughters (a node's index, or ~ a strand's); per strand its founders' width, its
   * split's height and its founders' slot centre's offset in its split's column. */
  private readonly nY: Float64Array;
  private readonly nW: Float64Array;
  /** Per node: where its stem's stretch starts going down: its split, or a clade's youngest tip while it is drawn as one branch (setMerged); which ones are. */
  private readonly stemTop: Float64Array;
  private readonly stemTopSet: number[] = [];
  /** The bottom of the world, where the root's stem ends. */
  private readonly yFloor: number;
  private readonly nFirst: Int32Array;
  private readonly nLast: Int32Array;
  private readonly kidsF: Int32Array[];
  private readonly bw: Float64Array;
  private readonly sY: Float64Array;
  private readonly tcOff: Float64Array;
  private readonly rootJ: number;
  private readonly stack: Int32Array;
  /** row()'s straight passes: per node its parent's split height (Infinity the root's), per strand its split node's;
   * mono: every split at or under its parent's (else the walk). */
  private readonly nYp: Float64Array;
  private readonly bY: Float64Array;
  private readonly mono: boolean;
  private lay: Lay | null = null;
  private rowsVer = -1;
  private readonly sRows = new Map<number, Float64Array>();
  private homeExtS: [number, number] | null = null;
  /** Rooms by life: per strand its tip, per node its last tip (the youngest), now's height; a strand's widest in a window (laneW sampled), by `${i} ${t0}`. */
  private readonly tipS: Float64Array;
  private readonly tipN: Float64Array;
  private readonly yNow: number;
  private readonly winW: (Map<number, number> | undefined)[] = [];
  /**
   * The range answers' constants (ToLaD#502): per strand its widest anywhere (its room, its founders, its most alive:
   * a bound on its column's width), per node its strands' founders summed (its column's width, a bound), its first
   * and last strand with founders (-1: none), and each node by its run of strands (first * (strands + 1) + last).
   */
  private readonly mx: Float64Array;
  private readonly wc: Float64Array;
  private readonly fPos: Int32Array;
  private readonly lPos: Int32Array;
  private readonly runNode = new Map<number, number>();

  /** Every split open at every zoom, so nothing here depends on the width zoom: the cats' level, or fixed gaps (ToLaD#378). */
  readonly open: boolean;

  /** open: as the field, else (with `age` gaps) the fold's openness by zoom. gaps: the switch (fold.ts). */
  constructor(
    fan: Fan,
    open = false,
    /** Rooms by life (ToLaD#289, #342: the only rooms; widest-ever rooms for tests): an extinct daughter and its sister stand apart by their extents while both lived. */
    readonly life = true,
    gaps: GapMode = gapMode(),
  ) {
    super(fan, gaps);
    this.open = open || gaps !== 'age';
    const N = fan.nodes;
    N.forEach((v, j) => this.idx.set(v, j));
    this.par = Int32Array.from(N, (v) => (v.parent ? this.idx.get(v.parent)! : -1));
    this.off = Float64Array.from(N, (v) => {
      if (!v.parent) return 0;
      const s = v.strands[0].path.find((p) => p.node === v.parent);
      return s ? s.off : 0;
    });
    const S = this.strands;
    this.room = Float64Array.from(S, (b) => Math.max(b.width, b.baseW));
    this.bNode = Int32Array.from(S, (b) => this.idx.get(b.node)!);
    this.pIdx = S.map((b) => Int32Array.from(b.path, (p) => this.idx.get(p.node)!));
    this.pY = S.map((b) => Float64Array.from(b.path, (p) => p.y));
    this.pOff = S.map((b) => Float64Array.from(b.path, (p) => p.off));
    this.pLin = Uint8Array.from(this.pY, (py) => (py.some((y, k) => k > 0 && !(y >= py[k - 1])) ? 1 : 0));
    const yRef = fan.time.y(0);
    this.cap = Float64Array.from(N, (v) => {
      let run = Infinity;
      let fork = 0;
      for (const k of v.kids) {
        run = Math.min(run, v.y - (isNode(k) ? k.y : Math.max(k.tipY, yRef)));
        fork = Math.max(fork, v.y - k.leanY);
      }
      return Math.max(0, Math.min(Math.max(fork, ROOM_BEND), STEADY_RUN * run));
    });
    this.nY = Float64Array.from(N, (v) => v.y);
    this.nW = Float64Array.from(N, (v) => v.width);
    this.stemTop = this.nY.slice();
    this.yFloor = fan.trunkBottom.y;
    this.nFirst = Int32Array.from(N, (v) => v.strands[0].index);
    this.nLast = Int32Array.from(N, (v) => v.strands[v.strands.length - 1].index);
    this.kidsF = N.map((v) => Int32Array.from(v.kids, (k) => (isNode(k) ? this.idx.get(k)! : ~k.index)));
    this.bw = Float64Array.from(S, (b) => b.baseW);
    this.sY = Float64Array.from(S, (b) => b.splitY);
    this.tcOff = Float64Array.from(S, (b) => b.path[0].off + b.baseW / 2);
    this.rootJ = this.idx.get(fan.root)!;
    this.stack = new Int32Array(N.length + 1);
    this.nYp = Float64Array.from(N, (_, j) => (this.par[j] < 0 ? Infinity : this.nY[this.par[j]]));
    this.bY = Float64Array.from(S, (_, i) => this.nY[this.bNode[i]]);
    this.mono = this.nY.every((y, j) => y <= this.nYp[j]);
    const last = (k: FanNode | FanBranch) => (isNode(k) ? k.strands[k.strands.length - 1].index : k.index);
    this.kidPair = N.map((v) => Int32Array.from(v.kids.slice(0, -1), last));
    // (Rooms by life: each node's last tip, the youngest of its strands', and now.)
    this.tipS = Float64Array.from(S, (b) => b.tipY);
    this.crossL = new Float64Array(S.length);
    this.crossR = new Float64Array(S.length);
    this.crossF = new Int32Array(S.length);
    this.crossE = new Int32Array(S.length);
    this.tipN = new Float64Array(N.length);
    for (let j = N.length - 1; j >= 0; j--) {
      let t = Infinity;
      for (const k of this.kidsF[j]) t = Math.min(t, k >= 0 ? this.tipN[k] : this.tipS[~k]);
      this.tipN[j] = t;
    }
    this.yNow = yRef;
    this.mx = Float64Array.from(S, (b, i) => Math.max(b.baseW, this.room[i], b.unit * g(b.pop.max, b.tess.mode)));
    const ns = S.length;
    const sum = new Float64Array(ns + 1);
    const next = new Int32Array(ns + 1).fill(-1);
    const prev = new Int32Array(ns).fill(-1);
    for (let i = 0; i < ns; i++) {
      sum[i + 1] = sum[i] + this.bw[i];
      prev[i] = this.bw[i] > 0 ? i : i > 0 ? prev[i - 1] : -1;
    }
    for (let i = ns - 1; i >= 0; i--) next[i] = this.bw[i] > 0 ? i : next[i + 1];
    this.wc = Float64Array.from(N, (v, j) => Math.max(v.width, sum[this.nLast[j] + 1] - sum[this.nFirst[j]]));
    this.fPos = Int32Array.from(N, (_, j) => (next[this.nFirst[j]] >= 0 && next[this.nFirst[j]] <= this.nLast[j] ? next[this.nFirst[j]] : -1));
    this.lPos = Int32Array.from(N, (_, j) => (prev[this.nLast[j]] >= this.nFirst[j] ? prev[this.nLast[j]] : -1));
    N.forEach((_, j) => this.runNode.set(this.nFirst[j] * (ns + 1) + this.nLast[j], j));
    this.cand = new Int32Array(ns);
    this.cutStack = new Int32Array(N.length + ns + 1);
    this.offRuns = new Int32Array(2 * (N.length + ns + 1));
    this.walkLo = new Float64Array(N.length + ns + 1);
    this.walkHi = new Float64Array(N.length + ns + 1);
    if (this.open) this.a.fill(1);
  }

  /** The rooms and places at the a's `A`. */
  private compute(A: Float64Array): Lay {
    if (this.life) return this.computeLife(A);
    const n = this.nY.length;
    const G = this.pairGap;
    const R = this.room;
    const NW = this.nW;
    const roomW = new Float64Array(n);
    const roomL = new Float64Array(n);
    const colL = new Float64Array(n);
    const h = new Float64Array(n);
    const C = new Float64Array(this.strands.length);
    // (Daughters: a node's index, or ~ a strand's, kidsF.) Rooms, daughters first (fan.nodes has parents before
    // daughters): the daughters' side by side, with their gaps.
    for (let j = n - 1; j >= 0; j--) {
      const K = this.kidsF[j];
      const P = this.kidPair[j];
      let r = 0;
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        r += k >= 0 ? roomW[k] : R[~k];
        if (q > 0) r += A[P[q - 1]] * G[P[q - 1]];
      }
      roomW[j] = r;
    }
    // Places, parents first (the root's room from 0): each daughter's room in its parent's, left to right; a species' centre its room's.
    for (let j = 0; j < n; j++) {
      const K = this.kidsF[j];
      const P = this.kidPair[j];
      let x = roomL[j];
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (q > 0) x += A[P[q - 1]] * G[P[q - 1]];
        if (k >= 0) {
          roomL[k] = x;
          x += roomW[k];
        } else {
          C[~k] = x + R[~k] / 2;
          x += R[~k];
        }
      }
    }
    // Each parent column, daughters first: where its daughters' founders move least (their founders-weighted mean move
    // nil), inside its room.
    for (let j = n - 1; j >= 0; j--) {
      const K = this.kidsF[j];
      let sw = 0;
      let s = 0;
      let o = 0;
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        const w = k >= 0 ? NW[k] : this.bw[~k];
        const t = k >= 0 ? colL[k] + w / 2 : C[~k];
        const m = Math.max(w, 1e-12);
        s += m * (t - o - w / 2);
        sw += m;
        o += w;
      }
      colL[j] = Math.min(roomL[j] + roomW[j] - NW[j], Math.max(roomL[j], s / sw));
      h[j] = this.cap[j];
    }
    // The stem's centre on home: where the closed order stands.
    const r = this.idx.get(this.fan.root)!;
    const sh = this.home - (colL[r] + this.fan.root.width / 2);
    for (let j = 0; j < n; j++) {
      colL[j] += sh;
      roomL[j] += sh;
    }
    for (let i = 0; i < C.length; i++) C[i] += sh;
    return { ver: this.ver, A: Float64Array.from(A), colL, roomL, roomW, h, C };
  }

  /** Strand i's widest from its split up to window bottom t0 (world y; its tip if later): laneW sampled, its founders' at the split. */
  private widestSince(i: number, t0: number): number {
    const b = this.strands[i];
    const lo = Math.max(t0, b.tipY);
    // (Kept per strand by its window's bottom, a number: no key to build, ToLaD#279, a few million asks a layout with every fossil.)
    const m = (this.winW[i] ??= new Map());
    let w = m.get(lo);
    if (w !== undefined) return w;
    w = b.baseW;
    const hi = b.splitY;
    if (hi > lo) {
      const age = this.fan.time;
      for (let k = 0; k <= LIFE_SAMPLES; k++) {
        const y = lo + ((hi - lo) * k) / LIFE_SAMPLES;
        w = Math.max(w, laneW(b, y, age.ageAt(y)));
      }
    }
    m.set(lo, w);
    return w;
  }

  /**
   * Rooms by life (ToLaD#289): as compute, but a daughter's place in its parent's room is the least that keeps it clear
   * of every sister before it (with the gaps between) only where both lived: from the split up to the later of their
   * last tips. Two that live on to now stand apart by their whole rooms, as in compute; a fossil beside the humans by
   * what the humans were while it lived. Places are still constant between splits (each daughter's offset is one
   * number); a room is the span of its daughters' at their widest, so offsets may start left of 0 (then shifted).
   */
  private computeLife(A: Float64Array): Lay {
    const n = this.nY.length;
    const G = this.pairGap;
    const R = this.room;
    const NW = this.nW;
    const now = this.yNow + 1e-9;
    const roomW = new Float64Array(n);
    const roomL = new Float64Array(n);
    const colL = new Float64Array(n);
    const h = new Float64Array(n);
    const C = new Float64Array(this.strands.length);
    /** Per node, its daughters' offsets in its room (kidsF's order); a node's column's left in its room. */
    const offs: Float64Array[] = new Array(n);
    const colR = new Float64Array(n);
    // A daughter's extent [lo, hi] in its own room from its parent's split up to window bottom t0: a strand its column
    // about its room's centre at its widest there; a node its column below its split, and the daughters alive by t0.
    const ext = (k: number, t0: number, out: [number, number]): [number, number] => {
      if (k < 0) {
        const c = R[~k] / 2;
        const w = this.widestSince(~k, t0) / 2;
        out[0] = c - w;
        out[1] = c + w;
        return out;
      }
      let lo = colR[k];
      let hi = colR[k] + NW[k];
      if (this.nY[k] > t0) {
        const K = this.kidsF[k];
        const o = offs[k];
        for (let q = 0; q < K.length; q++) {
          const d = K[q];
          // (Nothing to add if its whole room is inside; one dead before t0 stood there while it lived: widestSince starts at its tip.)
          if (o[q] >= lo && o[q] + (d >= 0 ? roomW[d] : R[~d]) <= hi) continue;
          ext(d, t0, out);
          lo = Math.min(lo, o[q] + out[0]);
          hi = Math.max(hi, o[q] + out[1]);
        }
      }
      out[0] = lo;
      out[1] = hi;
      return out;
    };
    const ea: [number, number] = [0, 0];
    const eb: [number, number] = [0, 0];
    // Rooms, daughters first.
    for (let j = n - 1; j >= 0; j--) {
      const K = this.kidsF[j];
      const P = this.kidPair[j];
      const m = K.length;
      const o = new Float64Array(m);
      const full = new Float64Array(m);
      const tip = new Float64Array(m);
      for (let q = 0; q < m; q++) {
        const k = K[q];
        full[q] = k >= 0 ? roomW[k] : R[~k];
        tip[q] = k >= 0 ? this.tipN[k] : this.tipS[~k];
      }
      for (let q = 1; q < m; q++) {
        let x = -Infinity;
        let g = 0;
        for (let p = q - 1; p >= 0; p--) {
          g = Math.max(g, A[P[p]] * G[P[p]]);
          const t0 = Math.max(tip[p], tip[q]);
          if (t0 <= now) x = Math.max(x, o[p] + full[p] + g);
          // (Bound first, ToLaD#279: each extent is inside its room and a gap at most g, so p can push q no further than
          // its whole room and g would. Where that is not past x already, its extents are not worked out: a polytomy of a
          // few hundred fossils is a few hundred thousand pairs.)
          else if (o[p] + full[p] + g > x) {
            ext(K[p], t0, ea);
            ext(K[q], t0, eb);
            // (The gap too: a share of the order's width, the humans' 8e9 at the primates', would dwarf the fossils; at most LIFE_GAP of the narrower of the two then.)
            const gl = Math.min(g, LIFE_GAP * Math.min(ea[1] - ea[0], eb[1] - eb[0]));
            x = Math.max(x, o[p] + ea[1] + gl - eb[0]);
          }
          // (Those before a sister living to now are clear of q already: they are clear of her column, which q clears.)
          if (tip[p] <= now) break;
        }
        o[q] = x;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (let q = 0; q < m; q++) {
        lo = Math.min(lo, o[q]);
        hi = Math.max(hi, o[q] + full[q]);
      }
      if (!(m > 0)) lo = hi = 0;
      for (let q = 0; q < m; q++) o[q] -= lo;
      offs[j] = o;
      roomW[j] = Math.max(hi - lo, NW[j]);
      // Its column: where its daughters' founders move least (compute's rule), inside its room.
      let sw = 0;
      let s = 0;
      let c = 0;
      for (let q = 0; q < m; q++) {
        const k = K[q];
        const w = k >= 0 ? NW[k] : this.bw[~k];
        const t = o[q] + (k >= 0 ? colR[k] + w / 2 : R[~k] / 2);
        const mw = Math.max(w, 1e-12);
        s += mw * (t - c - w / 2);
        sw += mw;
        c += w;
      }
      colR[j] = Math.min(roomW[j] - NW[j], Math.max(0, s / sw));
      h[j] = this.cap[j];
    }
    // Places, parents first (the root's room from 0).
    for (let j = 0; j < n; j++) {
      const K = this.kidsF[j];
      const o = offs[j];
      colL[j] = roomL[j] + colR[j];
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (k >= 0) roomL[k] = roomL[j] + o[q];
        else C[~k] = roomL[j] + o[q] + R[~k] / 2;
      }
    }
    const r = this.rootJ;
    const sh = this.home - (colL[r] + this.fan.root.width / 2);
    for (let j = 0; j < n; j++) {
      colL[j] += sh;
      roomL[j] += sh;
    }
    for (let i = 0; i < C.length; i++) C[i] += sh;
    return { ver: this.ver, A: Float64Array.from(A), colL, roomL, roomW, h, C };
  }

  /** The current layout (at the fold's version and zoom). */
  private cur(): Lay {
    const L = this.lay;
    if (L && L.ver === this.ver) return L;
    this.layPrev = L;
    // (A layout is its a's alone (the rest is fixed with the fold): one laid out at these a's already is taken again, ToLaD#279.
    // A frame worked out for another view moves the a's there and back (keep(), brackets.ts foldedFrame), and a still frame
    // asks for its level's frame and its neighbours': with every fossil on the tree a layout is ~0.5 s in node, 8 a frame.)
    const a = this.a;
    let k = this.recent.findIndex((M) => M.A.length === a.length && M.A.every((x, i) => x === a[i]));
    const M = k >= 0 ? this.recent.splice(k, 1)[0] : this.compute(a);
    M.ver = this.ver;
    this.recent.unshift(M);
    if (this.recent.length > LAYS_KEPT) this.recent.length = LAYS_KEPT;
    return (this.lay = M);
  }
  /** The layouts laid out last, the latest first (cur()). */
  private readonly recent: Lay[] = [];

  /** Split v's fork (world): how far above it its daughters' peels end. */
  forkH(v: FanNode): number {
    return this.cur().h[this.idx.get(v)!];
  }

  /**
   * Node j's stem's share at this zoom (ToLaD#402): its stretch from its split (a clade drawn as one branch: from its
   * youngest tip, setMerged) to its parent's fork; the root's, to the bottom of the world. 1 but in `thin`.
   */
  private nodeStem(L: Lay, j: number, sx: number, sy: number): number {
    if (forkModeNow !== 'thin') return 1;
    return stemShare(this.nW[j], this.stemFoot(L, j) - this.stemTop[j], sx, sy);
  }

  /** Where node j's stem ends going down (world). */
  private stemFoot(L: Lay, j: number): number {
    const p = this.par[j];
    return p < 0 ? this.yFloor : this.nY[p] - L.h[p];
  }

  /** Strand i's first stretch's share: from its tip to its fork, as a node's stem. */
  private strandStem(L: Lay, i: number, sx: number, sy: number): number {
    if (forkModeNow !== 'thin') return 1;
    return stemShare(this.strands[i].width, this.sY[i] - L.h[this.bNode[i]] - Math.max(this.tipS[i], this.yNow), sx, sy);
  }

  /** Node j's peel's share: no ribbon runs off or into a stem that is not whole; the corner it leaves is what a line can join. */
  private nodePeel(L: Lay, j: number, sx: number, sy: number): number {
    const p = this.par[j];
    return Math.min(ribbonShare(L.dl![j], L.h[p], sx, sy), this.nodeStem(L, j, sx, sy), this.nodeStem(L, p, sx, sy));
  }

  /** Strand i's peel's share, as nodePeel. */
  private strandPeel(L: Lay, i: number, sx: number, sy: number): number {
    const j = this.bNode[i];
    return Math.min(ribbonShare(L.dc![i], L.h[j], sx, sy), this.strandStem(L, i, sx, sy), this.nodeStem(L, j, sx, sy));
  }

  /** The clades drawn as one branch this frame (lod.ts): each one's stem runs up to its youngest tip, its split being inside the branch. */
  /** (at: per merged clade, its index in fan.nodes, when the caller keeps them (Lod.mIdx); top(v, m): its top.) */
  setMerged(merged: readonly FanNode[], top: (v: FanNode, m: number) => number, at?: ArrayLike<number>): void {
    // (The same list as last time (Lod.update makes a new one when they change): nothing to do, ToLaD#502.)
    if (merged === this.mergedLast) return;
    this.mergedLast = merged;
    for (const j of this.stemTopSet) this.stemTop[j] = this.nY[j];
    this.stemTopSet.length = 0;
    for (let m = 0; m < merged.length; m++) {
      const v = merged[m];
      const j = at ? at[m] : this.idx.get(v)!;
      this.stemTop[j] = Math.max(top(v, m), this.yNow);
      this.stemTopSet.push(j);
    }
  }

  /** Node j's (fan.nodes' order) foot's height cut off at this zoom: its parent's fork if its peel is no whole ribbon, else 0. */
  footCut(j: number, sx: number, sy: number): number {
    const p = this.par[j];
    if (p < 0) return 0;
    const L = this.cur();
    this.prep(L);
    return this.nodePeel(L, j, sx, sy) < 1 ? L.h[p] : 0;
  }

  /** Node j's stem's share at this zoom (the backdrop goes with it). */
  stemAt(j: number, sx: number, sy: number): number {
    return this.nodeStem(this.cur(), j, sx, sy);
  }

  private mergedLast: readonly FanNode[] | null = null;

  /**
   * Each split whose fork and room meet the screen (world heights and x), in fan.nodes' order: ~13,000 nodes at the
   * mammal level, most off it. With `cut` (a clade drawn as one branch: it and all under it passed by), a walk down from
   * the root that passes by each subtree whose splits all miss the screen (the layout's subtree bounds, ToLaD#502).
   */
  splitsOn(yTop: number, yBot: number, x0: number, x1: number, visit: (j: number, top: number) => void, cut?: (j: number) => boolean): void {
    const L = this.cur();
    const { h, roomL, roomW } = L;
    const nY = this.nY;
    const off = (j: number) => nY[j] < yTop || nY[j] - h[j] > yBot || roomL[j] > x1 || roomL[j] + roomW[j] < x0;
    if (!cut || !lodIndexOn()) {
      for (let j = 0; j < nY.length; j++) if (!off(j)) visit(j, nY[j] - h[j]);
      return;
    }
    this.splitBounds(L);
    const sF = L.sFork!;
    const sL = L.sRoomL!;
    const sR = L.sRoomR!;
    const sNY = this.sNY!;
    const st = this.cutStack;
    let at = this.splitsAt;
    let c = 0;
    let n = 0;
    st[n++] = this.rootJ;
    for (let q = 0; ; ) {
      if (n === 0) {
        if (q >= this.lone!.length) break;
        st[n++] = this.lone![q++];
      }
      const j = st[--n];
      if (sNY[j] < yTop || sF[j] > yBot || sL[j] > x1 || sR[j] < x0 || cut(j)) continue;
      if (!off(j)) {
        if (c === at.length) {
          const b = new Int32Array(2 * c);
          b.set(at);
          at = this.splitsAt = b;
        }
        at[c++] = j;
      }
      const K = this.kidsF[j];
      for (let k = 0; k < K.length; k++) if (K[k] >= 0) st[n++] = K[k];
    }
    const on = at.subarray(0, c).sort();
    for (let k = 0; k < c; k++) visit(on[k], nY[on[k]] - h[on[k]]);
  }
  private splitsAt = new Int32Array(256);
  /** Per node: the lowest split in its subtree (the most nY); the nodes no walk from the root reaches. Made when first asked. */
  private sNY: Float64Array | null = null;
  private lone: Int32Array | null = null;

  /** splitsOn's subtree bounds into L (once per layout): per node the highest fork top and the rooms' reach of all under it. */
  private splitBounds(L: Lay): void {
    const nY = this.nY;
    const n = nY.length;
    const par = this.par;
    if (!this.sNY) {
      const s = Float64Array.from(nY);
      for (let j = n - 1; j >= 0; j--) if (par[j] >= 0) s[par[j]] = Math.max(s[par[j]], s[j]);
      this.sNY = s;
      const seen = new Uint8Array(n);
      const st = [this.rootJ];
      while (st.length) {
        const j = st.pop()!;
        seen[j] = 1;
        for (const k of this.kidsF[j]) if (k >= 0) st.push(k);
      }
      this.lone = Int32Array.from(nY.keys()).filter((j) => !seen[j]);
    }
    if (L.sFork) return;
    const { h, roomL, roomW } = L;
    const sF = new Float64Array(n).fill(Infinity);
    const sL = new Float64Array(n).fill(Infinity);
    const sR = new Float64Array(n).fill(-Infinity);
    for (let j = n - 1; j >= 0; j--) {
      sF[j] = Math.min(sF[j], nY[j] - h[j]);
      sL[j] = Math.min(sL[j], roomL[j]);
      sR[j] = Math.max(sR[j], roomL[j] + roomW[j]);
      const p = par[j];
      if (p < 0) continue;
      sF[p] = Math.min(sF[p], sF[j]);
      sL[p] = Math.min(sL[p], sL[j]);
      sR[p] = Math.max(sR[p], sR[j]);
    }
    L.sFork = sF;
    L.sRoomL = sL;
    L.sRoomR = sR;
  }

  /**
   * offSide's walk for this window, made if not yet: the runs of strands it passed by whole (ascending, disjoint; first,
   * last pairs), or null where it cannot be made (a tree not mono, no grid): then no strand is passed by (ToLaD#502).
   */
  offRunsOn(y0: number, y1: number, xa: number, xb: number): { runs: Int32Array; n: number } | null {
    if (!this.marked(y0, y1, xa, xb)) return null;
    this.offOut.runs = this.offRuns;
    this.offOut.n = this.offN;
    return this.offOut;
  }
  private readonly offOut: { runs: Int32Array; n: number } = { runs: new Int32Array(0), n: 0 };

  /**
   * The stretches on the way up from node j that are not whole at this zoom, youngest first: its stem (ToLaD#402), then
   * its peel, and so on up. out gets [top, bottom, share] a stretch (world y). A row of them for each column the draw cuts (view.ts cutForks).
   */
  private forksUp(L: Lay, j: number, sx: number, sy: number, yTop: number, yBot: number, out: number[]): void {
    for (let p = this.par[j]; p >= 0; j = p, p = this.par[j]) {
      const fork = this.nY[p] - L.h[p];
      const st = this.nodeStem(L, j, sx, sy);
      if (st < 1 && this.stemTop[j] <= yBot && fork >= yTop) out.push(this.stemTop[j], fork, st);
      // (Only those on screen: up the tree the splits only get older, so past its bottom none is left.)
      if (fork > yBot) return;
      if (this.nY[p] < yTop) continue;
      const t = this.nodePeel(L, j, sx, sy);
      if (t < 1) out.push(fork, this.nY[p], t);
    }
    // (j: the root. Its stem, on to the bottom of the world.)
    const st = this.nodeStem(L, j, sx, sy);
    if (st < 1 && this.stemTop[j] <= yBot && this.yFloor >= yTop) out.push(this.stemTop[j], this.yFloor, st);
  }

  /** forksUp for strand i: its first stretch and its peel, then its columns'. */
  strandForks(i: number, sx: number, sy: number, yTop: number, yBot: number, out: number[]): void {
    const L = this.cur();
    this.prep(L);
    out.length = 0;
    const j = this.bNode[i];
    const fork = this.sY[i] - L.h[j];
    const st = this.strandStem(L, i, sx, sy);
    const tip = Math.max(this.tipS[i], this.yNow);
    if (st < 1 && tip <= yBot && fork >= yTop) out.push(tip, fork, st);
    const t = this.strandPeel(L, i, sx, sy);
    if (t < 1 && this.sY[i] >= yTop && fork <= yBot) out.push(fork, this.sY[i], t);
    this.forksUp(L, j, sx, sy, yTop, yBot, out);
  }

  /** forksUp for node v's own stem and peel and its ancestors' (a merged clade, one ribbon above its split). */
  nodeForks(v: FanNode, sx: number, sy: number, yTop: number, yBot: number, out: number[]): void {
    const L = this.cur();
    this.prep(L);
    out.length = 0;
    this.forksUp(L, this.idx.get(v)!, sx, sy, yTop, yBot, out);
  }

  /**
   * The peels node v's column runs through over [yTop, yBot] (a merged clade's ancestors' forks, ToLaD#461), bottom up:
   * [foot, top] pairs, world y. Each is one S (ease) over one height, however the rows fall on it.
   */
  peelsOn(v: FanNode, yTop: number, yBot: number, out: number[]): void {
    const L = this.cur();
    out.length = 0;
    for (let p = this.par[this.idx.get(v)!]; p >= 0; p = this.par[p]) {
      const foot = this.nY[p];
      const top = foot - L.h[p];
      if (foot > top && foot >= yTop && top <= yBot) out.unshift(foot, top);
    }
  }

  /**
   * Node v's split, for its corners: its column's centre, and out gets per daughter (v.kids' order) [its column's centre,
   * its ribbon's share]. stems, if given, gets per daughter [its stem's share, its stem's top (world)] (`thin`, ToLaD#402).
   */
  corner(v: FanNode, sx: number, sy: number, out: number[], stems?: number[]): number {
    const L = this.cur();
    this.prep(L);
    const j = this.idx.get(v)!;
    const K = this.kidsF[j];
    out.length = 0;
    if (stems) stems.length = 0;
    for (let q = 0; q < K.length; q++) {
      const k = K[q];
      if (k >= 0) {
        out.push(L.colL[k] + this.nW[k] / 2, this.nodePeel(L, k, sx, sy));
        stems?.push(this.nodeStem(L, k, sx, sy), this.stemTop[k]);
      } else {
        out.push(L.C[~k], this.strandPeel(L, ~k, sx, sy));
        stems?.push(this.strandStem(L, ~k, sx, sy), Math.max(this.tipS[~k], this.yNow));
      }
    }
    return L.colL[j] + this.nW[j] / 2;
  }

  /** How far a peel has gone at y: 0 at its split (y0), 1 a fork h up. */
  private u(y0: number, h: number, y: number): number {
    if (!(h > 0)) return y < y0 ? 1 : 0;
    const t = (y0 - y) / h;
    return t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
  }

  /** The row walk's per-version constants into L (once per layout): the same sums nodeLeft and ownC make, made once. */
  private prep(L: Lay): void {
    if (L.tile) return;
    const n = this.nY.length;
    const tile = new Float64Array(n);
    const dl = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const p = this.par[j];
      if (p < 0) continue;
      const t = L.colL[p] + this.off[j];
      tile[j] = t;
      dl[j] = L.colL[j] - t;
    }
    const S = this.bNode.length;
    const tc = new Float64Array(S);
    const dc = new Float64Array(S);
    for (let i = 0; i < S; i++) {
      const t = L.colL[this.bNode[i]] + this.tcOff[i];
      tc[i] = t;
      dc[i] = L.C[i] - t;
    }
    L.dl = dl;
    L.tc = tc;
    L.dc = dc;
    L.tile = tile;
  }

  /** Node j's column's left edge at y (in its span: from its parent's split up to its own). */
  private nodeLeft(L: Lay, j: number, y: number): number {
    const p = this.par[j];
    if (p < 0) return L.colL[j];
    this.prep(L);
    return L.tile![j] + L.dl![j] * this.u(this.nY[p], L.h[p], y);
  }

  /** Strand i's own column's centre at y, above its split (peeling off its founders' slot). */
  private ownC(L: Lay, i: number, y: number): number {
    const j = this.bNode[i];
    const h = L.h[j];
    const y0 = this.sY[i];
    // (Past its peel, as most are: its room's centre.)
    if (h > 0 && y <= y0 - h) return L.C[i];
    this.prep(L);
    return L.tc![i] + L.dc![i] * this.u(y0, h, y);
  }

  override left(i: number, y: number): number {
    return this.leftIn(this.cur(), i, y);
  }

  override rowX(i: number, y: number): number {
    return this.rowIn(this.cur(), i, y);
  }

  /**
   * Strand i's entry in row() at y in layout L, alone: its own column's centre above its split node's height, else its
   * slot in the one column spanning y. That is left()'s but at a split with no height (a daughter at its parent's
   * height, a polytomy resolved): its path's splits there in parents-first order, the column spanning y is the first
   * of them (the parent's; the daughter's spans nothing), where left() takes the last.
   */
  private rowIn(L: Lay, i: number, y: number): number {
    if (y < this.bY[i]) return this.ownC(L, i, y);
    const py = this.pY[i];
    let a = 1;
    let z = py.length;
    if (this.pLin[i]) while (a < z && py[a] <= y) a++;
    else while (a < z) {
      const m = (a + z) >> 1;
      if (py[m] <= y) a = m + 1;
      else z = m;
    }
    let e = a - 1;
    while (e > 0 && py[e - 1] === py[e]) e--;
    return this.nodeLeft(L, this.pIdx[i][e], y) + this.pOff[i][e];
  }

  /**
   * rowSpan, from the layout (xRange's table, ToLaD#502): a strand's entry stands still between its peels (an own
   * column past its peel, its room's centre; a column past its peel off its parent), so each still stretch is read at
   * one of its rows and only the rows inside a peel one by one. A strand costs its splits and peels, not the rows; the
   * entries are rowX's own (the stretches found by the very tests rowX makes), so the least and most are the same.
   */
  override rowSpan(i: number, ka: number, kb: number, h: number, out: [number, number]): [number, number] {
    if (!this.mono || this.pLin[i] || !(h > 0)) return super.rowSpan(i, ka, kb, h, out);
    const L = this.cur();
    this.prep(L);
    let lo = Infinity;
    let hi = -Infinity;
    let k = ka;
    // (Its own column, the rows above its split node's height.)
    const yb = this.bY[i];
    if (k <= kb && k * h < yb) {
      const ko = Math.min(kb, lastBelow(yb, h));
      const hj = L.h[this.bNode[i]];
      if (hj > 0) {
        const kc = Math.min(ko, lastAtMost(this.sY[i] - hj, h));
        if (k <= kc) {
          lo = hi = L.C[i];
          k = kc + 1;
        }
      }
      for (; k <= ko; k++) {
        const x = this.ownC(L, i, k * h);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    // (Then its path's columns, each from its split down to the next one's.)
    const py = this.pY[i];
    const n = py.length;
    let e = 0;
    while (k <= kb) {
      const y = k * h;
      while (e + 1 < n && py[e + 1] <= y) e++;
      // (At a split with no height, the parent's column: rowIn's.)
      let g = e;
      while (g > 0 && py[g - 1] === py[g]) g--;
      const j = this.pIdx[i][g];
      const off = this.pOff[i][g];
      const ke = e + 1 < n ? Math.min(kb, lastBelow(py[e + 1], h)) : kb;
      // (Past its peel off its parent (u = 1, the test u() makes): still.)
      let kc = ke;
      const p = this.par[j];
      if (p >= 0) {
        const y0 = this.nY[p];
        const hp = L.h[p];
        if (hp > 0) {
          kc = Math.min(ke, lastAtMost(y0 - hp, h));
          while (kc >= k && !((y0 - kc * h) / hp >= 1)) kc--;
          while (kc < ke && (y0 - (kc + 1) * h) / hp >= 1) kc++;
        }
      }
      if (k <= kc) {
        const x = this.nodeLeft(L, j, k * h) + off;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
        k = kc + 1;
      }
      for (; k <= ke; k++) {
        const x = this.nodeLeft(L, j, k * h) + off;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    out[0] = lo;
    out[1] = hi;
    return out;
  }

  /** left() in layout L. */
  private leftIn(L: Lay, i: number, y: number): number {
    if (y < this.sY[i]) return this.ownC(L, i, y);
    // (The last of its path's splits at or above y: bisected, ToLaD#255.)
    const py = this.pY[i];
    let a = 1;
    let z = py.length;
    // (A path not ascending (none known): walked as before.)
    if (this.pLin[i]) while (a < z && py[a] <= y) a++;
    else while (a < z) {
      const m = (a + z) >> 1;
      if (py[m] <= y) a = m + 1;
      else z = m;
    }
    return this.nodeLeft(L, this.pIdx[i][a - 1], y) + this.pOff[i][a - 1];
  }

  /**
   * Every strand's left (its slot's) or own column's centre at y, in two straight passes (no walk, ToLaD#255): a
   * strand above its split node's height has its own column there; else it is in the one node column spanning y
   * (from its split up to its parent's), its strands side by side from its left edge. The same sums the walk makes
   * (walk(), kept for a tree whose splits are not each under its parent's).
   */
  private row(L: Lay, y: number, out: Float64Array): Float64Array {
    if (!this.mono) return this.walk(L, y, out);
    this.prep(L);
    const { colL, h, C } = L;
    const tile = L.tile!;
    const dl = L.dl!;
    const tc = L.tc!;
    const dc = L.dc!;
    const nY = this.nY;
    const nYp = this.nYp;
    const bY = this.bY;
    const bNode = this.bNode;
    const sY = this.sY;
    const S = bY.length;
    for (let i = 0; i < S; i++) {
      if (!(y < bY[i])) continue;
      const hj = h[bNode[i]];
      const y0 = sY[i];
      if (hj > 0 && y <= y0 - hj) out[i] = C[i];
      else {
        let u: number;
        if (!(hj > 0)) u = y < y0 ? 1 : 0;
        else {
          const t = (y0 - y) / hj;
          u = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
        }
        out[i] = tc[i] + dc[i] * u;
      }
    }
    const par = this.par;
    const bw = this.bw;
    const nFirst = this.nFirst;
    const nLast = this.nLast;
    const N = nY.length;
    for (let j = 0; j < N; j++) {
      if (!(y >= nY[j] && y < nYp[j])) continue;
      const p = par[j];
      let x: number;
      if (p < 0) x = colL[j];
      else {
        const y0 = nY[p];
        const hp = h[p];
        let u: number;
        if (!(hp > 0)) u = y < y0 ? 1 : 0;
        else {
          const t = (y0 - y) / hp;
          u = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
        }
        x = tile[j] + dl[j] * u;
      }
      for (let i = nFirst[j], e = nLast[j]; i <= e; i++) {
        out[i] = x;
        x += bw[i];
      }
    }
    return out;
  }

  /** row() as one walk down the tree (nodeLeft and ownC inlined). */
  private walk(L: Lay, y: number, out: Float64Array): Float64Array {
    this.prep(L);
    const st = this.stack;
    const bw = this.bw;
    const nY = this.nY;
    const par = this.par;
    const nFirst = this.nFirst;
    const nLast = this.nLast;
    const kidsF = this.kidsF;
    const bNode = this.bNode;
    const sY = this.sY;
    const { colL, h, C } = L;
    const tile = L.tile!;
    const dl = L.dl!;
    const tc = L.tc!;
    const dc = L.dc!;
    let n = 0;
    st[n++] = this.rootJ;
    while (n > 0) {
      const j = st[--n];
      if (y >= nY[j]) {
        // (Below its split: its column, its strands side by side in their founders' slots.)
        const p = par[j];
        let x: number;
        if (p < 0) x = colL[j];
        else {
          const y0 = nY[p];
          const hp = h[p];
          let u: number;
          if (!(hp > 0)) u = y < y0 ? 1 : 0;
          else {
            const t = (y0 - y) / hp;
            u = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
          }
          x = tile[j] + dl[j] * u;
        }
        for (let i = nFirst[j], e = nLast[j]; i <= e; i++) {
          out[i] = x;
          x += bw[i];
        }
        continue;
      }
      const K = kidsF[j];
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (k >= 0) st[n++] = k;
        else {
          const i = ~k;
          const hj = h[bNode[i]];
          const y0 = sY[i];
          if (hj > 0 && y <= y0 - hj) out[i] = C[i];
          else {
            let u: number;
            if (!(hj > 0)) u = y < y0 ? 1 : 0;
            else {
              const t = (y0 - y) / hj;
              u = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
            }
            out[i] = tc[i] + dc[i] * u;
          }
        }
      }
    }
    return out;
  }

  /** The rows' arrays let go at a version change (sRows'), used again: no garbage a pinch frame (ToLaD#255). */
  private readonly pool: Float64Array[] = [];
  private release(m: Map<number, Float64Array>, pool: Float64Array[]): void {
    for (const r of m.values()) if (pool.length < 256) pool.push(r);
    m.clear();
  }
  /** Bumped whenever the rows are let go (a version, the cap): the front caches' entries from before stale. */
  private rowsGen = 0;
  /**
   * A front cache before the rows' maps (by world y, a float key): per slot (k & 63) its k, grid, rows generation and
   * row, rowXs', ToLaD#255: the territories (cell) ask the same few rows many times.
   */
  private readonly fK = new Float64Array(64).fill(NaN);
  private readonly fH = new Float64Array(64);
  private readonly fG = new Int32Array(64).fill(-1);
  private readonly fR: (Float64Array | undefined)[] = new Array(64);

  /** The rows' maps let go at a version change or at their cap. */
  private fresh(L: Lay): void {
    if (this.rowsVer !== L.ver || this.sRows.size >= this.rowCap()) {
      this.release(this.sRows, this.pool);
      this.rowsVer = L.ver;
      this.rowsGen++;
    }
  }

  /** Every strand's left (or own column's centre) at world y, cached by y (the draw's grid rows and the territories' alike). */
  private rowAt(L: Lay, y: number): Float64Array {
    let r = this.sRows.get(y);
    if (!r) this.sRows.set(y, (r = this.row(L, y, this.pool.pop() ?? new Float64Array(this.strands.length))));
    return r;
  }

  override rowXs(k: number): Float64Array {
    const L = this.cur();
    this.fresh(L);
    const c = k & 63;
    if (this.fK[c] === k && this.fH[c] === this.gridH && this.fG[c] === this.rowsGen) return this.fR[c]!;
    // (By world y, not by k: the grid's rows a power of two apart, a coarser grid's rows are a finer one's, ToLaD#255.)
    const r = this.rowAt(L, k * this.gridH);
    this.fK[c] = k;
    this.fH[c] = this.gridH;
    this.fG[c] = this.rowsGen;
    this.fR[c] = r;
    return r;
  }

  /**
   * Strands i0..i1 at grid row k as one ribbon (a merged clade, lod.ts): the hull of its strands where they stand, gaps
   * and all (ToLaD#389), those with no width there left out; as wide as their columns there (no room's empty space).
   *
   * Answered from the layout, not from the row (ToLaD#502): a node's run below its split stands in one column, its
   * strands side by side, so its hull is its first strand with founders' left to its last one's right; above its split,
   * its lineages there are walked from the left for the hull's left (from the right for its right), and a daughter
   * whose bound (bounds()) cannot better the edge found is not entered. The work is the hull's edges, not the clade's
   * strands, and nothing is made a row. A run that is no node's (none asked today) is walked strand by strand.
   */
  override extent(i0: number, i1: number, k: number, out: [number, number] = [0, 0]): [number, number] {
    const L = this.cur();
    const y = k * this.gridH;
    const v = this.runNode.get(i0 * (this.strands.length + 1) + i1);
    if (v === undefined || !this.mono) return this.extentOf(L, i0, i1, y, out);
    let lo: number;
    let hi: number;
    if (y >= this.nY[v]) {
      // (Below its split: in one column, side by side.)
      const f = this.fPos[v];
      const l = this.lPos[v];
      lo = f < 0 ? Infinity : this.rowIn(L, f, y);
      hi = f < 0 ? -Infinity : this.rowIn(L, l, y) + this.bw[l];
    } else {
      this.bounds(L);
      lo = this.edgeL(L, v, y);
      hi = this.edgeR(L, v, y);
    }
    if (lo > hi) lo = hi = (this.rowIn(L, i0, y) + this.rowIn(L, i1, y)) / 2;
    out[0] = lo;
    out[1] = hi;
    return out;
  }

  /** extent's walk strand by strand (any run, any tree): each one's place at y (left()) and width there. */
  private extentOf(L: Lay, i0: number, i1: number, y: number, out: [number, number]): [number, number] {
    const age = this.fan.time.ageAt(y);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const own = y < this.sY[i];
      const w = own ? (y < this.tipS[i] ? 0 : laneW(this.strands[i], y, age)) : this.bw[i];
      if (!(w > 0)) continue;
      const x = this.rowIn(L, i, y);
      const l = own ? x - w / 2 : x;
      if (l < lo) lo = l;
      if (l + w > hi) hi = l + w;
    }
    if (lo > hi) lo = hi = (this.rowIn(L, i0, y) + this.rowIn(L, i1, y)) / 2;
    out[0] = lo;
    out[1] = hi;
    return out;
  }

  /**
   * The least left edge at y (above node v's split) of v's lineages there with width: its daughters left to
   * right, a column's its first strand with founders' left, an own column its centre less half its width; a daughter
   * whose bound is no less than the least found so far is passed by (a stack: the order a walk down the left takes).
   */
  private edgeL(L: Lay, v: number, y: number): number {
    const st = this.cutStack;
    const aLo = L.aLo!;
    const cLo = L.cLo!;
    const nY = this.nY;
    let best = Infinity;
    let n = 0;
    st[n++] = v;
    while (n > 0) {
      const j = st[--n];
      if (j >= 0) {
        if (y >= nY[j]) {
          // (A column: its first strand with founders, its left; v's own never comes here.)
          if (cLo[j] >= best) continue;
          const f = this.fPos[j];
          if (f >= 0) best = Math.min(best, this.rowIn(L, f, y));
          continue;
        }
        if (y < this.tipN[j] || aLo[j] >= best) continue;
        const K = this.kidsF[j];
        for (let q = K.length - 1; q >= 0; q--) st[n++] = K[q];
        continue;
      }
      const i = ~j;
      if (y < this.tipS[i] || this.ownLo(L, i) >= best) continue;
      const w = laneW(this.strands[i], y, this.ageAt(y));
      if (w > 0) best = Math.min(best, this.ownC(L, i, y) - w / 2);
    }
    return best;
  }

  /** edgeL's right: the greatest right edge, daughters right to left. */
  private edgeR(L: Lay, v: number, y: number): number {
    const st = this.cutStack;
    const aHi = L.aHi!;
    const cHi = L.cHi!;
    const nY = this.nY;
    let best = -Infinity;
    let n = 0;
    st[n++] = v;
    while (n > 0) {
      const j = st[--n];
      if (j >= 0) {
        if (y >= nY[j]) {
          if (cHi[j] <= best) continue;
          const l = this.lPos[j];
          if (l >= 0) best = Math.max(best, this.rowIn(L, l, y) + this.bw[l]);
          continue;
        }
        if (y < this.tipN[j] || aHi[j] <= best) continue;
        const K = this.kidsF[j];
        for (let q = 0; q < K.length; q++) st[n++] = K[q];
        continue;
      }
      const i = ~j;
      if (y < this.tipS[i] || this.ownHi(L, i) <= best) continue;
      const w = laneW(this.strands[i], y, this.ageAt(y));
      if (w > 0) best = Math.max(best, this.ownC(L, i, y) - w / 2 + w);
    }
    return best;
  }

  /** The age at world height y (the time scale's), kept by y (64 slots by its row): a frame's clades ask the same rows. */
  private ageAt(y: number): number {
    const c = Math.floor(y / this.gridH) & 63;
    if (this.ageY[c] !== y) {
      this.ageY[c] = y;
      this.ageV[c] = this.fan.time.ageAt(y);
    }
    return this.ageV[c];
  }
  private readonly ageY = new Float64Array(64).fill(NaN);
  private readonly ageV = new Float64Array(64);

  /** Strand i's own column's reach at any height (its founders' slot to its room's centre, at its widest), a hair wide. */
  private ownLo(L: Lay, i: number): number {
    return Math.min(L.tc![i], L.C[i]) - this.mx[i] / 2 - this.eps;
  }
  private ownHi(L: Lay, i: number): number {
    return Math.max(L.tc![i], L.C[i]) + this.mx[i] / 2 + this.eps;
  }
  /** The bounds' hair (world): far above the sums' rounding, far below a pixel at any zoom the camera allows. */
  private eps = 0;

  /**
   * The rooms' bounds into L (once per layout): per node its column's reach over its span, and its lineages' reach above
   * its split, daughters first (Lay.cLo..aHi). Each widened by a hair (eps), so a rounding never prunes a lineage.
   */
  private bounds(L: Lay): void {
    if (L.aLo) return;
    this.prep(L);
    const n = this.nY.length;
    const { colL, C } = L;
    const tile = L.tile!;
    const tc = L.tc!;
    const cLo = new Float64Array(n);
    const cHi = new Float64Array(n);
    const aLo = new Float64Array(n);
    const aHi = new Float64Array(n);
    let E = 1;
    for (let j = 0; j < n; j++) {
      const c = colL[j];
      const t = this.par[j] < 0 ? c : tile[j];
      cLo[j] = Math.min(t, c);
      cHi[j] = Math.max(t, c) + this.wc[j];
      E = Math.max(E, Math.abs(cLo[j]), Math.abs(cHi[j]));
    }
    for (let j = n - 1; j >= 0; j--) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const k of this.kidsF[j]) {
        if (k >= 0) {
          lo = Math.min(lo, cLo[k], aLo[k]);
          hi = Math.max(hi, cHi[k], aHi[k]);
        } else {
          const i = ~k;
          const w = this.mx[i] / 2;
          lo = Math.min(lo, Math.min(tc[i], C[i]) - w);
          hi = Math.max(hi, Math.max(tc[i], C[i]) + w);
        }
      }
      aLo[j] = lo;
      aHi[j] = hi;
      if (lo <= hi) E = Math.max(E, Math.abs(lo), Math.abs(hi));
    }
    const eps = 1e-9 * E;
    for (let j = 0; j < n; j++) {
      cLo[j] -= eps;
      cHi[j] += eps;
      aLo[j] -= eps;
      aHi[j] += eps;
    }
    this.eps = eps;
    L.cLo = cLo;
    L.cHi = cHi;
    L.aLo = aLo;
    L.aHi = aHi;
  }

  /** How many rows a cache keeps (a row is a float per strand: some 50 MB at most each, the mammals' ~1,000 rows). */
  private rowCap(): number {
    return 4096;
  }


  override setScale(sx: number, screenW: number): boolean {
    if (sx === this.sx && screenW === this.screenW) return false;
    if (!this.open) return super.setScale(sx, screenW);
    this.sx = sx;
    this.screenW = screenW;
    return false;
  }

  override opennessAt(sx: number, screenW: number, out: Float64Array = new Float64Array(this.a.length)): Float64Array {
    return this.open ? out.fill(1) : super.opennessAt(sx, screenW, out);
  }

  override openOne(i: number, sx: number, screenW: number): number {
    return this.open ? 1 : super.openOne(i, sx, screenW);
  }

  override openRamp(i: number, screenW: number): [number, number] | null {
    return this.open ? null : super.openRamp(i, screenW);
  }

  /**
   * The rooms as they stand (cut.ts's territories, ToLaD#333): per node (fan.nodes' order) its room's left edge and
   * width, per strand (drawn order) its own column's centre (its room's) and its room's width, world x. Read only.
   */
  rooms(): { roomL: Float64Array; roomW: Float64Array; C: Float64Array; R: Float64Array } {
    const L = this.cur();
    return { roomL: L.roomL, roomW: L.roomW, C: L.C, R: this.room };
  }

  /**
   * Per-row territories (ToLaD#333): strands f..l's (drawn order, a node's run or a run of its daughters) share of the
   * rows from world y `ya` to `yb` (world x, `out`; empty, out[0] >= out[1], where they have no lineage). `anchor`: the
   * one of them their share is taken around in a row whose sites cross (crossedCell).
   *
   * At a row the lineages there split x between them, each boundary the middle of the gap between neighbours' drawn
   * edges: a 1D Voronoi of the row, over the drawn order (the columns stand in it left to right). A strand's lineage is
   * its slot in a parent column, its own column while it lives (laneW wide), and for `ghost` (world height) above its
   * tip the point its column ended at, where its picture stands. Strands f..l take their lineages' cells together; over
   * rows, the intersection. Two runs of strands that do not overlap have disjoint shares at every row, so labels placed
   * in their own shares never meet, whatever the times they stand at.
   *
   * The rows are fixed in the world (TERR_H apart), never the draw's grid (finer at rest than while moving, and by the
   * time zoom): a row's share is a function of the layout alone (rowCell). Between two rows the shares are the linear
   * blend of theirs, both split among the lower row's lineages (those born in between counted at both), so at every y
   * disjoint runs keep disjoint shares, and the territory, this blend's intersection over ya..yb (its ends and the rows
   * inside), moves continuously as its label's rows do; it steps only where a lineage is born, at a row fixed in the
   * world. Each row is a scan from f and l to the nearest lineages.
   */
  cell(f: number, l: number, ya: number, yb: number, ghost: number, out: [number, number] = [0, 0], anchor = l): [number, number] {
    const H = TERR_H;
    if (yb < ya) [ya, yb] = [yb, ya];
    const L = this.cur();
    const r = this.rootJ;
    let lo = L.roomL[r];
    let hi = L.roomL[r] + L.roomW[r];
    let any = false;
    const c = this.cellC;
    const d = this.cellD;
    // (At y between rows k and k + 1, the blend of the two, both split among row k + 1's lineages.)
    const at = (y: number) => {
      const k = Math.floor(y / H);
      if (!this.rowCell(f, l, k, ghost, c, true, anchor) || !this.rowCell(f, l, k + 1, ghost, d, false, anchor)) return;
      const t = y / H - k;
      any = true;
      lo = Math.max(lo, c[0] + t * (d[0] - c[0]));
      hi = Math.min(hi, c[1] + t * (d[1] - c[1]));
    };
    const row = (k: number, below: boolean) => {
      if (!this.rowCell(f, l, k, ghost, c, below, anchor)) return;
      any = true;
      lo = Math.max(lo, c[0]);
      hi = Math.min(hi, c[1]);
    };
    at(ya);
    at(yb);
    // (A row inside: the blend's ends on both sides of it, the stretch above's and the one below's.)
    for (let k = Math.floor(ya / H) + 1; k * H < yb && lo < hi; k++) {
      row(k, false);
      row(k, true);
    }
    if (!any) {
      lo = Infinity;
      hi = -Infinity;
    }
    out[0] = lo;
    out[1] = hi;
    return out;
  }
  private readonly cellC: [number, number] = [0, 0];
  private readonly cellD: [number, number] = [0, 0];

  /**
   * Strands f..l's share of territory row k (world y k * TERR_H) into `out`; false where they have no lineage there.
   * Cached per version and ghost (the cost cache, ToLaD#333): a function of the layout alone; a frame asks the same rows
   * of the same runs again and again (the cut's daughters, its items' labels), and a pan or a
   * frame at rest asks the last frame's.
   */
  private rowCell(f: number, l: number, k: number, ghost: number, out: [number, number], below: boolean, anchor: number): boolean {
    const L = this.cur();
    this.fresh(L);
    const N = this.strands.length;
    const key = (((k + 0x100000) * 2 + (below ? 1 : 0)) * N + f) * N + l;
    const M = this.cellMemo;
    if (this.memoVer !== L.ver || this.memoGhost !== ghost || M.size >= 1 << 18) {
      M.clear();
      this.crossMemo.clear();
      this.crossedRuns.clear();
      this.memoN = 0;
      this.memoVer = L.ver;
      this.memoGhost = ghost;
    }
    const hit = M.get(key);
    if (hit !== undefined) {
      out[0] = this.memoV[hit];
      out[1] = this.memoV[hit + 1];
      const there = out[0] === out[0];
      if (there && this.crossedRuns.has(key)) this.crossedCell(L, f, l, k, ghost, below, anchor, out);
      return there;
    }
    const ok = this.rowCellNow(L, f, l, k, ghost, out, below);
    if (this.memoV.length < this.memoN + 2) {
      const v = new Float64Array(Math.max(1024, 2 * this.memoV.length));
      v.set(this.memoV);
      this.memoV = v;
    }
    this.memoV[this.memoN] = ok ? out[0] : NaN;
    this.memoV[this.memoN + 1] = out[1];
    M.set(key, this.memoN);
    this.memoN += 2;
    if (ok && this.crossedNow) {
      this.crossedRuns.add(key);
      this.crossedCell(L, f, l, k, ghost, below, anchor, out);
    }
    return ok;
  }
  private readonly cellMemo = new Map<number, number>();
  private memoV = new Float64Array(0);
  private memoN = 0;
  private memoVer = -1;
  private memoGhost = NaN;

  private rowCellNow(L: Lay, f: number, l: number, k: number, ghost: number, out: [number, number], below: boolean): boolean {
    const y = k * TERR_H;
    const xs = this.rowAt(L, y);
    const age = this.fan.time.ageAt(y);
    // (`below`: the lineages of row k + 1, those born between the two rows where they are there, so both ends of the
    // stretch split x among the same lineages and the blend between them keeps every pair in order.)
    const y2 = (k + 1) * TERR_H;
    const xs2 = below ? this.rowAt(L, y2) : xs;
    const age2 = below ? this.fan.time.ageAt(y2) : age;
    const has = (i: number) => this.site(i, y, age, xs, ghost) || (below && this.site(i, y2, age2, xs2, ghost));
    const e = this.edge;
    const N = this.strands.length;
    let a = f;
    while (a <= l && !has(a)) a++;
    if (a > l) return false;
    const La = e[0];
    let b = l;
    while (!has(b)) b--;
    const Rb = e[1];
    const r = this.rootJ;
    out[0] = L.roomL[r];
    out[1] = L.roomL[r] + L.roomW[r];
    let p = f - 1;
    while (p >= 0 && !has(p)) p--;
    if (p >= 0) out[0] = (e[1] + La) / 2;
    let n = l + 1;
    while (n < N && !has(n)) n++;
    if (n < N) out[1] = (Rb + e[0]) / 2;
    const W = this.crossings(k, below, has);
    this.crossedNow = W.length > 0 && (inRanges(W, a) || inRanges(W, b) || (p >= 0 && inRanges(W, p)) || (n < N && inRanges(W, n)));
    return true;
  }
  /**
   * Row k's stretches of strands (drawn order, [first, last] pairs, usually none) whose sites are out of that order: an
   * ended lineage's point stands at its room's centre, and a later neighbour's room, by life, may lie past it. Merged the
   * way a monotone stack merges: outside them the row is in order, and they do not overlap each other in x.
   */
  private crossings(k: number, below: boolean, has: (i: number) => boolean): Int32Array {
    const key = (k + 0x100000) * 2 + (below ? 1 : 0);
    let W = this.crossMemo.get(key);
    if (W) return W;
    const N = this.strands.length;
    const e = this.edge;
    const { crossL: mn, crossR: mx, crossF: first, crossE: end } = this;
    let top = 0;
    for (let i = 0; i < N; i++) {
      if (!has(i)) continue;
      let [lo, hi, s] = [e[0], e[1], i];
      while (top > 0 && mx[top - 1] > lo + 1e-9) {
        top--;
        lo = Math.min(lo, mn[top]);
        hi = Math.max(hi, mx[top]);
        s = first[top];
      }
      mn[top] = lo;
      mx[top] = hi;
      first[top] = s;
      end[top] = i;
      top++;
    }
    const out: number[] = [];
    for (let t = 0; t < top; t++) if (end[t] > first[t]) out.push(first[t], end[t]);
    W = Int32Array.from(out);
    this.crossMemo.set(key, W);
    return W;
  }
  /**
   * Strands f..l's share of a row where crossings() touch them: the block, among the row's sites taken by x, that holds
   * `anchor` (one of them) and only them, split from the next site on each side as ever. Two runs' blocks hold different
   * sites, so their shares stay disjoint; a run holds what its anchor's own share does.
   */
  private crossedCell(L: Lay, f: number, l: number, k: number, ghost: number, below: boolean, anchor: number, out: [number, number]): void {
    const y = k * TERR_H;
    const xs = this.rowAt(L, y);
    const age = this.fan.time.ageAt(y);
    const y2 = (k + 1) * TERR_H;
    const xs2 = below ? this.rowAt(L, y2) : xs;
    const age2 = below ? this.fan.time.ageAt(y2) : age;
    const has = (i: number) => this.site(i, y, age, xs, ghost) || (below && this.site(i, y2, age2, xs2, ghost));
    const W = this.crossings(k, below, has);
    const N = this.strands.length;
    const e = this.edge;
    const from = (i: number) => {
      const w = rangeAt(W, i);
      return w < 0 ? i : W[w];
    };
    const to = (i: number) => {
      const w = rangeAt(W, i);
      return w < 0 ? i : W[w + 1];
    };
    let c0 = from(f);
    let p = c0 - 1;
    while (p >= 0 && !has(p)) p--;
    if (p >= 0) c0 = from(p);
    let c1 = to(l);
    let n = c1 + 1;
    while (n < N && !has(n)) n++;
    if (n < N) c1 = to(n);
    const sites: { i: number; lo: number; hi: number }[] = [];
    for (let i = c0; i <= c1; i++) if (has(i)) sites.push({ i, lo: e[0], hi: e[1] });
    sites.sort((u, v) => u.lo + u.hi - v.lo - v.hi || u.i - v.i);
    // (Its anchor has no lineage here where its label's rows are a wider clade's: then its youngest that has.)
    let young = -1;
    for (const s of sites) if (s.i >= f && s.i <= l && (young < 0 || this.tipS[s.i] < this.tipS[young])) young = s.i;
    let at = sites.findIndex((s) => s.i === anchor);
    if (at < 0) at = sites.findIndex((s) => s.i === young);
    const r = this.rootJ;
    out[0] = L.roomL[r];
    out[1] = L.roomL[r] + L.roomW[r];
    const mine = (i: number) => i >= f && i <= l;
    let [lo, hi] = [sites[at].lo, sites[at].hi];
    for (let q = at - 1; q >= 0; q--) {
      const s = sites[q];
      if (!mine(s.i)) {
        out[0] = (s.hi + lo) / 2;
        break;
      }
      lo = Math.min(lo, s.lo);
    }
    for (let q = at + 1; q < sites.length; q++) {
      const s = sites[q];
      if (!mine(s.i)) {
        out[1] = (hi + s.lo) / 2;
        break;
      }
      hi = Math.max(hi, s.hi);
    }
  }
  private readonly crossMemo = new Map<number, Int32Array>();
  /** The memo's runs a crossing touches (rowCell): their shares depend on the anchor, so they are not kept in it. */
  private readonly crossedRuns = new Set<number>();
  private crossedNow = false;
  private readonly crossL: Float64Array;
  private readonly crossR: Float64Array;
  private readonly crossF: Int32Array;
  private readonly crossE: Int32Array;
  /** site()'s edges. */
  private readonly edge: [number, number] = [0, 0];
  /** Whether strand i has a lineage at row y (age `age`, the row's xs), its drawn edges into `edge` (cell()). */
  private site(i: number, y: number, age: number, xs: Float64Array, ghost: number): boolean {
    const e = this.edge;
    if (y >= this.sY[i]) {
      e[0] = xs[i];
      e[1] = xs[i] + this.bw[i];
      return true;
    }
    const t = this.tipS[i];
    if (y >= t) {
      const w = laneW(this.strands[i], y, age) / 2;
      e[0] = xs[i] - w;
      e[1] = xs[i] + w;
      return true;
    }
    if (y < t - ghost) return false;
    e[0] = e[1] = xs[i];
    return true;
  }

  override setAll(a: number, all = false): void {
    super.setAll(a, all);
    if (this.open) this.a.fill(1);
  }

  /** The order's extent as home shows it (the splits inside families closed): its root's room. */
  override homeExtent(): [number, number] {
    if (this.homeExtS) return this.homeExtS;
    const A = Float64Array.from(this.a, (_, i) => (this.open || !this.folds(i) ? 1 : 0));
    const L = this.compute(A);
    const r = this.idx.get(this.fan.root)!;
    return (this.homeExtS = [L.roomL[r], L.roomL[r] + L.roomW[r]]);
  }

  /** The columns at y left to right (rooms for own columns, parent columns whole): [left, width] per item. */
  private items(L: Lay, y: number): [Float64Array, Float64Array] {
    const xs = this.row(L, y, new Float64Array(this.strands.length));
    const X: number[] = [];
    const Wd: number[] = [];
    let last: FanNode | null = null;
    for (let i = 0; i < xs.length; i++) {
      const b = this.strands[i];
      if (y < b.splitY) {
        last = null;
        X.push(xs[i] - this.room[i] / 2);
        Wd.push(this.room[i]);
        continue;
      }
      const s = segAt(b, y);
      if (s.node === last) continue;
      last = s.node;
      X.push(xs[i] - s.off);
      Wd.push(s.node.width);
    }
    return [Float64Array.from(X), Float64Array.from(Wd)];
  }

  /**
   * Where world point (x, y) goes when the a's change from `prev`'s: the same place in the same column, or the same
   * share of the same gap.
   *
   * The columns at y left to right are the tree cut at y: a node spanning y one column ([its left, its width]), a strand
   * above its split one own column (its room about its centre). The first whose right reaches x (or the gap before it,
   * if x falls short of its left) is found walking that cut from the left, a daughter whose columns all end left of x
   * (its bound, bounds()) passed by whole (ToLaD#502): the walk is the tree's depth, not its columns, and each place is
   * worked out as the row does, so the answer is the one the whole row gave. `prev`'s layout is the one it was taken at:
   * the last one laid out, or laid out once and kept with it.
   */
  override follow(x: number, y: number, prev: FoldState): number {
    const L1 = this.cur();
    const L0 = this.layOf(prev);
    if (!this.mono) return this.followRows(x, y, L0, L1);
    this.bounds(L0);
    const aHi = L0.aHi!;
    const nY = this.nY;
    const st = this.cutStack;
    let n = 0;
    let last = 0;
    let has = false;
    st[n++] = this.rootJ;
    while (n > 0) {
      const e = st[--n];
      if (e >= 0 && y < nY[e]) {
        // (Every column under it ends left of x: passed by, its last kept for a gap after it.)
        if (aHi[e] < x) {
          last = this.lastAt(e, y);
          has = true;
          continue;
        }
        const K = this.kidsF[e];
        for (let q = K.length - 1; q >= 0; q--) st[n++] = K[q];
        continue;
      }
      const X0 = this.itemX(L0, e, y);
      if (has && x < X0) {
        // (In the gap before it: the same share of the same gap.)
        const Wl = this.itemW(last);
        const R0 = this.itemX(L0, last, y) + Wl;
        const t = (x - R0) / (X0 - R0);
        const R1 = this.itemX(L1, last, y) + Wl;
        return R1 + t * (this.itemX(L1, e, y) - R1);
      }
      if (x <= X0 + this.itemW(e)) return x + this.itemX(L1, e, y) - X0;
      last = e;
      has = true;
    }
    return has ? x + this.itemX(L1, last, y) - this.itemX(L0, last, y) : x;
  }

  /** follow's column at y, by its id (a node spanning y, or ~ a strand above its split): its left in layout L, as row() has it. */
  private itemX(L: Lay, e: number, y: number): number {
    return e >= 0 ? this.nodeLeft(L, e, y) : this.ownC(L, ~e, y) - this.room[~e] / 2;
  }
  private itemW(e: number): number {
    return e >= 0 ? this.nW[e] : this.room[~e];
  }
  /** The last column at y under node j (y above its split): down its last daughters. */
  private lastAt(j: number, y: number): number {
    for (;;) {
      const K = this.kidsF[j];
      const k = K[K.length - 1];
      if (k < 0 || y >= this.nY[k]) return k;
      j = k;
    }
  }

  /** The layouts follow was asked from, by the snapshot (a flight asks from its two ends every frame). */
  private readonly lays = new WeakMap<FoldState, Lay>();
  /** The layout before the current one (cur() moves it here): a pinch's snapshot is of it. */
  private layPrev: Lay | null = null;
  /** The layout at `prev`'s a's: one laid out already if the a's are the same, else laid out once (and kept with it). */
  private layOf(prev: FoldState): Lay {
    let L = this.lays.get(prev);
    if (L) return L;
    const a = prev.a;
    const same = (M: Lay | null): M is Lay => {
      if (!M || M.A.length !== a.length) return false;
      for (let i = 0; i < a.length; i++) if (M.A[i] !== a[i]) return false;
      return true;
    };
    L = same(this.lay) ? this.lay : same(this.layPrev) ? this.layPrev : this.compute(a);
    this.lays.set(prev, L);
    return L;
  }

  /**
   * Whether strand i stands wholly to one side of world x [xa, xb] at every height in [y0, y1] (drawStrand's cull,
   * ToLaD#502), so its exact reach there (Tess.xRange, over the grid's rows) need not be worked out: true only where
   * that reach, with its margins, falls off the same side. Answered by one walk down the tree a layout and window,
   * from the rooms' bounds: a clade off to one side is passed by whole, one wholly on screen taken whole.
   */
  offSide(i: number, y0: number, y1: number, xa: number, xb: number): boolean {
    if (!this.marked(y0, y1, xa, xb)) return false;
    return this.cand[i] !== this.candGen;
  }

  /**
   * Whether strands i0..i1 (a merged clade, drawMerged) all stand wholly to one side of world x [xa, xb] at every height
   * in [y0, y1], each beyond its own margins: offSide's walk passed by a clade holding them all (its runs, in order).
   */
  offSideRun(i0: number, i1: number, y0: number, y1: number, xa: number, xb: number): boolean {
    if (!this.marked(y0, y1, xa, xb)) return false;
    const R = this.offRuns;
    let a = 0;
    let z = this.offN;
    // (The last run starting at or before i0.)
    while (a < z) {
      const m = (a + z) >> 1;
      if (R[2 * m] <= i0) a = m + 1;
      else z = m;
    }
    return a > 0 && R[2 * (a - 1) + 1] >= i1;
  }

  /** offSide's walk for this layout and window, made if not yet: false where it cannot be (no grid, a tree not mono). */
  private marked(y0: number, y1: number, xa: number, xb: number): boolean {
    const L = this.cur();
    const H = this.gridH;
    if (!this.mono || !(H > 0)) return false;
    const c = this.candKey;
    if (c[0] !== L.ver || c[1] !== H || c[2] !== y0 || c[3] !== y1 || c[4] !== xa || c[5] !== xb || this.candLay !== L) {
      c[0] = L.ver;
      c[1] = H;
      c[2] = y0;
      c[3] = y1;
      c[4] = xa;
      c[5] = xb;
      this.candLay = L;
      this.marks(L, Math.floor(y0 / H) * H, Math.ceil(y1 / H) * H, xa, xb);
    }
    return true;
  }
  /** The runs of strands (first, last; drawn order, disjoint, ascending) offSide's walk passed by whole. */
  private readonly offRuns: Int32Array;
  private offN = 0;
  private readonly candKey = new Float64Array(6).fill(NaN);
  private candLay: Lay | null = null;
  /** Per strand: the walk's generation if it may show (offSide). */
  private readonly cand: Int32Array;
  private candGen = 0;
  /** Per node: its strands' widest (mx), the most. */
  private mxN: Float64Array | null = null;

  /** offSide's walk: marks the strands whose places over the grid's rows in [ya, yb] may reach world x [xa, xb]. */
  private marks(L: Lay, ya: number, yb: number, xa: number, xb: number): void {
    this.bounds(L);
    const gen = ++this.candGen;
    const cand = this.cand;
    const runs = this.offRuns;
    this.offN = 0;
    const off = (a: number, b: number) => {
      runs[2 * this.offN] = a;
      runs[2 * this.offN++ + 1] = b;
    };
    // (Past the rows xRange reads one by one (XR_ROWS), its reach is widened where the edge turns back: every strand may show.)
    if (!(yb >= ya) || (yb - ya) / this.gridH > 512) {
      cand.fill(gen);
      return;
    }
    const nY = this.nY;
    const nYp = this.nYp;
    const { cLo, cHi, aLo, aHi } = L as Required<Lay>;
    const tc = L.tc!;
    const C = L.C;
    const mx = this.mx;
    let mxN = this.mxN;
    if (!mxN) {
      mxN = this.mxN = new Float64Array(nY.length);
      for (let j = nY.length - 1; j >= 0; j--) {
        let m = 0;
        for (const k of this.kidsF[j]) m = Math.max(m, k >= 0 ? mxN[k] : mx[~k]);
        mxN[j] = m;
      }
    }
    // (Off to one side with xRange's own margins: its widest, and its pad, from a reach no narrower than its own.)
    const side = (lo: number, hi: number, m: number): number => {
      const l = lo - m;
      const r = hi + m;
      const pad = 1e-6 * Math.max(1, Math.abs(l), Math.abs(r)) + (r - l) * 1e-3;
      return r + pad < xa ? -1 : l - pad > xb ? 1 : l - pad >= xa && r + pad <= xb ? 2 : 0;
    };
    const all = (j: number) => {
      for (let i = this.nFirst[j], e = this.nLast[j]; i <= e; i++) cand[i] = gen;
    };
    // (A stack of [node, or ~ a strand; the reach of its strands' places in its ancestors' columns over the window], in
    // drawn order: the runs passed by come out ascending.)
    const st = this.cutStack;
    const lo = this.walkLo;
    const hi = this.walkHi;
    let n = 0;
    st[n] = this.rootJ;
    lo[n] = Infinity;
    hi[n++] = -Infinity;
    while (n > 0) {
      n--;
      const j = st[n];
      let pl = lo[n];
      let ph = hi[n];
      if (j < 0) {
        // (A strand above its parent's split: its own column's reach too.)
        const q = ~j;
        const w = mx[q] / 2 + this.eps;
        const t = side(Math.min(pl, Math.min(tc[q], C[q]) - w), Math.max(ph, Math.max(tc[q], C[q]) + w), mx[q]);
        if (t === 0 || t === 2) cand[q] = gen;
        else off(q, q);
        continue;
      }
      // (Its column, if the window meets its span.)
      if (yb >= nY[j] && ya < nYp[j]) {
        pl = Math.min(pl, cLo[j]);
        ph = Math.max(ph, cHi[j]);
      }
      const above = ya < nY[j];
      const s = above ? side(Math.min(pl, aLo[j]), Math.max(ph, aHi[j]), mxN[j]) : side(pl, ph, mxN[j]);
      if (s === -1 || s === 1) {
        off(this.nFirst[j], this.nLast[j]);
        continue;
      }
      if (s === 2 || !above) {
        all(j);
        continue;
      }
      const K = this.kidsF[j];
      for (let q = K.length - 1; q >= 0; q--) {
        st[n] = K[q];
        lo[n] = pl;
        hi[n++] = ph;
      }
    }
  }
  /** The cut walks' stack (edgeL, edgeR, follow): nodes and strands alike. */
  private readonly cutStack: Int32Array;
  private readonly walkLo: Float64Array;
  private readonly walkHi: Float64Array;

  /** follow by the whole rows (a tree whose splits are not each under its parent's): every column at y, left to right. */
  private followRows(x: number, y: number, L0: Lay, L1: Lay): number {
    const [X0, W] = this.items(L0, y);
    const [X1] = this.items(L1, y);
    const n = X0.length;
    if (n === 0) return x;
    if (x <= X0[0]) return x + X1[0] - X0[0];
    for (let j = 0; j < n; j++) {
      const R0 = X0[j] + W[j];
      if (x <= R0) return x + X1[j] - X0[j];
      if (j + 1 < n && x < X0[j + 1]) {
        const t = (x - R0) / (X0[j + 1] - R0);
        const R1 = X1[j] + W[j];
        return R1 + t * (X1[j + 1] - R1);
      }
    }
    return x + X1[n - 1] - X0[n - 1];
  }
}
