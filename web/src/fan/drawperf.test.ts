// Perf runs only (FANPERF=1 npx vitest run src/fan/drawperf.test.ts; skipped in the default suite; FANPERF_CLADE=mammalia
// takes ~9 min for every scene: add --testTimeout=900000, or FANPERF_ONLY=<regex> for a few): the CPU
// side of the fan view's draw() in node, with stub canvases (no GPU, no
// browser): the whole view, the GPU layer replaced by its batches. Per scene, a
// slow pinch in and out with a little pan (as scripts/fanperf.mjs does), each
// draw() timed, and what it sent: mesh instances, lane rects, 2D strokes.
// A mid phone is roughly 4× slower than this machine's node.
import { appendFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, it } from 'vitest';
import { RectBatch } from './meshgl';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree } from './splits';
import { laneAt, leftAt } from './layout';
import { ColumnPath, CutMemo } from './twigs';

/** The width scale bar's target length (px, view.ts drawWidthScale). */
const SCALE_BAR_PX = 70;
import * as VIEW from './view';
import { FanView } from './view';
const LC: Record<string, number> = (VIEW as unknown as { LC?: Record<string, number> }).LC ?? { layouts: 0 };
import { loadMammalsFromFiles } from './mammals-node';

const RUN = !!process.env.FANPERF;
/** Where the rows go as they come (FANPERF=<file>), and the console. */
const out = (s: string) => {
  console.log(s);
  if (RUN && process.env.FANPERF !== '1') appendFileSync(process.env.FANPERF!, s + '\n');
};

/** FANPERF_HASH=1: a hash of everything each frame sends (the GL batches, the 2D calls' arguments), per scene: frames identical before and after a change (ToLaD#255). */
const HASH = !!process.env.FANPERF_HASH;
let hsh = 0x811c9dc5;
let chs = 0x811c9dc5;
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function mix(...a: unknown[]): void {
  if (!HASH) return;
  for (const v of a) {
    if (typeof v === 'number') {
      f64[0] = v;
      hsh = Math.imul(hsh ^ u32[0], 16777619) ^ u32[1];
      hsh = Math.imul(hsh, 16777619);
    } else if (typeof v === 'string') for (let i = 0; i < v.length; i++) hsh = Math.imul(hsh ^ v.charCodeAt(i), 16777619);
  }
}
function mixArr(f: Float32Array, n: number): void {
  if (!HASH) return;
  const u = new Uint32Array(f.buffer, f.byteOffset, n);
  for (let i = 0; i < n; i++) hsh = Math.imul(hsh ^ u[i], 16777619);
}

function stubs() {
  const calls = { stroke: 0, fill: 0, text: 0, pieces: 0 };
  class P {
    moveTo(...a: unknown[]) {
      calls.pieces++;
      mix('m', ...a);
    }
    lineTo(...a: unknown[]) {
      calls.pieces++;
      mix('l', ...a);
    }
    arc() {}
    bezierCurveTo(...a: unknown[]) {
      calls.pieces++;
      mix('c', ...a);
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
    fillRect(...a: unknown[]) {
      calls.fill++;
      mix('R', ...a);
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
    moveTo(...a: unknown[]) {
      calls.pieces++;
      mix('M', ...a);
    },
    lineTo(...a: unknown[]) {
      calls.pieces++;
      mix('L', ...a);
    },
    arc: noop,
    arcTo: noop,
    rect: noop,
    roundRect: noop,
    bezierCurveTo(...a: unknown[]) {
      calls.pieces++;
      mix('C', ...a);
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
    fillText(...a: unknown[]) {
      calls.text++;
      mix('T', ...a);
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
    let t0 = performance.now();
    const { canvas, calls } = stubs();
    // (Hashed: a frame clock, 1/60 s a draw, so the labels' fades read the same whatever the frames took; the times then mean nothing.)
    let clock = 0;
    if (HASH) performance.now = () => clock;
    // FANPERF_CLADE=carnivora: the order (ToLaD#146) instead of the cats; =mammalia: every mammal (ToLaD#247).
    const mamm = process.env.FANPERF_CLADE === 'mammalia';
    const carn = process.env.FANPERF_CLADE === 'carnivora';
    // (The page fetches mammals.json, mammals-data.ts; here it is built from the files, outside the timing.)
    if (mamm) {
      await loadMammalsFromFiles();
      t0 = performance.now();
    }
    const v = mamm
      ? new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), 'curved', mammaliaTree(), true)
      : new FanView(canvas as unknown as HTMLCanvasElement, carn ? CARNIVORA : FELIDAE, 'curved', carn ? CARNIVORA_TREE : FELIDAE_TREE, carn);
    const tNew = performance.now() - t0;
    const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
    gl.begin = () => {
      gl.under.n = 0;
      gl.over.n = 0;
    };
    (v as unknown as { gl: unknown }).gl = gl;
    if (HASH) {
      const draw = v.draw.bind(v);
      v.draw = () => {
        clock += 1000 / 60;
        draw();
      };
    }
    const t1 = performance.now();
    v.draw();
    const tFirst = performance.now() - t1;
    out(`load: new FanView ${tNew.toFixed(0)} ms, first draw ${tFirst.toFixed(0)} ms`);
    // Per-part timings: the view's private draw steps, wrapped.
    const parts = ['drawStrand', 'drawMerged', 'drawIndividuals', 'drawLabels', 'lodNow', 'drawStem', 'drawStemFade', 'drawTimeAxis', 'drawTouch', 'drawGutter', 'drawEvents', 'drawHeld', 'applyFold', 'layoutBrackets'];
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
    // The labels (ToLaD#255): each layout's time (labelsNow when it laid out, not carried), and the label work a frame
    // (labelsNow + drawLabels + the pins, labelAllMs). FANPERF_LAYOUT=1: laid out every frame (no carry), for the layout's spread.
    const labLay: number[] = [];
    const vl = v as unknown as { labelsNow(l: unknown): { carried: unknown }; labLast: unknown; labelAllMs: number[] };
    const labelsNow = vl.labelsNow.bind(v);
    vl.labelsNow = (l: unknown) => {
      if (process.env.FANPERF_LAYOUT) vl.labLast = null;
      const t = CPU ? cpuMs() : performance.now();
      const L0 = vl.labLast as Record<string, unknown> | null;
      const g0 = (v as unknown as { gesturing: boolean }).gesturing;
      const r = labelsNow(l);
      if (process.env.FANPERF_LABDBG && r.carried === null && L0) {
        const L1 = vl.labLast as Record<string, unknown>;
        out(`  relayout: moving ${g0} ${['fan', 'lg', 'lod', 'lodGen', 'w', 'h', 'names', 'topLine'].filter((k) => L0[k] !== L1[k]).join(',')} frames ${L0.frames}`);
      }
      if (r.carried === null) labLay.push((CPU ? cpuMs() : performance.now()) - t);
      return r;
    };
    // How many strands get sampled per frame, and at how many points.
    const lp = { n: 0, pts: 0 };
    const lanePoints = v.lanePoints.bind(v);
    v.lanePoints = (b, hw) => {
      const r = lanePoints(b, hw);
      lp.n++;
      lp.pts += r.n;
      return r;
    };
    const fan = v.fan;
    // (FANPERF_COUNT=1: calls per frame of the hot helpers.)
    const cnt: Record<string, number> = {};
    if (process.env.FANPERF_COUNT) {
      const wrap = (o: Record<string, unknown>, k: string, name: string) => {
        const f = o[k] as (...a: unknown[]) => unknown;
        o[k] = function (this: unknown, ...a: unknown[]) {
          cnt[name] = (cnt[name] ?? 0) + 1;
          // (FANPERF_COUNT=stacks: the fold's left() by its callers, every 64th call's.)
          if (process.env.FANPERF_COUNT === 'stacks' && name === 'fold.left' && cnt[name] % 64 === 0) {
            const st = (new Error().stack ?? '').split('\n').slice(2, 6).map((l) => l.trim().split(' ')[1]).join('<');
            cnt['  ' + st] = (cnt['  ' + st] ?? 0) + 64;
          }
          return f.apply(this, a);
        };
      };
      wrap(fan.tess as unknown as Record<string, unknown>, 'xRange', 'xRange');
      wrap(fan.tess as unknown as Record<string, unknown>, 'xTable', 'xTable');
      if (fan.tess.fold) for (const k of ['left', 'rowXs', 'row']) wrap(fan.tess.fold as unknown as Record<string, unknown>, k, `fold.${k}`);
      wrap(ColumnPath.prototype as unknown as Record<string, unknown>, 'build', 'path.build');
      wrap(CutMemo.prototype as unknown as Record<string, unknown>, 'update', 'cutMemo.update');
    }
    const cat = fan.branches.find((b) => b.sp.common === 'Domestic cat')!;
    const unit = fan.branches[0].unit;
    const scenes: [string, () => void][] = [
      ['home (linear)', () => (v.cam = v.homeCamera())],
      ['pinch+pan (home)', () => (v.cam = v.homeCamera())],
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
      ['lion close', 2000, 60, 5],
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
    // The dogs ×15 (the order only): the family's level camera, the fold opened on them.
    // Every mammal: orders at a zoom their families stand apart at (ToLaD#247).
    if (mamm)
      for (const [taxon, z] of [['Rodentia', 3], ['Chiroptera', 4], ['Carnivora', 15]] as const)
        scenes.push([
          `${taxon} x${z}`,
          () => {
            v.cam = v.levelCamera(taxon, z)!;
            v.camera.settle();
          },
        ]);
    if (process.env.FANPERF_DEBUG && mamm) {
      const f = fan.tess.fold as unknown as { ordShare: number[]; pairOrd: Int32Array; pairGap: Float64Array; folds(i: number): boolean };
      let top = 0;
      let nTop = 0;
      for (let i = 0; i < f.pairOrd.length; i++) if (!f.folds(i)) (top += f.pairGap[i]), nTop++;
      out(`orders ${f.ordShare.length}: ${f.ordShare.map((x) => x.toFixed(3)).join(' ')}; always-open pairs ${nTop}, their gaps ${(top / fan.trunkWidth).toFixed(2)} x the trunk`);
    }
    if (carn)
      scenes.push([
        'dogs x15',
        () => {
          v.cam = v.levelCamera('Canidae', 15)!;
          v.camera.settle();
        },
      ]);
    out(`scene                 p50    p95    max   gest  frame  level   (ms, node${CPU ? ' CPU time' : ''}: draw(); gest the zoomAbout + pan before it, p50; frame both, p50; level: levelNow once at the gesture's end)`);
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
      // (FANPERF_XR=1: each strand's culling range against its exact extent over the screen, 2000 heights.)
      if (process.env.FANPERF_XR) {
        const [, sTop] = v.toWorld(0, -20);
        const [, sBot] = v.toWorld(0, v.h + 20);
        let bad = 0;
        let vis = 0;
        for (const b of fan.branches) {
          const r = fan.tess.xRange(b, sTop, sBot);
          let L = Infinity;
          let R = -Infinity;
          for (let k = 0; k <= 2000; k++) {
            const y = sTop + ((sBot - sTop) * k) / 2000;
            if (y < b.tipY) continue;
            const w = laneAt(b, y).w;
            if (!(w > 0)) continue;
            const x = leftAt(b, y);
            L = Math.min(L, x);
            R = Math.max(R, x + w);
          }
          const on = (a: number, z: number) => !(v.toScreen(z, 0)[0] < -12 || v.toScreen(a, 0)[0] > v.w + 12);
          if (on(L, R)) vis++;
          if (on(L, R) && !on(r[0], r[1])) bad++;
          if (L < r[0] - 1e-9 || R > r[1] + 1e-9) out(`  ${b.sp.common}: exact ${v.toScreen(L, 0)[0].toFixed(1)}..${v.toScreen(R, 0)[0].toFixed(1)} xRange ${v.toScreen(r[0], 0)[0].toFixed(1)}..${v.toScreen(r[1], 0)[0].toFixed(1)}`);
        }
        out(`  xr: ${vis} visible, ${bad} culled wrongly`);
      }
      for (const k of Object.keys(acc)) delete acc[k];
      const times: number[] = [];
      // (The gesture itself: zoomAbout and pan, the camera's settle, the fold's anchor and follow, ToLaD#255.)
      const gest: number[] = [];
      let rects = 0;
      calls.stroke = calls.fill = calls.text = calls.pieces = 0;
      lp.n = lp.pts = 0;
      labLay.length = 0;
      vl.labelAllMs.length = 0;
      for (const k of Object.keys(cnt)) delete cnt[k];
      const N = 90;
      // ('pinch+pan': a faster pinch and a wider pan, as a finger does, ToLaD#255.)
      const fast = name.startsWith('pinch');
      // (Under the fingers, as InputHandlers has it: the level (levelNow) waits for the gesture's end, timed apart below.)
      const vg = v as unknown as { gestureStart(): void; gestureEnd(): void; levelNow(now?: boolean): unknown };
      vg.gestureStart();
      for (let k = 0; k < N; k++) {
        const t0 = CPU ? cpuMs() : performance.now();
        v.zoomAbout(195, 422, fast ? (k < 45 ? 1.04 : 1 / 1.04) : k < 45 ? 1.01 : 1 / 1.01);
        v.pan(fast ? (k % 30 < 15 ? 6 : -6) : k % 2 ? 0.5 : -0.5, fast ? (k % 20 < 10 ? 4 : -4) : 0);
        // (FANPERF_CPU=1: this process's CPU time, not the wall clock: steadier on a busy machine.)
        const t = CPU ? cpuMs() : performance.now();
        gest.push(t - t0);
        // (The camera the gesture left, hashed apart: cam.)
        const hk = hsh;
        hsh = chs;
        mix(v.cam.cx, v.cam.cy, v.cam.sx, v.cam.sy);
        chs = hsh;
        hsh = hk;
        v.draw();
        times.push((CPU ? cpuMs() : performance.now()) - t);
        mixArr(gl.under.f, 12 * gl.under.n);
        mixArr(gl.over.f, 12 * gl.over.n);
        rects = Math.max(rects, gl.under.n);
      }
      vg.gestureEnd();
      // The gesture's end: the level the view is at worked out (ToLaD#258's ladder), once.
      const tl = performance.now();
      vg.levelNow(true);
      const tLevel = performance.now() - tl;
      const labAll = vl.labelAllMs.slice();
      const nLay = labLay.length;
      // At rest after it (ToLaD#255): the labels laid out there, hashed (key, place, x, y1, box, fit of every spot): the same before and after a change.
      v.draw();
      v.draw();
      if (process.env.FANPERF_REST) for (let k = 0; k < +process.env.FANPERF_REST; k++) v.draw();
      const sp = (vl.labLast as { spots: { key: string; x: number; y1: number; box: number[]; fit: number }[] } | null)?.spots ?? [];
      if (process.env.FANPERF_SPOTS) appendFileSync(process.env.FANPERF_SPOTS, sp.map((s) => `${name} ${s.key} ${s.x.toFixed(2)} ${s.y1.toFixed(2)} ${s.fit.toFixed(3)}`).join("\n") + "\n");
      const hk = hsh;
      hsh = 0x811c9dc5;
      for (const s of sp) {
        for (let i = 0; i < s.key.length; i++) hsh = Math.imul(hsh ^ s.key.charCodeAt(i), 16777619);
        for (const x of [s.x, s.y1, ...s.box, s.fit]) {
          f64[0] = x;
          hsh = Math.imul(Math.imul(hsh ^ u32[0], 16777619) ^ u32[1], 16777619);
        }
      }
      if (process.env.FANPERF_LABDBG) out(`  LC per layout: ${Object.entries(LC).map(([k, n]) => `${k} ${(n / Math.max(1, LC.layouts)).toFixed(k[0] === "t" ? 1 : 0)}`).join(' ')}`);
      for (const k of Object.keys(LC)) LC[k] = 0;
      const restHash = `${sp.length} spots ${(hsh >>> 0).toString(16).padStart(8, '0')}`;
      hsh = hk;
      out(`  labels: layout p50 ${q(labLay, 0.5)?.toFixed(1)} p95 ${q(labLay, 0.95)?.toFixed(1)} max ${Math.max(...labLay).toFixed(1)} (${nLay} of ${N} frames); label work/frame p50 ${q(labAll, 0.5).toFixed(1)} p95 ${q(labAll, 0.95).toFixed(1)} mean ${(labAll.reduce((a, b) => a + b, 0) / labAll.length).toFixed(1)}; at rest ${restHash}`);
      // (FANPERF_TIMES=1: every frame's time, to see where the slow ones fall.)
      if (process.env.FANPERF_COUNT) out(`  calls/f:\n${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `    ${(n / N).toFixed(0).padStart(6)} ${k}`).join('\n')}`);
      if (process.env.FANPERF_TIMES) out(`  ${times.map((x) => x.toFixed(0)).join(' ')}`);
      const f = (x: number) => x.toFixed(1).padStart(6);
      const top = Object.entries(acc)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, t]) => `${k.replace('draw', '')} ${(t / N).toFixed(1)}`)
        .join(', ');
      if (HASH) out(`  hash ${(hsh >>> 0).toString(16).padStart(8, '0')} cam ${(chs >>> 0).toString(16).padStart(8, '0')}`);
      hsh = chs = 0x811c9dc5;
      out(
        `${name.padEnd(20)} ${f(q(times, 0.5))} ${f(q(times, 0.95))} ${f(Math.max(...times))} ${f(q(gest, 0.5))} ${f(q(times.map((x, i) => x + gest[i]), 0.5))} ${f(tLevel)}  rects ${String(rects).padStart(5)} strokes/f ${(calls.stroke / N).toFixed(0).padStart(5)} pieces/f ${(calls.pieces / N).toFixed(0).padStart(6)} strands/f ${(lp.n / N).toFixed(0).padStart(3)} pts/f ${(lp.pts / N).toFixed(0).padStart(6)} | ${top}`,
      );
    }
    if (prof) {
      const { profile } = await prof.post('Profiler.stop');
      writeFileSync(process.env.FANPERF_PROF!, JSON.stringify(profile));
    }
  });
});
