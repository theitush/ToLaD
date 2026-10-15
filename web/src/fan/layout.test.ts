import { describe, expect, it } from 'vitest';
import { columnsAt, g, GAP_FRAC, isNode, laneAt, layoutFan, layoutSeed, leftAt, MIN_GAP_FRAC, nodeLeftAt, segAt, strandAt, TIME_H, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE } from './splits';

describe('fan strands: width = alive at the time', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`a strand is the individuals alive then, the green share those with living descendants (${mode})`, () => {
      const fan = layoutFan(FELIDAE, mode);
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
          // (to procgen's integer rounding and the quantization of both EVER, which scales the curve, and
          // ALIV: LOG16 steps of 0.23%, so up to two half-steps, 0.23%, apart)
          expect(Math.abs(b.pop.aliveAt(0) - sp.alive)).toBeLessThanOrEqual(Math.max(50, 2.5e-3 * sp.alive));
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

describe('the fan, both designs: fixed, continuous, honest', () => {
  const seeded = (seed: number) => {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`width = N(t) × one fixed scale, exactly, at every height; green = its share (${mode})`, () => {
      const fan = layoutFan(FELIDAE, mode);
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

    // Straight + log was `it.fails` for the too-steep leans at the crowded Felidae splits (#102); it passes since
    // ToLaD#143's natural anchor rebuilt the leopard's and cougar's deep pasts (both wider before 1500), so the
    // data no longer trips it. #102 itself (the design's lean rule) is not fixed by this.
    it(`every edge is a continuous function of time: edges and the lanes' boundary, no jog at a split, no step at a population change (${mode})`, () => {
      const fan = layoutFan(FELIDAE, mode);
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
          // (A hair of the column's own width, plus the hair of movement any edge may make at the
          // bounded slope below: a column far narrower than the rest still moves sideways with them.)
          for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - c[k])).toBeLessThan(1e-4 * w + 12 * 2e-7);
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

    it(`columns are symmetric about fixed centres, sister species packed as close as the gap allows at some height, and never overlap (${mode})`, () => {
      const fan = layoutFan(FELIDAE, mode);
      const W = fan.trunkWidth;
      const bs = [...fan.branches].sort((p, q) => p.index - q.index);
      // Curved: two sister species as close as the gap lets them be at their closest height (their columns at their own
      // places: GAP_FRAC of the narrower there, at least MIN_GAP_FRAC of the stem's; a hair more for the packing's cells).
      for (const v of fan.nodes) for (let i = 1; i < v.kids.length; i++) {
        const p = v.kids[i - 1];
        const q = v.kids[i];
        if (isNode(p) || isNode(q)) continue;
        let best = Infinity;
        let allow = 0;
        const y0 = Math.max(-TIME_H, Math.min(p.tipY, q.tipY));
        for (let k = 0; k <= 4000; k++) {
          const y = y0 + ((v.y - y0) * k) / 4000;
          if (y < p.tipY || y < q.tipY) continue;
          const wp = laneAt(p, Math.min(y, v.y - 1e-9)).w;
          const wq = laneAt(q, Math.min(y, v.y - 1e-9)).w;
          const c = q.cx - p.cx - (wp + wq) / 2;
          if (c < best) {
            best = c;
            allow = Math.max(GAP_FRAC * Math.min(wp, wq), MIN_GAP_FRAC * W);
          }
        }
        expect(best).toBeGreaterThanOrEqual(0.9 * allow);
        expect(best).toBeLessThanOrEqual(allow + 0.01 * W);
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
          } else if (y <= b.leanY) {
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


describe('Tess: culling and thinning (the draw path, #32)', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`xRange holds the strand at every height in the range (${mode})`, () => {
      const fan = layoutFan(FELIDAE, mode);
      const yb = fan.trunkBottom.y;
      // Ranges from the whole world down to a few years near now, and about each split.
      const ranges: [number, number][] = [
        [-TIME_H, yb],
        [-TIME_H, -TIME_H + 2],
        [-TIME_H + 0.01, -TIME_H + 0.05],
        [-800, -600],
        [-300, 50],
      ];
      for (const v of fan.nodes) ranges.push([v.y - 3, v.y + 3]);
      for (const b of fan.branches) {
        for (const [y0, y1] of ranges) {
          const [L, R] = fan.tess.xRange(b, y0, y1);
          for (let k = 0; k <= 400; k++) {
            const y = y0 + ((y1 - y0) * k) / 400;
            if (y < b.tipY || y > yb) continue;
            const w = laneAt(b, y).w;
            if (!(w > 0)) continue;
            const x = leftAt(b, y);
            expect(x).toBeGreaterThanOrEqual(L);
            expect(x + w).toBeLessThanOrEqual(R);
          }
        }
      }
    });
  }

  it('cuts: ascending, at most maxPx apart, every split kept, sub-px features thinned', () => {
    const fan = layoutFan(FELIDAE, 'linear');
    const yb = fan.trunkBottom.y;
    let thinned = 0;
    for (const b of fan.branches) {
      for (const sy of [0.7, 5, 300]) {
        // (A screen's height or so: the whole world at 0.7 px per unit.)
        const u = fan.tess.cuts(b, -TIME_H, Math.min(yb, -TIME_H + 1300 / sy), sy, 4);
        if (u.length < 2) continue;
        const a = u[0];
        const z = u[u.length - 1];
        for (let k = 1; k < u.length; k++) {
          expect(u[k]).toBeGreaterThan(u[k - 1]);
          expect((u[k] - u[k - 1]) * sy).toBeLessThanOrEqual(4 + 1e-9);
        }
        const set = new Set(u);
        for (const s of b.path) if (s.y > a && s.y < z) expect(set.has(s.y)).toBe(true);
        // At most the grid (2–4 px apart), a feature per dyadic cell (½–1 px), and the splits.
        expect(u.length).toBeLessThanOrEqual((z - a) * sy * 2.5 + b.path.length + 4);
        thinned += fan.tess.bounds(b).filter((y) => y > a && y < z && !set.has(y)).length;
      }
    }
    expect(thinned).toBeGreaterThan(0);
  });
});

describe('the build-time layout seed (ToLaD#255)', () => {
  it('a seeded layout is the worked-out one, number for number, and other designs still take its sides', () => {
    const seed = JSON.parse(JSON.stringify(layoutSeed(CARNIVORA, CARNIVORA_TREE)));
    expect(seed.flips.length).toBeGreaterThan(0);
    const plain = { ...CARNIVORA };
    const seeded = { ...CARNIVORA, seed };
    const pick = (f: ReturnType<typeof layoutFan>) => ({
      nodes: f.nodes.map((v) => [v.name, v.left, v.cx, v.blend, v.leanY, v.tile, v.width, v.kids.map((k) => (isNode(k) ? k.name : k.sp.sci)).join()]),
      branches: f.branches.map((b) => [b.sp.sci, b.index, b.cx, b.colLeft, b.x0, b.leanY, b.width, b.path.map((p) => [p.y, p.left, p.off, p.w, p.gAbove])]),
      ext: [f.x0, f.x1, f.stem, f.trunkBottom],
    });
    for (const mode of ['linear', 'log'] as WidthMode[])
      expect(pick(layoutFan(seeded, mode, CARNIVORA_TREE))).toEqual(pick(layoutFan(plain, mode, CARNIVORA_TREE)));
    // A seed that does not fit the tree is not taken.
    const bad = { ...CARNIVORA, seed: { ...seed, leaf: seed.leaf.slice(3) } };
    expect(pick(layoutFan(bad, 'linear', CARNIVORA_TREE))).toEqual(pick(layoutFan(plain, 'linear', CARNIVORA_TREE)));
  });
});
