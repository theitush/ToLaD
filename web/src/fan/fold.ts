// The fold (ToLaD#146): the order reads as ONE branch from afar, and its splits open as you zoom in.
//
// Every species is still its own column, its width N(t) × the one scale at every height (layout.ts), and
// below its split its founders' slot in the parent column. The fold only says where the columns stand:
//
//   At a height y, the columns there in the tree's order (a species' own column above its split, a parent
//   column below, an extinct species a zero-width mark after its tip), side by side, and between each two
//   neighbours a gap. The two sides of a gap meet at one split of the tree (the deepest one above both),
//   which separates two daughter clades; the gap is today's gap rule on those clades: GAP_FRAC of the
//   narrower one's width there (at least MIN_GAP_FRAC of the stem's, while it has that much), opening from
//   nothing at the split over its fork (ease, as a daughter peels off in the river), times a ∈ [0, 1]: how
//   open the split is at this zoom. So the columns never overlap or cross, whatever the a's; all a = 0 is
//   one column as wide as the sum of its species, with no leans; every term is continuous in y (a clade's
//   width is the sum of its columns', an extinct one narrowing to nothing, so its gaps close with it) and
//   in the zoom. (The river layout, placeRiver, stays the cats' own view; the fold does not use its places,
//   so its leans at the crowded base never show.)
//
// Where a row stands (its one free sideways shift) is anchored on what is on screen (setAnchor): the strands
// near the screen's centre, weighted by a bell on their distance from it (ANCHOR_SIGMA of the screen), keep
// their weighted mean slot centre where it is at "now", at every height. So the clade on screen stands
// still in time, whatever opens or grows far from it (a gap opening at a distant fork, the domestic dog's
// billions); only its own widths and splits move it. "Now" itself is the canonical row: every strand's mean
// slot centre on the stem's centre. The camera keeps the point under the fingers when the anchor moves.
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

import { ease, g, GAP_FRAC, isNode, lanesAt, MIN_GAP_FRAC, peelU, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { smoother } from './population';

/** A split's narrower daughter on screen (px): closed below FOLD_LO_PX, fully open above FOLD_HI_PX. */
export const FOLD_LO_PX = 24;
export const FOLD_HI_PX = 96;
/** The order's width on screen over the screen's: everything closed below FOLD_GATE_LO, free above FOLD_GATE_HI. */
export const FOLD_GATE_LO = 0.9;
export const FOLD_GATE_HI = 1.8;
/** The anchor's bell (setAnchor): its sigma, as a share of the screen's width. */
export const ANCHOR_SIGMA = 0.1;

const logRamp = (v: number, lo: number, hi: number) => (v > 0 ? smoother(Math.log(v / lo) / Math.log(hi / lo)) : 0);

/** How open a split is with its narrower daughter `px` wide, the whole order `orderPx` wide, on a screen `screenW` wide. */
export function openness(px: number, orderPx: number, screenW: number): number {
  return logRamp(px, FOLD_LO_PX, FOLD_HI_PX) * logRamp(orderPx / screenW, FOLD_GATE_LO, FOLD_GATE_HI);
}

/** One height's folded row: each strand's sideways move (world), stamped with the fold's version. */
interface Row {
  /** Its height; per item (left to right): its width, and the first strand after it (its boundary's pair). */
  y: number;
  w: Float64Array;
  end: Int32Array;
  n: number;
  /** Per strand: its item, and its offset in it (its slot in a parent column; 0 in its own). */
  item: Int32Array;
  off: Float64Array;
  ver: number;
  /** Per strand: 1 where it is its own column (its room's), else a slot in a parent column. */
  own: Uint8Array;
  /** Per strand: its folded left edge (its slot's in a parent column), or its room's centre (its own column). */
  xs: Float64Array;
  /** Per strand: its slot's width (its own column's, or its share of the parent column). */
  sw: Float64Array;
  /** The unshifted row's weighted mean slot centre (the anchor's weights) and plain mean, at this fold version. */
  mw: number;
  mg: number;
}

/** What the fold's positions depend on, besides the tree: the splits' openness and the anchor's weights. */
export interface FoldState {
  a: Float64Array;
  lambda: number;
  wt: Float64Array;
}

export class Fold {
  /** The strands left to right (the fan's drawn order, FanBranch.index). */
  readonly strands: FanBranch[];
  /** Per neighbouring pair (i, i + 1): the narrower daughter's width (world) of the split they meet at, and that split. */
  readonly pairW: Float64Array;
  readonly pairNode: FanNode[];
  /** Per pair: the strands of the left daughter start at lo, the right daughter's end before hi; the fork's top (world y). */
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;
  private readonly forkTop: Float64Array;
  /** Per pair: how open its split is. */
  readonly a: Float64Array;
  /** How open the most open split is. */
  lambda = 0;
  /** The anchor (setAnchor): per strand, its weight (all 1: the whole row, the plain mean). */
  readonly wt: Float64Array;
  /** "Now" (world y): the canonical row. */
  private readonly yRef: number;
  private ref: Row | null = null;
  /** Bumped whenever the a's change (callers' caches of folded positions go stale). */
  ver = 0;
  sx = NaN;
  screenW = NaN;
  /** The grid the view reads folded moves from (world height between rows), or 0: exact at every height. */
  gridH = 0;
  private readonly minGap: number;
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
    this.lo = new Int32Array(Math.max(0, n - 1));
    this.hi = new Int32Array(Math.max(0, n - 1));
    this.forkTop = new Float64Array(Math.max(0, n - 1));
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
      // The two daughters' strands (each a run in the drawn order) and the split's fork (where its gap opens over).
      const run = (k: FanNode | FanBranch) => (isNode(k) ? [k.strands[0].index, k.strands[k.strands.length - 1].index + 1] : [k.index, k.index + 1]);
      this.lo[i] = run(dp)[0];
      this.hi[i] = run(dq)[1];
      this.forkTop[i] = Math.min(dp.leanY, dq.leanY);
    }
    this.home = fan.root.left + fan.root.width / 2;
    this.minGap = MIN_GAP_FRAC * fan.trunkWidth;
    this.wt = new Float64Array(n).fill(1);
    this.yRef = fan.time.y(0);
  }

  /**
   * Strand b's room at height y, above its split (its own column; world): fixed between the tree's events, so
   * the column stands straight and narrows or widens about its room's centre. Its widest ever (Fan's room),
   * grown from its founders' slot over its peel (as its gap opens; never narrower than the column); an extinct
   * one's closing after its tip over as long again (the line's end, as its split was its start).
   */
  roomAt(b: FanBranch, y: number): number {
    const R = Math.max(b.width, b.baseW, b.unit * g(b.pop.max, b.tess.mode));
    // (Over its peel; a straight one's with no peel over as long as an end takes: no jog at the split.)
    const top = b.leanY < b.splitY ? b.leanY : b.splitY - Fold.endH(b);
    const u = peelU(this.fan.edge, b.splitY, top, y);
    let r = b.baseW + (R - b.baseW) * u;
    if (y >= b.tipY) return Math.max(r, lanesAt(b, y)[0]);
    r *= 1 - ease(this.fan.edge, (b.tipY - y) / Fold.endH(b));
    return r;
  }

  /** How long (world) an extinct strand's room takes to close after its tip: as long as its peel took. */
  static endH(b: FanBranch): number {
    return Math.max(b.splitY - b.leanY, 0.02 * (b.splitY - b.tipY), 1e-9);
  }

  /**
   * Anchor the rows on the screen's centre: world (cx, cy) at width zoom sx (px per world unit) on a screen
   * screenW px wide. Each strand weighs by a bell on its slot centre's distance from cx at height cy (as drawn
   * now). True if the weights changed (the positions move: the caller keeps its point with follow()).
   */
  setAnchor(cx: number, cy: number, sx: number, screenW: number): boolean {
    const n = this.strands.length;
    if (!(n > 0) || !(sx > 0) || !(screenW > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return false;
    const r = this.riverRow(cy);
    this.foldRow(r);
    const s = ANCHOR_SIGMA * screenW;
    const d = new Float64Array(n);
    let dMin = Infinity;
    for (let i = 0; i < n; i++) {
      d[i] = ((r.xs[i] + (r.own[i] ? 0 : r.sw[i] / 2) - cx) * sx) / s;
      dMin = Math.min(dMin, Math.abs(d[i]));
    }
    // (Relative to the nearest strand's, so some strand always weighs 1.)
    let changed = false;
    for (let i = 0; i < n; i++) {
      const w = Math.exp(-(d[i] * d[i] - dMin * dMin) / 2);
      const v = w < 1e-6 ? 0 : w;
      if (v !== this.wt[i]) changed = true;
      this.wt[i] = v;
    }
    if (changed) this.ver++;
    return changed;
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
    this.wt.fill(1);
    this.lambda = a;
    this.sx = NaN;
    this.ver++;
  }

  /** The river's columns at height y, left to right (unfolded positions). */
  private riverRow(y: number): Row {
    const S = this.strands;
    const n = S.length;
    const w = new Float64Array(n);
    const end = new Int32Array(n);
    const item = new Int32Array(n);
    const off = new Float64Array(n);
    const own = new Uint8Array(n);
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
        w[m] = v.width;
      } else {
        node = null;
        w[m] = this.roomAt(b, y);
        own[i] = 1;
      }
      item[i] = m;
      end[m] = i + 1;
      m++;
    }
    const sw = new Float64Array(n);
    for (let i = 0; i < n; i++) sw[i] = (i + 1 < n && item[i + 1] === item[i] ? off[i + 1] : w[item[i]]) - off[i];
    return { y, w, end, n: m, item, off, own, ver: -1, xs: new Float64Array(n), sw, mw: 0, mg: 0 };
  }

  /** Fold a row with the current a's: each strand's move. */
  private foldRow(r: Row): void {
    const { w, end, n, item, y } = r;
    // Each daughter clade's width here: its items' widths (each counted at its first strand), summed along the strands.
    const S = item.length;
    const C = new Float64Array(S + 1);
    for (let i = 0; i < S; i++) C[i + 1] = C[i] + (i === 0 || item[i] !== item[i - 1] ? w[item[i]] : 0);
    const edge = this.fan.edge;
    const X = new Float64Array(n);
    for (let j = 1; j < n; j++) {
      const p = end[j - 1] - 1;
      let gap = 0;
      const a = this.a[p];
      if (a > 0) {
        const m = Math.min(C[p + 1] - C[this.lo[p]], C[this.hi[p]] - C[p + 1]);
        const v = this.pairNode[p];
        const u = this.forkTop[p] < v.y ? ease(edge, (v.y - y) / (v.y - this.forkTop[p])) : 1;
        // (Sized on the clades' rooms, fixed: it changes only where the narrower one ends, closing with it.)
        const P = this.pairW[p];
        gap = a * u * Math.min(Math.max(GAP_FRAC * P, Math.min(P, this.minGap)), m);
      }
      X[j] = X[j - 1] + w[j - 1] + gap;
    }
    // Where it stands: the anchor's weighted mean slot centre where it is at "now" (the canonical row, whose plain
    // mean slot centre is on the stem's centre: each strand counted once, whatever its width, so a column that
    // grows or shrinks moves its neighbours as little as it can).
    let sw = 0;
    let sg = 0;
    let W = 0;
    const wt = this.wt;
    for (let i = 0; i < S; i++) {
      const c = X[item[i]] + r.off[i] + r.sw[i] / 2;
      sg += c;
      sw += wt[i] * c;
      W += wt[i];
    }
    r.mg = sg / Math.max(1, S);
    r.mw = W > 0 ? sw / W : r.mg;
    let shift: number;
    if (r.y === this.yRef) shift = this.home - r.mg;
    else {
      let ref = this.ref;
      if (!ref || ref.ver !== this.ver) {
        ref = this.ref = this.riverRow(this.yRef);
        this.foldRow(ref);
      }
      shift = this.home - ref.mg + ref.mw - r.mw;
    }
    const xs = r.xs;
    for (let i = 0; i < xs.length; i++) xs[i] = X[r.item[i]] + shift + r.off[i] + (r.own[i] ? r.sw[i] / 2 : 0);
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
   * else read off the grid's rows, linear between them (the folded edges are sums of widths and gaps: smooth).
   */
  left(i: number, y: number): number | null {
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

  /**
   * Where world point (x, y) goes when the a's change from `prev` to the current ones: the same place in the
   * same column (or the same share of the same gap), so the camera can keep it under the fingers.
   */
  follow(x: number, y: number, prev: FoldState): number {
    const cur = this.snapshot();
    const at = (s: FoldState) => {
      this.a.set(s.a);
      this.wt.set(s.wt);
      this.lambda = s.lambda;
      this.ver++;
      const r = this.riverRow(y);
      this.foldRow(r);
      return r;
    };
    const r0 = at(prev);
    const first = (r: Row, j: number) => (j ? r.end[j - 1] : 0);
    const lft = (r: Row, i: number) => r.xs[i] - r.off[i] - (r.own[i] ? r.sw[i] / 2 : 0);
    const X0 = Float64Array.from({ length: r0.n }, (_, j) => lft(r0, first(r0, j)));
    const r1 = at(cur);
    const X1 = Float64Array.from({ length: r1.n }, (_, j) => lft(r1, first(r1, j)));
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

  snapshot(): FoldState {
    return { a: Float64Array.from(this.a), lambda: this.lambda, wt: Float64Array.from(this.wt) };
  }
}
