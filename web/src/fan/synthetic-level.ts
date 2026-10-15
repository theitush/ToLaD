// The synthetic level (ToLaD#343, `?level=synthetic&n=70000`): the scale yardstick's tree (synthetic.ts) opened through
// the mammal level's own path (mammals-data.ts loadMammals, mammaliaTree, mammaliaClade), so it times what opening a
// tree of that size costs. What the build does for the mammals (vite.config.ts: the layout seed, the JSON file) is
// done here first and stamped apart (`tl:synth-gen`, `tl:synth-seed`, `tl:synth-file`); from `tl:fetch` on, the steps
// are the mammals': the file parsed (`tl:json`), the tree, the clade, the view, the first frame.
// `&seed=0`: no layout seed (the page works the layout out); `&json=0`: the data handed over as objects, no file (a
// file past V8's string limit, ~512 MB, cannot be parsed: the 1M tree's).
import { stamp } from '../stamp';
import { layoutFan, layoutSeed } from './layout';
import type { MammalData } from './mammals-data';
import { cladeOf } from './panthera';
import { nameOrders, treeOf } from './splits';
import { Steady } from './steady';
import { synthData, synthMarks } from './synthetic';

export interface SynthQuery {
  n: number;
  seed: boolean;
  json: boolean;
}

/** The query's synthetic-level options (n defaults to 70,000). */
export function synthQuery(search: string): SynthQuery {
  const q = new URLSearchParams(search);
  const n = Number(q.get('n'));
  return { n: Number.isFinite(n) && n >= 2 ? Math.floor(n) : 70000, seed: q.get('seed') !== '0', json: q.get('json') !== '0' };
}

/** Where the benchmark frames its depths, the last tree made (window.__synth in the page). */
export let synthMarksNow: ReturnType<typeof synthMarks> | null = null;

/** The level's data made as the build would make the file (generated, seeded), then read as the page reads mammals.json. */
export async function synthLevelData(o: SynthQuery, ms?: Record<string, number>): Promise<MammalData> {
  let t = performance.now();
  const lap = (k: string) => {
    stamp(k);
    const n = performance.now();
    if (ms) ms[k] = n - t;
    t = n;
  };
  const d = synthData({ n: o.n });
  synthMarksNow = synthMarks(d);
  lap('synth-gen');
  if (o.seed) {
    // (As mammals-seed.ts: on a tree and clade of its own, not the level's memoized ones.)
    const tree = nameOrders(treeOf(d.clade));
    const clade = cladeOf(d.clade, tree, 'Synthetic');
    const seed = layoutSeed(clade, tree);
    seed.ord = new Steady(layoutFan({ ...clade, seed }, 'linear', tree, 'curved')).ordShare;
    d.seed = seed;
    lap('synth-seed');
  }
  if (!o.json) {
    lap('fetch');
    return d;
  }
  const text = JSON.stringify(d);
  if (ms) ms.bytes = text.length;
  lap('synth-file');
  lap('fetch');
  const out = JSON.parse(text) as MammalData;
  lap('json');
  return out;
}
