// Territories, fit zooms and the cut (ToLaD#333, research/scalable-tree.md steps 1–2): one set of boxes for names,
// pictures, "+x" and framing.
//
// A node's territory is its steady room (steady.ts) plus half the gap on each side (fold.ts: a split's gap, with `age`
// gaps its openness by the width zoom). Rooms are disjoint and nested, and the gaps between neighbours are split down the middle, so
// territories are disjoint and nested too, and on screen they only grow as the width zoom grows (the openness never
// falls). Time zoom and panning never change them.
//
// A label (a name pill standing upright, a picture disc) fits a node when its box is no wider than the node's territory
// on screen. By monotonicity that is one threshold per node and box, its fit zoom, found once per screen width
// (Territories.fitZoom) on a ladder of zooms 1/LADDER of a doubling apart, rounded up: a label never shows before it fits.
//
// The cut (OneZoom's signposts, Been et al.'s active ranges; ToLaD#358, one cut, one label): one label per item, its
// picture and its name together, so one cut at the label's width. Walking from the root, a node none of whose
// daughters fit is one item (it stands for its species); a node with some opens: each fitting daughter is walked, and
// each run of neighbouring daughters that do not fit rides with its neighbour's edge item (CutItem), never shown
// apart. Every species is under exactly one item, every item holds its label, items' territories are disjoint, an item
// only splits as the zoom grows, and the cut depends only on the width zoom and the screen.
//
// A clade with living species fits at "now" and one with none at its own youngest tip, usually lower, where the room is
// wide. So nothing living rides on a daughter with none (ToLaD#395): she would carry it far from its branches. Living
// species only ever ride on living ones: a daughter with none stands only if no living sister would ride on her, and a
// node with living species opens only when a daughter with living species fits.
//
// That is widest rooms (Steady's `life` off, tests). Under rooms by life (the view's), sister rooms stay apart only
// while both lived, so a territory is per row instead (Steady.cell): at each row the lineages there split x at the
// middles between their drawn edges (a 1D Voronoi of the row), and an item's territory is its strands' share over the
// rows its label takes (RowsOf: its picture over its youngest tip, its pill right under it, a lineage keeping its place
// that high over its tip). Items are runs of strands that do not overlap, so their territories are disjoint at every
// row they share: labels inside their own never meet, by construction. They depend on the camera's height too.

import { isNode, type Fan, type FanBranch, type FanNode } from './layout';
import { LABEL_AXIS_X, PIC_ROOM } from './pics';
import type { Steady } from './steady';

/** Fit zooms are resolved to 1/LADDER of a doubling (rounded up): a resolution, not a look. */
export const LADDER = 32;

/**
 * One item of the cut: one label. Its head is the daughter (a node's index, or ~ a strand's) whose own territory holds
 * the label (the root, before anything does); with it ride the sisters too narrow for a label of their own next to it
 * (`parts`, head first): a run of sisters with no fitting sister on its left rides with the next fitting sister's
 * leftmost item, every other run with the previous fitting sister's rightmost item. Its strands are one run f..l.
 */
export interface CutItem {
  head: number;
  parts: number[];
  /** Its strands (drawn order, first and last). */
  f: number;
  l: number;
  /** Its territory (world x) at the layout as it stands: over its label's rows (RowsOf) under rooms by life. */
  x0: number;
  x1: number;
  /** How many species it stands for. */
  count: number;
  /** Whether its label fits its territory at this zoom (only the root, before anything fits, may not). */
  fits: boolean;
}

/** A cut item's place in the tree: its head and its strands. */
export type Ref = Pick<CutItem, 'head' | 'f' | 'l'>;

/**
 * The rows (world y, pairs of top and bottom: [ya, yb, ya2, yb2, ...]) item r's label takes, which its territory is
 * taken over (rooms by life: its strands' shares over each, intersected): the view's picture and name pill.
 */
export type RowsOf = (r: Ref) => readonly number[];

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
  /** Prefix sums of the living strands (PL[i]: those before i, a tip at "now"). */
  private readonly PL: Int32Array;
  private readonly fits = new Map<number, { node: Float64Array; strand: Float64Array }>();
  /** The last cut's daughters' territories (world x, over their rows) as its walk tried them (rooms by life). */
  terr = new Map<number, [number, number]>();

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
    const now = fan.time.y(0);
    this.PL = new Int32Array(this.R.length + 1);
    for (let i = 0; i < this.R.length; i++) this.PL[i + 1] = this.PL[i] + (this.strands[i].tipY <= now ? 1 : 0);
  }

  /** Whether daughter k (a node's index, ~ a strand's) has a living species. */
  living(k: number): boolean {
    const [f, l] = k >= 0 ? [this.first[k], this.last[k]] : [~k, ~k];
    return this.PL[l + 1] > this.PL[f];
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

  /**
   * Node j's frame under `clades` (ToLaD#408). A gap there can stand far wider than what it parts (a small order beside a
   * split of thousands), and a clade's frame is the clade, not the gaps around it: span()'s half gap past each end, but
   * no more than the clade's own padding: half its widest gap inside, or half a picture's room at the zoom where it fills
   * the frame, so its edge columns' labels stand whole.
   */
  frameSpan(j: number, out: [number, number] = [0, 0]): [number, number] {
    const { roomL, roomW } = this.fold.rooms();
    const [f, l] = [this.first[j], this.last[j]];
    let top = 0;
    for (let p = f; p < l; p++) top = Math.max(top, this.G[p]);
    const pad = Math.max(top / 2, (roomW[j] * PIC_ROOM) / 2 / (this.screenW - LABEL_AXIS_X - PIC_ROOM));
    this.span(j, out);
    out[0] = Math.max(out[0], roomL[j] - pad);
    out[1] = Math.min(out[1], roomL[j] + roomW[j] + pad);
    return out;
  }

  /** Daughter k (a node's index, ~ a strand's) as an item's place: itself at its head. */
  refOf(k: number): Ref {
    return k >= 0 ? { head: k, f: this.first[k], l: this.last[k] } : { head: k, f: ~k, l: ~k };
  }

  /** Daughter k's youngest strand (the lineage there at every row any of hers is), what her share stands on where a row's sites cross (Steady.cell). */
  private readonly anchors = new Map<number, number>();
  private anchorOf(k: number): number {
    if (k < 0) return ~k;
    let a = this.anchors.get(k);
    if (a === undefined) {
      a = this.first[k];
      for (let i = a; i <= this.last[k]; i++) if (this.strands[i].tipY < this.strands[a].tipY) a = i;
      this.anchors.set(k, a);
    }
    return a;
  }

  /** Item r's territory (world x) over its label's rows `rows(r)`, `ghost` (world) the height a lineage keeps its place above its tip (Steady.cell). */
  over(r: Ref, rows: RowsOf, ghost: number, out: [number, number] = [0, 0]): [number, number] {
    const R = rows(r);
    let a = -Infinity;
    let b = Infinity;
    for (let i = 0; i + 1 < R.length; i += 2) {
      this.fold.cell(r.f, r.l, R[i], R[i + 1], ghost, out, this.anchorOf(r.head));
      a = Math.max(a, out[0]);
      b = Math.min(b, out[1]);
    }
    out[0] = a;
    out[1] = b;
    return out;
  }

  /** Strands f..l's room (world x, span()): from the first's left to the last's right, half the open gap past each. */
  hull(f: number, l: number, out: [number, number] = [0, 0]): [number, number] {
    const b = this.span(~l, out)[1];
    out[0] = this.span(~f, out)[0];
    out[1] = b;
    return out;
  }

  /**
   * The cut at width zoom `sx` for a label `px` wide (the fold set to sx: its rooms are the positions), only what
   * meets world x [vx0, vx1] (the screen): O(what is on screen, and a path down each side). Items left to right.
   *
   * A daughter fits when its own territory holds the label: rooms by life, over its label's rows (`rows`, over();
   * without, its youngest tip's row), as laid out; widest rooms, from its fit zoom on. Walking from the root, a node
   * none of whose daughters fit is one item; one with some opens: each fitting daughter is walked, each run of
   * sisters that do not fit rides with its neighbour's edge item (CutItem). So every item holds its label, every
   * species is under exactly one, and as the zoom grows an item only splits: a fitting daughter fits on, and a run
   * gives up a sister only as she fits, the sisters on each side of her riding with her or as before. A daughter with no
   * living species that fits but would carry living ones rides herself (stands(), ToLaD#395).
   */
  cut(sx: number, px: number, vx0 = -Infinity, vx1 = Infinity, rows?: RowsOf, ghost = 0, known?: Map<number, [number, number]>): CutItem[] {
    const pushed: CutItem[] = [];
    const s: [number, number] = [0, 0];
    const life = this.fold.life;
    const R: RowsOf = rows ?? ((r) => [this.youngest(r.f, r.l), this.youngest(r.f, r.l)]);
    const z = life ? null : this.fitZoom(px);
    const fit = (x0: number, x1: number) => sx * (x1 - x0) >= px * (1 - 1e-9);
    // (Whether each daughter fits, as the walk meets it, by its key; under rooms by life, her territory over her rows.)
    const got = new Map<number, boolean>();
    // (`known`: the territories of an earlier cut of this frame on the same rows, not worked out again, ToLaD#396.)
    const terr = (this.terr = known ?? new Map<number, [number, number]>());
    const ok = (k: number): boolean => {
      let o = got.get(k);
      if (o === undefined) {
        if (z) o = sx >= (k >= 0 ? z.node[k] : z.strand[~k]);
        else {
          let t = terr.get(k);
          if (!t) terr.set(k, (t = this.over(this.refOf(k), R, ghost, [0, 0])));
          o = fit(t[0], t[1]);
        }
        got.set(k, o);
      }
      return o;
    };
    const meets = (x0: number, x1: number) => x1 >= vx0 && x0 <= vx1;
    // (On screen: her room, or her territory over her rows, which reaches past her room where her neighbours there
    // have ended, ToLaD#359: a label stands wherever its territory's part on screen holds it.)
    const on = (k: number) => {
      if ((this.span(k, s), meets(s[0], s[1]))) return true;
      const t = terr.get(k);
      return !!t && meets(t[0], t[1]);
    };
    /**
     * Which of node k's daughters stand as items: those that fit, less those with no living species that a living one
     * would ride on (its sisters' runs, or `inL`, `inR`: what rides on k's own left and right edge items, from above).
     * Such a one rides too, so her neighbour takes her run and hers. Null: none stands, k is one item.
     */
    const stands = (k: number, inL: boolean, inR: boolean): Uint8Array | null => {
      if (k < 0) return null;
      const K = this.kids[k];
      const st = Uint8Array.from(K, (d) => (ok(d) ? 1 : 0));
      let live = inR;
      for (let q = K.length - 1; q >= 0; q--) {
        if (!st[q]) live ||= this.living(K[q]);
        else if (live && !this.living(K[q])) st[q] = 0;
        else live = false;
      }
      live = inL;
      for (let q = 0; q < K.length; q++) {
        if (!st[q]) live ||= this.living(K[q]);
        else if (live && !this.living(K[q])) st[q] = 0;
        else break;
      }
      return st.includes(1) ? st : null;
    };
    const ride = (it: CutItem | null, k: number) => {
      if (!it) return;
      const r = this.refOf(k);
      it.parts.push(k);
      it.f = Math.min(it.f, r.f);
      it.l = Math.max(it.l, r.l);
      it.count += r.l - r.f + 1;
    };
    /**
     * Daughter k walked: its leftmost and rightmost items. Off screen only what its sisters ride on is worked out,
     * `need` (1 its leftmost, 2 its rightmost), one path down each (null: not worked out). `inL`, `inR`: whether a
     * living species will ride on its leftmost, its rightmost item.
     */
    const walk = (k: number, need: number, inL: boolean, inR: boolean): [CutItem | null, CutItem | null] => {
      const st = stands(k, inL, inR);
      if (!st) {
        const r = this.refOf(k);
        const it: CutItem = { head: k, parts: [k], f: r.f, l: r.l, x0: 0, x1: 0, count: r.l - r.f + 1, fits: true };
        pushed.push(it);
        return [it, it];
      }
      const full = on(k);
      const K = this.kids[k];
      let q1 = -1;
      let qn = -1;
      for (let q = 0; q < K.length; q++)
        if (st[q]) {
          if (q1 < 0) q1 = q;
          qn = q;
        }
      let L: CutItem | null = null;
      let Rt: CutItem | null = null;
      const before: number[] = [];
      for (let q = 0; q < K.length; q++) {
        if (!st[q]) {
          if (q < q1) before.push(K[q]);
          else ride(Rt, K[q]);
          continue;
        }
        // (On screen, all of it; off screen, only the edges that sisters ride on, its own or its mother's.)
        const n = full
          ? on(K[q])
            ? 3
            : (q === q1 && before.length ? 1 : 0) | (q + 1 < K.length && !st[q + 1] ? 2 : 0)
          : (q === q1 && need & 1 ? 1 : 0) | (q === qn && need & 2 ? 2 : 0);
        // (What rides on her edges: her run after her, and from k's own edges where she is its first or last.)
        let liveR = q === qn && inR;
        for (let o = q + 1; o < K.length && !st[o] && !liveR; o++) liveR = this.living(K[o]);
        const liveL = q === q1 && (inL || before.some((o) => this.living(o)));
        const [a, b] = n ? walk(K[q], n, liveL, liveR) : [null, null];
        if (q === q1) {
          for (const o of before) ride(a, o);
          L = a;
        }
        Rt = b;
      }
      return [L, Rt];
    };
    const root = this.index.get(this.fan.root)!;
    if (!on(root)) return [];
    walk(root, 3, false, false);
    const out: CutItem[] = [];
    for (const it of pushed) {
      const t = life ? this.over(it, R, ghost, s) : this.hull(it.f, it.l, s);
      [it.x0, it.x1] = t;
      it.fits = fit(t[0], t[1]);
      if (meets(it.x0, it.x1)) out.push(it);
    }
    return out;
  }

  /** Strands f..l's youngest tip (world y, "now" at most; cut()'s rows without the view's). */
  private youngest(f: number, l: number): number {
    let y = Infinity;
    for (let i = f; i <= l; i++) y = Math.min(y, this.strands[i].tipY);
    return Math.max(y, this.fan.time.y(0));
  }
}
