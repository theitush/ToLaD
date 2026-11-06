// A double tap reads as one step back (ToLaD#413). A real double tap through Input's own pointer events at the mammals,
// the view flown frame by frame, every strand's screen x and rows of the time axis recorded: nothing moves before the
// second tap, nothing goes the wrong way, what travels goes straight, and it lands on the frame it always did in the time
// it always took. `DBLTAP_SAY=1` prints the numbers.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { gapMode, setGapMode, type GapMode } from './fold';
import type { FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { flightPath, FanView, type Level } from './view';

let clock = 1000;
const timers: { at: number; f: () => void; id: number }[] = [];
let tid = 1;
type Rig = { v: FanView; on: Map<string, (e: unknown) => void> };
function rig(): Rig {
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
  g.window = {
    devicePixelRatio: 2,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: (f: () => void, ms: number) => (timers.push({ at: clock + ms, f, id: ++tid }), tid),
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  const ctx = new Proxy(
    { measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>,
    { get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]), set: (o, k, v) => ((o[k as string] = v), true) },
  );
  const on = new Map<string, (e: unknown) => void>();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    clientHeight: 844,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: (t: string, f: (e: unknown) => void) => on.set(t, f),
    removeEventListener: noop,
    setPointerCapture: noop,
  };
  return { v: new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true), on };
}
type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; camera: FanCamera; frameOf(lv: Level): Camera; upFrom(lv: Level, c: Camera): { cam: Camera } | null; steps: unknown[]; famHits: { box: number[]; v: FanNode }[] };
const P = (v: FanView) => v as unknown as Priv;
const pointer = (x: number, y: number, late = 0) => ({ pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, timeStamp: clock - late, preventDefault() {} });
/** The clock on by ms, a frame (16.7 ms) at a time, the timers due and the flight under way run, the callback after each frame. */
function pass(r: Rig, ms: number, frame?: () => void): void {
  const end = clock + ms;
  while (clock < end) {
    clock += 1000 / 60;
    for (const t of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1);
      t.f();
    }
    const iv = P(r.v);
    if (iv.anim) {
      if (!iv.anim(clock)) iv.anim = null;
      iv.applyFold();
    }
    frame?.();
  }
}
function fly(r: Rig, frame?: () => void): void {
  for (let k = 0; (P(r.v).anim || timers.length) && k < 500; k++) pass(r, 1, frame);
}
function stand(v: FanView, c: Camera): void {
  P(v).anim = null;
  P(v).steps = [];
  (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
  v.cam = { ...c, ty: c.sy };
  P(v).camera.settle();
  for (let k = 0; k < 3; k++) v.draw();
}
function tapAt(r: Rig, x: number, y: number, frame?: () => void, hold = 50): void {
  r.on.get('pointerdown')!(pointer(x, y));
  pass(r, hold, frame);
  r.on.get('pointerup')!(pointer(x, y));
}
/** Every strand's screen x now. */
function xs(v: FanView): Float32Array {
  const f = v.fan.tess.fold as Steady;
  f.setScale(v.cam.sx, v.w);
  const { C } = f.rooms();
  const o = new Float32Array(C.length);
  for (let i = 0; i < C.length; i++) o[i] = v.toScreen(C[i], 0)[0];
  return o;
}
/** Rows of the world's time, top to bottom, on screen now. */
function ys(v: FanView): Float32Array {
  const [a, b] = [v.fan.root.strands.reduce((m, s) => Math.min(m, s.tipY), Infinity), v.fan.trunkBottom.y];
  return Float32Array.from({ length: 129 }, (_, k) => v.toScreen(0, a + ((b - a) * k) / 128)[1]);
}
type Rec = { t: number[]; x: Float32Array[]; y: Float32Array[]; cam: Camera[] };
function measure(r: Rig, act: (frame: () => void) => void): Rec {
  const v = r.v;
  const rec: Rec = { t: [clock], x: [xs(v)], y: [ys(v)], cam: [{ ...v.cam }] };
  const frame = () => {
    rec.t.push(clock);
    rec.x.push(xs(v));
    rec.y.push(ys(v));
    rec.cam.push({ ...v.cam });
  };
  act(frame);
  fly(r, frame);
  return rec;
}
/**
 * The sweep, of everything on screen at some time (clipped to the screen): `path` the most anything travels, `straight`
 * that one's way from end to end, `back` the most anything goes the wrong way: per strand its second longest run in one
 * direction (a thing going straight has one run, a thing that turns back has the shorter leg of its turn).
 */
function sweep(X: Float32Array[], w: number) {
  const n = X[0].length;
  let path = 0;
  let straight = 0;
  let back = 0;
  for (let i = 0; i < n; i++) {
    let p = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let dir = 0;
    let run = 0;
    let first = 0;
    let second = 0;
    const end = () => {
      if (run > first) [first, second] = [run, first];
      else if (run > second) second = run;
    };
    for (let k = 1; k < X.length; k++) {
      const a = X[k - 1][i];
      const b = X[k][i];
      if ((a < 0 && b < 0) || (a > w && b > w)) continue;
      const ca = Math.min(w, Math.max(0, a));
      const cb = Math.min(w, Math.max(0, b));
      const dx = cb - ca;
      p += Math.abs(dx);
      lo = Math.min(lo, ca, cb);
      hi = Math.max(hi, ca, cb);
      if (dx === 0) continue;
      if (Math.sign(dx) !== dir) {
        end();
        run = 0;
        dir = Math.sign(dx);
      }
      run += Math.abs(dx);
    }
    end();
    if (p > path) ((path = p), (straight = hi - lo));
    back = Math.max(back, second);
  }
  return { path, straight, back };
}
const proc = (globalThis as unknown as { process: { stderr: { write(s: string): void }; env: Record<string, string> } }).process;

describe('a flight between two views that overlap is the plain zoom between them (ToLaD#413)', () => {
  it('nothing goes back: every point of the world moves one way on screen', () => {
    for (const [w0, w1, d] of [[100, 2, 30], [2, 100, 30], [100, 50, 60], [100, 100, 60], [100, 99.999, 90]]) {
      const p = flightPath(w0, w1, d);
      for (const X of [-60, -10, 0, 7, 30, 44, 90]) {
        let dir = 0;
        let last = NaN;
        for (let k = 0; k <= 64; k++) {
          const [w, u] = p.at(k / 64);
          const x = (X - u * d) / w;
          if (k && Math.abs(x - last) > 1e-9) {
            const g = Math.sign(x - last);
            expect(!dir || g === dir, `${w0} ${w1} ${d} ${X}`).toBe(true);
            dir = g;
          }
          last = x;
        }
      }
      expect(p.at(1)[0]).toBeCloseTo(w1, 6);
      expect(p.at(1)[1]).toBeCloseTo(1, 6);
    }
  });
  it('two views apart still climb to see both ends', () => {
    const p = flightPath(10, 10, 100);
    expect(p.at(0.5)[0]).toBeGreaterThan(20);
  });
});

describe('a double tap reads as one step back (ToLaD#413)', () => {
  const was = gapMode();
  beforeAll(async () => {
    await loadMammalsFromFiles();
  }, 300_000);
  afterAll(() => {
    setGapMode(was);
    vi.restoreAllMocks();
  });
  for (const mode of ['clades', 'groups'] as GapMode[]) {
    it(`${mode}: from each frame, on a branch and on nothing, a quick and a slow double tap`, () => {
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
      setGapMode(mode);
      const r = rig();
      const v = r.v;
      const node = (n: string) => v.fan.nodes.find((u) => u.split.taxon === n)!;
      const home = v.homeCamera();
      const B: [number, number] = [v.w * 0.62, v.h * 0.45];
      const E: [number, number] = [-1e4, -1e4];
      const check = (name: string, go: () => void, act: (frame: () => void) => void, at: number, want?: Camera) => {
        go();
        const t0 = clock;
        const rec = measure(r, act);
        const [x, y] = [sweep(rec.x, v.w), sweep(rec.y, v.h)];
        const N = rec.x.length - 1;
        const moved = rec.cam.findIndex((c) => c.cx !== rec.cam[0].cx || c.sx !== rec.cam[0].sx);
        const line = `${mode} ${name}: ${(rec.t[N] - t0) | 0} ms, moves at ${moved < 0 ? '-' : (rec.t[moved] - t0) | 0}; x travel ${x.path.toFixed(0)} back ${x.back.toFixed(1)}; y travel ${y.path.toFixed(0)} back ${y.back.toFixed(1)}`;
        if (proc.env.DBLTAP_SAY) proc.stderr.write(line + '\n');
        // Nothing moves before the second tap has lifted.
        if (moved >= 0) expect(rec.t[moved] - t0, line).toBeGreaterThanOrEqual(at);
        // Nothing goes the wrong way, and what travels most goes straight.
        expect(x.back, line).toBeLessThan(0.5);
        expect(y.back, line).toBeLessThan(0.5);
        expect(x.path - x.straight, line).toBeLessThan(0.5);
        // Where it lands.
        if (want) {
          expect(Math.abs(v.cam.cx - want.cx) * v.cam.sx, line).toBeLessThan(2);
          expect(Math.abs(Math.log(v.cam.sx / want.sx)), line).toBeLessThan(0.01);
        }
      };
      const quick = (s: [number, number]) => (frame: () => void) => {
        tapAt(r, s[0], s[1], frame);
        pass(r, 120, frame);
        tapAt(r, s[0], s[1], frame);
      };
      // A long touch, the second finger down inside the window, up after it: still a double tap, not two taps deeper.
      const slow = (s: [number, number]) => (frame: () => void) => {
        tapAt(r, s[0], s[1], frame, 100);
        pass(r, 240, frame);
        tapAt(r, s[0], s[1], frame, 100);
      };
      const frames: [string, Level][] = [
        ['Carnivora', { v: node('Carnivora') }],
        ['Felidae', { v: node('Felidae') }],
        ['a species', { b: node('Felidae').strands[0] }],
      ];
      for (const [name, lv] of frames) {
        const go = () => stand(v, P(v).frameOf(lv));
        go();
        const want = P(v).upFrom(lv, v.cam)?.cam;
        for (const [sn, s] of [['branch', B], ['nothing', E]] as const) {
          check(`${name} ${sn} quick`, go, quick(s), 170, want);
          check(`${name} ${sn} slow`, go, slow(s), 440, want);
        }
      }
      // A view pinched anywhere; home does nothing.
      const free = () => stand(v, { ...home, sx: home.sx * 12, sy: home.sy * 4, ty: home.sy * 4, cx: home.cx + (0.2 * v.w) / home.sx });
      check('free zoom quick', free, quick(B), 170);
      check('free zoom slow', free, slow(B), 440);
      check('home', () => stand(v, home), quick(B), 1e9);
      // Tapped into a level and back: a single tap straight too, landing and coming home.
      stand(v, home);
      const hs = v.famHits;
      for (const pick of [hs[0], hs[hs.length >> 1], hs[hs.length - 1]].filter(Boolean)) {
        const [x, y] = [(pick.box[0] + pick.box[2]) / 2, (pick.box[1] + pick.box[3]) / 2];
        check(`tap ${pick.v.split.taxon}`, () => stand(v, home), (frame) => tapAt(r, x, y, frame), 300);
        for (let k = 0; k < 3; k++) v.draw();
        check(`${pick.v.split.taxon} and back`, () => {}, quick(B), 170, home);
      }
    }, 300_000);
  }
});
