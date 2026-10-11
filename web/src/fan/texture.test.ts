import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { laneAt, layoutFan, leftAt } from './layout';
import { FELIDAE } from './panthera';
import { latticeRep, latticeTop, shadeMesh, unpackInst, type MeshInst } from './mesh';
import { MeshBatch, rgb01 } from './meshgl';
import { drawTwigs, kLogAt, LINEAGE, LIVING, SCALE_BAR_PX, TEXTURE_IND, textureFade, lineLevel, TWIG_GRAY, TwigModel, type TwigView } from './twigs';

const PAL = [LIVING, LINEAGE, TWIG_GRAY].map(rgb01);

/** Unpack the batch's instances (meshgl.ts layout, mesh.ts packInst). */
function unpack(b: MeshBatch): MeshInst[] {
  const mesh: MeshInst[] = [];
  for (let k = 0; k < b.n; k++) mesh.push(unpackInst(b.f, b.u, k));
  return mesh;
}

/** Shade a grid of screen points through the CPU mirror of the shader: lit pixels and their colours. */
function shadeScreen(v: TwigView, c: FanCamera, insts: MeshInst[], step = 3, x0 = 0, x1 = c.w) {
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
        const [r, g, b, a] = shadeMesh(m, px, py, kLog, nowPx, PAL);
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

const lionIdx = FELIDAE.species.findIndex((s) => s.common === 'Lion');

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
  const f = layoutFan(FELIDAE, 'linear');
  const c = new FanCamera(f, (b) => new TwigModel(b, f.time, 'linear'));
  c.w = 390;
  c.h = 844;
  // view.ts widthScale: px per individual = unit · sx; the bar is SCALE_BAR_PX long.
  const sx = SCALE_BAR_PX / perBar / f.branches[0].unit;
  const b = f.branches[lionIdx];
  const y = f.time.y(ago * 1e-6);
  c.cam = { cx: 0, cy: y, sx, sy, ty: sy };
  c.settle();
  const L = laneAt(b, c.cam.cy);
  c.cam.cx = leftAt(b, y) + (at === undefined ? L.gw : L.w * at);
  return { c, b, m: new TwigModel(b, f.time, 'linear') };
}

/** The lines an instance draws with weight > minA whose centres fall in [w0, w1) (screen x). */
function linesIn(x: MeshInst, w0: number, w1: number, minA = 0.3): number[] {
  const pp = x.bw / 2 ** x.lvl;
  const out: number[] = [];
  for (let bb = Math.max(0, Math.floor((w0 - x.xB0) / x.bw) - 1); x.xB0 + bb * x.bw < w1; bb++) {
    const B = x.B0 + bb;
    const K = latticeRep(x.latSeed, x.lvl, B);
    const lx = x.xB0 + bb * x.bw + (K - B * 2 ** x.lvl + 0.5) * pp;
    const wgt = x.fineA < 1 && !latticeTop(x.latSeed, x.lvl, B) ? x.fineA : 1;
    if (lx >= w0 && lx < w1 && wgt > minA) out.push(lx);
  }
  return out;
}

describe('the texture of lines, then the individuals on them', () => {
  it('the individuals fade in as the width scale bar reads ~100 individuals; above that, lines', () => {
    expect(textureFade(1000)).toBe(0);
    expect(textureFade(TEXTURE_IND[0])).toBe(0);
    expect(textureFade(50)).toBeGreaterThan(0.25);
    expect(textureFade(TEXTURE_IND[1])).toBe(1);
    expect(TEXTURE_IND[0]).toBeLessThanOrEqual(120);
    for (const [perBar, lives] of [
      [1e6, false],
      [1000, false],
      [100, false],
      [50, true],
      [20, true],
    ] as const) {
      const { c, b, m } = at(perBar);
      const { v } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const mi = unpack(v.mesh!);
      if (perBar >= 100) expect(mi.some((x) => x.mode === 0 && x.alpha > 0.01)).toBe(true);
      expect(mi.some((x) => x.mode === 1 && x.alpha > 0.01)).toBe(lives);
      // Lit, not a flat fill (some pixels dark), and the lanes dim under it.
      const { lit, n } = shadeScreen(v, c, mi);
      expect(lit).toBeGreaterThan(1000);
      // (The cross-links between the lines add some: still far from a fill.)
      expect(lit).toBeLessThan(n * (lives ? 0.8 : 0.7));
      // (The living's lane dims fully once it is wide enough to hold lines; narrower, it is one
      // line of its own width, modulated by the lives on it: never plain.)
      const gwPx = laneAt(b, c.cam.cy).gw * c.cam.sx;
      if (gwPx > 24) expect(st?.fadeGreen ?? 0).toBeGreaterThan(0.25);
      if (gwPx < 6 && !lives) expect(mi.some((x) => x.mode === 0 && (x.narG ?? 0) > 0.5)).toBe(true);
      expect(st?.texGray ?? 0).toBeGreaterThan(0.25);
    }
  });

  it('density follows width = individuals: across the scale bar, about N individuals in either lane', () => {
    for (const N of [30, 1e2, 1e3, 1e4, 5e4]) {
      const counts: number[] = [];
      for (const lane of ['green', 'gray'] as const) {
        const { c, b, m } = at(N);
        const { v } = stubView(c);
        drawTwigs(v, b, m, null);
        const mesh = unpack(v.mesh!);
        const xG = c.toScreen(leftAt(b, c.cam.cy) + laneAt(b, c.cam.cy).gw, c.cam.cy)[0];
        // One scale bar's width inside the lane, clear of the boundary.
        // (A green lane narrower than the bar: the lane, and the individuals in it.)
        const xL = c.toScreen(leftAt(b, c.cam.cy), c.cam.cy)[0];
        const [w0, w1] = lane === 'green' ? [Math.max(xL + 2, xG - 4 - SCALE_BAR_PX), xG - 4] : [xG + 4, xG + 4 + SCALE_BAR_PX];
        const pitchPx = m.pitch(c.cam.cy) * c.cam.sx;
        const inWindow = (w1 - w0) / pitchPx;
        const row = c.h / 2;
        const here = mesh.filter((x) => x.alpha > 0.3 && x.y0 <= row && x.y1 > row);
        expect(here.length).toBeGreaterThan(0);
        const x = here[0];
        expect(x.bw / 2 ** x.lvl).toBeCloseTo(pitchPx, 6);
        if (N < TEXTURE_IND[1]) {
          // The individuals themselves: every slot (one life) per individual.
          expect(x.lvl).toBe(0);
          expect(x.fineA).toBe(1);
          const slots = Math.round(SCALE_BAR_PX / x.bw);
          expect(slots).toBeGreaterThan(N * 0.8);
          expect(slots).toBeLessThan(N * 1.25);
          continue;
        }
        // The texture: distinct lines across the window, each standing for 2^λ individuals.
        const { lambda } = lineLevel(pitchPx);
        const xs = linesIn(x, w0, w1);
        const represented = xs.length * 2 ** lambda;
        expect(xs.length).toBeGreaterThanOrEqual(4); // lines, not one fat line
        expect(represented).toBeGreaterThan(inWindow / 2.2);
        expect(represented).toBeLessThan(inWindow * 2.2);
        counts.push(xs.length / (w1 - w0));
        // ...and they are drawn: separate lit runs along the row.
        const kLog = kLogAt(v, c.fan.time, c.cam.cy);
        const nowPx = c.toScreen(0, c.yNow)[1];
        let runs = 0;
        let on = false;
        for (let px = w0 + 0.5; px < w1; px += 0.5) {
          let a = 0;
          for (const y of here) a = Math.max(a, shadeMesh(y, px, row, kLog, nowPx, PAL)[3]);
          if (a > 0.05 && !on) runs++;
          on = a > 0.05;
        }
        expect(runs).toBeGreaterThanOrEqual(3);
      }
      // The same density of lines in both lanes.
      if (counts.length === 2 && N <= 1e4) expect(counts[0] / counts[1]).toBeGreaterThan(0.5), expect(counts[0] / counts[1]).toBeLessThan(2);
    }
  });

  it('a line seen at a coarse zoom stays in place as one zooms in, until it is the slot\'s own life', () => {
    // The lines drawn across the column at 1e4 per bar, by slot, are drawn at 1e3, 100 and 35 per bar too.
    let prev: Set<number> | null = null;
    for (const N of [1e4, 1e3, 100, 35]) {
      const { m } = at(N);
      const { L } = lineLevel(SCALE_BAR_PX / N);
      const set = new Set<number>();
      for (let B = Math.floor(5e5 / 2 ** L); B * 2 ** L < 5.2e5; B++) set.add(latticeRep(m.latticeSeed, L, B));
      if (prev) for (const K of prev) if (K >= 5e5 && K < 5.2e5) expect(set.has(K)).toBe(true);
      prev = set;
    }
  });
});

describe('the dead lane', () => {
  it('shows real lives once the bar reads under ~100 individuals: ended lines gray, green lanes green', () => {
    // (Times whose screen stays above the lion's split from the cave lion, 0.5 Ma: below it the lion is a
    // slice of the parent column, shifted sideways, its lanes the parent's.)
    for (const ago of [2000, 1e5]) {
      const seen: Set<string>[] = [];
      // (Well inside each lane: near now the crash narrows the green lane to a sixth of the column.)
      for (const where of [0.95, 0.04]) {
        const { c, b, m } = at(20, ago, 5, where);
        const { v } = stubView(c);
        const st = drawTwigs(v, b, m, null);
        const insts = unpack(v.mesh!).filter((x) => x.alpha > 0.01);
        expect(insts.length).toBeGreaterThan(0);
        const { lit, colours } = shadeScreen(v, c, insts, 4);
        expect(lit).toBeGreaterThan(100);
        expect(st?.texGray ?? 0).toBeGreaterThan(0.25);
        seen.push(colours);
      }
      // The gray lane is one colour (line ended); the green lane's colours are none of it.
      expect(seen[0].size).toBe(1);
      for (const k of seen[1]) expect(seen[0].has(k)).toBe(false);
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
