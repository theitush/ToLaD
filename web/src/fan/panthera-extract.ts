// Build-time extraction of the Panthera subtree from data/mammals with the v1
// decoder. vite.config.ts runs this over skeleton.tld and the tile holding
// Panthera and serves the result as `virtual:panthera-data`, so the fan's
// numbers are the dataset's own and cannot go stale. Pure: bytes in, JSON out.

import { decodeFile } from '../data/tolad-decoder.js';

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface HistPoint {
  /** Calendar year (negative = BCE). */
  year: number;
  /** Individuals alive, and its range. */
  n: number;
  lo: number;
  hi: number;
  grade: Grade;
  kind: string;
  /** The pre-decline baseline. */
  baseline: boolean;
  cite: string;
  url: string;
  note: string;
}

export interface HistSegment {
  /** Calendar year the segment starts. */
  year0: number;
  generations: number;
  /** Births per generation at the segment's start and end (linear ramp). */
  startSize: number;
  endSize: number;
  grade: Grade;
  kind: string;
}

export interface HistoryRec {
  /** "counts": the curve is the species' births (EVER, procgen); "display": shown only. */
  use: string;
  scope: string;
  notes: string;
  /**
   * Null for a curated history file; "rangeloss" for a modelled range-loss trend
   * (format v1.3: its notes are the shared skeleton META.natural.trend's), "genomic"
   * for a modelled bulk genomic deep past (ToLaD#64).
   */
  modelled: string | null;
  /** Generation length and mean lifespan (years) the segments were compiled with. */
  G: number;
  L: number;
  /** Calendar year of "now" (the end of the last segment). */
  nowYear: number;
  points: HistPoint[];
  segments: HistSegment[];
}

export interface RawNode {
  gid: number;
  sci: string;
  ever: number;
  everLo: number;
  everHi: number;
  alive: number;
  grade: Grade;
  t0: number;
  t1: number;
  extinct: boolean;
  dateSource: string;
}

export interface RawSpecies extends RawNode {
  /** gid of the parent node in the tree (species sharing it are sisters). */
  parentGid: number;
  history: HistoryRec | null;
}

export interface RawClade extends RawNode {
  tile: number;
  species: RawSpecies[];
}

interface Tile {
  n: number;
  parent: Int32Array;
  name(i: number): string;
  gid(i: number): number;
  ever(i: number): number;
  everLo(i: number): number;
  everHi(i: number): number;
  alive(i: number): number;
  grade(i: number): Grade;
  t0(i: number): number;
  t1(i: number): number;
  extinct(i: number): boolean;
  dateSource(i: number): string;
  isSpecies(i: number): boolean;
  history(i: number): any;
  meta: any;
}

function node(f: Tile, i: number): RawNode {
  return {
    gid: f.gid(i),
    sci: f.name(i),
    ever: f.ever(i),
    everLo: f.everLo(i),
    everHi: f.everHi(i),
    alive: f.alive(i),
    grade: f.grade(i),
    t0: f.t0(i),
    t1: f.t1(i),
    extinct: f.extinct(i),
    dateSource: f.dateSource(i),
  };
}

/**
 * Find the tile that holds `name` with its subtree (not as a stub) and extract
 * it. `read` returns a data file's bytes by its path under data/mammals.
 */
export function loadClade(read: (rel: string) => Uint8Array, name: string): RawClade {
  const skBytes = read('skeleton.tld');
  const sk = decodeFile(skBytes) as unknown as Tile;
  for (const t of sk.meta.tiles as { id: number; file: string }[]) {
    const bytes = read(t.file);
    const f = decodeFile(bytes) as unknown as Tile & { isStub(i: number): boolean };
    for (let i = 0; i < f.n; i++) {
      if (f.name(i) === name && !f.isStub(i)) return extractClade(skBytes, bytes, t.id, name);
    }
  }
  throw new Error(`${name} not found in any tile`);
}

/**
 * Panthera (or any genus row named `name`) from a tile: the node, its species
 * in preorder, and each species' curated history with its citations resolved.
 */
export function extractClade(skeleton: ArrayBuffer | Uint8Array, tile: ArrayBuffer | Uint8Array, tileId: number, name: string): RawClade {
  const sk = decodeFile(skeleton) as unknown as Tile;
  const f = decodeFile(tile) as unknown as Tile;
  const sources = (sk.meta.hist_sources ?? []) as { cite: string; url: string }[];
  const trend = (sk.meta.natural?.trend ?? null) as { notes?: string } | null;
  let root = -1;
  for (let i = 0; i < f.n && root < 0; i++) if (f.name(i) === name) root = i;
  if (root < 0) throw new Error(`${name} not in tile ${tileId}`);
  const inside = (i: number) => {
    for (let p = i; p >= 0; p = f.parent[p]) if (p === root) return true;
    return false;
  };
  const species: RawSpecies[] = [];
  for (let i = root + 1; i < f.n && inside(i); i++) {
    if (!f.isSpecies(i)) continue;
    const h = f.history(i);
    let history: HistoryRec | null = null;
    if (h) {
      const notes: string[] = h.point_notes ?? [];
      const segs = h.segments as HistSegment[];
      const last = segs[segs.length - 1];
      history = {
        use: h.use ?? 'display',
        scope: h.scope ?? '',
        notes: (h.notes ?? (h.modelled === 'rangeloss' ? trend?.notes : '') ?? '').trim(),
        modelled: h.modelled ?? null,
        G: h.G,
        L: h.L,
        nowYear: last ? last.year0 + last.generations * h.G : new Date().getFullYear(),
        points: (h.points as any[]).map((p, k) => ({
          year: p.year,
          n: p.n,
          lo: p.lo,
          hi: p.hi,
          grade: p.grade,
          kind: p.kind,
          baseline: p.baseline,
          cite: sources[p.cite]?.cite ?? '',
          url: sources[p.cite]?.url ?? '',
          note: notes[k] ?? '',
        })),
        segments: segs.map((s) => ({ ...s })),
      };
    }
    species.push({ ...node(f, i), parentGid: f.gid(f.parent[i]), history });
  }
  return { ...node(f, root), tile: tileId, species };
}
