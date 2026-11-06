// The upper clades' names at their forks (ToLaD#373, the switch on, the default): none meets another, a picture or a
// name pill, the time axis's gutter or the scale bar's foot, at the homes and on the way into a clade; each stands at
// its fork and moves rigidly with it; a tap on one is the tap on its bracket's name was; the pinned rows still come.
import { describe, expect, it } from 'vitest';
import { FORK_H, forkNames, setForkNames, type Brackets } from './brackets';
import { nodeLeftAt, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { picBox } from './pics';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView, type CutLabels, type Level } from './view';

function stubView(clade: CladeRec = CARNIVORA, tree: Split = CARNIVORA_TREE): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, true);
}

type Inner = {
  brackets: Brackets;
  applyFold(): void;
  cutLast: CutLabels | null;
  anim: ((t: number) => boolean) | null;
  steps: unknown[];
  tapAt: unknown;
  frameOf(lv: Level): { cx: number; cy: number; sx: number; sy: number; ty: number };
  tapInto(lv: Level, column: boolean): boolean;
  offBy(a: unknown, c: unknown): number;
};
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
  const obstacles = [...cut.spots.filter((s) => s.fit > 0.3).map((s) => s.box as readonly number[]), ...cut.pics.map(picBox)];
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

  // (ToLaD#390: the flights flown a frame each 16 ms, as the page; the names as drawn there.)
  const land = (v: FanView) => {
    const iv = inner(v);
    for (let t = performance.now() + 16; iv.anim; t += 16) {
      if (!iv.anim(t)) iv.anim = null;
      iv.applyFold();
    }
    frame(v);
    v.draw();
  };
  const atHome = (v: FanView) => {
    const iv = inner(v);
    iv.steps = [];
    iv.tapAt = null;
    v.cam = v.homeCamera();
    frame(v);
    v.draw();
  };
  const names = (v: FanView) => {
    const br = inner(v).brackets;
    return Array.from({ length: br.forkN }, (_, k) => br.forks[k]).map((f) => ({ x: f.x, y: f.y, v: br.list[f.i].v, latin: br.list[f.i].latin }));
  };
  const intoWeasels = (v: FanView) => {
    atHome(v);
    const cut = inner(v).cutLast!;
    const p = cut.pics[cut.spots.findIndex((s) => s.text === 'Weasels')];
    v.tap(p.x, p.y);
    land(v);
  };
  const scenes: [string, () => FanView, (v: FanView) => void][] = [
    ['carnivores home', () => stubView(), atHome],
    ['cats home', () => stubView(FELIDAE, FELIDAE_TREE), atHome],
    ['the weasels', () => stubView(), intoWeasels],
  ];
  // (Real, open, ToLaD#446: a fork name asks whether the cut shows its clade split at its own frame, and tapItem asks the same of
  // another frame (runFrame, not the own width), so a second tap goes on a step. `it.fails` turns red when it is fixed.)
  it.fails.each(scenes)('%s: a tap on each name lands on that clade, its fork on screen and its name there; a double tap comes back', (where, make, at) => {
    const v = make();
    const iv = inner(v);
    const offFrame = (n: FanNode) => iv.offBy(iv.frameOf({ v: n }), v.cam);
    at(v);
    const all = names(v);
    expect(all.length, where).toBeGreaterThanOrEqual(3);
    for (const { latin, v: n } of all) {
      // (Where its picture's tap goes, from here; a name already framed stays, its picture's tap going a step finer.)
      at(v);
      const framed = iv.offBy(iv.frameOf({ v: n }), v.cam) <= 12;
      v.tapItem(n.strands[0].index, n.strands[n.strands.length - 1].index);
      land(v);
      // (Unless that frame loses its fork, as Felinae's: then its own frame.)
      const px = v.toScreen(nodeLeftAt(n, n.y) + n.width / 2, n.y)[0];
      const picture = px >= 72 && px <= v.w ? { ...v.cam } : null;
      at(v);
      const start = { ...v.cam };
      const q = names(v).find((f) => f.v === n)!;
      v.tap(q.x, q.y);
      land(v);
      const landed = { ...v.cam };
      const what = `${where}: ${latin}`;
      if (framed) expect(offFrame(n), `${what}: framed already, it stays`).toBeLessThanOrEqual(12);
      else if (picture) expect(iv.offBy(picture, v.cam), `${what}: where its picture's tap goes`).toBeLessThanOrEqual(2);
      else expect(offFrame(n), `${what}: its own frame`).toBeLessThanOrEqual(2);
      expect(v.levelNow(true).v, `${what}: the level`).toBe(n);
      const [fx, fy] = v.toScreen(nodeLeftAt(n, n.y) + n.width / 2, n.y);
      expect(fy, `${what}: the fork over the scale bar`).toBeLessThan(iv.brackets.forkFoot);
      expect(fy, `${what}: the fork on screen`).toBeGreaterThan(0);
      expect(fx, `${what}: the fork on screen`).toBeGreaterThanOrEqual(0);
      expect(fx, `${what}: the fork on screen`).toBeLessThanOrEqual(v.w);
      expect(names(v).some((f) => f.v === n) || iv.brackets.pins.some((p) => iv.brackets.list[p.i].v === n), `${what}: its name there`).toBe(true);
      // (A second tap: framed already, it stays, and is no step of its own.)
      const again = names(v).find((f) => f.v === n);
      if (again) {
        v.tap(again.x, again.y);
        land(v);
        expect(iv.offBy(landed, v.cam), `${what}: a second tap stays`).toBeLessThanOrEqual(2);
      }
      v.doubleTap(0, 0);
      land(v);
      // Back where the tap was, when that zooms out (ToLaD#416). A name above the view flew out already: on, never tighter on width.
      if (start.sx < landed.sx && start.sy <= landed.sy) expect(iv.offBy(start, v.cam), `${what}: a double tap back`).toBeLessThanOrEqual(2);
      else expect(v.w * (v.cam.sx / landed.sx - 1), `${what}: a double tap zooms out`).toBeLessThanOrEqual(12);
    }
  });

  // (Ita: "why does pressing on solenodon put them at the left side? of th escreen and nothing ont he right?" Its own
  // frame, its territory, has its two branches at 74..78 px; its name is there, tapped as the page does.)
  it.fails('mammals: a tap on the Solenodon fork lands as its picture does, both named, not in the left third with the right empty', { timeout: 300_000 }, async () => {
    await loadMammalsFromFiles();
    const v = stubView(mammaliaClade(), mammaliaTree());
    const iv = inner(v);
    v.cam = v.homeCamera();
    frame(v);
    const sol = iv.brackets.list.find((c) => c.latin === 'Solenodontidae')!.v;
    v.cam = iv.frameOf({ v: sol });
    frame(v);
    v.draw();
    const start = { ...v.cam };
    const q = names(v).find((f) => f.v === sol)!;
    v.tap(q.x, q.y);
    land(v);
    const landed = { ...v.cam };
    const now = v.fan.time.y(0);
    const box = sol.strands.map((b) => {
      const m = v.model(b).lanes(now);
      return [v.toScreen(m.left, 0)[0], v.toScreen(m.left + m.w, 0)[0]];
    });
    const [a, b] = [Math.min(...box.map((s) => s[0])), Math.max(...box.map((s) => s[1]))];
    expect(a, 'not in the left third').toBeGreaterThan(72 + (v.w - 72) / 3);
    expect(b, 'on screen').toBeLessThanOrEqual(v.w);
    const cut = iv.cutLast!;
    expect(cut.pics.filter((p) => p.run && p.run[0] >= sol.strands[0].index && p.run[1] <= sol.strands[1].index).length, 'both named').toBe(2);
    const [, fy] = v.toScreen(0, sol.y);
    expect(fy, 'the fork over the scale bar').toBeLessThan(iv.brackets.forkFoot);
    expect(fy, 'the fork on screen').toBeGreaterThan(0);
    const again = names(v).find((f) => f.v === sol)!;
    v.tap(again.x, again.y);
    land(v);
    expect(iv.offBy(landed, v.cam), 'a second tap stays').toBeLessThanOrEqual(2);
    v.doubleTap(0, 0);
    land(v);
    expect(iv.offBy(start, v.cam), 'a double tap back').toBeLessThanOrEqual(2);
  });

  it('switched off, a bracket on such a clade still goes as it did', () => {
    const v = stubView(FELIDAE, FELIDAE_TREE);
    const iv = inner(v);
    setForkNames(false);
    try {
      atHome(v);
      const felinae = iv.brackets.list.find((c) => c.latin === 'Felinae')!.v;
      iv.tapInto({ v: felinae }, false);
      land(v);
      const into = { ...v.cam };
      atHome(v);
      const hit = iv.brackets.hit;
      iv.brackets.hit = () => iv.brackets.list.find((c) => c.v === felinae)!;
      v.tap(-1e6, -1e6);
      iv.brackets.hit = hit;
      land(v);
      expect(iv.offBy(into, v.cam)).toBeLessThanOrEqual(2);
    } finally {
      setForkNames(true);
    }
  });
});
