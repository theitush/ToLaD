// The synthetic level (ToLaD#343, `?level=synthetic&n=70000`): the scale yardstick's tree (synthetic.ts) opened through
// the mammal level's own path (mammals-data.ts loadMammals, mammaliaTree, mammaliaClade), so it times what opening a
// tree of that size costs. What the build does for the mammals (vite.config.ts: the layout seed, the JSON file) is
// done here first and stamped apart (`tl:synth-gen`, `tl:synth-seed`, `tl:synth-file`); from `tl:fetch` on, the steps
// are the mammals': the file parsed (`tl:json`), the tree, the clade, the view, the first frame.
// Its orders (synthetic.ts: the splits founded under 66 Ma) are registered as the mammal orders are listed (splits.ts
// ORDER_TAXA): the fold's level above the orders and the merged clades' detail (lod.ts) key on that list, so without it
// a tree has neither and every species is drawn every frame (`&orders=0` measures that: any tree not in the list today).
// `&seed=0`: no layout seed (the page works the layout out); `&json=0`: the data handed over as objects, no file (a
// file past V8's string limit, ~512 MB, cannot be parsed: the 1M tree's).
import { stamp } from '../stamp';
import { layoutFan, layoutSeed } from './layout';
import { mergeMammalCard, packMammals, unpackMammals, type MammalCardFile, type MammalData, type MammalFile } from './mammals-data';
import { packGenealogies, packTree } from './packed';
import { cladeOf } from './panthera';
import { genealogiesOf, population } from './population';
import { nameOrders, ORDER_TAXA, treeOf } from './splits';
import { Steady } from './steady';
import { synthData, synthMarks, synthOrders } from './synthetic';

export interface SynthQuery {
  n: number;
  seed: boolean;
  json: boolean;
  orders: boolean;
  /** Fossils, as a fraction of the living (synthetic.ts `fossil`; default the mammals' rate): `&fossil=1.6` about the mammals' with all their fossils (ToLaD#279). */
  fossil?: number;
}

/** The query's synthetic-level options (n defaults to 70,000). */
export function synthQuery(search: string): SynthQuery {
  const q = new URLSearchParams(search);
  const n = Number(q.get('n'));
  const fossil = Number(q.get('fossil'));
  return { n: Number.isFinite(n) && n >= 2 ? Math.floor(n) : 70000, seed: q.get('seed') !== '0', json: q.get('json') !== '0', orders: q.get('orders') !== '0', ...(q.get('fossil') && Number.isFinite(fossil) ? { fossil } : {}) };
}

/** Where the benchmark frames its depths, the last tree made (window.__synth in the page). */
export let synthMarksNow: ReturnType<typeof synthMarks> | null = null;

declare global {
  interface Window {
    /** The synthetic level's depths (synthetic.ts synthMarks), for scripts/scale.mjs and phoneperf.mjs. */
    __synth?: { order: string; family: string; species: string } | null;
  }
}

/**
 * The page's one hook (FanApp's loadMammals): on `?level=synthetic` the synthetic tree's maker, which replaces the
 * fetch of mammals.json; anywhere else undefined, and the page loads the mammals as ever.
 */
export function synthLoader(search = typeof location === 'undefined' ? '' : location.search): (() => Promise<MammalData>) | undefined {
  if (new URLSearchParams(search).get('level') !== 'synthetic') return undefined;
  return () => synthLevelData(synthQuery(search)).then((d) => ((window.__synth = synthMarksNow), d));
}

/** The level's data made as the build would make the file (generated, seeded), then read as the page reads mammals.json. */
export async function synthLevelData(o: SynthQuery, ms?: Record<string, number>): Promise<MammalData> {
  let t = performance.now();
  const lap = (k: string) => {
    stamp(k);
    const n = performance.now();
    if (ms) ms[k] = n - t;
    t = n;
  };
  const d = synthData({ n: o.n, fossil: o.fossil });
  synthMarksNow = synthMarks(d);
  if (o.orders) for (const name of synthOrders(d)) (ORDER_TAXA as Set<string>).add(name);
  lap('synth-gen');
  if (o.seed) {
    // (As mammals-seed.ts, on a tree and clade of its own, not the level's memoized ones: the layout seed, the orders'
    // shares, every strand's genealogy and the packed dated tree, the clade then carrying no `dated` of its own.)
    const tree = nameOrders(treeOf(d.clade));
    const clade = cladeOf(d.clade, tree, 'Synthetic');
    const seed = layoutSeed(clade, tree);
    const fan = layoutFan({ ...clade, seed }, 'linear', tree);
    seed.ord = new Steady(fan).ordShare;
    d.gen = packGenealogies(genealogiesOf(fan.branches.map((b) => population(b.sp, b.t0))));
    d.tree = packTree(tree);
    d.seed = seed;
    d.clade = { ...d.clade, dated: undefined, datedMeta: undefined };
    lap('synth-seed');
  }
  if (!o.json) {
    lap('fetch');
    return d;
  }
  // (As vite.config.ts writes mammals.json: through JSON once, packed in columns; then read as mammals-data.ts reads it.
  // Its card's file read at once: the synthetic tree has no cards to wait for.)
  const files = packMammals(JSON.parse(JSON.stringify(d)) as MammalData);
  const text = JSON.stringify(files.open);
  const card = JSON.stringify(files.card);
  if (ms) ms.bytes = text.length;
  lap('synth-file');
  lap('fetch');
  const f = JSON.parse(text) as MammalFile;
  lap('json');
  const out = unpackMammals(f);
  lap('unpack');
  mergeMammalCard(out, JSON.parse(card) as MammalCardFile);
  return out;
}
