// The mammal level's default layout, worked out at build time (vite.config.ts loads this through a vite server, the
// virtual data modules resolved, and writes the result into mammals.json; ToLaD#255): the page then skips choosing
// sides and packing columns (layout.ts LayoutSeed), the bulk of opening the level.
import { Steady } from './steady';
import { layoutFan, layoutSeed, type LayoutSeed } from './layout';
import { loadMammals } from './mammals-data';
import { mammaliaClade } from './panthera';
import type { RawClade } from './panthera-extract';
import { mammaliaTree } from './splits';

/** The seed for this clade, as the page will read it (pass it as mammals.json carries it: through JSON). */
export async function mammalsSeed(clade: RawClade): Promise<LayoutSeed> {
  await loadMammals(async () => ({ clade, wiki: {} }));
  const seed = layoutSeed(mammaliaClade(), mammaliaTree());
  // (The orders' shares, fold.ts scaleOrders: worked out on the layout without them.)
  seed.ord = new Steady(layoutFan({ ...mammaliaClade(), seed }, 'linear', mammaliaTree())).ordShare;
  return seed;
}
