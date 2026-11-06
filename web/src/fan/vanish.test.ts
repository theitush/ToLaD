// Branches that vanish at some zooms (ToLaD#389, Ita 2026-11-04: "the branches disappear sometimes under diff zoom
// regimes"). Over the zoom ladder, width and time apart and with pans: every strand with a lineage in a screen row
// (the layout's own leftAt and laneAt) must have something drawn for it there, by its own drawStrand, in the batches
// the GPU gets (a clade drawn as one ribbon, lod.ts: by its ribbon). Corners stand for a peel's height by design (flat forks, Steady.strandForks with share 0): counted apart.
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RectBatch } from './meshgl';
import { laneAt, leftAt, type FanBranch, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { setGapMode, gapMode, type GapMode } from './fold';
import { forkMode, setForkMode, Steady, type ForkMode } from './steady';
import { FanView } from './view';

// Run with VANISH_OUT=<file> for the whole ladder and, per zoom, the block counts (blockStats): how many strands' own
// columns stand in one unbroken stretch, gaps under a device pixel; VANISH_MODES=groups:flat,age:flat to compare.

function stubView(clade: CladeRec, tree: Split, folds = true): { v: FanView; under: RectBatch } {
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
  const ctx = new Proxy(
    { measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>,
    { get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]), set: (o, k, v) => ((o[k as string] = v), true) },
  );
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
  const v = new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
  const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
  gl.begin = () => {
    gl.under.n = 0;
    gl.over.n = 0;
  };
  (v as unknown as { gl: unknown }).gl = gl;
  // (The labels draw nothing the branches depend on, and are most of a frame's cost.)
  Object.assign(v, { labelsNow: () => ({ br: null, cut: null }), drawLabels: noop, drawTimeAxis: noop, drawTrunkLabel: noop, drawWidthScale: noop, drawGutter: noop, drawTouch: noop });
  return { v, under: gl.under };
}

type Miss = { cam: string; sp: string; y: number; px: number; why: string };
const ROWS = 24;
const GRID_MISS = 3;
const W = 390;
const H = 844;

/** One frame at this camera: the strands' rows with a lineage on screen against what each one's drawStrand sent. */
function frameMisses(v: FanView, under: RectBatch, label: string, out: Miss[]): { rows: number; corner: number } {
  const own = new Map<number, [number, number]>();
  const self = v as unknown as { drawStrand(b: FanBranch): void };
  const proto = FanView.prototype as unknown as { drawStrand(b: FanBranch): void };
  self.drawStrand = (b: FanBranch) => {
    const n0 = under.n;
    proto.drawStrand.call(v, b);
    own.set(b.index, [n0, under.n]);
  };
  const merged = new Map<FanNode, [number, number]>();
  const sm = v as unknown as { drawMerged(n: FanNode): void };
  const pm = FanView.prototype as unknown as { drawMerged(n: FanNode): void };
  sm.drawMerged = (n: FanNode) => {
    const n0 = under.n;
    pm.drawMerged.call(v, n);
    merged.set(n, [n0, under.n]);
  };
  v.draw();
  const cam = (v as unknown as { camera: { screenX(x: number): number; worldY(y: number): number } }).camera;
  const fan = v.fan;
  const fold = fan.tess.fold;
  const lod = v.lodNow();
  // The corners: brute force over every split against the ones the draw's culling hands to drawCorners.
  if (fold instanceof Steady && forkMode() === 'flat') {
    const seen = new Set<number>();
    fold.splitsOn(cam.worldY(-4), cam.worldY(H + 4), v.toWorld(-8, 0)[0], v.toWorld(W + 8, 0)[0], (j) => seen.add(j));
    const c: number[] = [];
    fan.nodes.forEach((n, j) => {
      if (seen.has(j) || (lod && (lod.hidden(n) || lod.isMerged(n)))) return;
      const pc = cam.screenX(fold.corner(n, v.cam.sx, v.cam.sy, c));
      const y0 = (cam as unknown as { screenY(y: number): number }).screenY(n.y);
      const yt = (cam as unknown as { screenY(y: number): number }).screenY(n.y - fold.forkH(n));
      for (let q = 0; q < n.kids.length; q++) {
        if (c[2 * q + 1] > 0) continue;
        const dc = cam.screenX(c[2 * q]);
        const flat = y0 >= 0 && y0 <= H && Math.max(pc, dc) >= 0 && Math.min(pc, dc) <= W;
        const up = dc >= 0 && dc <= W && y0 >= 0 && yt <= H;
        if (flat || up) out.push({ cam: label, sp: n.split.taxon ?? `node ${j}`, y: n.y, px: flat ? Math.min(Math.max(pc, dc), W) - Math.max(Math.min(pc, dc), 0) : y0 - yt, why: flat ? 'corner dropped: flat line' : 'corner dropped: up line' });
      }
    });
  }
  const steady = fold instanceof Steady && forkMode() === 'flat' ? fold : null;
  const cuts: number[] = [];
  let rows = 0;
  let corner = 0;
  for (const b of fan.branches) {
    const mv = lod && lod.of[b.index] >= 0 ? lod.merged[lod.of[b.index]] : null;
    const [n0, n1] = mv ? (merged.get(mv) ?? [0, 0]) : (own.get(b.index) ?? [0, 0]);
    if (steady) steady.strandForks(b.index, v.cam.sx, v.cam.sy, cam.worldY(-20), cam.worldY(H + 20), cuts);
    for (let r = 0; r < ROWS; r++) {
      const py = ((r + 0.5) / ROWS) * H;
      const y = cam.worldY(py);
      if (y < b.tipY || y > fan.trunkBottom.y) continue;
      const w = laneAt(b, y).w;
      if (!(w > 0)) continue;
      const l = cam.screenX(leftAt(b, y));
      const rr = l + w * v.cam.sx;
      const vis = Math.min(rr, W) - Math.max(l, 0);
      if (rr < 0 || l > W) continue;
      rows++;
      let hit = false;
      for (let k = n0; k < n1 && !hit; k++) {
        const o = k * 12;
        const f = under.f;
        if (f[o + 7] !== 1 || f[o + 1] > py || f[o + 3] < py) continue;
        const t = (py - f[o + 1]) / Math.max(1e-6, f[o + 3] - f[o + 1]);
        const xl = f[o] + f[o + 8] * t;
        const xr = f[o + 2] + f[o + 9] * t;
        if (xr >= l - 1.5 && xl <= rr + 1.5) hit = true;
      }
      if (hit) continue;
      // Through a peel that is no whole ribbon here: narrowed about its middle, or a corner's lines.
      let band = -1;
      for (let q = 0; q < cuts.length; q += 3) if (y >= cuts[q] && y <= cuts[q + 1]) band = cuts[q + 2];
      if (band === 0) {
        corner++;
        continue;
      }
      out.push({ cam: label, sp: b.sp.sci, y, px: vis, why: (mv ? 'merged ' : '') + (n1 === n0 ? 'nothing drawn' : band > 0 ? 'narrowing' : 'row empty') });
    }
  }
  return { rows, corner };
}

/** One zoom's stretches: strands in their own columns on screen, those in a stretch with no background across it. */
type Block = { rows: number; own: number; inBlock: number; maxN: number; maxPx: number; gaps: number[]; merged: number };
const BLOCK_N = 3;
/** Under a device pixel (dpr 2). */
const GAP_PX = 0.5;

/** The frame just drawn, at a few rows: its unbroken stretches of drawn lanes, and how many strands' own columns stand in each. */
function blockStats(v: FanView, under: RectBatch, acc: Block): void {
  const cam = (v as unknown as { camera: { screenX(x: number): number; worldY(y: number): number } }).camera;
  const f = under.f;
  const lod = v.lodNow();
  for (const r of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
    const py = r * H;
    const y = cam.worldY(py);
    const iv: [number, number][] = [];
    for (let k = 0; k < under.n; k++) {
      const o = k * 12;
      if (f[o + 7] !== 1 || f[o + 1] > py || f[o + 3] < py) continue;
      const t = (py - f[o + 1]) / Math.max(1e-6, f[o + 3] - f[o + 1]);
      const xl = f[o] + f[o + 8] * t;
      const xr = f[o + 2] + f[o + 9] * t;
      if (xr >= 0 && xl <= W) iv.push([xl, xr]);
    }
    if (!iv.length) continue;
    iv.sort((a, b) => a[0] - b[0]);
    const run: [number, number][] = [];
    for (const [a, b] of iv) {
      const L = run[run.length - 1];
      if (L && a - L[1] < GAP_PX) L[1] = Math.max(L[1], b);
      else run.push([a, b]);
    }
    const n = new Int32Array(run.length);
    const mids: number[] = [];
    for (const b of v.fan.branches) {
      if (y < b.tipY || y >= b.splitY) continue;
      if (lod && lod.of[b.index] >= 0) {
        acc.merged++;
        continue;
      }
      const w = laneAt(b, y).w;
      if (!(w > 0)) continue;
      const l = cam.screenX(leftAt(b, y));
      const rr = l + w * v.cam.sx;
      if (rr < 0 || l > W) continue;
      acc.own++;
      mids.push(l, rr);
      let a = 0;
      let e = run.length - 1;
      const m = (l + rr) / 2;
      while (a < e) {
        const h = (a + e + 1) >> 1;
        if (run[h][0] <= m) a = h;
        else e = h - 1;
      }
      n[a]++;
    }
    acc.rows++;
    for (let i = 0; i < run.length; i++) {
      if (n[i] < BLOCK_N) continue;
      acc.inBlock += n[i];
      if (n[i] > acc.maxN) {
        acc.maxN = n[i];
        acc.maxPx = Math.min(run[i][1], W) - Math.max(run[i][0], 0);
      }
    }
    // The gaps between neighbours' own columns, as the layout has them (mids sorted per pair).
    const pairs: [number, number][] = [];
    for (let i = 0; i < mids.length; i += 2) pairs.push([mids[i], mids[i + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pairs.length; i++) acc.gaps.push(pairs[i][0] - pairs[i - 1][1]);
  }
}

function sweep(clade: CladeRec, tree: Split, name: string, gaps: GapMode, forks: ForkMode) {
  const g0 = gapMode();
  const f0 = forkMode();
  setGapMode(gaps);
  setForkMode(forks);
  const { v, under } = stubView(clade, tree);
  const home = v.homeCamera();
  const misses: Miss[] = [];
  const blocks = new Map<string, Block>();
  let rows = 0;
  let corner = 0;
  const camera = (v as unknown as { camera: { settle(): void } }).camera;
  const apply = v as unknown as { applyFold(): void };
  const ladder: [string, number, number][] = [];
  // (VANISH_OUT: every zoom, a few minutes at the mammals; the test: where the clades merge and part, and past it.)
  const full = !!process.env.VANISH_OUT;
  for (let k = 0; k <= 12; k += full ? 2 : 4) ladder.push([`w${2 ** k}`, 2 ** k, 1]);
  for (let k = 2; k <= 14; k += full ? 2 : 6) ladder.push([`t${2 ** k}`, 1, 2 ** k]);
  for (let k = 2; k <= 10; k += full ? 2 : 4) ladder.push([`b${2 ** k}`, 2 ** k, 2 ** k]);
  const bs = v.fan.branches;
  const few = bs.length > 100;
  for (const [z, zx, zy] of ladder) {
    for (const sp of few ? [0.2, 0.7] : [0.1, 0.35, 0.6, 0.85]) {
      for (const dy of few ? [0.02, 0.3] : [0.02, 0.2, 0.5, 0.8]) {
        const sx = home.sx * zx;
        const sy = home.sy * zy;
        v.cam = { ...home, sx, sy, ty: sy };
        apply.applyFold();
        const b = bs[Math.floor(sp * (bs.length - 1))];
        const yb = v.fan.trunkBottom.y;
        const cy = b.tipY + (yb - b.tipY) * dy;
        v.cam = { ...v.cam, cx: leftAt(b, cy), cy };
        camera.settle();
        const r = frameMisses(v, under, `${name} ${z} @${sp}/${dy} sx=${v.cam.sx.toExponential(2)} sy=${v.cam.sy.toExponential(2)} cx=${v.cam.cx.toFixed(1)} cy=${v.cam.cy.toFixed(1)}`, misses);
        rows += r.rows;
        if (!blocks.has(z)) blocks.set(z, { rows: 0, own: 0, inBlock: 0, maxN: 0, maxPx: 0, gaps: [], merged: 0 });
        blockStats(v, under, blocks.get(z)!);
        corner += r.corner;
      }
    }
  }
  setGapMode(g0);
  setForkMode(f0);
  return { misses, rows, corner, blocks };
}

function report(t: string, s: ReturnType<typeof sweep>) {
  const big = s.misses.filter((m) => m.px >= 1);
  const by: Record<string, number> = {};
  for (const m of s.misses) by[m.why] = (by[m.why] ?? 0) + 1;
  const worst = [...s.misses].sort((a, b) => b.px - a.px).slice(0, 6);
  appendFileSync(process.env.VANISH_OUT ?? '/dev/stdout', `${t}: rows ${s.rows}, corners ${s.corner}, misses ${s.misses.length} (>=1 px: ${big.length}) ${JSON.stringify(by)}\n` + worst.map((m) => `  ${m.px.toFixed(1)}px ${m.sp} ${m.why} y=${m.y.toFixed(2)} ${m.cam}`).join('\n') + '\n');
  for (const [z, a] of s.blocks) {
    a.gaps.sort((x, y) => x - y);
    const q = a.gaps.length ? a.gaps[a.gaps.length >> 1] : NaN;
    const under = a.gaps.filter((g) => g < GAP_PX).length;
    appendFileSync(process.env.VANISH_OUT ?? '/dev/stdout', `  ${z}: own/row ${(a.own / Math.max(1, a.rows)).toFixed(1)} inBlock ${((100 * a.inBlock) / Math.max(1, a.own)).toFixed(0)}% biggest ${a.maxN} strands in ${a.maxPx.toFixed(0)}px; gap median ${q.toFixed(2)}px, <${GAP_PX}px ${((100 * under) / Math.max(1, a.gaps.length)).toFixed(0)}%; merged/row ${(a.merged / Math.max(1, a.rows)).toFixed(0)}\n`);
  }
}

const MODES = (process.env.VANISH_MODES ?? 'groups:flat').split(',').map((m) => m.split(':') as [GapMode, ForkMode]);
describe('nothing on screen vanishes (ToLaD#389)', () => {
  for (const [name, clade, tree] of [
    ['cats', () => FELIDAE, () => FELIDAE_TREE],
    ['carnivores', () => CARNIVORA, () => CARNIVORA_TREE],
    ['mammals', mammaliaClade, mammaliaTree],
  ] as const) {
    it(name, async () => {
      if (name === 'mammals') await loadMammalsFromFiles();
      for (const [gaps, forks] of MODES) {
        const s = sweep(clade(), tree(), name, gaps, forks);
        if (process.env.VANISH_OUT) report(`${name} gaps=${gaps} forks=${forks}`, s);
        // (A row inside a narrowing peel may fall between its chords; a miss under GRID_MISS px is a stretch of a chord.)
        const gone = s.misses.filter((m) => m.px >= GRID_MISS && m.why !== 'narrowing');
        expect(gone.slice(0, 5).map((m) => `${m.sp} ${m.why} ${m.px.toFixed(1)}px ${m.cam}`)).toEqual([]);
        expect(s.misses.length / s.rows).toBeLessThan(1e-3);
      }
    }, 600_000);
  }
});
