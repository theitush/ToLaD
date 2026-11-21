// A fold that stops always comes to rest on its fine grid, whatever the frames' timing (ToLaD#591). Its rest frame is
// asked for by a timer FOLD_REST_MS after it last moved; the timer can fire while a frame is already pending (on a
// slow phone, or a SwiftShader page: frames 0.4-0.8 s apart), its ask lost to that frame, and when that frame is the
// one after the move, which only puts the grid on the coarse one, nothing asked for another: the view was left on the
// coarse grid, the fold "moving", till the next touch (main's pan shots at the turtles flipped between two pictures at
// rest, turtle591c). Frames (requestAnimationFrame) and timers are run by hand here.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setFlip } from './flip';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Camera } from './camera';
import { FanView } from './view';

/** The frames asked for (requestAnimationFrame's callbacks), run by hand. */
const asked: FrameRequestCallback[] = [];

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
  g.requestAnimationFrame = (cb: FrameRequestCallback) => asked.push(cb);
  g.cancelAnimationFrame = noop;
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
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
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Inner = {
  cam: Camera;
  w: number;
  h: number;
  foldMoving: boolean;
  gl: unknown;
  homeCamera(): Camera;
};

describe('the fold comes to rest whatever the frames\' timing', () => {
  let v: FanView;
  const I = () => v as unknown as Inner;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    const under = new RectBatch();
    const over = new RectBatch();
    I().gl = {
      under,
      over,
      begin() {
        under.n = over.n = 0;
      },
      end() {},
    };
  }, 600000);
  afterAll(() => {
    vi.useRealTimers();
    setFlip(false);
  });

  /** The next frame asked for, drawn. */
  const frame = () => asked.shift()!(performance.now());
  /** Frames and timers run till none is left (at most `max` rounds): the view as it stands once nothing more happens. */
  const idle = (max = 400) => {
    for (let k = 0; k < max && (asked.length || vi.getTimerCount()); k++) {
      if (asked.length) frame();
      else vi.advanceTimersToNextTimer();
    }
    expect(asked.length + vi.getTimerCount()).toBe(0);
  };

  it('its rest frame asked for again when its timer fired while a frame was pending', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    I().cam = I().homeCamera();
    v.request();
    idle();
    expect(I().foldMoving).toBe(false);
    for (const k of [1, 2, 3]) {
      // (The fold moves: here its version, as levelNow's frames move it and put it back (Fold.keep), the turtles'
      // pans; one frame, its rest frame's timer armed.)
      v.fan.tess.fold!.keep()();
      v.request();
      frame();
      expect(I().foldMoving).toBe(true);
      // (A frame pending (the settle's, a picture's, any), the timer firing before it is drawn: its ask lost to it.)
      v.request();
      vi.advanceTimersByTime(1000);
      // (That frame: the grid on the coarse one, the fold still "moving". Then, whatever comes, at rest: the rest frame on
      // the coarse grid asks for one on the fine grid.)
      frame();
      idle();
      expect(I().foldMoving, `move ${k}`).toBe(false);
    }
  }, 600000);
});
