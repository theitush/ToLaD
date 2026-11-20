// The mammal level's detail by zoom (ToLaD#247): a clade the fold has closed (fold.ts: no gap inside it wider than
// CLOSED_PX on screen) whose species are under MERGE_PX each on screen, on average, is drawn as the one branch it reads
// as: one ribbon from its left edge to its right, its green the share of its species' (lod.ts mergedPts), not ~5,900
// hairline strands side by side, each floored to a pixel (a striped block, and most of a frame's time). Zoomed in, its
// ribbon grows past BRANCH_PX, a clade parts (its gaps open) or its species widen, and it falls apart into its daughters,
// each merged while it still qualifies, down to the species: zooming shows the branches inside a branch (ToLaD#389). The levels with no orders above them (the cats, the carnivores) have none of this:
// their strands are drawn one by one, as before.
//
// The clade's brackets and labels go with it: what is inside a merged clade is not named on its own (the stack reads
// the path from the root down to the merged clades, the orders at home), and its species have no pills.

import { isNode, lanesAt, typedFrom, type Fan, type FanNode } from './layout';
import { DASH_SPACE, unknownLook, type UnknownLook } from './dashed';
import type { Fold } from './fold';
import { GreenRuns } from './green';
import { forkMode, type Steady } from './steady';

/** A closed clade is drawn as one branch while its species are under this many px wide each on screen, on average. */
export const MERGE_PX = 1;
/** A clade is drawn as one branch only while its ribbon is under this many px wide on screen. */
export const BRANCH_PX = 24;
/** A clade is closed while no gap inside it is this wide on screen (px). */
export const CLOSED_PX = 0.5;

/** A clade's green shares by row (Lod.greenShareAt): by world y, and a front cache by k (its grid h). */
interface GreenRows {
  v: FanNode;
  m: Map<number, number>;
  K: Float64Array;
  H: Float64Array;
  G: Float64Array;
}

/** The walks bounded by the screen and the merged clades (ToLaD#502): off, every node and strand is walked as before (lodindex.test holds the two the same). */
let walksOn = true;
export function setLodIndex(on: boolean): void {
  walksOn = on;
}
export const lodIndexOn = (): boolean => walksOn;
/** Lod.update's merged clades from the last frame's and what earlier frames found (ToLaD#502): off, the walk from the root every frame as before (lodlearn.test holds the two the same). */
let learnOn = true;
export function setLodLearn(on: boolean): void {
  learnOn = on;
}

/** The strands' cut coarsened by the view (Lod.see, ToLaD#591): off, the strands are asked by the zoom's cut alone (lodview.test: the same rectangles either way). */
let viewOn = true;
export function setLodView(on: boolean): void {
  viewOn = on;
}

export class Lod {
  /** The clades drawn as one branch this frame, left to right. */
  merged: FanNode[] = [];
  /** Bumped whenever merged changes. */
  gen = 0;
  private key = '';
  private readonly idx = new Map<FanNode, number>();
  private readonly room: Float64Array;
  /** Per merged-able node: its green share per grid row, by the row's world y. */
  private green = new Map<FanNode, GreenRows>();
  private gLast: GreenRows | undefined;
  /** The strands' green and whole widths by blocks of the tree order, per row (green.ts), made when first asked. */
  private runs: GreenRuns | null = null;

  constructor(readonly fan: Fan) {
    const N = fan.nodes;
    N.forEach((v, i) => this.idx.set(v, i));
    this.room = new Float64Array(N.length);
    this.tops = new Float64Array(N.length).fill(NaN);
    N.forEach((v, i) => (this.room[i] = v.strands.reduce((s, b) => s + b.width, 0)));
    this.par = typedFrom(Int32Array, N, (v) => (v.parent ? this.idx.get(v.parent)! : -1));
    this.kidN = N.map((v) => typedFrom(Int32Array, v.kids.filter(isNode), (k) => this.idx.get(k as FanNode)!));
    this.nStr = typedFrom(Int32Array, N, (v) => v.strands.length);
    this.s0 = typedFrom(Int32Array, N, (v) => (v.strands.length ? v.strands[0].index : 0));
    this.rootI = this.idx.get(fan.root)!;
    this.stack = new Int32Array(N.length + 1);
    this.bPos = new Int32Array(fan.root.strands.length);
    fan.branches.forEach((b, k) => (this.bPos[b.index] = k));
    // (The zoom past which no clade inside a node can merge: below MERGE_PX per species and BRANCH_PX across take sx
    // under nStr / room and BRANCH_PX / room, gaps or none; a hair over, so a rounding never prunes one that does.)
    const subT = (this.subT = new Float64Array(N.length));
    const own = (this.own = new Float64Array(N.length));
    const allG = (this.allG = new Uint8Array(N.length));
    const anyG = (this.anyG = new Uint8Array(N.length));
    const allU = (this.allU = new Uint8Array(N.length));
    const subTop = (this.subTop = typedFrom(Float64Array, N, (v) => v.y));
    const subBot = (this.subBot = typedFrom(Float64Array, N, (v) => v.yBot));
    for (let i = N.length - 1; i >= 0; i--) {
      const v = N[i];
      const r = this.room[i];
      // (No count in any of its species, ToLaD#565: drawn as one dashed line while its lines are closer than DASH_SPACE (closed()), whatever its width.)
      let u = v.strands.length > 0 ? 1 : 0;
      for (const k of this.kidN[i]) u &= allU[k];
      for (const k of v.kids) if (!isNode(k) && !k.sp.countUnknown) u = 0;
      allU[i] = u;
      const tl = u && this.par[i] >= 0 && this.nStr[i] >= 2 ? (r > 0 ? (DASH_SPACE * this.nStr[i]) / r : Infinity) * (1 + 1e-9) : 0;
      const t = Math.max(tl, this.par[i] >= 0 && this.nStr[i] >= 2 ? (r > 0 ? Math.min(MERGE_PX * this.nStr[i], BRANCH_PX) / r : Infinity) * (1 + 1e-9) : 0);
      own[i] = t;
      subT[i] = Math.max(subT[i], t);
      // (cladeAllGray (view.ts), from the daughters up: every strand extinct.)
      let all = 1;
      for (const k of this.kidN[i]) all &= allG[k];
      for (const k of v.kids) if (!isNode(k) && !k.sp.extinct) all = 0;
      allG[i] = all;
      anyG[i] = Math.max(anyG[i], allG[i]);
      const p = this.par[i];
      if (p < 0) continue;
      subT[p] = Math.max(subT[p], subT[i]);
      anyG[p] = Math.max(anyG[p], anyG[i]);
      subTop[p] = Math.min(subTop[p], subTop[i]);
      subBot[p] = Math.max(subBot[p], subBot[i]);
    }
    // (Nodes no daughter list holds (a split with nothing placed under it): no walk from the root reaches them.)
    const seen = new Uint8Array(N.length);
    const st = [this.rootI];
    while (st.length) {
      const i = st.pop()!;
      seen[i] = 1;
      for (const k of this.kidN[i]) st.push(k);
    }
    this.lone = Int32Array.from(N.keys()).filter((i) => !seen[i]);
    this.dead = Float64Array.from(own);
    this.subD = Float64Array.from(subT);
    this.seen = new Int32Array(N.length);
    this.kid0 = new Int32Array(N.length + 1);
    for (let i = 0; i < N.length; i++) this.kid0[i + 1] = this.kid0[i] + this.kidN[i].length;
    this.kids = new Int32Array(this.kid0[N.length]);
    for (let i = 0; i < N.length; i++) this.kids.set(this.kidN[i], this.kid0[i]);
    this.gMx = new Float64Array(N.length);
    this.gSm = new Float64Array(N.length);
    this.gVer = new Int32Array(N.length).fill(-1);
    this.mark = new Int32Array(N.length);
  }

  /** Clade v is inside a merged clade (not the merged clade itself): not named on its own. */
  hidden(v: FanNode): boolean {
    const S = v.strands;
    if (!S.length) return false;
    const m = this.ofStrand(S[0].index);
    if (m < 0) return false;
    const M = this.merged[m];
    if (M === v) return false;
    // (Both hold the strand, so one is under the other: the one with fewer strands, or of a chain of single daughters the lower.)
    if (S.length !== M.strands.length) return S.length < M.strands.length;
    for (let p = v.parent; p && p.strands.length === S.length; p = p.parent) if (p === M) return true;
    return false;
  }

  /** Clade v is drawn as one branch. */
  isMerged(v: FanNode): boolean {
    const S = v.strands;
    if (!S.length) return false;
    const m = this.ofStrand(S[0].index);
    return m >= 0 && this.merged[m] === v;
  }

  /** Node j (fan.nodes' order) is drawn as one branch. */
  isMergedAt(j: number): boolean {
    return this.isMerged(this.fan.nodes[j]);
  }

  /** The merged clade strand i (its drawn index, FanBranch.index) is in (an index into merged), or -1: a bisection of their runs. */
  ofStrand(i: number): number {
    const a0 = this.mS0;
    let a = 0;
    let z = this.merged.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (a0[m] <= i) a = m + 1;
      else z = m;
    }
    return a > 0 && this.mS1[a - 1] >= i ? a - 1 : -1;
  }

  /** Per strand (its drawn index): the merged clade it is in (an index into merged), or -1. Made when asked (tests): the page asks ofStrand. */
  get of(): Int32Array {
    if (this.ofGen !== this.gen || !this.ofArr) {
      const of = (this.ofArr ??= new Int32Array(this.fan.root.strands.length));
      of.fill(-1);
      for (let m = 0; m < this.merged.length; m++) of.fill(m, this.mS0[m], this.mS1[m] + 1);
      this.ofGen = this.gen;
    }
    return this.ofArr;
  }
  private ofArr: Int32Array | null = null;
  private ofGen = -1;

  /**
   * The merged clades at the fold's openness and width zoom sx (px per world unit): true if they changed. A walk down
   * from the root that stops at each merged clade (the cut, ToLaD#502): what is inside one is never walked, nor a clade
   * too wide at this zoom for anything in it to merge (subT); the gaps inside a clade are read off a segment tree over
   * the pairs, built once a frame and only when a clade is in reach of merging.
   *
   * With the fold's openness its own at sx (fold.ts setScale: opennessAt, which never falls as sx grows), whether a
   * clade qualifies only ever goes from yes to no as sx grows: its room, its widest gap and its gaps' sum on screen all
   * grow. So what one frame found holds at the next (ToLaD#502): a clade found open at a zoom stays open at every zoom
   * past it (dead, and subD over its subtree, bound the walk tighter than subT as the zooms go by); zoomed in from the
   * last frame, the merged clades can only part, so only they are read again, and the walk goes on inside those that
   * parted. Off its own openness (a frame computed for another zoom: brackets.ts foldedFrame), the walk as before.
   */
  update(fold: Fold, sx: number): boolean {
    const look = unknownLook();
    if (look !== this.look) {
      this.look = look;
      this.learnt = null;
    }
    const key = `${fold.ver}:${sx}:${look}`;
    if (key === this.key) return false;
    this.key = key;
    this.gapsFor = null;
    const merged = this.mergedNext;
    merged.length = 0;
    // (Learnt for this fold at this screen width: its openness a function of sx alone.)
    const atOwn = fold.sx === sx && learnOn;
    if (atOwn && (fold !== this.learnt || fold.screenW !== this.learntW)) {
      this.dead.set(this.own);
      this.subD.set(this.subT);
      this.learnt = fold;
      this.learntW = fold.screenW;
      this.lastSx = NaN;
    }
    if (!atOwn) this.walk(fold, sx, this.rootI, merged, this.subT, false);
    else if (sx >= this.lastSx) {
      // Zoomed in (or not at all): each merged clade still closed stays; inside each that parted, the walk.
      for (let m = 0; m < this.merged.length; m++) {
        const i = this.mIdx[m];
        if (this.closed(fold, i, sx)) merged.push(i);
        else this.walk(fold, sx, i, merged, this.subD, true);
      }
    } else this.walk(fold, sx, this.rootI, merged, this.subD, true);
    this.lastSx = atOwn ? sx : NaN;
    const N = this.fan.nodes;
    const was = this.merged;
    let same = merged.length === was.length;
    for (let m = 0; same && m < merged.length; m++) same = N[merged[m]] === was[m];
    if (same) return false;
    const M = merged.length;
    this.merged = merged.map((i) => N[i]);
    if (this.mS0.length < M) {
      const c = Math.max(M, 2 * this.mS0.length);
      this.mS0 = new Int32Array(c);
      this.mS1 = new Int32Array(c);
      this.mTop = new Float64Array(c);
      this.mIdx = new Int32Array(c);
    }
    const tops = this.tops;
    for (let m = 0; m < M; m++) {
      const i = merged[m];
      this.mIdx[m] = i;
      this.mS0[m] = this.s0[i];
      this.mS1[m] = this.s0[i] + this.nStr[i] - 1;
      if (tops[i] !== tops[i]) tops[i] = Lod.top(N[i]);
      this.mTop[m] = tops[i];
    }
    this.gen++;
    return true;
  }
  private readonly mergedNext: number[] = [];
  /** The fold and screen width dead and subD were learnt for (null: none), and the zoom the merged clades are for when at the fold's own openness (NaN: not). */
  private learnt: Fold | null = null;
  private learntW = NaN;
  private lastSx = NaN;
  /** Per node: own, the zoom at and past which its room alone keeps it from merging (subT's term, 0: never merges); dead, at and past which it never merges, own lowered to every zoom it was found open at; subD, dead's most over its subtree. */
  private readonly own: Float64Array;
  private readonly dead: Float64Array;
  private readonly subD: Float64Array;
  /** The walk's nodes passed through (neither merged nor ruled out), in the order met: their subD made again after it, daughters first. */
  private readonly seen: Int32Array;

  /**
   * The merged clades in node from's subtree, depth first, left to right, into merged: from itself if it qualifies, else
   * the walk down from it that stops at each that does, past each subtree bound rules out (sx at or past it). learn:
   * every clade found open has its dead lowered to sx, and subD is made again over the nodes passed through.
   */
  private walk(fold: Fold, sx: number, from: number, merged: number[], bound: Float64Array, learn: boolean): void {
    const par = this.par;
    const nStr = this.nStr;
    const st = this.stack;
    const seen = this.seen;
    const dead = this.dead;
    const k0 = this.kid0;
    const K = this.kids;
    let c = 0;
    let n = 0;
    st[n++] = from;
    // (Depth first, left to right, as the clades stand.)
    while (n > 0) {
      const i = st[--n];
      if (par[i] >= 0) {
        if (!(sx < bound[i])) continue;
        // (Learning, a clade found open at a zoom at or under this one is open now: not read again.)
        if (nStr[i] >= 2 && (!learn || sx < dead[i])) {
          if (this.closed(fold, i, sx)) {
            merged.push(i);
            continue;
          }
          if (learn) dead[i] = sx;
        }
      }
      if (learn) seen[c++] = i;
      for (let q = k0[i + 1] - 1; q >= k0[i]; q--) st[n++] = K[q];
    }
    // (Daughters before their parents: each node after all it passed through below it.)
    if (learn) {
      const subD = this.subD;
      for (let q = c - 1; q >= 0; q--) {
        const i = seen[q];
        let d = dead[i];
        for (let k = k0[i], e = k0[i + 1]; k < e; k++) if (subD[K[k]] > d) d = subD[K[k]];
        subD[i] = d;
      }
    }
  }
  /** kidN flat: node i's daughter nodes at kids[kid0[i] .. kid0[i + 1] - 1]. */
  private readonly kid0: Int32Array;
  private readonly kids: Int32Array;
  /** Per merged clade (merged's order): its strands' first and last drawn index (ascending, disjoint), and its top (Lod.top). */
  mS0 = new Int32Array(0);
  mS1 = new Int32Array(0);
  mTop = new Float64Array(0);
  /** Per merged clade: its index in fan.nodes. */
  mIdx = new Int32Array(0);
  /** Per node index: its top (Lod.top), once asked (NaN before). */
  private readonly tops: Float64Array;

  /**
   * The clades whose strands are not drawn one by one this frame (drawStrands, ToLaD#591), left to right: the merged
   * clades (drawn as ribbons), and coarser, each clade the window sees nothing of (Steady.viewCut: no stretch of it with
   * a share in the window, no dashed line, nothing above its split). A clade beside the view, whose lineages run through
   * it only as corners deep in the trunk or step across it at a split, asks none of its thousands of strands to be
   * sampled for no pixel; the picture is the same. The ribbons stay the merged clades', and names, brackets, corners and
   * stems go by merged too, which depends on the zoom alone.
   */
  cut: FanNode[] = [];
  /** Per clade in cut: its strands' first and last drawn index (as mS0, mS1). */
  cS0 = new Int32Array(0);
  cS1 = new Int32Array(0);

  /**
   * The cut for the window world x [xa, xb], heights [ya, yb] at zoom sx, sy (px per world unit; sf: the layout, a
   * Steady; null, or a tree viewCut cannot read: the merged clades as they are). After update and Steady.setMerged.
   */
  see(sf: Steady | null, ya: number, yb: number, xa: number, xb: number, sx: number, sy: number): void {
    const key = `${this.gen}:${sf?.ver}:${ya}:${yb}:${xa}:${xb}:${sx}:${sy}:${this.look}:${forkMode()}`;
    if (key === this.viewKey && sf === this.viewSf) return;
    this.viewKey = key;
    this.viewSf = sf;
    if (this.markGen !== this.gen) {
      this.markGen = this.gen;
      this.stamp++;
      for (let m = 0; m < this.merged.length; m++) this.mark[this.mIdx[m]] = this.stamp;
    }
    const ids = this.cutNext;
    if (!viewOn || !sf || !sf.viewCut(ya, yb, xa, xb, sx, sy, this.heldFn, this.look === 'dashed' ? this.lineFn : null, ids)) {
      this.cut = this.merged;
      this.cS0 = this.mS0;
      this.cS1 = this.mS1;
      return;
    }
    const N = this.fan.nodes;
    const M = ids.length;
    if (this.vS0.length < M) {
      const c = Math.max(M, 2 * this.vS0.length);
      this.vS0 = new Int32Array(c);
      this.vS1 = new Int32Array(c);
    }
    this.cS0 = this.vS0;
    this.cS1 = this.vS1;
    const C = (this.cut = this.cut === this.merged ? [] : this.cut);
    C.length = M;
    for (let m = 0; m < M; m++) {
      const i = ids[m];
      C[m] = N[i];
      this.vS0[m] = this.s0[i];
      this.vS1[m] = this.s0[i] + this.nStr[i] - 1;
    }
  }
  private viewKey = '';
  private viewSf: Steady | null = null;
  private readonly cutNext: number[] = [];
  private vS0 = new Int32Array(0);
  private vS1 = new Int32Array(0);
  /** Per node: the stamp of the merged clades it is one of (markGen: the gen they were stamped at). */
  private readonly mark: Int32Array;
  private stamp = 0;
  private markGen = -1;
  private readonly heldFn = (j: number): boolean => this.mark[j] === this.stamp;
  private readonly lineFn = (j: number): boolean => this.allU[j] === 1;

  /** The first clade in cut from index `from` on whose last strand is at or past strand x (cut.length if none). */
  cutFrom(x: number, from = 0): number {
    const e = this.cS1;
    let a = from;
    let z = this.cut.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (e[m] < x) a = m + 1;
      else z = m;
    }
    return a;
  }

  /** The clade in cut strand i is in (an index into cut), or -1. */
  cutOf(i: number): number {
    const m = this.cutFrom(i);
    return m < this.cut.length && this.cS0[m] <= i ? m : -1;
  }

  /** Clade v's top (Lod.top), kept. */
  topOf(v: FanNode): number {
    const i = this.idx.get(v)!;
    if (this.tops[i] !== this.tops[i]) this.tops[i] = Lod.top(v);
    return this.tops[i];
  }

  /** The first merged clade from index `from` on whose last strand is at or past strand x (merged.length if none). */
  mergedFrom(x: number, from = 0): number {
    const e = this.mS1;
    let a = from;
    let z = this.merged.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (e[m] < x) a = m + 1;
      else z = m;
    }
    return a;
  }

  /**
   * Node i qualifies to be drawn as one branch: closed (no gap inside it CLOSED_PX on screen), its species under MERGE_PX
   * each, its ribbon under BRANCH_PX. Or, no species in it with a count (ToLaD#565, the dashed look): its lines closer than
   * DASH_SPACE on screen (its widest gap and its mean room), one dashed line whatever its width.
   */
  private closed(fold: Fold, i: number, sx: number): boolean {
    const r = this.room[i] * sx;
    const n = this.nStr[i];
    const line = this.allU[i] === 1 && this.look === 'dashed';
    // ((r + gaps) * sx is never under r * sx: the room alone decides most, before any gap is read.)
    const branch = r / n < MERGE_PX && r < BRANCH_PX;
    if (!branch && !(line && r / n < DASH_SPACE)) return false;
    const ok = (g: number, gs: number) => (branch && g * sx < CLOSED_PX && (this.room[i] + gs) * sx < BRANCH_PX) || (line && g * sx + r / n < DASH_SPACE);
    const T = this.gapsFor === fold ? this.gapTree : this.gaps(fold);
    // (Its widest gap and their sum kept while the tree stands as it was (gaps(): at an order's or a family's zoom, frame after frame).)
    if (learnOn && this.gVer[i] === this.treeVer) return ok(this.gMx[i], this.gSm[i]);
    // (The pairs inside it: those between its first strand and its last.)
    let l = this.s0[i] + T.size;
    let h = this.s0[i] + this.nStr[i] - 2 + T.size + 1;
    let g = 0;
    let gs = 0;
    const mx = T.mx;
    const sm = T.sm;
    while (l < h) {
      if (l & 1) {
        g = Math.max(g, mx[l]);
        gs += sm[l++];
      }
      if (h & 1) {
        g = Math.max(g, mx[--h]);
        gs += sm[h];
      }
      l >>= 1;
      h >>= 1;
    }
    if (learnOn) {
      this.gVer[i] = this.treeVer;
      this.gMx[i] = g;
      this.gSm[i] = gs;
    }
    return ok(g, gs);
  }

  /** Every pair's gap as it stands open (fold.a times its gap), most and sum by halves (a segment tree, leaves the pairs). */
  private gaps(fold: Fold): { size: number; mx: Float64Array; sm: Float64Array } {
    const P = fold.pairGap.length;
    let T = this.gapTree;
    if (T.size < P || T.mx.length === 0) {
      let size = 1;
      while (size < P) size *= 2;
      T = this.gapTree = { size, mx: new Float64Array(2 * size), sm: new Float64Array(2 * size) };
    }
    const { size, mx, sm } = T;
    const a = fold.a;
    const gap = fold.pairGap;
    this.gapsFor = fold;
    // (Kept from the last frame's for the pairs whose openness is the same (ToLaD#502: at an order's or a family's zoom
    // every split is wholly open or shut, none moves): those that moved, and the halves above them, made again.)
    const A = this.treeA;
    if (learnOn && this.treeFold === fold && A.length === P) {
      let moved = 0;
      for (let p = 0; p < P; p++) if (A[p] !== a[p]) moved++;
      if (moved === 0) return T;
      if (moved * 16 < P) {
        for (let p = 0; p < P; p++) {
          if (A[p] === a[p]) continue;
          A[p] = a[p];
          let k = size + p;
          mx[k] = sm[k] = a[p] * gap[p];
          for (k >>= 1; k >= 1; k >>= 1) {
            const l = 2 * k;
            mx[k] = Math.max(mx[l], mx[l + 1]);
            sm[k] = sm[l] + sm[l + 1];
          }
        }
        this.treeVer++;
        return T;
      }
    }
    for (let p = 0; p < P; p++) mx[size + p] = sm[size + p] = a[p] * gap[p];
    for (let k = size - 1; k >= 1; k--) {
      const l = 2 * k;
      mx[k] = Math.max(mx[l], mx[l + 1]);
      sm[k] = sm[l] + sm[l + 1];
    }
    if (A.length !== P) this.treeA = Float64Array.from(a);
    else A.set(a);
    this.treeFold = fold;
    this.treeVer++;
    return T;
  }
  private gapTree = { size: 0, mx: new Float64Array(0), sm: new Float64Array(0) };
  private gapsFor: Fold | null = null;
  /** The fold and openness the tree was made for, and its version (bumped as it changes). */
  private treeFold: Fold | null = null;
  private treeA = new Float64Array(0);
  private treeVer = 0;
  /** Per node: its widest gap and their sum (closed()), and the tree's version they were read at. */
  private readonly gMx: Float64Array;
  private readonly gSm: Float64Array;
  private readonly gVer: Int32Array;

  /**
   * The nodes drawStem may draw a backdrop for (fan.nodes' indices, descending, into out): none inside a merged clade,
   * only those all gray unless gray is on, only those whose span may meet world [yTop, yBot]. A walk down from the root
   * past what the static bounds rule out (subtrees with nothing gray, wholly above or below), stopping at each merged clade.
   */
  stemNodes(gray: boolean, yTop: number, yBot: number, out: { at: Int32Array; n: number }): void {
    let at = out.at;
    let c = 0;
    const st = this.stack;
    let n = 0;
    st[n++] = this.rootI;
    for (let q = 0; ; ) {
      if (n === 0) {
        if (q >= this.lone.length) break;
        st[n++] = this.lone[q++];
      }
      const i = st[--n];
      if ((!gray && !this.anyG[i]) || this.subTop[i] >= yBot || this.subBot[i] <= yTop) continue;
      if (gray || this.allG[i]) {
        if (c === at.length) {
          const b = new Int32Array(Math.max(64, 2 * c));
          b.set(at);
          at = out.at = b;
        }
        at[c++] = i;
      }
      if (this.isMergedAt(i)) continue;
      const kids = this.kidN[i];
      for (let k = 0; k < kids.length; k++) st[n++] = kids[k];
    }
    at.subarray(0, c).sort();
    at.subarray(0, c).reverse();
    out.n = c;
  }

  /** Per node: its parent's index (-1 the root's), its daughter nodes' indices, its strands' count and first strand (drawn index). */
  private readonly par: Int32Array;
  private readonly kidN: Int32Array[];
  private readonly nStr: Int32Array;
  private readonly s0: Int32Array;
  private readonly rootI: number;
  private readonly stack: Int32Array;
  /** Per node: the zoom (sx) at and past which nothing in its subtree merges; all gray; anything all gray in its subtree; its subtree's top and bottom (world y). */
  private readonly subT: Float64Array;
  private readonly allG: Uint8Array;
  /** Per node: no species in it has a count (dashed.ts): one dashed line while its lines are closer than DASH_SPACE. */
  private readonly allU: Uint8Array;
  /** The look the merged clades are for (dashed.ts): a pick asks them again, and unlearns what was learnt under the other. */
  private look: UnknownLook = unknownLook();
  private readonly anyG: Uint8Array;
  private readonly subTop: Float64Array;
  private readonly subBot: Float64Array;
  /** The nodes no walk from the root reaches. */
  private readonly lone: Int32Array;
  /** Per strand (drawn index): its place in fan.branches (the draw's order). */
  readonly bPos: Int32Array;

  /** Clade v's green share at grid row k of height h: its strands' green widths over their widths, so the gaps in its ribbon are not painted as ended lines (ToLaD#389). */
  greenShareAt(v: FanNode, k: number, h: number): number {
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
      // (Its strands one run of the tree order: their sums by blocks kept per row, green.ts, ToLaD#502: a clade that parts or
      // closes reads its blocks, where it walked every strand at every row.)
      const S = v.strands;
      const i0 = S.length ? S[0].index : 0;
      const i1 = S.length ? S[S.length - 1].index : -1;
      if (i1 - i0 + 1 === S.length) G = (this.runs ??= new GreenRuns(this.fan)).share(i0, i1, y);
      else {
        let g = 0;
        let w = 0;
        for (const b of S) {
          if (y < b.tipY) continue;
          const l = lanesAt(b, y);
          w += l[0];
          g += l[1];
        }
        G = w > 0 ? Math.min(1, g / w) : 0;
      }
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
