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

import { ease, isNode, laneW, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { Fold, ROOM_BEND, gapMode, type FoldState, type GapMode } from './fold';

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
  private readonly winW = new Map<string, number>();

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
    return { ver: this.ver, colL, roomL, roomW, h, C };
  }

  /** Strand i's widest from its split up to window bottom t0 (world y; its tip if later): laneW sampled, its founders' at the split. */
  private widestSince(i: number, t0: number): number {
    const b = this.strands[i];
    const lo = Math.max(t0, b.tipY);
    const key = `${i} ${lo}`;
    let w = this.winW.get(key);
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
    this.winW.set(key, w);
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
          else {
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
    return { ver: this.ver, colL, roomL, roomW, h, C };
  }

  /** The current layout (at the fold's version and zoom). */
  private cur(): Lay {
    const L = this.lay;
    if (L && L.ver === this.ver) return L;
    return (this.lay = this.compute(this.a));
  }

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
  setMerged(merged: readonly FanNode[], top: (v: FanNode) => number): void {
    for (const j of this.stemTopSet) this.stemTop[j] = this.nY[j];
    this.stemTopSet.length = 0;
    for (const v of merged) {
      const j = this.idx.get(v)!;
      this.stemTop[j] = Math.max(top(v), this.yNow);
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

  /** Each split whose fork and room meet the screen (world heights and x): ~13,000 nodes at the mammal level, most off it. */
  splitsOn(yTop: number, yBot: number, x0: number, x1: number, visit: (j: number, top: number) => void): void {
    const { h, roomL, roomW } = this.cur();
    const nY = this.nY;
    for (let j = 0; j < nY.length; j++) {
      if (nY[j] < yTop || nY[j] - h[j] > yBot || roomL[j] > x1 || roomL[j] + roomW[j] < x0) continue;
      visit(j, nY[j] - h[j]);
    }
  }

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
    const L = this.cur();
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
   * row, rowXs' (and widthSums', by its own generation), ToLaD#255: a frame asks the same few rows
   * thousands of times (xTable, every merged clade's extent).
   */
  private readonly fK = new Float64Array(64).fill(NaN);
  private readonly fH = new Float64Array(64);
  private readonly fG = new Int32Array(64).fill(-1);
  private readonly fR: (Float64Array | undefined)[] = new Array(64);
  private readonly wK = new Float64Array(64).fill(NaN);
  private readonly wH = new Float64Array(64);
  private readonly wG = new Int32Array(64).fill(-1);
  private readonly wR: ([Float64Array, Float64Array] | undefined)[] = new Array(64);
  private extGen = 0;

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
   * Strands i0..i1 at grid row k as one ribbon (a merged clade, lod.ts): as wide as their columns there (no room's
   * empty space), centred on their founders' mean centre (constant between the clade's splits).
   */
  override extent(i0: number, i1: number, k: number, out: [number, number] = [0, 0]): [number, number] {
    // (The hull of its strands where they stand, gaps and all (ToLaD#389): their widths summed about their middle leave
    // strands outside it now the gaps stay open, and a wide own column need not stand between its neighbours.)
    const [cW] = this.widthSums(k);
    const xs = this.rowXs(k);
    const y = k * this.gridH;
    const sY = this.sY;
    let L = Infinity;
    let R = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const w = cW[i + 1] - cW[i];
      if (!(w > 0)) continue;
      // (rowXs: a left edge, or an own column's centre.)
      const l = y < sY[i] ? xs[i] - w / 2 : xs[i];
      if (l < L) L = l;
      if (l + w > R) R = l + w;
    }
    if (L > R) L = R = (xs[i0] + xs[i1]) / 2;
    out[0] = L;
    out[1] = R;
    return out;
  }

  /** Grid row k's widths summed along the drawn order (its columns', and its live strands' founders'): the same at every version. */
  private widthSums(k: number): [Float64Array, Float64Array] {
    const c = k & 63;
    if (this.wK[c] === k && this.wH[c] === this.gridH && this.wG[c] === this.extGen) return this.wR[c]!;
    const y = k * this.gridH;
    if (this.extW.size >= this.rowCap()) {
      this.extW.clear();
      this.extGen++;
    }
    let r = this.extW.get(y);
    if (!r) {
      const age = this.fan.time.ageAt(y);
      const S = this.strands;
      const cW = new Float64Array(S.length + 1);
      const cB = new Float64Array(S.length + 1);
      for (let i = 0; i < S.length; i++) {
        const b = S[i];
        const own = y < b.splitY;
        const dead = own && y < b.tipY;
        cW[i + 1] = cW[i] + (dead ? 0 : own ? laneW(b, y, age) : b.baseW);
        cB[i + 1] = cB[i] + (dead ? 0 : b.baseW);
      }
      this.extW.set(y, (r = [cW, cB]));
    }
    this.wK[c] = k;
    this.wH[c] = this.gridH;
    this.wG[c] = this.extGen;
    this.wR[c] = r;
    return r;
  }
  private readonly extW = new Map<number, [Float64Array, Float64Array]>();
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

  /** Where world point (x, y) goes when the a's change from `prev`'s: the same place in the same column, or the same share of the same gap. */
  override follow(x: number, y: number, prev: FoldState): number {
    const [X0, W] = this.items(this.compute(prev.a), y);
    const [X1] = this.items(this.cur(), y);
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
