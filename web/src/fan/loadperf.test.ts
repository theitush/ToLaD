// Perf runs only (LOADPERF=1 npx vitest run src/fan/loadperf.test.ts; skipped in the default suite): what opening the
// mammal level costs in node, step by step (ToLaD#255) — the data parsed, the tree and clade built, the view made, the
// first frames drawn. LOADPERF_PROF=<file>: a CPU profile of it (.cpuprofile). A mid phone is roughly 4× slower.
// The tree on its side, as the page opens (LOADPERF_FLIP=0: upright). LOADPERF_GESTURES=1: frames at rest and moving at home, Rodentia, Primates and the Hominins (ToLaD#279).
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { RectBatch } from './meshgl';
import { Steady } from './steady';
import { layoutFan, layoutSeed, type Fan } from './layout';
import { mammalData } from './mammals-data';
import { cladeOf, mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { FanView } from './view';
import { loadMammalsFromFiles } from './mammals-node';

const RUN = !!process.env.LOADPERF;

function stubCanvas() {
  const noop = () => {};
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : noop),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  const g = globalThis as Record<string, unknown>;
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    closePath() {}
    rect() {}
  };
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.window = { devicePixelRatio: 3 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  return {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
}

describe.skipIf(!RUN)('mammal level open (perf)', () => {
  it('steps', async () => {
    const prof = process.env.LOADPERF_PROF ? new Session() : null;
    if (prof) {
      prof.connect();
      await prof.post('Profiler.enable');
      await prof.post('Profiler.start');
    }
    // (The page's tree on its side, as it opens, ToLaD#497; LOADPERF_FLIP=0: upright, as before.)
    setFlip(process.env.LOADPERF_FLIP !== '0');
    const canvas = stubCanvas();
    const t: [string, number][] = [];
    // (Each open step's main-thread CPU too, ms: what an interleaved A/B compares when the machine is shared, ToLaD#279.)
    const cpuNow = () => {
      const u = (process as unknown as { threadCpuUsage?(): { user: number; system: number } }).threadCpuUsage?.();
      return u ? (u.user + u.system) / 1000 : 0;
    };
    let t0 = performance.now();
    let c0 = cpuNow();
    const lap = (s: string) => {
      const [n, c] = [performance.now(), cpuNow()];
      t.push([s, n - t0], [`  cpu ${s}`, c - c0]);
      [t0, c0] = [n, c];
    };
    await loadMammalsFromFiles();
    lap('data (files)');
    mammaliaTree();
    lap('mammaliaTree');
    // LOADPERF_SEED=1: with the build's layout seed, as the page reads mammals.json (worked out here, outside the timing).
    if (process.env.LOADPERF_SEED) {
      const clade = cladeOf(mammalData().clade, mammaliaTree(), 'Mammals');
      const seed = layoutSeed(clade, mammaliaTree());
      seed.ord = new Steady(layoutFan({ ...clade, seed }, 'linear', mammaliaTree())).ordShare;
      mammalData().seed = JSON.parse(JSON.stringify(seed));
      lap('(seed, build)');
    }
    mammaliaClade();
    lap('mammaliaClade');
    const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
    lap('new FanView');
    const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
    (v as unknown as { gl: unknown }).gl = gl;
    v.draw();
    lap('draw 1');
    v.draw();
    lap('draw 2');
    v.draw();
    lap('draw 3');
    // The labels laid out at rest at a few frames (labelsNow's layout, the frame's own): the home again, Rodentia, the bats.
    const at = v as unknown as { cam: unknown; homeCamera(): unknown; levelCamera(n: string): unknown; labelMs: number[] };
    for (const [s, cam] of [['home', () => at.homeCamera()], ['Rodentia', () => at.levelCamera('Rodentia')], ['Chiroptera', () => at.levelCamera('Chiroptera')]] as const) {
      at.cam = cam();
      v.draw();
      lap(`${s} frame`);
      t.push([`  labels ${s}`, at.labelMs[at.labelMs.length - 1]]);
      [t0, c0] = [performance.now(), cpuNow()];
    }
    // LOADPERF_GESTURES=1 (ToLaD#279): at home, Rodentia (the biggest order), Primates and the Hominins, a still frame's
    // labels and the fossils' tip names (tipLabels) in it, then a pinch in and out (20 steps each way) and a pan, each
    // frame's wall and main-thread CPU ms (median and p95) and its labels' ms.
    if (process.env.LOADPERF_GESTURES) {
      const g = v as unknown as typeof at & { gestureStart(): void; gestureEnd(): void; levelNow(now?: boolean): unknown; w: number; h: number; tipLabels: (...a: unknown[]) => void };
      const cpuOf = (process as unknown as { threadCpuUsage?(): { user: number; system: number } }).threadCpuUsage;
      const cpu = () => (cpuOf ? (cpuOf().user + cpuOf().system) / 1000 : 0);
      let tipMs = 0;
      const tip = g.tipLabels;
      g.tipLabels = function (this: unknown, ...a: unknown[]) {
        const t1 = performance.now();
        tip.apply(this, a);
        tipMs += performance.now() - t1;
      };
      const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;
      const st = (xs: number[]) => `med ${q(xs, 0.5).toFixed(1)} p95 ${q(xs, 0.95).toFixed(1)}`;
      for (const [s, cam] of [['home', () => g.homeCamera()], ['Rodentia', () => g.levelCamera('Rodentia')], ['Primates', () => g.levelCamera('Primates')], ['Hominini', () => g.levelCamera('Hominini')]] as const) {
        g.cam = cam();
        v.draw();
        const still: number[] = [];
        const tips: number[] = [];
        for (let k = 0; k < 5; k++) {
          // (A still frame redrawn with its labels laid out anew: the cut's cache dropped by a hair of a pan.)
          v.pan(k % 2 ? 0.5 : -0.5, 0);
          tipMs = 0;
          v.draw();
          still.push(g.labelMs[g.labelMs.length - 1]);
          tips.push(tipMs);
        }
        const run = (step: (k: number) => void, n: number) => {
          const wall: number[] = [];
          const cp: number[] = [];
          const lab: number[] = [];
          const tp: number[] = [];
          g.gestureStart();
          for (let k = 0; k < n; k++) {
            const [t1, c1, n1] = [performance.now(), cpu(), g.labelMs.length];
            tipMs = 0;
            step(k);
            v.draw();
            wall.push(performance.now() - t1);
            cp.push(cpu() - c1);
            if (g.labelMs.length > n1 || g.labelMs.length === 600) lab.push(g.labelMs[g.labelMs.length - 1]);
            tp.push(tipMs);
          }
          g.gestureEnd();
          g.levelNow(true);
          return `wall ${st(wall)}, cpu ${st(cp)}, labels ${st(lab)}, tips ${st(tp)}`;
        };
        g.cam = cam();
        const pinch = run((k) => v.zoomAbout(g.w / 2, g.h / 2, k < 20 ? 1.06 : 1 / 1.06), 40);
        g.cam = cam();
        const pan = run((k) => v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3), 30);
        t.push([`${s}: still labels ${st(still)}, tips ${st(tips)}; pinch ${pinch}; pan ${pan}`, 0]);
      }
      [t0, c0] = [performance.now(), cpuNow()];
    }
    // (Seeded: the layout is the worked-out one, number for number, ToLaD#255.)
    if (process.env.LOADPERF_SEED) {
      const nums = (f: Fan) => JSON.stringify([f.nodes.map((n) => [n.left, n.cx, n.blend, n.leanY, n.tile]), f.branches.map((b) => [b.cx, b.colLeft, b.x0, b.leanY, b.index, b.path.map((p) => [p.left, p.gAbove])])]);
      expect(JSON.stringify(v.fan.tess.fold!.ordShare)).toBe(JSON.stringify(new Steady(layoutFan({ ...mammaliaClade(), seed: undefined }, 'linear', mammaliaTree())).ordShare));
      expect(nums(v.fan)).toBe(nums(layoutFan({ ...mammaliaClade(), seed: undefined }, 'linear', mammaliaTree())));
    }
    if (prof) {
      const { profile } = await prof.post('Profiler.stop');
      writeFileSync(process.env.LOADPERF_PROF!, JSON.stringify(profile));
    }
    (process as unknown as { stderr: { write(s: string): void } }).stderr.write(t.map(([s, ms]) => `${s.padEnd(16)} ${ms.toFixed(0).padStart(6)} ms`).join("\n") + "\n");
  }, 600000);
});
