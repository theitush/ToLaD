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

/** Old tests' switch until they are ported or deleted (ToLaD#342): the cut is the only label system. */
export function wantCutLabels(): boolean {
  return true;
}

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
   * as laid out; widest rooms: from its fit zoom on.
   */
  cut(sx: number, px: number, vx0 = -Infinity, vx1 = Infinity, rows?: RowsOf, ghost = 0): CutItem[] {
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
    const walk = (j: number): void => {
      const K = this.kids[j];
      let any = false;
      for (const k of K) if (ok(k)) any = true;
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
   * Borrowed room (research/scalable-tree.md §3, plan step 2b): of the cut `items` at width zoom `sx` for a box `px`
   * wide, the daughters in its runs (each too narrow for its own territory) that show a box all the same, centred on
   * their own territory and spilling into neighbours' that show nothing. Been et al. 2010's 1D active ranges along the
   * row: each stretch of runs side by side (between items that fit, their territories untouched) takes the most
   * species it can under disjoint boxes (weighted interval scheduling, optimal), `named` daughters before unnamed at
   * equal counts. From the layout as it stands, so the same whatever the way there. Under rooms by life (`rows`), a
   * daughter's box over its label's rows: centred on its own share of them, inside its stretch's. Each chosen, its
   * centre (world x).
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
    const half = px / 2 / sx;
    const s: [number, number] = [0, 0];
    const st: [number, number] = [0, 0];
    const life = this.fold.life && rows;
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
      const cs: Cand[] = [];
      for (let r = i; r <= e; r++) {
        const K = this.kids[items[r].j];
        for (let q = items[r].q0; q <= items[r].q1; q++) {
          const d = K[q];
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
          if (c - half >= st[0] && c + half <= st[1]) cs.push({ k: d, c, w: d >= 0 ? this.count[d] : 1, nm: named(d) ? 1 : 0, kept: 0 });
        }
      }
      cs.sort((a, b) => a.c - b.c);
      const at = new Map(cs.map((c) => [c.k, c.c]));
      for (const d of schedule(cs, 2 * half)) out.set(d, at.get(d)!);
      i = e;
    }
    return out;
  }
}

/** A daughter that may borrow room: its key, centre (world x), species, named (1/0), shown on the rung before (1/0). */
interface Cand {
  k: number;
  c: number;
  w: number;
  nm: number;
  kept: number;
}

/**
 * Weighted interval scheduling on the line: of boxes `d` wide centred at `c` (in order of c), the disjoint set with
 * the most kept, then the most species, then the most named. O(n log n). The keys chosen, left to right.
 */
function schedule(cs: Cand[], d: number): number[] {
  const n = cs.length;
  if (!n) return [];
  // (Per prefix: the best [kept, species, named], compared in that order.)
  const V = new Float64Array(3 * (n + 1));
  const take = new Uint8Array(n + 1);
  const prev = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const x = cs[i - 1];
    // (The last box clear of this one, by binary search.)
    let a = 0;
    let b = i - 1;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (cs[m - 1].c + d <= x.c) a = m;
      else b = m - 1;
    }
    prev[i] = a;
    const t0 = V[3 * a] + x.kept;
    const t1 = V[3 * a + 1] + x.w;
    const t2 = V[3 * a + 2] + x.nm;
    const j = 3 * (i - 1);
    if (t0 !== V[j] ? t0 > V[j] : t1 !== V[j + 1] ? t1 > V[j + 1] : t2 > V[j + 2]) {
      V[3 * i] = t0;
      V[3 * i + 1] = t1;
      V[3 * i + 2] = t2;
      take[i] = 1;
    } else V.copyWithin(3 * i, j, j + 3);
  }
  const out: number[] = [];
  for (let i = n; i > 0; )
    if (take[i]) {
      out.push(cs[i - 1].k);
      i = prev[i];
    } else i--;
  return out.reverse();
}
