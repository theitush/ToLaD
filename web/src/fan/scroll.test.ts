// Issue #29: the time scale jumped on a wheel notch at max zoom, and the stem
// stopped at the clade's origin.
import { describe, expect, it } from 'vitest';
import { FanCamera, MAX_YEARS_FRAC, MIN_YEARS } from './camera';
import { laneAt, layoutFan, leftAt, type FanBranch } from './layout';
import { PANTHERA } from './panthera';
import { TwigModel } from './twigs';

function camera(): FanCamera {
  const fan = layoutFan(PANTHERA, 'linear');
  const models = new Map<FanBranch, TwigModel>();
  const model = (b: FanBranch) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, 'linear')));
    return m;
  };
  const c = new FanCamera(fan, model);
  c.w = 390;
  c.h = 844;
  c.cam = c.home();
  c.settle();
  return c;
}

/** Screen height (px) of the tallest 10-year span on screen (years are tallest at the top). */
function topTenYears(c: FanCamera): number {
  const yrs = (py: number) => c.years(c.toWorld(0, py)[1]);
  const y0 = yrs(0);
  let lo = 0;
  let hi = 4 * c.h;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (yrs(m) - y0 >= MIN_YEARS) hi = m;
    else lo = m;
  }
  return hi;
}

/** Years ago at the screen's top and bottom edges. */
const win = (c: FanCamera) => [c.years(c.toWorld(0, 0)[1]), c.years(c.toWorld(0, c.h)[1])];

/** Fully zoomed in time with about `ageYears` at the top of the screen. */
function atMax(c: FanCamera, ageYears: number): void {
  c.cam = c.home();
  c.settle();
  const lion = c.fan.branches.find((b) => b.sp.common === 'Lion')!;
  const y = c.fan.time.y(ageYears / 1e6);
  // Far too deep a time zoom with the top edge at that age: settle() drops it to the limit about the top.
  c.cam = { ...c.cam, cx: leftAt(lion, y) + 1e-9, cy: y + c.h / 2 / 1e6, sy: 1e6, ty: 1e6 };
  c.settle();
  for (let k = 0; k < 60; k++) c.zoomAbout(c.w / 2, c.h / 2, 1.3);
}

/** Run one event; where the new view's top and bottom edges land in the old view's px, and the time zoom ratio. */
function edges(c: FanCamera, f: () => void): [number, number, number] {
  const [, t0] = c.toWorld(0, 0);
  const sy0 = c.cam.sy;
  f();
  const [, t1] = c.toWorld(0, 0);
  const [, b1] = c.toWorld(0, c.h);
  return [(t1 - t0) * sy0, (b1 - t0) * sy0, c.cam.sy / sy0];
}

describe('no time-scale jumps', () => {
  it('the reported case: at 360–450 years ago, one wheel notch either way stays near', () => {
    const c = camera();
    atMax(c, 360);
    const [a, b] = win(c);
    expect(a).toBeGreaterThan(300);
    expect(b).toBeLessThan(600);
    for (const f of [1.2, 1 / 1.2]) {
      for (const py of [0, 0.25 * c.h, 0.5 * c.h, 0.75 * c.h, c.h]) {
        atMax(c, 360);
        c.zoomAbout(c.w / 2, py, f);
        const [a1, b1] = win(c);
        expect(a1).toBeGreaterThan(250);
        expect(b1).toBeLessThan(800);
      }
    }
  });

  for (const age of [0, 30, 400, 5e4, 2e6, 4.5e6, 3e7]) {
    it(`scripted wheel, drag and scroll at max zoom near ${age} years ago move the view ≤ 1 screen per event`, () => {
      const c = camera();
      let s = 7 + age;
      const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
      atMax(c, age);
      for (let k = 0; k < 300; k++) {
        const r = rnd();
        const px = rnd() * c.w;
        const py = rnd() * c.h;
        const notch = rnd() < 0.5 ? 1.2 : 1 / 1.2; // engine/input.ts: exp(±100 · 0.002)
        const ev =
          r < 0.35
            ? () => c.zoomAbout(px, py, notch)
            : r < 0.5
              ? () => c.zoomAbout(px, py, 1, notch) // time only
              : () => c.pan((rnd() - 0.5) * 60, (rnd() - 0.5) * 1.6 * c.h); // a drag or a scroll
        const [top, bot, ratio] = edges(c, ev);
        // A wheel notch changes the time zoom by no more than it asked; a pan towards "now"
        // brings taller years to the top and lets the zoom drop, never by a jump ...
        expect(ratio).toBeGreaterThan(r < 0.5 ? 1 / 1.2 - 1e-6 : 0.5);
        expect(ratio).toBeLessThan(1.2 + 1e-6);
        // ... and the new view lies within a screen of the old one.
        expect(top).toBeGreaterThanOrEqual(-c.h * 1.0001);
        expect(bot).toBeLessThanOrEqual(2 * c.h + c.h * (1 / ratio - 1) + 1e-3);
        expect(topTenYears(c)).toBeLessThanOrEqual(MAX_YEARS_FRAC * c.h * 1.001);
        // Every few events, dive back in to stay at max zoom.
        if (k % 20 === 19) for (let j = 0; j < 30; j++) c.zoomAbout(c.w / 2, c.h / 2, 1.3);
      }
    });
  }

  it('zooming back out starts at once (no dead zone after zooming in past the limit)', () => {
    const c = camera();
    atMax(c, 400);
    const sy = c.cam.sy;
    for (let k = 0; k < 100; k++) c.zoomAbout(c.w / 2, c.h / 2, 1.5);
    c.zoomAbout(c.w / 2, c.h / 2, 1 / 1.2);
    expect(c.cam.sy).toBeLessThan(sy * 0.9);
  });
});

describe('the stem continues below the origin', () => {
  it('each strand goes straight down the stem to the bottom of the world at its founders\' width', () => {
    const c = camera();
    const f = c.fan;
    expect(f.time.ageAt(f.trunkBottom.y)).toBeGreaterThan(100 * f.time.originMa);
    for (const b of f.branches) {
      // Below the oldest split (the fork, y = 0): its place in the stem, at its founders' width.
      const s = b.path[b.path.length - 1];
      expect(s.node).toBe(f.root);
      const left = leftAt(b, f.trunkBottom.y);
      for (const y of [0, 1e-6, 0.5, 10, f.trunkBottom.y]) {
        expect(leftAt(b, y)).toBeCloseTo(left, 9);
        expect(laneAt(b, y).w).toBeCloseTo(b.baseW, 9);
      }
    }
    // Content below the fork is the stem: its strands side by side, no gaps.
    const cols = c.contentAt(1).sort((p, q) => p[0] - q[0]);
    expect(cols[0][0]).toBeCloseTo(f.stem[0], 9);
    expect(cols[cols.length - 1][1]).toBeCloseTo(f.stem[1], 9);
    for (let i = 1; i < cols.length; i++) expect(cols[i][0]).toBeCloseTo(cols[i - 1][1], 9);
  });

  it('panning down reaches the stem far below the origin', () => {
    const c = camera();
    for (let k = 0; k < 40; k++) c.zoomAbout(c.w / 2, c.h / 2, 0.7);
    for (let k = 0; k < 400; k++) c.pan(0, -200);
    const [, yBot] = c.toWorld(0, c.h);
    expect(c.fan.time.ageAt(yBot)).toBeGreaterThan(50 * c.fan.time.originMa);
  });
});
