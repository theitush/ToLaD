// A look's switch keeps the view where it is (ToLaD#412): a new view of the same tree, in the next gaps' mode or with
// the fork names switched, stands on the same level's frame, or with the same strands at the screen's edges and the same
// time window. Every mode the button cycles, at all three levels. Checked by code (no browser).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forkNames, setForkNames } from './brackets';
import type { Camera, FanCamera } from './camera';
import { GAP_MODES, gapMode, setGapMode, type GapMode } from './fold';
import type { FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import type { Steady } from './steady';
import { FanView, isLevel, type Level } from './view';

function stubView(clade: CladeRec, tree: Split, folds: boolean): FanView {
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

type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; camera: FanCamera; offBy(a: Camera, c: Camera): number; frameOf(lv: Level): Camera; outFrom(lv: Level, c: Camera): { cam: Camera } | null; steps: unknown[] };
const P = (v: FanView) => v as unknown as Priv;
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
  for (let k = 0; k < 3; k++) v.draw();
}
/** The strands whose centres stand on screen, left to right. */
function onScreen(v: FanView): number[] {
  const f = v.fan.tess.fold as Steady;
  f.setScale(v.cam.sx, v.w);
  const { C } = f.rooms();
  const out: number[] = [];
  for (let i = 0; i < C.length; i++) {
    const x = v.toScreen(C[i], 0)[0];
    if (x >= 0 && x <= v.w) out.push(i);
  }
  return out;
}
/** The same strands on screen, but for any a hair (a px) from the edge: the zoom is found to a ten-thousandth, and at the mammals a px holds several strands. */
function sameOnScreen(v: FanView, seen: number[], at: string): void {
  const { C } = (v.fan.tess.fold as Steady).rooms();
  const now = onScreen(v);
  const [a, b] = [new Set(seen), new Set(now)];
  for (const i of [...seen.filter((k) => !b.has(k)), ...now.filter((k) => !a.has(k))]) {
    const x = v.toScreen(C[i], 0)[0];
    expect(Math.min(Math.abs(x), Math.abs(x - v.w)), `${at}: strand ${i}`).toBeLessThan(1);
  }
}
const lvName = (lv: Level) => (lv.v ? lv.v.name : lv.b.sp.gid);
/** Stand a view at a camera, as a pinch leaves it. */
function stand(v: FanView, c: Camera): void {
  P(v).anim = null;
  (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
  v.cam = { ...c, ty: c.sy };
  P(v).camera.settle();
}

const LEVELS: [string, () => CladeRec, () => Split, boolean, string[]][] = [
  ['cats', () => FELIDAE, () => FELIDAE_TREE, false, []],
  ['carnivores', () => CARNIVORA, () => CARNIVORA_TREE, true, ['Felidae', 'Canidae']],
  ['mammals', mammaliaClade, mammaliaTree, true, ['Carnivora', 'Felidae', 'Chiroptera']],
];

describe('a look switch keeps the view where it is (ToLaD#412)', () => {
  const was = gapMode();
  const fk = forkNames();
  afterAll(() => {
    setGapMode(was);
    setForkNames(fk);
  });
  for (const [name, clade, tree, folds, named] of LEVELS) {
    describe(name, () => {
      const views = new Map<GapMode, FanView>();
      beforeAll(async () => {
        if (name === 'mammals') await loadMammalsFromFiles();
        for (const m of GAP_MODES) {
          setGapMode(m);
          views.set(m, stubView(clade(), tree(), folds));
        }
      }, 300_000);
      const pairs = GAP_MODES.map((m, i) => [m, GAP_MODES[(i + 1) % GAP_MODES.length]] as const);
      const frames = (v: FanView): FanNode[] => {
        const at = named.map((n) => v.fan.nodes.find((u) => u.split.taxon === n)!).filter(Boolean);
        // (Some named frames deep in, whatever the level.)
        const deep = v.fan.nodes.filter((u) => u.parent && isLevel(v.fan, u));
        return [...at, ...deep.filter((_, i) => i % Math.ceil(deep.length / 3) === 0)];
      };

      it('every mode has the same strands in the same order', () => {
        const order = views.get(GAP_MODES[0])!.fan.root.strands.map((b) => b.sp.gid);
        for (const v of views.values()) {
          expect(v.fan.root.strands.map((b) => b.sp.gid)).toEqual(order);
          v.fan.root.strands.forEach((b, i) => expect(b.index).toBe(i));
        }
      });

      it('home stays home', () => {
        for (const [a, b] of pairs) {
          const [A, B] = [views.get(a)!, views.get(b)!];
          stand(A, A.homeCamera());
          const p = A.place();
          expect(p.framed).toBe(true);
          B.goToPlace(p);
          expect(P(B).offBy(B.homeCamera(), B.cam), `${a} to ${b}`).toBeLessThanOrEqual(0.5);
          expect(lvName(B.levelNow(true))).toBe(lvName({ v: B.fan.root }));
        }
      });

      it("on a named frame: that level's frame in the new layout, and a double tap goes up from it", () => {
        for (const [a, b] of pairs) {
          const [A, B] = [views.get(a)!, views.get(b)!];
          for (const u of frames(A)) {
            stand(A, P(A).frameOf({ v: u }));
            const lvA = A.levelNow(true);
            const p = A.place();
            expect(p.framed).toBe(true);
            B.goToPlace(p);
            const lvB = B.levelNow(true);
            const at = `${a} to ${b} at ${u.name}`;
            expect(lvName(lvB), at).toBe(lvName(lvA));
            expect(P(B).offBy(P(B).frameOf(lvB), B.cam), at).toBeLessThanOrEqual(0.5);
            expect(P(B).steps.length).toBe(0);
            // A double tap: the first named level up that zooms out (ToLaD#416).
            const up = P(B).outFrom(lvB, B.cam);
            B.doubleTap(-1e4, -1e4);
            run(B);
            if (up) expect(P(B).offBy(up.cam, B.cam), `${at}: up`).toBeLessThanOrEqual(12);
          }
        }
      }, 300_000);

      it('zoomed freely: the same strands on screen, the same time window; a double tap goes up', () => {
        for (const [a, b] of pairs) {
          const [A, B] = [views.get(a)!, views.get(b)!];
          for (const u of [A.fan.root, ...frames(A).slice(0, 3)]) {
            const f = P(A).frameOf({ v: u });
            for (const [zx, zy, dx] of [
              [2.3, 1.4, 0.17],
              [1.5, 2, 0.05],
              [7, 1, -0.3],
            ]) {
              stand(A, { ...f, sx: f.sx * zx, sy: f.sy * zy, cx: f.cx + (dx * A.w) / f.sx, cy: f.cy + (0.1 * A.h) / f.sy });
              const c0 = { ...A.cam };
              const p = A.place();
              expect(p.framed).toBe(false);
              const seen = onScreen(A);
              const lvA = A.levelNow(true);
              B.goToPlace(p);
              const at = `${a} to ${b} at ${u.name} ${zx}`;
              sameOnScreen(B, seen, at);
              expect(B.cam.sy / c0.sy, at).toBeCloseTo(1, 8);
              expect(Math.abs(B.cam.cy - c0.cy) * c0.sy, at).toBeLessThan(0.5);
              expect(lvName(B.levelNow(true)), at).toBe(lvName(lvA));
              // The double tap zooms out in either look (ToLaD#416): never tighter on width. Which level that lands on can
              // differ, each look's frames being its own (dblout.test holds the rule itself).
              for (const v of [B, A]) {
                const c = { ...v.cam };
                v.doubleTap(-1e4, -1e4);
                run(v);
                expect(v.w * (v.cam.sx / c.sx - 1), at).toBeLessThanOrEqual(12);
              }
            }
          }
        }
      }, 300_000);

      it('zoomed inside one column: it stays as wide on screen', () => {
        for (const [a, b] of pairs) {
          const [A, B] = [views.get(a)!, views.get(b)!];
          const f = A.fan.tess.fold as Steady;
          const u = frames(A)[0] ?? A.fan.root;
          const fr = P(A).frameOf({ v: u });
          // (Its widest strand, the screen a third of its room.)
          const { R } = f.rooms();
          const i = u.strands.reduce((p, q) => (R[q.index] > R[p.index] ? q : p)).index;
          stand(A, { ...fr, sx: (3 * A.w) / R[i] });
          stand(A, { ...A.cam, cx: f.rooms().C[i] });
          expect(onScreen(A), `${a} at ${A.fan.root.strands[i].sp.sci}`).toEqual([i]);
          B.goToPlace(A.place());
          expect(B.cam.sx / A.cam.sx, `${a} to ${b}`).toBeCloseTo(1, 6);
          expect(onScreen(B)).toEqual([i]);
        }
      }, 300_000);

      it("the fork names' switch: the frame with the names as they now are; free, the same strands and window", () => {
        const v = views.get(GAP_MODES[1])!;
        const on = forkNames();
        setGapMode(GAP_MODES[1]);
        try {
          const u = frames(v)[0];
          stand(v, P(v).frameOf({ v: u }));
          const p = v.place();
          expect(p.framed).toBe(true);
          setForkNames(!on);
          const W = stubView(clade(), tree(), folds);
          W.goToPlace(p);
          const up = W.fan.nodes[v.fan.nodes.indexOf(u)];
          expect(P(W).offBy(P(W).frameOf({ v: up }), W.cam)).toBeLessThanOrEqual(0.5);
          setForkNames(on);
          const f = P(v).frameOf({ v: u });
          stand(v, { ...f, sx: f.sx * 2, cx: f.cx + 20 / f.sx });
          const q = v.place();
          expect(q.framed).toBe(false);
          const seen = onScreen(v);
          setForkNames(!on);
          W.goToPlace(q);
          sameOnScreen(W, seen, 'fork names');
          expect(W.cam.sy / q.cam.sy).toBeCloseTo(1, 8);
        } finally {
          setForkNames(on);
        }
      }, 300_000);

      it('home still goes home after a switch', () => {
        const [A, B] = [views.get(GAP_MODES[0])!, views.get(GAP_MODES[1])!];
        const u = frames(A)[0];
        stand(A, P(A).frameOf({ v: u }));
        B.goToPlace(A.place());
        B.resetView();
        run(B);
        expect(P(B).offBy(B.homeCamera(), B.cam)).toBeLessThanOrEqual(1);
      });
    });
  }
});
