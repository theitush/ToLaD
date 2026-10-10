import { describe, expect, it } from 'vitest';
import { gapBetween, GAP_FRAC, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, remaining, Steps, strandAt, TIME_H, type WidthMode } from './layout';
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

describe('rectangular fan: fixed, straight, honest', () => {
  const seeded = (seed: number) => {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`width = individuals × one fixed scale, at random heights and zooms (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const rnd = seeded(5);
      // One width per individual (linear) or per decade of individuals (log), the same for every branch:
      // the number the scale bar shows (view.ts widthScale: trunkWidth / Σ g(ever)).
      const sumG = fan.branches.reduce((a, b) => a + (mode === 'linear' ? b.sp.ever : 1 + Math.log10(b.sp.ever)), 0);
      for (const b of fan.branches) {
        const gEver = mode === 'linear' ? b.sp.ever : 1 + Math.log10(b.sp.ever);
        expect(b.width / gEver).toBeCloseTo(fan.trunkWidth / sumG, 12);
      }
      for (let trial = 0; trial < 300; trial++) {
        const sy = Math.exp(Math.log(0.3) + rnd() * Math.log(1e5 / 0.3));
        fan.steps.setScale(sy);
        const b = fan.branches[Math.floor(rnd() * fan.branches.length)];
        const y = b.tipY * (0.001 + 0.998 * rnd());
        const L = laneAt(b, y);
        // The step's width is the branch's exact width (its individuals) at some height of its step.
        const d = Steps.dy(fan.steps.k);
        const i = Steps.index(fan.steps.k, y);
        const lo = Math.max(b.tipY, -(i + 1) * d);
        const hi = -i * d;
        let mn = Infinity;
        let mx = -Infinity;
        for (let j = 0; j <= 400; j++) {
          const w = strandAt(b, fan.time.ageAt(lo + ((hi - lo) * j) / 400), mode).w;
          mn = Math.min(mn, w);
          mx = Math.max(mx, w);
        }
        expect(L.w).toBeGreaterThanOrEqual(mn * (1 - 1e-6) - 1e-12);
        expect(L.w).toBeLessThanOrEqual(mx * (1 + 1e-6) + 1e-12);
        if (mode === 'linear') {
          const ind = (L.w * sumG) / fan.trunkWidth;
          // The dead peel off going up: the most individuals at the step's bottom (hi), the fewest at its top.
          expect(ind).toBeGreaterThanOrEqual(remaining(b.sp, fan.time.ageAt(lo)) * (1 - 1e-6));
          expect(ind).toBeLessThanOrEqual(remaining(b.sp, fan.time.ageAt(hi)) * (1 + 1e-6));
        }
      }
    });

    it(`the steps keep the area: individuals × height summed over steps = the exact integral (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const k of [2, 5, 9]) {
        fan.steps.setScale((Math.pow(2, k) * 22 * 1.05) / TIME_H);
        expect(fan.steps.k).toBe(k);
        expect(fan.steps.t).toBe(0);
        const d = Steps.dy(k);
        for (const b of fan.branches) {
          let stepped = 0;
          for (let i = 0; -i * d > b.tipY; i++) {
            const top = Math.max(b.tipY, -(i + 1) * d);
            stepped += laneAt(b, (top - i * d) / 2).w * (-i * d - top);
          }
          let exact = 0;
          const N = 20000;
          const h = -b.tipY / N;
          for (let j = 0; j < N; j++) exact += strandAt(b, fan.time.ageAt(-(j + 0.5) * h), mode).w * h;
          expect(stepped / exact).toBeCloseTo(1, 3);
        }
      }
    });

    it(`every edge is straight but the gray one, which steps; the gaps are fixed (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const W = fan.trunkWidth;
      const bs = fan.branches;
      fan.steps.setScale(3);
      // The stem: the columns go straight on down below the fork (no jog), spanning the stalks.
      for (const b of bs) expect(b.baseLeft).toBe(b.colLeft);
      expect(bs[0].colLeft).toBeCloseTo(fan.x0, 9);
      // The columns: fixed gaps, at least GAP_FRAC of the smaller neighbour (or MIN_GAP_FRAC of the stem).
      for (let j = 1; j < bs.length; j++) {
        const gap = bs[j].colLeft - (bs[j - 1].colLeft + bs[j - 1].width);
        expect(gap).toBeCloseTo(gapBetween(bs[j - 1], bs[j], W), 9);
        expect(gap).toBeGreaterThanOrEqual(Math.max(GAP_FRAC * Math.min(bs[j].width, bs[j - 1].width), MIN_GAP_FRAC * W) * (1 - 1e-9));
      }
      for (const b of bs) {
        const green = b.sp.alive > 0 ? b.width * b.aliveFrac : 0;
        for (let k = 0; k <= 400; k++) {
          const y = b.tipY + ((fan.trunkBottom.y - b.tipY) * k) / 400;
          // Left edge: one vertical line from the bottom of the world to the tip.
          expect(leftAt(b, y)).toBe(b.colLeft);
          const L = laneAt(b, y);
          // The green lane: one width from the root to the tip (a vertical band).
          expect(L.gw).toBeCloseTo(green, 12);
          // Never wider than its base: neighbours never touch.
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
        }
        // The gray edge is constant within each step (vertical), changing only at step lines.
        // (While morphing between grids the finer grid's steps are the ones drawn.)
        const d = Steps.dy(fan.steps.level);
        for (let i = 0; -(i + 1) * d > b.tipY; i += 1) {
          const ws = [0.01, 0.3, 0.5, 0.7, 0.99].map((u) => laneAt(b, -(i + u) * d).w);
          for (const w of ws) expect(w).toBe(ws[0]);
        }
      }
    });
  }
});
