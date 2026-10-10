import { describe, expect, it } from 'vitest';
import { blendH, g, gInv, laneAt, layoutFan, leftAt, nAt, nodeQ, strandAt, type Fan, type WidthMode } from './layout';
import { PANTHERA } from './panthera';

const MODES: WidthMode[] = ['log', 'linear'];

/** Every edge of the band (n + 1, tree order) at world y. */
const edges = (f: Fan, y: number) => Array.from({ length: f.steps.n + 1 }, (_, i) => f.steps.edgeAt(i, y));

describe('fan strands: width = alive at the time', () => {
  for (const mode of MODES) {
    it(`a strand is the individuals alive then, the green share those with living descendants (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        const sp = b.sp;
        // At its own knots (the population's points, its start and its tip) the width is the model's N exactly.
        for (let k = 0; k < b.ky.length; k++) {
          const y = b.ky[k];
          const L = laneAt(b, y);
          expect(L.w).toBeCloseTo(b.kw[k], 9);
          const age = fan.time.ageAt(y);
          // (A history's curve can jump at a point: the knot holds one side of it.)
          if (k > 0 && k < b.ky.length - 1 && !sp.extinct) {
            const d = Math.min(...[1 - 1e-9, 1, 1 + 1e-9].map((s) => Math.abs(L.w - b.unit * g(b.pop.aliveAt(age * s), mode))));
            expect(d).toBeLessThan(1e-6 * b.width);
          }
        }
        if (sp.extinct) {
          // Withered all the way: no green in its own column; nobody at its last appearance (the pinch's end).
          expect(laneAt(b, b.tipY).w).toBe(0);
          expect(strandAt(b, sp.t1 * 0.99, mode).w).toBe(0);
          for (let k = 1; k < 10; k++) expect(laneAt(b, b.tipY + ((b.splitY - b.tipY) * k) / 10).gw).toBe(0);
        } else {
          // Now: the living, all of them green.
          // (to procgen's integer rounding and EVER's quantization: ~0.1-0.2%)
          expect(Math.abs(nAt(b, b.tipY) - sp.alive)).toBeLessThanOrEqual(Math.max(50, 2e-3 * sp.alive));
          expect(strandAt(b, 0, mode).f).toBeCloseTo(1, 12);
        }
        // Below its split: its founders, constant.
        expect(b.baseW).toBeCloseTo(b.unit * g(b.pop.founders, mode), 12);
        for (const u of [1e-9, 0.01, 0.5, 1]) expect(laneAt(b, b.splitY + (fan.trunkBottom.y - b.splitY) * u).w).toBeCloseTo(b.baseW, 9);
        // Never wider than its room.
        for (let k = 0; k <= 50; k++) expect(laneAt(b, b.tipY + ((b.splitY - b.tipY) * k) / 50).w).toBeLessThanOrEqual(b.width * (1 + 1e-9));
      }
    });

    it(`width = N(t) at every height: the population model is the width's own interpolant (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const b of fan.branches) {
        for (let k = 0; k + 1 < b.ky.length; k++) {
          // Between two of its points, N is the interpolant (linear, or log-linear for log widths, in log time) ...
          const n0 = gInv(b.kw[k] / b.unit, mode);
          const n1 = gInv(b.kw[k + 1] / b.unit, mode);
          for (const u of [0.1, 0.5, 0.9]) {
            const y = b.ky[k] + (b.ky[k + 1] - b.ky[k]) * u;
            const n = nAt(b, y);
            // ... between its two ends ...
            expect(n).toBeGreaterThanOrEqual(Math.min(n0, n1) * (1 - 1e-9) - 1e-9);
            expect(n).toBeLessThanOrEqual(Math.max(n0, n1) * (1 + 1e-9) + 1e-9);
            // ... and the width is exactly that many individuals.
            expect(laneAt(b, y).w).toBeCloseTo(b.unit * g(n, mode), 9);
          }
        }
      }
    });
  }
});

describe('one partitioned band: continuous, edge to edge, fixed in the world', () => {
  for (const mode of MODES) {
    it(`at every height the strands tile the band edge to edge, its centre of mass on x = 0 (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const order = f.steps.order;
      for (let k = 0; k <= 400; k++) {
        const y = f.time.y(0) + ((f.trunkBottom.y - f.time.y(0)) * k) / 400;
        let x = leftAt(order[0], y);
        let m = 0;
        let W = 0;
        for (const b of order) {
          // No gap, no overlap: each strand starts where the one before ends.
          expect(leftAt(b, y)).toBeCloseTo(x, 9);
          const w = laneAt(b, y).w;
          expect(w).toBeGreaterThanOrEqual(0);
          m += w * (x + w / 2);
          W += w;
          x += w;
        }
        // (Between knots the anchor is interpolated too: exact at the knots, close between.)
        expect(Math.abs(m / W)).toBeLessThan(0.02 * W);
      }
      for (const y of f.steps.ys) {
        const e = edges(f, y);
        let m = 0;
        for (let i = 0; i + 1 < e.length; i++) m += (e[i + 1] - e[i]) * (e[i] + e[i + 1]) * 0.5;
        expect(m / (e[e.length - 1] - e[0])).toBeCloseTo(0, 9);
      }
    });

    it(`every edge is continuous: no jump across any split, population change or knot (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const ys = f.steps.ys;
      const top = f.time.y(0);
      // Across every knot (every split, every population point, every pinch), finely sampled.
      // The steepest any edge gets (world x per world y), from the knots themselves.
      let slope = 0;
      for (let k = 0; k + 1 < ys.length; k++) {
        const a = edges(f, ys[k]);
        const b = edges(f, ys[k + 1]);
        for (let i = 0; i < a.length; i++) slope = Math.max(slope, Math.abs(b[i] - a[i]) / (ys[k + 1] - ys[k]));
      }
      expect(Number.isFinite(slope)).toBe(true);
      for (let k = 0; k < ys.length; k++) {
        const span = Math.min(k > 0 ? ys[k] - ys[k - 1] : Infinity, k + 1 < ys.length ? ys[k + 1] - ys[k] : Infinity);
        for (const rel of [1e-2, 1e-5, 1e-8]) {
          const d = span * rel;
          let prev = edges(f, ys[k] - 20 * d);
          for (let j = -19; j <= 20; j++) {
            const y = ys[k] + j * d;
            if (y < top) continue;
            const cur = edges(f, y);
            for (let i = 0; i < cur.length; i++) {
              const dx = Math.abs(cur[i] - prev[i]);
              // No jump: neighbouring samples move by at most the steepest slope times their distance,
              // so the motion shrinks with the step; at the finest a vanishing share of the column beside it.
              expect(dx).toBeLessThanOrEqual(slope * d * (1 + 1e-6) + 1e-12);
              const wl = i > 0 ? cur[i] - cur[i - 1] : 0;
              const wr = i + 1 < cur.length ? cur[i + 1] - cur[i] : 0;
              if (rel === 1e-8) expect(dx).toBeLessThan(1e-4 * Math.max(wl, wr, 1e-3 * f.trunkWidth));
            }
            prev = cur;
          }
        }
      }
      // And straight between knots (straight lines in (x, log t)): the middle is the ends' mean.
      for (let k = 0; k + 1 < ys.length; k++) {
        const a = edges(f, ys[k]);
        const b = edges(f, ys[k + 1]);
        const m = edges(f, (ys[k] + ys[k + 1]) / 2);
        for (let i = 0; i < m.length; i++) expect(m[i]).toBeCloseTo((a[i] + b[i]) / 2, 9);
      }
    });

    it(`a population change slants the edges, never steps them: the lion's last 200 years (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const lion = f.branches.find((b) => b.sp.common === 'Lion')!;
      const y0 = f.time.y(200e-6);
      const y1 = f.time.y(0);
      let prevW = laneAt(lion, y0).w;
      let prevL = leftAt(lion, y0);
      let maxDw = 0;
      for (let k = 1; k <= 4000; k++) {
        const y = y0 + ((y1 - y0) * k) / 4000;
        const w = laneAt(lion, y).w;
        const l = leftAt(lion, y);
        maxDw = Math.max(maxDw, Math.abs(w - prevW) / prevW);
        // A sample's step is a 4000th of the stretch: no edge moves more than a small share of the column.
        expect(Math.abs(w - prevW)).toBeLessThan(0.01 * prevW);
        expect(Math.abs(l - prevL)).toBeLessThan(0.01 * prevW);
        prevW = w;
        prevL = l;
      }
      // It did decline over the stretch (the crash), smoothly.
      expect(laneAt(lion, y1).w).toBeLessThan(laneAt(lion, y0).w);
      expect(maxDw).toBeGreaterThan(0);
    });

    it(`an extinct species pinches to nothing: a ramp, not a cut (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const b of f.branches.filter((x) => x.sp.extinct)) {
        expect(laneAt(b, b.tipY).w).toBe(0);
        // The ramp: the width climbs steadily from 0 at its last appearance.
        const rampTop = b.ky[1];
        expect(rampTop).toBeGreaterThan(b.tipY);
        let prev = 0;
        for (let k = 1; k <= 20; k++) {
          const w = laneAt(b, b.tipY + ((rampTop - b.tipY) * k) / 20).w;
          expect(w).toBeGreaterThan(prev);
          expect(w - prev).toBeLessThan(0.1 * b.baseW);
          prev = w;
        }
        // Above it, its neighbours meet: its two edges are one.
        const y = b.tipY - 1;
        if (y > f.time.y(0)) expect(f.steps.edgeAt(b.index + 1, y)).toBeCloseTo(f.steps.edgeAt(b.index, y), 9);
      }
    });

    it(`below a split the green blends from the daughters' lanes into the column's prefix, continuously (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const v of f.nodes) {
        const h = blendH(v);
        expect(h).toBeGreaterThan(0);
        // The column's green total is the genealogy's at every knot, blend or not.
        for (const y of f.steps.ys) {
          if (!(y > v.y && y <= v.yBot)) continue;
          const tot = v.strands.reduce((a, b) => a + laneAt(b, y).gw, 0);
          expect(tot / v.width).toBeCloseTo(nodeQ(v, Math.min(f.time.ageAt(y), f.time.ageAt(v.yBot))), 6);
        }
        // Past the genealogy's first generations (q climbs back fast below a split with an extinct
        // daughter, whose founders' share is 0), the lanes move smoothly through the blend.
        const y0 = Math.max(v.y, f.time.y(v.ageMa + (v.q.length * v.genYears) / 1e6));
        for (const b of v.strands) {
          let prev = laneAt(b, y0).gw;
          for (let k = 1; k <= 200; k++) {
            const y = y0 + (Math.max(0, v.y + h - y0) * k) / 200;
            const gw = laneAt(b, y).gw;
            expect(Math.abs(gw - prev)).toBeLessThan(0.05 * b.baseW + 1e-9);
            expect(gw).toBeLessThanOrEqual(laneAt(b, y).w + 1e-9);
            prev = gw;
          }
        }
      }
    });
  }
});
