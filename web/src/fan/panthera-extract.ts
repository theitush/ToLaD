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

/** A curated event in a species' past (pipeline/history `[[event]]`, ToLaD#141). */
export interface HistEvent {
  kind: 'bottleneck';
  /** The window, years before present: from `fromYa` (older) up to `toYa`. */
  fromYa: number;
  toYa: number;
  /** 2–5 words: the label on the fan. */
  title: string;
  summary: string;
  /** Copied verbatim from the source. */
  quote: string;
  cite: string;
  url: string;
  grade: Grade;
  /** The part of the species' range it concerns ('' = the whole species). */
  region: string;
}

export interface HistoryRec {
  /** "counts": the curve is the species' births (EVER, procgen); "display": shown only. */
  use: string;
  /** "wild", "domestic" (a tamed stock: its segments start at domestication) or "total" (humans). */
  component: string;
  scope: string;
  notes: string;
  /**
   * Null for a curated history file; "rangeloss" for a modelled range-loss trend
   * (format v1.3: its notes are the shared skeleton META.natural.trend's), "genomic"
   * for a modelled bulk genomic deep past (ToLaD#64).
   */
  modelled: string | null;
  /**
   * How the genomic deep past was joined to the next level, in one sentence (pipeline ToLaD#80):
   * scaled to a cited count, kept at its own level against a modelled one, flagged beyond 10x.
   * '' when the history has no genomic curve.
   */
  deepJoin?: string;
  /** Curated events (format v1.5, ToLaD#141): bottlenecks, oldest first; marked on the column, quoted on the card. */
  events: HistEvent[];
  /** Generation length and mean lifespan (years) the segments were compiled with. */
  G: number;
  L: number;
  /** Calendar year of "now" (the end of the last segment). */
  nowYear: number;
  points: HistPoint[];
  segments: HistSegment[];
}

/**
 * A species' IUCN Red List status from the data (format v1.4 RLST, ToLaD#48), its source resolved
 * from skeleton META.red_list. Every living species has one; fossils none.
 */
export interface RedListRec {
  /** 'LC' 'NT' 'VU' 'EN' 'CR' 'EW' 'EX' 'DD', or 'NE' (on no list: not evaluated). */
  category: string;
  /** Year of the current assessment; the source's vintage when there is no assessment. */
  year: number;
  /** Source key: 'iucn-2026-1', 'phylacine-1.2' (IUCN 2016-3) or 'not-listed'. */
  source: string;
  sourceLabel: string;
  /** Short citation of the assessment (or the source), and its page ('' = none). */
  cite: string;
  url: string;
}

/** A species' natural (pre-human) baseline (format v1.2 NATB): always modelled, see NaturalMeta. */
export interface NaturalRec {
  /** Individuals alive with no human impact, and its 95% range. */
  n: number;
  lo: number;
  hi: number;
  /** PHYLACINE present-natural and current range areas, km² (current 0: extinct). */
  km2Natural: number;
  km2Current: number;
}

/** What every natural baseline is (skeleton META.natural): its label, grade and source. */
export interface NaturalMeta {
  label: string;
  grade: Grade;
  kind: string;
  cite: string;
  url: string;
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
  redList: RedListRec | null;
  natural: NaturalRec | null;
}

export interface RawClade extends RawNode {
  tile: number;
  species: RawSpecies[];
  /** What the species' natural baselines are (null: data older than v1.2). */
  naturalMeta: NaturalMeta | null;
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
  natural?(i: number): NaturalRec | null;
  redList?(i: number): { category: string; source: number; year: number; taxon: number; assessment: number } | null;
  meta: any;
}

interface RedListSource {
  key: string;
  label: string;
  cite: string;
  url: string;
}

/** Row `i`'s Red List status with its source resolved, or null (none, or data older than v1.4). */
export function redListOf(f: Tile, i: number, meta: any): RedListRec | null {
  const r = f.redList ? f.redList(i) : null;
  const m = meta?.red_list;
  if (!r || !m) return null;
  const src = (m.sources as RedListSource[])[r.source];
  const assessed = r.taxon > 0 && r.assessment > 0;
  return {
    category: r.category,
    year: r.year,
    source: src?.key ?? '',
    sourceLabel: src?.label ?? '',
    cite: assessed ? `${src?.label ?? 'IUCN Red List'}, e.T${r.taxon}A${r.assessment}` : (src?.label ?? ''),
    url: assessed ? String(m.url).replace('{taxon}', String(r.taxon)).replace('{assessment}', String(r.assessment)) : (src?.url ?? ''),
  };
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
        component: h.component ?? 'wild',
        scope: h.scope ?? '',
        notes: (h.notes ?? (h.modelled === 'rangeloss' ? trend?.notes : '') ?? '').trim(),
        modelled: h.modelled ?? null,
        deepJoin: String(h.deep_join ?? '').trim(),
        events: ((h.events ?? []) as any[]).map((e) => ({
          kind: e.kind,
          fromYa: e.from_ya,
          toYa: e.to_ya,
          title: e.title,
          summary: e.summary,
          quote: e.quote,
          cite: e.cite,
          url: e.url,
          grade: e.grade,
          region: e.region ?? '',
        })),
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
    const nat = f.natural ? f.natural(i) : null;
    species.push({ ...node(f, i), parentGid: f.gid(f.parent[i]), history, redList: redListOf(f, i, sk.meta), natural: nat ? { ...nat } : null });
  }
  const nm = sk.meta.natural;
  const naturalMeta: NaturalMeta | null = nm ? { label: nm.label ?? '', grade: nm.grade ?? 'D', kind: nm.kind ?? '', cite: nm.cite ?? '', url: nm.url ?? '' } : null;
  return { ...node(f, root), tile: tileId, species, naturalMeta };
}
