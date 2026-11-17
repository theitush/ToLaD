// The merged clades found by a walk down to the cut (ToLaD#502, lod.ts) against the whole-tree walk (lodref.ts), and the
// draw's walks bounded by the screen and the merged clades (drawStem's nodes, the strands and merged clades offSide's walk
// passed by, splitsOn's subtrees) against walking every node and strand: the same merged clades, the same hidden and
// merged answers for every node, and the same rectangles drawn, in the same order, at every frame. Random cameras over
// the whole zoom range (half with gray on), then the yardstick's gestures (a pinch in and out, a pan, a flight to a
// species and back) at home, in the largest order and in its largest family. Two views, each its own tree and state, take
// the same steps, one walking the old way, one the new (a frame drawn twice in one view is not the same frame: its first
// draw moves the grid and the columns' paths the second one finds).
// On the mammals; LODINDEX_N=7000 (or any size) on the synthetic tree instead, on demand (one tree a process).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setFlip } from './flip';
import { setLodIndex, type Lod } from './lod';
import { mergedRef } from './lodref';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { setGrayOn } from './steady';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import type { Camera } from './camera';
import { FanView } from './view';

const N = Number(process.env.LODINDEX_N || 0);
/** LODINDEX_SELF=1: the whole-tree walks in both views (the two views' own noise). */
const SELF = !!process.env.LODINDEX_SELF;

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
  lodNow(): Lod | null;
  forkLinesNow(): { n: number; xy: number[] };
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  toScreen(x: number, y: number): [number, number];
  toWorld(x: number, y: number): [number, number];
};

/** A small, seeded random source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe(`the merged clades and the draw's walks from the cut against the whole tree's (${N ? `synthetic ${N}` : 'mammals'})`, () => {
  /** Old (whole-tree walks) and new (bounded). */
  let views: [FanView, FanView];
  const I = (v: FanView) => v as unknown as Inner;
  let frames = 0;
  let mergedSum = 0;
  let rects = 0;
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true }));
    else await loadMammalsFromFiles();
    setFlip(true);
    views = [stubView(), stubView()];
    for (const v of views) {
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
    }
  }, 600000);
  afterAll(() => {
    setLodIndex(true);
    setGrayOn(false);
    setFlip(false);
  });

  let clock = 1e6;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  /** One step taken in both views. */
  const both = (f: (v: FanView) => void) => views.forEach(f);
  const I0 = () => I(views[1]);

  /** What a frame drew: every rectangle under and over the labels, in order, and the fork lines the leaders read. */
  const drawn = (v: FanView) => {
    const { under, over } = I(v).gl;
    const L = I(v).forkLinesNow();
    return { under: Array.from(under.f.subarray(0, 12 * under.n)), over: Array.from(over.f.subarray(0, 12 * over.n)), forks: L.xy.slice(0, 4 * L.n) };
  };

  /** Draws the frame in both views, the old way and the new, and holds them the same; then the merged clades against the whole-tree walk. */
  const same = (what: string) => {
    const [A, B] = views;
    // (One clock for both, standing still through each frame's draws: what the view times (a level's settling, a tap's
    // window) times the same in both.)
    clock += 16.7;
    const t = clock;
    setLodIndex(false);
    A.draw();
    clock = t;
    const before = drawn(A);
    setLodIndex(!SELF);
    B.draw();
    const after = drawn(B);
    setLodIndex(true);
    const cam = I(B).cam;
    expect(I(A).cam, what).toEqual(cam);
    const at = `${what} sx ${cam.sx} cx ${cam.cx} cy ${cam.cy} sy ${cam.sy} grid ${A.fan.tess.fold!.gridH} ${B.fan.tess.fold!.gridH} moving ${(A as unknown as { foldMoving: boolean }).foldMoving} ${(B as unknown as { foldMoving: boolean }).foldMoving} ver ${A.fan.tess.fold!.ver} ${B.fan.tess.fold!.ver}`;
    expect(after.under.length, `${at}: under`).toBe(before.under.length);
    expect(after.over.length, `${at}: over`).toBe(before.over.length);
    expect(after.under, `${at}: under`).toEqual(before.under);
    expect(after.over, `${at}: over`).toEqual(before.over);
    expect(after.forks, `${at}: fork lines`).toEqual(before.forks);
    const lod = I(B).lodNow()!;
    const fan = B.fan;
    const ref = mergedRef(fan, fan.tess.fold!, cam.sx);
    expect(lod.merged.length, `${at}: merged`).toBe(ref.merged.length);
    expect(lod.merged.every((x, m) => x === ref.merged[m]), `${at}: merged`).toBe(true);
    const nodes = fan.nodes;
    for (let j = 0; j < nodes.length; j++) {
      if (lod.hidden(nodes[j]) !== (ref.flag[j] === 2)) expect(lod.hidden(nodes[j]), `${at}: hidden ${nodes[j].name}`).toBe(ref.flag[j] === 2);
      if (lod.isMerged(nodes[j]) !== (ref.flag[j] === 1)) expect(lod.isMerged(nodes[j]), `${at}: merged ${nodes[j].name}`).toBe(ref.flag[j] === 1);
    }
    const of = lod.of;
    for (let i = 0; i < of.length; i++) if (of[i] !== ref.of[i] || lod.ofStrand(i) !== ref.of[i]) expect([of[i], lod.ofStrand(i)], `${at}: strand ${i}`).toEqual([ref.of[i], ref.of[i]]);
    frames++;
    mergedSum += ref.merged.length;
    rects += after.under.length / 12 + after.over.length / 12;
  };

  it('at random cameras over the whole zoom range, gray off and on', () => {
    const rnd = rng(502);
    const home = I0().homeCamera();
    both((v) => (I(v).cam = { ...home }));
    const [x0] = I0().toWorld(0, 0);
    const [x1] = I0().toWorld(I0().w, 0);
    for (let k = 0; k < (N ? 150 : 300); k++) {
      const sx = home.sx * 2 ** (rnd() * 15);
      const sy = home.sy * 2 ** (rnd() * 5 - 1);
      const cx = x0 + rnd() * (x1 - x0);
      const cy = home.cy + (rnd() - 0.5) * (I0().h / home.sy);
      both((v) => (I(v).cam = { ...home, sx, sy, cx, cy }));
      setGrayOn(k % 2 === 1);
      same(`random ${k}${k % 2 ? ' gray' : ''}`);
    }
    setGrayOn(false);
  }, 1200000);

  it('through the gestures: a pinch, a pan and a flight at home, in an order and in a family', () => {
    const marks = N ? synthMarksNow! : { order: 'Carnivora', family: 'Felidae' };
    for (const [depth, cam] of [
      ['home', (v: FanView) => I(v).homeCamera()],
      ['order', (v: FanView) => I(v).levelCamera(marks.order)],
      ['family', (v: FanView) => I(v).levelCamera(marks.family)],
    ] as const) {
      both((v) => {
        const c = cam(v);
        expect(c, depth).toBeTruthy();
        I(v).cam = c!;
      });
      same(`${depth} landed`);
      both((v) => I(v).gestureStart());
      for (let k = 0; k < 40; k++) {
        both((v) => v.zoomAbout(I(v).w / 2, I(v).h / 2, k < 20 ? 1.06 : 1 / 1.06));
        same(`${depth} pinch ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
        I(v).gestureStart();
      });
      for (let k = 0; k < 30; k++) {
        both((v) => v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3));
        same(`${depth} pan ${k}`);
      }
      both((v) => {
        I(v).gestureEnd();
        I(v).levelNow(true);
      });
      const B = views[1];
      const on = B.fan.branches.filter((b) => {
        const [x] = I(B).toScreen(b.cx, b.tipY);
        return x > 0 && x < I(B).w;
      });
      const sp = (on.length ? on : B.fan.branches).reduce((p, x) => (x.width > p.width ? x : p)).sp;
      for (const go of [(v: FanView) => v.flyToSpecies(v.fan.branches.find((b) => b.sp.sci === sp.sci)!.sp, false), (v: FanView) => v.resetView()]) {
        both(go);
        let now = clock;
        for (let k = 0; k < 600 && I0().anim; k++) {
          now += 16.7;
          both((v) => {
            const a = I(v).anim!;
            if (a && !a(now)) I(v).anim = null;
          });
          same(`${depth} flight ${k}`);
        }
      }
    }
  }, 1200000);

  afterAll(() => {
    console.log(`lodindex ${N || 'mammals'}: ${frames} frames the same; ${(mergedSum / Math.max(1, frames)).toFixed(0)} merged clades and ${(rects / Math.max(1, frames)).toFixed(0)} rectangles a frame`);
  });
});
