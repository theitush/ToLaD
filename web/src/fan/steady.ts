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

import { ease, isNode, lanesAt, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { Fold, ROOM_BEND, type FoldState } from './fold';

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
    this.cap = Float64Array.from(N, (v) => {
      let run = Infinity;
      let fork = 0;
      for (const k of v.kids) {
        run = Math.min(run, v.y - (isNode(k) ? k.y : Math.max(k.tipY, yRef)));
        fork = Math.max(fork, v.y - k.leanY);
      }
      return Math.max(0, Math.min(Math.max(fork, ROOM_BEND), STEADY_RUN * run));
    });
    const last = (k: FanNode | FanBranch) => (isNode(k) ? k.strands[k.strands.length - 1].index : k.index);
    this.kidPair = N.map((v) => Int32Array.from(v.kids.slice(0, -1), last));
    if (open) {
      this.a.fill(1);
      this.lambda = 1;
    }
  }

  /** The rooms and places at the a's `A`. */
  private compute(A: Float64Array): Lay {
    const N = this.fan.nodes;
    const n = N.length;
    const G = this.pairGap;
    const roomW = new Float64Array(n);
    const roomL = new Float64Array(n);
    const colL = new Float64Array(n);
    const h = new Float64Array(n);
    const C = new Float64Array(this.strands.length);
    // Rooms, daughters first (fan.nodes has parents before daughters): the daughters' side by side, with their gaps.
    for (let j = n - 1; j >= 0; j--) {
      const v = N[j];
      const P = this.kidPair[j];
      let r = 0;
      v.kids.forEach((k, q) => {
        r += isNode(k) ? roomW[this.idx.get(k)!] : this.room[k.index];
        if (q > 0) r += A[P[q - 1]] * G[P[q - 1]];
      });
      roomW[j] = r;
    }
    // Places, parents first (the root's room from 0): each daughter's room in its parent's, left to right; a species' centre its room's.
    for (let j = 0; j < n; j++) {
      const v = N[j];
      const P = this.kidPair[j];
      let x = roomL[j];
      v.kids.forEach((k, q) => {
        if (q > 0) x += A[P[q - 1]] * G[P[q - 1]];
        if (isNode(k)) {
          const i = this.idx.get(k)!;
          roomL[i] = x;
          x += roomW[i];
        } else {
          C[k.index] = x + this.room[k.index] / 2;
          x += this.room[k.index];
        }
      });
    }
    // Each parent column, daughters first: where its daughters' founders move least (their founders-weighted mean move
    // nil), inside its room.
    for (let j = n - 1; j >= 0; j--) {
      const v = N[j];
      let sw = 0;
      let s = 0;
      let o = 0;
      for (const k of v.kids) {
        const w = isNode(k) ? k.width : k.baseW;
        const t = isNode(k) ? colL[this.idx.get(k)!] + w / 2 : C[k.index];
        s += Math.max(w, 1e-12) * (t - o - w / 2);
        sw += Math.max(w, 1e-12);
        o += w;
      }
      const l = s / sw;
      colL[j] = Math.min(roomL[j] + roomW[j] - v.width, Math.max(roomL[j], l));
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
    const b = this.strands[i];
    const j = this.bNode[i];
    const tc = L.colL[j] + b.path[0].off + b.baseW / 2;
    return tc + (L.C[i] - tc) * this.u(b.splitY, L.h[j], y);
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
    const visit = (v: FanNode, j: number) => {
      if (y >= v.y) {
        let x = this.nodeLeft(L, j, y);
        for (const b of v.strands) {
          out[b.index] = x;
          x += b.baseW;
        }
        return;
      }
      for (const k of v.kids) {
        if (isNode(k)) visit(k, this.idx.get(k)!);
        else out[k.index] = this.ownC(L, k.index, y);
      }
    };
    visit(this.fan.root, this.idx.get(this.fan.root)!);
    return out;
  }

  override rowXs(k: number): Float64Array {
    const L = this.cur();
    if (this.rowsVer !== L.ver || this.rowsH !== this.gridH || this.sRows.size >= 4096) {
      this.sRows.clear();
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
    const xs = this.rowXs(k);
    const y = k * this.gridH;
    let W = 0;
    let s = 0;
    let sw = 0;
    for (let i = i0; i <= i1; i++) {
      const b = this.strands[i];
      const own = y < b.splitY;
      if (own && y < b.tipY) continue;
      const w = own ? lanesAt(b, y)[0] : b.baseW;
      W += w;
      s += b.baseW * (own ? xs[i] : xs[i] + b.baseW / 2);
      sw += b.baseW;
    }
    const c = sw > 0 ? s / sw : (xs[i0] + xs[i1]) / 2;
    return [c - W / 2, c + W / 2];
  }

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
