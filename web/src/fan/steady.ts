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
// ?layout=steady (wantSteady). At the cats' level (the view's `folds` off) every split is open, at every zoom.

import { ease, isNode, laneW, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { EASE_MAX, Fold, LEAN_FORK, ROOM_BEND, SY_HOME, type FoldState } from './fold';

/** A split's fork is at most this share of its shortest daughter's run (to its own split or tip). */
export const STEADY_RUN = 0.85;

/** Whether the steady layout is asked for: ?layout=steady, or TOLAD_LAYOUT=steady in node (tests, perf runs). */
export function wantSteady(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('layout') === 'steady') return true;
  } catch {
    /* no URL */
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.TOLAD_LAYOUT === 'steady';
}

/** The rooms and places at one set of a's and width zoom (world x, the stem's centre on Fold.home). */
interface Lay {
  ver: number;
  /** Per node (fan.nodes' order): its column's left edge (once peeled), its room's left edge and width, its split's fork height. */
  colL: Float64Array;
  roomL: Float64Array;
  roomW: Float64Array;
  /** The window (world) a column at height y averages its places over (window()): sampled from yRef every hdy. */
  H: Float64Array;
  hdy: number;
  /** Per strand (drawn order): its own column's centre (its room's). */
  C: Float64Array;
}

export class Steady extends Fold {
  /** Per node: its index's parent (-1 for the root), its column's offset in its parent's, its fork's cap (world). */
  private readonly par: Int32Array;
  private readonly off: Float64Array;
  private readonly cap: Float64Array;
  /** "Now" and the oldest split (world y): the windows' span, sampled hG times. */
  private readonly yNow: number;
  private readonly yTop: number;
  private readonly hG = 1024;
  /** The width zoom the forks are as tall as (setScale's, in quarter octaves: the layout changes only at those steps). */
  private sxQ = NaN;
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
  private rowsH = NaN;
  private rowsVer = -1;
  private readonly sRows = new Map<number, Float64Array>();
  private homeExtS: [number, number] | null = null;

  /** open: every split open at every zoom (the cats' level), else the fold's openness by zoom. */
  constructor(
    fan: Fan,
    readonly open = false,
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
    // (Its least: the river's fork, at least a bend; its most: STEADY_RUN of the time to "now", ToLaD#268.)
    this.cap = Float64Array.from(N, (v) => Math.max(ROOM_BEND, ...v.kids.map((k) => v.y - k.leanY)));
    this.yNow = yRef;
    this.yTop = Math.max(yRef + 1, ...N.map((v) => v.y));
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
    if (open) {
      this.a.fill(1);
      this.lambda = 1;
    }
  }

  /** The rooms and places at the a's `A`. */
  private compute(A: Float64Array): Lay {
    const n = this.nY.length;
    const G = this.pairGap;
    const R = this.room;
    const NW = this.nW;
    const roomW = new Float64Array(n);
    const roomL = new Float64Array(n);
    const colL = new Float64Array(n);
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
    }
    // The peels (ToLaD#268). A strand's centre at y is its places' mean over the window [y, y + H(y)] below it,
    // eased (its own column's and its founders' slots', each constant between its own splits): past a split by H it
    // stands still again. One window for every strand at a height: each is a mean of the same ordered rows, so the
    // columns never cross or overlap. H is the tallest fork a split there asks: at least the river's, a bend, and as
    // tall as its daughters' moves on screen over LEAN_FORK px per px at a phone's home time scale (as the fold's
    // forks, carriedForks), however soon they split again (a deep base, where log time leaves a few px of run, is no
    // ledge across the screen zoomed in), at most STEADY_RUN of the time to "now"; changing at most half as fast as y.
    const kS = Number.isFinite(this.sxQ) ? (EASE_MAX * this.sxQ) / (LEAN_FORK * SY_HOME) : 0;
    const yRef = this.yNow;
    const NG = this.hG;
    const hdy = (this.yTop - yRef) / (NG - 1);
    const H = new Float64Array(NG);
    for (let j = 0; j < n; j++) {
      const K = this.kidsF[j];
      let d = 0;
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        d = Math.max(d, Math.abs(k >= 0 ? colL[k] - colL[j] - this.off[k] : C[~k] - colL[j] - this.tcOff[~k]));
      }
      const hj = Math.max(this.cap[j], d * kS);
      const g1 = Math.min(NG - 1, Math.floor((this.nY[j] - yRef) / hdy));
      for (let g = Math.max(0, Math.ceil((this.nY[j] - hj - yRef) / hdy)); g <= g1; g++) H[g] = Math.max(H[g], hj);
    }
    for (let g = 1; g < NG; g++) H[g] = Math.max(H[g], H[g - 1] - hdy / 2);
    for (let g = NG - 2; g >= 0; g--) H[g] = Math.max(H[g], H[g + 1] - hdy / 2);
    for (let g = 0; g < NG; g++) H[g] = Math.min(H[g], STEADY_RUN * g * hdy);
    // The stem's centre on home: where the closed order stands.
    const r = this.idx.get(this.fan.root)!;
    const sh = this.home - (colL[r] + this.fan.root.width / 2);
    for (let j = 0; j < n; j++) {
      colL[j] += sh;
      roomL[j] += sh;
    }
    for (let i = 0; i < C.length; i++) C[i] += sh;
    return { ver: this.ver, colL, roomL, roomW, H, hdy, C };
  }

  /** The current layout (at the fold's version and zoom). */
  private cur(): Lay {
    const L = this.lay;
    if (L && L.ver === this.ver) return L;
    return (this.lay = this.compute(this.a));
  }

  /** The window at y (world): how far below y the places a column's centre is the mean of reach. */
  private window(L: Lay, y: number): number {
    const t = Math.max(0, (y - this.yNow) / L.hdy);
    const g = Math.floor(t);
    const H = L.H;
    if (g >= H.length - 1) return H[H.length - 1];
    return H[g] + (H[g + 1] - H[g]) * (t - g);
  }

  /** Split v's fork (world): how far above it its daughters still move (y + window(y) reaches it). */
  forkH(v: FanNode): number {
    const L = this.cur();
    let lo = v.y - L.H.reduce((m, h) => Math.max(m, h), 0) - 1;
    let hi = v.y;
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2;
      if (m + this.window(L, m) < v.y) lo = m;
      else hi = m;
    }
    return v.y - lo;
  }

  /** Node j's column's left edge at y (at or above its parent's split): its place less each of its founders' moves inside the window, by what of the window lies before it. */
  private nodeLeft(L: Lay, j: number, y: number, Hy = this.window(L, y)): number {
    let x = L.colL[j];
    const top = y + Hy;
    for (let a = j, p = this.par[a]; p >= 0; a = p, p = this.par[a]) {
      const ys = this.nY[p];
      if (ys >= top) break;
      x -= (L.colL[a] - L.colL[p] - this.off[a]) * (1 - ease(this.fan.edge, (ys - y) / Hy));
    }
    return x;
  }

  /** Strand i's own column's centre at y, above its split (peeling off its founders' slot). */
  private ownC(L: Lay, i: number, y: number): number {
    const Hy = this.window(L, y);
    const y0 = this.sY[i];
    // (Past its peel and its founders' column's, as most are: its room's centre.)
    if (y0 >= y + Hy) return L.C[i];
    const j = this.bNode[i];
    const tc = L.colL[j] + this.tcOff[i];
    return L.C[i] - (L.C[i] - tc) * (1 - ease(this.fan.edge, (y0 - y) / Hy)) - (L.colL[j] - this.nodeLeft(L, j, y, Hy));
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
    if (this.rowsVer !== L.ver || this.rowsH !== this.gridH || this.sRows.size >= 4096) {
      this.sRows.clear();
      this.cRows.clear();
      this.rowsVer = L.ver;
      this.rowsH = this.gridH;
    }
    let r = this.sRows.get(k);
    if (!r) this.sRows.set(k, (r = this.row(L, k * this.gridH, new Float64Array(this.strands.length))));
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
    if (this.extH !== this.gridH || this.extW.size >= 4096) {
      this.extW.clear();
      this.extH = this.gridH;
    }
    let r = this.extW.get(k);
    if (r) return r;
    const y = k * this.gridH;
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
    this.extW.set(k, (r = [cW, cB]));
    return r;
  }
  private readonly extW = new Map<number, [Float64Array, Float64Array]>();
  private extH = NaN;

  /** Grid row k's live strands' founders-weighted centres summed along the drawn order (rowXs' version). */
  private centreSums(k: number): Float64Array {
    const xs = this.rowXs(k);
    let r = this.cRows.get(k);
    if (r) return r;
    if (this.cRows.size >= 4096) this.cRows.clear();
    const y = k * this.gridH;
    const [, cB] = this.widthSums(k);
    r = new Float64Array(xs.length + 1);
    for (let i = 0; i < xs.length; i++) {
      const w = cB[i + 1] - cB[i];
      r[i + 1] = r[i] + (w > 0 ? w * (y < this.sY[i] ? xs[i] : xs[i] + w / 2) : 0);
    }
    this.cRows.set(k, r);
    return r;
  }
  private readonly cRows = new Map<number, Float64Array>();

  /** No anchor: the places do not depend on what is on screen. */
  override setAnchor(): boolean {
    return false;
  }

  override setScale(sx: number, screenW: number): boolean {
    if (sx === this.sx && screenW === this.screenW) return false;
    const q = Math.pow(2, Math.round(4 * Math.log2(sx)) / 4);
    const tall = q !== this.sxQ;
    this.sxQ = q;
    if (tall) this.ver++;
    if (!this.open) return super.setScale(sx, screenW) || tall;
    this.sx = sx;
    this.screenW = screenW;
    return tall;
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
