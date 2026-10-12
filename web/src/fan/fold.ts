// The fold (ToLaD#146): the order reads as ONE branch from afar, and its splits open as you zoom in.
//
// Every species is still its own column, its width N(t) × the one scale at every height (layout.ts). The
// river layout (placeRiver) is the fully open fan: sister columns apart by the gap rules (GAP_FRAC of the
// narrower facing column, at least MIN_GAP_FRAC of the stem's), daughters peeling off over their split's
// fork. The fold only closes those gaps, by how far each split is open, and moves columns sideways:
//
//   At a height y, the columns there in the tree's order (a species' own column above its split, a parent
//   column below, an extinct species a zero-width mark at the centre where it ended), and between each two
//   neighbours the river's gap g ≥ 0. The two sides of a gap meet at one split of the tree (the deepest
//   one above both); that split is open by a ∈ [0, 1]. The folded columns stand side by side in the same
//   order with gap a·g: so they never overlap or cross, whatever the a's, and all a = 1 is the river
//   exactly, all a = 0 one column as wide as the sum of its species. The whole row sits with its middle
//   on the stem's centre (all closed: one column, symmetric) or, as the splits open (λ: how open the most
//   open split is), moved towards the river's places by its strands' mean move. Every term is continuous in y (the gaps open from 0
//   at a split over its fork, as the river's do; an extinct column narrows to nothing before its mark
//   stays behind), and in the zoom.
//
// How open a split is depends only on the width zoom: its narrower daughter clade's width on screen (the
// sum of its species' rooms, its widest packed), ramped open from FOLD_LO_PX to FOLD_HI_PX (smootherstep on
// the log of the width), times the order's own opening: the whole order's width over the screen's, from
// FOLD_GATE_LO (home frames it at about 0.75 on a phone, 0.87 on a wide screen) to FOLD_GATE_HI (zoomed 2x
// past home). Why those: below ~24 px two sister clades side by side read as one branch with a seam, and by
// ~96 px the river's gap (GAP_FRAC of the narrower facing column) between them is a clear few px; the
// gate keeps home one branch on any screen, so the first pinch past home is what starts the opening. A
// split's narrower daughter is never wider than its parent's, so the wide levels open first, then each
// sub-clade as it grows on screen: on a phone the order's two halves part by ~1.5x, the families by ~5x,
// sister species once each is a few dozen px. Time zoom changes nothing.

import { isNode, lanesAt, leftAt, nodeLeftAt, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { smoother } from './population';

/** A split's narrower daughter on screen (px): closed below FOLD_LO_PX, fully open above FOLD_HI_PX. */
export const FOLD_LO_PX = 24;
export const FOLD_HI_PX = 96;
/** The order's width on screen over the screen's: everything closed below FOLD_GATE_LO, free above FOLD_GATE_HI. */
export const FOLD_GATE_LO = 0.9;
export const FOLD_GATE_HI = 1.8;

const logRamp = (v: number, lo: number, hi: number) => (v > 0 ? smoother(Math.log(v / lo) / Math.log(hi / lo)) : 0);

/** How open a split is with its narrower daughter `px` wide, the whole order `orderPx` wide, on a screen `screenW` wide. */
export function openness(px: number, orderPx: number, screenW: number): number {
  return logRamp(px, FOLD_LO_PX, FOLD_HI_PX) * logRamp(orderPx / screenW, FOLD_GATE_LO, FOLD_GATE_HI);
}

/** One height's folded row: each strand's sideways move (world), stamped with the fold's version. */
interface Row {
  /** Per item (left to right): the river's left, width, and the first strand after it (its boundary's pair). */
  O: Float64Array;
  w: Float64Array;
  end: Int32Array;
  n: number;
  /** Per strand: its item, and its offset in it (its slot in a parent column; 0 in its own). */
  item: Int32Array;
  off: Float64Array;
  ver: number;
  /** Per strand: its folded left edge (its slot's). */
  xs: Float64Array;
}

export class Fold {
  /** The strands left to right (the fan's drawn order, FanBranch.index). */
  readonly strands: FanBranch[];
  /** Per neighbouring pair (i, i + 1): the narrower daughter's width (world) of the split they meet at, and that split. */
  readonly pairW: Float64Array;
  readonly pairNode: FanNode[];
  /** Per pair: how open its split is. */
  readonly a: Float64Array;
  /** How open the most open split is (where the row's centre sits). */
  lambda = 0;
  /** Bumped whenever the a's change (callers' caches of folded positions go stale). */
  ver = 0;
  sx = NaN;
  screenW = NaN;
  /** The grid the view reads folded moves from (world height between rows), or 0: exact at every height. */
  gridH = 0;
  private readonly ghostX: Float64Array;
  /** The stem's centre (world x): where the closed order stands. */
  readonly home: number;
  /** The river's rows, by height (they hold whatever the a's), each folded again when the a's change. */
  private rows = new Map<number, Row>();
  private last: Row | null = null;
  private lastY = NaN;

  constructor(readonly fan: Fan) {
    this.strands = fan.root.strands;
    const n = this.strands.length;
    this.pairW = new Float64Array(Math.max(0, n - 1));
    this.pairNode = [];
    this.a = new Float64Array(Math.max(0, n - 1)).fill(1);
    this.lambda = 1;
    const room = (k: FanNode | FanBranch) => (isNode(k) ? k.strands.reduce((s, b) => s + b.width, 0) : k.width);
    for (let i = 0; i + 1 < n; i++) {
      const p = this.strands[i].path;
      const q = this.strands[i + 1].path;
      const inQ = new Set(q.map((s) => s.node));
      const k = p.findIndex((s) => inQ.has(s.node));
      const v = p[k].node;
      const kq = q.findIndex((s) => s.node === v);
      const dp: FanNode | FanBranch = k === 0 ? this.strands[i] : p[k - 1].node;
      const dq: FanNode | FanBranch = kq === 0 ? this.strands[i + 1] : q[kq - 1].node;
      this.pairNode.push(v);
      this.pairW[i] = Math.min(room(dp), room(dq));
    }
    this.ghostX = Float64Array.from(this.strands, (b) => leftAt(b, b.tipY, 0, true));
    this.home = fan.root.left + fan.root.width / 2;
  }

  /** Set the width zoom (px per world unit) and screen width (px): true if any split's openness changed. */
  setScale(sx: number, screenW: number): boolean {
    if (sx === this.sx && screenW === this.screenW) return false;
    this.sx = sx;
    this.screenW = screenW;
    let changed = false;
    let lam = 0;
    const order = this.fan.trunkWidth * sx;
    for (let i = 0; i < this.a.length; i++) {
      const a = openness(this.pairW[i] * sx, order, screenW);
      if (a !== this.a[i]) changed = true;
      this.a[i] = a;
      lam = Math.max(lam, a);
    }
    if (this.a.length === 0) lam = 1;
    if (lam !== this.lambda) changed = true;
    this.lambda = lam;
    if (changed) this.ver++;
    return changed;
  }

  /** Every split open (the river) or closed: for tests and the cat level. */
  setAll(a: number): void {
    this.a.fill(a);
    this.lambda = a;
    this.sx = NaN;
    this.ver++;
  }

  /** The river's columns at height y, left to right (unfolded positions). */
  private riverRow(y: number): Row {
    const S = this.strands;
    const n = S.length;
    const O = new Float64Array(n);
    const w = new Float64Array(n);
    const end = new Int32Array(n);
    const item = new Int32Array(n);
    const off = new Float64Array(n);
    const ghost = new Uint8Array(n);
    let m = 0;
    let node: FanNode | null = null;
    for (let i = 0; i < n; i++) {
      const b = S[i];
      if (y >= b.splitY) {
        const sg = segAt(b, y);
        const v = sg.node;
        off[i] = sg.off;
        if (v === node) {
          item[i] = m - 1;
          end[m - 1] = i + 1;
          continue;
        }
        node = v;
        O[m] = nodeLeftAt(v, y, true);
        w[m] = v.width;
      } else {
        node = null;
        if (y >= b.tipY) {
          const W = lanesAt(b, y)[0];
          O[m] = leftAt(b, y, W, true);
          w[m] = W;
        } else {
          O[m] = this.ghostX[i];
          w[m] = 0;
          ghost[m] = 1;
        }
      }
      item[i] = m;
      end[m] = i + 1;
      m++;
    }
    // A mark left by an extinct column: where it ended, kept between its live neighbours (the river may use the room).
    let lo = -Infinity;
    for (let j = 0; j < m; j++) {
      if (!ghost[j]) {
        lo = O[j] + w[j];
        continue;
      }
      let hi = Infinity;
      for (let k = j + 1; k < m; k++)
        if (!ghost[k]) {
          hi = O[k];
          break;
        }
      O[j] = Math.max(lo, Math.min(O[j], hi));
      lo = O[j];
    }
    return { O, w, end, n: m, item, off, ver: -1, xs: new Float64Array(n) };
  }

  /** Fold a row with the current a's: each strand's move. */
  private foldRow(r: Row): void {
    const { O, w, end, n } = r;
    const X = new Float64Array(n);
    for (let j = 1; j < n; j++) {
      const g = Math.max(0, O[j] - O[j - 1] - w[j - 1]);
      X[j] = X[j - 1] + w[j - 1] + this.a[end[j - 1] - 1] * g;
    }
    // Where the row sits: closed, its middle on the stem's centre; opening, towards the river by the mean move of
    // its strands (each counted once, whatever its width: a stock growing out of nobody drags nothing along).
    let mean = 0;
    for (let i = 0; i < r.item.length; i++) mean += O[r.item[i]] - X[r.item[i]];
    mean /= Math.max(1, r.item.length);
    const mid = (X[0] + X[n - 1] + w[n - 1]) / 2;
    const shift = (1 - this.lambda) * (this.home - mid) + this.lambda * mean;
    const xs = r.xs;
    for (let i = 0; i < xs.length; i++) xs[i] = X[r.item[i]] + shift + r.off[i];
    r.ver = this.ver;
  }

  private rowAt(y: number): Row {
    let r = this.rows.get(y);
    if (!r) {
      if (this.rows.size >= 8192) this.rows.clear();
      r = this.riverRow(y);
      this.rows.set(y, r);
    }
    if (r.ver !== this.ver) this.foldRow(r);
    return r;
  }

  /**
   * Strand i's folded left edge at height y (its own column's, or its slot's in a parent column): exact (gridH 0),
   * else read off the grid's rows, linear between them (the folded edges are sums of widths: smooth, where the
   * river's may swing far over a fork), or null when every split is open (the river's own).
   */
  left(i: number, y: number): number | null {
    if (this.lambda === 1 && this.allOpen()) return null;
    const h = this.gridH;
    if (!(h > 0)) {
      if (!this.last || this.lastY !== y || this.last.ver !== this.ver) {
        this.last = this.riverRow(y);
        this.lastY = y;
        this.foldRow(this.last);
      }
      return this.last.xs[i];
    }
    const k = Math.floor(y / h);
    const t = y / h - k;
    const a = this.rowAt(k * h).xs[i];
    if (t === 0) return a;
    return a + (this.rowAt((k + 1) * h).xs[i] - a) * t;
  }

  /** Change the grid (world height between rows, a power of two: the rows a finer grid shares with a coarser are kept). */
  setGrid(h: number): void {
    this.gridH = h;
  }

  private openVer = -1;
  private open = true;
  private allOpen(): boolean {
    if (this.openVer !== this.ver) {
      this.open = this.a.every((v) => v === 1);
      this.openVer = this.ver;
    }
    return this.open;
  }

  /**
   * Where world point (x, y) goes when the a's change from `prev` to the current ones: the same place in the
   * same column (or the same share of the same gap), so the camera can keep it under the fingers.
   */
  follow(x: number, y: number, prev: { a: Float64Array; lambda: number }): number {
    const cur = { a: Float64Array.from(this.a), lambda: this.lambda };
    const at = (s: { a: Float64Array; lambda: number }) => {
      this.a.set(s.a);
      this.lambda = s.lambda;
      this.ver++;
      const r = this.riverRow(y);
      this.foldRow(r);
      return r;
    };
    const r0 = at(prev);
    const first = (r: Row, j: number) => (j ? r.end[j - 1] : 0);
    const X0 = Float64Array.from({ length: r0.n }, (_, j) => r0.xs[first(r0, j)] - r0.off[first(r0, j)]);
    const r1 = at(cur);
    const X1 = Float64Array.from({ length: r1.n }, (_, j) => r1.xs[first(r1, j)] - r1.off[first(r1, j)]);
    const n = r0.n;
    if (n === 0) return x;
    if (x <= X0[0]) return x + X1[0] - X0[0];
    for (let j = 0; j < n; j++) {
      const R0 = X0[j] + r0.w[j];
      if (x <= R0) return x + X1[j] - X0[j];
      if (j + 1 < n && x < X0[j + 1]) {
        const t = (x - R0) / (X0[j + 1] - R0);
        const R1 = X1[j] + r1.w[j];
        return R1 + t * (X1[j + 1] - R1);
      }
    }
    return x + X1[n - 1] - X0[n - 1];
  }

  snapshot(): { a: Float64Array; lambda: number } {
    return { a: Float64Array.from(this.a), lambda: this.lambda };
  }
}
