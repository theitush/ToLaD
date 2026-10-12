// The fold (ToLaD#146): from afar each family reads as one branch, apart by how related they are; inside
// a family the splits open as you zoom in, the older first, until the species stand apart.
//
// Every species is still its own column, its width N(t) × the one scale at every height (layout.ts), and
// below its split its founders' slot in the parent column. The fold only says where the columns stand:
//
//   At a height y, the columns there in the tree's order (a species' own column above its split, a parent
//   column below, an extinct species a zero-width mark after its tip), side by side, and between each two
//   neighbours a gap. The two sides of a gap meet at one split of the tree (the deepest one above both),
//   which separates two daughter clades; the gap is by the split's age (below), opening from
//   nothing at the split over its fork (ease, as a daughter peels off in the river), times a ∈ [0, 1]: how
//   open the split is at this zoom. So the columns never overlap or cross, whatever the a's; a = 0 is
//   two sister clades side by side, one column, with no leans; every term is continuous in y (a clade's
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
// Gaps by relatedness (Ita, ToLaD#146: "closer to each other depending on how close they are ... cats,
// weasels, dogs would each appear as a single branch when zoomed out and be separated from each other"):
// a split's full gap is a share of the order's width growing with its age, GAP_K * (age / 2 Ma)^GAP_POW
// (0.6% of it for sisters 2 Ma apart, 2.9% between families ~20 Ma apart, 5.4% between the order's halves),
// so deeper splits stand further apart at every zoom. The splits above the families (the order's halves, the
// superfamilies) are always open: from afar each family is one branch with dark space between it and the
// next. A split inside a family opens with the width zoom, the older first: from z0 = OPEN_Z * (20 Ma /
// age)^OPEN_POW to OPEN_SPAN times that, z the order's width on screen over the screen's (home frames it at
// ~0.55 on a phone, its families' gaps taking the rest). So a family's crown (12-20 Ma) parts at 1.5-2.5x
// home, sisters 2 Ma apart by ~6x, 0.5 Ma apart by ~15x: zooming in, the species stand apart one by one.
// A gap closes with its narrower clade (an extinct one narrowing to nothing). Time zoom changes nothing.

import { ease, isNode, lanesAt, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { smoother } from './population';

/** A split's full gap, as a share of the order's width: GAP_K * (its age / 2 Ma)^GAP_POW. */
export const GAP_K = 0.006;
export const GAP_POW = 0.7;
/** A split inside a family opens from z0 = OPEN_Z * (20 Ma / age)^OPEN_POW to OPEN_SPAN * z0 (z: the order's width on screen over the screen's). */
export const OPEN_Z = 0.8;
export const OPEN_POW = 0.6;
export const OPEN_SPAN = 2.5;

/** The least age a split between two families gaps as (the seals' families split ~10 Ma ago, inside some families' crowns). */
export const FAMILY_MIN_MA = 15;

/** A split's full gap (a share of the order's width), by its age (Ma). */
export const gapShare = (ageMa: number) => GAP_K * Math.pow(Math.max(ageMa, 1e-3) / 2, GAP_POW);

/** Whether split v is inside a family (the family's own split or under it): it opens with the zoom; above them, always open. */
export function inFamily(v: FanNode | null): boolean {
  for (let u = v; u; u = u.parent) if (/idae$/.test(u.split.taxon ?? '')) return true;
  return false;
}
/** The anchor's bell (setAnchor): its sigma, as a share of the screen's width. */
export const ANCHOR_SIGMA = 0.1;
/**
 * How tall (world) a room's bend is, at least (roomAt): 72 world units, ~0.7 of a decade of the log time axis,
 * 46 px at a phone's home time scale (574 px for TIME_H) and taller at every deeper time zoom: a bend, never a
 * ledge. ROOM_BAND: how far a column's width may fall under its room's within a stretch (the hole's bound).
 */
export const ROOM_BEND = 72;
export const ROOM_BAND = 1.3;

/** A strand's stretches (Fold.roomPlan): their ends from its split up (B[0] its split, then each bend's middle, its last height), and their rooms. */
export interface RoomPlan {
  B: Float64Array;
  L: Float64Array;
  /** Its peel's height: its room grows from its founders' slot over it. */
  peel: number;
  /** The stretches it outgrows (a boom or crash faster than a bend): the column's own width leads there. */
  hug: number[];
}

const logRamp = (v: number, lo: number, hi: number) => (v > 0 ? smoother(Math.log(v / lo) / Math.log(hi / lo)) : 0);

/** How open a split `ageMa` old is (inside a family; above, 1) with the order `orderPx` wide on a screen `screenW` wide. */
export function openness(ageMa: number, orderPx: number, screenW: number): number {
  const z0 = OPEN_Z * Math.pow(20 / Math.max(ageMa, 1e-3), OPEN_POW);
  return logRamp(orderPx / screenW, z0, z0 * OPEN_SPAN);
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
  /** Per pair: its split's full gap (world), and whether it opens with the zoom (inside a family). */
  readonly pairGap: Float64Array;
  readonly pairFam: Uint8Array;
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
    this.pairGap = new Float64Array(Math.max(0, n - 1));
    this.pairFam = new Uint8Array(Math.max(0, n - 1));
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
      this.pairFam[i] = inFamily(v) ? 1 : 0;
      // (Two families apart at least as far as a split FAMILY_MIN_MA old: a family is never a family's sister's seam.)
      this.pairGap[i] = gapShare(this.pairFam[i] ? v.ageMa : Math.max(v.ageMa, FAMILY_MIN_MA)) * fan.trunkWidth;
      // The two daughters' strands (each a run in the drawn order) and the split's fork (where its gap opens over).
      const run = (k: FanNode | FanBranch) => (isNode(k) ? [k.strands[0].index, k.strands[k.strands.length - 1].index + 1] : [k.index, k.index + 1]);
      this.lo[i] = run(dp)[0];
      this.hi[i] = run(dq)[1];
      this.forkTop[i] = Math.min(dp.leanY, dq.leanY);
    }
    this.home = fan.root.left + fan.root.width / 2;
    this.wt = new Float64Array(n).fill(1);
    this.yRef = fan.time.y(0);
  }

  /**
   * Strand b's room at height y, above its split (its own column; world): fixed over each of its stretches
   * (roomPlan), so the column stands straight and narrows or widens about its room's centre; between two
   * stretches it bends over ROOM_BEND (ease), as at its peel from its founders' slot (never narrower than the
   * column); an extinct one's room closes after its tip over as long again (the line's end, as its split was
   * its start).
   */
  roomAt(b: FanBranch, y: number): number {
    const p = this.roomPlan(b);
    const { B, L } = p;
    const edge = this.fan.edge;
    const yy = Math.max(y, b.tipY);
    let k = 0;
    while (k + 2 < B.length && yy < B[k + 1]) k++;
    let r = L[k];
    if (k === 0 && yy > b.splitY - p.peel) {
      // (Its peel: from its founders' slot up to its room; a column widening faster takes the lead, smoothly: one bend.)
      const u = (b.splitY - yy) / p.peel;
      r = b.baseW + (L[0] - b.baseW) * ease(edge, u);
      const w = lanesAt(b, yy)[0];
      const e = 0.4 * L[0] * u * (1 - u);
      r = (r + w + Math.sqrt((r - w) * (r - w) + e * e)) / 2;
    } else if (k > 0 && yy > B[k] - ROOM_BEND / 2) r = L[k - 1] + (L[k] - L[k - 1]) * ease(edge, 0.5 + (B[k] - yy) / ROOM_BEND);
    else if (k + 2 < B.length && yy < B[k + 1] + ROOM_BEND / 2) r = L[k] + (L[k + 1] - L[k]) * ease(edge, 0.5 + (B[k + 1] - yy) / ROOM_BEND);
    if (y >= b.tipY) return Math.max(r, lanesAt(b, y)[0]);
    r *= 1 - ease(edge, (b.tipY - y) / Fold.endH(b));
    return r;
  }

  private readonly plans = new Map<FanBranch, RoomPlan>();

  /**
   * Strand b's stretches (ToLaD#146): from its split up, each as long as its width stays within ROOM_BAND of its
   * narrowest there (at least ROOM_BEND long, the first a peel longer), its room its widest there, but at most
   * ROOM_BAND times its narrowest. A column whose width holds (most) is one stretch, its room its widest: it stands
   * straight. One that booms or crashes faster than a bend (the domestic cat) steps its room after it, a bend at
   * a time, and where it outgrows its room the column itself takes the lead (roomAt: never narrower than the
   * column), so it leaves no hole wider than the band.
   */
  roomPlan(b: FanBranch): RoomPlan {
    let p = this.plans.get(b);
    if (p) return p;
    const top = Math.max(b.tipY, this.yRef);
    const peel = Fold.peelH(b);
    const span = b.splitY - top;
    const H = ROOM_BEND / 2;
    if (!(span > peel + 2 * ROOM_BEND)) {
      // (Too short to step: one stretch, its widest.)
      let R = b.baseW;
      for (let k = 0; k <= 64; k++) R = Math.max(R, lanesAt(b, b.splitY - (span * k) / 64 - 1e-9)[0]);
      p = { B: Float64Array.of(b.splitY, top), L: Float64Array.of(R), peel, hug: [] };
    } else {
      const dy = H / 16;
      const n = Math.ceil(span / dy) + 1;
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = lanesAt(b, Math.max(top, b.splitY - i * dy - (i === 0 ? 1e-9 : 0)))[0];
      // (Each sample the widest of its neighbours', a hair over: the width between two samples stays under it.)
      const M = w.map((v, i) => Math.max(v, w[i - 1] ?? 0, w[i + 1] ?? 0) * (1 + 1e-4));
      const B = [b.splitY];
      const L: number[] = [];
      const hug: number[] = [];
      const len0 = Math.ceil((peel + H) / dy);
      const len = Math.ceil(ROOM_BEND / dy);
      let i0 = 0;
      while (i0 < n - 1) {
        let j = i0;
        let lo = M[i0];
        let hi = M[i0];
        const min = i0 === 0 ? len0 : len;
        while (j + 1 < n) {
          const l2 = Math.min(lo, M[j + 1]);
          const h2 = Math.max(hi, M[j + 1]);
          if (j - i0 >= min && h2 > ROOM_BAND * l2) break;
          lo = l2;
          hi = h2;
          j++;
        }
        // (What is left too short for a stretch of its own, half a bend, joins this one.)
        if (n - 1 - j < len / 2) {
          for (let q = j + 1; q < n; q++) hi = Math.max(hi, M[q]);
          j = n - 1;
        }
        // (A stretch it booms or crashes through, too short to step with it: its room within the band of its
        // narrowest, the column wider than it taking the lead: room = width while it grows, smoothly.)
        L.push(Math.max(Math.min(hi, ROOM_BAND * lo), i0 === 0 ? b.baseW : 0));
        if (hi > ROOM_BAND * lo) hug.push(L.length - 1);
        B.push(j === n - 1 ? top : b.splitY - j * dy);
        i0 = j;
      }
      p = { B: Float64Array.from(B), L: Float64Array.from(L), peel, hug };
    }
    this.plans.set(b, p);
    return p;
  }

  /** Where strand b's room changes (world [lo, hi]): its peel, each bend between its stretches, each stretch it outgrows, an extinct one's end. */
  roomBends(b: FanBranch, hugs = true): [number, number][] {
    const { B, peel, hug } = this.roomPlan(b);
    const out: [number, number][] = [[b.splitY - peel, b.splitY]];
    if (hugs) for (const k of hug) out.push([B[k + 1], B[k]]);
    for (let k = 1; k + 1 < B.length; k++) out.push([B[k] - ROOM_BEND / 2, B[k] + ROOM_BEND / 2]);
    if (b.tipY > this.yRef) out.push([b.tipY - Fold.endH(b), b.tipY]);
    return out;
  }

  /** How long (world) a strand's room takes to grow from its founders' slot: its peel, at least a bend. */
  static peelH(b: FanBranch): number {
    return Math.max(b.splitY - b.leanY, ROOM_BEND);
  }

  /** How long (world) an extinct strand's room takes to close after its tip: as long as its peel took. */
  static endH(b: FanBranch): number {
    return Math.max(Fold.peelH(b), 0.02 * (b.splitY - b.tipY));
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
      const a = this.pairFam[i] ? openness(this.pairNode[i].ageMa, order, screenW) : 1;
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

  /** Every split inside a family open (1) or closed (0), those above them open (or, `all`, as those): for tests and the cat level. */
  setAll(a: number, all = false): void {
    for (let i = 0; i < this.a.length; i++) this.a[i] = this.pairFam[i] || all ? a : 1;
    this.wt.fill(1);
    this.lambda = this.a.length ? Math.max(...this.a) : 1;
    this.sx = NaN;
    this.ver++;
  }

  private homeExt: [number, number] | null = null;
  /** The order's extent (world) as home shows it: the families apart, each closed, the anchor on the whole row; its widest over its heights. */
  homeExtent(): [number, number] {
    if (this.homeExt) return this.homeExt;
    const keep = this.snapshot();
    for (let i = 0; i < this.a.length; i++) this.a[i] = this.pairFam[i] ? 0 : 1;
    this.wt.fill(1);
    this.ver++;
    let lo = Infinity;
    let hi = -Infinity;
    const y1 = Math.max(this.yRef, this.fan.root.y);
    for (let k = 0; k <= 32; k++) {
      const r = this.riverRow(this.yRef + ((y1 - this.yRef) * k) / 32 - 1e-9);
      this.foldRow(r);
      for (let i = 0; i < r.xs.length; i++) {
        if (r.sw[i] <= 0) continue;
        const l = r.xs[i] - (r.own[i] ? r.sw[i] / 2 : 0);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l + r.sw[i]);
      }
    }
    this.a.set(keep.a);
    this.wt.set(keep.wt);
    this.lambda = keep.lambda;
    this.ver++;
    return (this.homeExt = [lo, hi]);
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
        // (Its full gap, closing with its narrower clade as that ends: below a quarter of its room.)
        const P = this.pairW[p];
        gap = a * u * this.pairGap[p] * Math.min(1, m / (0.25 * P));
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
