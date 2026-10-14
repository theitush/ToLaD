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
//     relatedness, GAP_K/OPEN_Z: a * pairGap, opening with the width zoom), the same at every height. Its parent
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
// so there is no anchor (setAnchor never moves anything), and a row is one walk down the tree: no refolding.
//
// It is a Fold to the view (the same interface: left, rowXs, extent, setScale, follow, homeExtent...), chosen by
// the default (wantSteady; ?layout=fold for the fold, ToLaD#273). At the cats' level (the view's `folds` off) every split is open, at every zoom.

import { ease, isNode, laneW, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { Fold, ROOM_BEND, type FoldState } from './fold';

/** A split's fork is at most this share of its shortest daughter's run (to its own split or tip). */
export const STEADY_RUN = 0.85;

/** Rooms by life: the gap between two daughters where one is a fossil is at most this share of their extents together while both lived. */
export const LIFE_GAP = 0.5;

/** Rooms by life: a strand's widest over a window is laneW at this many steps (and its ends). */
const LIFE_SAMPLES = 48;

/** Whether the steady layout is in use: the default (ToLaD#273); ?layout=fold, or TOLAD_LAYOUT=fold in node (tests, perf runs), brings the fold back. */
export function wantSteady(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('layout') === 'fold') return false;
  } catch {
    /* no URL */
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.TOLAD_LAYOUT !== 'fold';
}

/**
 * Whether a level whose living members dwarf its fossils is framed on the fossils (ToLaD#289): ?fit=fossils, or
 * TOLAD_FIT=fossils in node; the globe menu's "Fit fossils". It turns on the rooms by life (wantLifeRooms) too. Off by default.
 */
export function wantFitFossils(): boolean {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('fit');
      if (q) return q === 'fossils';
    }
  } catch {
    /* no URL */
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.TOLAD_FIT === 'fossils';
}

/**
 * Whether a fossil's room is only what it stood beside while it lived (ToLaD#289): ?rooms=life, or TOLAD_ROOMS=life
 * in node. Off by default: every room is its widest ever, so a hominin fossil stands beside the humans' 8e9-wide room.
 */
export function wantLifeRooms(): boolean {
  if (wantFitFossils()) return true;
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('rooms');
      if (q) return q === 'life';
    }
  } catch {
    /* no URL */
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.TOLAD_ROOMS === 'life';
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
  private readonly idx = new Map<FanNode, number>();
  /** Flat copies for the row walk (row(): ~5,900 strands a row at the mammal level): per node its split's height, its
   * strands' run [first, last] and its daughters (a node's index, or ~ a strand's); per strand its founders' width, its
   * split's height and its founders' slot centre's offset in its split's column. */
  private readonly nY: Float64Array;
  private readonly nW: Float64Array;
  private readonly nFirst: Int32Array;
  private readonly nLast: Int32Array;
  private readonly kidsF: Int32Array[];
  private readonly bw: Float64Array;
  private readonly sY: Float64Array;
  private readonly tcOff: Float64Array;
  private readonly rootJ: number;
  private readonly stack: Int32Array;
  private lay: Lay | null = null;
  private rowsVer = -1;
  private readonly sRows = new Map<number, Float64Array>();
  private homeExtS: [number, number] | null = null;
  /** Rooms by life: per strand its tip, per node its last tip (the youngest), now's height; a strand's widest in a window (laneW sampled), by `${i} ${t0}`. */
  private readonly tipS: Float64Array;
  private readonly tipN: Float64Array;
  private readonly yNow: number;
  private readonly winW = new Map<string, number>();

  /** open: every split open at every zoom (the cats' level), else the fold's openness by zoom. */
  constructor(
    fan: Fan,
    readonly open = false,
    /** Rooms by life (wantLifeRooms, ToLaD#289): an extinct daughter and its sister stand apart by their extents while both lived. */
    readonly life = wantLifeRooms(),
  ) {
    super(fan);
    // (A boom stands centred in its room like any column: its centre is constant, ToLaD#259.)
    this.flare.fill(0);
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
    this.nFirst = Int32Array.from(N, (v) => v.strands[0].index);
    this.nLast = Int32Array.from(N, (v) => v.strands[v.strands.length - 1].index);
    this.kidsF = N.map((v) => Int32Array.from(v.kids, (k) => (isNode(k) ? this.idx.get(k)! : ~k.index)));
    this.bw = Float64Array.from(S, (b) => b.baseW);
    this.sY = Float64Array.from(S, (b) => b.splitY);
    this.tcOff = Float64Array.from(S, (b) => b.path[0].off + b.baseW / 2);
    this.rootJ = this.idx.get(fan.root)!;
    this.stack = new Int32Array(N.length + 1);
    const last = (k: FanNode | FanBranch) => (isNode(k) ? k.strands[k.strands.length - 1].index : k.index);
    this.kidPair = N.map((v) => Int32Array.from(v.kids.slice(0, -1), last));
    // (Rooms by life: each node's last tip, the youngest of its strands', and now.)
    this.tipS = Float64Array.from(S, (b) => b.tipY);
    this.tipN = new Float64Array(N.length);
    for (let j = N.length - 1; j >= 0; j--) {
      let t = Infinity;
      for (const k of this.kidsF[j]) t = Math.min(t, k >= 0 ? this.tipN[k] : this.tipS[~k]);
      this.tipN[j] = t;
    }
    this.yNow = yRef;
    if (open) {
      this.a.fill(1);
      this.lambda = 1;
    }
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
            // (The gap too: a share of the order's width, the humans' 8e9 at the primates', would dwarf the fossils; at most LIFE_GAP of what the two were then.)
            const gl = Math.min(g, LIFE_GAP * (ea[1] - ea[0] + eb[1] - eb[0]));
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

  /** How far a peel has gone at y: 0 at its split (y0), 1 a fork h up. */
  private u(y0: number, h: number, y: number): number {
    if (!(h > 0)) return y < y0 ? 1 : 0;
    const t = (y0 - y) / h;
    return t <= 0 ? 0 : t >= 1 ? 1 : ease(this.fan.edge, t);
  }

  /** Node j's column's left edge at y (in its span: from its parent's split up to its own). */
  private nodeLeft(L: Lay, j: number, y: number): number {
    const p = this.par[j];
    if (p < 0) return L.colL[j];
    const tile = L.colL[p] + this.off[j];
    return tile + (L.colL[j] - tile) * this.u(this.fan.nodes[p].y, L.h[p], y);
  }

  /** Strand i's own column's centre at y, above its split (peeling off its founders' slot). */
  private ownC(L: Lay, i: number, y: number): number {
    const j = this.bNode[i];
    const h = L.h[j];
    const y0 = this.sY[i];
    // (Past its peel, as most are: its room's centre.)
    if (h > 0 && y <= y0 - h) return L.C[i];
    const tc = L.colL[j] + this.tcOff[i];
    return tc + (L.C[i] - tc) * this.u(y0, h, y);
  }

  override left(i: number, y: number): number {
    const L = this.cur();
    const b = this.strands[i];
    if (y < b.splitY) return this.ownC(L, i, y);
    const p = b.path;
    let k = 0;
    while (k + 1 < p.length && p[k + 1].y <= y) k++;
    return this.nodeLeft(L, this.pIdx[i][k], y) + p[k].off;
  }

  /** Every strand's left (its slot's) or own column's centre at y: one walk down the tree. */
  private row(L: Lay, y: number, out: Float64Array): Float64Array {
    const st = this.stack;
    const bw = this.bw;
    let n = 0;
    st[n++] = this.rootJ;
    while (n > 0) {
      const j = st[--n];
      if (y >= this.nY[j]) {
        // (Below its split: its column, its strands side by side in their founders' slots.)
        let x = this.nodeLeft(L, j, y);
        for (let i = this.nFirst[j], e = this.nLast[j]; i <= e; i++) {
          out[i] = x;
          x += bw[i];
        }
        continue;
      }
      const K = this.kidsF[j];
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (k >= 0) st[n++] = k;
        else out[~k] = this.ownC(L, ~k, y);
      }
    }
    return out;
  }

  override rowXs(k: number): Float64Array {
    const L = this.cur();
    // (By world y, not by k: the grid's rows a power of two apart, a coarser grid's rows are a finer one's, ToLaD#255.)
    const y = k * this.gridH;
    if (this.rowsVer !== L.ver || this.sRows.size >= this.rowCap()) {
      this.sRows.clear();
      this.cRows.clear();
      this.rowsVer = L.ver;
    }
    let r = this.sRows.get(y);
    if (!r) this.sRows.set(y, (r = this.row(L, y, new Float64Array(this.strands.length))));
    return r;
  }

  /**
   * Strands i0..i1 at grid row k as one ribbon (a merged clade, lod.ts): as wide as their columns there (no room's
   * empty space), centred on their founders' mean centre (constant between the clade's splits).
   */
  override extent(i0: number, i1: number, k: number): [number, number] {
    const [cW, cB] = this.widthSums(k);
    const cX = this.centreSums(k);
    const W = cW[i1 + 1] - cW[i0];
    const sw = cB[i1 + 1] - cB[i0];
    const xs = this.rowXs(k);
    const c = sw > 0 ? (cX[i1 + 1] - cX[i0]) / sw : (xs[i0] + xs[i1]) / 2;
    return [c - W / 2, c + W / 2];
  }

  /** Grid row k's widths summed along the drawn order (its columns', and its live strands' founders'): the same at every version. */
  private widthSums(k: number): [Float64Array, Float64Array] {
    const y = k * this.gridH;
    if (this.extW.size >= this.rowCap()) this.extW.clear();
    let r = this.extW.get(y);
    if (r) return r;
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
    return r;
  }
  private readonly extW = new Map<number, [Float64Array, Float64Array]>();
  /** How many rows a cache keeps (a row is a float per strand: some 50 MB at most each, the mammals' ~1,000 rows). */
  private rowCap(): number {
    return 4096;
  }

  /** Grid row k's live strands' founders-weighted centres summed along the drawn order (rowXs' version). */
  private centreSums(k: number): Float64Array {
    const xs = this.rowXs(k);
    const y = k * this.gridH;
    let r = this.cRows.get(y);
    if (r) return r;
    if (this.cRows.size >= this.rowCap()) this.cRows.clear();
    const [, cB] = this.widthSums(k);
    r = new Float64Array(xs.length + 1);
    for (let i = 0; i < xs.length; i++) {
      const w = cB[i + 1] - cB[i];
      r[i + 1] = r[i] + (w > 0 ? w * (y < this.sY[i] ? xs[i] : xs[i] + w / 2) : 0);
    }
    this.cRows.set(y, r);
    return r;
  }
  private readonly cRows = new Map<number, Float64Array>();

  /** No anchor: the places do not depend on what is on screen. */
  override setAnchor(): boolean {
    return false;
  }

  override setScale(sx: number, screenW: number): boolean {
    if (sx === this.sx && screenW === this.screenW) return false;
    if (!this.open) return super.setScale(sx, screenW);
    this.sx = sx;
    this.screenW = screenW;
    return false;
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
