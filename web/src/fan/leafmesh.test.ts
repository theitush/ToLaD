import { describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { LeafMesh, LeafShape, speciesModel } from './leafmesh';
import { PANTHERA } from './panthera';

const lionRec = PANTHERA.species.find((s) => s.common === 'Lion')!;
const caveRec = PANTHERA.species.find((s) => s.common === 'Cave lion')!;

describe('leaf shape', () => {
  it('area inverts exactly', () => {
    const sh = LeafShape.ofArea(1234);
    expect(sh.total).toBeCloseTo(1234, 9);
    for (const u of [0, 1e-9, 0.001, 0.25, 0.5, 0.9, 0.999999, 1]) {
      const y = sh.yOfArea(u * sh.total);
      expect(sh.area(y) / sh.total).toBeCloseTo(u, 12);
    }
  });
});

describe('species model', () => {
  it('matches the data: total ever and alive at the end', () => {
    const sp = speciesModel(lionRec);
    expect(Number(sp.totalEver) / lionRec.ever).toBeCloseTo(1, 4);
    // Expected alive = Σ over the last generations of N·P(alive); sample the last rows.
    const m = new LeafMesh(lionRec, LeafShape.ofArea(1000));
    let alive = 0;
    for (let g = m.aliveFrom; g < m.G; g++) {
      const n = m.size(g);
      const step = Math.max(1, Math.floor(n / 4000));
      let a = 0;
      let c = 0;
      for (let i = 0; i < n; i += step, c++) if (m.alive(g, i)) a++;
      alive += (a / c) * n;
    }
    expect(alive / lionRec.alive).toBeGreaterThan(0.9);
    expect(alive / lionRec.alive).toBeLessThan(1.1);
  });

  it('extinct species have nobody alive', () => {
    const m = new LeafMesh(caveRec, LeafShape.ofArea(1000));
    expect(m.aliveFrom).toBe(m.G);
    const g = m.G - 1;
    for (let i = 0; i < 200; i++) expect(m.sp.attributes({ generation: g, index: BigInt(i) }).alive).toBe(false);
  });
});

describe('visible rows and index ranges', () => {
  const shape = LeafShape.ofArea(2000);
  const m = new LeafMesh(lionRec, shape);

  it('row areas sum to the leaf: rows partition [0, L] in order of C(g)/T', () => {
    expect(m.rowStart(0)).toBe(0);
    expect(m.rowStart(m.G)).toBeCloseTo(shape.L, 12);
    // Sampled rows: area of row g = N(g)/T of the leaf, and rows are contiguous.
    let sum = 0;
    const gs = [0, 1, 2, 1000, 99999, m.G >> 1, m.G - 2, m.G - 1];
    for (const g of gs) {
      const a = shape.area(m.rowStart(g + 1)) - shape.area(m.rowStart(g));
      expect(a / shape.total).toBeCloseTo(m.size(g) / m.T, 14);
      sum += a;
    }
    expect(sum).toBeGreaterThan(0);
    // All rows: summing every row's area telescopes to the whole leaf.
    let total = 0;
    let prev = 0;
    for (let g = 0; g < m.G; g += 997) {
      const y = m.rowStart(g);
      expect(y).toBeGreaterThanOrEqual(prev);
      total += shape.area(y) - shape.area(prev);
      prev = y;
    }
    total += shape.total - shape.area(prev);
    expect(total / shape.total).toBeCloseTo(1, 12);
  });

  it('generationAt agrees with rowStart, even deep in the tip', () => {
    for (const g of [0, 5, 4321, m.G - 3, m.G - 1]) {
      const y0 = m.rowStart(g);
      const y1 = m.rowStart(g + 1);
      expect(m.generationAt((y0 + y1) / 2)).toBe(g);
      expect(m.generationAt(y0 + (y1 - y0) * 1e-3)).toBe(g);
    }
  });

  it('indexRange covers exactly the cells under an x interval', () => {
    const g = m.G - 1;
    const n = m.size(g);
    expect(m.indexRange(g, -shape.W, shape.W)).toEqual([0, n]);
    const p = m.position(g, 1234);
    const [i0, i1] = m.indexRange(g, p.x - 1e-12, p.x + 1e-12);
    expect(i0).toBeLessThanOrEqual(1234);
    expect(i1).toBeGreaterThan(1234);
    expect(i1 - i0).toBeLessThanOrEqual(2);
  });
});

describe('determinism and links', () => {
  it('the same individual is at the same place with the same handle every time', () => {
    const a = new LeafMesh(lionRec, LeafShape.ofArea(2000));
    const b = new LeafMesh(lionRec, LeafShape.ofArea(2000));
    for (const [g, i] of [
      [0, 0],
      [1000, 17],
      [a.G - 1, 31337],
    ]) {
      expect(a.position(g, i)).toEqual(b.position(g, i));
      const ad = { generation: g, index: BigInt(i) };
      expect(a.sp.handle(ad)).toBe(b.sp.handle(ad));
      expect(a.hit(a.position(g, i))).toEqual(ad);
    }
    // And the fan places the leaf identically.
    const f1 = layoutFan(PANTHERA, 'log').branches[3];
    const f2 = layoutFan(PANTHERA, 'log').branches[3];
    expect(f1.base).toEqual(f2.base);
    expect(f1.shape.W).toBe(f2.shape.W);
  });

  it("a parent link ends at the position of procgen's parents()", () => {
    const m = new LeafMesh(lionRec, LeafShape.ofArea(2000));
    const g = m.G - 1;
    for (const i of [0, 5, 4000, 70000]) {
      const ps = m.parents(g, i);
      const direct = m.sp.parents({ generation: g, index: BigInt(i) });
      expect(ps).toEqual(direct);
      expect(ps).toHaveLength(2);
      for (const p of ps) {
        expect(p.generation).toBe(g - 1);
        const end = m.position(p.generation, Number(p.index));
        // The endpoint is inside the parent's cell (hit-test round trip) and in the row below.
        expect(m.hit(end)).toEqual(p);
        expect(end.y).toBeLessThan(m.position(g, i).y);
        // Children of the parent include this individual.
        const ch = m.sp.children(p);
        expect(BigInt(i) >= ch.start && BigInt(i) < ch.start + ch.count).toBe(true);
      }
    }
  });
});
