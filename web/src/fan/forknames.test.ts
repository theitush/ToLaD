// The upper clades' names at their forks (ToLaD#373, the switch on, the default): none meets another, a picture or a
// name pill, the time axis's gutter or the scale bar's foot, at the homes and on the way into a clade; each stands at
// its fork and moves rigidly with it; a tap on one is the tap on its bracket's name was; the pinned rows still come.
import { describe, expect, it } from 'vitest';
import { FORK_H, forkNames, setForkNames, type Brackets } from './brackets';
import { CARNIVORA } from './panthera';
import { CARNIVORA_TREE } from './splits';
import { FanView, type CutLabels } from './view';

function stubView(): FanView {
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
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'textBaseline', 'textAlign'].includes(k) ? noop : undefined),
    set: () => true,
  });
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
  return new FanView(canvas as unknown as HTMLCanvasElement, CARNIVORA, CARNIVORA_TREE, true);
}

type Inner = { brackets: Brackets; applyFold(): void; cutLast: CutLabels | null };
const inner = (v: FanView) => v as unknown as Inner;
const frame = (v: FanView) => {
  v.camera.settle();
  inner(v).applyFold();
  v.draw();
};
const meets = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** The names' boxes this frame, each checked against the others, the labels and the screen's margins. */
function clear(v: FanView, where: string): number {
  const br = inner(v).brackets;
  const cut = inner(v).cutLast!;
  const obstacles = [...cut.spots.filter((s) => s.fit > 0.3).map((s) => s.box as readonly number[]), ...cut.pics.map((p) => [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2])];
  const boxes: number[][] = [];
  for (let k = 0; k < br.forkN; k++) {
    const f = br.forks[k];
    const b = [f.x - f.pw / 2, f.y - FORK_H / 2, f.x + f.pw / 2, f.y + FORK_H / 2];
    const name = `${where}: ${br.list[f.i].latin}`;
    expect(b[0], `${name} past the axis's gutter`).toBeGreaterThanOrEqual(72);
    expect(b[2], `${name} past the edge`).toBeLessThanOrEqual(v.w);
    expect(b[3], `${name} into the foot`).toBeLessThanOrEqual(br.forkFoot + 1e-6);
    for (const o of obstacles) expect(meets(b, o), `${name} on a label, ${b} / ${o}`).toBe(false);
    for (const o of boxes) expect(meets(b, o), `${name} on another name, ${b} / ${o}`).toBe(false);
    boxes.push(b);
  }
  return boxes.length;
}

describe('names at their forks (ToLaD#373)', () => {
  if (!forkNames()) setForkNames(true);

  it('carnivores home: the stack is gone, the names clear of each other, the labels and the margins', () => {
    const v = stubView();
    v.cam = v.homeCamera();
    frame(v);
    const br = inner(v).brackets;
    expect(br.moreRow).toBe(-1);
    expect(clear(v, 'home')).toBeGreaterThanOrEqual(2);
    expect(br.pinA).toBe(0);
  });

  it('zooming and panning: always clear, and the same names the same way from one small step to the next', () => {
    const v = stubView();
    v.cam = v.homeCamera();
    frame(v);
    const br = inner(v).brackets;
    let flips = 0;
    let last = new Map<string, number>();
    for (let k = 0; k < 120; k++) {
      v.cam = { ...v.cam, sx: v.cam.sx * 1.01, cx: v.cam.cx + 0.3 / v.cam.sx };
      frame(v);
      clear(v, `step ${k}`);
      const now = new Map<string, number>();
      for (let j = 0; j < br.forkN; j++) now.set(br.list[br.forks[j].i].latin, br.forks[j].y);
      // (A name that is there at k, gone at k + 1 and back at k + 2 would be flicker; a place jumping back and forth too.)
      for (const [n, y] of now) if (last.has(n) && Math.abs(last.get(n)! - y) > 40) flips++;
      last = now;
    }
    expect(flips).toBeLessThanOrEqual(6);
  });

  it('a name moves rigidly with its fork under a pan of the time', () => {
    const v = stubView();
    v.cam = v.homeCamera();
    frame(v);
    const br = inner(v).brackets;
    const k = br.forks.findIndex((f, j) => j < br.forkN && br.list[f.i].v.parent === null);
    expect(k).toBeGreaterThanOrEqual(0);
    // (Twice: the axis's labels it stays clear of are last frame's.)
    frame(v);
    const y0 = br.forks[k].y;
    v.cam = { ...v.cam, cy: v.cam.cy + 6 / v.cam.sy };
    frame(v);
    frame(v);
    expect(Math.abs(br.forks[k].y - (y0 - 6))).toBeLessThan(0.01);
  });

  it('a tap on a name is its clade: the same target its bracket was', () => {
    const v = stubView();
    v.cam = v.homeCamera();
    frame(v);
    const br = inner(v).brackets;
    expect(br.forkN).toBeGreaterThan(0);
    const f = br.forks[0];
    expect(br.hit(f.x, f.y)?.latin).toBe(br.list[f.i].latin);
    expect(br.named(br.list[f.i].v)).toBe(true);
    expect(v.bracketAt(br.list[f.i].latin)).toEqual([f.x, f.y]);
  });

  it('scrolled into the past: the pinned rows come, the labels have made way, nothing said twice', () => {
    const v = stubView();
    v.cam = { ...v.homeCamera() };
    frame(v);
    const br = inner(v).brackets;
    let seen = false;
    for (let k = 0; k < 300 && !seen; k++) {
      v.cam = { ...v.cam, sy: v.cam.sy * 1.02, ty: v.cam.sy * 1.02, cy: v.cam.cy + 3 / v.cam.sy };
      frame(v);
      clear(v, `scroll ${k}`);
      if (br.pinA > 0 && br.pins.length) seen = true;
    }
    expect(seen).toBe(true);
    const pinned = new Set(br.pins.map((p) => p.i));
    for (let k = 0; k < br.forkN; k++) expect(pinned.has(br.forks[k].i)).toBe(false);
    // (The pictures' tops clear the pinned rows: the band's row came down as far as their most.)
    for (const s of inner(v).cutLast!.spots) if (s.fit > 0.3) expect(s.box[1]).toBeGreaterThanOrEqual(br.pinTop + br.pinH() - 1);
  });
});
