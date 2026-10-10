import { describe, expect, it } from 'vitest';
import { CLOSE_MAX_PX, GAP_PX, OPEN_PX, layoutFan, leftAt, strandAt, type WidthMode } from './layout';
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
  /** Adjacent visible siblings' gaps (world) and the drawn widths at height y. */
  const gapsAt = (fan: ReturnType<typeof layoutFan>, y: number) => {
    const vis = fan.branches.filter((b) => y >= b.tipY);
    const out: number[] = [];
    for (let i = 0; i + 1 < vis.length; i++) {
      const a = vis[i];
      const b = vis[i + 1];
      out.push(leftAt(b, y) - (leftAt(a, y) + strandAt(a, fan.time.ageAt(y), fan.mode).w));
    }
    return out;
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`siblings are packed at every height: gaps of at most GAP_PX, never overlapping (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      // At the fork the branches are exact slices of the stem: widths sum to it.
      let x = -fan.trunkWidth / 2;
      for (const b of fan.branches) {
        expect(leftAt(b, 0)).toBeCloseTo(x, 9);
        expect(strandAt(b, fan.time.ageAt(0), mode).w).toBeCloseTo(b.width, 9);
        x += b.width;
      }
      expect(x).toBeCloseTo(fan.trunkWidth / 2, 9);
      // Overview scale (~3 px per world unit of width, ~0.6 of time): fully packed.
      const sx = 3;
      const sy = 0.65;
      fan.pack.setScale(sx, sy);
      for (let k = 1; k <= 400; k++) {
        const y = fan.time.y(0) * (k / 400);
        // Skip where gaps are still opening (above the fork) or an ended branch's slot is closing.
        if (y > -OPEN_PX / sy || fan.branches.some((b) => y < b.tipY && y > b.tipY - CLOSE_MAX_PX / sy)) continue;
        for (const gap of gapsAt(fan, y)) {
          expect(gap).toBeGreaterThanOrEqual(-1e-9);
          expect(gap).toBeLessThanOrEqual((GAP_PX / sx) * 1.01);
        }
      }
      // The bundle narrows towards "now" (like the stem): at "now" it is the living's widths plus gaps.
      const yNow = fan.time.y(0);
      const vis = fan.branches.filter((b) => yNow >= b.tipY);
      const last = vis[vis.length - 1];
      const span = leftAt(last, yNow) + strandAt(last, 0, mode).w - leftAt(vis[0], yNow);
      const sum = vis.reduce((a, b) => a + strandAt(b, 0, mode).w, 0);
      expect(span).toBeLessThanOrEqual((sum + (vis.length - 1) * (GAP_PX / sx)) * 1.01);
      // Deeper width zooms, referenced to a point in the lion's green lane (as the
      // camera does with the screen centre): still packed at every height, and
      // that green lane stands upright.
      const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
      for (const [zx, zy] of [
        [1e6, 1],
        [1e9, 1e4],
        [30, 0.2],
        [300, 2],
      ]) {
        fan.pack.setScale(zx, zy);
        const yr = fan.time.y(30e-6);
        fan.pack.setRef(leftAt(lion, yr) + 1e-12, yr);
        for (let k = 1; k <= 200; k++) {
          const y = fan.time.y(0) * (k / 200);
          if (y > -OPEN_PX / zy || fan.branches.some((b) => y < b.tipY && y > b.tipY - CLOSE_MAX_PX / zy)) continue;
          for (const gap of gapsAt(fan, y)) {
            expect(gap * zx).toBeGreaterThanOrEqual(-1e-6);
            expect(gap * zx).toBeLessThanOrEqual(GAP_PX * 1.01);
          }
        }
        if (fan.pack.fade() === 0) {
          for (let k = 1; k <= 50; k++) expect((leftAt(lion, fan.time.y(0) * (k / 50)) - leftAt(lion, yr)) * zx).toBeCloseTo(0, 6);
        }
      }
    });
  }
});
