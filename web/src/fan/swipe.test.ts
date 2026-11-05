// A sideways swipe crosses any gap (ToLaD#403): through the real pan and fling paths, a view at a frame goes across the
// fan and stops only past its outer edges, at any zoom; left over a gap it stays; a pinch from there does not jump; and
// where the old rule never bit, frames land as they did.
import { describe, expect, it } from 'vitest';
import { nearestColumn } from './layout';
import { CARNIVORA, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, mammaliaTree, type Split } from './splits';
import { FanView, nextLevels, type Level } from './view';
import type { Camera } from './camera';

function stubView(clade: CladeRec, tree: Split, folds = true): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
}

type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; frameOf(lv: Level): Camera };
const P = (v: FanView) => v as unknown as Priv;

function at(v: FanView, cam: Camera): void {
  v.cam = { ...cam };
  v.camera.settle();
  P(v).applyFold();
}

/** The fan's outer edges at the heights on screen, by every column there (no search: the rule's own answer is what's tested). */
function edges(v: FanView): [number, number] {
  const c = v.cam;
  const y0 = Math.max(v.camera.yNow, c.cy - v.h / 2 / c.sy);
  const y1 = c.cy + v.h / 2 / c.sy;
  let l = Infinity;
  let r = -Infinity;
  for (let k = 0; k <= 16; k++) {
    for (const [a, b] of v.camera.contentAt(y0 + ((y1 - y0) * k) / 16)) {
      l = Math.min(l, a);
      r = Math.max(r, b);
    }
  }
  return [l, r];
}

/** Drag sideways, move after move, until the view stops; the px it moved. */
function drag(v: FanView, dx: number): number {
  v.gestureStart();
  let moved = 0;
  const limit = 4 * (v.camera.extent()[1] - v.camera.extent()[0]) * v.cam.sx + 4 * v.w;
  // (Big steps: a fan is millions of px wide at a species' frame.)
  const step = Math.sign(dx) * Math.max(Math.abs(dx), limit / 400);
  for (let k = 0; k < 500; k++) {
    const was = v.cam.cx;
    v.pan(step, 0);
    const got = Math.abs(v.cam.cx - was) * v.cam.sx;
    moved += got;
    if (got < Math.abs(step) * 1e-6) break;
  }
  v.gestureEnd();
  return moved;
}

/** Whether the view's centre is over no content at any height on screen, further than half a screen from any. */
function overGap(v: FanView): boolean {
  const c = v.cam;
  const p = v.camera.nearestContent(c.cx, Math.max(v.camera.yNow, c.cy - v.h / 2 / c.sy), c.cy + v.h / 2 / c.sy);
  return Math.abs(p - c.cx) * c.sx > v.w / 2;
}

/** A frame with a gap wider than a screen beside it: the view crosses a gap on its way out (a species' frame, sideways). */
function gapFrame(v: FanView): Camera {
  const lvs = v.fan.branches.filter((_, i) => i % 7 === 3).map((b) => ({ b }) as Level);
  for (const lv of lvs) {
    const cam = P(v).frameOf(lv);
    at(v, cam);
    const was = { ...v.cam };
    // (Out to the left in screen steps: one of them lands over a gap.)
    for (let k = 0; k < 200 && !overGap(v); k++) v.pan(v.w / 2, 0);
    const gap = overGap(v);
    if (gap) return was;
  }
  throw new Error('no frame with a gap beside it');
}

function crosses(v: FanView, cam: Camera): void {
  for (const dir of [1, -1]) {
    at(v, cam);
    // Far enough: the edges where the view ends.
    drag(v, dir * 25);
    const [l, r] = edges(v);
    const m = (0.4 * v.w) / v.cam.sx;
    // The stop is 40% of a screen past the outer edge: never short of it. (A tip the sampled heights here pass over can stand further out.)
    const short = (dir > 0 ? v.cam.cx - (l - m) : r + m - v.cam.cx) * v.cam.sx;
    expect(short).toBeLessThan(1);
    expect(short).toBeGreaterThan(-v.w);
    // Past it, nothing moves.
    const held = v.cam.cx;
    v.pan(dir * 500, 0);
    expect(v.cam.cx).toBe(held);
  }
}

describe('a sideways swipe crosses any gap (ToLaD#403)', () => {
  it('carnivores, folded: from a frame with a gap beside it, to both outer edges', () => {
    const v = stubView(CARNIVORA, CARNIVORA_TREE);
    crosses(v, gapFrame(v));
  });

  it('carnivores: from every group at the top level, to both outer edges', () => {
    const v = stubView(CARNIVORA, CARNIVORA_TREE);
    for (const g of nextLevels(v.fan, v.fan.root)) crosses(v, P(v).frameOf(g));
  });

  it('mammals, folded: the armadillo stuck 254 px from its frame goes on across the fan', async () => {
    await loadMammalsFromFiles();
    const v = stubView(mammaliaClade(), mammaliaTree());
    const b = v.fan.branches.find((s) => s.sp.common === 'Giant armadillo')!;
    const cam = P(v).frameOf({ b });
    at(v, cam);
    expect(drag(v, 25)).toBeGreaterThan(100 * v.w);
    crosses(v, cam);
    // ... as do the groups of the top level.
    for (const g of nextLevels(v.fan, v.fan.root).filter((_, i) => i % 7 === 2)) crosses(v, P(v).frameOf(g));
    // A fold's whole width stands inside the rule's "off the fan".
    const [e0, e1] = v.camera.extent();
    const yn = v.camera.yNow;
    const f = v.fan.branches[0].tess.fold!;
    const n = f.strands.length - 1;
    expect(((f.left(n, yn) ?? e1) - (f.left(0, yn) ?? e0)) / (e1 - e0)).toBeLessThan(1e4);
    expect(nearestColumn(v.fan, e0 - 1e4 * (e1 - e0), yn)).not.toBeNull();
  }, 120000);

  it('a fling crosses a gap, and stops at the outer edge', () => {
    const v = stubView(CARNIVORA, CARNIVORA_TREE);
    const cam = gapFrame(v);
    at(v, cam);
    const was = v.cam.cx;
    v.fling(4, 0, 0, 195, 400);
    let t = performance.now();
    while (P(v).anim) {
      t += 1000 / 60;
      if (!P(v).anim!(t)) P(v).anim = null;
    }
    expect((was - v.cam.cx) * v.cam.sx).toBeGreaterThan(v.w);
    // At a far stronger fling, it ends at the edge, not past it.
    v.fling(1e7, 0, 0, 195, 400);
    while (P(v).anim) {
      t += 1000 / 60;
      if (!P(v).anim!(t)) P(v).anim = null;
    }
    const held = v.cam.cx;
    v.pan(500, 0);
    expect(v.cam.cx).toBe(held);
  });

  it('a view left over a gap stays: no later settle snaps it back, a pinch does not jump', () => {
    const v = stubView(CARNIVORA, CARNIVORA_TREE);
    at(v, gapFrame(v));
    for (let k = 0; k < 200 && !overGap(v); k++) v.pan(v.w / 2, 0);
    expect(overGap(v)).toBe(true);
    const was = { ...v.cam };
    v.camera.settle();
    v.resize();
    expect(v.cam).toEqual(was);
    v.gestureEnd();
    expect(v.cam).toEqual(was);
    // Nothing draws wrong over nothing, and a tap and a double-tap there go on as anywhere.
    v.draw();
    expect(v.levelNow(true)).toBeTruthy();
    // A pinch in about the centre goes on about the nearest content (#36), which holds still under it: no jump. Out, it only comes nearer.
    const [wx, wy] = v.camera.toWorld(195, 422);
    const p = v.camera.nearestContent(wx, wy);
    const before = v.camera.screenX(p);
    v.zoomAbout(195, 422, 1.02, 1);
    expect(Math.abs(v.camera.screenX(p) - before)).toBeLessThan(2);
    v.zoomAbout(195, 422, 0.5, 1);
    expect(Math.abs(v.camera.screenX(v.camera.nearestContent(...v.camera.toWorld(195, 422))) - 195)).toBeLessThanOrEqual(Math.abs(before - 195) + 2);
    v.tap(195, 422);
    while (P(v).anim) if (!P(v).anim!(performance.now() + 1e7)) P(v).anim = null;
    v.draw();
  });

  it('a frame lands where the nearest-content rule landed it: every group, every sixth species', () => {
    const v = stubView(CARNIVORA, CARNIVORA_TREE);
    const lvs: Level[] = [...nextLevels(v.fan, v.fan.root), ...v.fan.nodes.filter((_, i) => i % 5 === 0).map((n) => ({ v: n })), ...v.fan.branches.filter((_, i) => i % 6 === 0).map((b) => ({ b }))];
    for (const lv of lvs) {
      const f = P(v).frameOf(lv);
      v.cam = { ...f };
      v.camera.settle();
      const now = { ...v.cam };
      v.cam = { ...f };
      v.camera.settle(v.w / 2, v.h / 2, f.cx, f.cy, 0.4 * v.w);
      expect(now).toEqual(v.cam);
    }
  });
});
