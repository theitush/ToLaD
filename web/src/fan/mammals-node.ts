// The mammal level's data in node (tests, perf runs): built from data/mammals as vite.config.ts builds mammals.json
// (ToLaD#247), without the pictures. Node only: it reads the files.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMammals, type MammalData } from './mammals-data';
import { loadAll, trimToFan } from './panthera-extract';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals');

/** Load the mammal data from the files (once per process, as the page's fetch). */
export function loadMammalsFromFiles(): Promise<MammalData> {
  return loadMammals(async () => ({ clade: trimToFan(loadAll((rel) => readFileSync(join(DATA, rel)))), wiki: {} }));
}
