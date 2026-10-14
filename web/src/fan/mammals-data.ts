// The mammal level's data (ToLaD#247): every mammal under the whole dated tree, ~20x the carnivores. It is not in the
// page: vite.config.ts writes it as a sibling file (mammals.json, next to index.html; served at /mammals.json in dev)
// and the level fetches it the first time it opens, so the default page carries only the carnivores.
//
// Until loadMammals() has resolved, mammalData() throws: the mammal tree and clade (splits.ts mammaliaTree, panthera.ts
// mammaliaClade) are built from it only when the level is shown. Tests and scripts in node load it from the data files
// (mammals-node.ts), the same build the page fetches.

import type { LayoutSeed } from './layout';
import type { RawClade } from './panthera-extract';

/** What mammals.json holds. */
export interface MammalData {
  /** Every mammal of data/mammals under the whole dated tree: only the species the fan draws (trimToFan). */
  clade: RawClade;
  /** The pictures and links of the species the carnivore page leaves out (data/mammals/wiki.json, ToLaD#182). */
  wiki: Record<string, { wp?: string; img?: string; file?: string; range?: string; rangeFile?: string } | null>;
  /** The level's default layout, worked out at build time (layout.ts LayoutSeed, ToLaD#255); absent, the page works it out. */
  seed?: LayoutSeed;
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
  return (await r.json()) as MammalData;
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
