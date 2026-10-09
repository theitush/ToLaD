import { describe, expect, it } from 'vitest';
import { clipPoly, FanCamera, MIN_YEARS, MIN_ZOOM, STRAND_PX } from './camera';
import { layoutFan, type FanBranch, type WidthMode } from './layout';
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

/** A pseudo-random gesture sequence: pinches, pans and fingers anywhere. */
function* gestures(seed: number): Generator<(c: FanCamera) => void> {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 400; k++) {
    const px = rnd() * 390;
    const py = rnd() * 844;
    const r = rnd();
    if (r < 0.6) {
      const f = Math.exp((rnd() - 0.25) * 3);
      yield (c) => c.zoomAbout(px, py, f);
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
      expect((wx - cx) * c.cam.sx).toBeCloseTo(3, 2);
      expect((wy - cy) * c.cam.sy).toBeCloseTo(-7, 2);
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
          const yrs = c.years(c.toWorld(0, c.h)[1]) - c.years(c.toWorld(0, 0)[1]);
          expect(yrs).toBeGreaterThanOrEqual(MIN_YEARS * 0.999);
          expect(k.sx).toBeGreaterThanOrEqual(sxMin * 0.999);
          expect(k.sy).toBeGreaterThanOrEqual(syMin * 0.999);
          // Some of the fan's width stays on screen, and "now" / the stem's end stay in reach.
          const [l] = c.toScreen(x1, 0);
          const [r] = c.toScreen(x0, 0);
          expect(l).toBeGreaterThan(0.3 * c.w - 1e-6);
          expect(r).toBeLessThan(0.7 * c.w + 1e-6);
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

  it('zooming in undoes zooming out, and the time zoom stops at 10 years', () => {
    const c = camera();
    // Near "now", inside the lion's green lane.
    const lion = c.fan.branches.find((b) => b.sp.common === 'Lion')!;
    c.cam = { ...c.cam, cx: lion.colX - lion.width / 2 + 1e-9, cy: c.yNow + 3 };
    c.settle();
    for (let k = 0; k < 120; k++) c.zoomAbout(c.w / 2, c.h / 2, 1.5);
    const yrs = c.years(c.toWorld(0, c.h)[1]) - c.years(c.toWorld(0, 0)[1]);
    expect(yrs).toBeCloseTo(MIN_YEARS, 3);
    // The width stops at the strands' legible spacing (never further than STRAND_PX per thinnest cell).
    const cap = c.sxCap(c.cam.cx, c.cam.cy, c.cam.sy);
    expect(c.cam.sx).toBeLessThanOrEqual(cap * (1 + 1e-9));
    expect(STRAND_PX / c.cam.sx).toBeGreaterThan(0);
  });

  it('clips ribbons to the screen in float64 (no far-off coordinates reach the canvas)', () => {
    // A thin sliver from far left to far right through the screen, and one entirely off screen.
    const [xs, ys] = clipPoly([-1e12, 1e12, 1e12, -1e12], [100, 101, 103, 102], 0, 0, 390, 844);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    for (const x of xs) expect(x >= 0 && x <= 390).toBe(true);
    for (const y of ys) expect(y > 100 && y < 103).toBe(true);
    expect(clipPoly([-5e9, -4e9, -4e9], [0, 0, 1e9], 0, 0, 390, 844)[0].length).toBe(0);
  });
});
