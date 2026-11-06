// The tree on its side (ToLaD#452, `?flip=1`): a touch at a phone point lands on the world point drawn there, both ways;
// each picture's centre stands on 100 kya; off, the view is as it was.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FanView } from './view';
import { AXIS_ROOM, CHAIN_ROOM, LABELS_MA, setFlip, toPhone, toView } from './flip';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { PIC_D } from './pics';
import { mammaliaTree } from './splits';

const PHONE = { width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 };
const BAR_BOTTOM = 44;

function stubView(turned: boolean): { v: FanView; listeners: Map<string, (e: unknown) => void>; box: () => typeof PHONE } {
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
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  const listeners = new Map<string, (e: unknown) => void>();
  const parent = {
    getBoundingClientRect: () => PHONE,
    querySelector: (q: string) => (q === '.bar' ? { getBoundingClientRect: () => ({ height: 34, bottom: BAR_BOTTOM }) } : null),
  };
  // (The turned canvas's box on the phone, as the browser reports it: its parent's width, from under the chain's room.)
  const top = BAR_BOTTOM + CHAIN_ROOM;
  const box = () => (turned ? { ...PHONE, top, height: PHONE.height - top } : PHONE);
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    parentElement: turned ? parent : null,
    getContext: () => ctx,
    getBoundingClientRect: box,
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
  };
  setFlip(turned);
  const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
  setFlip(false);
  return { v, listeners, box };
}

beforeAll(() => {
  loadMammalsFromFiles();
});
afterAll(() => setFlip(false));

describe('the tree on its side', () => {
  it('the view is the phone turned: its w the tall side under the bar, its h the width, the canvas turned and sized past w by the axis band', () => {
    const { v } = stubView(true);
    expect(v.h).toBe(390);
    expect(v.w).toBe(844 - BAR_BOTTOM - CHAIN_ROOM - AXIS_ROOM);
    const st = v.canvas.style as unknown as Record<string, string>;
    expect(st.transform).toBe('translateX(390px) rotate(90deg)');
    expect(st.width).toBe(`${v.w + AXIS_ROOM}px`);
    expect(st.height).toBe('390px');
    expect(v.canvas.width).toBe((v.w + AXIS_ROOM) * v.dpr);
  });

  it('toView and toPhone undo each other, a quarter turn clockwise', () => {
    // Today's top goes right, today's left goes top.
    expect(toPhone(0, 0, 390)).toEqual([390, 0]);
    expect(toPhone(100, 0, 390)).toEqual([390, 100]);
    expect(toPhone(0, 390, 390)).toEqual([0, 0]);
    for (const [x, y] of [[10, 20], [300, 700], [0, 844]] as const) {
      const [vx, vy] = toView(x, y, 390);
      expect(toPhone(vx, vy, 390)).toEqual([x, y]);
    }
  });

  it('a tap at a phone point lands on the world point drawn there, both ways', () => {
    const { v, listeners, box } = stubView(true);
    const r = box();
    const seen: [number, number][] = [];
    v.tap = (x, y) => void seen.push([x, y]);
    v.tapWaits = () => false;
    for (const [wx, wy] of [
      [v.toWorld(120, 40)[0], v.toWorld(120, 40)[1]],
      [v.toWorld(500, 300)[0], v.toWorld(500, 300)[1]],
    ]) {
      // The world point, on screen in the view's coordinates, where the turned canvas puts it on the phone.
      const [sx, sy] = v.toScreen(wx, wy);
      const [px, py] = toPhone(sx, sy, v.h);
      const at = { clientX: r.left + px, clientY: r.top + py, pointerId: 1, pointerType: 'touch', button: 0, timeStamp: seen.length * 1000 + 1000, preventDefault: () => {} };
      listeners.get('pointerdown')!(at);
      listeners.get('pointerup')!(at);
      const [tx, ty] = seen[seen.length - 1];
      // ...and back: the tap handed to the view is the world point's.
      const [bx, by] = v.toWorld(tx, ty);
      expect(bx).toBeCloseTo(wx, 6);
      expect(by).toBeCloseTo(wy, 6);
    }
    expect(seen.length).toBe(2);
  });

  it('a finger down the phone pans the branches down it; across it, time', () => {
    const { v, listeners, box } = stubView(true);
    const r = box();
    const seen: [number, number][] = [];
    v.pan = (dx, dy) => void seen.push([dx, dy]);
    const ev = (clientX: number, clientY: number, t: number) => ({ clientX, clientY, pointerId: 1, pointerType: 'touch', button: 0, timeStamp: t, preventDefault: () => {} });
    listeners.get('pointerdown')!(ev(r.left + 200, r.top + 300, 1));
    listeners.get('pointermove')!(ev(r.left + 200, r.top + 360, 20));
    listeners.get('pointermove')!(ev(r.left + 150, r.top + 360, 40));
    listeners.get('pointerup')!(ev(r.left + 150, r.top + 360, 60));
    const dx = seen.reduce((a, s) => a + s[0], 0);
    const dy = seen.reduce((a, s) => a + s[1], 0);
    // 60 px down the phone is 60 along the view's x; 50 px left on the phone is away from "now": +50 along its y.
    expect(dx).toBeCloseTo(60, 6);
    expect(dy).toBeCloseTo(50, 6);
  });

  it("each picture's centre is on 100 kya, its pill towards now, while 100 kya is on screen", () => {
    const { v } = stubView(true);
    for (const cam of [v.homeCamera(), v.levelCamera('Carnivora')!, v.levelCamera('Primates')!]) {
      v.cam = cam;
      v.draw();
      const y = v.toScreen(0, v.fan.time.y(LABELS_MA))[1];
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(v.h);
      const c = v.cutLast!;
      expect(c.pics.length).toBeGreaterThan(0);
      for (const p of c.pics) expect(p.y).toBeCloseTo(y, 6);
      // (Towards now is up the view's y: right on the phone.)
      for (const s of c.spots) expect(s.box[3]).toBeLessThanOrEqual(y - PIC_D / 2);
      // (Upright: all of it within the view.)
      for (const s of c.spots) expect(s.box[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('100 kya off screen in time: the labels stay at the edge, whole', () => {
    const { v } = stubView(true);
    const home = v.homeCamera();
    const y100 = v.fan.time.y(LABELS_MA);
    // Zoomed in on the last centuries: 100 kya is past the phone's left edge.
    v.cam = { ...home, sy: home.sy * 40, ty: home.sy * 40, cy: v.yNow + (v.h / 2 - 20) / (home.sy * 40) };
    v.draw();
    expect(v.toScreen(0, y100)[1]).toBeGreaterThan(v.h);
    for (const p of v.cutLast!.pics) expect(p.y + PIC_D / 2).toBeLessThanOrEqual(v.h);
    // Panned so that it is off the right edge.
    v.cam = { ...home, cy: y100 + (v.h / 2 + 60) / home.sy };
    v.draw();
    expect(v.toScreen(0, y100)[1]).toBeLessThan(0);
    for (const s of v.cutLast!.spots) expect(s.box[1]).toBeGreaterThanOrEqual(0);
  });

  it('off: the view is the canvas as it is, input untouched', () => {
    const { v } = stubView(false);
    expect(v.flip).toBe(false);
    expect([v.w, v.h]).toEqual([390, 844]);
    expect(v.input.turned).toBe(false);
    expect(v.canvas.style.transform).toBeUndefined();
  });
});
