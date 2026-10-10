import { describe, expect, it } from 'vitest';
import { g, gapBetween, GAP_FRAC, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, segAt, strandAt, type WidthMode } from './layout';
import { PANTHERA } from './panthera';

describe('fan strands: width = alive at the time', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`a strand is the individuals alive then, the green share those with living descendants (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const sp = b.sp;
        // Its own column: from its tip back to its start (its split).
        const mid = Array.from({ length: 9 }, (_, i) => sp.t1 + ((b.t0 - sp.t1) * (i + 1)) / 10);
        for (const a of [sp.t1, ...mid]) {
          const s = strandAt(b, a, mode);
          expect(s.w).toBeCloseTo(b.unit * g(b.pop.aliveAt(a), mode), 12);
          if (sp.extinct) expect(s.f).toBe(0);
          else expect(s.f).toBeGreaterThan(0.3);
        }
        if (sp.extinct) {
          // Nobody after its last appearance; its founders before its start (in the parent column).
          expect(strandAt(b, sp.t1 * 0.99, mode).w).toBe(0);
          expect(strandAt(b, b.t0 * 1.01, mode).w).toBeCloseTo(b.baseW, 12);
        } else {
          // Now: the living, all of them green.
          // (to procgen's integer rounding and EVER's quantization: ~0.1-0.2%)
          expect(Math.abs(b.pop.aliveAt(0) - sp.alive)).toBeLessThanOrEqual(Math.max(50, 2e-3 * sp.alive));
          expect(strandAt(b, 0, mode).f).toBe(1);
          // Below its start: the founders, constant.
          expect(strandAt(b, b.t0 * 1.2, mode).w).toBeCloseTo(strandAt(b, b.t0, mode).w, 12);
        }
        // Below its split: the founders.
        expect(b.baseW).toBeCloseTo(b.unit * g(b.pop.founders, mode), 12);
        expect(b.pop.founders).toBeCloseTo(b.pop.aliveAt(b.t0), 6);
        // Never wider than the column's room.
        for (const a of mid) expect(strandAt(b, a, mode).w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
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
    it(`width = individuals alive × one fixed scale: the population's own steps, one per generation where N or q changes (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const rnd = seeded(5);
      // One width per individual (linear) or per decade of individuals (log), the same for every branch:
      // the number the scale bar shows (view.ts widthScale).
      const unit = fan.branches[0].unit;
      for (const b of fan.branches) {
        expect(b.unit).toBe(unit);
        expect(b.width / g(b.pop.max, mode)).toBeCloseTo(unit, 12);
      }
      for (let trial = 0; trial < 300; trial++) {
        const b = fan.branches[Math.floor(rnd() * fan.branches.length)];
        // Within its own column, tip to split.
        const y = b.tipY + (b.splitY - b.tipY) * (0.001 + 0.998 * rnd());
        const L = laneAt(b, y);
        const age = fan.time.ageAt(y);
        const st = b.pop.stepAt(age);
        expect(L.w).toBeCloseTo(b.unit * g(st.n, mode), 12);
        expect(L.gw).toBeCloseTo(L.w * st.q, 12);
        if (b.sp.extinct) {
          expect(L.gw).toBe(0);
          continue;
        }
        // A living species' step is its generation's: N at the generation's young edge (the history's
        // own points at segment boundaries), and its genealogy share.
        const GL = b.sp.genYears;
        const k = Math.floor((age * 1e6) / GL);
        if (age < Math.min(b.t0, b.sp.t0)) expect(st.n).toBeCloseTo(b.pop.aliveAt((k * GL) / 1e6), 6);
        expect(st.q).toBeCloseTo(b.pop.greenAt(age), 9);
      }
    });

    it(`the steps are few and fixed: constant stretches are one step (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const v = fan.steps.bounds(b);
        expect(v.length).toBeLessThan(80);
        for (let k = 1; k < v.length; k++) expect(v[k]).toBeGreaterThan(v[k - 1]);
        // Neighbouring steps differ (else they would be one): in width, green or left edge (a jog).
        const ys = [b.tipY, ...v, fan.trunkBottom.y];
        for (let k = 1; k + 1 < ys.length; k++) {
          const ya = (ys[k - 1] + ys[k]) / 2;
          const yb = (ys[k] + ys[k + 1]) / 2;
          const above = laneAt(b, ya);
          const below = laneAt(b, yb);
          expect(above.w !== below.w || above.gw !== below.gw || leftAt(b, ya) !== leftAt(b, yb)).toBe(true);
        }
      }
      // The lion's recent crash is generation by generation, its deep past one step.
      const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
      expect(fan.steps.bounds(lion).length).toBeGreaterThan(10);
    });

    it(`every edge is vertical or horizontal; the leaf columns' gaps are fixed (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const W = fan.trunkWidth;
      const bs = [...fan.branches].sort((p, q) => p.index - q.index);
      expect(bs[0].colLeft).toBeCloseTo(fan.x0, 9);
      // The leaf columns: fixed gaps, at least GAP_FRAC of the smaller neighbour (or MIN_GAP_FRAC of the stem).
      for (let j = 1; j < bs.length; j++) {
        const gap = bs[j].colLeft - (bs[j - 1].colLeft + bs[j - 1].width);
        expect(gap).toBeCloseTo(gapBetween(bs[j - 1], bs[j], W), 9);
        expect(gap).toBeGreaterThanOrEqual(Math.max(GAP_FRAC * Math.min(bs[j].width, bs[j - 1].width), MIN_GAP_FRAC * W) * (1 - 1e-9));
      }
      for (const b of bs) {
        for (let k = 0; k <= 400; k++) {
          const y = b.tipY + ((fan.trunkBottom.y - b.tipY) * k) / 400;
          // Left edge: its own column above its split, its place in the parent column below.
          expect(leftAt(b, y)).toBe(y < b.splitY ? b.colLeft : segAt(b, y).left);
          const L = laneAt(b, y);
          expect(L.gw).toBeLessThanOrEqual(L.w * (1 + 1e-12));
          // Never wider than its room: neighbours never touch.
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
          // Below its split: the founders.
          if (y >= b.splitY) expect(L.w).toBe(b.baseW);
        }
        // Both edges are constant within each step (vertical), changing only at step lines (horizontal).
        const v = [b.tipY, ...fan.steps.bounds(b), fan.trunkBottom.y];
        for (let i = 0; i + 1 < v.length; i++) {
          const us = [0.01, 0.3, 0.5, 0.7, 0.99].map((u) => v[i] + (v[i + 1] - v[i]) * u);
          const ls = us.map((y) => laneAt(b, y));
          for (const [j, l] of ls.entries()) {
            expect(l.w).toBe(ls[0].w);
            expect(l.gw).toBe(ls[0].gw);
            expect(leftAt(b, us[j])).toBe(leftAt(b, us[0]));
          }
        }
      }
    });
  }
});
