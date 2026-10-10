import { describe, expect, it } from 'vitest';
import { g, gapBetween, GAP_FRAC, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, Steps, strandAt, TIME_H, type FanBranch, type Fan, type WidthMode } from './layout';
import { PANTHERA } from './panthera';

/** World y of a branch's first appearance. */
const yFirst = (fan: Fan, b: FanBranch) => fan.time.y(b.sp.t0);

/** The piece of level-k step i holding y: the step, cut at the species' first appearance. */
function piece(fan: Fan, b: FanBranch, k: number, y: number): [number, number] {
  const d = Steps.dy(k);
  const i = Steps.index(k, y);
  let lo = Math.max(b.tipY, -(i + 1) * d);
  let hi = -i * d;
  const y0 = yFirst(fan, b);
  if (y0 > lo && y0 < hi) {
    if (y < y0) hi = y0;
    else lo = y0;
  }
  return [lo, hi];
}

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
          expect(b.pop.aliveAt(0)).toBeCloseTo(sp.alive, -2);
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
    it(`width = individuals alive × one fixed scale, at random heights and zooms (${mode})`, () => {
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
        const sy = Math.exp(Math.log(0.3) + rnd() * Math.log(1e5 / 0.3));
        fan.steps.setScale(sy);
        if (fan.steps.t > 0) continue;
        const b = fan.branches[Math.floor(rnd() * fan.branches.length)];
        const y = b.tipY * (0.001 + 0.998 * rnd());
        const L = laneAt(b, y);
        // The step's width is the branch's exact width (its individuals) at some height of its step (cut at the first appearance).
        const [lo, hi] = piece(fan, b, fan.steps.k, y);
        let mn = Infinity;
        let mx = -Infinity;
        for (let j = 0; j <= 400; j++) {
          const w = strandAt(b, fan.time.ageAt(lo + ((hi - lo) * j) / 400), mode).w;
          mn = Math.min(mn, w);
          mx = Math.max(mx, w);
        }
        expect(L.w).toBeGreaterThanOrEqual(mn * (1 - 1e-6) - 1e-12);
        expect(L.w).toBeLessThanOrEqual(mx * (1 + 1e-6) + 1e-12);
        expect(L.gw).toBeLessThanOrEqual(L.w * (1 + 1e-12));
        if (b.sp.extinct && y < yFirst(fan, b)) expect(L.gw).toBe(0);
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
          const y0 = yFirst(fan, b);
          let stepped = 0;
          let steppedG = 0;
          for (let i = 0; -i * d > b.tipY; i++) {
            const top = Math.max(b.tipY, -(i + 1) * d);
            const cuts = [top, -i * d];
            if (y0 > top && y0 < -i * d) cuts.splice(1, 0, y0);
            for (let c = 0; c + 1 < cuts.length; c++) {
              const L = laneAt(b, (cuts[c] + cuts[c + 1]) / 2);
              stepped += L.w * (cuts[c + 1] - cuts[c]);
              steppedG += L.gw * (cuts[c + 1] - cuts[c]);
            }
          }
          let exact = 0;
          let exactG = 0;
          const N = 20000;
          const h = -b.tipY / N;
          for (let j = 0; j < N; j++) {
            const s = strandAt(b, fan.time.ageAt(-(j + 0.5) * h), mode);
            exact += s.w * h;
            exactG += s.w * s.f * h;
          }
          expect(stepped / exact).toBeCloseTo(1, 3);
          if (exactG > 0) expect(steppedG / exactG).toBeCloseTo(1, 2);
          else expect(steppedG).toBe(0);
        }
      }
    });

    it(`the left edge is straight, the lanes' edges step; the gaps are fixed (${mode})`, () => {
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
        // Both edges are constant within each step (vertical), changing only at step lines
        // (and at the species' first appearance).
        const d = Steps.dy(fan.steps.level);
        const y0 = yFirst(fan, b);
        for (let i = 0; -(i + 1) * d > b.tipY; i += 1) {
          if (y0 > -(i + 1) * d && y0 < -i * d) continue;
          const ls = [0.01, 0.3, 0.5, 0.7, 0.99].map((u) => laneAt(b, -(i + u) * d));
          for (const l of ls) {
            expect(l.w).toBe(ls[0].w);
            expect(l.gw).toBe(ls[0].gw);
          }
        }
      }
    });
  }
});
