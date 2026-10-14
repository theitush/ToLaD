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
  /** v1.6 (ToLaD#149): "species" (tinted on the column) or "regional" (a subpopulation: card and sparkline only). */
  scope: 'species' | 'regional';
  /** v1.6: the drawn column falls >= 1.5x through the window (the pipeline's check); true in older data. */
  shown: boolean;
  /** v1.6: why the column doesn't fall through it, in the check's words ('' when shown). */
  why: string;
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

/** One split of the dated tree (pipeline/FORMAT.md, "Dated tree", format 1.6, ToLaD#145). */
export interface DatedSplit {
  /** Ma, and its 95% interval (lo = hi = age: none). */
  age: number;
  lo: number;
  hi: number;
  /** 'ensemble' | 'alvarez' | 'upham-interp' | 'upham-imputed' | 'fossil-floor' | 'fossil' | 'interpolated' | 'override' | 'upham' (dated.py SRC_NAMES). */
  source: string;
  /** Open Tree name of the clade it founds (or an overrides.toml [[dated_name]]), '' if none. */
  name: string;
  /** That name's well-established English form ("small cat"), '' if none (absent in data before it). */
  nameEn?: string;
  /** Daughters grafted by taxonomy only (where inside the split is not known). */
  loose: number;
  /** The overrides.toml entry that set it. */
  override: { name: string; cite: string; reason: string } | null;
  /** Daughters, left to right: species (scientific names) or splits. */
  kids: (string | DatedSplit)[];
}

/** The dated tree's shared tables (dated/skeleton.json). */
export interface DatedMeta {
  upham: string;
  /** Álvarez-Carretero et al. 2022's citation (the ages' other source). */
  alvarez: string;
  genHow: string[];
  commonSource: string;
}

export interface RawSpecies extends RawNode {
  /** gid of the parent node in the tree (species sharing it are sisters). */
  parentGid: number;
  history: HistoryRec | null;
  redList: RedListRec | null;
  natural: NaturalRec | null;
  /** English common name from the data (IUCN Red List 2026-1; an override for a few fossils), or null. */
  common?: string | null;
  /** Generation length (years) the model uses, and where it came from (DatedMeta.genHow). */
  gen?: { years: number; how: string } | null;
  /** Adult body mass (g) the model uses, and where it came from (dated/skeleton.json mass_how; ToLaD#276). */
  mass?: { g: number; how: string } | null;
}

export interface RawClade extends RawNode {
  tile: number;
  species: RawSpecies[];
  /** What the species' natural baselines are (null: data older than v1.2). */
  naturalMeta: NaturalMeta | null;
  /** The dated tree over the clade's species (null: data older than 1.6). */
  dated?: DatedSplit | null;
  datedMeta?: DatedMeta | null;
}

/** A dated sidecar (dated/<tile>.json, pipeline/FORMAT.md "Dated tree"). */
export interface DatedFile {
  tile: number;
  nodes?: number[][];
  names?: Record<string, string>;
  /** English form of a split's taxon name (dated/<id>.json `names_en`, an overrides.toml [[dated_name]]). */
  names_en?: Record<string, string>;
  loose?: Record<string, number>;
  notes?: Record<string, number>;
  /** Rows of the species placed by taxonomy only (grafts); absent in data older than ToLaD#145's rule. */
  grafts?: number[];
  common: Record<string, string>;
  gen: Record<string, [number, number]>;
  /** Adult body mass (g) and its source (an index into mass_how); absent in data before ToLaD#276. */
  mass?: Record<string, [number, number]>;
  // skeleton.json only
  sources?: string[];
  upham?: string;
  alvarez?: string;
  gen_how?: string[];
  mass_how?: string[];
  common_source?: string;
  overrides?: { name: string; cite: string; reason: string }[];
  /** The dated tree over every file's species (ToLaD#247): a species is [parent, tile, row]. */
  all?: { nodes?: number[][]; names?: Record<string, string>; names_en?: Record<string, string>; loose?: Record<string, number>; notes?: Record<string, number> };
}

/**
 * Which species the fan draws (ToLaD#145): those whose place in the tree is dated by a phylogeny
 * (Upham et al. 2019, its ages redated with Álvarez-Carretero et al. 2022), plus the hand-placed
 * `[[dated_fossil]]` / `[[dated_clade]]` entries of overrides.toml, plus every living species (one
 * Upham lacks, like the southern tiger cat, is still a living cat and stays). Fossils the data grafts
 * on by taxonomy only (PBDB genus at first appearance, the `grafts` rows) stay in the data and the
 * tiles but are not drawn: where they sit inside a split is not known, and ~98 of them in Felidae
 * (a 9-species *Pseudaelurus* polytomy 0.04 Myr after the root) crowd the stem past the layout's
 * peel and lean limits. Carnivora takes the same rule. Drawing them is a backlog issue.
 */
export const FAN_PLACEMENT = 'phylogeny+overrides' as const;

/** Whether the fan draws a species row under FAN_PLACEMENT: not a fossil placed by taxonomy only. */
export function onFan(grafts: ReadonlySet<number>, row: number, extinct: boolean): boolean {
  return !(extinct && grafts.has(row));
}

/**
 * A file's dated tree induced on `rows` (species row index -> scientific name): a split left
 * with fewer than two branches collapses; null if no row is in it.
 */
export function datedTree(file: DatedFile, sk: DatedFile, rows: Map<number | string, string>): DatedSplit | null {
  const nodes = file.nodes ?? [];
  const kids: number[][] = nodes.map(() => []);
  nodes.forEach((n, i) => n[0] >= 0 && kids[n[0]].push(i));
  const src = sk.sources ?? [];
  const build = (i: number): string | DatedSplit | null => {
    const n = nodes[i];
    // (A species: [parent, row], or [parent, tile, row] in the skeleton's whole tree `all`, keyed "tile:row".)
    if (n.length === 2) return rows.get(n[1]) ?? null;
    if (n.length === 3) return rows.get(`${n[1]}:${n[2]}`) ?? null;
    const ks = kids[i].map(build).filter((k): k is string | DatedSplit => k !== null);
    if (ks.length === 0) return null;
    if (ks.length === 1) return ks[0];
    const note = file.notes?.[i];
    return {
      age: n[1],
      lo: n[2],
      hi: n[3],
      source: src[n[4]] ?? '',
      name: file.names?.[i] ?? '',
      nameEn: file.names_en?.[i] ?? '',
      loose: file.loose?.[i] ?? 0,
      override: note !== undefined ? (sk.overrides?.[note] ?? null) : null,
      kids: ks,
    };
  };
  const t = nodes.length ? build(0) : null;
  return t && typeof t !== 'string' ? t : null;
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
      if (f.name(i) === name && !f.isStub(i)) {
        const json = (rel: string): DatedFile | null => {
          try {
            return JSON.parse(new TextDecoder().decode(read(rel))) as DatedFile;
          } catch {
            return null;
          }
        };
        const sk = json('dated/skeleton.json');
        const file = json(`dated/${t.id}.json`);
        return extractClade(skBytes, bytes, t.id, name, sk && file ? { sk, file } : undefined);
      }
    }
  }
  throw new Error(`${name} not found in any tile`);
}

/**
 * Panthera (or any genus row named `name`) from a tile: the node, its species
 * in preorder, and each species' curated history with its citations resolved.
 */
export function extractClade(
  skeleton: ArrayBuffer | Uint8Array,
  tile: ArrayBuffer | Uint8Array,
  tileId: number,
  name: string,
  dated?: { sk: DatedFile; file: DatedFile },
  /** Filled with the file's on-fan species rows (row -> scientific name), for a tree over several files (loadAll). */
  rowsOut?: Map<number, string>,
): RawClade {
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
  const rows = new Map<number, string>();
  const grafts = new Set(dated?.file.grafts ?? []);
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
          scope: e.scope === 'regional' ? 'regional' : 'species',
          shown: e.shown ?? true,
          why: e.why ?? '',
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
    const g = dated?.file.gen[i];
    const m = dated?.file.mass?.[i];
    species.push({
      ...node(f, i),
      parentGid: f.gid(f.parent[i]),
      history,
      redList: redListOf(f, i, sk.meta),
      natural: nat ? { ...nat } : null,
      common: dated?.file.common[i] ?? null,
      gen: g ? { years: g[0], how: dated!.sk.gen_how?.[g[1]] ?? '' } : null,
      mass: m ? { g: m[0], how: dated!.sk.mass_how?.[m[1]] ?? '' } : null,
    });
    if (onFan(grafts, i, f.extinct(i))) rows.set(i, f.name(i));
  }
  if (rowsOut) for (const [i, n] of rows) rowsOut.set(i, n);
  const nm = sk.meta.natural;
  const naturalMeta: NaturalMeta | null = nm ? { label: nm.label ?? '', grade: nm.grade ?? 'D', kind: nm.kind ?? '', cite: nm.cite ?? '', url: nm.url ?? '' } : null;
  const tree = dated ? datedTree(dated.file, dated.sk, rows) : null;
  const datedMeta: DatedMeta | null = dated
    ? { upham: dated.sk.upham ?? '', alvarez: dated.sk.alvarez ?? '', genHow: dated.sk.gen_how ?? [], commonSource: dated.sk.common_source ?? '' }
    : null;
  return { ...node(f, root), tile: tileId, species, naturalMeta, dated: tree, datedMeta };
}

/**
 * Every mammal (ToLaD#247): the species of the skeleton and of every tile, under the skeleton's whole dated tree
 * (dated/skeleton.json `all`: the per-file trees cannot be joined without it). The clade row is the skeleton's root.
 */
export function loadAll(read: (rel: string) => Uint8Array): RawClade {
  const skBytes = read('skeleton.tld');
  const skTile = decodeFile(skBytes) as unknown as Tile;
  const json = (rel: string): DatedFile | null => {
    try {
      return JSON.parse(new TextDecoder().decode(read(rel))) as DatedFile;
    } catch {
      return null;
    }
  };
  const skJ = json('dated/skeleton.json');
  if (!skJ?.all?.nodes) throw new Error('data/mammals has no whole dated tree (skeleton.json `all`, ToLaD#247): rebuild it with `make -C pipeline build`');
  const files: { id: number; bytes: Uint8Array }[] = [
    { id: -1, bytes: skBytes },
    ...(skTile.meta.tiles as { id: number; file: string }[]).map((t) => ({ id: t.id, bytes: read(t.file) })),
  ];
  const rows = new Map<number | string, string>();
  const species: RawSpecies[] = [];
  let top: RawClade | null = null;
  for (const { id, bytes } of files) {
    const file = id < 0 ? skJ : json(`dated/${id}.json`);
    const f = decodeFile(bytes) as unknown as Tile;
    const r = new Map<number, string>();
    const c = extractClade(skBytes, bytes, id, f.name(0), file ? { sk: skJ, file } : undefined, r);
    for (const [i, n] of r) rows.set(`${id}:${i}`, n);
    species.push(...c.species);
    if (id < 0) top = c;
  }
  const tree = datedTree({ ...skJ.all, tile: -1, common: {}, gen: {} }, skJ, rows);
  return { ...top!, species, dated: tree };
}

/** The species under a dated split, left to right. */
function underDated(t: DatedSplit): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : underDated(k)));
}

/** A clade with only the species its dated tree places (the rows the fan draws), so a big clade's bundle stays small. */
export function trimToFan(c: RawClade): RawClade {
  if (!c.dated) return c;
  const keep = new Set(underDated(c.dated));
  return { ...c, species: c.species.filter((s) => keep.has(s.sci)) };
}
