import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { laneAt, layoutFan, leftAt, strandAt } from './layout';
import { PANTHERA } from './panthera';
import { MESH_F, shadeMesh, type MeshInst } from './mesh';
import { MeshBatch, rgb01 } from './meshgl';
import { drawTwigs, kLogAt, LINEAGE, LIVING, SCALE_BAR_PX, TEXTURE_IND, textureFade, TWIG_GRAY, TWIG_WITHERED, TwigModel, type TwigView } from './twigs';

const PAL = [LIVING, LINEAGE, TWIG_GRAY, TWIG_WITHERED].map(rgb01);

/** Unpack the batch's instances (meshgl.ts layout, mesh.ts packInst). */
function unpack(b: MeshBatch): MeshInst[] {
  const out: MeshInst[] = [];
  for (let k = 0; k < b.n; k++) {
    const f = b.f.subarray(k * MESH_F, (k + 1) * MESH_F);
    const u = b.u.subarray(k * 8, (k + 1) * 8);
    out.push({
      x0: f[0], y0: f[1], x1: f[2], y1: f[3], slotX0: f[4], slotDx: f[5], lw: f[6], fineA: f[7], p0: f[8], T0: f[9], A: f[10], gBoff: f[11],
      alpha: f[12], mode: f[13] as 0 | 1, lane: f[14], tipR: f[15], GL: f[16], Lm: f[17], nowRel: f[18],
      iBase: u[0], iStep: u[1], nA: u[2], nB: u[3], seedA: u[4], seedB: u[5], thrA: u[6], thrB: u[7],
    });
  }
  return out;
}

/** Shade a grid of screen points through the CPU mirror of the shader: lit pixels and their colours. */
function shadeScreen(v: TwigView, c: FanCamera, insts: MeshInst[], step = 3) {
  const kLog = kLogAt(v, c.fan.time, c.cam.cy);
  const nowPx = c.toScreen(0, c.yNow)[1];
  let lit = 0;
  const colours = new Set<string>();
  for (let py = 0.5; py < c.h; py += step) {
    for (let px = 0.5; px < c.w; px += 1) {
      for (const m of insts) {
        const [r, g, b, a] = shadeMesh(m, px, py, kLog, nowPx, PAL);
        if (a > 0.02) {
          lit++;
          colours.add([r, g, b].map((x) => Math.round(x * 20)).join(','));
          break;
        }
      }
    }
  }
  return { lit, colours };
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

/** A camera on the lion's green lane 40 years ago, the width scale bar reading `perBar` individuals. */
function at(perBar: number) {
  const f = layoutFan(PANTHERA, 'linear');
  const c = new FanCamera(f, (b) => new TwigModel(b, f.time, 'linear'));
  c.w = 390;
  c.h = 844;
  const sumEver = f.branches.reduce((a, b) => a + b.sp.ever, 0);
  // view.ts widthScale: px per individual = trunkWidth / Σ ever · sx; the bar is SCALE_BAR_PX long.
  const sx = ((SCALE_BAR_PX / perBar) * sumEver) / f.trunkWidth;
  const b = f.branches[lionIdx];
  const age = 40e-6;
  const y = f.time.y(age);
  const st = strandAt(b, age, 'linear');
  c.cam = { cx: leftAt(b, y) + (st.w * st.f) / 2, cy: y, sx, sy: 50, ty: 50 };
  c.settle();
  return { c, b, m: new TwigModel(b, f.time, 'linear') };
}

describe('the living texture', () => {
  it('fades in as the width scale bar reads ~100 individuals, while the strands are still sub-pixel', () => {
    expect(textureFade(1000)).toBe(0);
    expect(textureFade(TEXTURE_IND[0])).toBe(0);
    expect(textureFade(100)).toBeGreaterThan(0.25);
    expect(textureFade(TEXTURE_IND[1])).toBe(1);
    for (const [perBar, shows] of [
      [1000, false],
      [100, true],
      [60, true],
    ] as const) {
      const { c, b, m } = at(perBar);
      const { v } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const insts = unpack(v.mesh!).filter((x) => x.lane === 0 && x.alpha > 0.01);
      if (!shows) {
        expect(insts.length).toBe(0);
        continue;
      }
      // Under a pixel per individual, the lives themselves not yet shown...
      const L = m.lanes(c.cam.cy);
      expect((L.gw / m.size(m.generationAt(c.cam.cy))) * c.cam.sx).toBeLessThan(1.5);
      expect(insts.every((x) => x.mode === 0)).toBe(true);
      // ...but the texture of real lives is lit across the lane (not a flat fill: some pixels dark), and the lane dims under it.
      const { lit } = shadeScreen(v, c, insts);
      expect(lit).toBeGreaterThan(1000);
      expect(lit).toBeLessThan((c.w * c.h) / 3);
      expect(st?.fadeGreen ?? 0).toBeGreaterThan(0.25);
    }
  });
});

/** A camera on the lion's gray (dead) lane `ago` years back, the width scale bar reading `perBar` individuals. */
function atGray(perBar: number, ago: number, sy = 5) {
  const f = layoutFan(PANTHERA, 'linear');
  const c = new FanCamera(f, (b) => new TwigModel(b, f.time, 'linear'));
  c.w = 390;
  c.h = 844;
  const sumEver = f.branches.reduce((a, b) => a + b.sp.ever, 0);
  const sx = ((SCALE_BAR_PX / perBar) * sumEver) / f.trunkWidth;
  const b = f.branches[lionIdx];
  const y = f.time.y(ago * 1e-6);
  c.cam = { cx: 0, cy: y, sx, sy, ty: sy };
  c.settle();
  // The lanes at the step grid of this time zoom.
  const L = laneAt(b, y);
  c.cam.cx = leftAt(b, y) + L.gw + (L.w - L.gw) / 2;
  return { c, b, m: new TwigModel(b, f.time, 'linear') };
}

describe('the dead texture', () => {
  it('shows real lives, not a flat fill, from ~100 individuals per scale bar or as soon as slots are pixels apart', () => {
    for (const [perBar, shows] of [
      [1e7, false],
      [1000, true],
      [100, true],
    ] as const) {
      // 2000 years ago, thousands of years on screen: far too many lives to draw them all.
      const { c, b, m } = atGray(perBar, 2000);
      const { v } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const insts = unpack(v.mesh!).filter((x) => x.lane !== 0 && x.alpha > 0.01);
      if (!shows) {
        expect(insts.length).toBe(0);
        expect(st?.texGray ?? 0).toBe(0);
        continue;
      }
      // Lives are lit across the screen, gray and pale green mixed, and the gray lane dims under them.
      const { lit, colours } = shadeScreen(v, c, insts, 4);
      expect(lit).toBeGreaterThan(100);
      expect(colours.size).toBeGreaterThan(1);
      expect(st?.texGray ?? 0).toBeGreaterThan(0.25);
    }
  });

  it('draws the real individuals: their own births, deaths and lifespans', () => {
    const { c, m } = atGray(100, 2000, 50);
    const g = m.generationAt(c.cam.cy);
    const lives = Array.from({ length: 64 }, (_, k) => m.twig(g, k * 37)).filter((t) => !t.alive);
    const spans = lives.map((t) => t.yBirth - t.yDeath);
    // Lifespans differ (it is not one band of equal strands).
    expect(Math.max(...spans) / Math.min(...spans)).toBeGreaterThan(1.5);
  });
});
