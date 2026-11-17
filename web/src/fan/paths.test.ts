// The columns' kept samples chosen afresh once the fold has moved PATH_REFOLDS times since they were chosen (ToLaD#502,
// twigs.ts ColumnPath.reset) against on each column's turn, every PATH_REFOLDS-th move whenever they were chosen, as
// before. Two views, each its own tree and state, take the same steps, one each way: random cameras over the whole zoom
// range (half with gray on), then the yardstick's gestures (a pinch in and out, a pan, a flight to a species and back)
// at home, in the largest order and in its largest family. At rest (a frame after the view stops) every rectangle the
// same, in the same order (to 1e-6 px: a kept sample's left edge is read again where a fresh one is worked out, to the
// last bits); while the fold moves, each column's drawn edges (lanePoints: its spine's left edge and its width on screen,
// straight between its points) no further apart, anywhere along it, than twice the chords' tolerance with the zoom's
// leeway (CHORD_TOL_PX * PATH_ZOOM, ColumnPath: each within it of the column's own curve). The largest gap is reported.
// On the mammals; PATHS_N=7000 (or any size) on the synthetic tree instead, on demand (one tree a process).
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setFlip } from './flip';
import type { FanBranch } from './layout';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { setGrayOn } from './steady';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import { CHORD_TOL_PX, setPathByPhase } from './twigs';
import type { Camera } from './camera';
import { FanView } from './view';

const N = Number(process.env.PATHS_N || 0);
/** Two columns' drawn edges, while the fold moves, at most this far apart (px): each within CHORD_TOL_PX * PATH_ZOOM (1.4) of the curve. */
const MOVING_PX = 2 * CHORD_TOL_PX * 1.4;

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

type Pts = { x: Float64Array; y: Float64Array; w: Float64Array; n: number };
type Inner = {
  cam: Camera;
  anim: ((now: number) => boolean) | null;
  w: number;
  h: number;
  gl: { under: RectBatch; over: RectBatch; begin(): void; end(): void };
  lanePoints(b: FanBranch, hw: number): Pts;
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

/** A column's drawn edges as segments [y0, y1, x0, x1, w0, w1] (screen px; w its width on screen), the steps (two points at one height) left out. */
function segs(p: { x: number[]; y: number[]; w: number[] }): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < p.y.length; i++) {
    const [ya, yb] = [p.y[i], p.y[i + 1]];
    if (!(Math.abs(yb - ya) > 1e-9)) continue;
    out.push(ya < yb ? [ya, yb, p.x[i], p.x[i + 1], p.w[i], p.w[i + 1]] : [yb, ya, p.x[i + 1], p.x[i], p.w[i + 1], p.w[i]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** The largest gap (px) between two columns' drawn edges, at every point of either (and between them), where both are drawn. */
function apart(A: number[][], B: number[][]): number {
  const at = (S: number[][], y: number): [number, number] | null => {
    for (const s of S) if (y > s[0] && y < s[1]) {
      const u = (y - s[0]) / (s[1] - s[0]);
      return [s[2] + u * (s[3] - s[2]), s[4] + u * (s[5] - s[4])];
    }
    return null;
  };
  const ys: number[] = [];
  for (const S of [A, B]) for (const s of S) ys.push(s[0], s[1]);
  ys.sort((a, b) => a - b);
  let worst = 0;
  for (let i = 0; i + 1 < ys.length; i++) {
    for (const y of [ys[i] + 1e-7 * (ys[i + 1] - ys[i]), (ys[i] + ys[i + 1]) / 2, ys[i + 1] - 1e-7 * (ys[i + 1] - ys[i])]) {
      if (!(y > ys[i] && y < ys[i + 1])) continue;
      const a = at(A, y);
      const b = at(B, y);
      if (!a || !b) continue;
      worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[0] - a[1] - (b[0] - b[1])));
    }
  }
  return worst;
}

describe(`the columns' samples chosen afresh counted from their choice against on their turn (${N ? `synthetic ${N}` : 'mammals'})`, () => {
  /** Old (on each column's turn) and new (counted from the choice). */
  let views: [FanView, FanView];
  const I = (v: FanView) => v as unknown as Inner;
  let frames = 0;
  let rest = 0;
  let moving = 0;
  let movedApart = 0;
  let worstMoving = 0;
  let worstRest = 0;
  let columns = 0;
  /** Per view, this frame's columns' drawn edges by strand. */
  const cols: Map<number, { x: number[]; y: number[]; w: number[] }>[] = [new Map(), new Map()];
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true }));
    else await loadMammalsFromFiles();
    setFlip(true);
    views = [stubView(), stubView()];
    views.forEach((v, s) => {
      const under = new RectBatch();
      const over = new RectBatch();
      I(v).gl = {
        under,
        over,
        begin() {
          under.n = over.n = 0;
        },
        end() {},
      };
      const own = I(v).lanePoints.bind(v);
      I(v).lanePoints = (b: FanBranch, hw: number) => {
        const p = own(b, hw);
        const sx = I(v).cam.sx;
        cols[s].set(b.index, { x: Array.from(p.x.subarray(0, p.n)), y: Array.from(p.y.subarray(0, p.n)), w: Array.from(p.w.subarray(0, p.n), (w) => w * sx) });
        return p;
      };
    });
  }, 600000);
  afterAll(() => {
    setPathByPhase(false);
    setGrayOn(false);
    setFlip(false);
  });

  let clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const both = (f: (v: FanView) => void) => views.forEach(f);
  const I0 = () => I(views[1]);
  const drawn = (v: FanView) => {
    const { under, over } = I(v).gl;
    return [Array.from(under.f.subarray(0, 12 * under.n)), Array.from(over.f.subarray(0, 12 * over.n))];
  };

  /** Draws the frame in both views, the old way and the new: at rest the same rectangles, moving the same columns within MOVING_PX. */
  const same = (what: string, atRest = false) => {
    const [A, B] = views;
    clock += 16.7;
    const t = clock;
    cols[0].clear();
    cols[1].clear();
    setPathByPhase(true);
    A.draw();
    setPathByPhase(false);
    clock = t;
    B.draw();
    const cam = I(B).cam;
    expect(I(A).cam, what).toEqual(cam);
    const at = `${what} sx ${cam.sx} cx ${cam.cx} cy ${cam.cy} sy ${cam.sy}`;
    expect([...cols[1].keys()], `${at}: the columns drawn`).toEqual([...cols[0].keys()]);
    let w = 0;
    for (const [i, a] of cols[0]) {
      const d = apart(segs(a), segs(cols[1].get(i)!));
      if (d > w) w = d;
    }
    columns += cols[0].size;
    frames++;
    if (atRest) {
      rest++;
      const [a, b] = [drawn(A), drawn(B)];
      for (let k = 0; k < 2; k++) {
        expect(b[k].length, `${at}: rects`).toBe(a[k].length);
        let d = 0;
        for (let j = 0; j < a[k].length; j++) d = Math.max(d, Math.abs(a[k][j] - b[k][j]));
        worstRest = Math.max(worstRest, d);
        expect(d, `${at}: rects at rest`).toBeLessThan(1e-6);
      }
    } else {
      moving++;
      if (w > 1e-6) movedApart++;
      worstMoving = Math.max(worstMoving, w);
      expect(w, `${at}: columns apart while moving (px)`).toBeLessThan(MOVING_PX);
    }
  };
  /** Two more frames with nothing moving: the second at rest (the fold's rest frame chooses every moved column's samples afresh). */
  const settle = (what: string) => {
    same(`${what} settling`);
    same(`${what} at rest`, true);
  };

  it('at random cameras over the whole zoom range, gray off and on', () => {
    const rnd = rng(502);
    const home = I0().homeCamera();
    both((v) => (I(v).cam = { ...home }));
    const [x0] = I0().toWorld(0, 0);
    const [x1] = I0().toWorld(I0().w, 0);
    for (let k = 0; k < (N ? 60 : 120); k++) {
      const sx = home.sx * 2 ** (rnd() * 15);
      const sy = home.sy * 2 ** (rnd() * 5 - 1);
      const cx = x0 + rnd() * (x1 - x0);
      const cy = home.cy + (rnd() - 0.5) * (I0().h / home.sy);
      both((v) => (I(v).cam = { ...home, sx, sy, cx, cy }));
      setGrayOn(k % 2 === 1);
      same(`random ${k}${k % 2 ? ' gray' : ''}`);
      if (k % 4 === 3) settle(`random ${k}`);
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
      settle(`${depth} landed`);
      both((v) => I(v).gestureStart());
      for (let k = 0; k < 40; k++) {
        both((v) => v.zoomAbout(I(v).w / 2, I(v).h / 2, k < 20 ? 1.06 : 1 / 1.06));
        same(`${depth} pinch ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
      });
      settle(`${depth} pinched`);
      both((v) => I(v).gestureStart());
      for (let k = 0; k < 30; k++) {
        both((v) => v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3));
        same(`${depth} pan ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
      });
      settle(`${depth} panned`);
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
        settle(`${depth} flown`);
      }
    }
  }, 1200000);

  afterAll(() => {
    const line = `paths ${N || 'mammals'}: ${frames} frames, ${(columns / Math.max(1, frames)).toFixed(0)} columns a frame; ${rest} at rest the same (largest difference ${worstRest.toExponential(2)} px); ${moving} moving, ${movedApart} with a column drawn apart, at most ${worstMoving.toFixed(3)} px (bound ${MOVING_PX.toFixed(2)})\n`;
    if (process.env.PATHS_OUT) appendFileSync(process.env.PATHS_OUT, line);
    console.log(line);
  });
});
