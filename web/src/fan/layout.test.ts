import { describe, expect, it } from 'vitest';
import { layoutFan, strandAt, type WidthMode } from './layout';
import { PANTHERA } from './panthera';

describe('fan strands', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`green width is constant along a strand (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const sp = b.sp;
        const mid = Array.from({ length: 9 }, (_, i) => sp.t1 + ((sp.t0 - sp.t1) * (i + 1)) / 10);
        const ages = [sp.t0 * 2, sp.t0, ...mid, sp.t1];
        const greens = ages.map((a) => {
          const s = strandAt(b, a, mode);
          return s.w * s.f;
        });
        if (sp.alive > 0) {
          for (const gw of greens) expect(gw / greens[0]).toBeCloseTo(1, 9);
          // At the tip only the living remain: all green.
          expect(strandAt(b, sp.t1, mode).f).toBeCloseTo(1, 9);
        } else {
          for (const gw of greens) expect(gw).toBe(0);
        }
        // The base is the branch's full width.
        expect(strandAt(b, sp.t0, mode).w).toBeCloseTo(b.width, 9);
      }
    });
  }
});

describe('fan packing', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`columns are packed by width, never overlapping, with small gaps (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const bs = fan.branches;
      let total = 0;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        total += a.width;
        if (i + 1 === bs.length) break;
        const b = bs[i + 1];
        const gap = b.colX - b.width / 2 - (a.colX + a.width / 2);
        total += gap;
        expect(gap).toBeGreaterThan(0);
        // No gap is bigger than twice the two neighbours' widths (thin sisters get a few px).
        expect(gap).toBeLessThan(2 * (a.width + b.width));
      }
      // The columns span little more than the stem they grow from: a fan, not scattered threads.
      expect(total).toBeLessThan(1.5 * fan.trunkWidth);
    });
  }
});
