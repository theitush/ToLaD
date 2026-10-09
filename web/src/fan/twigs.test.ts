import { describe, expect, it } from 'vitest';
import { branchLeft, layoutFan, remaining, strandAt } from './layout';
import { PANTHERA } from './panthera';
import { speciesModel, threadEnds, TwigModel, type TwigView } from './twigs';

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

  it('the lanes partition the branch: green on the left, gray on the right, same as the fan', () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      const b = f.branches[lionIdx];
      for (const g of [0, 1234, m.G >> 1, m.G - 1]) {
        const y = m.row(g).y;
        const L = m.lanes(y);
        const st = strandAt(b, f.time.ageAt(y), f.mode);
        expect(L.w).toBeCloseTo(st.w, 12);
        expect(L.gw).toBeCloseTo(st.w * st.f, 12);
        expect(L.left).toBeCloseTo(branchLeft(b), 12);
        for (const alive of [false, true]) {
          const lo = alive ? L.left : L.left + L.gw;
          const hi = alive ? L.left + L.gw : L.left + L.w;
          expect(m.indexRange(g, lo - 1, hi + 1, y, alive)).toEqual([0, m.size(g)]);
          const x = m.xAt(m.u(g, 777), y, alive);
          const [i0, i1] = m.indexRange(g, x - 1e-15, x + 1e-15, y, alive);
          expect(i0).toBeLessThanOrEqual(777);
          expect(i1).toBeGreaterThan(777);
        }
      }
    }
  });

  it('the strands stay exactly inside the branch silhouette at every height', () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      const b = f.branches[lionIdx];
      for (const g of [0, 999, m.G >> 1, m.G - 40, m.G - 1]) {
        const n = m.size(g);
        // Heights from the birth row up to "now".
        for (const y of [m.row(g).y, m.yOf(Math.min(m.T, (g + 2) * m.GL)), m.yOf((g + 0.9) * m.GL), f.time.y(0)]) {
          const st = strandAt(b, f.time.ageAt(y), f.mode);
          const gw = st.w * st.f;
          const left = branchLeft(b);
          // The union of the slots' cells is exactly the branch: green lane, then gray lane.
          expect(m.xAt(m.u(g, 0), y, true) - gw / n / 2).toBeCloseTo(left, 9);
          expect(m.xAt(m.u(g, n - 1), y, true) + gw / n / 2).toBeCloseTo(left + gw, 9);
          expect(m.xAt(m.u(g, 0), y, false) - (st.w - gw) / n / 2).toBeCloseTo(left + gw, 9);
          expect(m.xAt(m.u(g, n - 1), y, false) + (st.w - gw) / n / 2).toBeCloseTo(left + st.w, 9);
          for (const i of [1, 77, n >> 1, n - 2]) {
            for (const alive of [false, true]) {
              const x = m.xAt(m.u(g, i), y, alive);
              expect(x).toBeGreaterThanOrEqual(left);
              expect(x).toBeLessThanOrEqual(left + st.w);
            }
          }
        }
      }
    }
  });

  it('a dead individual with a living descendant is green; a line that ended is gray', () => {
    const m = lion(fanLin);
    const g = m.aliveFrom - 3;
    let greenDead: number | null = null;
    let deadEnd: number | null = null;
    for (let i = 0; i < 3000 && (greenDead === null || deadEnd === null); i++) {
      if (m.alive(g, i)) continue;
      const has = m.hasLivingDescendant(g, i, 1e6);
      if (has && greenDead === null) greenDead = i;
      if (!has && deadEnd === null) deadEnd = i;
    }
    expect(greenDead).not.toBeNull();
    expect(deadEnd).not.toBeNull();
    // Check both against a brute-force walk of procgen's children down the mother line.
    const brute = (gg: number, ii: bigint, first: boolean): boolean => {
      const a = { generation: gg, index: ii };
      if (!first && m.sp.attributes(a).alive) return true;
      if (!first && m.sp.sexOf(a) !== 'female') return false;
      const ch = m.sp.children(a);
      for (let c = ch.start; c < ch.start + ch.count; c++) if (brute(ch.generation, c, false)) return true;
      return false;
    };
    expect(brute(g, BigInt(greenDead!), true)).toBe(true);
    expect(brute(g, BigInt(deadEnd!), true)).toBe(false);
    // The answer is the same however it is asked (cached or not, any model instance).
    expect(lion(fanLin).hasLivingDescendant(g, greenDead!)).toBe(true);
    expect(lion(fanLog).hasLivingDescendant(g, deadEnd!)).toBe(false);
  });

  it('the far-past shortcut is deterministic', () => {
    const a = lion(fanLin);
    const b = lion(fanLog);
    for (const i of [3, 4000, 50000]) expect(a.hasLivingDescendant(1000, i, 50)).toBe(b.hasLivingDescendant(1000, i, 50));
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
      const ym = (t.yBirth + t.yDeath) / 2;
      expect(a.hit(a.xAt(t.u, ym, t.alive), ym, 1e-9)).toEqual({ g, i });
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
        expect(pt.x).toBe(m.xAt(m.u(p.generation, Number(p.index)), pt.yBirth, pt.alive));
        expect(pt.yBirth).toBeGreaterThan(child.yBirth);
        const ch = m.sp.children(p);
        expect(BigInt(i) >= ch.start && BigInt(i) < ch.start + ch.count).toBe(true);
      }
    }
  });

  it("every parent thread (mother's line and father's mesh) ends on procgen's parents()", () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      // World coordinates as "screen": the thread ends are then world points.
      const v = { sx: 1, sy: 1, yNow: f.time.y(0), toScreen: (x: number, y: number) => [x, y] } as unknown as TwigView;
      for (const g of [1, 1000, m.G - 300, m.G - 1]) {
        const genH = m.row(g - 1).y - m.row(g).y;
        for (const i of [0, 17, 4000, 70000]) {
          const child = m.twig(g, i);
          const ps = m.parents(g, i);
          expect(ps).toEqual(m.sp.parents({ generation: g, index: BigInt(i) }));
          for (const p of ps) {
            const pt = m.twig(p.generation, Number(p.index));
            const [px, py, cy] = threadEnds(v, m, pt, child, genH);
            // Child end: the child's own birth. Parent end: on the parent's strand,
            // within the parent's life, no later than the child's birth.
            expect(cy).toBe(child.yBirth);
            expect(py).toBeLessThanOrEqual(pt.yBirth);
            expect(py).toBeGreaterThanOrEqual(Math.min(pt.yBirth, pt.yDeath));
            expect(py).toBeGreaterThanOrEqual(child.yBirth);
            expect(px).toBe(m.xAt(pt.u, py, pt.alive));
          }
        }
      }
    }
  });

  it('a double-tap in the green lane lands on a living strand', () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      const y = m.row(m.G - 50).y;
      const L = m.lanes(y);
      for (const u of [0.1, 0.5, 0.9]) {
        const x = m.nearestLiving(L.left + u * L.gw, y);
        expect(x).not.toBeNull();
        const i = Math.floor(((x! - L.left) / L.gw) * m.size(m.G - 1));
        expect(m.livingSlot(i)).toBe(true);
        expect(m.nearestLiving(L.left + u * L.gw, y)).toBe(x); // deterministic
      }
    }
  });
});
