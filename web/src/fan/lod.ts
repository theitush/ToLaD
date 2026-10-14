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
  private green = new Map<FanNode, Map<number, number>>();

  constructor(readonly fan: Fan) {
    fan.nodes.forEach((v, i) => this.idx.set(v, i));
    this.of = new Int32Array(fan.root.strands.length).fill(-1);
    this.flag = new Uint8Array(fan.nodes.length);
    this.gap = new Float64Array(fan.nodes.length);
    this.room = new Float64Array(fan.nodes.length);
    fan.nodes.forEach((v, i) => (this.room[i] = v.strands.reduce((s, b) => s + b.width, 0)));
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
    const g = this.gap.fill(0);
    for (let i = 0; i < fold.a.length; i++) {
      const k = this.idx.get(fold.pairNode[i])!;
      g[k] = Math.max(g[k], fold.a[i] * fold.pairGap[i]);
    }
    // (Parents before their daughters in fan.nodes: the widest gap inside each clade, bottom up.)
    for (let i = N.length - 1; i > 0; i--) {
      const p = N[i].parent;
      if (p) {
        const k = this.idx.get(p)!;
        g[k] = Math.max(g[k], g[i]);
      }
    }
    const merged: FanNode[] = [];
    const flag = new Uint8Array(N.length);
    const mark = (v: FanNode) => {
      for (const k of v.kids)
        if (isNode(k)) {
          flag[this.idx.get(k)!] = 2;
          mark(k);
        }
    };
    const visit = (v: FanNode) => {
      const i = this.idx.get(v)!;
      const n = v.strands.length;
      if (v.parent && n >= 2 && g[i] * sx < CLOSED_PX && (this.room[i] * sx) / n < MERGE_PX) {
        flag[i] = 1;
        merged.push(v);
        mark(v);
        return;
      }
      for (const k of v.kids) if (isNode(k)) visit(k);
    };
    visit(this.fan.root);
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

  /** Clade v's green (world: the sum of its strands' green widths) at grid row k of height h. */
  greenAt(v: FanNode, k: number, h: number): number {
    // (By world y, not by (k, h): a coarser grid's rows are a finer one's (powers of two), kept across the switch, ToLaD#255.)
    const y = k * h;
    let m = this.green.get(v);
    if (!m) this.green.set(v, (m = new Map()));
    let G = m.get(y);
    if (G === undefined) {
      if (m.size >= 8192) m.clear();
      G = 0;
      for (const b of v.strands) if (y >= b.tipY) G += lanesAt(b, y)[1];
      m.set(y, G);
    }
    return G;
  }

  /** Clade v's top (world y): its latest tip ("now" for a living one). */
  static top(v: FanNode): number {
    let t = Infinity;
    for (const b of v.strands) t = Math.min(t, b.tipY);
    return t;
  }
}
