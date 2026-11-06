// `forks: peel` holds still in the world (ToLaD#461): measured at the draw, frame by frame, a merged clade's ribbon through
// a slow pinch and a pan. Second difference of its x at fixed world heights, px: 118 at Carnivora at a grid step before.
import { expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { setForkMode, type ForkMode } from './steady';
import { FanView } from './view';
await loadMammalsFromFiles();
function stub(): FanView {
  const noop = () => {};
  const g = globalThis as Record<string, unknown>;
  g.Path2D = class { moveTo() {} lineTo() {} arc() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} rect() {} };
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.window = { devicePixelRatio: 2 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>,
    { get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]), set: (o, k, x) => { o[k as string] = x; return true; } });
  const canvas = { width: 0, height: 0, style: {}, parentElement: null, getContext: () => ctx, getBoundingClientRect: () => ({ width: 844, height: 390, left: 0, top: 0, right: 844, bottom: 390 }), addEventListener: noop, removeEventListener: noop };
  const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
  const gl = { under: new RectBatch(), over: new RectBatch(), begin() { gl.under.n = 0; gl.over.n = 0; }, end() {} };
  (v as unknown as { gl: unknown }).gl = gl;
  Object.assign(v, { labelsNow: () => ({ br: null, cut: null }), drawLabels: noop, drawTimeAxis: noop, drawTrunkLabel: noop, drawWidthScale: noop, drawGutter: noop });
  return v;
}
type Cam0 = { cx: number; cy: number; sx: number; sy: number; ty: number };
type Line = { xs: number[]; ys: number[] };
function capture(v: FanView): void {
  const a = v as unknown as Record<string, (...x: unknown[]) => unknown> & { cur: string; rec: Map<string, Line> };
  for (const [name, key] of [['drawStrand', (o: { index: number }) => `s${o.index}`], ['drawMerged', (o: { name?: string; y: number }) => `m${o.name ?? o.y}`]] as const) {
    const f = a[name].bind(v);
    a[name] = (o: unknown) => { a.cur = (key as (x: unknown) => string)(o); return f(o); };
  }
  const dl = a.drawLanes.bind(v);
  a.drawLanes = (pts: unknown, ...r: unknown[]) => {
    const p = pts as { n: number; x: Float64Array | number[]; y: Float64Array | number[] };
    const L = a.rec.get(a.cur) ?? { xs: [], ys: [] };
    const c = (v as unknown as { camera: { screenX(x: number): number; worldY(y: number): number } }).camera; const x0 = c.screenX(0), dx = c.screenX(1) - x0;
    for (let i = 0; i < p.n; i++) { L.xs.push((p.x[i] - x0) / dx); L.ys.push(c.worldY(p.y[i])); }
    a.rec.set(a.cur, L);
    return dl(pts, ...r);
  };
}
/** Polyline x at screen y (points bottom up, y falling); null off it. */
function at(L: Line, y: number): number | null {
  const n = L.ys.length;
  if (n < 2 || y > L.ys[0] || y < L.ys[n - 1]) return null;
  let a = 0, e = n - 1;
  while (e - a > 1) { const h = (a + e) >> 1; if (L.ys[h] >= y) a = h; else e = h; }
  const d = L.ys[a] - L.ys[e];
  return d > 0 ? L.xs[a] + ((L.ys[a] - y) / d) * (L.xs[e] - L.xs[a]) : L.xs[a];
}
const SCENES: [string, (v: FanView) => Cam0][] = [
  ['home', (v) => v.homeCamera() as Cam0],
  ['Carnivora', (v) => v.levelCamera('Carnivora') as Cam0],
  ['Felidae', (v) => v.levelCamera('Felidae') as Cam0],
  ['between', (v) => { const h = v.homeCamera() as Cam0; const c = v.levelCamera('Carnivora') as Cam0; const sy = Math.sqrt(h.sy * c.sy); return { ...c, sx: Math.sqrt(h.sx * c.sx), sy, ty: sy, cx: (h.cx + c.cx) / 2, cy: (h.cy + c.cy) / 2 }; }],
];
type Tr = 'pinch' | 'panDown' | 'panAcross';
function run(mode: ForkMode, scene: string, start: (v: FanView) => Cam0, tr: Tr, FR = 40) {
  setForkMode(mode);
  const v = stub();
  capture(v);
  const a = v as unknown as { rec: Map<string, Line>; camera: { settle(): void }; w: number; h: number };
  const c0 = start(v);
  const frames: { rec: Map<string, Line>; cam: Cam0 }[] = [];
  const W = a.w, H = a.h;
  for (let t = 0; t < FR; t++) {
    let cam: Cam0;
    if (tr === 'pinch') { const z = Math.pow(1.012, t); cam = { ...c0, sx: c0.sx * z, sy: c0.sy * z, ty: c0.ty * z }; }
    else if (tr === 'panDown') cam = { ...c0, cy: c0.cy + (1.5 * t) / c0.sy };
    else cam = { ...c0, cx: c0.cx + (1.5 * t) / c0.sx };
    v.cam = cam as never;
    a.camera.settle();
    a.rec = new Map();
    v.draw();
    frames.push({ rec: a.rec, cam: { ...v.cam } as Cam0 });
  }
  // Second difference of the world-tracked x (px) at each polyline vertex of frame t, on screen.
  let wS = 0, wSk = '', nS = 0;
  let worst = { d2: 0, key: '', t: 0, y: 0, x: 0 };
  const hist = [0, 0, 0, 0, 0];
  let probes = 0, big1 = 0;
  let rmax = 0, rkey = '', rT = 0, rY = 0;
  for (let t = 6; t + 1 < FR; t++) {
    const [p, q, r] = [frames[t - 1], frames[t], frames[t + 1]];
    for (const [key, L] of q.rec) {
      const LP = p.rec.get(key), LR = r.rec.get(key);
      if (!LP || !LR) continue;
      for (let i = 1; i + 1 < L.ys.length; i++) {
        const y = L.ys[i];
        const sc = (X: number) => (X - q.cam.cx) * q.cam.sx + W / 2;
        const scy = (Y: number) => (Y - q.cam.cy) * q.cam.sy + H / 2;
        if (scy(y) < 0 || scy(y) > H || sc(L.xs[i]) < 0 || sc(L.xs[i]) > W) continue;
        if (L.ys[i - 1] === y || L.ys[i + 1] === y) continue;
        const wp = at(LP, y), wr = at(LR, y);
        if (wp == null || wr == null) continue;
        const wq = L.xs[i];
        const d1 = (wr - wq) * q.cam.sx;
        const d2 = Math.abs(wr - 2 * wq + wp) * q.cam.sx;
        probes++;
        if (key[0] === 's') { if (d2 > 1) nS++; if (d2 > wS) { wS = d2; wSk = `${key} t${t}`; } }
        if (Math.abs(d1) > 1) big1++;
        hist[d2 < 0.1 ? 0 : d2 < 0.5 ? 1 : d2 < 1 ? 2 : d2 < 3 ? 3 : 4]++;
        if (d2 > worst.d2) worst = { d2, key, t, y: scy(y), x: sc(L.xs[i]) };
        if (Math.abs(d1) > rmax) { rmax = Math.abs(d1); rkey = key; rT = t; rY = scy(y); }
      }
    }
  }
  void [scene, probes, big1, rmax, rkey, rT, rY, nS, wS, wSk];
  return worst;
}
for (const [s, f] of SCENES.filter(([n]) => n === 'Carnivora' || n === 'Felidae')) {
  it(`peel at ${s}: no point of a ribbon moves against the world by over a pixel, through a pinch over a grid step and a pan`, () => {
    for (const tr of ['pinch', 'panDown'] as Tr[]) {
      const w = run('peel', s, f, tr);
      expect(w.d2, `${tr}: ${w.key} at frame ${w.t}`).toBeLessThan(1);
    }
    setForkMode('thin');
  }, 120000);
}
