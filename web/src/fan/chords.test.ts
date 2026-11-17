// The lanes' chords spread on the GPU (ToLaD#502, meshgl.ts SEG_VS) against drawLanes' trapezoids made on the CPU, as
// before, and the merged clades' rows kept across a coarser grid (ribbons.ts) against made again at each grid: two views
// take the same steps, one as before (batches that take no chords: piece() on the CPU; rows made again), one new, its
// chords spread by expandChords (SEG_VS's arithmetic in JS). Every frame the same rectangles under and over, in the
// same order, the chords' in their place among the rest: positions within float32's rounding of the chords' ends (the
// GPU reads them as float32), colours within one step of 255 where a lane's width falls on a rounding edge. Random
// cameras over the whole zoom range (half with gray on), then the yardstick's gestures (a pinch in and out, a pan, a
// flight to a species and back) at home, in the largest order and in its largest family.
// On the mammals; CHORDS_N=7000 (or any size) on the synthetic tree instead, on demand (one tree a process).
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setFlip } from './flip';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { Batches, expandChords, RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { setRibbonsKeep } from './ribbons';
import { mammaliaTree } from './splits';
import { setGrayOn } from './steady';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import type { Camera } from './camera';
import { CHORD_STYLE, FanView } from './view';

const N = Number(process.env.CHORDS_N || 0);

function stubView(): FanView {
  const noop = () => {};
  const g = globalThis as Record<string, unknown>;
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    arc() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    rect() {}
  };
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.window = { devicePixelRatio: 2 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Inner = {
  cam: Camera;
  anim: ((now: number) => boolean) | null;
  w: number;
  h: number;
  gl: Batches & { end(): void };
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  toScreen(x: number, y: number): [number, number];
  toWorld(x: number, y: number): [number, number];
};

/** A small, seeded random source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe(`the lanes' chords spread as SEG_VS spreads them against drawLanes' trapezoids (${N ? `synthetic ${N}` : 'mammals'})`, () => {
  /** Old (trapezoids on the CPU) and new (chords). */
  let views: [FanView, FanView];
  const I = (v: FanView) => v as unknown as Inner;
  let frames = 0;
  let rects = 0;
  let chords = 0;
  let colourSteps = 0;
  let worst = 0;
  let worstA = 0;
  let worstArea = 0;
  const spread = new RectBatch();
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true }));
    else await loadMammalsFromFiles();
    setFlip(true);
    views = [stubView(), stubView()];
    // (Old: the rects alone, as every other test's stub; new: the batches FanGL draws from.)
    const under = new RectBatch();
    const over = new RectBatch();
    I(views[0]).gl = {
      under,
      over,
      begin() {
        under.n = over.n = 0;
      },
      end() {},
    } as unknown as Inner['gl'];
    I(views[1]).gl = Object.assign(new Batches(), { end() {} });
  }, 600000);
  afterAll(() => {
    setRibbonsKeep(true);
    setGrayOn(false);
    setFlip(false);
  });

  let clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const both = (f: (v: FanView) => void) => views.forEach(f);
  const I0 = () => I(views[1]);

  /** Draws the frame in both views and holds their rects the same, the new one's chords spread. */
  const same = (what: string) => {
    const [A, B] = views;
    clock += 16.7;
    const t = clock;
    setRibbonsKeep(false);
    A.draw();
    setRibbonsKeep(true);
    clock = t;
    B.draw();
    const cam = I(B).cam;
    expect(I(A).cam, what).toEqual(cam);
    const at = `${what} sx ${cam.sx} cx ${cam.cx} cy ${cam.cy} sy ${cam.sy}`;
    const a = I(A).gl;
    const b = I(B).gl;
    expandChords(b, I(B).w, CHORD_STYLE, spread);
    expect(spread.n, `${at}: under`).toBe(a.under.n);
    expect(b.over.n, `${at}: over`).toBe(a.over.n);
    expect(Array.from(b.over.f.subarray(0, 12 * b.over.n)), `${at}: over`).toEqual(Array.from(a.over.f.subarray(0, 12 * a.over.n)));
    const X = a.under.f;
    const Y = spread.f;
    for (let i = 0; i < 12 * a.under.n; i++) {
      const c = i % 12;
      const d = Math.abs(X[i] - Y[i]);
      if (d === 0) continue;
      // (x0 y0 x1 y1 | r g b a | dl dr cl cr: px within a thousandth (the chords are read as float32, the bottom row's
      // left and height from the top's, so the leans are the CPU's to float32's precision), a colour one step of 255 at
      // most, an alpha within 1e-4.)
      const h = X[12 * ((i / 12) | 0) + 3] - X[12 * ((i / 12) | 0) + 1];
      const tol = c >= 4 && c <= 6 ? 1 / 255 + 1e-6 : c === 7 ? 1e-4 : 1e-3 + 1e-6 * Math.abs(X[i]);
      if (!(d <= tol)) expect([i, c, X[i]], `${at}: rect ${(i / 12) | 0} value ${c}`).toEqual([i, c, Y[i]]);
      if (c >= 4 && c <= 6) colourSteps++;
      else if (c !== 7) {
        worst = Math.max(worst, d);
        worstArea = Math.max(worstArea, d * h);
      }
      else worstA = Math.max(worstA, d);
    }
    frames++;
    rects += a.under.n;
    chords += b.segs.n;
  };

  it('at random cameras over the whole zoom range, gray off and on', () => {
    const rnd = rng(502);
    const home = I0().homeCamera();
    both((v) => (I(v).cam = { ...home }));
    const [x0] = I0().toWorld(0, 0);
    const [x1] = I0().toWorld(I0().w, 0);
    for (let k = 0; k < (N ? 150 : 300); k++) {
      const sx = home.sx * 2 ** (rnd() * 15);
      const sy = home.sy * 2 ** (rnd() * 5 - 1);
      const cx = x0 + rnd() * (x1 - x0);
      const cy = home.cy + (rnd() - 0.5) * (I0().h / home.sy);
      both((v) => (I(v).cam = { ...home, sx, sy, cx, cy }));
      setGrayOn(k % 2 === 1);
      same(`random ${k}${k % 2 ? ' gray' : ''}`);
    }
    setGrayOn(false);
  }, 1200000);

  it('through the gestures: a pinch, a pan and a flight at home, in an order and in a family', () => {
    const marks = N ? synthMarksNow! : { order: 'Carnivora', family: 'Felidae' };
    for (const [depth, cam] of [
      ['home', (v: FanView) => I(v).homeCamera()],
      ['order', (v: FanView) => I(v).levelCamera(marks.order)],
      ['family', (v: FanView) => I(v).levelCamera(marks.family)],
    ] as const) {
      both((v) => {
        const c = cam(v);
        expect(c, depth).toBeTruthy();
        I(v).cam = c!;
      });
      same(`${depth} landed`);
      both((v) => I(v).gestureStart());
      for (let k = 0; k < 40; k++) {
        both((v) => v.zoomAbout(I(v).w / 2, I(v).h / 2, k < 20 ? 1.06 : 1 / 1.06));
        same(`${depth} pinch ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
        I(v).gestureStart();
      });
      for (let k = 0; k < 30; k++) {
        both((v) => v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3));
        same(`${depth} pan ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
      });
      const B = views[1];
      const on = B.fan.branches.filter((b) => {
        const [x] = I(B).toScreen(b.cx, b.tipY);
        return x > 0 && x < I(B).w;
      });
      const sp = (on.length ? on : B.fan.branches).reduce((p, x) => (x.width > p.width ? x : p)).sp;
      for (const go of [(v: FanView) => v.flyToSpecies(v.fan.branches.find((b) => b.sp.sci === sp.sci)!.sp, false), (v: FanView) => v.resetView()]) {
        both(go);
        let now = clock;
        for (let k = 0; k < 600 && I0().anim; k++) {
          now += 16.7;
          both((v) => {
            const a = I(v).anim!;
            if (a && !a(now)) I(v).anim = null;
          });
          same(`${depth} flight ${k}`);
        }
      }
    }
  }, 1200000);

  afterAll(() => {
    const line = `chords ${N || 'mammals'}: ${frames} frames the same; ${(rects / Math.max(1, frames)).toFixed(0)} rects a frame from ${(chords / Math.max(1, frames)).toFixed(0)} chords; ${colourSteps} colour values a step of 255 apart; largest difference in px ${worst.toExponential(2)} (times its rect's height at most ${worstArea.toExponential(2)} px²), in alpha ${worstA.toExponential(2)}\n`;
    if (process.env.CHORDS_OUT) appendFileSync(process.env.CHORDS_OUT, line);
    console.log(line);
  });
});
