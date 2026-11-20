// @ts-nocheck (scratch, ToLaD#591: not for main)
// Scratch (turtle591, not for commit): the amniotes' lizard and bird gestures in node, frame by frame.
//   LIZ=<out.json> MAMMALS_JSON=dist-single/amniotes-all.json [LIZ_LOOK=faint] [LIZ_PROF=<prefix>] [LIZ_ONLY=liz,aves] npx vitest run src/fan/zzliz.test.ts
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { describe, it } from 'vitest';
import { setFlip } from './flip';
import { Batches, SEG_F as SEGF } from './meshgl';
import { loadMammals, unpackMammals, type MammalFile } from './mammals-data';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { FanView } from './view';
import { setUnknownLook } from './dashed'; // LOOK

const OUT = process.env.LIZ;
const log = (s: string) => OUT && appendFileSync(OUT + '.log', `${new Date().toISOString().slice(11, 19)} ${s}\n`);
const proc = process as unknown as { threadCpuUsage?(): { user: number; system: number } };
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
const stats = (a: number[]) => ({ n: a.length, p50: +q(a, 0.5).toFixed(1), p95: +q(a, 0.95).toFixed(1), max: +q(a, 1).toFixed(1), sum: Math.round(a.reduce((x, y) => x + y, 0)) });

describe.skipIf(!OUT)('turtles (perf)', () => {
  it('moves', async () => {
    const res: Record<string, unknown> = { look: process.env.LIZ_LOOK || 'default' };
    const canvas = stubCanvas();
    setFlip(true);
    if (process.env.LIZ_LOOK) setUnknownLook(process.env.LIZ_LOOK as 'faint'); // LOOK
    await loadMammals(async () => unpackMammals(JSON.parse(readFileSync(process.env.MAMMALS_JSON!, 'utf8')) as MammalFile));
    let c0 = cpuMs();
    const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
    const gl = Object.assign(new Batches(), { end() {} });
    (v as unknown as { gl: unknown }).gl = gl;
    v.draw();
    v.draw();
    res.openCpu = Math.round(cpuMs() - c0);
    log(`open ${res.openCpu}`);
    const at = v as unknown as {
      cam: unknown;
      anim: ((now: number) => boolean) | null;
      levelCamera(n: string): unknown;
      gestureStart(): void;
      gestureEnd(): void;
      levelNow(now?: boolean): unknown;
      toScreen(x: number, y: number): [number, number];
      flyToClade(v: unknown): unknown;
      w: number;
      h: number;
      frameMs: number[];
      labelMs: number[];
    };
    const only = process.env.LIZ_ONLY?.split(',');
    // (TURT_DIG=1: per frame, a digest of the GL batches (rects under and over, chords, their runs) and of the labels.)
    const DIG = !!process.env.TURT_DIG;
    const fnv = (h: number, u: Uint32Array) => {
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619);
      return h;
    };
    const digest = (): string => {
      const G = (v as unknown as { gl: { under: { n: number; f: Float32Array }; over: { n: number; f: Float32Array }; segs: { n: number; f: Float32Array } } }).gl;
      let h = 2166136261;
      h = fnv(h, new Uint32Array(G.under.f.buffer, 0, 12 * G.under.n));
      h = fnv(h, new Uint32Array(G.over.f.buffer, 0, 12 * G.over.n));
      h = fnv(h, new Uint32Array(G.segs.f.buffer, 0, G.segs.n * SEGF));
      const cl = (v as unknown as { cutLast: { spots: { key: string; box: number[] }[]; names: { key: string; box: number[] }[]; pics: { x: number; y: number }[] } }).cutLast;
      const str = JSON.stringify([cl.spots.map((q) => [q.key, q.box]), cl.names.map((q) => [q.key, q.box]), cl.pics.map((q) => [q.x, q.y])]);
      let l = 2166136261;
      for (let c = 0; c < str.length; c++) l = Math.imul(l ^ str.charCodeAt(c), 16777619);
      return `${(h >>> 0).toString(36)}:${G.under.n}/${G.over.n}/${G.segs.n}:${(l >>> 0).toString(36)}`;
    };
    // (TURT_DIAG=1: per frame, the strands drawStrand was asked for, those that got points, their points, cutForks' calls, the merged clades.)
    const DIAG = !!process.env.TURT_DIAG;
    const P = FanView.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const ctr = { ask: 0, lp: 0, pts: 0, cf: 0, cfIn: 0, wsum: 0, wtiny: 0, on: 0, none: 0, left: 0, right: 0, cross: 0, nothing: 0 };
    if (DIAG) {
      for (const [k, f] of [['drawStrandX', (b: { width: number }) => { ctr.ask++; }], ['lanePoints', (b: { width: number }) => { ctr.lp++; const w = b.width * (v as unknown as { cam: { sx: number } }).cam.sx; ctr.wsum += w; if (w < 0.25) ctr.wtiny++; }], ['cutForks', (p: { n: number }) => { ctr.cf++; ctr.cfIn += p.n; }]] as const) {
        const g = P[k];
        P[k] = function (this: unknown, ...a: unknown[]) {
          (f as (x: unknown) => void)(a[0]);
          const r = g.apply(this, a);
          if (k === 'lanePoints') {
            const R = r as { n: number; x: Float64Array; y: Float64Array; w: Float64Array };
            lastPts = R;
            ctr.pts += R.n;
            const sx = (v as unknown as { cam: { sx: number } }).cam.sx;
            let c = 0;
            for (let i = 0; i < R.n; i++) if (R.x[i] + R.w[i] * sx > -30 && R.x[i] < (v as unknown as { w: number }).w + 30) c++;
            ctr.on += c;
            if (!c) {
              ctr.none++;
              let lo = Infinity;
              let hi = -Infinity;
              for (let i = 0; i < R.n; i++) {
                lo = Math.min(lo, R.x[i]);
                hi = Math.max(hi, R.x[i]);
              }
              if (hi < 0) ctr.left++;
              else if (lo > 0) ctr.right++;
              else ctr.cross++;
            }
          }
          return r;
        };
      }
    }
    let lastPts: { n: number; x: Float64Array; y: Float64Array; w: Float64Array } | null = null;
    if (DIAG) {
      const g0 = P.drawStrand;
      P.drawStrand = function (this: unknown, ...a: unknown[]) {
        ctr.ask++;
        const G = (v as unknown as { gl: { under: { n: number }; over: { n: number }; segs: { n: number } } }).gl;
        const lp0 = ctr.lp;
        const n0 = G.under.n + G.over.n + G.segs.n;
        const r = g0.apply(this, a);
        if (ctr.lp > lp0 && G.under.n + G.over.n + G.segs.n === n0) {
          ctr.nothing++;
          const b = a[0] as { sp: { sci: string; countUnknown: boolean; extinct: boolean }; width: number };
          const key = `${b.sp.countUnknown}`;
          if ((dumped[key] ?? 0) < 2 && process.env.TURT_DUMP) {
            dumped[key] = (dumped[key] ?? 0) + 1;
            const R = lastPts!;
            const row: string[] = [];
            for (let i = 0; i < R.n; i++) row.push(`${R.x[i].toFixed(0)},${R.y[i].toFixed(0)},${(R.w[i] * (v as unknown as { cam: { sx: number } }).cam.sx).toExponential(1)}`);
            log(`DUMP ${b.sp.sci} unknown ${b.sp.countUnknown} extinct ${b.sp.extinct} w ${(b.width * (v as unknown as { cam: { sx: number } }).cam.sx).toExponential(1)} n ${R.n}: ${row.join(' ')}`);
          }
        }
        return r;
      };
    }
    const diagLog: string[] = [];
    const dumped: Record<string, number> = {};
    const diag = (name: string, k: number) => {
      const lod = (v as unknown as { lod: { merged: unknown[] } | null }).lod;
      if (k % 5 === 0) log(`  ${name} #${k} ask ${ctr.ask} drawn ${ctr.lp} [no batch item ${ctr.nothing}] (tiny<0.25px ${ctr.wtiny}) pts ${ctr.pts} (on screen ${ctr.on}; strands none on ${ctr.none}: left ${ctr.left} right ${ctr.right} cross ${ctr.cross}) cutForks ${ctr.cf} (pts in ${ctr.cfIn}) merged ${lod?.merged.length} sx ${(v as unknown as { cam: { sx: number } }).cam.sx.toExponential(2)}`);
      ctr.ask = ctr.lp = ctr.pts = ctr.cf = ctr.cfIn = ctr.wsum = ctr.wtiny = ctr.on = ctr.none = ctr.left = ctr.right = ctr.cross = ctr.nothing = 0;
    };
    const out: Record<string, unknown> = {};
    res.scenes = out;
    const save = () => writeFileSync(OUT!, JSON.stringify(res, null, 1));
    // One gesture: its frames' wall ms, thread-CPU ms, draw()'s own ms and labelsNow's ms.
    const gesture = (name: string, steps: (k: number) => boolean, n: number) => {
      const wall: number[] = [];
      const cpu: number[] = [];
      const lab: number[] = [];
      const dig: string[] = [];
      for (let k = 0; k < n; k++) {
        const t = performance.now();
        const c = cpuMs();
        const l0 = v.labelMs.length;
        const lLast = v.labelMs[l0 - 1];
        if (!steps(k)) break;
        v.draw();
        wall.push(performance.now() - t);
        cpu.push(cpuMs() - c);
        if (v.labelMs.length > l0 || v.labelMs[v.labelMs.length - 1] !== lLast) lab.push(v.labelMs[v.labelMs.length - 1]);
        if (DIAG) diag(name, k);
        if (DIG) dig.push(digest());
      }
      out[name] = { wall: stats(wall), cpu: stats(cpu), labels: stats(lab), ...(DIG ? { dig } : {}) };
      log(`${name} ${JSON.stringify(out[name])}`);
      save();
    };
    const pinch = (name: string) => {
      at.gestureStart();
      gesture(name, (k) => (v.zoomAbout(at.w / 2, at.h / 2, k < 20 ? 1.06 : 1 / 1.06), true), 40);
      at.gestureEnd();
      at.levelNow(true);
    };
    const pan = (name: string) => {
      at.gestureStart();
      gesture(name, (k) => (v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3), true), 30);
      at.gestureEnd();
      at.levelNow(true);
    };
    const flight = (name: string, go: () => void) => {
      go();
      let now = performance.now();
      gesture(
        name,
        () => {
          const a = at.anim;
          if (!a) return false;
          now += 16.7;
          if (!a(now)) at.anim = null;
          return true;
        },
        600,
      );
      at.anim = null;
      at.levelNow(true);
    };
    const level = (t: string) => {
      at.cam = at.levelCamera(t);
      v.draw();
      v.draw();
    };
    const widest = (pred: (b: (typeof v.fan.branches)[number]) => boolean) => {
      const on = v.fan.branches.filter((b) => {
        const [x, y] = at.toScreen(b.cx, b.tipY);
        return pred(b) && x > 0 && x < at.w && y > -at.h && y < 2 * at.h;
      });
      return (on.length ? on : v.fan.branches.filter(pred)).reduce((p, x) => (x.width > p.width ? x : p));
    };
    const prof = process.env.LIZ_PROF ? new Session() : null;
    if (prof) {
      prof.connect();
      await prof.post('Profiler.enable');
    }
    const scene = async (name: string, f: () => void) => {
      if (only && !only.includes(name)) return;
      if (prof) await prof.post('Profiler.start');
      const c = cpuMs();
      f();
      out[name + ':cpu'] = Math.round(cpuMs() - c);
      if (prof) writeFileSync(`${process.env.LIZ_PROF}-${name}.cpuprofile`, JSON.stringify((await prof.post('Profiler.stop')).profile));
      save();
    };
    const node = (t: string) => v.fan.nodes.find((x) => x.split.taxon === t)!;
    const sp = (sci: string) => v.fan.branches.find((x) => x.sp.sci === sci)!.sp;
    const homeCam = () => {
      at.cam = (v as unknown as { homeCamera(): unknown }).homeCamera();
      v.draw();
      v.draw();
    };
    // A level: its pinch and pan, the flight into a family, a pinch and pan there, the flight to a species in it.
    const lvl = (tag: string, lv: string, fam: string, sci: string) =>
      scene(tag, () => {
        level(lv);
        pinch(`${tag} pinch`);
        pan(`${tag} pan`);
        flight(`${tag} fly ${fam}`, () => at.flyToClade(node(fam)));
        pinch(`${tag} ${fam} pinch`);
        pan(`${tag} ${fam} pan`);
        flight(`${tag} fly ${sci}`, () => v.flyToSpecies(sp(sci), false));
        pinch(`${tag} ${sci} pinch`);
      });
    const search = (tag: string, sci: string) =>
      scene(tag, () => {
        homeCam();
        flight(`${tag} search ${sci}`, () => v.flyToSpecies(sp(sci), true));
        pinch(`${tag} pinch`);
      });
    if (process.env.TURT_PROBE) {
      level('Crocodylia');
      const V = v as unknown as { w: number; h: number; cam: { cx: number; cy: number; sx: number; sy: number }; camera: { worldY(p: number): number } };
      const b = v.fan.branches.find((x) => x.sp.sci === process.env.TURT_PROBE)!;
      const sf = v.fan.tess.fold as unknown as { meets(i: number, y0: number, y1: number, xa: number, xb: number): boolean; left(i: number, y: number): number; sY: Float64Array; pY: Float64Array[] };
      const sTop = V.camera.worldY(-20);
      const sBot = V.camera.worldY(V.h + 20);
      const r = Math.max(b.baseW, b.width) + 12 / V.cam.sx;
      const xa = V.cam.cx - V.w / 2 / V.cam.sx - r;
      const xb = V.cam.cx + V.w / 2 / V.cam.sx + r;
      log(`PROBE w ${V.w} h ${V.h} cam ${JSON.stringify(V.cam)} sTop ${sTop} sBot ${sBot} xa ${xa} xb ${xb} tip ${b.tipY} split ${b.splitY} sY ${sf.sY[b.index]} meets ${sf.meets(b.index, sTop, sBot, xa, xb)}`);
      log(`  baseW ${b.baseW} width ${b.width} unit ${b.unit}; strands with baseW 0: ${v.fan.branches.filter((x) => !(x.baseW > 0)).length} of ${v.fan.branches.length}`);
      const dbg: number[] = [];
      (sf as unknown as { meets(...a: unknown[]): boolean }).meets(b.index, sTop, sBot, xa, xb, dbg);
      const sc = (x: number) => ((x - V.cam.cx) * V.cam.sx + V.w / 2).toFixed(0);
      const rows: string[] = [];
      for (let k = 0; k < dbg.length; k += 5) rows.push(`[${dbg[k]} ${dbg[k + 1].toFixed(4)}..${dbg[k + 2].toFixed(4)} ${sc(dbg[k + 3])}..${sc(dbg[k + 4])}]`);
      log(`  pieces ${rows.join(' ')}`);
      log(`  pY ${[...sf.pY[b.index]].map((y) => y.toFixed(3)).join(' ')}`);
      const ys: string[] = [];
      for (let k = 0; k <= 40; k++) {
        const y = sTop + ((sBot - sTop) * k) / 40;
        ys.push(`${y.toFixed(2)}:${((sf.left(b.index, y) - V.cam.cx) * V.cam.sx + V.w / 2).toFixed(0)}`);
      }
      log(`  left ${ys.join(' ')}`);
      return;
    }
    await lvl('turt', 'Testudines', 'Cheloniidae', 'Lepidochelys olivacea');
    await lvl('tort', 'Testudines', 'Testudinidae', 'Aldabrachelys gigantea');
    await lvl('croc', 'Crocodylia', 'Crocodylidae', 'Crocodylus niloticus');
    await lvl('liz', 'Squamata', 'Scincidae', 'Tiliqua scincoides');
    await lvl('aves', 'Aves', 'Accipitridae', 'Haliaeetus leucocephalus');
    await lvl('mamm', 'Mammalia', 'Felidae', 'Panthera leo');
    await search('sturt', 'Lepidochelys olivacea');
    await search('sbird', 'Passer domesticus');
    save();
  }, 3600000);
});
