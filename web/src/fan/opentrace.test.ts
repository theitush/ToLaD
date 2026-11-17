// The open reads nothing that waits for the card's file (ToLaD#502): mammals.json carries what the tree's open, its
// moves, search and a tap read; mammals-card.json the kinds only a card reads (mammals-data.ts CARD_KINDS). Here the
// level opens on mammals.json's part alone, every species and picture record watched: the tree built and drawn, then
// flown over the orders, families and genera at several zooms, a few species framed, a search, and a tap's event
// lookup. A read of a card kind fails it, naming the field (move the kind out of CARD_KINDS, or the read to the card).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFlip } from './flip';
import { RectBatch } from './meshgl';
import { CARD_KINDS, loadMammals, packMammals, unpackMammals, WIKI_CARD_KINDS, type Kinds, type MammalData, type MammalFile } from './mammals-data';
import { mammaliaClade } from './panthera';
import { loadAll, trimToFan } from './panthera-extract';
import { searchSpecies } from './search';
import { mammaliaTree } from './splits';
import { colEventsY, FanView } from './view';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals');

function stubCanvas() {
  const noop = () => {};
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : noop),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  const g = globalThis as Record<string, unknown>;
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    closePath() {}
    rect() {}
  };
  g.Image = class {
    src = '';
    complete = false;
    naturalWidth = 0;
    addEventListener() {}
    decode() {
      return new Promise(() => {});
    }
  };
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.window = { devicePixelRatio: 3 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  return {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
}

/** Card kinds read while watching, as paths (history.points[].cite). */
const read = new Set<string>();
let watching = false;
const proxies = new WeakMap<object, unknown>();

/** `o` watched: a read (or an `in`) of a field `kinds` names is noted; the other fields' records watched in turn. */
function watch<T>(o: T, kinds: Kinds, path: string): T {
  if (typeof o !== 'object' || o === null || ArrayBuffer.isView(o)) return o;
  const was = proxies.get(o);
  if (was) return was as T;
  const arr = Array.isArray(o);
  const p = new Proxy(o, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k === 'symbol') return v;
      if (arr) return /^\d+$/.test(k) ? watch(v, kinds, `${path}[]`) : v;
      const kind = Object.hasOwn(kinds, k) ? kinds[k] : undefined;
      if (kind === true && watching) read.add(`${path}.${k}`);
      return kind && kind !== true ? watch(v, kind, `${path}.${k}`) : v;
    },
    has(t, k) {
      if (typeof k === 'string' && !arr && Object.hasOwn(kinds, k) && kinds[k] === true && watching) read.add(`${path}.${k}?`);
      return Reflect.has(t, k);
    },
  });
  proxies.set(o, p);
  return p;
}

describe('the open reads nothing of the card file (ToLaD#502)', () => {
  it('opens, moves, searches and taps on mammals.json alone', async () => {
    setFlip(true);
    // mammals.json's part of the data, as the page has it before mammals-card.json: packed, through JSON, unpacked.
    await loadMammals(async () => {
      const clade = trimToFan(loadAll((rel) => readFileSync(join(DATA, rel))));
      // (The pictures' records as the build takes them, data/mammals/wiki.json.)
      const all = JSON.parse(readFileSync(join(DATA, 'wiki.json'), 'utf8')) as MammalData['wiki'];
      const wiki = Object.fromEntries(clade.species.filter((s) => s.sci in all).map((s) => [s.sci, all[s.sci]]));
      const full = JSON.parse(JSON.stringify({ clade, wiki })) as MammalData;
      const open = unpackMammals(JSON.parse(JSON.stringify(packMammals(full).open)) as MammalFile);
      open.clade.species = open.clade.species.map((s, i) => watch(s, CARD_KINDS, `species[${i}]`));
      for (const k of Object.keys(open.wiki)) open.wiki[k] = watch(open.wiki[k], WIKI_CARD_KINDS, 'wiki');
      return open;
    });
    // (Building the clade copies every field into its records, card kinds as absent: what is read after is what counts.)
    const c = mammaliaClade();
    c.species.forEach((s, i) => (c.species[i] = watch(s, CARD_KINDS, 'sp')));
    watching = true;
    const v = new FanView(stubCanvas() as unknown as HTMLCanvasElement, c, mammaliaTree(), true);
    (v as unknown as { gl: unknown }).gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
    v.draw();
    v.draw();
    const at = v as unknown as { cam: unknown; levelCamera(n: string, z?: number): unknown; speciesCamera(b: unknown): unknown };
    for (const name of ['Rodentia', 'Chiroptera', 'Carnivora', 'Felidae', 'Muridae', 'Primates', 'Hominidae', 'Cetacea']) {
      for (const z of [undefined, 3, 20]) {
        const cam = at.levelCamera(name, z);
        if (!cam) continue;
        at.cam = cam;
        v.draw();
      }
    }
    for (const sci of ['Panthera leo', 'Homo sapiens', 'Enhydra lutris', 'Canis lupus', 'Mus musculus']) {
      const b = v.fan.branches.find((x) => x.sp.sci === sci);
      if (!b) continue;
      at.cam = at.speciesCamera(b);
      v.draw();
      v.draw();
      // (A tap on its column finds the event it is on: the events' spans.)
      colEventsY(v.fan, b);
    }
    expect(searchSpecies(c.species, 'lion').length).toBeGreaterThan(0);
    watching = false;
    expect([...read].sort()).toEqual([]);
  }, 600000);
});
