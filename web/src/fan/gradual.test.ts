import { describe, expect, it } from 'vitest';
import { bridgeKeep, bridgeReach, shadeBridge, type BridgeInst } from './bridge';
import { pairSchedule, sisterPairs, SPLIT_STYLES } from './gradual';
import { leftAt, laneAt, layoutFan } from './layout';
import { FELIDAE } from './panthera';

describe('gradual speciation (ToLaD#50)', () => {
  for (const edge of ['curved', 'straight'] as const) {
    const fan = layoutFan(FELIDAE, 'linear', undefined, edge);
    it(`${edge}: one boundary per split between neighbouring strands, touching in the parent column`, () => {
      const pairs = sisterPairs(fan);
      expect(pairs.length).toBe(fan.branches.length - 1);
      for (const p of pairs) {
        const s = p.node.strands;
        expect(s.indexOf(p.b)).toBe(s.indexOf(p.a) + 1);
        // Just below the split the two strands tile the column: no gap, no overlap.
        const y = p.node.y + 1e-6;
        expect(Math.abs(leftAt(p.a, y) + laneAt(p.a, y).w - leftAt(p.b, y))).toBeLessThan(1e-6 * Math.max(1, Math.abs(leftAt(p.b, y))));
        expect(p.span).toBeGreaterThan(0);
      }
    });
  }

  it('the windows are world-fixed and in order: keep falls to its floor, reach to nothing, no links above the top', () => {
    const fan = layoutFan(FELIDAE, 'linear');
    for (const p of sisterPairs(fan)) {
      for (const style of SPLIT_STYLES) {
        for (const win of ['short', 'long'] as const) {
          const s = pairSchedule(p, style, win);
          expect(s.yK1).toBeLessThanOrEqual(s.yK0);
          expect(s.yH1).toBeLessThanOrEqual(s.yH0);
          expect(s.yTop).toBeLessThanOrEqual(s.yK1 + 1e-9);
          if (style === 'clean') expect(s.J).toBe(0);
          else expect(s.yTop).toBeLessThanOrEqual(p.node.y);
        }
        if (style !== 'clean') expect(pairSchedule(p, style, 'long').yTop).toBeLessThanOrEqual(pairSchedule(p, style, 'short').yTop);
      }
    }
  });

  const base: BridgeInst = {
    x0: 0, y0: 0, x1: 200, y1: 400, xa: 90, xb: 110, sa: 0, sb: 0, wa: 40, wb: 40, lw: 0.9, alpha: 1, p0: 0, T0: 4000, A: 1e9, GL: 10,
    k0: 100, k1: 300, amp: 1, hIn: 0, h0: 0, h1: 0, rmax: 0, cL: 2, cR: 1, P: 0x1234567, gA: 5_000_000, J: 1,
  };

  it('keep falls monotonically from 1 to amp·0 across [k0, k1]; reach likewise', () => {
    let prev = 2;
    for (let g = 0; g < 400; g += 7) {
      const k = bridgeKeep(base, g);
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
    expect(bridgeKeep(base, 50)).toBe(1);
    expect(bridgeKeep(base, 350)).toBe(0);
    const h = { ...base, rmax: 1, hIn: 0, h0: 10, h1: 20 };
    expect(bridgeReach(h, -1)).toBe(0);
    expect(bridgeReach(h, 10)).toBe(1);
    expect(bridgeReach(h, 25)).toBe(0);
  });

  it('links thin out over the window: lit pixels between the edges fall from below the window to above it', () => {
    // Years per px: 1 generation ≈ 1 px tall (time level ~2.6), the window spanning the rows.
    const kLog = 10 / (1e9 * Math.LN2);
    const pal: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const lit = (r0: number, r1: number, m: BridgeInst) => {
      let n = 0;
      for (let y = r0; y < r1; y++) if (shadeBridge(m, 100.5, y + 0.5, kLog, pal)[3] > 0.1) n++;
      return n;
    };
    // Rows: time 4000 years at the top, decreasing 10 years a row: generation 400 at row 0, 0 at row 400.
    const old = lit(330, 400, base);
    const young = lit(0, 70, base);
    expect(old).toBeGreaterThan(3);
    expect(young).toBe(0);
    expect(lit(0, 400, { ...base, J: 0 })).toBe(0);
  });
});
