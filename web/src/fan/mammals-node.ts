// The mammal level's data in node (tests, perf runs): built from data/mammals as vite.config.ts builds mammals.json
// (ToLaD#247), without the pictures. Node only: it reads the files.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMammals, type MammalData, type TreeName } from './mammals-data';
import { loadAll, trimToFan, type Fossils } from './panthera-extract';

/** Which tree node's data is (ToLaD#539): data/mammals, or data/amniotes with TOLAD_TREE=amniotes (the page's `?tree=amniotes`). */
export const NODE_TREE: TreeName = process.env.TOLAD_TREE === 'amniotes' ? 'amniotes' : 'mammals';
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', NODE_TREE);

/**
 * Which fossils node's data draws (panthera-extract.ts Fossils): what the page shows, every fossil (mammals-all.json,
 * ToLaD#279), or the old look with TOLAD_FOSSILS=old (the page's `?fossils=old`). vite.config.ts's test fixtures
 * (Felidae, Carnivora) read it too.
 */
export const NODE_FOSSILS: Fossils = process.env.TOLAD_FOSSILS === 'old' ? 'phylogeny' : 'all';

/** Load the mammal data from the files (once per process, as the page's fetch): the tree NODE_TREE names, or `tree`'s. */
export function loadMammalsFromFiles(tree: TreeName = NODE_TREE): Promise<MammalData> {
  const dir = join(DATA, '..', tree);
  return loadMammals(async () => ({ clade: trimToFan(loadAll((rel) => readFileSync(join(dir, rel)), NODE_FOSSILS)), wiki: {} }));
}
