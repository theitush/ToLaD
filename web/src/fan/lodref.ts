// The merged clades as Lod.update found them before ToLaD#502, kept as the reference the walk to the cut is held to
// (lodindex.test.ts): every node's widest gap and gap sum from every pair, bottom up, then a walk down from the root that
// marks every node inside each merged clade. Tests only: nothing in the page imports it.

import { isNode, type Fan, type FanNode } from './layout';
import type { Fold } from './fold';
import { BRANCH_PX, CLOSED_PX, MERGE_PX } from './lod';

/** The merged clades (left to right), per node 1 merged, 2 inside a merged clade, 0 neither, and per strand its merged clade or -1. */
export function mergedRef(fan: Fan, fold: Fold, sx: number): { merged: FanNode[]; flag: Uint8Array; of: Int32Array } {
  const N = fan.nodes;
  const idx = new Map<FanNode, number>();
  N.forEach((v, i) => idx.set(v, i));
  const room = Float64Array.from(N, (v) => v.strands.reduce((s, b) => s + b.width, 0));
  const par = Int32Array.from(N, (v) => (v.parent ? idx.get(v.parent)! : -1));
  const kidN = N.map((v) => Int32Array.from(v.kids.filter(isNode), (k) => idx.get(k as FanNode)!));
  const nStr = Int32Array.from(N, (v) => v.strands.length);
  const pi = Int32Array.from(fold.pairNode, (v) => idx.get(v)!);
  const g = new Float64Array(N.length);
  const gs = new Float64Array(N.length);
  for (let i = 0; i < pi.length; i++) {
    const k = pi[i];
    const w = fold.a[i] * fold.pairGap[i];
    g[k] = Math.max(g[k], w);
    gs[k] += w;
  }
  for (let i = N.length - 1; i > 0; i--) {
    const k = par[i];
    if (k >= 0) {
      g[k] = Math.max(g[k], g[i]);
      gs[k] += gs[i];
    }
  }
  const merged: FanNode[] = [];
  const flag = new Uint8Array(N.length);
  const st = [idx.get(fan.root)!];
  while (st.length) {
    const i = st.pop()!;
    const kids = kidN[i];
    if (par[i] >= 0 && nStr[i] >= 2 && g[i] * sx < CLOSED_PX && (room[i] * sx) / nStr[i] < MERGE_PX && (room[i] + gs[i]) * sx < BRANCH_PX) {
      flag[i] = 1;
      merged.push(N[i]);
      const st2 = [...kids];
      while (st2.length) {
        const d = st2.pop()!;
        flag[d] = 2;
        st2.push(...kidN[d]);
      }
      continue;
    }
    for (let q = kids.length - 1; q >= 0; q--) st.push(kids[q]);
  }
  const of = new Int32Array(fan.root.strands.length).fill(-1);
  merged.forEach((v, m) => {
    for (const b of v.strands) of[b.index] = m;
  });
  return { merged, flag, of };
}
