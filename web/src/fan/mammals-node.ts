// The mammal level's data in node (tests, perf runs): built from data/mammals as vite.config.ts builds mammals.json
// (ToLaD#247), without the pictures. Node only: it reads the files.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMammals, type MammalData } from './mammals-data';
import { loadAll, trimToFan, type Fossils } from './panthera-extract';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals');

/**
 * Which fossils node's data draws (panthera-extract.ts Fossils): the page's default, or every one with TOLAD_FOSSILS=all
 * (the page's `?fossils=all`, mammals-all.json, ToLaD#279). vite.config.ts's test fixtures (Felidae, Carnivora) read it too.
 */
export const NODE_FOSSILS: Fossils = process.env.TOLAD_FOSSILS === 'all' ? 'all' : 'phylogeny';

/** Load the mammal data from the files (once per process, as the page's fetch). */
export function loadMammalsFromFiles(): Promise<MammalData> {
  return loadMammals(async () => ({ clade: trimToFan(loadAll((rel) => readFileSync(join(DATA, rel)), NODE_FOSSILS)), wiki: {} }));
}
