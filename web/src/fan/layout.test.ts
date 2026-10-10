import { describe, expect, it } from 'vitest';
import { g, gapBetween, GAP_FRAC, laneAt, layoutFan, LEAN_MAX_FRAC, leftAt, MIN_GAP_FRAC, strandAt, type WidthMode } from './layout';
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

describe('leaning fan: fixed, continuous, honest', () => {
  const seeded = (seed: number) => {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`width = individuals alive × one fixed scale, at every height: N(t) as the population model has it, no steps (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const rnd = seeded(5);
      // One width per individual (linear) or per decade of individuals (log), the same for every branch:
      // the number the scale bar shows (view.ts widthScale).
      const unit = fan.branches[0].unit;
      for (const b of fan.branches) {
        expect(b.unit).toBe(unit);
        expect(b.width / g(b.pop.max, mode)).toBeCloseTo(unit, 12);
      }
      for (let trial = 0; trial < 600; trial++) {
        const b = fan.branches[Math.floor(rnd() * fan.branches.length)];
        // Within its own column, tip to split.
        const y = b.tipY + (b.splitY - b.tipY) * (0.001 + 0.998 * rnd());
        const L = laneAt(b, y);
        const age = fan.time.ageAt(y);
        expect(L.w).toBeCloseTo(b.unit * g(b.pop.aliveAt(age), mode), 12);
        expect(L.gw).toBeCloseTo(L.w * b.pop.greenAt(age), 12);
        if (b.sp.extinct) expect(L.gw).toBe(0);
      }
    });

    it(`the kinks are few and fixed, and the lion's recent decline is a ramp (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const v = fan.steps.bounds(b);
        expect(v.length).toBeLessThan(80);
        for (let k = 1; k < v.length; k++) expect(v[k]).toBeGreaterThan(v[k - 1]);
      }
      // The last 200 years of the lion: its width falls smoothly, every sample a little below the one before it.
      const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
      const ws: number[] = [];
      for (let k = 0; k <= 400; k++) ws.push(laneAt(lion, fan.time.y((200 * k) / 400 / 1e6)).w);
      const steps = ws.slice(1).map((w, k) => Math.abs(w - ws[k]));
      expect(ws[400]).toBeGreaterThan(ws[0] * 1.05);
      expect(Math.max(...steps)).toBeLessThan((ws[400] - ws[0]) * 0.05);
    });

    it(`bands never overlap, are never wider than their room, and hold their founders below their split (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const ys = new Set<number>();
      for (let k = 0; k <= 3000; k++) ys.add(fan.time.y(4.7 * Math.pow(k / 3000, 3)));
      for (const b of fan.branches) for (const y of fan.steps.bounds(b)) for (const d of [-1e-3, 0, 1e-3]) ys.add(y + d);
      for (const y of ys) {
        const iv: [number, number, string][] = [];
        for (const b of fan.branches) {
          if (y < b.tipY) continue;
          const L = laneAt(b, y);
          expect(L.gw).toBeLessThanOrEqual(L.w * (1 + 1e-12));
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
          if (y >= b.splitY) expect(L.w).toBe(b.baseW);
          if (L.w > 0) iv.push([leftAt(b, y), leftAt(b, y) + L.w, b.sp.common]);
        }
        iv.sort((p, q) => p[0] - q[0]);
        for (let k = 1; k < iv.length; k++) expect(iv[k][0]).toBeGreaterThanOrEqual(iv[k - 1][1] - 1e-9);
        // Within the drawing's extent.
        for (const [a, c] of iv) {
          expect(a).toBeGreaterThanOrEqual(fan.x0 - 1e-9);
          expect(c).toBeLessThanOrEqual(fan.x1 + 1e-9);
        }
      }
    });

    it(`a lean clears its sibling's subtree by a gap, and ends before either daughter's next event (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const W = fan.trunkWidth;
      for (const v of fan.nodes) {
        const next = v.kids.map((k) => ('strands' in k ? k.y : k.tipY));
        const room = Math.min(...next.map((y) => v.y - y));
        for (const k of v.kids) {
          const leanY = k.leanY;
          const leans = 'strands' in k ? k.left !== k.x0 : k.lean !== 0;
          expect(leans).toBe(k !== v.main);
          if (k === v.main) expect(leanY).toBe(v.y);
          else {
            expect(leanY).toBeLessThan(v.y);
            expect(v.y - leanY).toBeLessThanOrEqual(LEAN_MAX_FRAC * room * (1 + 1e-12));
          }
        }
      }
      // Neighbouring columns (the leaf species' rooms, left to right) are at least the smallest gap apart.
      const bs = [...fan.branches].sort((p, q) => p.index - q.index);
      for (let j = 1; j < bs.length; j++) {
        const gap = bs[j].colLeft - (bs[j - 1].colLeft + bs[j - 1].width);
        expect(gap).toBeGreaterThanOrEqual(MIN_GAP_FRAC * W * (1 - 1e-9));
      }
      expect(gapBetween(10, 20, W)).toBe(Math.max(GAP_FRAC * 10, MIN_GAP_FRAC * W));
    });
  }
});
