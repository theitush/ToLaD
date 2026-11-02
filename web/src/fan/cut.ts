// Territories, fit zooms and the cut (ToLaD#333, research/scalable-tree.md steps 1–2): one set of boxes for names,
// pictures, "+x" and framing.
//
// A node's territory is its steady room (steady.ts) plus half the gap on each side (fold.ts: a split's gap, its openness
// by the width zoom). Rooms are disjoint and nested, and the gaps between neighbours are split down the middle, so
// territories are disjoint and nested too, and on screen they only grow as the width zoom grows (the openness never
// falls). Time zoom and panning never change them.
//
// A label (a name pill standing upright, a picture disc) fits a node when its box is no wider than the node's territory
// on screen. By monotonicity that is one threshold per node and box, its fit zoom, found once per screen width
// (Territories.fitZoom) on a ladder of zooms 1/LADDER of a doubling apart, rounded up: a label never shows before it fits.
//
// The cut (OneZoom's signposts, Been et al.'s active ranges): walking from the root, a node whose daughters all fit is
// opened; a node none of whose daughters fit is one item (it stands for its species); a node with some daughters that
// fit opens those and gathers each run of neighbouring daughters that do not into one item (its "+x"). Every species is
// under exactly one item, items' territories are disjoint, and the cut depends only on the width zoom and the screen.
//
// That is widest rooms (Steady's `life` off, tests). Under rooms by life (the view's), sister rooms stay apart only
// while both lived, so a territory is per row instead (Steady.cell): at each row the lineages there split x at the
// middles between their drawn edges (a 1D Voronoi of the row), and an item's territory is its strands' share over the
// rows its label takes (RowsOf: its pill from mid-branch, its picture over its youngest tip, a lineage keeping its place
// that high over its tip). Items are runs of strands that do not overlap, so their territories are disjoint at every
// row they share: labels inside their own never meet, by construction. They depend on the camera's height too.

import { isNode, type Fan, type FanBranch, type FanNode } from './layout';
import type { Steady } from './steady';

/** Fit zooms are resolved to 1/LADDER of a doubling (rounded up): a resolution, not a look. */
export const LADDER = 32;

/** One item of the cut: a species, a node standing for its species, or a run of a node's daughters (`q0..q1`) that do not fit. */
export interface CutItem {
  kind: 'leaf' | 'node' | 'run';
  /** A leaf's strand (drawn order index), a node's or run's node (fan.nodes index). */
  j: number;
  /** A run's daughters (indices into the node's kids). */
  q0: number;
  q1: number;
  /** Its strands (drawn order, first and last). */
  f: number;
  l: number;
  /** Its territory (world x) at the layout as it stands: over its label's rows (RowsOf) under rooms by life. */
  x0: number;
  x1: number;
  /** How many species it stands for. */
  count: number;
  /** Whether its box fits its territory at this zoom (a run, or the root before anything fits, may not). */
  fits: boolean;
}

/** A cut item's place in the tree (CutItem's kind, j, q0, q1). */
export type Ref = Pick<CutItem, 'kind' | 'j' | 'q0' | 'q1'>;

/**
 * The rows (world y, top and bottom) item r's label takes, which its territory is taken over (rooms by life): the
 * view's pill or picture, as it stands.
 */
export type RowsOf = (r: Ref) => [number, number];

export class Territories {
  readonly nodes: readonly FanNode[];
  readonly strands: readonly FanBranch[];
  /** Per strand: its room (world; Steady's, its widest). Per pair (strand i, i + 1): its gap when fully open. */
  private readonly R: Float64Array;
  private readonly G: Float64Array;
  /** Per node: its strands' run [first, last] (drawn order), its daughters (a node's index, or ~ a strand's), its species. */
  readonly first: Int32Array;
  readonly last: Int32Array;
  readonly kids: Int32Array[];
  readonly count: Int32Array;
  readonly index = new Map<FanNode, number>();
  /** Prefix sums of the rooms (PR[i]: strands before i). */
  private readonly PR: Float64Array;
  private readonly fits = new Map<number, { node: Float64Array; strand: Float64Array }>();

  constructor(
    readonly fan: Fan,
    readonly fold: Steady,
    readonly screenW: number,
  ) {
    this.nodes = fan.nodes;
    this.strands = fold.strands;
    this.nodes.forEach((v, j) => this.index.set(v, j));
    this.R = Float64Array.from(this.strands, (b) => Math.max(b.width, b.baseW));
    this.G = fold.pairGap;
    this.first = Int32Array.from(this.nodes, (v) => v.strands[0].index);
    this.last = Int32Array.from(this.nodes, (v) => v.strands[v.strands.length - 1].index);
    this.count = Int32Array.from(this.nodes, (v) => v.strands.length);
    this.kids = this.nodes.map((v) => Int32Array.from(v.kids, (k) => (isNode(k) ? this.index.get(k)! : ~k.index)));
    this.PR = new Float64Array(this.R.length + 1);
    for (let i = 0; i < this.R.length; i++) this.PR[i + 1] = this.PR[i] + this.R[i];
  }

  /** The gaps' prefix sums at openness A (PG[p]: the open gaps of pairs before p). */
  private gapSums(A: ArrayLike<number>, out: Float64Array = new Float64Array(this.G.length + 1)): Float64Array {
    for (let p = 0; p < this.G.length; p++) out[p + 1] = out[p] + A[p] * this.G[p];
    return out;
  }

  /** Half the open gap on each side of strands f..l (none past the ends). */
  private halves(A: ArrayLike<number>, f: number, l: number): number {
    return (f > 0 ? (A[f - 1] * this.G[f - 1]) / 2 : 0) + (l < this.R.length - 1 ? (A[l] * this.G[l]) / 2 : 0);
  }

  /** Width (world) of strands f..l's territory, given the gaps' prefix sums PG at openness A. */
  private width(A: ArrayLike<number>, PG: Float64Array, f: number, l: number): number {
    return this.PR[l + 1] - this.PR[f] + PG[l] - PG[f] + this.halves(A, f, l);
  }

  /** Node j's (or, ~j, strand ~j's) territory width (world) at width zoom sx. */
  widthAt(j: number, sx: number): number {
    const A = this.fold.opennessAt(sx, this.screenW);
    const [f, l] = j >= 0 ? [this.first[j], this.last[j]] : [~j, ~j];
    return this.width(A, this.gapSums(A), f, l);
  }

  /**
   * Each node's and strand's fit zoom for a box `px` wide (screen): the least width zoom on the ladder at which its
   * territory on screen is at least px (Infinity: never). Once per box width and screen width.
   */
  fitZoom(px: number): { node: Float64Array; strand: Float64Array } {
    let out = this.fits.get(px);
    if (out) return out;
    const nN = this.nodes.length;
    const nS = this.R.length;
    const node = new Float64Array(nN).fill(Infinity);
    const strand = new Float64Array(nS).fill(Infinity);
    // (From where the widest territory, every gap open, first could fit to where the narrowest room alone fits.)
    const ones = new Float64Array(this.G.length).fill(1);
    const all = this.width(ones, this.gapSums(ones), 0, nS - 1);
    let minR = Infinity;
    for (let i = 0; i < nS; i++) if (this.R[i] > 0) minR = Math.min(minR, this.R[i]);
    if (!(all > 0) || !(minR < Infinity)) {
      this.fits.set(px, (out = { node, strand }));
      return out;
    }
    const k0 = Math.floor(Math.log2(px / all) * LADDER);
    const k1 = Math.ceil(Math.log2(px / minR) * LADDER) + 1;
    // Each item is checked only on the rungs between where it could first fit (every gap open) and where it surely
    // does (the gaps as open as at the lowest rung, the least they get): items are bucketed by their first rung.
    const A = this.fold.opennessAt(Math.pow(2, k0 / LADDER), this.screenW);
    const PG = this.gapSums(A);
    const PG1 = this.gapSums(ones);
    const nI = nN + nS;
    const f = (q: number) => (q < nN ? this.first[q] : q - nN);
    const l = (q: number) => (q < nN ? this.last[q] : q - nN);
    const from = new Int32Array(nI);
    const until = new Int32Array(nI);
    for (let q = 0; q < nI; q++) {
      from[q] = Math.max(k0, Math.floor(Math.log2(px / this.width(ones, PG1, f(q), l(q))) * LADDER));
      until[q] = Math.min(k1, Math.ceil(Math.log2(px / this.width(A, PG, f(q), l(q))) * LADDER));
    }
    const up = this.climber();
    const order = Int32Array.from(from.keys()).sort((p, q) => from[p] - from[q]);
    let active: number[] = [];
    let o = 0;
    for (let k = k0; k <= k1 && (o < nI || active.length); k++) {
      while (o < nI && from[order[o]] <= k) active.push(order[o++]);
      if (!active.length) {
        if (o < nI) k = from[order[o]] - 1;
        continue;
      }
      const sx = Math.pow(2, k / LADDER);
      up.to(sx);
      this.gapSums(up.A, PG);
      const keep: number[] = [];
      for (const q of active) {
        if (k >= until[q] || sx * this.width(up.A, PG, f(q), l(q)) >= px) {
          if (q < nN) node[q] = sx;
          else strand[q - nN] = sx;
        } else keep.push(q);
      }
      active = keep;
    }
    this.fits.set(px, (out = { node, strand }));
    return out;
  }

  /**
   * The splits' openness as the width zoom climbs (fitZoom's and activeRanges' sweeps up the ladder): `to(sx)` sets A
   * at sx, asked in increasing order; only the splits opening at that zoom are worked out (below its ramp a split is
   * closed, above it open), each over its ramp once.
   */
  private climber(): { A: Float64Array; to: (sx: number) => void } {
    const A = new Float64Array(this.G.length);
    const ramps = Array.from(A, (_, p) => this.fold.openRamp(p, this.screenW));
    const order = Int32Array.from(A.keys())
      .filter((p) => !!ramps[p])
      .sort((p, q) => ramps[p]![0] - ramps[q]![0]);
    for (let p = 0; p < A.length; p++) if (!ramps[p]) A[p] = 1;
    let o = 0;
    let live: number[] = [];
    const to = (sx: number) => {
      while (o < order.length && ramps[order[o]]![0] < sx) live.push(order[o++]);
      const keep: number[] = [];
      for (const p of live) {
        if (sx >= ramps[p]![1]) A[p] = 1;
        else {
          A[p] = this.fold.openOne(p, sx, this.screenW);
          keep.push(p);
        }
      }
      live = keep;
    };
    return { A, to };
  }

  /**
   * Node j's (or, ~j, strand ~j's) room (world x) at the layout as it stands (the fold's zoom), with half the open gap
   * on each side: under widest rooms its territory; under rooms by life the hull its columns stand in at every time
   * (culling, framing), a label's territory being per row (over()).
   */
  span(j: number, out: [number, number] = [0, 0]): [number, number] {
    const { roomL, roomW, C } = this.fold.rooms();
    const A = this.fold.a;
    if (j >= 0) {
      const f = this.first[j];
      const l = this.last[j];
      out[0] = roomL[j] - (f > 0 ? (A[f - 1] * this.G[f - 1]) / 2 : 0);
      out[1] = roomL[j] + roomW[j] + (l < this.R.length - 1 ? (A[l] * this.G[l]) / 2 : 0);
    } else {
      const i = ~j;
      out[0] = C[i] - this.R[i] / 2 - (i > 0 ? (A[i - 1] * this.G[i - 1]) / 2 : 0);
      out[1] = C[i] + this.R[i] / 2 + (i < this.R.length - 1 ? (A[i] * this.G[i]) / 2 : 0);
    }
    return out;
  }

  /** Item r's strands, first and last (drawn order). */
  range(r: Ref, out: [number, number] = [0, 0]): [number, number] {
    if (r.kind === 'leaf') out[0] = out[1] = r.j;
    else if (r.kind === 'node') [out[0], out[1]] = [this.first[r.j], this.last[r.j]];
    else {
      const K = this.kids[r.j];
      const a = K[r.q0];
      const b = K[r.q1];
      out[0] = a >= 0 ? this.first[a] : ~a;
      out[1] = b >= 0 ? this.last[b] : ~b;
    }
    return out;
  }

  /** Daughter k (a node's index, ~ a strand's) as an item. */
  static ref(k: number): Ref {
    return k >= 0 ? { kind: 'node', j: k, q0: 0, q1: 0 } : { kind: 'leaf', j: ~k, q0: 0, q1: 0 };
  }

  /**
   * Item r's territory (world x) over its label's rows `rows(r)`: its strands' share of each row (Steady.cell, rooms
   * by life: the lineages there split it at the middles between them), `ghost` (world) the height a lineage keeps its
   * place above its tip (its picture's). Items with no strands in common have disjoint territories at every row.
   */
  over(r: Ref, rows: RowsOf, ghost: number, out: [number, number] = [0, 0]): [number, number] {
    const [ya, yb] = rows(r);
    const [f, l] = this.range(r, out);
    return this.fold.cell(f, l, ya, yb, ghost, out);
  }

  /**
   * The cut at width zoom `sx` for a box `px` wide (the fold set to sx: its rooms are the positions), only what
   * meets world x [vx0, vx1] (the screen): O(what is on screen). Items left to right. Rooms by life: an item fits
   * when its territory over its label's rows (`rows`, over(); without, its youngest tip's row) holds the box, all
   * as laid out; widest rooms: from its fit zoom on. `most` (the pictures' cut, ToLaD#333 pics333b): a node is opened
   * only when that shows more fitting items than it standing whole (a run of daughters counted too), the most a
   * node's territory can show, by a DP over its subtree on screen (Been et al.'s 1D optimum); on a tie it stands whole
   * (its face is its commonest species, the degree of interest's pick).
   */
  cut(sx: number, px: number, vx0 = -Infinity, vx1 = Infinity, rows?: RowsOf, ghost = 0, most = false): CutItem[] {
    const out: CutItem[] = [];
    const s: [number, number] = [0, 0];
    const fl: [number, number] = [0, 0];
    const life = this.fold.life;
    const R: RowsOf = rows ?? ((r) => (this.range(r, fl), [this.youngest(fl[0], fl[1]), this.youngest(fl[0], fl[1])]));
    const z = life ? null : this.fitZoom(px);
    // (Each daughter's territory, as the walk meets it, by its key.)
    const got = new Map<number, [number, number]>();
    const terr = (k: number): [number, number] => {
      let t = got.get(k);
      if (!t) got.set(k, (t = life ? this.over(Territories.ref(k), R, ghost) : this.span(k)));
      return t;
    };
    const fit = (x0: number, x1: number) => sx * (x1 - x0) >= px * (1 - 1e-9);
    const ok = (k: number) => (z ? sx >= (k >= 0 ? z.node[k] : z.strand[~k]) : fit(...terr(k)));
    const meets = (x0: number, x1: number) => x1 >= vx0 && x0 <= vx1;
    // (Culled by room, nested: an item shows when its room and its territory both meet the window.)
    const on = (k: number) => (this.span(k, s), meets(s[0], s[1]));
    const item = (r: Ref, x: [number, number], count: number, fits: boolean) => {
      this.range(r, fl);
      out.push({ kind: r.kind, j: r.j, q0: r.q0, q1: r.q1, f: fl[0], l: fl[1], x0: x[0], x1: x[1], count, fits });
    };
    const root = this.index.get(this.fan.root)!;
    // (`most`: per node on screen, the most fitting items its territory shows, and whether opening it shows more.)
    const best = new Map<number, number>();
    const opened = new Set<number>();
    const val = (k: number): number => {
      if (k < 0) return ok(k) ? 1 : 0;
      let v = best.get(k);
      if (v !== undefined) return v;
      const K = this.kids[k];
      const whole = ok(k) ? 1 : 0;
      let open = -1;
      for (let q = 0; q < K.length; q++) {
        if (!ok(K[q])) continue;
        // (Opened: each daughter that fits its most, each run of those that do not one item if it fits.)
        open = 0;
        for (let p = 0; p < K.length; p++) {
          if (ok(K[p])) {
            if (on(K[p])) open += val(K[p]);
            continue;
          }
          let p1 = p;
          while (p1 + 1 < K.length && !ok(K[p1 + 1])) p1++;
          const r: Ref = { kind: 'run', j: k, q0: p, q1: p1 };
          if (fit(...(life ? this.over(r, R, ghost, s) : this.hull(k, p, p1, s)))) open++;
          p = p1;
        }
        break;
      }
      if (open > whole) opened.add(k);
      best.set(k, (v = Math.max(whole, open)));
      return v;
    };
    const walk = (j: number): void => {
      const K = this.kids[j];
      let any = false;
      for (const k of K) if (ok(k)) any = true;
      if (any && most) any = (val(j), opened.has(j));
      if (!any) {
        const t = terr(j);
        if (meets(t[0], t[1])) item({ kind: 'node', j, q0: 0, q1: K.length - 1 }, t, this.count[j], ok(j));
        return;
      }
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (ok(k)) {
          if (k >= 0) {
            if (on(k)) walk(k);
          } else if (on(k) && meets(...terr(k))) item({ kind: 'leaf', j: ~k, q0: 0, q1: 0 }, terr(k), 1, true);
          continue;
        }
        // (A run of daughters that do not fit: one item, its territory theirs together.)
        let q1 = q;
        while (q1 + 1 < K.length && !ok(K[q1 + 1])) q1++;
        const r: Ref = { kind: 'run', j, q0: q, q1 };
        const t: [number, number] = life ? this.over(r, R, ghost) : this.hull(j, q, q1);
        let n = 0;
        for (let p = q; p <= q1; p++) n += K[p] >= 0 ? this.count[K[p]] : 1;
        const [h0, h1] = this.hull(j, q, q1, s);
        if (meets(h0, h1) && meets(t[0], t[1])) item(r, t, n, fit(t[0], t[1]));
        q = q1;
      }
    };
    if (!on(root)) return out;
    if (!ok(root)) item({ kind: 'node', j: root, q0: 0, q1: this.kids[root].length - 1 }, terr(root), this.count[root], false);
    else walk(root);
    return out;
  }

  /** Strands f..l's youngest tip (world y, "now" at most; cut()'s rows without the view's). */
  private youngest(f: number, l: number): number {
    let y = Infinity;
    for (let i = f; i <= l; i++) y = Math.min(y, this.strands[i].tipY);
    return Math.max(y, this.fan.time.y(0));
  }

  /** Node j's daughters q0..q1 together: their rooms' hull (world x, span()). */
  hull(j: number, q0: number, q1: number, out: [number, number] = [0, 0]): [number, number] {
    const K = this.kids[j];
    let a = Infinity;
    let b = -Infinity;
    for (let q = q0; q <= q1; q++) {
      this.span(K[q], out);
      a = Math.min(a, out[0]);
      b = Math.max(b, out[1]);
    }
    out[0] = a;
    out[1] = b;
    return out;
  }

  /** The ladder rung width zoom sx is on (the cut is the same from rung k's zoom, 2^(k/LADDER), up to the next's). */
  static rung(sx: number): number {
    let k = Math.floor(Math.log2(sx) * LADDER);
    while (Math.pow(2, (k + 1) / LADDER) <= sx) k++;
    while (Math.pow(2, k / LADDER) > sx) k--;
    return k;
  }

  /**
   * Borrowed room's active ranges (research/scalable-tree.md §3, plan step 2b; Been, Daiches & Yap 2006, Been,
   * Nöllenburg, Poon & Wolff 2010): for a box `px` wide, the daughters in runs (each too narrow for its own territory)
   * that show a box all the same, centred on their own territory and spilling into neighbours' that show nothing, each
   * with ONE range of rungs [a, b) in which it does. Computed once per box width (and screen width: this Territories),
   * by the zoom-only model fitZoom works in (widest rooms, the openness at each rung), so a label shows iff the zoom is
   * in its range: the same whatever the way there, and within a pinch one way it appears once and goes once.
   *
   * A daughter d of node j is in a run from j's opening (its first daughter fits) until d fits itself, when it is an
   * item of its own; while in a run its strands are borrowable room. In 1D, with boxes of one screen width, two boxes
   * that are clear of each other at a zoom stay clear at every greater one (their centres only move apart on screen), so
   * the active-range problem is solved by a sweep up the ladder, in a priority order fixed in advance (most species,
   * then named, then left to right): at each rung a waiting daughter starts when its box lies inside borrowable room
   * and clear of the boxes already showing; a showing one stays until it fits on its own, or until its room shrinks
   * under its box (a neighbour starts to fit and takes its territory back). Never started again: one range each.
   * Keyed by daughter (a node's index, ~ a strand's). O(rungs × splits + boxes' widths in strands).
   */
  activeRanges(px: number, named: (k: number) => boolean = () => true): Map<number, [number, number]> {
    let out = this.lent.get(px);
    if (out) return out;
    out = new Map();
    this.lent.set(px, out);
    const z = this.fitZoom(px);
    const nS = this.R.length;
    const rk = (sx: number) => (sx < Infinity ? Territories.rung(sx) : Infinity);
    // (Each daughter in a run at some rung: its node's opening to its own fit.)
    const D: number[] = [];
    const A0: number[] = [];
    const B: number[] = [];
    const F: number[] = [];
    const L: number[] = [];
    const W: number[] = [];
    const N: number[] = [];
    for (let j = 0; j < this.nodes.length; j++) {
      const K = this.kids[j];
      const fk = Array.from(K, (k) => rk(k >= 0 ? z.node[k] : z.strand[~k]));
      let open = Infinity;
      for (const r of fk) open = Math.min(open, r);
      if (open === Infinity) continue;
      K.forEach((k, q) => {
        if (fk[q] <= open) return;
        D.push(k);
        A0.push(open);
        B.push(fk[q]);
        F.push(k >= 0 ? this.first[k] : ~k);
        L.push(k >= 0 ? this.last[k] : ~k);
        W.push(k >= 0 ? this.count[k] : 1);
        N.push(named(k) ? 1 : 0);
      });
    }
    const n = D.length;
    if (!n) return out;
    const prio = Int32Array.from(D.keys()).sort((p, q) => W[q] - W[p] || N[q] - N[p] || F[p] - F[q]);
    const rank = new Int32Array(n);
    prio.forEach((p, r) => (rank[p] = r));
    /** The waiting daughters, in priority order. */
    let wl: number[] = [];
    const byA = Int32Array.from(D.keys()).sort((p, q) => A0[p] - A0[q]);
    const byB = Int32Array.from(D.keys()).sort((p, q) => B[p] - B[q]);
    // (Per strand: whether a daughter in a run holds it at this rung, borrowable room; at most one does.)
    const cover = new Uint8Array(nS);
    // (And the strands not held, as a Fenwick tree: whether a box's strands are all held, in O(log n).)
    const free = new Int32Array(nS + 1);
    for (let i = 1; i <= nS; i++) {
      free[i] += 1;
      const u = i + (i & -i);
      if (u <= nS) free[u] += free[i];
    }
    const hold = (i: number, v: 0 | 1) => {
      if (cover[i] === v) return;
      cover[i] = v;
      for (let u = i + 1; u <= nS; u += u & -u) free[u] += v ? -1 : 1;
    };
    const freeTo = (i: number) => {
      let t = 0;
      for (let u = i + 1; u > 0; u -= u & -u) t += free[u];
      return t;
    };
    /** Per daughter: 1 showing; waiting: in a run, not yet started; done: never again. */
    const showing = new Uint8Array(n);
    const waiting = new Uint8Array(n);
    const start = new Int32Array(n);
    /** The showing daughters, by first strand (never two over one strand: a daughter and hers are in runs at different rungs). */
    const act: number[] = [];
    const G = this.G;
    const up = this.climber();
    const Aw = up.A;
    const PG = new Float64Array(G.length + 1);
    const TL = (i: number) => this.PR[i] + PG[i] - (i > 0 ? (Aw[i - 1] * G[i - 1]) / 2 : 0);
    const TR = (i: number) => this.PR[i + 1] + PG[i] + (i < nS - 1 ? (Aw[i] * G[i]) / 2 : 0);
    const centre = (p: number) => (TL(F[p]) + TR(L[p])) / 2;
    let h = 0;
    // (Its box inside borrowable room: every strand whose territory it reaches in a run, and inside the fan.)
    const inside = (p: number) => {
      const c = centre(p);
      const eps = 1e-9 * (Math.abs(c) + h);
      if (c - h < TL(0) - eps || c + h > TR(nS - 1) + eps) return false;
      // (The strands it reaches: from the first whose territory ends past its left edge to the last starting before its right.)
      let a = 0;
      let b = F[p];
      while (a < b) {
        const m = (a + b) >> 1;
        if (TR(m) > c - h + eps) b = m;
        else a = m + 1;
      }
      const i0 = a;
      a = L[p];
      b = nS - 1;
      while (a < b) {
        const m = (a + b + 1) >> 1;
        if (TL(m) < c + h - eps) a = m;
        else b = m - 1;
      }
      return freeTo(a) - (i0 > 0 ? freeTo(i0 - 1) : 0) === 0;
    };
    const at = (p: number) => {
      let a = 0;
      let b = act.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (F[act[m]] < F[p]) a = m + 1;
        else b = m;
      }
      return a;
    };
    const end = (p: number, k: number) => {
      if (showing[p]) {
        act.splice(at(p), 1);
        out.set(D[p], [start[p], k]);
      }
      showing[p] = 0;
      waiting[p] = 0;
    };
    let minR = Infinity;
    for (let i = 0; i < nS; i++) if (this.R[i] > 0) minR = Math.min(minR, this.R[i]);
    // (Past where the narrowest room alone fits, every daughter is an item of its own.)
    const k1 = Math.ceil(Math.log2(px / minR) * LADDER) + 1;
    let kA = 0;
    let kB = 0;
    let live = 0;
    for (let k = A0[byA[0]]; k <= k1 && (kA < n || live > 0); k++) {
      if (!live && kA < n && A0[byA[kA]] > k) k = A0[byA[kA]];
      const sx = Math.pow(2, k / LADDER);
      h = px / 2 / sx;
      up.to(sx);
      this.gapSums(Aw, PG);
      // (Those that fit on their own leave their runs, then those whose node opens join one.)
      for (; kB < n && B[byB[kB]] <= k; kB++) {
        const p = byB[kB];
        if (A0[p] > k) continue;
        for (let i = F[p]; i <= L[p]; i++) hold(i, 0);
        end(p, B[p]);
        live--;
      }
      for (; kA < n && A0[byA[kA]] <= k; kA++) {
        const p = byA[kA];
        if (B[p] <= k) continue;
        for (let i = F[p]; i <= L[p]; i++) hold(i, 1);
        waiting[p] = 1;
        wl.push(p);
        live++;
      }
      wl = wl.filter((p) => waiting[p]).sort((p, q) => rank[p] - rank[q]);
      // (A showing box whose room shrank under it goes, for good.)
      for (let s = act.length - 1; s >= 0; s--) if (!inside(act[s])) end(act[s], k);
      for (const p of wl) {
        if (!waiting[p] || !inside(p)) continue;
        const s = at(p);
        const c = centre(p);
        if (s > 0 && c - centre(act[s - 1]) < 2 * h * (1 - 1e-9)) continue;
        if (s < act.length && centre(act[s]) - c < 2 * h * (1 - 1e-9)) continue;
        act.splice(s, 0, p);
        showing[p] = 1;
        start[p] = k;
        waiting[p] = 0;
      }
    }
    for (const p of act) out.set(D[p], [start[p], B[p]]);
    return out;
  }
  private readonly lent = new Map<number, Map<number, [number, number]>>();

  /**
   * Borrowed room at width zoom `sx` (plan step 2b): of the cut `items` for a box `px` wide, the daughters in its runs
   * whose active range (activeRanges) holds this rung, each centred on its own territory. Under rooms by life (`rows`),
   * a daughter's box over its label's rows: centred on its own share of them. Shown only inside its stretch's room (runs
   * side by side, between items that fit) and clear of those before it in the ranges' priority order, as laid out now:
   * the ranges come from the zoom-only model, and this keeps the boxes disjoint by construction under rooms by life
   * too. Each shown, its centre (world x).
   */
  borrowed(
    sx: number,
    px: number,
    items: readonly CutItem[],
    named: (k: number) => boolean = () => true,
    rows?: RowsOf,
    ghost = 0,
  ): Map<number, number> {
    const out = new Map<number, number>();
    const ranges = this.activeRanges(px, named);
    const k = Territories.rung(sx);
    const half = px / 2 / sx;
    const s: [number, number] = [0, 0];
    const st: [number, number] = [0, 0];
    const life = this.fold.life && rows;
    const cs: { k: number; c: number; w: number; nm: number; f: number }[] = [];
    const taken: [number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== 'run') continue;
      // (A stretch: runs side by side, each strand's next; its room the hull, or under rooms by life, per row.)
      let e = i;
      while (e + 1 < items.length && items[e + 1].kind === 'run' && items[e + 1].f === items[e].l + 1) e++;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let r = i; r <= e; r++) {
        x0 = Math.min(x0, items[r].x0);
        x1 = Math.max(x1, items[r].x1);
      }
      cs.length = 0;
      for (let r = i; r <= e; r++) {
        const K = this.kids[items[r].j];
        for (let q = items[r].q0; q <= items[r].q1; q++) {
          const d = K[q];
          const g = ranges.get(d);
          if (!g || k < g[0] || k >= g[1]) continue;
          if (life) {
            // (Over its own label's rows: centred on its share of them, inside the stretch's.)
            const R = Territories.ref(d);
            const [ya, yb] = rows(R);
            this.over(R, rows, ghost, s);
            if (!(s[1] > s[0])) continue;
            this.fold.cell(items[i].f, items[e].l, ya, yb, ghost, st);
          } else {
            this.span(d, s);
            [st[0], st[1]] = [x0, x1];
          }
          const c = (s[0] + s[1]) / 2;
          if (c - half >= st[0] && c + half <= st[1]) cs.push({ k: d, c, w: d >= 0 ? this.count[d] : 1, nm: named(d) ? 1 : 0, f: d >= 0 ? this.first[d] : ~d });
        }
      }
      cs.sort((a, b) => b.w - a.w || b.nm - a.nm || a.f - b.f);
      taken.length = 0;
      for (const x of cs) {
        if (taken.some(([a, b]) => x.c + half > a && x.c - half < b)) continue;
        taken.push([x.c - half, x.c + half]);
        out.set(x.k, x.c);
      }
      i = e;
    }
    return out;
  }
}
