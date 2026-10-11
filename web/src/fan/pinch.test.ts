// Issue #138: width and time zoom separately. A sideways pinch zooms width
// only, an upright one time only, a diagonal one both; shift+wheel width only,
// alt+wheel time only. Driven through the real gesture handler (engine/input.ts)
// with synthetic pointer and wheel events, into the fan's camera.
import { describe, expect, it } from 'vitest';
import { Input, PINCH_DEAD_PX } from '../engine/input';
import { FanCamera } from './camera';
import { layoutFan, type FanBranch } from './layout';
import { FELIDAE } from './panthera';
import { TwigModel } from './twigs';

(globalThis as { window?: unknown }).window ??= globalThis;

function camera(): FanCamera {
  const fan = layoutFan(FELIDAE, 'linear');
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

type Listener = (e: unknown) => void;

/** A canvas stand-in that records listeners, and the fan view's handlers (view.ts) on a camera. */
function rig() {
  const c = camera();
  const on = new Map<string, Listener>();
  const el = {
    style: {} as Record<string, string>,
    clientHeight: 844,
    addEventListener: (t: string, f: Listener) => on.set(t, f),
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  };
  new Input(
    el as unknown as HTMLElement,
    {
      gestureStart: () => {},
      gestureEnd: () => {},
      pan: (dx, dy) => c.pan(dx, dy),
      zoom: (px, py, fx, ft) => c.zoomAbout(px, py, fx, ft),
      fling: () => {},
      doubleTap: () => {},
    },
    true,
  );
  let t = 0;
  const ev = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x, clientY: y, timeStamp: t, pointerType: 'touch', button: 0, preventDefault() {} });
  /** Two fingers from (a0, b0) to (a1, b1) in n steps, `jitter(k)` px added to each finger. */
  const pinch = (a0: number[], b0: number[], a1: number[], b1: number[], n = 30, jitter = (_k: number) => [0, 0, 0, 0]) => {
    on.get('pointerdown')!(ev(1, a0[0], a0[1]));
    on.get('pointerdown')!(ev(2, b0[0], b0[1]));
    for (let k = 1; k <= n; k++) {
      t += 16;
      const u = k / n;
      const j = k === n ? [0, 0, 0, 0] : jitter(k);
      on.get('pointermove')!(ev(1, a0[0] + (a1[0] - a0[0]) * u + j[0], a0[1] + (a1[1] - a0[1]) * u + j[1]));
      on.get('pointermove')!(ev(2, b0[0] + (b1[0] - b0[0]) * u + j[2], b0[1] + (b1[1] - b0[1]) * u + j[3]));
    }
    t += 200; // held still before lifting: no fling
    on.get('pointerup')!(ev(1, a1[0], a1[1]));
    on.get('pointerup')!(ev(2, b1[0], b1[1]));
  };
  const wheel = (x: number, y: number, deltaY: number, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
    on.get('wheel')!({ clientX: x, clientY: y, deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, altKey: false, ...mods, preventDefault() {} });
  return { c, pinch, wheel, next: () => (t += 1000) };
}

/** Relative change. */
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('width and time zoom separately (#138)', () => {
  // Mid-screen on a phone, over the fan, a little zoomed in so both axes have room either way.
  const start = (r: ReturnType<typeof rig>) => {
    r.c.zoomAbout(195, 420, 2, 2);
    return { ...r.c.cam };
  };

  it('a sideways pinch zooms width only', () => {
    const r = rig();
    const c0 = start(r);
    // Fingers 90 px apart sideways, 10 px apart up-down; spread to 270 px sideways.
    r.pinch([150, 415], [240, 425], [60, 418], [330, 422]);
    expect(r.c.cam.sx / c0.sx).toBeGreaterThan(2.2);
    expect(rel(r.c.cam.sy, c0.sy)).toBeLessThan(1e-9);
  });

  it('a sideways pinch with vertical jitter (fingers tilted, wobbling) stays width only', () => {
    const r = rig();
    const c0 = start(r);
    // Fingers on a tilt (40 px apart up-down), each wobbling up to ±6 px vertically, the tilt growing by 20 px.
    const jit = (k: number) => [Math.sin(k) * 2, 6 * Math.sin(k * 1.7), -Math.sin(k * 0.9) * 2, -6 * Math.cos(k * 1.3)];
    r.pinch([150, 400], [240, 440], [70, 390], [320, 450], 40, jit);
    expect(r.c.cam.sx / c0.sx).toBeGreaterThan(2);
    expect(rel(r.c.cam.sy, c0.sy)).toBeLessThan(1e-9);
    // Pinching back in sideways, the same.
    r.next();
    r.pinch([70, 390], [320, 450], [150, 400], [240, 440], 40, jit);
    expect(rel(r.c.cam.sx, c0.sx)).toBeLessThan(0.15);
    expect(rel(r.c.cam.sy, c0.sy)).toBeLessThan(1e-9);
  });

  it('an upright pinch zooms time only, with sideways jitter', () => {
    const r = rig();
    const c0 = start(r);
    const jit = (k: number) => [6 * Math.sin(k * 1.3), Math.sin(k), -6 * Math.cos(k * 0.7), 0];
    r.pinch([190, 360], [205, 470], [186, 250], [209, 580], 30, jit);
    expect(r.c.cam.sy / c0.sy).toBeGreaterThan(2.2);
    expect(rel(r.c.cam.sx, c0.sx)).toBeLessThan(1e-9);
  });

  it('a diagonal pinch zooms both, each by its own spread', () => {
    const r = rig();
    const c0 = start(r);
    // Sideways spread 80 → 200 (×2.5), up-down 80 → 160 (×2); the dead zone drops the first few px.
    r.pinch([155, 380], [235, 460], [95, 340], [295, 500]);
    const fx = r.c.cam.sx / c0.sx;
    const ft = r.c.cam.sy / c0.sy;
    expect(fx).toBeGreaterThan(1.8);
    expect(ft).toBeGreaterThan(1.5);
    expect(fx).toBeGreaterThan(ft);
  });

  it('within the dead zone nothing zooms; past it, no jump', () => {
    const r = rig();
    const c0 = start(r);
    const d = PINCH_DEAD_PX - 2;
    r.pinch([150, 415], [240, 425], [150 - d / 2, 415], [240 + d / 2, 425], 6);
    expect(rel(r.c.cam.sx, c0.sx)).toBeLessThan(1e-9);
    expect(rel(r.c.cam.sy, c0.sy)).toBeLessThan(1e-9);
  });

  it('wheel: both axes; shift+wheel width only; alt+wheel time only', () => {
    const r = rig();
    let c0 = start(r);
    r.wheel(195, 420, -100);
    expect(r.c.cam.sx / c0.sx).toBeGreaterThan(1.1);
    expect(r.c.cam.sy / c0.sy).toBeGreaterThan(1.1);
    c0 = { ...r.c.cam };
    r.wheel(195, 420, -100, { shiftKey: true });
    expect(r.c.cam.sx / c0.sx).toBeGreaterThan(1.1);
    expect(rel(r.c.cam.sy, c0.sy)).toBeLessThan(1e-9);
    c0 = { ...r.c.cam };
    r.wheel(195, 420, -100, { altKey: true });
    expect(rel(r.c.cam.sx, c0.sx)).toBeLessThan(1e-9);
    expect(r.c.cam.sy / c0.sy).toBeGreaterThan(1.1);
  });

  it('each axis alone keeps its own limits, and home brings both back', () => {
    const r = rig();
    const h = r.c.home();
    // Width alone, far in: stops at its cap; time does not move.
    for (let k = 0; k < 40; k++) r.pinch([150, 415], [240, 425], [60, 418], [330, 422], 10);
    expect(rel(r.c.cam.sy, h.sy)).toBeLessThan(1e-9);
    const [wx, wy] = r.c.toWorld(195, 420);
    expect(r.c.cam.sx).toBeLessThanOrEqual(Math.max(h.sx, r.c.sxCap(wx, wy)) * 1.0001);
    // Time alone, far in: stops at the 10-years limit; width does not move.
    const sx = r.c.cam.sx;
    for (let k = 0; k < 40; k++) r.pinch([190, 360], [205, 470], [186, 250], [209, 580], 10);
    expect(rel(r.c.cam.sx, sx)).toBeLessThan(1e-9);
    const top = r.c.toWorld(0, 0)[1];
    expect(r.c.timeOk(top, 0, r.c.cam.sy)).toBe(true);
    // Out, each alone: no further than the zoom-out bound.
    const [sxMin, syMin] = r.c.minScale();
    for (let k = 0; k < 40; k++) r.pinch([60, 418], [330, 422], [150, 415], [240, 425], 10);
    for (let k = 0; k < 40; k++) r.pinch([186, 250], [209, 580], [190, 360], [205, 470], 10);
    expect(r.c.cam.sx).toBeGreaterThanOrEqual(sxMin * 0.9999);
    expect(r.c.cam.sy).toBeGreaterThanOrEqual(syMin * 0.9999);
    // Home (the reset button, and what flyTo lands on) is the same whatever the axes did.
    r.c.cam = r.c.home();
    r.c.settle();
    expect(rel(r.c.cam.sx, h.sx)).toBeLessThan(1e-9);
    expect(rel(r.c.cam.sy, h.sy)).toBeLessThan(1e-9);
  });
});
