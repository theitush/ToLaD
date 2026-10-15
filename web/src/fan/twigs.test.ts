import { describe, expect, it } from 'vitest';
import { aliveAt, laneAt, layoutFan, leftAt, strandAt } from './layout';
import { FELIDAE } from './panthera';
import { speciesModel, TwigModel } from './twigs';

const fanLin = layoutFan(FELIDAE, 'linear');
const fanLog = layoutFan(FELIDAE, 'log');
const lionIdx = FELIDAE.species.findIndex((s) => s.common === 'Lion');
const caveIdx = FELIDAE.species.findIndex((s) => s.common === 'Cave lion');
const lion = (f = fanLin) => new TwigModel(f.branches[lionIdx], f.time, f.mode);

describe('species model', () => {
  it('matches the data: total ever, clipped at its split', () => {
    const rec = FELIDAE.species[lionIdx];
    expect(Number(speciesModel(rec).totalEver) / rec.ever).toBeCloseTo(1, 4);
    // In the fan, clipped at its split (0.5 Ma; its genomic deep past runs on to its first appearance,
    // 3.76 Ma, ToLaD#60): the births since then, the rest being the parent column's.
    const m = lion();
    const split = fanLin.branches[lionIdx].t0;
    expect(split).toBeLessThan(rec.t0 * 0.5);
    expect(m.T / rec.births!.curve.bornAfter(split * 1e6)).toBeCloseTo(1, 3);
    expect(m.origin).toBeCloseTo(split, 3);
  });

  it('extinct species have nobody alive', () => {
    const m = new TwigModel(fanLin.branches[caveIdx], fanLin.time, 'linear');
    expect(m.aliveFrom).toBe(m.G);
  });
});

describe('width = individuals', () => {
  it('branch width is the individuals alive then; the generations sum to the total ever', () => {
    const b = fanLin.branches[lionIdx];
    const rec = b.sp;
    // Linear widths: one world width per individual, the same for every species.
    for (const o of fanLin.branches) expect(o.unit).toBe(b.unit);
    // Its own column (the lion splits from the cave lion 0.5 Ma; its genomic deep past runs on below, ToLaD#60/#66) ...
    for (const a of [0, 30e-6, 60e-6, 1e-3, 0.3]) expect(strandAt(b, a, 'linear').w / b.unit).toBeCloseTo(aliveAt(rec, a), 6);
    // ... and below its split its founders, held.
    for (const a of [b.t0, 1]) expect(strandAt(b, a, 'linear').w / b.unit).toBeCloseTo(b.pop.founders, 6);
    const m = lion();
    let sum = 0;
    for (let g = 0; g < m.G; g++) sum += m.size(g);
    expect(sum).toBe(m.T);
    // At the tip: the living.
    expect(strandAt(b, 0, 'linear').w / b.unit / rec.alive).toBeCloseTo(1, 2);
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
      }
    }
  });
});
