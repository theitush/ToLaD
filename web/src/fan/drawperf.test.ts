// Perf runs only (FANPERF=1 npx vitest run src/fan/drawperf.test.ts): the CPU
// side of the fan view's draw() in node, with stub canvases (no GPU, no
// browser): the whole view, the GPU layer replaced by its batches. Per scene, a
// slow pinch in and out with a little pan (as scripts/fanperf.mjs does), each
// draw() timed, and what it sent: mesh instances, lane rects, 2D strokes.
// A mid phone is roughly 4× slower than this machine's node.
import { appendFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, it } from 'vitest';
import { MeshBatch, RectBatch } from './meshgl';
import { FELIDAE } from './panthera';
import { SCALE_BAR_PX } from './twigs';
import { FanView } from './view';

const RUN = !!process.env.FANPERF;
/** Where the rows go as they come (FANPERF=<file>), and the console. */
const out = (s: string) => {
  console.log(s);
  if (RUN && process.env.FANPERF !== '1') appendFileSync(process.env.FANPERF!, s + '\n');
};

function stubs() {
  const calls = { stroke: 0, fill: 0, text: 0, pieces: 0 };
  class P {
    moveTo() {
      calls.pieces++;
    }
    lineTo() {
      calls.pieces++;
    }
    arc() {}
    bezierCurveTo() {
      calls.pieces++;
    }
    quadraticCurveTo() {}
    closePath() {}
    rect() {}
  }
  const g = globalThis as Record<string, unknown>;
  g.Path2D = P;
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.window = { devicePixelRatio: 3 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  const noop = () => {};
  const ctx = {
    canvas: null,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    setTransform: noop,
    clearRect: noop,
    fillRect() {
      calls.fill++;
    },
    strokeRect: noop,
    stroke() {
      calls.stroke++;
    },
    fill() {
      calls.fill++;
    },
    beginPath: noop,
    closePath: noop,
    moveTo() {
      calls.pieces++;
    },
    lineTo() {
      calls.pieces++;
    },
    arc: noop,
    arcTo: noop,
    rect: noop,
    roundRect: noop,
    bezierCurveTo() {
      calls.pieces++;
    },
    quadraticCurveTo: noop,
    save: noop,
    restore: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    drawImage: noop,
    getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
    scale: noop,
    setLineDash: noop,
    fillText() {
      calls.text++;
    },
    strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 7.5 }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
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
  return { canvas, calls };
}

const CPU = !!process.env.FANPERF_CPU;
const cpuMs = () => {
  const u = (process as unknown as { cpuUsage(): { user: number; system: number } }).cpuUsage();
  return (u.user + u.system) / 1000;
};

function q(a: number[], p: number) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

describe.skipIf(!RUN)('fan draw() CPU (perf)', () => {
  it('scenes', async () => {
    // FANPERF_PROF=<file>: a CPU profile of the whole run (.cpuprofile).
    const prof = process.env.FANPERF_PROF ? new Session() : null;
    if (prof) {
      prof.connect();
      await prof.post('Profiler.enable');
      await prof.post('Profiler.start');
    }
    const t0 = performance.now();
    const { canvas, calls } = stubs();
    const v = new FanView(canvas as unknown as HTMLCanvasElement, FELIDAE);
    const tNew = performance.now() - t0;
    const gl = { under: new RectBatch(), mesh: new MeshBatch(), over: new RectBatch(), begin() {}, end() {} };
    gl.begin = () => {
      gl.under.n = 0;
      gl.mesh.n = 0;
      gl.over.n = 0;
    };
    (v as unknown as { gl: unknown }).gl = gl;
    const t1 = performance.now();
    v.draw();
    const tFirst = performance.now() - t1;
    out(`load: new FanView ${tNew.toFixed(0)} ms, first draw ${tFirst.toFixed(0)} ms`);
    // Per-part timings: the view's private draw steps, wrapped.
    const parts = ['drawStrand', 'drawIndividuals', 'drawLabels', 'drawStem', 'drawStemFade', 'drawTimeAxis', 'drawTouch', 'drawGutter'];
    const acc: Record<string, number> = {};
    const proto = FanView.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const p of parts) {
      const f = proto[p];
      (v as unknown as Record<string, unknown>)[p] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        const r = f.apply(this, a);
        acc[p] = (acc[p] ?? 0) + performance.now() - t;
        return r;
      };
    }
    // How many strands get sampled per frame, and at how many points.
    const lp = { n: 0, pts: 0 };
    const lanePoints = v.lanePoints.bind(v);
    v.lanePoints = (b, hw) => {
      const r = lanePoints(b, hw);
      lp.n++;
      lp.pts += r.length;
      return r;
    };
    const fan = v.fan;
    const cat = fan.branches.find((b) => b.sp.common === 'Domestic cat')!;
    const unit = fan.branches[0].unit;
    const scenes: [string, () => void][] = [
      ['home (linear)', () => (v.cam = v.homeCamera())],
    ];
    // The domestic cat's funnel: its column centred, `ago` years back, the width bar reading perBar, time zoom sy.
    for (const [ago, perBar, sy] of [
      [100, 3e6, 3000],
      [50, 3e5, 6000],
      [20, 3e4, 15000],
      [20, 300, 15000],
    ] as const) {
      scenes.push([
        `cat ${ago}y ${perBar}/bar`,
        () => {
          const sx = SCALE_BAR_PX / perBar / unit;
          v.cam = { cx: 0, cy: fan.time.y(ago * 1e-6), sx, sy, ty: sy };
          v.camera.settle();
          const L = v.model(cat).lanes(v.cam.cy);
          v.cam.cx = L.left + L.w * 0.5;
          v.camera.settle();
        },
      ]);
    }
    const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
    const sumEver = fan.branches.reduce((a, b) => a + b.sp.ever, 0);
    for (const [name, ago, perBar, sy] of [
      ['lion overview', 2e5, 1e9, 0.7],
      ['lion mid', 5e4, 1e7, 3],
      ['lion texture', 2000, 60, 5],
      ['lion lives', 300, 20, 30],
      ['lion near now', 25, 0.4, 300],
    ] as const) {
      scenes.push([
        name,
        () => {
          const sx = ((70 / perBar) * sumEver) / fan.trunkWidth;
          v.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
          v.camera.settle();
          const L = v.model(lion).lanes(v.cam.cy);
          v.cam.cx = L.left + L.gw + (L.w - L.gw) * 0.5;
          v.camera.settle();
        },
      ]);
    }
    out(`scene                 p50    p95    max   (ms, node${CPU ? ' CPU time' : ''})`);
    const only = process.env.FANPERF_ONLY ? new RegExp(process.env.FANPERF_ONLY) : null;
    for (const [name, set] of scenes) {
      if (only && !only.test(name)) continue;
      set();
      if (process.env.FANPERF_DEBUG) {
        const [, sTop] = v.toWorld(0, -20);
        const [, sBot] = v.toWorld(0, v.h + 20);
        out(`${name}: cam ${JSON.stringify(v.cam)} y ${sTop}..${sBot}`);
        for (const b of fan.branches.slice(0, 6)) {
          const r = fan.tess.xRange(b, sTop, sBot);
          const L = v.model(b).lanes(v.cam.cy);
          out(`  ${b.sp.common}: xRange ${r.map((x) => v.toScreen(x, 0)[0].toFixed(0))} lanes ${v.toScreen(L.left, 0)[0].toFixed(0)}..${v.toScreen(L.left + L.w, 0)[0].toFixed(0)} cuts ${fan.tess.cuts(b, sTop, sBot, v.cam.sy, 4).length}`);
        }
      }
      v.draw();
      v.draw();
      for (const k of Object.keys(acc)) delete acc[k];
      const times: number[] = [];
      let inst = 0;
      let rects = 0;
      calls.stroke = calls.fill = calls.text = calls.pieces = 0;
      lp.n = lp.pts = 0;
      const N = 90;
      for (let k = 0; k < N; k++) {
        v.zoomAbout(195, 422, k < 45 ? 1.01 : 1 / 1.01);
        v.pan(k % 2 ? 0.5 : -0.5, 0);
        // (FANPERF_CPU=1: this process's CPU time, not the wall clock: steadier on a busy machine.)
        const t = CPU ? cpuMs() : performance.now();
        v.draw();
        times.push((CPU ? cpuMs() : performance.now()) - t);
        inst = Math.max(inst, gl.mesh.n);
        rects = Math.max(rects, gl.under.n);
      }
      // (FANPERF_TIMES=1: every frame's time, to see where the slow ones fall.)
      if (process.env.FANPERF_TIMES) out(`  ${times.map((x) => x.toFixed(0)).join(' ')}`);
      const f = (x: number) => x.toFixed(1).padStart(6);
      const top = Object.entries(acc)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, t]) => `${k.replace('draw', '')} ${(t / N).toFixed(1)}`)
        .join(', ');
      out(
        `${name.padEnd(20)} ${f(q(times, 0.5))} ${f(q(times, 0.95))} ${f(Math.max(...times))}  inst ${String(inst).padStart(6)} rects ${String(rects).padStart(5)} strokes/f ${(calls.stroke / N).toFixed(0).padStart(5)} pieces/f ${(calls.pieces / N).toFixed(0).padStart(6)} strands/f ${(lp.n / N).toFixed(0).padStart(3)} pts/f ${(lp.pts / N).toFixed(0).padStart(6)} | ${top}`,
      );
    }
    if (prof) {
      const { profile } = await prof.post('Profiler.stop');
      writeFileSync(process.env.FANPERF_PROF!, JSON.stringify(profile));
    }
  });
});
