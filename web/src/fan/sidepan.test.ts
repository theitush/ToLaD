// A sideways pan stops a few pixels past "now" (ToLaD#480, Ita: "theres too much side scrolling allowed.. a few pixels after the
// now is enough"): on the tree on its side "now" never stands further in from the phone's right edge (the view's top) than
// NOW_PX, where every frame puts it, at home, at a level and zoomed out; a pan away from the present is as it was; the old
// view (`?flip=0`) keeps its LABELS_SHARE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FanView } from './view';
import { CHAIN_ROOM, NOW_PX, setFlip } from './flip';
import { LABELS_SHARE, type Camera, type FanCamera } from './camera';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';

const PHONE = { width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 };
const BAR_BOTTOM = 44;

/** The view as on a phone (flip.test.ts's), turned or not. */
function stubView(turned: boolean): FanView {
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
  const parent = {
    getBoundingClientRect: () => PHONE,
    querySelector: (q: string) => (q === '.bar' ? { getBoundingClientRect: () => ({ height: 34, bottom: BAR_BOTTOM }) } : null),
  };
  const top = BAR_BOTTOM + CHAIN_ROOM;
  const box = () => (turned ? { ...PHONE, top, height: PHONE.height - top } : PHONE);
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    parentElement: turned ? parent : null,
    getContext: () => ctx,
    getBoundingClientRect: box,
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
  };
  setFlip(turned);
  const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
  setFlip(false);
  return v;
}

const camOf = (v: FanView) => (v as unknown as { camera: FanCamera }).camera;
/** Where "now" stands on the screen: px down the view, in from the phone's right edge turned. */
const nowAt = (v: FanView) => v.toScreen(0, v.yNow)[1];
/** The view put at frame c as a landing puts it (the fold at its zoom), then held by the camera's bounds. */
function stand(v: FanView, c: Camera): void {
  v.fan.tess.fold?.setScale(c.sx, v.w);
  v.cam = { ...c, ty: c.sy };
  camOf(v).settle();
}
/** A drag far towards the present (the phone's finger leftwards: the view's dy down), as the fingers send it, a step at a time. */
function panToNow(v: FanView, px = 3000): void {
  for (let k = 0; k < 30; k++) v.pan(0, px / 30);
}

beforeAll(() => {
  loadMammalsFromFiles();
});
afterAll(() => setFlip(false));

describe('a sideways pan stops a few pixels past "now" (ToLaD#480)', () => {
  it('on its side: home, a level (the cats) and zoomed out land with "now" NOW_PX in, and no pan towards the present takes it further', () => {
    const v = stubView(true);
    expect(camOf(v).nowPx).toBe(NOW_PX);
    const cases: [string, () => void][] = [
      ['home', () => stand(v, v.homeCamera())],
      ['cats', () => stand(v, v.levelCamera('Felidae')!)],
      [
        'zoomed out',
        () => {
          stand(v, v.homeCamera());
          for (let k = 0; k < 20; k++) v.zoomAbout(v.w / 2, v.h / 2, 1, 0.7);
        },
      ],
    ];
    for (const [name, go] of cases) {
      go();
      // The landing at the bound already: the first touch does not jump it.
      expect(nowAt(v), `${name}: landed`).toBeCloseTo(NOW_PX, 6);
      panToNow(v);
      expect(nowAt(v), `${name}: panned towards the present`).toBeLessThanOrEqual(NOW_PX + 1e-6);
      expect(nowAt(v), `${name}: panned towards the present`).toBeGreaterThanOrEqual(0);
      // A pan away from the present is as it was: "now" goes off the edge by the pan. (Zoomed out, the whole span on screen, none.)
      if (name === 'zoomed out') continue;
      const before = nowAt(v);
      v.pan(0, -60);
      expect(nowAt(v), `${name}: panned into the past`).toBeCloseTo(before - 60, 6);
    }
  });

  it('zoomed out to the bound, the time span shorter than the screen: "now" at the edge, the room past the deep end', () => {
    const v = stubView(true);
    stand(v, v.homeCamera());
    for (let k = 0; k < 40; k++) v.zoomAbout(v.w / 2, v.h / 2, 1, 0.7);
    const c = camOf(v);
    expect(v.cam.sy).toBeCloseTo(c.minScale()[1], 9);
    const foot = v.toScreen(0, v.fan.trunkBottom.y)[1];
    expect(foot).toBeLessThan(v.h);
    for (const dy of [3000, -3000, 3000]) {
      v.pan(0, dy);
      expect(nowAt(v)).toBeCloseTo(NOW_PX, 6);
    }
  });

  it('the old view keeps its bound: "now" may come LABELS_SHARE of the height down', () => {
    const v = stubView(false);
    expect(camOf(v).nowPx).toBeNull();
    stand(v, v.homeCamera());
    panToNow(v);
    expect(nowAt(v)).toBeCloseTo(LABELS_SHARE * v.h, 6);
  });
});
