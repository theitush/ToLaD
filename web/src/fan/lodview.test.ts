// The strands' cut coarsened by the view (ToLaD#591, lod.ts Lod.see, steady.ts viewCut): a clade the window sees nothing
// of asks none of its strands to be drawn. On the amniotes, where the turtles' and the crocodiles' levels sent thousands
// of strands to be sampled for no pixel (lizards and birds running into the trunk beside them), against the strands asked
// by the zoom's cut alone (setLodView(false)): the same rectangles drawn, in the same order, at every frame of a pinch in
// and out, a pan and a flight into a family, at both levels and at the mammals' home; and far fewer strands asked of
// drawStrand at the two levels. Two views, each its own tree and state, take the same steps (lodindex.test's way).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setFlip } from './flip';
import { setLodView, type Lod } from './lod';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Camera } from './camera';
import type { FanNode } from './layout';
import { FanView } from './view';

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
  anim: ((now: number) => boolean) | null;
  w: number;
  h: number;
  gl: { under: RectBatch; over: RectBatch; begin(): void; end(): void };
  lod: Lod | null;
  models: Map<string, unknown>;
  modelBytes: number;
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  flyToClade(v: FanNode): unknown;
  drawStrand(b: unknown): void;
};

describe('the strands asked by the view’s cut against the zoom’s cut alone (amniotes)', () => {
  /** By the zoom's cut alone, and coarsened by the view. */
  let views: [FanView, FanView];
  const I = (v: FanView) => v as unknown as Inner;
  /** Per view: drawStrand's calls this frame. */
  const asked = [0, 0];
  beforeAll(async () => {
    await loadMammalsFromFiles('amniotes');
    setFlip(true);
    views = [stubView(), stubView()];
    views.forEach((v, q) => {
      const under = new RectBatch();
      const over = new RectBatch();
      I(v).gl = {
        under,
        over,
        begin() {
          under.n = over.n = 0;
        },
        end() {},
      };
      const draw = I(v).drawStrand.bind(v);
      I(v).drawStrand = (b) => {
        asked[q]++;
        draw(b);
      };
    });
  }, 600000);
  afterAll(() => {
    setLodView(true);
    setFlip(false);
  });

  let clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const both = (f: (v: FanView) => void) => views.forEach(f);

  /** Draws the frame in both views and holds their rectangles the same; the strands each asked of drawStrand, summed. */
  const sum = [0, 0];
  const same = (what: string) => {
    const [A, B] = views;
    clock += 16.7;
    const t = clock;
    asked[0] = asked[1] = 0;
    // (Each strand's samples made afresh in both: the kept ones (twigs.ts ColumnPath, CutMemo) are chosen by what was drawn
    // on frames before, and on this one before it (pathFrame's budget), which the views differ in by what each asks.)
    both((v) => {
      I(v).models.clear();
      I(v).modelBytes = 0;
    });
    setLodView(false);
    A.draw();
    clock = t;
    setLodView(true);
    B.draw();
    const a = I(A).gl;
    const b = I(B).gl;
    const at = `${what} sx ${I(B).cam.sx} cx ${I(B).cam.cx} cy ${I(B).cam.cy} sy ${I(B).cam.sy}`;
    expect(I(A).cam, at).toEqual(I(B).cam);
    expect(b.under.n, `${at}: under`).toBe(a.under.n);
    expect(b.over.n, `${at}: over`).toBe(a.over.n);
    expect(Array.from(b.under.f.subarray(0, 12 * b.under.n)), `${at}: under`).toEqual(Array.from(a.under.f.subarray(0, 12 * a.under.n)));
    expect(Array.from(b.over.f.subarray(0, 12 * b.over.n)), `${at}: over`).toEqual(Array.from(a.over.f.subarray(0, 12 * a.over.n)));
    // (What the view decides only coarsens the zoom's cut: every merged clade's strands are in the cut.)
    const lod = I(B).lod!;
    for (const v of lod.merged) expect(lod.cutOf(v.strands[0].index), `${at}: ${v.name}`).toBeGreaterThanOrEqual(0);
    sum[0] += asked[0];
    sum[1] += asked[1];
  };

  for (const [tag, level, fam] of [
    ['turtles', 'Testudines', 'Cheloniidae'],
    ['crocodiles', 'Crocodylia', 'Crocodylidae'],
    ['mammals', 'home', 'Felidae'],
  ] as const) {
    it(`at the ${tag}' level: a pinch, a pan and the flight into ${fam}`, () => {
      sum[0] = sum[1] = 0;
      both((v) => {
        const c = level === 'home' ? I(v).homeCamera() : I(v).levelCamera(level);
        expect(c, level).toBeTruthy();
        I(v).cam = c!;
      });
      same(`${tag} landed`);
      both((v) => I(v).gestureStart());
      for (let k = 0; k < 30; k++) {
        both((v) => v.zoomAbout(I(v).w / 2, I(v).h / 2, k < 15 ? 1.06 : 1 / 1.06));
        same(`${tag} pinch ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
        I(v).gestureStart();
      });
      for (let k = 0; k < 20; k++) {
        both((v) => v.pan(k < 10 ? 8 : -8, k % 10 < 5 ? 3 : -3));
        same(`${tag} pan ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
        I(v).flyToClade(v.fan.nodes.find((x) => x.split.taxon === fam)!);
      });
      let now = clock;
      for (let k = 0; k < 600 && I(views[1]).anim; k++) {
        now += 16.7;
        both((v) => {
          const a = I(v).anim;
          if (a && !a(now)) I(v).anim = null;
        });
        same(`${tag} flight ${k}`);
      }
      // (The levels beside the trunk: a fifth of the strands asked, or fewer. Those left are the strands with a lane on
      // screen and the dashed ones DashRows may hold (#584: first come in the frame, so no clade's turn is known before).)
      if (level !== 'home') expect(sum[1] * 5, `${tag}: strands asked ${sum[1]} against ${sum[0]}`).toBeLessThan(sum[0]);
    }, 1200000);
  }
});
