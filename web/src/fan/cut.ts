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
  /** Its territory (world x) at the layout as it stands. */
  x0: number;
  x1: number;
  /** How many species it stands for. */
  count: number;
  /** Whether its box fits its territory at this zoom (a run, or the root before anything fits, may not). */
  fits: boolean;
}

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
    const ramps = Array.from(A, (_, p) => this.fold.openRamp(p, this.screenW));
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
      // (Only the splits opening at this zoom are worked out: below its ramp a split is closed, above it open.)
      for (let p = 0; p < A.length; p++) {
        const r = ramps[p];
        A[p] = !r || sx >= r[1] ? 1 : sx <= r[0] ? 0 : this.fold.openOne(p, sx, this.screenW);
      }
      this.gapSums(A, PG);
      const keep: number[] = [];
      for (const q of active) {
        if (k >= until[q] || sx * this.width(A, PG, f(q), l(q)) >= px) {
          if (q < nN) node[q] = sx;
          else strand[q - nN] = sx;
        } else keep.push(q);
      }
      active = keep;
    }
    this.fits.set(px, (out = { node, strand }));
    return out;
  }

  /** Node j's (or, ~j, strand ~j's) territory (world x) at the layout as it stands (the fold's zoom). */
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
   * The cut at width zoom `sx` for a box `px` wide (the fold set to sx: its rooms are the positions), only what
   * meets world x [vx0, vx1] (the screen): O(what is on screen). Items left to right.
   */
  cut(sx: number, px: number, vx0 = -Infinity, vx1 = Infinity): CutItem[] {
    const z = this.fitZoom(px);
    const out: CutItem[] = [];
    const s: [number, number] = [0, 0];
    const ok = (k: number) => sx >= (k >= 0 ? z.node[k] : z.strand[~k]);
    const on = (k: number) => (this.span(k, s), s[1] >= vx0 && s[0] <= vx1);
    const item = (kind: CutItem['kind'], j: number, q0: number, q1: number, x0: number, x1: number, count: number, fits: boolean) =>
      out.push({ kind, j, q0, q1, x0, x1, count, fits });
    const root = this.index.get(this.fan.root)!;
    const walk = (j: number): void => {
      const K = this.kids[j];
      let any = false;
      for (const k of K) if (ok(k)) any = true;
      if (!any) {
        this.span(j, s);
        item('node', j, 0, K.length - 1, s[0], s[1], this.count[j], ok(j));
        return;
      }
      for (let q = 0; q < K.length; q++) {
        const k = K[q];
        if (ok(k)) {
          if (!on(k)) continue;
          if (k >= 0) walk(k);
          else item('leaf', ~k, 0, 0, s[0], s[1], 1, true);
          continue;
        }
        // (A run of daughters that do not fit: one item, its territory theirs together.)
        let q1 = q;
        while (q1 + 1 < K.length && !ok(K[q1 + 1])) q1++;
        const x0 = this.span(K[q], s)[0];
        const x1 = this.span(K[q1], s)[1];
        let n = 0;
        for (let r = q; r <= q1; r++) n += K[r] >= 0 ? this.count[K[r]] : 1;
        if (x1 >= vx0 && x0 <= vx1) item('run', j, q, q1, x0, x1, n, sx * (x1 - x0) >= px);
        q = q1;
      }
    };
    if (!on(root)) return out;
    if (!ok(root)) item('node', root, 0, this.kids[root].length - 1, s[0], s[1], this.count[root], false);
    else walk(root);
    return out;
  }
}
