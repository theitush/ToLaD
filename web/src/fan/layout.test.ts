import { describe, expect, it } from 'vitest';
import { columnsAt, FORK_FRAC, g, gapBetween, GAP_FRAC, isNode, laneAt, layoutFan, leftAt, MIN_GAP_FRAC, nodeLeftAt, strandAt, TIME_C, type Fan, type FanBranch, type WidthMode } from './layout';
import { PANTHERA } from './panthera';
import { population } from './population';

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

describe('thick-branch tree: centred, continuous, straight, honest', () => {
  /** Every height where something happens to b: its tip, the taper's start, its knots, its fork's top, the splits and forks below it. */
  const events = (f: Fan, b: FanBranch): number[] => {
    const ys = [b.tipY, b.splitY, b.forkY, ...f.steps.bounds(b)];
    for (const s of b.path) ys.push(s.y, s.node.forkY, s.node.y + s.node.blend);
    return ys.filter((y) => y >= b.tipY && y < f.trunkBottom.y);
  };
  /** Its left edge, its right edge and the green/gray boundary between its lanes. */
  const edges = (b: FanBranch, y: number): [number, number, number] => {
    const l = leftAt(b, y);
    const L = laneAt(b, y);
    return [l, l + L.w, l + L.gw];
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`every edge, and the green/gray boundary, is continuous: no jump across any split, fork, population change or taper (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      let checked = 0;
      for (const b of f.branches) {
        for (const yk of events(f, b)) {
          // A fine sweep across the event: neighbouring samples never move an edge by more than a
          // tiny share of the column's width (a jump would move it by its whole size).
          const h = 1e-3 * Math.max(1, Math.abs(yk));
          const N = 400;
          // (From its tip down: a living species' column ends at "now", its top.)
          let prev = edges(b, Math.max(b.tipY, yk - h));
          for (let i = 1; i <= N; i++) {
            const y = yk - h + (2 * h * i) / N;
            if (y < b.tipY) continue;
            const cur = edges(b, y);
            const scale = Math.max(b.baseW, laneAt(b, y).w, 1e-3 * b.width);
            expect(Math.abs(cur[0] - prev[0]) / scale).toBeLessThan(2e-3);
            expect(Math.abs(cur[1] - prev[1]) / scale).toBeLessThan(2e-3);
            prev = cur;
            checked++;
          }
          // The green/gray boundary: continuous too, though the green share can change fast (a few
          // generations after a split the recurrence recovers): halving the step across the event
          // halves the move (a jump would not shrink).
          const e1 = 1e-6 * Math.max(1, Math.abs(yk));
          const at = (y: number) => edges(b, Math.max(b.tipY, y))[2];
          const d1 = Math.abs(at(yk + e1) - at(yk - e1));
          const d2 = Math.abs(at(yk + e1 / 1000) - at(yk - e1 / 1000));
          expect(d2, `${b.sp.common} lanes at ${yk}`).toBeLessThan(Math.max(d1 / 100, 1e-9 * Math.max(1, b.width)));
        }
        // And along the whole strand, tip to the bottom of the world: bounded slopes, never a step.
        const N = 8000;
        const y0 = b.tipY;
        const y1 = f.trunkBottom.y - 1;
        let prev = edges(b, y0);
        for (let i = 1; i <= N; i++) {
          // (Log-spaced from the tip: the recent past is where the changes are.)
          const y = y0 + (y1 - y0) * ((Math.pow(1e4, i / N) - 1) / (1e4 - 1));
          const cur = edges(b, y);
          const dy = y - (y0 + (y1 - y0) * ((Math.pow(1e4, (i - 1) / N) - 1) / (1e4 - 1)));
          // Steepest slope anywhere (world x per world y): a fork, moving a column out over its span.
          const lim = 50 * dy + 1e-9;
          expect(Math.abs(cur[0] - prev[0])).toBeLessThan(lim);
          expect(Math.abs(cur[1] - prev[1])).toBeLessThan(lim);
          prev = cur;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });

    it(`width = individuals alive, exactly, at every height of a species' own column (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const unit = f.branches[0].unit;
      for (const b of f.branches) {
        expect(b.unit).toBe(unit);
        expect(b.width / g(b.pop.max, mode)).toBeCloseTo(unit, 12);
        for (let i = 0; i <= 2000; i++) {
          const y = b.tipY + ((b.splitY - b.tipY) * i) / 2000;
          if (y >= b.splitY) continue;
          const age = f.time.ageAt(y);
          const L = laneAt(b, y);
          expect(L.w).toBeCloseTo(unit * g(b.pop.aliveAt(age), mode), 12);
          expect(L.gw).toBeCloseTo(b.sp.extinct ? 0 : L.w * b.pop.greenAt(age), 12);
          expect(L.w).toBeLessThanOrEqual(b.width * (1 + 1e-12));
        }
      }
    });

    it(`each column is centred on its world-fixed centre line, its width symmetric about it (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const b of f.branches) {
        expect(b.colLeft).toBeCloseTo(b.xc - b.width / 2, 9);
        for (let i = 0; i <= 200; i++) {
          const y = b.tipY + ((b.forkY - b.tipY) * i) / 200;
          const [l, r] = edges(b, y);
          if (r > l) expect((l + r) / 2).toBeCloseTo(b.xc, 9);
        }
      }
      for (const v of f.nodes) {
        expect(v.left).toBeCloseTo(v.xc - v.width / 2, 9);
        for (let i = 0; i <= 50; i++) expect(nodeLeftAt(v, v.y + ((v.forkY - v.y) * i) / 50)).toBeCloseTo(v.left, 9);
        // A parent column's centre: the width-weighted mean of its daughters' (their widths at its split).
        const kw = v.kids.map((k) => (isNode(k) ? k.width : k.baseW));
        expect(v.xc).toBeCloseTo(v.kids.reduce((a, k, i) => a + kw[i] * k.xc, 0) / kw.reduce((a, w) => a + w, 0), 9);
      }
      // The stem: centred, straight down to the bottom of the world.
      expect(f.trunkBottom.x).toBe(f.root.xc);
      expect(nodeLeftAt(f.root, f.trunkBottom.y)).toBe(f.root.left);
    });

    it(`forks: the daughters' sub-intervals tile the parent at the split, then slant straight out over one span (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const yNow = f.time.y(0);
      for (const v of f.nodes) {
        expect(v.fork).toBeGreaterThan(0);
        expect(v.fork).toBeLessThanOrEqual(FORK_FRAC * (v.y - yNow) + 1e-9);
        let x = v.left;
        for (const k of v.kids) {
          expect(k.forkY).toBeCloseTo(v.y - v.fork, 9);
          expect(k.subOff).toBeCloseTo(x - v.left, 9);
          // Just above the split: exactly its sub-interval.
          const ya = v.y - 1e-9 * Math.max(1, Math.abs(v.y));
          const l = isNode(k) ? nodeLeftAt(k, v.y) : leftAt(k, ya);
          const w = isNode(k) ? k.width : laneAt(k, ya).w;
          expect(l).toBeCloseTo(x, 6);
          x += w;
          // A daughter split's own split is above its fork; a species' fork is within its life.
          if (isNode(k)) expect(k.y).toBeLessThan(k.forkY);
          else expect(k.tipY).toBeLessThan(k.forkY);
        }
        expect(x).toBeCloseTo(v.left + v.width, 6);
      }
      // Straight: in linear widths the left edge is linear between knots (the fork's top among them).
      if (mode === 'linear') {
        for (const b of f.branches) {
          const ks = [b.tipY, ...f.steps.bounds(b), b.splitY].filter((y) => y <= b.splitY);
          for (let i = 0; i + 1 < ks.length; i++) {
            const [a, c] = [ks[i], ks[i + 1]];
            if (!(c - a > 1e-6)) continue;
            const e = (c - a) * 1e-6;
            const la = leftAt(b, a + e);
            const lc = leftAt(b, c - e);
            const lm = leftAt(b, (a + c) / 2);
            expect(Math.abs(lm - (la + lc) / 2)).toBeLessThan(1e-6 * Math.max(1, b.width));
          }
        }
      }
    });

    it(`no two columns overlap at any height: the forks open as Vs and never cross (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const ys = new Set<number>();
      for (const b of f.branches) for (const y of events(f, b)) for (const d of [-0.5, -0.05, 0.05, 0.5]) ys.add(y + d);
      for (let i = 0; i <= 3000; i++) ys.add(f.time.y(0) + ((f.trunkBottom.y - f.time.y(0)) * Math.pow(i / 3000, 3)));
      for (const y of ys) {
        const cs = columnsAt(f, y)
          .filter(([l, r]) => r > l)
          .sort((p, q) => p[0] - q[0]);
        for (let i = 0; i + 1 < cs.length; i++) expect(cs[i][1]).toBeLessThanOrEqual(cs[i + 1][0] + 1e-9 * Math.max(1, Math.abs(cs[i][1])));
      }
    });

    it(`an extinct species forks off and ends in a taper, pinched to 0 at its last appearance (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const b of f.branches.filter((x) => x.sp.extinct)) {
        expect(laneAt(b, b.tipY).w).toBe(0);
        // Narrowing towards the tip over the taper, monotonically.
        let prev = 0;
        for (let i = 0; i <= 100; i++) {
          const y = b.tipY + ((b.forkY - b.tipY) * i) / 100;
          const w = laneAt(b, y).w;
          expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = w;
        }
        // Full width again before its fork: the taper and the fork never meet.
        expect(laneAt(b, b.forkY).w).toBeCloseTo(b.baseW, 9);
        // Nobody after its last appearance.
        expect(b.pop.aliveAt(b.sp.t1 * 0.999)).toBe(0);
      }
    });

    it(`the gaps between the species' slots are fixed (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const tree = [...f.branches].sort((p, q) => p.index - q.index);
      for (let j = 1; j < tree.length; j++) {
        const gap = gapBetween(tree[j - 1], tree[j], f.trunkWidth);
        expect(tree[j].colLeft - (tree[j - 1].colLeft + tree[j - 1].width)).toBeCloseTo(gap, 9);
        expect(gap).toBeGreaterThanOrEqual(Math.max(GAP_FRAC * Math.min(tree[j - 1].width, tree[j].width), MIN_GAP_FRAC * f.trunkWidth) - 1e-12);
      }
    });
  }

  it('a population change is a ramp, linear in log time between the history\'s points, never a stair', () => {
    const lion = PANTHERA.species.find((s) => s.common === 'Lion')!;
    const p = population(lion, 0.5);
    const ks = p.knots;
    expect(ks.length).toBeGreaterThan(10);
    const dexMa = (a: number) => Math.log10(a * 1e6 + TIME_C);
    const back = (d: number) => (Math.pow(10, d) - TIME_C) / 1e6;
    let ramps = 0;
    for (let i = 0; i + 1 < ks.length; i++) {
      const [a, c] = [ks[i], ks[i + 1]];
      const m = back((dexMa(a) + dexMa(c)) / 2);
      const na = p.aliveAt(a);
      const nc = p.aliveAt(c);
      expect(p.aliveAt(m)).toBeCloseTo((na + nc) / 2, 6);
      if (Math.abs(na - nc) > 1) ramps++;
    }
    expect(ramps).toBeGreaterThan(5);
  });
});
