// The mammal level's data (ToLaD#247): every mammal under the whole dated tree, ~20x the carnivores. It is not in the
// page: vite.config.ts writes it as a sibling file (mammals.json, next to index.html; served at /mammals.json in dev)
// and the level fetches it the first time it opens, so the default page carries only the carnivores.
//
// Until loadMammals() has resolved, mammalData() throws: the mammal tree and clade (splits.ts mammaliaTree, panthera.ts
// mammaliaClade) are built from it only when the level is shown. Tests and scripts in node load it from the data files
// (mammals-node.ts), the same build the page fetches.

import { stamp } from '../stamp';
import type { LayoutSeed } from './layout';
import { packColumns, unpackColumns, unpackGenealogies, type Columns, type PackedGenealogies, type PackedTree } from './packed';
import type { RawClade } from './panthera-extract';
import { genealogiesAhead } from './population';

/** What mammals.json holds. */
export interface MammalData {
  /** Every mammal of data/mammals under the whole dated tree: only the species the fan draws (trimToFan). */
  clade: RawClade;
  /** The pictures and links of the species the carnivore page leaves out (data/mammals/wiki.json, ToLaD#182). */
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
 * mammals.json itself (ToLaD#255): MammalData with its species and pictures in columns (packed.ts packColumns), so the
 * page parses a few long strings, not ~7,000 objects' keys and digits; value for value the same once unpacked.
 */
export interface MammalFile extends Omit<MammalData, 'clade' | 'wiki'> {
  clade: Omit<RawClade, 'species'> & { species: { n: number; cols: Columns } };
  wiki: { keys: string[]; cols: Columns };
}

export function packMammals(d: MammalData): MammalFile {
  const keys = Object.keys(d.wiki);
  return {
    ...d,
    clade: { ...d.clade, species: { n: d.clade.species.length, cols: packColumns(d.clade.species) } },
    wiki: { keys, cols: packColumns(keys.map((k) => d.wiki[k])) },
  };
}

export function unpackMammals(f: MammalFile): MammalData {
  const w = unpackColumns(f.wiki.cols, f.wiki.keys.length) as MammalData['wiki'][string][];
  const wiki: MammalData['wiki'] = {};
  f.wiki.keys.forEach((k, i) => (wiki[k] = w[i]));
  return { ...f, clade: { ...f.clade, species: unpackColumns(f.clade.species.cols, f.clade.species.n) as RawClade['species'] }, wiki };
}

/** The sibling file's name (vite.config.ts emits it; pages.yml stages it next to index.html). */
export const MAMMALS_FILE = 'mammals.json';

let data: MammalData | null = null;
let pending: Promise<MammalData> | null = null;

/** The loaded data; throws before loadMammals() has resolved. */
export function mammalData(): MammalData {
  if (!data) throw new Error('the mammal data is not loaded: await loadMammals() first');
  return data;
}

/** Whether the mammal data is in (the level opens with no wait). */
export function mammalsLoaded(): boolean {
  return data !== null;
}

async function fetchMammals(): Promise<MammalData> {
  const r = await fetch(new URL(MAMMALS_FILE, document.baseURI));
  if (!r.ok) throw new Error(`${MAMMALS_FILE}: HTTP ${r.status}`);
  stamp('fetch');
  const f = (await r.json()) as MammalFile;
  stamp('json');
  const d = unpackMammals(f);
  stamp('unpack');
  return d;
}

/** Load the mammal data once (later calls share the first); `get` replaces the fetch (node: mammals-node.ts). */
export function loadMammals(get: () => Promise<MammalData> = fetchMammals): Promise<MammalData> {
  if (data) return Promise.resolve(data);
  pending ??= get().then(
    (d) => {
      if (d.gen) genealogiesAhead(unpackGenealogies(d.gen));
      return (data = d);
    },
    (e) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}
