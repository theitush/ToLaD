// What the build works out ahead for the mammal level (mammals-seed.ts, ToLaD#255) is what the page would work out
// itself: the genealogies, packed as mammals.json carries them and read back, sample for sample.
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { f64FromBase64, f64PlanesFromBase64, f64PlanesToBase64, f64ToBase64, packColumns, packGenealogies, packTree, uintsFromBase64, uintsToBase64, unpackColumns, unpackGenealogies, unpackTree } from './packed';
import { mammaliaClade } from './panthera';
import { genealogiesOf, population } from './population';
import { CARD_KINDS, mammalData, mergeKinds, mergeMammalCard, packMammals, splitKinds, unpackMammals, type MammalCardFile, type MammalFile } from './mammals-data';
import { mammaliaTree, nameOrders, treeOf } from './splits';

describe('packed numbers', () => {
  it('float64s and whole numbers come back bit for bit', () => {
    const f = [0, -0, 1, Math.PI, 1e-300, 4345102241715.732, Number.MAX_VALUE, -1.5e-7];
    expect(Object.is(f64FromBase64(f64ToBase64(f))[1], -0)).toBe(true);
    expect([...f64FromBase64(f64ToBase64(f))]).toEqual(f);
    expect([...f64PlanesFromBase64(f64PlanesToBase64(f))]).toEqual(f);
    expect(Object.is(f64PlanesFromBase64(f64PlanesToBase64(f))[1], -0)).toBe(true);
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
    // (Floats as short decimals where they are short, else float64 planes; -0 and the non-finite only in planes, ToLaD#502.)
    for (const [tag, f] of [['d', [0.5, 7.25, 1e-7]], ['p', [Math.PI, 4345102241715.732, -1.5e-7]], ['p', [1.5, -0]], ['p', [2.5, Infinity, NaN]]] as const) {
      const c = JSON.parse(JSON.stringify(packColumns([...f])));
      expect(Object.keys(c)).toEqual([tag]);
      expect(unpackColumns(c, f.length)).toStrictEqual(f);
    }
  });

  it("a record's kinds split for the card and merged back are the record (ToLaD#502)", () => {
    const rows = [
      { a: 1, everLo: 2, history: { use: 'counts', notes: 'n', points: [{ year: 1, n: 2, cite: 'c' }, { year: 2, n: 3 }], events: [] }, redList: null, x: 'new' },
      { a: 2, everLo: 3, history: null, natural: { n: 1 } },
      { a: 3, redList: { category: 'LC' } },
    ];
    const parts = rows.map((r) => splitKinds(r, CARD_KINDS));
    const open = JSON.parse(JSON.stringify(parts.map((x) => x[0])));
    expect(JSON.stringify(open)).not.toMatch(/everLo|notes|cite|redList|natural/);
    // (A field the kinds do not name, `x`, stays with the open: new data opens the tree as it did.)
    expect(open[0].x).toBe('new');
    parts.forEach((x, i) => mergeKinds(open[i], JSON.parse(JSON.stringify(x[1] ?? {}))));
    expect(open).toStrictEqual(rows);
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

  it('mammals.json and mammals-card.json in columns unpack to the data they pack', () => {
    const d = JSON.parse(JSON.stringify({ ...mammalData(), wiki: { 'Panthera leo': { wp: 'Lion', img: 'x.jpg' }, 'Felis catus': null, 'Not a species': { img: 'y.jpg' } }, seed: { flips: [1, 4], node: [Math.PI, -0.5], leaf: [1e-9], ord: [0.25] } }));
    const files = packMammals(d);
    const text = JSON.stringify(files.open);
    const t0 = performance.now();
    const back = unpackMammals(JSON.parse(text) as MammalFile);
    const ms = performance.now() - t0;
    // (The open's file: no card kinds; the pictures, not their links.)
    expect(back.wiki['Panthera leo']).toStrictEqual({ img: 'x.jpg' });
    expect(back.clade.species.some((s) => 'redList' in s || 'everLo' in s)).toBe(false);
    mergeMammalCard(back, JSON.parse(JSON.stringify(files.card)) as MammalCardFile);
    expect(back).toStrictEqual(d);
    const plain = JSON.stringify(d);
    const t1 = performance.now();
    JSON.parse(plain);
    console.log(`mammals.json: ${(plain.length / 1e6).toFixed(2)} MB -> ${(text.length / 1e6).toFixed(2)} MB packed; parse ${(performance.now() - t1).toFixed(0)} ms -> parse+unpack ${ms.toFixed(0)} ms`);
  });

  it('every strand genealogy, packed and read back, is the walked one sample for sample', () => {
    const fan = layoutFan(mammaliaClade(), 'linear', mammaliaTree());
    const live = genealogiesOf(fan.branches.map((b) => population(b.sp, b.t0)));
    expect(live.size).toBeGreaterThan(5000);
    const back = unpackGenealogies(JSON.parse(JSON.stringify(packGenealogies(live))));
    expect([...back.keys()]).toEqual([...live.keys()]);
    let samples = 0;
    for (const [key, g] of live) {
      const b = back.get(key)!;
      expect(b.k.length).toBe(g.k.length);
      for (let i = 0; i < g.k.length; i++) {
        if (b.k[i] !== g.k[i] || !Object.is(b.h![i], g.h[i])) throw new Error(`${key} sample ${i}: ${b.k[i]} ${b.h![i]} vs ${g.k[i]} ${g.h[i]}`);
      }
      samples += g.k.length;
    }
    expect(samples).toBeGreaterThan(live.size);
  }, 300000);

  it('every strand genealogy replays its shares from its generations alone, number for number (ToLaD#502)', () => {
    const fan = layoutFan(mammaliaClade(), 'linear', mammaliaTree());
    const pops = fan.branches.map((b) => population(b.sp, b.t0));
    expect(pops.filter((p) => !p.replays()).map((p) => p.sp.sci)).toEqual([]);
    const lean = unpackGenealogies(JSON.parse(JSON.stringify(packGenealogies(genealogiesOf(pops), { shares: false }))));
    expect([...lean.values()].every((g) => g.h === undefined)).toBe(true);
  }, 300000);
});
