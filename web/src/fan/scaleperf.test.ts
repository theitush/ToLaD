// The scale yardstick in node (ToLaD#343), on demand only: never part of the suite (skipped unless SCALEPERF is set)
// and never a per-change check. scripts/scale.mjs runs it once per tree size (one process each: the level's data is
// module state), with the phone proxy after it:
//
//   SCALEPERF=<out.json> SCALE_N=70000 npx vitest run src/fan/scaleperf.test.ts
//
// A synthetic tree of SCALE_N living species (synthetic.ts) opened as the page opens it (synthetic-level.ts: the
// build's part, then the file parsed, the tree, the clade, the view, the first frames), then frame times of a pinch,
// a pan and a flight at home and two depths (the largest order, its largest family). TOLAD_LABELS=cut TOLAD_FRAME=cut: ?labels=cut&frame=cut.
// SCALE_FOSSIL=1.6: fossils as a fraction of the living (synthetic.ts), about the mammals' with all their fossils (ToLaD#279).
// SCALE_PROF=<file>: a CPU profile of the run after the build's part (.cpuprofile). SCALE_SEED=0 / SCALE_JSON=0 / SCALE_ORDERS=0: no layout seed / no file / its orders not registered (synthetic-level.ts). SCALE_GESTURES=0: the load only.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, it } from 'vitest';
import { setFlip } from './flip';
import { Batches } from './meshgl';
import { loadMammals, unpackMammals, type MammalFile } from './mammals-data';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import { FanView } from './view';

const OUT = process.env.SCALEPERF;
/** Progress, as it goes (<out>.log): a step that never ends shows where. */
const log = (s: string) => OUT && appendFileSync(OUT + '.log', `${new Date().toISOString().slice(11, 19)} ${s}\n`);
const proc = process as unknown as { version: string; memoryUsage(): { rss: number }; threadCpuUsage?(): { user: number; system: number } };
/** The main thread's CPU time (ms; node 22.19+, else 0): a frame's own work, not the time it waited for a CPU on a busy machine. */
const cpuMs = () => {
  const u = proc.threadCpuUsage?.();
  return u ? (u.user + u.system) / 1000 : 0;
};

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

const q = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const stats = (a: number[]) => ({ n: a.length, p50: +q(a, 0.5).toFixed(2), p95: +q(a, 0.95).toFixed(2), max: +q(a, 1).toFixed(2) });

describe.skipIf(!OUT)('scale yardstick (perf)', () => {
  it('opens and moves', async () => {
    // SCALE_N=mammals: the real mammals.json as the build wrote it (MAMMALS_JSON, default dist-single/mammals.json), the sanity line.
    const real = process.env.SCALE_N === 'mammals';
    const n = real ? 0 : Number(process.env.SCALE_N || 7000);
    const res: Record<string, unknown> = { orders: process.env.SCALE_ORDERS !== '0', n, labels: process.env.TOLAD_LABELS || 'default', node: proc.version };
    const load: Record<string, number> = {};
    let rss = 0;
    const mem = () => {
      const r = proc.memoryUsage().rss;
      rss = Math.max(rss, r);
      return r;
    };
    const canvas = stubCanvas();
    // The tree on its side, as the page draws it (flip.ts: node has no location, so it would draw the old one); SCALE_FLIP=0: the old one.
    setFlip(process.env.SCALE_FLIP !== '0');
    res.flip = process.env.SCALE_FLIP !== '0';
    // The build's part and the file read (synthetic-level.ts laps: synth-gen, synth-seed, synth-file, fetch, json, unpack).
    log(`n=${n} start`);
    const readReal = async () => {
      let t = performance.now();
      const text = readFileSync(process.env.MAMMALS_JSON || 'dist-single/mammals.json', 'utf8');
      load.bytes = text.length;
      load.fetch = performance.now() - t;
      t = performance.now();
      const f = JSON.parse(text) as MammalFile;
      load.json = performance.now() - t;
      t = performance.now();
      const d = unpackMammals(f);
      load.unpack = performance.now() - t;
      return d;
    };
    await loadMammals(real ? readReal : () => synthLevelData({ n, seed: process.env.SCALE_SEED !== '0', json: process.env.SCALE_JSON !== '0', orders: process.env.SCALE_ORDERS !== '0', ...(process.env.SCALE_FOSSIL ? { fossil: Number(process.env.SCALE_FOSSIL) } : {}) }, load));
    log(`data ${JSON.stringify(load)}`);
    mem();
    const prof = process.env.SCALE_PROF ? new Session() : null;
    if (prof) {
      prof.connect();
      await prof.post('Profiler.enable');
      await prof.post('Profiler.start');
    }
    let t0 = performance.now();
    let c0 = cpuMs();
    const lap = (k: string) => {
      const t = performance.now();
      const c = cpuMs();
      load[k] = t - t0;
      load[k + 'Cpu'] = c - c0;
      c0 = c;
      log(`${k} ${Math.round(t - t0)} ms`);
      mem();
      t0 = t;
    };
    mammaliaTree();
    lap('tree');
    mammaliaClade();
    lap('clade');
    const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
    lap('view');
    // (The page's batches, as FanGL keeps them: emptied each frame, the lanes sent as chords, ToLaD#502.)
    const gl = Object.assign(new Batches(), { end() {} });
    (v as unknown as { gl: unknown }).gl = gl;
    v.draw();
    lap('first');
    // (The labels' share: labelsNow alone, and with drawLabels, of the first frame.)
    load.firstLabels = v.labelMs[v.labelMs.length - 1];
    load.firstLabelsAll = v.labelAllMs[v.labelAllMs.length - 1];
    v.draw();
    lap('second');
    res.load = Object.fromEntries(Object.entries(load).map(([k, x]) => [k, Math.round(k === 'bytes' ? x : x)]));
    res.species = mammaliaClade().species.length;
    res.marks = real ? { order: 'Rodentia', family: 'Muridae', species: '' } : synthMarksNow;
    res.rssMB = Math.round(rss / 2 ** 20);
    writeFileSync(OUT!, JSON.stringify(res, null, 1));
    if (process.env.SCALE_GESTURES !== '0') {
      const at = v as unknown as {
        cam: unknown;
        anim: ((now: number) => boolean) | null;
        homeCamera(): unknown;
        levelCamera(n: string): unknown;
        gestureStart(): void;
        gestureEnd(): void;
        levelNow(now?: boolean): unknown;
        toScreen(x: number, y: number): [number, number];
        w: number;
        h: number;
      };
      const frames: Record<string, unknown> = {};
      const m = res.marks as { order: string; family: string };
      for (const [depth, cam] of [['home', () => at.homeCamera()], ['order', () => at.levelCamera(m.order)], ['family', () => at.levelCamera(m.family)]] as const) {
        const c = cam();
        if (!c) {
          frames[depth] = 'no camera';
          continue;
        }
        log(`${depth}`);
        // (SCALE_CAP_MIN, default 20: a depth's gestures stop there, and the run says where it cut them.)
        const deadline = performance.now() + Number(process.env.SCALE_CAP_MIN || 20) * 60000;
        const over = (what: string) => performance.now() > deadline && ((res.cut = `${depth} ${what}`), true);
        at.cam = c;
        v.draw();
        v.draw();
        // (Each frame's main-thread CPU time too, into cpu[g]: on a shared machine the wall time swings with the load.)
        const cpu: Record<string, number[]> = { pinch: [], pan: [], flight: [] };
        const lab: number[] = [];
        const labAll: number[] = [];
        const timed = (f: () => void, g: string) => {
          const t = performance.now();
          const c = cpuMs();
          const n0 = v.labelMs.length;
          f();
          v.draw();
          cpu[g].push(cpuMs() - c);
          // (labelsNow's ms, and with drawLabels, of this frame: the labels' share.)
          if (v.labelMs.length > n0 || v.labelMs.length === 600) {
            lab.push(v.labelMs[v.labelMs.length - 1]);
            labAll.push(v.labelAllMs[v.labelAllMs.length - 1]);
          }
          return performance.now() - t;
        };
        // A pinch in and out about the middle (as phoneperf's: 20 steps each way), a pan, a flight in and back.
        const pinch: number[] = [];
        at.gestureStart();
        for (let k = 0; k < 40 && !over('pinch'); k++) pinch.push(timed(() => v.zoomAbout(at.w / 2, at.h / 2, k < 20 ? 1.06 : 1 / 1.06), 'pinch'));
        at.gestureEnd();
        at.levelNow(true);
        const pan: number[] = [];
        at.gestureStart();
        for (let k = 0; k < 30 && !over('pan'); k++) pan.push(timed(() => v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3), 'pan'));
        at.gestureEnd();
        at.levelNow(true);
        log(`${depth} pinch ${JSON.stringify(stats(pinch))} pan ${JSON.stringify(stats(pan))} rss ${Math.round(mem() / 2 ** 20)} MB`);
        const fly: number[] = [];
        const on = v.fan.branches.filter((b) => {
          const [x] = at.toScreen(b.cx, b.tipY);
          return x > 0 && x < at.w;
        });
        const b = (on.length ? on : v.fan.branches).reduce((p, x) => (x.width > p.width ? x : p));
        for (const go of [() => v.flyToSpecies(b.sp, false), () => v.resetView()]) {
          go();
          let now = performance.now();
          for (let k = 0; k < 600 && at.anim && !over('flight'); k++) {
            now += 16.7;
            const a = at.anim;
            fly.push(timed(() => !a(now) && (at.anim = null), 'flight'));
          }
        }
        mem();
        frames[depth] = { pinch: stats(pinch), pan: stats(pan), flight: stats(fly), cpu: { pinch: stats(cpu.pinch), pan: stats(cpu.pan), flight: stats(cpu.flight) }, labels: stats(lab), labelsAll: stats(labAll) };
        // (Written as it goes: a run stopped part way keeps what it measured.)
        res.frames = frames;
        res.rssMB = Math.round(rss / 2 ** 20);
        writeFileSync(OUT!, JSON.stringify(res, null, 1));
        log(`${depth} ${JSON.stringify(frames[depth])} rss ${res.rssMB} MB`);
      }
      res.frames = frames;
    }
    if (prof) writeFileSync(process.env.SCALE_PROF!, JSON.stringify((await prof.post('Profiler.stop')).profile));
    res.rssMB = Math.round(rss / 2 ** 20);
    writeFileSync(OUT!, JSON.stringify(res, null, 1));
  }, 3600000);
});
