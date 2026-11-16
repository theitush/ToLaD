// A held picture stops at its fork, never disappears (ToLaD#469, Ita: "pics shouldnt dispapper from the left! just stop at the fork"): in a pan into the past at any level, a picture drawn at one
// step is drawn at the next while its branch's start is on screen, and pictures still never meet each other or a name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import type { Steady } from './steady';
import { FanView, type Camera, type CutLabels } from './view';
import { picBox } from './pics';

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
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
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

type Inner = { labelsNow(): { cut: CutLabels } };

describe('a held picture stops at its fork (ToLaD#469)', () => {
  let v: FanView;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
  }, 120000);
  afterAll(() => setFlip(false));

  const at = (c: Camera): CutLabels => {
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c, ty: c.sy };
    return (v as unknown as Inner).labelsNow().cut;
  };
  const Y = (y: number) => v.toScreen(0, y)[1];
  const who = (p: CutLabels['pics'][number]) => p.lv.b?.sp.sci ?? p.face.sp.sci;
  const STEP = 6;

  // (Older to the larger y: a pan into the past moves the camera that way, here STEP px a frame, until no picture is left.)
  const pan = (c0: Camera, most = 2000) => {
    const lost: string[] = [];
    const bad: string[] = [];
    let prev: CutLabels | null = null;
    for (let i = 0; i < most; i++) {
      const c = at({ ...c0, cy: c0.cy + (i * STEP) / c0.sy });
      for (const p of prev?.pics ?? []) {
        if (c.pics.some((q) => q.lv.b === p.lv.b && q.lv.v === p.lv.v)) continue;
        const start = Y(p.lv.b ? p.lv.b.splitY : p.lv.v!.yBot);
        if (start > 0 && p.x >= 0 && p.x <= v.w) lost.push(`${i} ${who(p)} fork at ${start.toFixed(0)}`);
      }
      const boxes: [string, readonly number[]][] = [...c.names.map((s) => [s.text, s.box] as [string, readonly number[]]), ...c.spots.map((s) => [s.text, s.box] as [string, readonly number[]]), ...c.pics.map((p) => [`pic ${who(p)}`, picBox(p)] as [string, readonly number[]])];
      for (let a = 0; a < boxes.length; a++)
        for (let b = a + 1; b < boxes.length; b++) {
          const [p, q] = [boxes[a][1], boxes[b][1]];
          if (p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] - 1e-6 && p[3] > q[1] + 1e-6) bad.push(`${i} ${boxes[a][0]} / ${boxes[b][0]}`);
        }
      if (!c.pics.length && i) break;
      prev = c;
    }
    return { lost, bad };
  };

  for (const level of ['home', 'Primates', 'Carnivora', 'Rodentia', 'Chiroptera', 'Felidae'])
    it(`${level}: no picture lost in a pan into the past while its fork is on screen, none meeting another label`, () => {
      const c0 = level === 'home' ? v.homeCamera() : v.levelCamera(level)!;
      const { lost, bad } = pan(c0);
      expect(lost).toEqual([]);
      expect(bad.slice(0, 12)).toEqual([]);
    });

  it('at every zoom, wherever the pan starts', () => {
    const { C } = (v.fan.tess.fold as Steady).rooms();
    const home = v.homeCamera();
    const lost: string[] = [];
    const bad: string[] = [];
    for (let k = 0; k < 48; k += 3)
      for (const w of [0.1, 0.35, 0.6, 0.9]) {
        const r = pan({ ...home, sx: home.sx * 2 ** (k / 4), cx: C[Math.floor(C.length * w)] }, 300);
        lost.push(...r.lost.map((s) => `x${k} ${w}: ${s}`));
        bad.push(...r.bad.map((s) => `x${k} ${w}: ${s}`));
      }
    expect(lost.slice(0, 20)).toEqual([]);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300000);
});
