import { describe, expect, it } from 'vitest';
import { columnsAt, g, gapBetween, GAP_FRAC, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, nodeLeftAt, segAt, strandAt, TIME_H, type WidthMode } from './layout';
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

describe('river fan: fixed, smooth, honest', () => {
  const seeded = (seed: number) => {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`width = N(t) × one fixed scale, exactly, at every height; green = its share (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const rnd = seeded(5);
      // One width per individual (linear) or per decade of individuals (log), the same for every branch:
      // the number the scale bar shows (view.ts widthScale).
      const unit = fan.branches[0].unit;
      for (const b of fan.branches) {
        expect(b.unit).toBe(unit);
        expect(b.width / g(b.pop.max, mode)).toBeCloseTo(unit, 12);
      }
      for (let trial = 0; trial < 2000; trial++) {
        const b = fan.branches[Math.floor(rnd() * fan.branches.length)];
        // Within its own column, tip to split, on the log axis and near now.
        const y = trial % 2 ? b.tipY + (b.splitY - b.tipY) * rnd() : b.tipY + Math.min(b.splitY - b.tipY, 300) * rnd();
        const L = laneAt(b, y);
        const age = fan.time.ageAt(y);
        expect(L.w).toBeCloseTo(b.unit * g(b.pop.aliveAt(age), mode), 12);
        expect(L.gw).toBeCloseTo(L.w * b.pop.greenAt(age), 12);
        if (b.sp.extinct) expect(L.gw).toBe(0);
      }
    });

    it(`every edge is a continuous function of time: edges and the lanes' boundary, no jog at a split, no step at a population change (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const yb = fan.trunkBottom.y;
      const edges = (b: (typeof fan.branches)[0], y: number) => {
        const l = leftAt(b, y);
        const L = laneAt(b, y);
        return [l, l + L.w, l + L.gw];
      };
      for (const b of fan.branches) {
        const f = fan.tess.bounds(b);
        // Straddling every feature (splits, fork ends, history points, corner windows, taper): a hair apart, a hair of movement.
        for (const y of f) {
          if (!(y > b.tipY + 1e-6) || !(y < yb - 1e-6)) continue;
          const a = edges(b, y - 1e-7);
          const c = edges(b, y + 1e-7);
          const w = Math.max(laneAt(b, y - 1e-7).w, laneAt(b, y + 1e-7).w, 1e-9);
          for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - c[k]) / w).toBeLessThan(1e-4);
        }
        // Finely across its whole span (every feature interval cut in 16): the edges move at a bounded slope.
        const ys = [b.tipY, ...f, yb];
        for (let i = 0; i + 1 < ys.length; i++) {
          let prev = edges(b, ys[i]);
          for (let j = 1; j <= 16; j++) {
            const y = ys[i] + ((ys[i + 1] - ys[i]) * j) / 16;
            const e = edges(b, y);
            const dy = (ys[i + 1] - ys[i]) / 16;
            // (Log widths close an extinct column over its last ~10 individuals steeply: the log of a smooth taper.)
            const last = mode === 'log' && y < b.splitY && b.pop.aliveAt(fan.time.ageAt(y - dy)) < 10;
            if (!last) for (let k = 0; k < 3; k++) expect(Math.abs(e[k] - prev[k])).toBeLessThanOrEqual(12 * dy + 1e-9);
            prev = e;
          }
        }
      }
    });

    it(`columns are symmetric about fixed centres in fixed rooms with fixed gaps, and never overlap (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      const W = fan.trunkWidth;
      const bs = [...fan.branches].sort((p, q) => p.index - q.index);
      expect(bs[0].colLeft).toBeCloseTo(fan.x0, 9);
      for (let j = 1; j < bs.length; j++) {
        const gap = bs[j].colLeft - (bs[j - 1].colLeft + bs[j - 1].width);
        expect(gap).toBeCloseTo(gapBetween(bs[j - 1], bs[j], W), 9);
        expect(gap).toBeGreaterThanOrEqual(Math.max(GAP_FRAC * Math.min(bs[j].width, bs[j - 1].width), MIN_GAP_FRAC * W) * (1 - 1e-9));
      }
      for (const b of bs) {
        expect(b.cx).toBeCloseTo(b.colLeft + b.width / 2, 12);
        for (let k = 0; k <= 400; k++) {
          const y = b.tipY + ((fan.trunkBottom.y - b.tipY) * k) / 400;
          const L = laneAt(b, y);
          expect(L.gw).toBeLessThanOrEqual(L.w * (1 + 1e-12));
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
          if (y >= b.splitY) {
            // Below its split: the founders, at its offset in the parent column.
            expect(L.w).toBe(b.baseW);
            const s = segAt(b, y);
            expect(leftAt(b, y)).toBeCloseTo(nodeLeftAt(s.node, y) + s.off, 12);
          } else if (y <= b.splitY - b.node.fork) {
            // Peeled off: about its centre, inside its room.
            expect(leftAt(b, y) + L.w / 2).toBeCloseTo(b.cx, 9);
          }
        }
      }
      // At every height the columns there are disjoint (daughters touch only at their split).
      for (let k = 0; k <= 3000; k++) {
        const y = -TIME_H + ((fan.trunkBottom.y + TIME_H) * k) / 3000;
        const cs = columnsAt(fan, y).sort((p, q) => p[0] - q[0]);
        for (let i = 1; i < cs.length; i++) expect(cs[i][0]).toBeGreaterThanOrEqual(cs[i - 1][1] - 1e-9);
      }
    });
  }
});
