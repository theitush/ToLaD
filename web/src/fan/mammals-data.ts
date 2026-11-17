// The mammal level's data (ToLaD#247): every mammal under the whole dated tree, ~20x the carnivores. It is not in the
// page: vite.config.ts writes it as sibling files next to index.html (served at the same names in dev), split by what
// the open reads (ToLaD#502): mammals.json, the tree, the layout and what the columns, labels and taps read, fetched
// on open (index.html preloads it); mammals-card.json, the kinds only a species' card reads (CARD_KINDS), asked for
// once mammals.json is in (it downloads while the page builds the tree) and read once the first frame is drawn, or
// when a card opens first (FanApp useMammalCard).
//
// Until loadMammals() has resolved, mammalData() throws: the mammal tree and clade (splits.ts mammaliaTree, panthera.ts
// mammaliaClade) are built from it only when the level is shown. Tests and scripts in node load it from the data files
// (mammals-node.ts), the same build the page fetches.

import { stamp } from '../stamp';
import type { LayoutSeed } from './layout';
import { packColumns, uintsFromBase64, uintsToBase64, unpackColumns, type Columns, type PackedGenealogies, type PackedTree, type SizeOf } from './packed';
import type { RawClade } from './panthera-extract';

/** What mammals.json holds. */
export interface MammalData {
  /** Every mammal of data/mammals under the whole dated tree: only the species the fan draws (trimToFan). */
  clade: RawClade;
  /** Every species' pictures and links (data/mammals/wiki.json, ToLaD#182). Node's load leaves them out (mammals-node.ts). */
  wiki: Record<string, { wp?: string; img?: string; file?: string; range?: string; rangeFile?: string } | null>;
  /** The level's default layout, worked out at build time (layout.ts LayoutSeed, ToLaD#255); absent, the page works it out. */
  seed?: LayoutSeed;
  /** Every strand's genealogy, worked out at build time (population.ts genealogiesAhead, ToLaD#255); absent, the page walks them. */
  gen?: PackedGenealogies;
  /** The level's dated tree, built at build time (splits.ts mammaliaTree, ToLaD#255): then the clade carries no `dated` of its own. */
  tree?: PackedTree;
}

/** What the build works out ahead of the page (mammals-seed.ts). */
export type MammalAhead = Pick<MammalData, 'seed' | 'gen' | 'tree'>;

/**
 * Which fields of a record wait for the card's file (ToLaD#502): `true`, the field whole; an object, those of its
 * own fields (of each element, for an array). Every field not named, whatever the data holds, is in mammals.json.
 */
export interface Kinds {
  [field: string]: true | Kinds;
}

/**
 * A species' kinds only its card reads (ToLaD#502; opentrace.test.ts checks the open reads none of them): the counts'
 * ranges, the Red List assessment, the natural level, what dates its range loss (ToLaD#507), how a graft was placed (ToLaD#279), and the history's words and ranges (its points' sources and
 * bounds, its events' text). What the layout, the columns, the labels, search and a tap read stays in mammals.json,
 * with whatever fields the data adds.
 */
export const CARD_KINDS: Kinds = {
  everLo: true,
  everHi: true,
  redList: true,
  natural: true,
  loss: true,
  placed: true,
  history: {
    scope: true,
    notes: true,
    deepJoin: true,
    points: { lo: true, hi: true, cite: true, url: true, note: true },
    events: { title: true, summary: true, quote: true, cite: true, url: true, region: true, why: true },
  },
};

/** A species' picture records' kinds only the card reads (ToLaD#502): its links and credits; the picture (`img`) is drawn on the tree. */
export const WIKI_CARD_KINDS: Kinds = { wp: true, file: true, range: true, rangeFile: true };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A value's fields for the open and for the card (`kinds`): [open, card]; card undefined where it has none. */
export function splitKinds(v: unknown, kinds: Kinds): [unknown, unknown] {
  if (Array.isArray(v)) {
    const o: unknown[] = [];
    const c: unknown[] = [];
    for (const x of v) {
      const [a, b] = splitKinds(x, kinds);
      o.push(a);
      c.push(b ?? null);
    }
    return [o, c];
  }
  if (!isObj(v)) return [v, v === null ? null : undefined];
  const o: Record<string, unknown> = {};
  const c: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const kind = Object.hasOwn(kinds, k) ? kinds[k] : undefined;
    if (kind === undefined) o[k] = x;
    else if (kind === true) c[k] = x;
    else {
      const [a, b] = splitKinds(x, kind);
      o[k] = a;
      if (b !== undefined) c[k] = b;
    }
  }
  return [o, c];
}

/** Put the card's fields (splitKinds' second) back into the open's records, in place: the objects already read keep their identity. */
export function mergeKinds(into: unknown, from: unknown): void {
  if (Array.isArray(into) && Array.isArray(from)) {
    from.forEach((x, i) => mergeKinds(into[i], x));
    return;
  }
  if (!isObj(into) || !isObj(from)) return;
  for (const [k, x] of Object.entries(from)) {
    const y = into[k];
    if ((isObj(x) && isObj(y)) || (Array.isArray(x) && Array.isArray(y))) mergeKinds(y, x);
    else into[k] = x;
  }
}

/** The picture records' rows: keys that name a species by its row (`at`, varints), the rest by name (`keys`), in that order. */
interface WikiRows {
  at: string;
  keys: string[];
}

/**
 * mammals.json itself (ToLaD#255, #502): what the open reads of MammalData, in columns (packed.ts packColumns), so the
 * page parses a few long strings, not ~7,000 objects' keys and digits; value for value the same once unpacked.
 */
export interface MammalFile extends Omit<MammalData, 'clade' | 'wiki' | 'seed'> {
  clade: Omit<RawClade, 'species'> & { species: { n: number; cols: Columns } };
  wiki: WikiRows & { cols: Columns };
  /** The layout seed as one row of columns (its coordinates in float64 planes). */
  seed?: Columns;
}

/** mammals-card.json (ToLaD#502): per species (mammals.json's rows) its CARD_KINDS, per picture record its WIKI_CARD_KINDS. */
export interface MammalCardFile {
  species: { n: number; cols: Columns };
  wiki: { n: number; cols: Columns };
}

function wikiRows(d: MammalData): { rows: string[]; at: number[]; keys: string[] } {
  const row = new Map(d.clade.species.map((s, i) => [s.sci, i]));
  const named: string[] = [];
  const at: number[] = [];
  const keys: string[] = [];
  for (const k of Object.keys(d.wiki)) {
    const i = row.get(k);
    if (i === undefined) keys.push(k);
    else named.push(k), at.push(i);
  }
  return { rows: [...named, ...keys], at, keys };
}

/** MammalData as its two files: what the open reads, and the card's kinds (ToLaD#502); `size` judges a column's two ways (packColumns). */
export function packMammals(d: MammalData, size?: SizeOf): { open: MammalFile; card: MammalCardFile } {
  const sp = d.clade.species.map((s) => splitKinds(s, CARD_KINDS));
  const { rows, at, keys } = wikiRows(d);
  const w = rows.map((k) => splitKinds(d.wiki[k], WIKI_CARD_KINDS));
  const n = d.clade.species.length;
  const { seed, ...rest } = d;
  const open: MammalFile = {
    ...rest,
    clade: { ...d.clade, species: { n, cols: packColumns(sp.map((x) => x[0]), size) } },
    wiki: { at: uintsToBase64(at), keys, cols: packColumns(w.map((x) => x[0]), size) },
  };
  if (seed) open.seed = packColumns([seed], size);
  const card: MammalCardFile = {
    species: { n, cols: packColumns(sp.map((x) => x[1] ?? {}), size) },
    wiki: { n: rows.length, cols: packColumns(w.map((x) => x[1] ?? null), size) },
  };
  return { open, card };
}

/** mammals.json read back: MammalData without the card's kinds (mergeMammalCard adds them). */
export function unpackMammals(f: MammalFile): MammalData {
  const species = f.clade.species.n;
  const sp = unpackColumns(f.clade.species.cols, species) as RawClade['species'];
  const names = [...uintsFromBase64(f.wiki.at).map((i) => sp[i].sci), ...f.wiki.keys];
  const w = unpackColumns(f.wiki.cols, names.length) as MammalData['wiki'][string][];
  const wiki: MammalData['wiki'] = {};
  names.forEach((k, i) => (wiki[k] = w[i]));
  const { seed, ...rest } = f;
  const d: MammalData = { ...rest, clade: { ...f.clade, species: sp }, wiki };
  if (seed) d.seed = unpackColumns(seed, 1)[0] as LayoutSeed;
  return d;
}

/** Put mammals-card.json's kinds into the data mammals.json gave (unpackMammals), in place: its rows in the same order. */
export function mergeMammalCard(d: MammalData, c: MammalCardFile): void {
  const sp = d.clade.species;
  const names = Object.keys(d.wiki);
  if (c.species.n !== sp.length || c.wiki.n !== names.length) throw new Error(`${MAMMALS_CARD_FILE} is not the build of ${MAMMALS_FILE}`);
  unpackColumns(c.species.cols, c.species.n).forEach((x, i) => mergeKinds(sp[i], x));
  unpackColumns(c.wiki.cols, c.wiki.n).forEach((x, i) => mergeKinds(d.wiki[names[i]], x));
}

/** The sibling files' names (vite.config.ts emits them; pages.yml stages them next to index.html). */
export const MAMMALS_FILE = 'mammals.json';
export const MAMMALS_CARD_FILE = 'mammals-card.json';

let data: MammalData | null = null;
let pending: Promise<MammalData> | null = null;
/** Whether the card's kinds are in the data (node's loads and the synthetic tree carry them from the start). */
let cardIn = true;
let cardPending: Promise<void> | null = null;
const cardWaiters: (() => void)[] = [];

/** The loaded data; throws before loadMammals() has resolved. */
export function mammalData(): MammalData {
  if (!data) throw new Error('the mammal data is not loaded: await loadMammals() first');
  return data;
}

/** Whether the mammal data is in (the level opens with no wait). */
export function mammalsLoaded(): boolean {
  return data !== null;
}

async function readJson<T>(name: string, at: Promise<Response>, step?: string): Promise<T> {
  const r = await at;
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  if (step) stamp(step);
  return (await r.json()) as T;
}

const request = (name: string) => fetch(new URL(name, document.baseURI));

/** mammals-card.json's request, made once mammals.json is in: it comes while the page builds the tree (the network idle then); read after the first frame. */
let cardRequest: Promise<Response> | null = null;

async function fetchMammals(): Promise<MammalData> {
  // (The same request index.html preloads, so the page takes the preload's.)
  const f = await readJson<MammalFile>(MAMMALS_FILE, request(MAMMALS_FILE), 'fetch');
  if (!cardRequest) {
    cardRequest = request(MAMMALS_CARD_FILE);
    // (A failure is the card's to report, when it reads it.)
    cardRequest.catch(() => {});
  }
  stamp('json');
  const d = unpackMammals(f);
  cardIn = false;
  stamp('unpack');
  return d;
}

/** Load the mammal data once (later calls share the first); `get` replaces the fetch (node: mammals-node.ts). */
export function loadMammals(get: () => Promise<MammalData> = fetchMammals): Promise<MammalData> {
  if (data) return Promise.resolve(data);
  pending ??= get().then(
    (d) => (data = d),
    (e) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

/** Whether the card's kinds are in (a card shows them at once). */
export function mammalCardLoaded(): boolean {
  return data !== null && cardIn;
}

/** mammals-card.json: the request made when mammals.json came in, or a new one (a failed one is not asked again). */
function fetchCard(): Promise<MammalCardFile> {
  const at = cardRequest ?? request(MAMMALS_CARD_FILE);
  cardRequest = null;
  return readJson<MammalCardFile>(MAMMALS_CARD_FILE, at);
}

/** Load mammals-card.json's kinds into the data once, after it (later calls share the first; a failure is tried again on the next call). */
export function loadMammalCard(get: () => Promise<MammalCardFile> = fetchCard): Promise<void> {
  cardPending ??= loadMammals()
    .then(async (d) => {
      if (cardIn) return;
      stamp('card-read');
      const c = await get();
      stamp('card-json');
      mergeMammalCard(d, c);
      cardIn = true;
      stamp('card');
      for (const f of cardWaiters.splice(0)) f();
    })
    .catch((e: unknown) => {
      cardPending = null;
      throw e;
    });
  return cardPending;
}

/** Run `f` once the card's kinds are in (at once if they are). */
export function onMammalCard(f: () => void): void {
  if (cardIn) f();
  else cardWaiters.push(f);
}
