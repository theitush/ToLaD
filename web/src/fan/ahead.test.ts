// What the build works out ahead for the mammal level (mammals-seed.ts, ToLaD#255) is what the page would work out
// itself: the genealogies, packed as mammals.json carries them and read back, sample for sample.
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { f64FromBase64, f64ToBase64, packColumns, packGenealogies, packTree, uintsFromBase64, uintsToBase64, unpackColumns, unpackGenealogies, unpackTree } from './packed';
import { mammaliaClade } from './panthera';
import { genealogiesOf, population } from './population';
import { mammalData, packMammals, unpackMammals } from './mammals-data';
import { mammaliaTree, nameOrders, treeOf } from './splits';

describe('packed numbers', () => {
  it('float64s and whole numbers come back bit for bit', () => {
    const f = [0, -0, 1, Math.PI, 1e-300, 4345102241715.732, Number.MAX_VALUE, -1.5e-7];
    expect(Object.is(f64FromBase64(f64ToBase64(f))[1], -0)).toBe(true);
    expect([...f64FromBase64(f64ToBase64(f))]).toEqual(f);
    const u = [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 40 + 3, Number.MAX_SAFE_INTEGER];
    expect(uintsFromBase64(uintsToBase64(u))).toEqual(u);
    expect(() => uintsToBase64([1.5])).toThrow();
  });

  it('columns carry what JSON carries, value for value', () => {
    const rows = [
      { a: 1, b: 'x', c: { p: [1, 2.5], q: null }, d: true, e: [{ z: 1 }, { z: 2, y: 'k' }] },
      { b: 'x', a: 2.25, c: null, d: false, e: [], f: [1, 'mixed'] },
      { a: 0, b: 'y', c: { p: [], q: 'r' }, d: true, e: [{ z: -0.5 }] },
    ];
    const back = unpackColumns(JSON.parse(JSON.stringify(packColumns(rows))), rows.length);
    expect(back).toStrictEqual(rows);
    expect(unpackColumns(packColumns([]), 0)).toEqual([]);
  });
});

describe('the mammal level worked out ahead', () => {
  beforeAll(async () => {
    await loadMammalsFromFiles();
  }, 120000);

  it('the dated tree, packed and read back, is the one built from the data', () => {
    const t = mammaliaTree();
    const back = unpackTree(JSON.parse(JSON.stringify(packTree(t))));
    expect(back).toStrictEqual(t);
    expect(back).toStrictEqual(nameOrders(treeOf(mammalData().clade)));
  });

  it('mammals.json in columns unpacks to the data it packs', () => {
    const d = JSON.parse(JSON.stringify({ ...mammalData(), wiki: { 'Panthera leo': { wp: 'Lion', img: 'x.jpg' }, 'Felis catus': null } }));
    const text = JSON.stringify(packMammals(d));
    const t0 = performance.now();
    const back = unpackMammals(JSON.parse(text));
    const ms = performance.now() - t0;
    expect(back).toStrictEqual(d);
    const plain = JSON.stringify(d);
    const t1 = performance.now();
    JSON.parse(plain);
    console.log(`mammals.json: ${(plain.length / 1e6).toFixed(2)} MB -> ${(text.length / 1e6).toFixed(2)} MB packed; parse ${(performance.now() - t1).toFixed(0)} ms -> parse+unpack ${ms.toFixed(0)} ms`);
  });

  it('every strand genealogy, packed and read back, is the walked one sample for sample', () => {
    const fan = layoutFan(mammaliaClade(), 'linear', mammaliaTree(), 'curved');
    const live = genealogiesOf(fan.branches.map((b) => population(b.sp, b.t0)));
    expect(live.size).toBeGreaterThan(5000);
    const back = unpackGenealogies(JSON.parse(JSON.stringify(packGenealogies(live))));
    expect([...back.keys()]).toEqual([...live.keys()]);
    let samples = 0;
    for (const [key, g] of live) {
      const b = back.get(key)!;
      expect(b.k.length).toBe(g.k.length);
      for (let i = 0; i < g.k.length; i++) {
        if (b.k[i] !== g.k[i] || !Object.is(b.h[i], g.h[i])) throw new Error(`${key} sample ${i}: ${b.k[i]} ${b.h[i]} vs ${g.k[i]} ${g.h[i]}`);
      }
      samples += g.k.length;
    }
    expect(samples).toBeGreaterThan(live.size);
  }, 300000);
});
