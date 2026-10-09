// TileTreeSource: the real mammal data behind the engine's TreeSource interface.
//
// The skeleton is loaded first. Its stub rows stand in for whole subtrees
// (drawn from their own aggregates) until the scene asks for their tile, which
// is fetched, decoded and laid out in the data worker (see client.ts). When a
// tile arrives the stub simply gains children; nothing already placed moves
// (see river.ts).

import { DRAW_STUB, DRAW_TAXONOMIC, type NodeInfo, type RiverPlacement, type TreeSource } from '../engine/tree';
import { FLAG, S, type ProcessedFile } from './river';

export class FileRec {
  readonly kidStart: Uint32Array;
  readonly kidList: Uint32Array;
  readonly reps = new Map<number, string>();
  constructor(readonly p: ProcessedFile) {
    const n = p.n;
    const count = new Uint32Array(n + 1);
    for (let i = 1; i < n; i++) count[p.parent[i] + 1]++;
    for (let i = 0; i < n; i++) count[i + 1] += count[i];
    this.kidStart = count;
    const fill = count.slice(0, n);
    const list = new Uint32Array(Math.max(0, n - 1));
    for (let i = 1; i < n; i++) list[fill[p.parent[i]]++] = i; // preorder keeps left-to-right order
    this.kidList = list;
    for (const [row, rep] of p.reps) this.reps.set(row, rep);
  }
  names(row: number): string[] {
    return this.p.nameBlob.slice(this.p.nameOff[row], this.p.nameOff[row + 1]).split('|');
  }
}

export interface RNode {
  f: FileRec;
  row: number;
  depth: number;
  index: number;
  info?: NodeInfo;
}

/** Where a node's own row (its placement among its siblings) lives. */
export interface Home {
  f: FileRec;
  row: number;
}

export type TileLoader = (tileId: number) => Promise<ProcessedFile>;

export class TileTreeSource implements TreeSource<RNode> {
  readonly files = new Map<number, FileRec>();
  readonly skeleton: FileRec;
  /** gid → home row (stub rows are the home of tile roots). */
  readonly home = new Map<number, Home>();
  private readonly requested = new Set<number>();
  private readonly rootNode: RNode;
  private listeners: ((tileId: number) => void)[] = [];
  errors: string[] = [];

  constructor(
    skeleton: ProcessedFile,
    private readonly loader: TileLoader | null = null,
  ) {
    this.skeleton = this.add(skeleton);
    this.rootNode = { f: this.skeleton, row: 0, depth: 0, index: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get meta(): any {
    return this.skeleton.p.meta;
  }

  onTile(fn: (tileId: number) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Add a processed file (skeleton or tile). */
  add(p: ProcessedFile): FileRec {
    const rec = new FileRec(p);
    this.files.set(p.tileId, rec);
    for (let i = p.tileId < 0 ? 0 : 1; i < p.n; i++) this.home.set(p.gid[i], { f: rec, row: i });
    if (p.tileId >= 0) {
      this.requested.add(p.tileId);
      for (const l of this.listeners) l(p.tileId);
    }
    return rec;
  }

  root(): RNode {
    return this.rootNode;
  }

  /** The file and row holding a node's children (row 0 of its tile for a loaded stub). */
  private kidsOf(n: { f: FileRec; row: number }): { f: FileRec; row: number } | null {
    const t = n.f.p.stubTile[n.row];
    if (t < 0) return n;
    const tf = this.files.get(t);
    return tf ? { f: tf, row: 0 } : null;
  }

  children(n: RNode): RNode[] {
    const k = this.kidsOf(n);
    if (!k) return [];
    const out: RNode[] = [];
    const f = k.f;
    for (let j = f.kidStart[k.row]; j < f.kidStart[k.row + 1]; j++) {
      out.push({ f, row: f.kidList[j], depth: n.depth + 1, index: out.length });
    }
    return out;
  }

  pending(n: RNode): boolean {
    const t = n.f.p.stubTile[n.row];
    return t >= 0 && !this.files.has(t);
  }

  request(n: RNode): void {
    const t = n.f.p.stubTile[n.row];
    if (t >= 0) void this.loadTile(t);
  }

  /** Load a tile (once). Resolves when it is in the source. */
  loadTile(t: number): Promise<void> {
    if (this.files.has(t)) return Promise.resolve();
    if (!this.loader) return Promise.reject(new Error('no tile loader'));
    let pr = this.inflight.get(t);
    if (!pr) {
      this.requested.add(t);
      pr = this.loader(t).then(
        (p) => {
          if (!this.files.has(t)) this.add(p);
        },
        (e) => {
          this.errors.push(`tile ${t}: ${e}`);
          this.inflight.delete(t);
          this.requested.delete(t);
          throw e;
        },
      );
      this.inflight.set(t, pr);
    }
    return pr;
  }
  private inflight = new Map<number, Promise<void>>();

  info(n: RNode): NodeInfo {
    if (n.info) return n.info;
    const p = n.f.p;
    const i = n.row;
    const fl = p.flags[i];
    const alive = (fl & FLAG.EXTINCT) === 0;
    const river: RiverPlacement = {
      o: i * S,
      T: p.sT,
      seg: p.sSeg,
      w: p.sW,
      offLin: p.offLin,
      wLin: p.wLin,
      offLog: p.offLog,
      wLog: p.wLog,
      t0: p.tPar0[i],
      ts: p.tParS[i],
      fLin: p.fLin[i],
      fLog: p.fLog[i],
      gLin: p.gLin[i],
      gLog: p.gLog[i],
      root: p.tileId < 0 && i === 0,
    };
    let draw = 0;
    if (fl & FLAG.TAXONOMIC) draw |= DRAW_TAXONOMIC;
    if (p.stubTile[i] >= 0) draw |= DRAW_STUB;
    n.info = {
      id: `g${p.gid[i]}`,
      depth: n.depth,
      index: n.index,
      weight: 1,
      start: 0,
      end: 0,
      alive,
      log10N: Math.log10(Math.max(p.ever[i], 1e-300)),
      log10A: p.alive[i] > 0 ? Math.log10(p.alive[i]) : -Infinity,
      river,
      age0: p.age0[i],
      age1: p.age1[i],
      draw,
    };
    return n.info;
  }

  /** gid of the parent of a node (by gid), or -1 at the root. */
  parentGid(gid: number): number {
    const h = this.home.get(gid);
    if (!h) return -1;
    const pr = h.f.p.parent[h.row];
    if (pr < 0) return -1;
    if (pr === 0 && h.f.p.tileId >= 0) {
      // Parent is the tile root: same node as the stub in the parent file.
      return h.f.p.gid[0];
    }
    return h.f.p.gid[pr];
  }

  /** gids from the root down to `gid` (inclusive), or null if it is not loaded. */
  pathTo(gid: number): number[] | null {
    if (!this.home.has(gid)) return null;
    const path = [gid];
    let g = gid;
    for (;;) {
      const p = this.parentGid(g);
      if (p < 0) break;
      path.push(p);
      g = p;
    }
    path.reverse();
    return path;
  }

  names(gid: number): string[] {
    const h = this.home.get(gid);
    return h ? h.f.names(h.row) : [];
  }

  /** Representative name of a stub / unnamed node (META.stub_rep), if any. */
  rep(gid: number): string | null {
    const h = this.home.get(gid);
    return h ? (h.f.reps.get(h.row) ?? null) : null;
  }
}
