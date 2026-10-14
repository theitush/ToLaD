// Perf runs only (LOADPERF=1 npx vitest run src/fan/loadperf.test.ts; skipped in the default suite): what opening the
// mammal level costs in node, step by step (ToLaD#255) — the data parsed, the tree and clade built, the view made, the
// first frames drawn. LOADPERF_PROF=<file>: a CPU profile of it (.cpuprofile). A mid phone is roughly 4× slower.
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, expect, it } from 'vitest';
import { MeshBatch, RectBatch } from './meshgl';
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
    const canvas = stubCanvas();
    const t: [string, number][] = [];
    let t0 = performance.now();
    const lap = (s: string) => {
      const n = performance.now();
      t.push([s, n - t0]);
      t0 = n;
    };
    await loadMammalsFromFiles();
    lap('data (files)');
    mammaliaTree();
    lap('mammaliaTree');
    // LOADPERF_SEED=1: with the build's layout seed, as the page reads mammals.json (worked out here, outside the timing).
    if (process.env.LOADPERF_SEED) {
      const clade = cladeOf(mammalData().clade, mammaliaTree(), 'Mammals');
      const seed = layoutSeed(clade, mammaliaTree());
      seed.ord = new Steady(layoutFan({ ...clade, seed }, 'linear', mammaliaTree(), 'curved')).ordShare;
      mammalData().seed = JSON.parse(JSON.stringify(seed));
      lap('(seed, build)');
    }
    mammaliaClade();
    lap('mammaliaClade');
    const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), 'curved', mammaliaTree(), true);
    lap('new FanView');
    const gl = { under: new RectBatch(), mesh: new MeshBatch(), over: new RectBatch(), begin() {}, end() {} };
    (v as unknown as { gl: unknown }).gl = gl;
    v.draw();
    lap('draw 1');
    v.draw();
    lap('draw 2');
    v.draw();
    lap('draw 3');
    // The labels laid out at rest at a few frames (labelsNow's layout, the frame's own): the home again, Rodentia, the bats.
    const at = v as unknown as { cam: unknown; homeCamera(): unknown; levelCamera(n: string): unknown; labelLayMs: number[]; restRoom: unknown; labLast: unknown };
    for (const [s, cam] of [['home', () => at.homeCamera()], ['Rodentia', () => at.levelCamera('Rodentia')], ['Chiroptera', () => at.levelCamera('Chiroptera')]] as const) {
      at.cam = cam();
      v.draw();
      lap(`${s} frame`);
      at.restRoom = null;
      at.labLast = null;
      v.draw();
      t.push([`  labels ${s}`, at.labelLayMs[at.labelLayMs.length - 1]]);
      t0 = performance.now();
    }
    // (Seeded: the layout is the worked-out one, number for number, ToLaD#255.)
    if (process.env.LOADPERF_SEED) {
      const nums = (f: Fan) => JSON.stringify([f.nodes.map((n) => [n.left, n.cx, n.blend, n.leanY, n.tile]), f.branches.map((b) => [b.cx, b.colLeft, b.x0, b.leanY, b.index, b.path.map((p) => [p.left, p.gAbove])])]);
      expect(JSON.stringify(v.fan.tess.fold!.ordShare)).toBe(JSON.stringify(new Steady(layoutFan({ ...mammaliaClade(), seed: undefined }, 'linear', mammaliaTree(), 'curved')).ordShare));
      expect(nums(v.fan)).toBe(nums(layoutFan({ ...mammaliaClade(), seed: undefined }, 'linear', mammaliaTree(), 'curved')));
    }
    if (prof) {
      const { profile } = await prof.post('Profiler.stop');
      writeFileSync(process.env.LOADPERF_PROF!, JSON.stringify(profile));
    }
    (process as unknown as { stderr: { write(s: string): void } }).stderr.write(t.map(([s, ms]) => `${s.padEnd(16)} ${ms.toFixed(0).padStart(6)} ms`).join("\n") + "\n");
  }, 600000);
});
