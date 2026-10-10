import { describe, expect, it } from 'vitest';
import { clipPoly, FanCamera, MAX_YEARS_FRAC, MIN_YEARS, MIN_ZOOM, STRAND_PX } from './camera';
import { laneAt, layoutFan, leftAt, Steps, strandAt, type FanBranch, type WidthMode } from './layout';
import { PANTHERA } from './panthera';
import { TwigModel } from './twigs';

function camera(mode: WidthMode = 'linear'): FanCamera {
  const fan = layoutFan(PANTHERA, mode);
  const models = new Map<FanBranch, TwigModel>();
  const model = (b: FanBranch) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, mode)));
    return m;
  };
  const c = new FanCamera(fan, model);
  c.w = 390;
  c.h = 844;
  c.cam = c.home();
  c.settle();
  return c;
}

/**
 * Screen height (px) of the tallest 10-year span on screen, measured
 * independently of the camera: scan the screen in 1 px steps for the shortest
 * pixel run holding 10 years (years are tallest at the top, but scan anyway).
 */
function tallestTenYears(c: FanCamera): number {
  const yrs = (py: number) => c.years(c.toWorld(0, py)[1]);
  let best = 0;
  for (let p0 = 0; p0 < c.h; p0 += 4) {
    const y0 = yrs(p0);
    let lo = p0;
    let hi = p0 + 4 * c.h;
    if (yrs(Math.min(hi, c.h)) - y0 < MIN_YEARS && hi > c.h) continue;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (yrs(m) - y0 >= MIN_YEARS) hi = m;
      else lo = m;
    }
    if (hi <= c.h) best = Math.max(best, hi - p0);
  }
  return best;
}

/** A pseudo-random gesture sequence: pinches, pans and fingers anywhere. */
function* gestures(seed: number): Generator<(c: FanCamera) => void> {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 400; k++) {
    const px = rnd() * 390;
    const py = rnd() * 844;
    const r = rnd();
    if (r < 0.5) {
      const f = Math.exp((rnd() - 0.25) * 3);
      yield (c) => c.zoomAbout(px, py, f);
    } else if (r < 0.6) {
      // Time-only zoom (wheel with a modifier), hard.
      const f = Math.exp(rnd() * 4);
      yield (c) => c.zoomAbout(px, py, 1, f);
    } else yield (c) => c.pan((rnd() - 0.5) * 900, (rnd() - 0.5) * 1800);
  }
}

describe('fan camera', () => {
  it('never rotates or shears: screen x depends only on world x, y only on world y', () => {
    const c = camera();
    for (const g of gestures(7)) {
      g(c);
      const { cx, cy } = c.cam;
      const [x0, y0] = c.toScreen(cx, cy);
      const [x1, y1] = c.toScreen(cx, cy + 50 / c.cam.sy);
      const [x2, y2] = c.toScreen(cx + 50 / c.cam.sx, cy);
      expect(x1).toBe(x0);
      expect(y2).toBe(y0);
      expect(y1 - y0).toBeCloseTo(50, 1);
      expect(x2 - x0).toBeCloseTo(50, 1);
      const [wx, wy] = c.toWorld(...c.toScreen(cx + 3 / c.cam.sx, cy - 7 / c.cam.sy));
      // Within float64 rounding of the world coordinates (a few ulps of |cx|, in px at sx).
      const ulps = (v: number, s: number) => 8 * Number.EPSILON * Math.max(1, Math.abs(v)) * s;
      expect(Math.abs((wx - cx) * c.cam.sx - 3)).toBeLessThanOrEqual(0.005 + ulps(cx, c.cam.sx));
      expect(Math.abs((wy - cy) * c.cam.sy + 7)).toBeLessThanOrEqual(0.005 + ulps(cy, c.cam.sy));
    }
  });

  for (const mode of ['linear', 'log'] as WidthMode[]) {
    it(`keeps at least ${MIN_YEARS} years on screen, the fan in reach, and finite numbers (${mode})`, () => {
      const c = camera(mode);
      const [sxMin, syMin] = [c.home().sx * MIN_ZOOM, c.home().sy * MIN_ZOOM];
      const [x0, x1] = c.extent();
      for (const seed of [1, 2, 3]) {
        c.cam = c.home();
        for (const g of gestures(seed)) {
          g(c);
          const k = c.cam;
          for (const v of [k.cx, k.cy, k.sx, k.sy, k.ty]) expect(Number.isFinite(v)).toBe(true);
          expect(tallestTenYears(c)).toBeLessThanOrEqual(MAX_YEARS_FRAC * c.h * 1.001);
          const yrs = c.years(c.toWorld(0, c.h)[1]) - c.years(c.toWorld(0, 0)[1]);
          expect(yrs).toBeGreaterThanOrEqual((MIN_YEARS / MAX_YEARS_FRAC) * 0.999);
          expect(k.sx).toBeGreaterThanOrEqual(sxMin * 0.999);
          expect(k.sy).toBeGreaterThanOrEqual(syMin * 0.999);
          // Content stays near the centre, and "now" / the stem's end stay in reach.
          const near = c.nearestContent(k.cx, Math.max(c.yNow, k.cy - c.h / 2 / k.sy), k.cy + c.h / 2 / k.sy);
          expect(Math.abs(c.toScreen(near, 0)[0] - c.w / 2)).toBeLessThanOrEqual(0.4 * c.w + 1e-3);
          expect(near).toBeGreaterThanOrEqual(x0 - 1e-9);
          expect(near).toBeLessThanOrEqual(x1 + 1e-9);
          expect(c.toScreen(0, c.yNow)[1]).toBeLessThanOrEqual(0.4 * c.h + 1e-6);
          expect(c.toScreen(0, c.fan.trunkBottom.y)[1]).toBeGreaterThanOrEqual(0.6 * c.h - 1e-6);
        }
      }
    });
  }

  it('zooming out stops at the whole fan with a margin', () => {
    const c = camera();
    for (let k = 0; k < 50; k++) c.zoomAbout(100, 700, 0.5);
    const h = c.home();
    expect(c.cam.sx).toBeCloseTo(h.sx * MIN_ZOOM, 9);
    expect(c.cam.sy).toBeCloseTo(h.sy * MIN_ZOOM, 9);
    const [x0, x1] = c.extent();
    expect(c.toScreen(x0, 0)[0]).toBeGreaterThan(0);
    expect(c.toScreen(x1, 0)[0]).toBeLessThan(c.w);
  });

  it('zooming in undoes zooming out, and 10 years stop at 10% of the screen', () => {
    const c = camera();
    // Near "now", inside the lion's green lane.
    const lion = c.fan.branches.find((b) => b.sp.common === 'Lion')!;
    c.cam = { ...c.cam, cx: leftAt(lion, c.yNow + 3) + 1e-9, cy: c.yNow + 3 };
    c.settle();
    for (let k = 0; k < 120; k++) c.zoomAbout(c.w / 2, c.h / 2, 1.5);
    expect(tallestTenYears(c) / (MAX_YEARS_FRAC * c.h)).toBeCloseTo(1, 3);
    // The width stops at the strands' legible spacing (never further than STRAND_PX per thinnest cell).
    const cap = c.sxCap(c.cam.cx, c.cam.cy, c.cam.sy);
    expect(c.cam.sx).toBeLessThanOrEqual(cap * (1 + 1e-9));
    expect(STRAND_PX / c.cam.sx).toBeGreaterThan(0);
  });

  for (const mode of ['linear', 'log'] as WidthMode[]) {
    it(`a smooth zoom-in never jumps: the point under the finger stays under it (${mode})`, () => {
      const c = camera(mode);
      const f = c.fan;
      const at = (common: string) => f.branches.find((b) => b.sp.common === common)!;
      // Start points: lion's green and gray lanes near "now", mid-way, near the fork; the tiger deep in the past.
      const starts: [FanBranch, number, number][] = [];
      for (const [b, y] of [
        [at('Lion'), f.time.y(50e-6)],
        [at('Lion'), f.time.y(0.05)],
        [at('Lion'), -20],
        [at('Tiger'), f.time.y(1.5)],
      ] as const) {
        for (const u of [0.5, 2]) starts.push([b, y, u]);
      }
      let worst = 0;
      for (const [b, wy0, u] of starts) {
        c.cam = c.home();
        c.settle();
        const L = new TwigModel(b, f.time, mode).lanes(wy0);
        // u < 1: across the green lane; u ≥ 1: into the gray lane.
        const wx0 = u < 1 ? L.left + L.gw * u : L.left + L.gw + (L.w - L.gw) * (u - 1.7);
        const px = c.w * 0.4;
        const py = c.h * 0.55;
        c.cam = { ...c.cam, cx: wx0 - (px - c.w / 2) / c.cam.sx, cy: wy0 - (py - c.h / 2) / c.cam.sy };
        c.settle();
        for (const step of [1.03, 1.2]) {
          for (let k = 0; k < 300; k++) {
            const [wx, wy] = c.toWorld(px, py);
            const before = { ...c.cam };
            c.zoomAbout(px, py, step);
            expect(c.cam.sx / before.sx).toBeLessThanOrEqual(step * (1 + 1e-9));
            expect(c.cam.sy / before.sy).toBeLessThanOrEqual(step * (1 + 1e-9));
            const [qx, qy] = c.toScreen(wx, wy);
            const moved = Math.hypot(qx - px, qy - py);
            worst = Math.max(worst, moved);
            // The point under the finger stays under it (clampPan only holds the view back, it never pulls).
            expect(moved).toBeLessThan(2);
          }
        }
      }
      expect(worst).toBeLessThan(2);
    });
  }

  it('clips ribbons to the screen in float64 (no far-off coordinates reach the canvas)', () => {
    // A thin sliver from far left to far right through the screen, and one entirely off screen.
    const [xs, ys] = clipPoly([-1e12, 1e12, 1e12, -1e12], [100, 101, 103, 102], 0, 0, 390, 844);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    for (const x of xs) expect(x >= 0 && x <= 390).toBe(true);
    for (const y of ys) expect(y > 100 && y < 103).toBe(true);
    expect(clipPoly([-5e9, -4e9, -4e9], [0, 0, 1e9], 0, 0, 390, 844)[0].length).toBe(0);
  });

  for (const mode of ['linear', 'log'] as WidthMode[]) {
    it(`the geometry is fixed in world units: panning and zooming never change a shape (${mode})`, () => {
      const c = camera(mode);
      const f = c.fan;
      const sample = () =>
        f.branches.flatMap((b) =>
          [0.999, 0.9, 0.5, 0.1, 0.01, 0.0005].map((u) => {
            const y = b.tipY * u;
            const L = laneAt(b, y);
            return [leftAt(b, y), L.w, L.gw];
          }),
        );
      const sy0 = c.cam.sy;
      const ref = sample();
      for (const g of gestures(11)) {
        g(c);
        // Left edges never depend on the camera; the lanes' edges only on the step grid
        // (the time zoom), so at the same grid everything is identical.
        const now = sample();
        for (let i = 0; i < ref.length; i++) expect(now[i][0]).toBe(ref[i][0]);
        const sy = c.cam.sy;
        f.steps.setScale(sy0);
        expect(sample()).toEqual(ref);
        f.steps.setScale(sy);
      }
      // Sideways pans don't even change the time zoom: nothing changes at all.
      c.cam = c.home();
      c.settle();
      const before = sample();
      for (let k = 0; k < 40; k++) c.pan(k % 2 ? 37 : -23, 0);
      expect(sample()).toEqual(before);
    });

    it(`scripted smooth pinches and pans never jump, and the step grid never flip-flops (${mode})`, () => {
      const c = camera(mode);
      const f = c.fan;
      const lion = f.branches.find((b) => b.sp.common === 'Lion')!;
      const tiger = f.branches.find((b) => b.sp.common === 'Tiger')!;
      // Overview, mid, deep, near "now", near the stem's base.
      const places: [FanBranch, number][] = [
        [lion, f.time.y(0.5)],
        [lion, f.time.y(0.01)],
        [tiger, f.time.y(1.5)],
        [lion, f.time.y(20e-6)],
        [lion, -3],
      ];
      for (const [b, wy] of places) {
        c.cam = c.home();
        c.settle();
        const L = laneAt(b, wy);
        const wx = leftAt(b, wy) + L.gw + (L.w - L.gw) * 0.5;
        const px = c.w * 0.5;
        const py = c.h * 0.5;
        c.cam = { ...c.cam, cx: wx - (px - c.w / 2) / c.cam.sx, cy: wy - (py - c.h / 2) / c.cam.sy };
        c.settle();
        // In, out, in again: 1.04× per frame, like a smooth pinch; then a pan sweep.
        const lvl: number[] = [];
        const dirs: number[] = [];
        for (const [step, n] of [
          [1.04, 260],
          [1 / 1.04, 260],
          [1.04, 120],
        ] as const) {
          for (let k = 0; k < n; k++) {
            const [qx, qy] = c.toWorld(px, py);
            const before = { ...c.cam };
            c.zoomAbout(px, py, step);
            const after = c.cam;
            // No camera jumps: the scale changes by at most the step, the point under the fingers stays.
            for (const r of [after.sx / before.sx, after.sy / before.sy]) {
              expect(r).toBeLessThanOrEqual(Math.max(step, 1 / step) * (1 + 1e-9));
              expect(r).toBeGreaterThanOrEqual(Math.min(step, 1 / step) * (1 - 1e-9));
            }
            const [sx2, sy2] = c.toScreen(qx, qy);
            // (Zooming out near "now", the pan clamp holds "now" at 40% down, which moves the
            // point by no more than the step itself would have moved the screen's edge.)
            expect(Math.hypot(sx2 - px, sy2 - py)).toBeLessThan(Math.max(2, Math.abs(1 - 1 / step) * c.h));
            lvl.push(f.steps.k + f.steps.t);
            dirs.push(step > 1 ? 1 : -1);
          }
        }
        // The step grid follows the zoom monotonically: finer zooming in, coarser zooming out, never back and forth.
        for (let i = 1; i < lvl.length; i++) {
          if (dirs[i] > 0) expect(lvl[i]).toBeGreaterThanOrEqual(lvl[i - 1] - 1e-12);
          else expect(lvl[i]).toBeLessThanOrEqual(lvl[i - 1] + 1e-12);
        }
        // A pan sweep moves the camera by exactly what was asked (no snapping), until the clamp holds it.
        for (let k = 0; k < 60; k++) {
          const before = { ...c.cam };
          c.pan(3, 0);
          const moved = (before.cx - c.cam.cx) * c.cam.sx;
          expect(moved).toBeLessThanOrEqual(3 + 1e-6);
          expect(moved).toBeGreaterThanOrEqual(-1e-6);
          expect(c.cam.sx).toBe(before.sx);
        }
      }
    });
  }

  it('the gray edge morphs between step grids over a zoom, never pops', () => {
    const f = layoutFan(PANTHERA, 'linear');
    const lion = f.branches.find((b) => b.sp.common === 'Lion')!;
    const ys = Array.from({ length: 50 }, (_, i) => lion.tipY * ((i + 0.5) / 50));
    let prev: number[] | null = null;
    for (let z = 0; z <= 2000; z++) {
      f.steps.setScale(0.5 * Math.pow(1.005, z));
      const w = ys.map((y) => laneAt(lion, y).w);
      if (prev) for (let i = 0; i < w.length; i++) expect(Math.abs(w[i] - prev[i])).toBeLessThan(0.05 * lion.width);
      prev = w;
    }
    expect(Steps.dy(3)).toBeCloseTo(Steps.dy(4) * 2, 12);
    void strandAt;
  });
});
