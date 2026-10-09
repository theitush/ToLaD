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
