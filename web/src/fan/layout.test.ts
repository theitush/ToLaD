import { describe, expect, it } from 'vitest';
import { g, gapBetween, GAP_FRAC, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, strandAt, type FanBranch, type Fan, type WidthMode } from './layout';
import { PANTHERA } from './panthera';

/** World y of a branch's first appearance. */
const yFirst = (fan: Fan, b: FanBranch) => fan.time.y(b.sp.t0);

describe('fan strands: width = alive at the time', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`a strand is the individuals alive then, the green share those with living descendants (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const sp = b.sp;
        const mid = Array.from({ length: 9 }, (_, i) => sp.t1 + ((sp.t0 - sp.t1) * (i + 1)) / 10);
        for (const a of [sp.t1, ...mid, sp.t0]) {
          const s = strandAt(b, a, mode);
          expect(s.w).toBeCloseTo(b.unit * g(b.pop.aliveAt(a), mode), 12);
          if (sp.extinct) expect(s.f).toBe(0);
          else expect(s.f).toBeGreaterThan(0.3);
        }
        if (sp.extinct) {
          // Its column starts at its first appearance: its founders' ancestors are the parent's.
          expect(strandAt(b, sp.t0 * 1.01, mode).w).toBe(0);
          expect(strandAt(b, sp.t1 * 0.99, mode).w).toBe(0);
        } else {
          // Now: the living, all of them green.
          // (to procgen's integer rounding and EVER's quantization: ~0.1-0.2%)
          expect(Math.abs(b.pop.aliveAt(0) - sp.alive)).toBeLessThanOrEqual(Math.max(50, 2e-3 * sp.alive));
          expect(strandAt(b, 0, mode).f).toBe(1);
          // Below the first appearance: the founders, constant.
          expect(strandAt(b, sp.t0 * 1.2, mode).w).toBeCloseTo(strandAt(b, sp.t0, mode).w, 12);
        }
        // The stem: the founders, at the green share the genealogy settles to.
        expect(b.baseW).toBeCloseTo(b.unit * g(b.pop.founders, mode), 12);
        expect(b.baseQ).toBeCloseTo(0.797, 3);
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
        const y = b.tipY * (0.001 + 0.998 * rnd());
        const L = laneAt(b, y);
        const age = fan.time.ageAt(y);
        const st = b.pop.stepAt(age);
        expect(L.w).toBeCloseTo(b.unit * g(st.n, mode), 12);
        expect(L.gw).toBeCloseTo(L.w * st.q, 12);
        if (b.sp.extinct) {
          if (y < yFirst(fan, b)) expect(L.gw).toBe(0);
          continue;
        }
        // A living species' step is its generation's: N at the generation's young edge (the history's
        // own points at segment boundaries), and its genealogy share.
        const GL = b.sp.genYears;
        const k = Math.floor((age * 1e6) / GL);
        if (age < b.sp.t0) expect(st.n).toBeCloseTo(b.pop.aliveAt((k * GL) / 1e6), 6);
        expect(st.q).toBeCloseTo(b.pop.greenAt(age), 9);
      }
    });

    it(`the steps are few and fixed: constant stretches are one step (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const v = fan.steps.bounds(b);
        expect(v.length).toBeLessThan(80);
        for (let k = 1; k < v.length; k++) expect(v[k]).toBeGreaterThan(v[k - 1]);
        // Neighbouring steps differ (else they would be one).
        for (let k = 0; k < v.length; k++) {
          const above = laneAt(b, k ? (v[k - 1] + v[k]) / 2 : (b.tipY + v[k]) / 2);
          const below = laneAt(b, k + 1 < v.length ? (v[k] + v[k + 1]) / 2 : Math.min(0, v[k] + 1e-6) - 1e-9);
          expect(above.w !== below.w || above.gw !== below.gw).toBe(true);
        }
      }
      // The lion's recent crash is generation by generation, its deep past one step.
      const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
      expect(fan.steps.bounds(lion).length).toBeGreaterThan(10);
    });

    it(`the left edge is straight, the lanes' edges step; the gaps are fixed (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const W = fan.trunkWidth;
      const bs = fan.branches;
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
        for (let k = 0; k <= 400; k++) {
          const y = b.tipY + ((fan.trunkBottom.y - b.tipY) * k) / 400;
          // Left edge: one vertical line from the bottom of the world to the tip.
          expect(leftAt(b, y)).toBe(b.colLeft);
          const L = laneAt(b, y);
          expect(L.gw).toBeLessThanOrEqual(L.w * (1 + 1e-12));
          // Never wider than its room: neighbours never touch.
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
          // Below the fork: the founders.
          if (y > 0) {
            expect(L.w).toBe(b.baseW);
            expect(L.gw).toBeCloseTo(b.baseW * b.baseQ, 12);
          }
        }
        // Both edges are constant within each step (vertical), changing only at step lines.
        const v = [b.tipY, ...fan.steps.bounds(b), 0];
        for (let i = 0; i + 1 < v.length; i++) {
          const ls = [0.01, 0.3, 0.5, 0.7, 0.99].map((u) => laneAt(b, v[i] + (v[i + 1] - v[i]) * u));
          for (const l of ls) {
            expect(l.w).toBe(ls[0].w);
            expect(l.gw).toBe(ls[0].gw);
          }
        }
      }
    });
  }
});
