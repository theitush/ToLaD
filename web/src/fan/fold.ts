// The splits' gaps and their openness by zoom (ToLaD#146), under the steady layout (steady.ts, ToLaD#259), which
// places the columns. (Until ToLaD#300 this was the fold, a layout of its own that packed the columns side by side at
// every height, anchored on the screen's centre; steady.ts replaced it as the default in ToLaD#273.)
//
// Gaps by relatedness (Ita, ToLaD#146: "closer to each other depending on how close they are ... cats,
// weasels, dogs would each appear as a single branch when zoomed out and be separated from each other"):
// a split's full gap is a share of the order's width growing with its age, GAP_K * (age / 2 Ma)^GAP_POW
// (0.6% of it for sisters 2 Ma apart, 2.9% between families ~20 Ma apart, 5.4% between the order's halves),
// so deeper splits stand further apart at every zoom. The splits above the families (the order's halves, the
// superfamilies) are always open: from afar each family is one branch with dark space between it and the
// next. A split inside a family opens with the width zoom (a in [0, 1]), the older first: from z0 = OPEN_Z * (20 Ma /
// age)^OPEN_POW to OPEN_SPAN times that, z the order's width on screen over the screen's (home frames it at
// ~0.55 on a phone, its families' gaps taking the rest). So a family's crown (12-20 Ma) parts at 1.5-2.5x
// home, sisters 2 Ma apart by ~6x, 0.5 Ma apart by ~15x: zooming in, the species stand apart one by one.
// Time zoom changes nothing.

import { ease, laneW, segAt, type Fan, type FanBranch, type FanNode } from './layout';
import { smoother } from './population';
import { ORDER_TAXA, taxonKey } from './splits';

/** A split's full gap, as a share of the order's width: GAP_K * (its age / 2 Ma)^GAP_POW. */
export const GAP_K = 0.006;
export const GAP_POW = 0.7;
/** A split inside a family opens from z0 = OPEN_Z * (20 Ma / age)^OPEN_POW to OPEN_SPAN * z0 (z: the order's drawn extent at home on screen over the screen's; ~0.8 at home). */
export const OPEN_Z = 1.15;
export const OPEN_POW = 0.6;
export const OPEN_SPAN = 2.5;

/** The least age a split between two families gaps as (the seals' families split ~10 Ma ago, inside some families' crowns). */
export const FAMILY_MIN_MA = 15;
/** The splits above the families gap FAMILY_GAP_X times as wide as their age gives: from afar the families stand clearly apart. */
export const FAMILY_GAP_X = 3.5;

/**
 * A level above the orders (ToLaD#247, the mammals): each order (a split founding a taxon of splits.ts ORDER_TAXA, not the
 * fan's root) folds as the carnivores do, one branch from afar. Inside it everything is scaled to the order: its gaps a
 * share of its own width (its columns' at "now"), its families' splits opening by its own extent on screen; the splits
 * between its families open as the whole fan grows from ORDER_OPEN_LO to ORDER_OPEN_HI of the screen (home frames it at
 * ~0.9): from home every order is one branch (the rodents and bats, most of the width in linear widths, too). The splits above the orders are always open, their gaps scaled to TOP_SUM of the
 * fan's width in all (else ~27 orders' deep gaps would be several times the fan's width).
 */
export const ORDER_OPEN_LO = 1.3;
/** Inside an order, a split the data names no family for opens as a family's does when younger than this (Ma; most families' crowns are): many families' splits are unnamed. */
export const ORDER_FAMILY_MA = 22;
export const ORDER_OPEN_HI = 3.5;
export const TOP_SUM = 0.9;

/** A split's full gap (a share of the order's width), by its age (Ma). */
export const gapShare = (ageMa: number) => GAP_K * Math.pow(Math.max(ageMa, 1e-3) / 2, GAP_POW);

/** Whether split v is inside a family (the family's own split or under it): it opens with the zoom; above them, always open. */
export function inFamily(v: FanNode | null): boolean {
  for (let u = v; u; u = u.parent) if (/idae$/.test(taxonKey(u.split.taxon ?? ''))) return true;
  return false;
}
/**
 * How tall (world) a room's bend is, at least (roomAt): 72 world units, ~0.7 of a decade of the log time axis,
 * 46 px at a phone's home time scale (574 px for TIME_H) and taller at every deeper time zoom: a bend, never a
 * ledge. ROOM_BAND: how far a column's width may fall under its room's within a stretch (the hole's bound).
 */
export const ROOM_BEND = 72;
export const ROOM_BAND = 1.3;
/** A gap's fork (Fold.setScale): at least FORK_MIN world tall, else its width on screen over FORK_SLOPE times SY_HOME (px per world, a phone's home time scale). */
export const FORK_MIN = 12;
export const FORK_SLOPE = 2;
export const SY_HOME = 0.64;

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

/** What the layout's positions depend on, besides the tree and the width zoom: the splits' openness. */
export interface FoldState {
  a: Float64Array;
}

/**
 * The splits' gaps and openness, and the view's interface to the layout (fan.tess.fold): Steady (steady.ts) places the
 * columns. Per neighbouring pair of strands (i, i + 1) in the drawn order: the split they meet at, its gap, how open it is.
 */
export abstract class Fold {
  /** The strands left to right (the fan's drawn order, FanBranch.index). */
  readonly strands: FanBranch[];
  /** Per pair: the split its two strands meet at. */
  readonly pairNode: FanNode[];
  /** Per pair: its split's full gap (world), and whether it opens with the zoom (inside a family). */
  readonly pairGap: Float64Array;
  readonly pairFam: Uint8Array;
  /** Per pair: the order its split is inside (ToLaD#247: an index into ordShare), or -1 (not inside one, or no orders: a single order's fan). */
  readonly pairOrd: Int32Array;
  /** Per order: its share of the fan's width at "now". */
  readonly ordShare: number[] = [];
  /**
   * Per pair: its fork's least top (a bend tall, or its daughters' leans), and its top at this zoom (setScale: shorter
   * for a gap narrow on screen). Steady places nothing by them; setScale still bumps the version when they move, so the
   * view's applyFold takes a zoom for a move (its coarse grid while it moves) as it always has.
   */
  private readonly forkTop0: Float64Array;
  private readonly forkTop: Float64Array;
  /** Per pair: how open its split is. */
  readonly a: Float64Array;
  /** "Now" (world y). */
  protected readonly yRef: number;
  /** Bumped whenever the a's change (callers' caches of positions go stale). */
  ver = 0;
  sx = NaN;
  screenW = NaN;
  /** The grid the view reads moves from (world height between rows), or 0: exact at every height. */
  gridH = 0;
  /** The stem's centre (world x): where the closed order stands. */
  readonly home: number;

  constructor(readonly fan: Fan) {
    this.strands = fan.root.strands;
    const n = this.strands.length;
    this.forkTop = new Float64Array(Math.max(0, n - 1));
    this.forkTop0 = new Float64Array(Math.max(0, n - 1));
    this.pairNode = [];
    this.pairGap = new Float64Array(Math.max(0, n - 1));
    this.pairFam = new Uint8Array(Math.max(0, n - 1));
    this.pairOrd = new Int32Array(Math.max(0, n - 1)).fill(-1);
    // (The orders below the root: none at the carnivore or cat level, whose root is the order itself.)
    const ords = new Map<FanNode, number>();
    const ordOf = (v: FanNode): number => {
      for (let u: FanNode | null = v; u && u.parent; u = u.parent)
        if (ORDER_TAXA.has(taxonKey(u.split.taxon ?? ''))) {
          if (!ords.has(u)) ords.set(u, ords.size);
          return ords.get(u)!;
        }
      return -1;
    };
    this.a = new Float64Array(Math.max(0, n - 1)).fill(1);
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
      this.pairFam[i] = inFamily(v) ? 1 : 0;
      this.pairOrd[i] = ordOf(v);
      // (Two families apart at least as far as a split FAMILY_MIN_MA old: a family is never a family's sister's seam.)
      this.pairGap[i] = (this.pairFam[i] ? gapShare(v.ageMa) : FAMILY_GAP_X * gapShare(Math.max(v.ageMa, FAMILY_MIN_MA))) * fan.trunkWidth;
      // (At least a bend tall: a gap opens as a branch parts, never a ledge.)
      this.forkTop0[i] = Math.min(dp.leanY, dq.leanY, v.y - ROOM_BEND);
      this.forkTop[i] = this.forkTop0[i];
    }
    this.home = fan.root.left + fan.root.width / 2;
    this.yRef = fan.time.y(0);
    if (ords.size) this.scaleOrders([...ords.keys()]);
  }

  /** The level above the orders (ToLaD#247): each order's share of the width at "now", and the gaps scaled to it (ORDER_OPEN_LO's note). */
  private scaleOrders(nodes: FanNode[]): void {
    const r = this.nowRow();
    const wOf = (v: FanNode) => v.strands.reduce((s, b) => s + (r.own[b.index] ? r.w[r.item[b.index]] : 0), 0);
    const all = this.strands.reduce((s, b) => s + (r.own[b.index] ? r.w[r.item[b.index]] : 0), 0) || 1;
    for (const v of nodes) this.ordShare.push(wOf(v) / all);
    const W = this.fan.trunkWidth;
    let top = 0;
    for (let i = 0; i < this.pairGap.length; i++) {
      const g = this.pairOrd[i];
      const v = this.pairNode[i];
      if (g >= 0) this.pairGap[i] = (this.famLike(i) ? gapShare(v.ageMa) : FAMILY_GAP_X * gapShare(Math.max(v.ageMa, FAMILY_MIN_MA))) * W * this.ordShare[g];
      else top += this.pairGap[i];
    }
    const k = top > 0 ? Math.min(1, (TOP_SUM * W) / top) : 1;
    for (let i = 0; i < this.pairGap.length; i++) if (this.pairOrd[i] < 0) this.pairGap[i] *= k;
  }

  /**
   * The columns at "now", left to right, for the orders' shares (scaleOrders): per item its width (an own column's
   * room, roomAt; a parent column's width), per strand its item and whether it is its own column.
   */
  private nowRow(): { w: Float64Array; item: Int32Array; own: Uint8Array } {
    const y = this.yRef;
    const S = this.strands;
    const n = S.length;
    const w = new Float64Array(n);
    const item = new Int32Array(n);
    const own = new Uint8Array(n);
    // (The row's age, once: every own column's width is read at it.)
    const age = this.fan.time.ageAt(y);
    let m = 0;
    let node: FanNode | null = null;
    // (The parent column a strand is in holds its next strands too, up to its last.)
    let last = -1;
    for (let i = 0; i < n; i++) {
      const b = S[i];
      if (y >= b.splitY) {
        if (node && i <= last) {
          item[i] = m - 1;
          continue;
        }
        const v = segAt(b, y).node;
        if (v === node) {
          item[i] = m - 1;
          continue;
        }
        node = v;
        last = v.strands[v.strands.length - 1].index;
        w[m] = v.width;
      } else {
        node = null;
        w[m] = this.roomAt(b, y, age);
        own[i] = 1;
      }
      item[i] = m;
      m++;
    }
    return { w, item, own };
  }

  /** Whether pair i's split is a family's own or under one: named, or inside an order and younger than ORDER_FAMILY_MA. */
  private famLike(i: number): boolean {
    return this.pairFam[i] === 1 || (this.pairOrd[i] >= 0 && this.pairNode[i].ageMa < ORDER_FAMILY_MA);
  }

  /** Whether pair i's split opens with the zoom (inside a family or an order); else always open. */
  folds(i: number): boolean {
    return this.pairFam[i] === 1 || this.pairOrd[i] >= 0;
  }

  /**
   * Strand b's room at height y, above its split (its own column; world): fixed over each of its stretches
   * (roomPlan), so the column stands straight and narrows or widens about its room's centre; between two
   * stretches it bends over ROOM_BEND (ease), as at its peel from its founders' slot (never narrower than the
   * column); an extinct one's room closes after its tip over as long again (the line's end, as its split was
   * its start).
   */
  roomAt(b: FanBranch, y: number, age?: number): number {
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
      const w = laneW(b, yy);
      const e = 0.4 * L[0] * u * (1 - u);
      r = (r + w + Math.sqrt((r - w) * (r - w) + e * e)) / 2;
    } else if (k > 0 && yy > B[k] - ROOM_BEND / 2) r = L[k - 1] + (L[k] - L[k - 1]) * ease(edge, 0.5 + (B[k] - yy) / ROOM_BEND);
    else if (k + 2 < B.length && yy < B[k + 1] + ROOM_BEND / 2) r = L[k] + (L[k + 1] - L[k]) * ease(edge, 0.5 + (B[k + 1] - yy) / ROOM_BEND);
    if (y >= b.tipY) return Math.max(r, laneW(b, y, age));
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
      for (let k = 0; k <= 64; k++) R = Math.max(R, laneW(b, b.splitY - (span * k) / 64 - 1e-9));
      p = { B: Float64Array.of(b.splitY, top), L: Float64Array.of(R), peel, hug: [] };
    } else {
      const dy = H / 16;
      const n = Math.ceil(span / dy) + 1;
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = laneW(b, Math.max(top, b.splitY - i * dy - (i === 0 ? 1e-9 : 0)));
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
        // (Never narrower than the stretch before it: a column that crashes stands narrower in its room, its
        // neighbours still; they move sideways only at a split or for a boom, ToLaD#146.)
        L.push(Math.max(Math.min(hi, ROOM_BAND * lo), i0 === 0 ? b.baseW : L[L.length - 1]));
        if (hi > ROOM_BAND * lo) hug.push(L.length - 1);
        B.push(j === n - 1 ? top : b.splitY - j * dy);
        i0 = j;
      }
      p = { B: Float64Array.from(B), L: Float64Array.from(L), peel, hug };
    }
    this.plans.set(b, p);
    return p;
  }

  /** How long (world) a strand's room takes to grow from its founders' slot: its peel, at least a bend. */
  static peelH(b: FanBranch): number {
    return Math.max(b.splitY - b.leanY, ROOM_BEND);
  }

  /** How long (world) an extinct strand's room takes to close after its tip: as long as its peel took. */
  static endH(b: FanBranch): number {
    return Math.max(Fold.peelH(b), 0.02 * (b.splitY - b.tipY));
  }

  /** Set the width zoom (px per world unit) and screen width (px): true if any split's openness changed. */
  setScale(sx: number, screenW: number): boolean {
    if (sx === this.sx && screenW === this.screenW) return false;
    this.sx = sx;
    this.screenW = screenW;
    let changed = false;
    // (z: the order's drawn extent at home, its families apart and each closed, on screen over the screen's.)
    const [e0, e1] = this.homeExtent();
    const order = (e1 - e0) * sx;
    for (let i = 0; i < this.a.length; i++) {
      const g = this.pairOrd[i];
      const a =
        g >= 0
          ? this.famLike(i)
            ? openness(this.pairNode[i].ageMa, order * this.ordShare[g], screenW)
            : logRamp(order / screenW, ORDER_OPEN_LO, ORDER_OPEN_HI)
          : this.pairFam[i]
            ? openness(this.pairNode[i].ageMa, order, screenW)
            : 1;
      if (a !== this.a[i]) changed = true;
      this.a[i] = a;
      // (A gap opens over a height by its width on screen, at most FORK_SLOPE px across per px up at a phone's home
      // time scale, between FORK_MIN and its least fork: a narrow one parts crisply at its split, not leaning
      // its neighbours over a decade, ToLaD#146; a wide one never a ledge.)
      const v = this.pairNode[i];
      const h = Math.min(v.y - this.forkTop0[i], Math.max(FORK_MIN, (a * this.pairGap[i] * sx) / (FORK_SLOPE * SY_HOME)));
      if (v.y - h !== this.forkTop[i]) changed = true;
      this.forkTop[i] = v.y - h;
    }
    if (changed) this.ver++;
    return changed;
  }

  /** Every split inside a family open (1) or closed (0), those above them open (or, `all`, as those): for tests and the cat level. */
  setAll(a: number, all = false): void {
    for (let i = 0; i < this.a.length; i++) this.a[i] = this.folds(i) || all ? a : 1;
    this.sx = NaN;
    this.ver++;
  }

  /** The order's extent (world) as home shows it: the families apart, each closed. */
  abstract homeExtent(): [number, number];

  /** Strand i's left edge at height y (its slot's in a parent column), or its own column's centre above its split. */
  abstract left(i: number, y: number): number | null;

  /** The grid's row k's edges per strand (left(i, k * gridH) for every strand i at once). */
  abstract rowXs(k: number): Float64Array;

  /** The grid's row k's extent of strands i0..i1 (world [left, right]): strand i0's left edge to strand i1's right. */
  /** (Into out when given: no tuple a row, the draw's merged clades, ToLaD#255.) */
  abstract extent(i0: number, i1: number, k: number, out?: [number, number]): [number, number];

  /** Where world point (x, y) goes when the a's change from `prev` to the current ones (the camera keeps it under the fingers). */
  abstract follow(x: number, y: number, prev: FoldState): number;

  /** Change the grid (world height between rows, a power of two). */
  setGrid(h: number): void {
    this.gridH = h;
  }

  /**
   * The layout as it stands (its zoom and openness), put back by the function returned: for frames computed for
   * another view (brackets.ts foldedFrame moves it to each frame's), as a double-tap's ladder (ToLaD#241).
   */
  keep(): () => void {
    const [sx, w] = [this.sx, this.screenW];
    return () => {
      if (sx > 0 && w > 0) this.setScale(sx, w);
      this.ver++;
    };
  }

  snapshot(): FoldState {
    return { a: Float64Array.from(this.a) };
  }
}
