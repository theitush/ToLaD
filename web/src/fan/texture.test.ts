import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { laneAt, layoutFan, leftAt, strandAt } from './layout';
import { PANTHERA } from './panthera';
import { drawTwigs, SCALE_BAR_PX, TEXTURE_IND, textureFade, TwigModel, type TwigView } from './twigs';

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
      const { v, strokes } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      const tex = strokes.filter((s) => s.style.startsWith('rgba(51,189,102,') && s.pieces > 0);
      if (!shows) {
        expect(tex.length).toBe(0);
        continue;
      }
      // Under a pixel per individual, the strands themselves not yet shown...
      const L = m.lanes(c.cam.cy);
      expect((L.gw / m.size(m.generationAt(c.cam.cy))) * c.cam.sx).toBeLessThan(1.5);
      // ...but the texture is drawn across the screen, and the lane dims under it.
      expect(tex.reduce((a, s) => a + s.pieces, 0)).toBeGreaterThan(100);
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
      const { v, strokes } = stubView(c);
      const st = drawTwigs(v, b, m, null);
      // Gray (line ended) and pale green (has living descendants) lives: the texture's (just under
      // a pixel wide) while there are too many to draw each, then each one's own.
      const tex = strokes.filter((s) => (s.style.startsWith('rgba(154,163,171,') || s.style.startsWith('rgba(134,196,154,')) && s.pieces > 0);
      if (!shows) {
        expect(tex.length).toBe(0);
        expect(st?.texGray ?? 0).toBe(0);
        continue;
      }
      // Lives are drawn across the screen, and the gray lane dims under them.
      expect(tex.reduce((a, s) => a + s.pieces, 0)).toBeGreaterThan(100);
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
