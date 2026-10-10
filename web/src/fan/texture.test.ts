import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { laneAt, layoutFan, leftAt } from './layout';
import { PANTHERA } from './panthera';
import { isTree, shadeMesh, shadeTree, unpackInst, type MeshInst, type TreeInst } from './mesh';
import { MeshBatch, rgb01 } from './meshgl';
import { drawTwigs, kLogAt, LINEAGE, LIVING, SCALE_BAR_PX, TEXTURE_IND, textureFade, treeLevel, TWIG_GRAY, TWIG_WITHERED, TwigModel, type TwigView } from './twigs';

const PAL = [LIVING, LINEAGE, TWIG_GRAY, TWIG_WITHERED].map(rgb01);

/** Unpack the batch's instances (meshgl.ts layout, mesh.ts packInst / packTree). */
function unpack(b: MeshBatch): { mesh: MeshInst[]; tree: TreeInst[] } {
  const mesh: MeshInst[] = [];
  const tree: TreeInst[] = [];
  for (let k = 0; k < b.n; k++) {
    const x = unpackInst(b.f, b.u, k);
    if (isTree(x)) tree.push(x);
    else mesh.push(x);
  }
  return { mesh, tree };
}

/** Shade a grid of screen points through the CPU mirror of the shader: lit pixels and their colours. */
function shadeScreen(v: TwigView, c: FanCamera, insts: (MeshInst | TreeInst)[], step = 3, x0 = 0, x1 = c.w) {
  const kLog = kLogAt(v, c.fan.time, c.cam.cy);
  const nowPx = c.toScreen(0, c.yNow)[1];
  // Each instance over its own rectangle only (a grid of rows `step` px apart, every px across).
  const rows = Math.ceil(c.h / step);
  const cols = Math.ceil(x1 - x0);
  const hit = new Uint8Array(rows * cols);
  const colours = new Set<string>();
  for (const m of insts) {
    const r0 = Math.max(0, Math.ceil((m.y0 - 0.5) / step));
    const r1 = Math.min(rows - 1, Math.floor((m.y1 - 0.5) / step));
    const q0 = Math.max(0, Math.ceil(m.x0 - x0 - 0.5));
    const q1 = Math.min(cols - 1, Math.floor(m.x1 - x0 - 0.5));
    for (let rr = r0; rr <= r1; rr++) {
      const py = rr * step + 0.5;
      for (let q = q0; q <= q1; q++) {
        if (hit[rr * cols + q]) continue;
        const px = x0 + q + 0.5;
        const [r, g, b, a] = isTree(m) ? shadeTree(m, px, py, PAL) : shadeMesh(m, px, py, kLog, nowPx, PAL);
        if (a > 0.02) {
          hit[rr * cols + q] = 1;
          colours.add([r, g, b].map((x) => Math.round(x * 20)).join(','));
        }
      }
    }
  }
  const lit = hit.reduce((a, b) => a + b, 0);
  return { lit, n: rows * cols, colours };
}

const lionIdx = PANTHERA.species.findIndex((s) => s.common === 'Lion');

/** Strokes drawn through a stub canvas: colour, width and the number of path pieces. */
function stubView(c: FanCamera) {
  const strokes: { style: string; lw: number; pieces: number }[] = [];
  class P {
    pieces = 0;
    moveTo() {
      this.pieces++;
    }
    lineTo() {}
    arc() {}
    bezierCurveTo() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = P;
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    stroke(this: { strokeStyle: string; lineWidth: number }, p?: P) {
      strokes.push({ style: String(this.strokeStyle), lw: this.lineWidth, pieces: p?.pieces ?? 0 });
    },
    fill() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    bezierCurveTo() {},
    save() {},
    restore() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  const v: TwigView = {
    mesh: new MeshBatch(),
    ctx,
    w: c.w,
    h: c.h,
    sx: c.cam.sx,
    sy: c.cam.sy,
    toScreen: (x, y) => c.toScreen(x, y),
    toWorld: (x, y) => c.toWorld(x, y),
    yNow: c.yNow,
  };
  return { v, strokes };
}

/**
 * A camera on the lion `ago` years back, the width scale bar reading `perBar`
 * individuals, time zoom sy; centred on the boundary of its lanes (green left
 * of the middle, gray right), or `at` of the way across its column.
 */
function at(perBar: number, ago = 3000, sy = 40, at?: number) {
  const f = layoutFan(PANTHERA, 'linear');
  const c = new FanCamera(f, (b) => new TwigModel(b, f.time, 'linear'));
  c.w = 390;
  c.h = 844;
  const sumEver = f.branches.reduce((a, b) => a + b.sp.ever, 0);
  // view.ts widthScale: px per individual = trunkWidth / Σ ever · sx; the bar is SCALE_BAR_PX long.
  const sx = ((SCALE_BAR_PX / perBar) * sumEver) / f.trunkWidth;
  const b = f.branches[lionIdx];
  const y = f.time.y(ago * 1e-6);
  c.cam = { cx: 0, cy: y, sx, sy, ty: sy };
  c.settle();
  const L = laneAt(b, c.cam.cy);
  c.cam.cx = leftAt(b, y) + (at === undefined ? L.gw : L.w * at);
  return { c, b, m: new TwigModel(b, f.time, 'linear') };
}

describe('the tree texture, then the individuals', () => {
  it('the individuals fade in as the width scale bar reads ~100 individuals; above that, the tree', () => {
    expect(textureFade(1000)).toBe(0);
    expect(textureFade(TEXTURE_IND[0])).toBe(0);
    expect(textureFade(50)).toBeGreaterThan(0.25);
    expect(textureFade(TEXTURE_IND[1])).toBe(1);
    expect(TEXTURE_IND[0]).toBeLessThanOrEqual(120);
    for (const [perBar, tree, mesh] of [
      [1e6, true, false],
      [1000, true, false],
      [100, true, false],
      [50, true, true],
      [20, false, true],
    ] as const) {
      const { c, b, m } = at(perBar);
      const { v } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const { mesh: mi, tree: ti } = unpack(v.mesh!);
      expect(ti.some((x) => x.alpha > 0.01)).toBe(tree);
      expect(mi.some((x) => x.alpha > 0.01)).toBe(mesh);
      // Lit, not a flat fill (some pixels dark), and the lanes dim under it.
      const { lit, n } = shadeScreen(v, c, [...ti, ...mi]);
      expect(lit).toBeGreaterThan(1000);
      expect(lit).toBeLessThan(n * (mesh ? 0.8 : 0.45));
      expect(st?.fadeGreen ?? 0).toBeGreaterThan(0.25);
      expect(st?.texGray ?? 0).toBeGreaterThan(0.25);
    }
  });

  it('density follows width = individuals: across the scale bar, about N individuals in either lane', () => {
    for (const N of [30, 1e2, 1e3, 1e4, 5e4]) {
      for (const lane of ['green', 'gray'] as const) {
        const { c, b, m } = at(N);
        const { v } = stubView(c);
        drawTwigs(v, b, m, null);
        const { mesh, tree } = unpack(v.mesh!);
        const xG = c.toScreen(leftAt(b, c.cam.cy) + laneAt(b, c.cam.cy).gw, c.cam.cy)[0];
        // One scale bar's width inside the lane, clear of the boundary.
        // (A green lane narrower than the bar: the lane, and the individuals in it.)
        const xL = c.toScreen(leftAt(b, c.cam.cy), c.cam.cy)[0];
        const [w0, w1] = lane === 'green' ? [Math.max(xL + 2, xG - 4 - SCALE_BAR_PX), xG - 4] : [xG + 4, xG + 4 + SCALE_BAR_PX];
        const pitchPx = m.pitch(c.cam.cy) * c.cam.sx;
        const inWindow = (w1 - w0) / pitchPx;
        if (lane === 'green' && N > 2e4) expect(inWindow).toBeLessThan(N); // the living: ~23 thousand
        if (N < TEXTURE_IND[1]) {
          // The individuals themselves: one slot (one life) per individual.
          const lives = mesh.filter((x) => x.mode === 1 && x.alpha > 0.5);
          expect(lives.length).toBeGreaterThan(0);
          for (const x of lives) expect(x.slotDx).toBeCloseTo(pitchPx, 6);
          const slots = Math.round(SCALE_BAR_PX / lives[0].slotDx);
          expect(slots).toBeGreaterThan(N * 0.8);
          expect(slots).toBeLessThan(N * 1.25);
          continue;
        }
        // The tree: distinct strands across the bar, each standing for 2^L individuals.
        const { L } = treeLevel(pitchPx);
        const xs = new Set(tree.filter((t) => t.alpha > 0.3 && t.xm >= w0 && t.xm < w1).map((t) => t.xm.toFixed(3)));
        const represented = xs.size * 2 ** L;
        expect(xs.size).toBeGreaterThanOrEqual(4); // strands, not one fat line
        expect(represented).toBeGreaterThan(inWindow / 2.2);
        expect(represented).toBeLessThan(inWindow * 2.2);
      }
    }
  });
});

describe('the dead lane', () => {
  it('shows real lives, gray and pale green mixed, once the bar reads under ~100 individuals', () => {
    for (const ago of [2000, 2e5]) {
      const { c, b, m } = at(20, ago, 5, 0.7);
      const { v } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const insts = unpack(v.mesh!).mesh.filter((x) => x.alpha > 0.01);
      expect(insts.length).toBeGreaterThan(0);
      const { lit, colours } = shadeScreen(v, c, insts, 4);
      expect(lit).toBeGreaterThan(100);
      expect(colours.size).toBeGreaterThan(1);
      expect(st?.texGray ?? 0).toBeGreaterThan(0.25);
    }
  });

  it('draws the real individuals: their own births, deaths and lifespans', () => {
    const { c, m } = at(100, 2000, 50);
    const g = m.generationAt(c.cam.cy);
    const lives = Array.from({ length: 64 }, (_, k) => m.twig(g, k * 37)).filter((t) => !t.alive);
    const spans = lives.map((t) => t.yBirth - t.yDeath);
    // Lifespans differ (it is not one band of equal strands).
    expect(Math.max(...spans) / Math.min(...spans)).toBeGreaterThan(1.5);
  });
});
