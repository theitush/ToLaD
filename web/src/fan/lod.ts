// The mammal level's detail by zoom (ToLaD#247): a clade the fold has closed (fold.ts: no gap inside it wider than
// CLOSED_PX on screen) whose species are under MERGE_PX each on screen, on average, is drawn as the one branch it reads
// as: one ribbon from its left edge to its right, its green the sum of its species' (lod.ts mergedPts), not ~5,900
// hairline strands side by side, each floored to a pixel (a striped block, and most of a frame's time). Zoomed in, a
// clade parts (its gaps open) or its species widen, and it falls apart into its daughters, each merged while it still
// qualifies, down to the species. The levels with no orders above them (the cats, the carnivores) have none of this:
// their strands are drawn one by one, as before.
//
// The clade's brackets and labels go with it: what is inside a merged clade is not named on its own (the stack reads
// the path from the root down to the merged clades, the orders at home), and its species have no pills.

import { isNode, lanesAt, type Fan, type FanNode } from './layout';
import type { Fold } from './fold';

/** A closed clade is drawn as one branch while its species are under this many px wide each on screen, on average. */
export const MERGE_PX = 1;
/** A clade is closed while no gap inside it is this wide on screen (px). */
export const CLOSED_PX = 0.5;

/** A clade's greens by row (Lod.greenAt): by world y, and a front cache by k (its grid h). */
interface GreenRows {
  v: FanNode;
  m: Map<number, number>;
  K: Float64Array;
  H: Float64Array;
  G: Float64Array;
}

export class Lod {
  /** The clades drawn as one branch this frame, left to right. */
  merged: FanNode[] = [];
  /** Per strand (its drawn index, FanBranch.index): the merged clade it is in (an index into merged), or -1. */
  readonly of: Int32Array;
  /** Bumped whenever merged changes. */
  gen = 0;
  private key = '';
  private readonly idx = new Map<FanNode, number>();
  /** Per node: 1 merged, 2 inside a merged clade, 0 neither. */
  private readonly flag: Uint8Array;
  private readonly room: Float64Array;
  private readonly gap: Float64Array;
  /** Per merged-able node: its green (world, summed over its strands) per grid row, by the row's world y. */
  private green = new Map<FanNode, GreenRows>();
  private gLast: GreenRows | undefined;

  constructor(readonly fan: Fan) {
    fan.nodes.forEach((v, i) => this.idx.set(v, i));
    this.of = new Int32Array(fan.root.strands.length).fill(-1);
    this.flag = new Uint8Array(fan.nodes.length);
    this.gap = new Float64Array(fan.nodes.length);
    this.room = new Float64Array(fan.nodes.length);
    fan.nodes.forEach((v, i) => (this.room[i] = v.strands.reduce((s, b) => s + b.width, 0)));
    this.par = Int32Array.from(fan.nodes, (v) => (v.parent ? this.idx.get(v.parent)! : -1));
    this.kidN = fan.nodes.map((v) => Int32Array.from(v.kids.filter(isNode), (k) => this.idx.get(k as FanNode)!));
    this.nStr = Int32Array.from(fan.nodes, (v) => v.strands.length);
    this.rootI = this.idx.get(fan.root)!;
    this.flag2 = new Uint8Array(fan.nodes.length);
    this.stack = new Int32Array(fan.nodes.length + 1);
    this.stack2 = new Int32Array(fan.nodes.length + 1);
  }

  /** Clade v is inside a merged clade (not the merged clade itself): not named on its own. */
  hidden(v: FanNode): boolean {
    return this.flag[this.idx.get(v) ?? 0] === 2;
  }

  /** Clade v is drawn as one branch. */
  isMerged(v: FanNode): boolean {
    return this.flag[this.idx.get(v) ?? 0] === 1;
  }

  /** The merged clades at the fold's openness and width zoom sx (px per world unit): true if they changed. */
  update(fold: Fold, sx: number): boolean {
    const key = `${fold.ver}:${sx}`;
    if (key === this.key) return false;
    this.key = key;
    const N = this.fan.nodes;
    // (Typed arrays, no maps or closures: once a pinch frame at the mammal level, ~5,900 nodes, ToLaD#255.)
    if (this.pairFold !== fold) {
      this.pairFold = fold;
      this.pairIdx = Int32Array.from(fold.pairNode, (v) => this.idx.get(v)!);
    }
    const pi = this.pairIdx;
    const g = this.gap.fill(0);
    for (let i = 0; i < pi.length; i++) {
      const k = pi[i];
      g[k] = Math.max(g[k], fold.a[i] * fold.pairGap[i]);
    }
    // (Parents before their daughters in fan.nodes: the widest gap inside each clade, bottom up.)
    const par = this.par;
    for (let i = N.length - 1; i > 0; i--) {
      const k = par[i];
      if (k >= 0) g[k] = Math.max(g[k], g[i]);
    }
    const merged: FanNode[] = [];
    const flag = this.flag2.fill(0);
    // (Depth first, left to right, as the clades stand: a merged clade's nodes inside it marked, its walk stopped.)
    const st = this.stack;
    let n = 0;
    st[n++] = this.rootI;
    while (n > 0) {
      const i = st[--n];
      const kids = this.kidN[i];
      if (par[i] >= 0 && this.nStr[i] >= 2 && g[i] * sx < CLOSED_PX && (this.room[i] * sx) / this.nStr[i] < MERGE_PX) {
        flag[i] = 1;
        merged.push(N[i]);
        // (Every node inside it: its daughters' runs in fan.nodes are not contiguous, so walked.)
        let m = 0;
        const st2 = this.stack2;
        for (let q = 0; q < kids.length; q++) st2[m++] = kids[q];
        while (m > 0) {
          const d = st2[--m];
          flag[d] = 2;
          const K = this.kidN[d];
          for (let q = 0; q < K.length; q++) st2[m++] = K[q];
        }
        continue;
      }
      for (let q = kids.length - 1; q >= 0; q--) st[n++] = kids[q];
    }
    const same = merged.length === this.merged.length && merged.every((v, i) => v === this.merged[i]);
    if (same) return false;
    this.merged = merged;
    this.flag.set(flag);
    this.of.fill(-1);
    merged.forEach((v, m) => {
      for (const b of v.strands) this.of[b.index] = m;
    });
    this.gen++;
    return true;
  }
  private pairFold: Fold | null = null;
  private pairIdx = new Int32Array(0);
  /** Per node: its parent's index (-1 the root's), its daughter nodes' indices, its strands' count; update()'s scratch. */
  private readonly par: Int32Array;
  private readonly kidN: Int32Array[];
  private readonly nStr: Int32Array;
  private readonly rootI: number;
  private readonly flag2: Uint8Array;
  private readonly stack: Int32Array;
  private readonly stack2: Int32Array;

  /** Clade v's green (world: the sum of its strands' green widths) at grid row k of height h. */
  greenAt(v: FanNode, k: number, h: number): number {
    // (By world y, not by (k, h): a coarser grid's rows are a finer one's (powers of two), kept across the switch, ToLaD#255.)
    const y = k * h;
    // (The last clade's, and per clade a front cache by k before its map (a float key): drawMerged asks a clade's rows in a run, ToLaD#255.)
    let e = this.gLast;
    if (!e || e.v !== v) {
      e = this.green.get(v);
      if (!e) this.green.set(v, (e = { v, m: new Map(), K: new Float64Array(64).fill(NaN), H: new Float64Array(64), G: new Float64Array(64) }));
      this.gLast = e;
    }
    const c = k & 63;
    if (e.K[c] === k && e.H[c] === h) return e.G[c];
    const m = e.m;
    let G = m.get(y);
    if (G === undefined) {
      if (m.size >= 8192) m.clear();
      G = 0;
      for (const b of v.strands) if (y >= b.tipY) G += lanesAt(b, y)[1];
      m.set(y, G);
    }
    e.K[c] = k;
    e.H[c] = h;
    e.G[c] = G;
    return G;
  }

  /** Clade v's top (world y): its latest tip ("now" for a living one). */
  static top(v: FanNode): number {
    let t = Infinity;
    for (const b of v.strands) t = Math.min(t, b.tipY);
    return t;
  }
}
