// The mammal level's default layout, worked out at build time (vite.config.ts loads this through a vite server, the
// virtual data modules resolved, and writes the result into mammals.json; ToLaD#255): the page then skips choosing
// sides and packing columns (layout.ts LayoutSeed), the bulk of opening the level.
import { Steady } from './steady';
import { layoutFan, layoutSeed } from './layout';
import { loadMammals, type MammalAhead } from './mammals-data';
import { packGenealogies, packTree } from './packed';
import { genealogiesOf, population } from './population';
import { mammaliaClade } from './panthera';
import type { RawClade } from './panthera-extract';
import { mammaliaTree } from './splits';

/** What the build works out ahead for this clade, as the page will read it (pass it as mammals.json carries it: through JSON). */
export async function mammalsSeed(clade: RawClade): Promise<MammalAhead> {
  await loadMammals(async () => ({ clade, wiki: {} }));
  // The dated tree as built from the data, before any layout has read it.
  const tree = packTree(mammaliaTree());
  const seed = layoutSeed(mammaliaClade(), mammaliaTree());
  // (The orders' shares, fold.ts scaleOrders: worked out on the layout without them.)
  const fan = layoutFan({ ...mammaliaClade(), seed }, 'linear', mammaliaTree());
  seed.ord = new Steady(fan).ordShare;
  // Every strand's genealogy (the walk back, population.ts shareBackSampled): the bulk of the level's layout.
  const gen = packGenealogies(genealogiesOf(fan.branches.map((b) => population(b.sp, b.t0))));
  return { seed, gen, tree };
}
