// Vertical time-river layout in hierarchical local frames.
//
// Every node has its own frame: its band spans X in [0,1] (width) and T in
// [0,1] (its own start → end). A child sits in its parent's frame at
//   X_parent = x0 + xs * X_child,   T_parent = t0 + ts * T_child
// with separate width (xs) and time (ts) scales. Absolute coordinates never
// exist: after ~1000 levels the cumulative scale is far below 1e-308.
//
// Width uses nested sibling shares g(n)/Σg(n): linear g = n, log g = 1+log10 n.
// The active mode is a mix m in [0,1] (0 = linear, 1 = log) so the toggle can
// animate. Time placement does not depend on the mode.

import { TIME_UNITS, type NodeInfo, type TreeSource } from './tree';
import { fmix32 } from './hash';

/** A chunk spans at most this many levels... */
export const CHUNK_MAX_LEVELS = 4;
/** ...and at most this ratio between its root's and its smallest node's scale (per axis). */
export const CHUNK_MIN_REL_SCALE = 1e-3;

export class LNode {
  kids: LNode[] | null = null;
  /** Placement in the parent frame: offset/share for both width modes, and time. */
  offLin = 0;
  offLog = 0;
  shLin = 1;
  shLog = 1;
  t0 = 0;
  ts = 1;
  /** Green (alive) lane fraction of the band width for both modes. */
  fLin = 0;
  fLog = 0;
  /** Cosmetic per-node tint in [0,1). */
  tint: number;
  /** Chunking: true if this node starts a new chunk. */
  chunkRoot = true;
  /** Scale relative to the chunk root (min over modes, so mode-independent), and level within chunk. */
  relX = 1;
  relT = 1;
  relLevel = 0;

  constructor(
    readonly src: unknown,
    readonly info: NodeInfo,
    readonly parent: LNode | null,
  ) {
    this.tint = (fmix32(hashString(info.id)) & 0xffff) / 65536;
  }

  get id(): string {
    return this.info.id;
  }
  get depth(): number {
    return this.info.depth;
  }
  get alive(): boolean {
    return this.info.alive;
  }
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function gLog(log10n: number): number {
  return 1 + Math.max(0, log10n);
}

/** Green lane fraction in log mode: g(alive) / (g(alive) + g(dead)). */
function aliveFracLog(log10N: number, log10A: number): number {
  if (log10A === -Infinity) return 0;
  const fa = Math.pow(10, log10A - log10N); // alive / ever
  const log10D = log10N + Math.log10(Math.max(1e-300, 1 - fa));
  const ga = gLog(log10A);
  const gd = gLog(log10D);
  return ga / (ga + gd);
}

export class Layout<N = unknown> {
  readonly root: LNode;
  /** 0 = linear widths, 1 = log widths. */
  mix = 0;
  /** Bumped whenever `mix` changes, so caches know to rebuild. */
  mixEpoch = 0;
  nodesCreated = 0;

  constructor(readonly source: TreeSource<N>) {
    const r = source.root();
    const info = source.info(r);
    this.root = new LNode(r, info, null);
    this.root.fLin = Math.pow(10, info.log10A - info.log10N);
    this.root.fLog = aliveFracLog(info.log10N, info.log10A);
    this.nodesCreated = 1;
  }

  setMix(m: number): void {
    if (m !== this.mix) {
      this.mix = m;
      this.mixEpoch++;
    }
  }

  children(p: LNode): LNode[] {
    if (p.kids) return p.kids;
    const srcKids = this.source.children(p.src as N);
    const infos = srcKids.map((k) => this.source.info(k));
    let sumLin = 0;
    let sumLog = 0;
    for (const ci of infos) {
      sumLin += ci.weight;
      sumLog += gLog(ci.log10N);
    }
    let offLin = 0;
    let offLog = 0;
    const kids: LNode[] = [];
    for (let i = 0; i < infos.length; i++) {
      const ci = infos[i];
      const n = new LNode(srcKids[i], ci, p);
      n.shLin = ci.weight / sumLin;
      n.shLog = gLog(ci.log10N) / sumLog;
      // Make the last share close the band exactly so siblings tile [0,1].
      if (i === infos.length - 1) {
        n.shLin = 1 - offLin;
        n.shLog = 1 - offLog;
      }
      n.offLin = offLin;
      n.offLog = offLog;
      offLin += n.shLin;
      offLog += n.shLog;
      // Integer time units are dyadic, so these are exact in float64.
      n.t0 = ci.start / TIME_UNITS;
      n.ts = (ci.end - ci.start) / TIME_UNITS;
      n.fLin = ci.alive ? Math.pow(10, ci.log10A - ci.log10N) : 0;
      n.fLog = ci.alive ? aliveFracLog(ci.log10N, ci.log10A) : 0;
      // Chunk membership (mode-independent: uses the smaller share).
      const relX = p.relX * Math.min(n.shLin, n.shLog);
      const relT = p.relT * n.ts;
      const relLevel = p.relLevel + 1;
      if (relX < CHUNK_MIN_REL_SCALE || relT < CHUNK_MIN_REL_SCALE || relLevel > CHUNK_MAX_LEVELS) {
        n.chunkRoot = true;
        n.relX = 1;
        n.relT = 1;
        n.relLevel = 0;
      } else {
        n.chunkRoot = false;
        n.relX = relX;
        n.relT = relT;
        n.relLevel = relLevel;
      }
      kids.push(n);
    }
    this.nodesCreated += kids.length;
    p.kids = kids;
    return kids;
  }

  /** Width offset / share of `n` inside its parent at the current mix. */
  x0(n: LNode): number {
    return n.offLin + (n.offLog - n.offLin) * this.mix;
  }
  xs(n: LNode): number {
    return n.shLin + (n.shLog - n.shLin) * this.mix;
  }
  aliveFrac(n: LNode): number {
    return n.fLin + (n.fLog - n.fLin) * this.mix;
  }

  /**
   * Drop cached children far from the current anchor so memory stays bounded
   * during very deep dives. Nodes on the root→anchor path are kept; for path
   * nodes more than `keepLevels` above the anchor, the subtrees hanging off
   * the path are released (they regenerate deterministically if revisited).
   */
  prune(anchor: LNode, keepLevels = 48): void {
    const limit = anchor.depth - keepLevels;
    if (limit <= 0) return;
    let child: LNode | null = anchor;
    let n: LNode | null = anchor.parent;
    while (n) {
      if (n.depth < limit && n.kids) {
        for (const k of n.kids) if (k !== child) k.kids = null;
      }
      child = n;
      n = n.parent;
    }
  }
}
