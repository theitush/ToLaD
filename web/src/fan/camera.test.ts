import { describe, expect, it } from 'vitest';
import { clipPoly, FanCamera, MAX_YEARS_FRAC, MIN_YEARS, MIN_ZOOM, STRAND_PX } from './camera';
import { GAP_PX, layoutFan, leftAt, strandAt, type FanBranch, type WidthMode } from './layout';
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
            const a = f.pack.anchor(wx, wy);
            const before = { ...c.cam };
            c.zoomAbout(px, py, step);
            expect(c.cam.sx / before.sx).toBeLessThanOrEqual(step * (1 + 1e-9));
            expect(c.cam.sy / before.sy).toBeLessThanOrEqual(step * (1 + 1e-9));
            const [qx, qy] = c.toScreen(f.pack.resolve(a, wx, wy), wy);
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
    it(`zoomed in, neighbours that fit on screen are there, packed; the branch looked at stands upright (${mode})`, () => {
      const c = camera(mode);
      const f = c.fan;
      const lion = f.branches.find((b) => b.sp.common === 'Lion')!;
      let fits = 0;
      for (const [ago, px] of [
        [30e-6, 40],
        [200e-6, 40],
        [200e-6, 150],
        [0.01, 120],
        [1, 200],
      ]) {
        const y = f.time.y(ago);
        const w = strandAt(lion, ago, mode).w;
        // The lion `px` wide on screen, centred.
        const green = strandAt(lion, ago, mode).f > 0.5;
        c.cam = { ...c.cam, sx: px / w, cx: leftAt(lion, y) + w / 2, cy: y };
        c.settle();
        const yc = c.cam.cy;
        const age = f.time.ageAt(yc);
        const vis = f.branches.filter((b) => yc >= b.tipY);
        const iv = vis.map((b) => {
          const l = c.toScreen(leftAt(b, yc), yc)[0];
          return [l, l + strandAt(b, age, mode).w * c.cam.sx];
        });
        // Packed: GAP_PX apart on screen, never overlapping.
        for (let k = 1; k < iv.length; k++) {
          expect(iv[k][0] - iv[k - 1][1]).toBeGreaterThanOrEqual(-1e-6);
          expect(iv[k][0] - iv[k - 1][1]).toBeLessThanOrEqual(GAP_PX * 1.01);
        }
        // Every neighbour whose packed run from the lion fits on screen is on screen.
        const li = vis.indexOf(lion);
        const L = iv[li];
        expect(L[0]).toBeLessThanOrEqual(c.w / 2 + 1e-6);
        expect(L[1]).toBeGreaterThanOrEqual(c.w / 2 - 1e-6);
        for (let k = li + 1, x = L[1]; k < iv.length; k++) {
          x += GAP_PX + (iv[k][1] - iv[k][0]);
          if (x > c.w) break;
          expect(iv[k][1]).toBeLessThanOrEqual(c.w + 1e-6);
          fits++;
        }
        for (let k = li - 1, x = L[0]; k >= 0; k--) {
          x -= GAP_PX + (iv[k][1] - iv[k][0]);
          if (x < 0) break;
          expect(iv[k][0]).toBeGreaterThanOrEqual(-1e-6);
          fits++;
        }
        // Deep in, with the centre in the lion's green lane, that lane (its left edge) is upright on screen.
        if (green && f.pack.fade() === 0) {
          const [, yTop] = c.toWorld(0, 0);
          const [, yBot] = c.toWorld(0, c.h);
          const xs = [yTop, yc, yBot].filter((v) => v >= lion.tipY && v < 0).map((v) => c.toScreen(leftAt(lion, v), v)[0]);
          for (const x of xs) expect(x).toBeCloseTo(xs[0], 3);
        }
      }
      expect(fits).toBeGreaterThan(0);
    });
  }
});
