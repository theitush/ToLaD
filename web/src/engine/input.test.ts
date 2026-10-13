// Issue #168: on a desktop trackpad, vertical scroll zooms time only, horizontal
// scroll width only, each gesture locked to its dominant axis unless clearly
// diagonal; a pinch (ctrl+wheel, Safari's gesture events) zooms both. Synthetic
// wheel and gesture events through the real handler, recording what it zooms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_MS, Input, WHEEL_GAP_MS } from './input';

(globalThis as { window?: unknown }).window ??= globalThis;

type Listener = (e: unknown) => void;

function rig() {
  const on = new Map<string, Listener>();
  const el = {
    style: {} as Record<string, string>,
    clientHeight: 800,
    addEventListener: (t: string, f: Listener) => on.set(t, f),
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    setPointerCapture: () => {},
  };
  /** Log zoom summed per axis, the last zoom centre, and gesture starts and ends. */
  const z = { x: 0, t: 0, px: 0, py: 0, starts: 0, ends: 0 };
  const input = new Input(
    el as unknown as HTMLElement,
    {
      gestureStart: () => z.starts++,
      gestureEnd: () => z.ends++,
      pan: () => {},
      zoom: (px, py, fx, ft) => {
        z.x += Math.log(fx);
        z.t += Math.log(ft);
        z.px = px;
        z.py = py;
      },
      fling: () => {},
      doubleTap: () => {},
    },
    true,
  );
  let prevented = 0;
  type Mods = { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; deltaMode?: number };
  const wheel = (deltaX: number, deltaY: number, mods: Mods = {}) => {
    on.get('wheel')!({
      clientX: 210,
      clientY: 420,
      deltaX,
      deltaY,
      deltaMode: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
      preventDefault: () => prevented++,
    });
    vi.advanceTimersByTime(16);
  };
  /** A trackpad swipe: n events of (dx, dy) each, plus jitter(k) on each. */
  const swipe = (dx: number, dy: number, n = 30, jitter = (_k: number) => [0, 0]) => {
    for (let k = 0; k < n; k++) {
      const j = jitter(k);
      wheel(dx + j[0], dy + j[1]);
    }
  };
  const end = () => vi.advanceTimersByTime(WHEEL_GAP_MS + 10);
  const gesture = (type: string, scale = 1) =>
    on.get(type)!({ clientX: 110, clientY: 220, scale, preventDefault: () => prevented++ });
  return { z, wheel, swipe, end, gesture, input, prevented: () => prevented, on };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('desktop wheel and trackpad zoom (#168)', () => {
  it('two fingers up zooms time in, about the cursor; down zooms it out', () => {
    const r = rig();
    r.swipe(0, -4);
    expect(r.z.t).toBeGreaterThan(0.15);
    expect(r.z.x).toBe(0);
    expect([r.z.px, r.z.py]).toEqual([200, 400]);
    r.end();
    const t = r.z.t;
    r.swipe(0, 4);
    expect(r.z.t).toBeLessThan(t - 0.15);
    expect(r.z.x).toBe(0);
  });

  it('two fingers left zooms width in; right zooms it out', () => {
    const r = rig();
    r.swipe(-4, 0);
    expect(r.z.x).toBeGreaterThan(0.15);
    expect(r.z.t).toBe(0);
    r.end();
    const x = r.z.x;
    r.swipe(4, 0);
    expect(r.z.x).toBeLessThan(x - 0.15);
    expect(r.z.t).toBe(0);
  });

  it('an upright swipe with sideways jitter stays time only', () => {
    const r = rig();
    // A slight slant (1 px sideways per 5 up) and ±2 px of wobble.
    r.swipe(-1, -5, 40, (k) => [2 * Math.sin(k * 1.3), Math.cos(k)]);
    expect(r.z.t).toBeGreaterThan(0.3);
    expect(r.z.x).toBe(0);
  });

  it('a sideways swipe with vertical jitter stays width only', () => {
    const r = rig();
    r.swipe(6, 1, 40, (k) => [Math.cos(k), 2 * Math.sin(k * 1.7)]);
    expect(r.z.x).toBeLessThan(-0.3);
    expect(r.z.t).toBe(0);
  });

  it('a clearly diagonal swipe zooms both, each by its own delta', () => {
    const r = rig();
    r.swipe(-3, -5);
    expect(r.z.x).toBeGreaterThan(0.1);
    expect(r.z.t).toBeGreaterThan(0.2);
    expect(r.z.t).toBeGreaterThan(r.z.x);
  });

  it('a swipe that turns diagonal partway turns the other axis on, without a jump', () => {
    const r = rig();
    r.swipe(0, -5, 10);
    const t = r.z.t;
    expect(r.z.x).toBe(0);
    r.wheel(-1, -1); // small sideways scroll: still locked
    expect(r.z.x).toBe(0);
    r.swipe(-6, -1, 20);
    expect(r.z.x).toBeGreaterThan(0.1);
    expect(r.z.x).toBeLessThan(20 * 6 * 0.002 + 1e-9);
    expect(r.z.t).toBeGreaterThan(t);
  });

  it('the lock lasts for the gesture: after a pause, a new swipe picks its own axis', () => {
    const r = rig();
    r.swipe(0, -5, 10);
    expect(r.z.ends).toBe(0);
    r.end();
    expect(r.z.ends).toBe(1);
    r.swipe(-5, 0, 10);
    expect(r.z.x).toBeGreaterThan(0.05);
    expect(r.z.starts).toBe(2);
  });

  it('ctrl+wheel (a trackpad pinch) zooms both axes alike', () => {
    const r = rig();
    for (let k = 0; k < 10; k++) r.wheel(0, -3, { ctrlKey: true });
    expect(r.z.x).toBeCloseTo(0.3, 9);
    expect(r.z.t).toBeCloseTo(0.3, 9);
    expect([r.z.px, r.z.py]).toEqual([200, 400]);
  });

  it('a mouse wheel notch zooms time at once; a line-mode notch is scaled', () => {
    const r = rig();
    r.wheel(0, -100);
    expect(r.z.t).toBeCloseTo(0.2, 9);
    expect(r.z.x).toBe(0);
    r.end();
    r.wheel(0, 3, { deltaMode: 1 });
    expect(r.z.t).toBeCloseTo(0.2 - 48 * 0.002, 9);
    expect(r.z.x).toBe(0);
  });

  it('shift+wheel zooms width, whether it arrives as deltaX (Chrome, Windows) or deltaY', () => {
    const r = rig();
    r.wheel(-100, 0, { shiftKey: true });
    expect(r.z.x).toBeCloseTo(0.2, 9);
    expect(r.z.t).toBe(0);
    r.end();
    r.wheel(0, -100, { shiftKey: true });
    expect(r.z.x).toBeCloseTo(0.4, 9);
    expect(r.z.t).toBe(0);
  });

  it('alt+wheel zooms time only', () => {
    const r = rig();
    r.wheel(0, -100, { altKey: true });
    r.end();
    r.wheel(-100, 0, { altKey: true });
    expect(r.z.t).toBeCloseTo(0.4, 9);
    expect(r.z.x).toBe(0);
  });

  it("Safari's pinch zooms both by each change in scale, and stops the page zoom", () => {
    const r = rig();
    r.gesture('gesturestart');
    r.gesture('gesturechange', 1.5);
    r.gesture('gesturechange', 3);
    r.gesture('gestureend', 3);
    expect(r.z.x).toBeCloseTo(Math.log(3), 9);
    expect(r.z.t).toBeCloseTo(Math.log(3), 9);
    expect([r.z.px, r.z.py]).toEqual([100, 200]);
    expect(r.prevented()).toBe(4);
    expect(r.z.starts).toBe(1);
    expect(r.z.ends).toBe(1);
    expect(r.input.active).toBe(false);
  });

  it("Safari's gesture events during a touch pinch are left to the pointer events", () => {
    const r = rig();
    const ev = (id: number, x: number) => ({ pointerId: id, clientX: x, clientY: 300, timeStamp: 0, pointerType: 'touch', button: 0, preventDefault() {} });
    r.on.get('pointerdown')!(ev(1, 100));
    r.on.get('pointerdown')!(ev(2, 200));
    r.gesture('gesturestart');
    r.gesture('gesturechange', 2);
    r.gesture('gestureend', 2);
    expect(r.z.x).toBe(0);
    expect(r.z.t).toBe(0);
  });
});

// ToLaD#241: a double-tap steps back, so its first tap must do nothing. A single tap the handler holds (tapWaits) runs
// once the double-tap window has passed; a double-tap or a pan after it drops it; a tap it does not hold runs at once.
describe('a single tap held for the double-tap window (ToLaD#241)', () => {
  function taps(waits: boolean) {
    const on = new Map<string, Listener>();
    const el = {
      style: {} as Record<string, string>,
      clientHeight: 800,
      addEventListener: (t: string, f: Listener) => on.set(t, f),
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: () => {},
    };
    const log: string[] = [];
    const noop = () => {};
    new Input(
      el as unknown as HTMLElement,
      { gestureStart: noop, gestureEnd: noop, pan: noop, zoom: noop, fling: noop, doubleTap: (x) => log.push(`double ${x}`), tap: (x) => log.push(`tap ${x}`), tapWaits: () => waits },
      true,
    );
    let now = 1000;
    const ev = (x: number, y = 300) => ({ pointerId: 1, clientX: x, clientY: y, timeStamp: now, pointerType: 'touch', button: 0, preventDefault() {} });
    const step = (ms: number) => {
      vi.advanceTimersByTime(ms);
      now += ms;
    };
    /** A tap at x, `gap` ms after the last event. */
    const tap = (x: number, gap = 0) => {
      step(gap);
      on.get('pointerdown')!(ev(x));
      step(60);
      on.get('pointerup')!(ev(x));
    };
    const drag = (x: number, gap = 0) => {
      step(gap);
      on.get('pointerdown')!(ev(x));
      for (let k = 1; k <= 5; k++) {
        step(16);
        on.get('pointermove')!(ev(x + 10 * k));
      }
      on.get('pointerup')!(ev(x + 50));
    };
    return { log, tap, drag, wait: step };
  }

  it('a lone held tap runs once the window has passed, not before', () => {
    const r = taps(true);
    r.tap(100);
    expect(r.log).toEqual([]);
    r.wait(DOUBLE_TAP_MS - 10);
    expect(r.log).toEqual([]);
    r.wait(20);
    expect(r.log).toEqual(['tap 100']);
  });

  it('a double-tap drops its first tap: only the double-tap runs', () => {
    const r = taps(true);
    r.tap(100);
    r.tap(105, 120);
    r.wait(1000);
    expect(r.log).toEqual(['double 105']);
  });

  it('a pan begun in the window drops the held tap', () => {
    const r = taps(true);
    r.tap(100);
    r.drag(200, 100);
    r.wait(1000);
    expect(r.log).toEqual([]);
  });

  it('a second tap elsewhere runs the held one first', () => {
    const r = taps(true);
    r.tap(100);
    r.tap(300, 100);
    expect(r.log).toEqual(['tap 100']);
    r.wait(1000);
    expect(r.log).toEqual(['tap 100', 'tap 300']);
  });

  it('a tap not held runs at once (and still before a double-tap)', () => {
    const r = taps(false);
    r.tap(100);
    expect(r.log).toEqual(['tap 100']);
    r.tap(102, 120);
    expect(r.log).toEqual(['tap 100', 'double 102']);
  });
});
