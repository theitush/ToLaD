import { describe, expect, it } from 'vitest';
import { layoutFan, remaining, strandAt } from './layout';
import { PANTHERA } from './panthera';
import { speciesModel, TwigModel } from './twigs';

const fanLin = layoutFan(PANTHERA, 'linear');
const fanLog = layoutFan(PANTHERA, 'log');
const lionIdx = PANTHERA.species.findIndex((s) => s.common === 'Lion');
const caveIdx = PANTHERA.species.findIndex((s) => s.common === 'Cave lion');
const lion = (f = fanLin) => new TwigModel(f.branches[lionIdx], f.time, f.mode);

describe('species model', () => {
  it('matches the data: total ever and alive at the end', () => {
    const rec = PANTHERA.species[lionIdx];
    const sp = speciesModel(rec);
    expect(Number(sp.totalEver) / rec.ever).toBeCloseTo(1, 4);
    const m = lion();
    let alive = 0;
    for (let g = m.aliveFrom; g < m.G; g++) {
      const n = m.size(g);
      const step = Math.max(1, Math.floor(n / 4000));
      let a = 0;
      let c = 0;
      for (let i = 0; i < n; i += step, c++) if (m.alive(g, i)) a++;
      alive += (a / c) * n;
    }
    expect(alive / rec.alive).toBeGreaterThan(0.9);
    expect(alive / rec.alive).toBeLessThan(1.1);
  });

  it('extinct species have nobody alive', () => {
    const m = new TwigModel(fanLin.branches[caveIdx], fanLin.time, 'linear');
    expect(m.aliveFrom).toBe(m.G);
    for (let i = 0; i < 200; i++) expect(m.twig(m.G - 1, i).alive).toBe(false);
  });
});

describe('width = individuals', () => {
  it('branch width at the base is individuals ever; the generations sum to it', () => {
    const b = fanLin.branches[lionIdx];
    const rec = b.sp;
    expect(strandAt(b, rec.t0, 'linear').w).toBeCloseTo(b.width, 12);
    // Linear widths: individuals per world unit is the same for every species.
    const perUnit = rec.ever / b.width;
    for (const o of fanLin.branches) expect(o.sp.ever / o.width).toBeCloseTo(perUnit, -3);
    const m = lion();
    let sum = 0;
    for (let g = 0; g < m.G; g++) sum += m.size(g);
    expect(sum).toBe(m.T);
    // At the tip only the living remain: the width there is the alive count.
    expect(remaining(rec, 0)).toBe(rec.alive);
    expect(strandAt(b, 0, 'linear').w * perUnit).toBeCloseTo(rec.alive, 0);
  });

  it("a generation's individuals partition the branch width at their height", () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      for (const g of [0, 1234, m.G >> 1, m.G - 1]) {
        const r = m.row(g);
        const xs0 = r.left + (0 * r.w) / r.n;
        const xsN = r.left + (r.n * r.w) / r.n;
        expect(xsN - xs0).toBeCloseTo(r.w, 12);
        expect(m.indexRange(g, r.left - 1, r.left + r.w + 1)).toEqual([0, r.n]);
        const x = m.x(g, 777);
        const [i0, i1] = m.indexRange(g, x - 1e-12, x + 1e-12);
        expect(i0).toBeLessThanOrEqual(777);
        expect(i1).toBeGreaterThan(777);
      }
    }
  });

  it('generationAt inverts the birth heights', () => {
    const m = lion(fanLog);
    for (const g of [0, 5, 4321, m.G - 3, m.G - 1]) expect(m.generationAt(m.row(g).y)).toBe(g);
  });
});

describe('determinism and links', () => {
  it('the same individual is at the same place with the same handle every time', () => {
    const a = lion(layoutFan(PANTHERA, 'log'));
    const b = lion(layoutFan(PANTHERA, 'log'));
    for (const [g, i] of [
      [0, 0],
      [1000, 17],
      [a.G - 1, 31337],
    ]) {
      expect(a.twig(g, i)).toEqual(b.twig(g, i));
      const ad = { generation: g, index: BigInt(i) };
      expect(a.sp.handle(ad)).toBe(b.sp.handle(ad));
      const t = a.twig(g, i);
      expect(a.hit(t.x, (t.yBirth + t.yDeath) / 2, 1e-9)).toEqual({ g, i });
    }
  });

  it("a parent link ends at the twig of procgen's parents()", () => {
    const m = lion(fanLog);
    const g = m.G - 1;
    for (const i of [0, 5, 4000, 70000]) {
      const ps = m.parents(g, i);
      expect(ps).toEqual(m.sp.parents({ generation: g, index: BigInt(i) }));
      expect(ps).toHaveLength(2);
      const child = m.twig(g, i);
      for (const p of ps) {
        expect(p.generation).toBe(g - 1);
        const pt = m.twig(p.generation, Number(p.index));
        // The link's parent end is on the parent's twig, at x(parent) and below the child's birth.
        expect(pt.x).toBe(m.x(p.generation, Number(p.index)));
        expect(pt.yBirth).toBeGreaterThan(child.yBirth);
        const ch = m.sp.children(p);
        expect(BigInt(i) >= ch.start && BigInt(i) < ch.start + ch.count).toBe(true);
      }
    }
  });
});
