import { describe, expect, it } from 'vitest';
import { aliveAt, laneAt, layoutFan, leftAt, strandAt } from './layout';
import { FELIDAE } from './panthera';
import { speciesModel, threadEnds, TwigModel, type TwigView } from './twigs';

const fanLin = layoutFan(FELIDAE, 'linear');
const fanLog = layoutFan(FELIDAE, 'log');
const lionIdx = FELIDAE.species.findIndex((s) => s.common === 'Lion');
const caveIdx = FELIDAE.species.findIndex((s) => s.common === 'Cave lion');
const lion = (f = fanLin) => new TwigModel(f.branches[lionIdx], f.time, f.mode);

describe('species model', () => {
  it('matches the data: total ever and alive at the end', () => {
    const rec = FELIDAE.species[lionIdx];
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
  it('branch width is the individuals alive then; the generations sum to the total ever', () => {
    const b = fanLin.branches[lionIdx];
    const rec = b.sp;
    // Linear widths: one world width per individual, the same for every species.
    for (const o of fanLin.branches) expect(o.unit).toBe(b.unit);
    for (const a of [0, 30e-6, 60e-6, 1e-3, 1]) expect(strandAt(b, a, 'linear').w / b.unit).toBeCloseTo(aliveAt(rec, a), 6);
    const m = lion();
    let sum = 0;
    for (let g = 0; g < m.G; g++) sum += m.size(g);
    expect(sum).toBe(m.T);
    // At the tip: the living.
    expect(strandAt(b, 0, 'linear').w / b.unit / rec.alive).toBeCloseTo(1, 2);
  });

  it('slots at a height = the individuals alive there; each generation folds onto them', () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      for (const g of [10, 5000, m.G - 60, m.G - 12, m.G - 1]) {
        const y = m.row(g).y;
        const n = m.size(g);
        const S = m.stride(g);
        // The stride is the alive at its births (world-fixed), about the slots drawn there.
        expect(S).toBe(Math.max(1, Math.round(m.b.pop.aliveAt(m.ageOf((g + 0.5) * m.GL)))));
        expect(m.totalSlots(y) / S).toBeGreaterThan(0.9);
        expect(m.totalSlots(y) / S).toBeLessThan(1.1);
        // About births ÷ alive (≈ 2: a life is half a generation) of g share a slot.
        expect(m.fold(g)).toBe(Math.ceil(n / S));
        expect(m.fold(g)).toBeLessThanOrEqual(3);
        // Every member is on one slot (K ≡ i mod S), and that slot holds it.
        for (const i of [0, 1, S - 1, S, n - 1]) {
          const K = m.slotOf(g, i, false, y)!;
          expect(K).not.toBeNull();
          expect(K % S).toBe(i % S);
          expect(m.slotIndividuals(K, g, y).map((s) => s.i)).toContain(i);
        }
      }
    }
  });

  it('the lanes partition the branch: green on the left, gray on the right, same as the fan', () => {
    for (const f of [fanLin, fanLog]) {
      const m = lion(f);
      const b = f.branches[lionIdx];
      for (const g of [0, 1234, m.G >> 1, m.G - 1]) {
        const y = m.row(g).y;
        const L = m.lanes(y);
        const st = laneAt(b, y);
        expect(L.w).toBeCloseTo(st.w, 12);
        expect(L.gw).toBeCloseTo(st.w * st.f, 12);
        expect(L.left).toBeCloseTo(leftAt(b, y), 12);
        // One lattice of slots, one individual wide, across the column: green lane first.
        const P = m.pitch(y);
        expect(m.slotX(0, y) - P / 2).toBeCloseTo(L.left, 12);
        expect(Math.abs(m.greenSlots(y) * P - L.gw)).toBeLessThanOrEqual(P);
        expect(m.totalSlots(y) * P).toBeCloseTo(L.w, 9);
        for (const K of [0, 777, Math.floor(m.totalSlots(y)) - 1]) expect(m.slotAt(m.slotX(K, y), y)).toBe(K);
        if (f === fanLin) expect(P).toBe(b.unit); // linear: the fan's width per individual, everywhere
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
          const st = laneAt(b, y);
          const gw = st.w * st.f;
          const left = leftAt(b, y);
          for (const i of [0, 1, 77, n >> 1, n - 2, n - 1]) {
            for (const alive of [false, true]) {
              const K = m.slotOf(g, i, alive, y);
              if (K === null) continue;
              const x = m.slotX(K, y);
              expect(x).toBeGreaterThanOrEqual(left);
              expect(x).toBeLessThanOrEqual(left + st.w);
              // The living are in the green lane.
              if (alive) expect(x).toBeLessThan(left + gw);
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
    const a = lion(layoutFan(FELIDAE, 'log'));
    const b = lion(layoutFan(FELIDAE, 'log'));
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
      // (A slot may hold two of a generation at once, where procgen's births outnumber the fan's N a little: either is it.)
      const h = a.hit(a.slotX(t.K, ym), ym, 1e-12)!;
      expect(h.g).toBe(g);
      const th = a.twig(h.g, h.i, t.K);
      expect(th.K).toBe(t.K);
      expect(th.yDeath <= ym && ym <= th.yBirth).toBe(true);
    }
  });

  it("a parent link ends at the twig of procgen's parents()", () => {
    const m = lion(fanLog);
    const g = m.G - 1;
    for (const i0 of [0, 5, 4000, 70000]) {
      const i = Math.min(i0, m.size(g) - 1);
      const ps = m.parents(g, i);
      expect(ps).toEqual(m.sp.parents({ generation: g, index: BigInt(i) }));
      expect(ps).toHaveLength(2);
      const child = m.twig(g, i);
      for (const p of ps) {
        expect(p.generation).toBe(g - 1);
        const pt = m.twig(p.generation, Number(p.index));
        // The link's parent end is on the parent's twig, at x(parent) and below the child's birth.
        expect(pt.x).toBe(m.slotX(pt.K, pt.yBirth));
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
        for (const i0 of [0, 17, 4000, 70000]) {
          const i = Math.min(i0, m.size(g) - 1);
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
            expect(px).toBe(m.slotX(pt.K, py));
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
        expect(m.livingSlot(m.slotAt(x!, y), y)).toBe(true);
        expect(m.nearestLiving(L.left + u * L.gw, y)).toBe(x); // deterministic
      }
    }
  });
});
