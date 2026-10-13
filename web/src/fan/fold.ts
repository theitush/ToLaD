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

import { ease, isNode, lanesAt, segAt, type EdgeStyle, type Fan, type FanBranch, type FanNode } from './layout';
import { smoother } from './population';

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
/** A gap's fork (Fold.setScale): at least FORK_MIN world tall, else its width on screen over FORK_SLOPE times SY_HOME (px per world, a phone's home time scale). */
export const FORK_MIN = 12;
export const FORK_SLOPE = 2;
export const SY_HOME = 0.64;

/**
 * How sideways a drawn stretch of a column may run (ToLaD#210), px across per px of height on screen: whole up to
 * LEAN_MAX, fading out to nothing at LEAN_CUT. Every fork is as tall as the gaps it closes on screen, its own and
 * those its clade's splits carry to it, over LEAN_FORK (carriedForks), up to a bend: the columns on screen lean ~3 px
 * per px at most. Zoomed in far, a far family's gaps close over the bend a deep fork has, and its columns would
 * run across the screen as near-flat streaks: those stretches are culled, so an off-screen family leaves steeply or
 * not at all.
 */
export const LEAN_MAX = 5;
/** A fork, with the gaps it carries, leans at most LEAN_FORK px across per px of height at a phone's home time scale (carriedForks); EASE_MAX: the curved ease's steepest. */
export const LEAN_FORK = 3;
export const EASE_MAX = 1.875;
export const LEAN_CUT = 8;
/**
 * How far (px) a fork's columns run out at LEAN_MAX before the rest of its gap closes over a bend (ToLaD#232): half a
 * phone's width, from a split near the screen's centre to past its edge. So zoomed in, every column on screen keeps
 * its line down to its split and the branches to columns off screen run out past the edge, drawn whole.
 */
export const REACH_PX = 200;

/**
 * The deep base's variant (ToLaD#232, on main behind a button so Ita can compare): 'centre' is main's fold (forks capped
 * at a bend, far columns' near-flat closings culled: only the centre's columns reach their splits); 'reach' is round 3
 * (two-phase forks: every column runs out REACH_PX at LEAN_MAX, the rest closing over a bend); 'all' is main's forks
 * with no lean cull or fade at all (every stretch drawn, however flat). ?base=centre|reach|all; FanView.setBase.
 */
export type Base = 'centre' | 'reach' | 'all';
export const BASES: readonly Base[] = ['centre', 'reach', 'all'];
let base: Base = 'centre';
export function getBase(): Base {
  return base;
}
/** Set the variant; folds made after (FanView.setBase relays out) use it. */
export function setBase(b: Base): void {
  base = b;
}
/** A stretch's share drawn (0-1), by its lean on screen (px across per px of height). */
export function leanFade(dxPx: number, dyPx: number): number {
  return smoother(leanShare(dxPx, dyPx));
}
/** leanFade before its ease: 1 up to LEAN_MAX, falling straight to 0 at LEAN_CUT. */
export function leanShare(dxPx: number, dyPx: number): number {
  if (base === 'all') return 1;
  const s = Math.abs(dxPx) / Math.max(Math.abs(dyPx), 1e-9);
  return s <= LEAN_MAX ? 1 : s >= LEAN_CUT ? 0 : (LEAN_CUT - s) / (LEAN_CUT - LEAN_MAX);
}

/**
 * A culled stretch never leaves a column ending in a flat edge (ToLaD#210): zoomed into a small group, a far
 * family's columns stand straight on screen up to where they close a gap of thousands of px, too flat to draw;
 * cut there, their tops read as a wide stepped slab. Instead the share drawn along a strand rises at most
 * 1/LEAN_FADE_PX per px of height away from a culled stretch: the column fades out over LEAN_FADE_PX px below
 * (and above) it. Eased (leanEase, quadratic): the far families' columns all leave at their fork's row, so a
 * short or straight fade still reads as the block's flat top in the browser (round 3's 60 px, linear: half its
 * grey within 30 px of the cut); long and eased, they rise out of the dark, a tenth of their share 50 px below.
 */
export const LEAN_FADE_PX = 160;
/** The share drawn at u (0-1) of the way up a fade: quadratic, so no edge where it starts. */
export function leanEase(u: number): number {
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u;
}
/** A fading stretch is drawn in slices about this tall (px), each at its own share (straight in the height, a sixth at most a slice); under LEAN_DROP, none. */
const LEAN_SLICE_PX = 10;
const LEAN_DROP = 0.04;

/**
 * The shares at a strand's stretches' ends (ToLaD#210): n stretches bottom first, lin[i] its own share (leanShare,
 * 1 for a stretch of no height), h[i] its height on screen (px); into V[0..n], the least of every stretch's share
 * (in distance terms, its square root: leanEase) plus its distance away over LEAN_FADE_PX (a distance transform, up then down); vBot and vTop, the shares just
 * beyond its ends (a column's backdrop's daughters', drawStem). Returns whether any is under 1.
 */
export function leanEnds(n: number, lin: Float64Array, h: Float64Array, V: Float64Array, vBot = 1, vTop = 1): boolean {
  let m = Math.min(1, vBot);
  V[0] = m;
  for (let j = 1; j <= n; j++) V[j] = m = Math.min(m + h[j - 1] / LEAN_FADE_PX, Math.sqrt(lin[j - 1]), 1);
  m = Math.min(1, vTop);
  let any = false;
  for (let j = n; j >= 0; j--) {
    if (j < n) m = Math.min(m + h[j] / LEAN_FADE_PX, Math.sqrt(lin[j]), 1);
    if (m < V[j]) V[j] = m;
    if (V[j] < 1) any = true;
  }
  return any;
}

/**
 * A stretch's drawn pieces (ToLaD#210): its share lin, its ends' vb (bottom) and vt (top, leanEnds), its height hPx;
 * into out as [t0, t1, a] triples (t from its bottom 0 to its top 1, a the share drawn, over LEAN_DROP). Whole at its own
 * share where its ends allow it, else sliced where it fades. Returns how many.
 */
export function leanPieces(lin: number, vb: number, vt: number, hPx: number, out: number[]): number {
  let n = 0;
  const put = (t0: number, t1: number, s: number) => {
    const a = Math.min(1, s);
    if (a > LEAN_DROP && t1 > t0) {
      out[n++] = t0;
      out[n++] = t1;
      out[n++] = a;
    }
  };
  if (!(lin > 0)) return 0;
  // (vb, vt are distances away over LEAN_FADE_PX (leanEnds); the share drawn is their ease, lin at most: in
  // distance terms, u.)
  const u = Math.sqrt(Math.min(1, lin));
  if (Math.min(vb, vt) >= u || !(hPx > 0)) {
    put(0, 1, lin);
    return n / 3;
  }
  const F = LEAN_FADE_PX;
  const rb = Math.min(hPx, Math.max(0, (u - vb) * F));
  const rt = Math.min(hPx, Math.max(0, (u - vt) * F));
  const slices = (d0: number, d1: number) => {
    const k = Math.max(1, Math.ceil((d1 - d0) / LEAN_SLICE_PX));
    for (let i = 0; i < k; i++) {
      const a = d0 + ((d1 - d0) * i) / k;
      const b = d0 + ((d1 - d0) * (i + 1)) / k;
      const d = (a + b) / 2;
      put(a / hPx, b / hPx, Math.min(lin, leanEase(Math.min(vb + d / F, vt + (hPx - d) / F))));
    }
  };
  if (rb + rt >= hPx) slices(0, hPx);
  else {
    if (rb > 0) slices(0, rb);
    put(rb / hPx, 1 - rt / hPx, lin);
    if (rt > 0) slices(hPx - rt, hPx);
  }
  return n / 3;
}

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
  /** Per pair, how much of its gap its narrower daughter clade's life here holds open (carried(): the tree's alone, kept across refolds). */
  held?: Float64Array;
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
  /** Per pair: its fork's least top (a bend tall, or its daughters' leans); setScale shortens it for a gap narrow on screen. */
  private readonly forkTop0: Float64Array;
  /** Per pair: its fork's top with the gaps it carries (carriedForks: its clade's inner gaps close over it too); at fold version forkVer. */
  private readonly forkTopC: Float64Array;
  /** Per pair (ToLaD#232): where its fork's first phase ends (world y) and the share of its gap open there (1: one phase). */
  private readonly forkMidC: Float64Array;
  private readonly forkS: Float64Array;
  private forkVer = -1;
  /** Per pair: how open its split is. */
  readonly a: Float64Array;
  /** How open the most open split is. */
  lambda = 0;
  /** The anchor (setAnchor): per strand, its weight (all 1: the whole row, the plain mean). */
  readonly wt: Float64Array;
  /**
   * Per strand, which side its boom flares into (a domestic stock, ToLaD#146): -1 left, 1 right, away from its
   * sister; 0 for the rest. Its own column stands at its room's inner edge (on its sister's side), and the anchor
   * counts it as nothing wide there: its growth moves only its outer edge and what lies beyond it (the order's
   * edge, for the dog and the cat), never its neighbours on the inner side.
   */
  readonly flare: Int8Array;
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
  /** exact()'s rows by height (unfolded once, refolded per version): a frame asks a few dozen heights, interleaved. */
  private exactRows = new Map<number, Row>();

  constructor(readonly fan: Fan) {
    this.strands = fan.root.strands;
    const n = this.strands.length;
    this.pairW = new Float64Array(Math.max(0, n - 1));
    this.lo = new Int32Array(Math.max(0, n - 1));
    this.hi = new Int32Array(Math.max(0, n - 1));
    this.forkTop = new Float64Array(Math.max(0, n - 1));
    this.forkTop0 = new Float64Array(Math.max(0, n - 1));
    this.forkTopC = new Float64Array(Math.max(0, n - 1));
    this.forkMidC = new Float64Array(Math.max(0, n - 1));
    this.forkS = new Float64Array(Math.max(0, n - 1)).fill(1);
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
      this.pairGap[i] = (this.pairFam[i] ? gapShare(v.ageMa) : FAMILY_GAP_X * gapShare(Math.max(v.ageMa, FAMILY_MIN_MA))) * fan.trunkWidth;
      // The two daughters' strands (each a run in the drawn order) and the split's fork (where its gap opens over).
      const run = (k: FanNode | FanBranch) => (isNode(k) ? [k.strands[0].index, k.strands[k.strands.length - 1].index + 1] : [k.index, k.index + 1]);
      this.lo[i] = run(dp)[0];
      this.hi[i] = run(dq)[1];
      // (At least a bend tall: a gap opens as a branch parts, never a ledge.)
      this.forkTop0[i] = Math.min(dp.leanY, dq.leanY, v.y - ROOM_BEND);
      this.forkTop[i] = this.forkTop0[i];
    }
    this.home = fan.root.left + fan.root.width / 2;
    this.wt = new Float64Array(n).fill(1);
    this.flare = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.strands[i];
      if (b.sp.history?.component !== 'domestic' || b.sp.extinct || !b.path.length) continue;
      this.flare[i] = b.path[0].node.strands[0] === b ? -1 : 1;
    }
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

  /** Where strand b's room changes (world [lo, hi]): its peel, each bend between its stretches, each stretch it outgrows, an extinct one's end. */
  roomBends(b: FanBranch, hugs = true): [number, number][] {
    const { B, peel, hug } = this.roomPlan(b);
    const out: [number, number][] = [[b.splitY - peel, b.splitY]];
    if (hugs) for (const k of hug) out.push([B[k + 1], B[k]]);
    for (let k = 1; k + 1 < B.length; k++) out.push([B[k] - ROOM_BEND / 2, B[k] + ROOM_BEND / 2]);
    if (b.tipY > this.yRef) out.push([b.tipY - Fold.endH(b), b.tipY]);
    return out;
  }

  /** Where the gaps open (world [lo, hi]): each split's fork. */
  forks(): [number, number][] {
    this.carriedForks();
    return this.pairNode.map((v, i) => [this.forkTopC[i], v.y]);
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
      d[i] = ((r.xs[i] + (r.own[i] ? (this.flare[i] * r.sw[i]) / 2 : r.sw[i] / 2) - cx) * sx) / s;
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
    // (z: the order's drawn extent at home, its families apart and each closed, on screen over the screen's.)
    const [e0, e1] = this.homeExtent();
    const order = (e1 - e0) * sx;
    for (let i = 0; i < this.a.length; i++) {
      const a = this.pairFam[i] ? openness(this.pairNode[i].ageMa, order, screenW) : 1;
      if (a !== this.a[i]) changed = true;
      this.a[i] = a;
      // (A gap opens over a height by its width on screen, at most FORK_SLOPE px across per px up at a phone's home
      // time scale, between FORK_MIN and its least fork: a narrow one parts crisply at its split, not leaning
      // its neighbours over a decade, ToLaD#146; a wide one never a ledge.)
      const v = this.pairNode[i];
      const h = Math.min(v.y - this.forkTop0[i], Math.max(FORK_MIN, (a * this.pairGap[i] * sx) / (FORK_SLOPE * SY_HOME)));
      if (v.y - h !== this.forkTop[i]) changed = true;
      this.forkTop[i] = v.y - h;
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
        const l = r.xs[i] - (r.own[i] ? (r.sw[i] * (1 - this.flare[i])) / 2 : 0);
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

  private sizes: Float64Array | null = null;
  /** The strands' sizes (FanBranch.width), summed along the drawn order. */
  private sizeSums(): Float64Array {
    if (this.sizes) return this.sizes;
    const S = this.strands;
    const c = new Float64Array(S.length + 1);
    for (let i = 0; i < S.length; i++) c[i + 1] = c[i] + Math.max(S[i].width, 1e-12);
    return (this.sizes = c);
  }

  /** Per strand, its life here summed along the drawn order (its size, FanBranch.width; an extinct one's fading over its end after its tip, as its room). */
  private lifeSums(y: number): Float64Array {
    const S = this.strands;
    const edge = this.fan.edge;
    const C = new Float64Array(S.length + 1);
    for (let i = 0; i < S.length; i++) {
      const b = S[i];
      const f = y >= b.tipY ? 1 : 1 - ease(edge, Math.min(1, (b.tipY - y) / Fold.endH(b)));
      C[i + 1] = C[i] + b.width * f;
    }
    return C;
  }

  /** The pairs youngest split first (carried: a split's gaps flow out to its clade's edges, older splits'). */
  private ord: Int32Array | null = null;
  /** Per strand, the anchor's weights summed along the drawn order, at fold version forkVer (carriedForks). */
  private wSum = new Float64Array(0);
  /** Per pair, the share of its gap carried to its clade's left edge (carriedForks). */
  private sideL = new Float64Array(0);
  /** foldRow's and carried's scratch. */
  private xBuf = new Float64Array(0);
  private qBuf = new Float64Array(0);
  private kBuf = new Float64Array(0);
  private incBuf = new Float64Array(0);

  /**
   * Per pair at height y, its gap (world): what stands open there. A split's full gap at this zoom (a * its gap)
   * is held by its clade at every height: where its fork has not opened (below it, or partly over it) or its
   * narrower clade has ended (under a quarter of it alive; never for a decline), what is not open there is carried out to the clade's two edges, shared as the
   * anchor's weight inside it lies (more on the side away from it), and on outward through each older split's
   * fork as that one opens. So a clade's extent never changes for what happens inside it: a column moves sideways
   * only at its own lineage's splits, never at a cousin's (Ita, ToLaD#146: "the over wiggliness ... the
   * weasels"); the space inside closes at the forks as the daughters meet, and stands as dark beside the clade.
   */
  private carried(r: Row): Float64Array {
    const y = r.y;
    const m = this.a.length;
    if (!this.ord) this.ord = Int32Array.from(Array.from({ length: m }, (_, p) => p).sort((p, q) => this.pairNode[p].y - this.pairNode[q].y));
    this.carriedForks();
    // (Scratch, reused: a row is folded at a time.)
    if (this.kBuf.length !== m) {
      this.kBuf = new Float64Array(m);
      this.incBuf = new Float64Array(m);
    }
    const K = this.kBuf.fill(0);
    const inc = this.incBuf.fill(0);
    const edge = this.fan.edge;
    // (Per pair: its narrower daughter clade's life here over its size, a quarter or more holding the whole gap.)
    let H = r.held;
    if (!H) {
      const C = this.lifeSums(y);
      const CW = this.sizeSums();
      H = r.held = new Float64Array(m);
      for (let p = 0; p < m; p++) {
        const lo = this.lo[p];
        const hi = this.hi[p];
        const mm = Math.min((C[p + 1] - C[lo]) / (CW[p + 1] - CW[lo]), (C[hi] - C[p + 1]) / (CW[hi] - CW[p + 1]));
        H[p] = Math.min(1, mm / 0.25);
      }
    }
    for (let k = 0; k < m; k++) {
      const p = this.ord[k];
      const F = this.a[p] * this.pairGap[p];
      const T = F + inc[p];
      if (!(T > 0)) continue;
      const v = this.pairNode[p];
      const lo = this.lo[p];
      const hi = this.hi[p];
      const u = y >= v.y ? 0 : this.forkTopC[p] < v.y ? this.forkU(p, v.y - y, edge) : 1;
      let kept = 0;
      if (u > 0) kept = u * (inc[p] + F * H[p]);
      K[p] = kept;
      const out = T - kept;
      if (!(out > 0)) continue;
      // (Shared about the anchor's weight in the clade: the side it is on stands still.)
      const sL = this.sideL[p];
      if (lo > 0) inc[lo - 1] += out * sL;
      if (hi < m + 1) inc[hi - 1] += out * (1 - sL);
    }
    return K;
  }

  /**
   * Each fork's height with what it carries (ToLaD#210): below a split inside a clade its gap stands at the clade's
   * edges (carried) and closes at an older split's fork, with that split's own gap. So a fork closes its own gap
   * and every carried one, and it is at least as tall as that sideways distance on screen over LEAN_FORK px per px
   * at a phone's home time scale (and its ease's steepest): no near-flat streak, however many gaps a far family's
   * split closes at once. (The anchor's weights are summed here too, carried's.)
   */
  private carriedForks(): void {
    const m = this.a.length;
    if (this.forkVer === this.ver && this.wSum.length === m + 2) return;
    if (!this.ord) this.ord = Int32Array.from(Array.from({ length: m }, (_, p) => p).sort((p, q) => this.pairNode[p].y - this.pairNode[q].y));
    const P = (this.wSum = new Float64Array(m + 2));
    const reach = base === 'reach';
    // (Main's ('centre', 'all'): a hair each, the side carried as the weight lies in the clade.)
    for (let i = 0; i <= m; i++) P[i + 1] = P[i] + this.wt[i] + (reach ? 0 : 1e-3);
    // (Per pair, the share of what is not open carried to its clade's left edge (its left daughter moves, the right
    // stands): as the anchor's weight lies in it, and a clade with none (a hair) stands still on the anchor's side
    // (ToLaD#232): each of its forks moves a column away from the anchor, never back, so forks that overlap up a
    // column add up to one lean, never a wiggle.)
    if (this.sideL.length !== m) this.sideL = new Float64Array(m);
    const all = P[m + 1];
    for (let p = 0; p < m; p++) {
      const lo = this.lo[p];
      const hi = this.hi[p];
      const out = all - (P[hi] - P[lo]);
      const near = out > 0 ? (all - P[hi]) / out : 0.5;
      const e = 1e-3 * (hi - lo);
      this.sideL[p] = reach ? (P[hi] - P[p + 1] + e * near) / (P[hi] - P[lo] + e) : (P[hi] - P[p + 1]) / (P[hi] - P[lo]);
    }
    const inc = new Float64Array(m);
    const k = (this.fan.edge === 'curved' ? EASE_MAX : 1) * (this.sx / (LEAN_FORK * SY_HOME));
    for (let j = 0; j < m; j++) {
      const p = this.ord[j];
      const v = this.pairNode[p];
      const T = this.a[p] * this.pairGap[p] + inc[p];
      // (At most a bend (or its own gap's fork, setScale's, if taller), never above "now": wider than that on
      // screen, it is a far family closing at a deep split, steep and culled where drawn, leanFade.)
      const h0 = v.y - this.forkTop[p];
      const hT = k > 0 ? T * k : 0;
      // (ToLaD#232: a fork wider on screen than a bend lets at LEAN_FORK opens over as much height as it takes to cross
      // REACH_PX of it at LEAN_MAX, the whole of it if narrower: every column on screen keeps its line down to its split,
      // drawn whole. What lies further (a far family thousands of px away) closes above that, over a bend, off screen.)
      const sL = this.sideL[p];
      const top = v.y - this.yRef;
      if (!reach) {
        // (Main's ('centre', 'all'): one ease, capped at a bend.)
        this.forkTopC[p] = v.y - Math.max(h0, Math.min(hT, ROOM_BEND, top));
        this.forkS[p] = 1;
      } else {
        let hA = Math.min(hT, ROOM_BEND);
        let s = 1;
        if (hT > ROOM_BEND && k > 0) {
          const rw = REACH_PX / this.sx;
          const k5 = (k * LEAN_FORK) / LEAN_MAX;
          hA = Math.min(hT, Math.max(ROOM_BEND, Math.min(T, rw) * k5));
          if (T > rw && hA < hT) s = rw / T;
        }
        // (The second phase a bend tall, growing from nothing as the gap outgrows REACH_PX: continuous in the zoom.)
        let h = s < 1 ? hA + ROOM_BEND * Math.min(1, 1 / s - 1) : hA;
        // (Squeezed into what there is, or stretched to its own gap's fork if taller, both phases alike.)
        const h1 = Math.max(h0, Math.min(h, top));
        hA = h > 0 ? (hA * h1) / h : h1;
        h = h1;
        this.forkTopC[p] = v.y - h;
        this.forkMidC[p] = v.y - hA;
        this.forkS[p] = s;
      }
      if (!(T > 0)) continue;
      if (this.lo[p] > 0) inc[this.lo[p] - 1] += T * sL;
      if (this.hi[p] < m + 1) inc[this.hi[p] - 1] += T * (1 - sL);
    }
    this.forkVer = this.ver;
  }

  /**
   * How far pair p's gap has opened (0-1) at hy (world) above its split: an ease over its fork (carriedForks), or
   * (ToLaD#232) two: its share forkS over the height to forkMidC easing in, the rest over a bend above it, on from the
   * lean it reached and easing out.
   */
  private forkU(p: number, hy: number, edge: EdgeStyle): number {
    const h = this.pairNode[p].y - this.forkTopC[p];
    const s = this.forkS[p];
    if (!(s < 1)) return ease(edge, Math.min(1, hy / h));
    const hA = this.pairNode[p].y - this.forkMidC[p];
    // (The first half of the ease, then on at the lean it reached, steepening and easing out at the top (a cubic):
    // leaning out all the way, no kink, never standing straight between.)
    if (hy <= hA) return 2 * s * ease(edge, hy / hA / 2);
    const t = Math.min(1, (hy - hA) / (h - hA));
    if (edge !== 'curved') return s + (1 - s) * t;
    const d = 1 - s;
    const m = Math.min((s * EASE_MAX * (h - hA)) / hA, 3 * d);
    return s + m * (t * t * t - 2 * t * t + t) + d * (3 * t * t - 2 * t * t * t);
  }

  /** Fold a row with the current a's: each strand's move. */
  private foldRow(r: Row): void {
    const { w, end, n, item, y } = r;
    // Each daughter clade's width here: its items' widths (each counted at its first strand), summed along the strands.
    const S = item.length;
    // (The canonical row first, folded at this version: X and the scratch below are this row's from here on.)
    if (r.y !== this.yRef && (!this.ref || this.ref.ver !== this.ver)) this.foldRow((this.ref ??= this.riverRow(this.yRef)));
    if (this.xBuf.length < S + 1) {
      this.xBuf = new Float64Array(S + 1);
      this.qBuf = new Float64Array(S + 1);
    }
    const X = this.xBuf;
    X[0] = 0;
    const K = this.carried(r);
    for (let j = 1; j < n; j++) X[j] = X[j - 1] + w[j - 1] + K[end[j - 1] - 1];
    // Where it stands: the anchor's weighted mean slot centre where it is at "now" (the canonical row, whose plain
    // mean slot centre is on the stem's centre: each strand counted once, whatever its width, so a column that
    // grows or shrinks moves its neighbours as little as it can).
    // (A flaring column, its boom, counts as nothing wide at its room's inner edge: what lies on its inner side
    // stands where it would without it. Q: the shift that takes it out, per item, summed along the row.)
    const fl = this.flare;
    let Q: Float64Array | null = null;
    for (let i = 0; i < S; i++) {
      if (!fl[i] || !r.own[i]) continue;
      Q ??= this.qBuf.fill(0, 0, n + 1);
      const q = item[i];
      if (fl[i] > 0) Q[q + 1] -= w[q];
      else {
        Q[0] += w[q];
        Q[q] -= w[q];
      }
    }
    if (Q) for (let j = 1; j <= n; j++) Q[j] += Q[j - 1];
    let sw = 0;
    let sg = 0;
    let W = 0;
    const wt = this.wt;
    for (let i = 0; i < S; i++) {
      let c = X[item[i]] + r.off[i] + r.sw[i] / 2;
      // (A flaring column's centre: against its room's inner edge.)
      if (fl[i] && r.own[i]) c -= (fl[i] * (r.sw[i] - lanesAt(this.strands[i], y)[0])) / 2;
      sg += c;
      const ca = !Q ? c : fl[i] && r.own[i] ? X[item[i]] + Q[item[i]] + (fl[i] < 0 ? w[item[i]] : 0) : c + Q[item[i]];
      sw += wt[i] * ca;
      W += wt[i];
    }
    r.mg = sg / Math.max(1, S);
    r.mw = W > 0 ? sw / W : r.mg;
    let shift: number;
    if (r.y === this.yRef) shift = this.home - r.mg;
    else {
      const ref = this.ref!;
      shift = this.home - ref.mg + ref.mw - r.mw;
    }
    const xs = r.xs;
    // (An own column's room centre; a flaring one's room inner edge, the column held against it: leftAt.)
    for (let i = 0; i < xs.length; i++) xs[i] = X[r.item[i]] + shift + r.off[i] + (r.own[i] ? (r.sw[i] * (1 - fl[i])) / 2 : 0);
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
    if (!(h > 0)) return this.exact(i, y);
    const k = Math.floor(y / h);
    const t = y / h - k;
    const r0 = this.rowK(k);
    const a = r0.xs[i];
    if (t === 0) return a;
    const r1 = this.rowK(k + 1);
    if (r0.own[i] === r1.own[i]) return a + (r1.xs[i] - a) * t;
    // (A cell its split falls in: one row has its own column's centre, the other its slot's left edge. Mixed,
    // its edge jumped sideways by half its width for one row: a horizontal line across it at every split,
    // ToLaD#146 "least weasel 3.1M". There both are read as its left edge (as leftAt makes it of a centre),
    // that read between them, and made a centre again above its split. Its peel is a bend tall at least (many
    // rows), so its edge runs smoothly through its split: not a row of its own per height, ToLaD#209.)
    const b = this.strands[i];
    const half = (yy: number) => (lanesAt(b, yy)[0] * (1 - this.flare[i])) / 2;
    const l0 = r0.own[i] ? a - half(k * h) : a;
    const l1 = r1.own[i] ? r1.xs[i] - half((k + 1) * h) : r1.xs[i];
    const l = l0 + (l1 - l0) * t;
    return y < b.splitY ? l + half(y) : l;
  }

  /** Strand i's folded left edge (or own column's centre) at y, its row worked out at y itself. */
  private exact(i: number, y: number): number {
    let r = this.exactRows.get(y);
    if (!r) {
      if (this.exactRows.size >= 2048) this.exactRows.clear();
      this.exactRows.set(y, (r = this.riverRow(y)));
    }
    if (r.ver !== this.ver) this.foldRow(r);
    return r.xs[i];
  }

  /** The grid's rows by their index k (y = k * gridH): rowAt's, looked up by an integer (most often a small one). */
  private kRows = new Map<number, Row>();
  /** The grid's row k's edges per strand (left(i, k * gridH) for every strand i at once: a left edge, or an own column's centre). */
  rowXs(k: number): Float64Array {
    return this.rowK(k).xs;
  }
  private kH = 0;
  private rowK(k: number): Row {
    // (A frame reads the rows a strand at a time, down it: the last few by k, before the map.)
    const c = k & 63;
    let r = this.kLast[c];
    if (r === undefined || this.kLastK[c] !== k || this.kH !== this.gridH) {
      if (this.kH !== this.gridH || this.kRows.size >= 8192) {
        this.kRows.clear();
        this.kH = this.gridH;
        this.kLastK.fill(NaN);
      }
      r = this.kRows.get(k);
      if (!r) this.kRows.set(k, (r = this.rowAt(k * this.gridH)));
      this.kLast[c] = r;
      this.kLastK[c] = k;
    }
    if (r.ver !== this.ver) this.foldRow(r);
    return r;
  }
  private kLast: (Row | undefined)[] = new Array(64);
  private kLastK = new Float64Array(64).fill(NaN);

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
    const lft = (r: Row, i: number) => r.xs[i] - r.off[i] - (r.own[i] ? (r.sw[i] * (1 - this.flare[i])) / 2 : 0);
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
