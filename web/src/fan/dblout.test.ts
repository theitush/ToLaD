// A double tap always zooms out, on to the nearest level that does (ToLaD#416). Random pinched views and tap paths at all
// three levels, under the gaps' modes where it showed (`groups`, `clades`): no double tap zooms in on either axis, each
// lands on the nearest level that zooms out, a second goes on up, home stays home. Checked by code (no browser).
// `DBLOUT_SAY=1` prints the counts. The suite samples 40 views and 3 tap paths per mode and level; `DBLOUT_FULL=1` runs 400 and 25.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { gapMode, setGapMode, type GapMode } from './fold';
import type { FanBranch, FanNode } from './layout';
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
  g.window = { devicePixelRatio: 2, addEventListener: noop, removeEventListener: noop, setTimeout: () => 0, clearTimeout: noop };
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
    clientHeight: 844,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
}
type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  camera: FanCamera;
  frameOf(lv: Level): Camera;
  offBy(a: Camera, c: Camera): number;
  upFrom(lv: Level, c: Camera): { lv: Level; cam: Camera } | null;
  centreLine(): FanBranch | null;
  steps: { cam: Camera }[];
  tapAt: unknown;
  backing: { lv: Level; cam: Camera } | null;
  famHits: { box: number[]; v: FanNode }[];
};
const P = (v: FanView) => v as unknown as Priv;
/** The px a tap's next level is passed within (view.ts's LEVEL_PX). */
const STEP = 12;
const LEVELS: [string, () => CladeRec, () => Split, boolean][] = [
  ['cats', () => FELIDAE, () => FELIDAE_TREE, false],
  ['carnivores', () => CARNIVORA, () => CARNIVORA_TREE, true],
  ['mammals', mammaliaClade, mammaliaTree, true],
];
const proc = (globalThis as unknown as { process: { stderr: { write(s: string): void }; env: Record<string, string> } }).process;
const say = (s: string) => proc.env.DBLOUT_SAY && proc.stderr.write(s + '\n');
const VIEWS = proc.env.DBLOUT_FULL ? 400 : 40;
const PATHS = proc.env.DBLOUT_FULL ? 25 : 3;
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The flight under way to its landing, in one jump: where it lands is what is checked here, not how (dbltap.test.ts's). */
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 1e7) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}
function stand(v: FanView, c: Camera): void {
  const iv = P(v);
  iv.anim = null;
  iv.backing = null;
  iv.steps = [];
  iv.tapAt = null;
  if (v.fan.tess.fold) (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
  v.cam = { ...c, ty: c.sy };
  iv.camera.settle();
  iv.applyFold();
}
/** How much tighter frame a is than the view at c, in px of the screen (negative: wider): width, time. */
const tighter = (v: FanView, a: Camera, c: Camera) => [v.w * (a.sx / c.sx - 1), v.h * (a.sy / c.sy - 1)];
/** The rule, on its own: neither axis visibly tighter, one visibly wider, and the view visibly moves. */
function zoomsOut(v: FanView, a: Camera, c: Camera): boolean {
  const [x, y] = tighter(v, a, c);
  return x <= STEP && y <= STEP && (x < -STEP || y < -STEP) && P(v).offBy(a, c) > STEP;
}
/** Where a double tap should land from level `from`, the view at c: the nearest level up that zooms out; home as the last resort while it is wider on width; else nothing. */
function want(v: FanView, from: Level, c: Camera): FanNode | null {
  const up = v.levelsAbove(from).find((u) => zoomsOut(v, P(v).frameOf({ v: u }), c));
  if (up) return up;
  const h = P(v).frameOf({ v: v.fan.root });
  return zoomsOut(v, h, c) || (tighter(v, h, c)[0] < -STEP && P(v).offBy(h, c) > STEP) ? v.fan.root : null;
}
const nodeName = (u: FanNode | null) => (u ? (u.split.taxon ?? '(node)') : 'nothing');
const name = (lv: Level) => (lv.b ? lv.b.sp.common : nodeName(lv.v));
const moved = (v: FanView, c: Camera) => v.cam.cx !== c.cx || v.cam.cy !== c.cy || v.cam.sx !== c.sx || v.cam.sy !== c.sy;

describe('a double tap always zooms out, on to the nearest level that does (ToLaD#416)', () => {
  const was = gapMode();
  beforeAll(async () => {
    await loadMammalsFromFiles();
  }, 300_000);
  afterAll(() => setGapMode(was));

  for (const mode of ['groups', 'clades'] as GapMode[]) {
    for (const [lname, clade, tree, folds] of LEVELS) {
      it(`${mode}, ${lname}: random pinched views`, () => {
        setGapMode(mode);
        const v = stubView(clade(), tree(), folds);
        const rnd = random(416);
        const clades = v.fan.nodes.filter((u) => u.parent && isLevel(v.fan, u));
        const bs = v.fan.branches;
        const home = v.homeCamera();
        const bad: string[] = [];
        const n = { views: 0, wasIn: 0, changed: 0, nothing: 0, nothingWide: 0, lastResort: 0, onHome: 0, below: 0, onwards: 0 };
        let belowEg = '';
        for (let k = 0; k < VIEWS; k++) {
          // A pinch from a frame: wide or narrow on each axis on its own, from a level or a species, anywhere near it.
          const pick = rnd();
          const lv0: Level = pick < 0.1 ? { v: v.fan.root } : pick < 0.6 ? { v: clades[Math.floor(rnd() * clades.length)] } : { b: bs[Math.floor(rnd() * bs.length)] };
          stand(v, P(v).frameOf(lv0));
          v.levelNow(true);
          v.gestureStart();
          v.zoom(v.w * rnd(), v.h * rnd(), Math.exp(-1 + 4.5 * rnd()), Math.exp(-1 + 4.5 * rnd()));
          v.pan((rnd() - 0.5) * v.w * 0.5, (rnd() - 0.5) * v.h * 0.5);
          v.gestureEnd();
          P(v).applyFold();
          const c = { ...v.cam };
          const from = v.levelNow(true);
          const to = want(v, from, c);
          const old = P(v).upFrom(from, c);
          const at = `${mode} ${lname} #${k} from ${name(from)} sx ${c.sx.toPrecision(4)} sy ${c.sy.toPrecision(4)}`;
          n.views++;
          // (What it did before: a landing tighter on an axis, and how many land elsewhere now.)
          if (old) {
            const [ox, oy] = tighter(v, old.cam, c);
            if (ox > STEP || oy > STEP) n.wasIn++;
          }
          if ((old?.lv.v ?? null) !== to) n.changed++;
          // (A level of the centre's line deeper than the one the view is read at, that would zoom out from it: levelNow's to answer for.)
          const line = P(v).centreLine();
          if (line && from.v) {
            const deeper: Level[] = [{ b: line }];
            for (const u of v.levelsAbove({ b: line })) {
              if (u === from.v) break;
              deeper.push({ v: u });
            }
            const q = deeper.find((l) => zoomsOut(v, P(v).frameOf(l), c));
            if (q && v.levelsAbove({ b: line }).includes(from.v)) {
              n.below++;
              belowEg ||= `${name(from)}, ${name(q)} below it`;
            }
          }
          v.doubleTap(-1e4, -1e4);
          if (!to) {
            if (P(v).anim || moved(v, c)) bad.push(`${at}: flew, wanted nothing`);
            n.nothing++;
            if (tighter(v, home, c)[0] > STEP) n.nothingWide++;
            continue;
          }
          run(v);
          const land = { ...v.cam };
          if (P(v).offBy(P(v).frameOf({ v: to }), land) > 2) bad.push(`${at}: landed off ${nodeName(to)}`);
          const [x, y] = tighter(v, land, c);
          if (to === v.fan.root && !zoomsOut(v, land, c)) {
            // Home, the last resort: wider on width.
            n.lastResort++;
            if (x >= -STEP) bad.push(`${at}: home by last resort, not wider (${x.toFixed(0)} px)`);
          } else {
            if (to === v.fan.root) n.onHome++;
            if (x > STEP || y > STEP) bad.push(`${at}: to ${nodeName(to)} zoomed in, ${x.toFixed(0)}, ${y.toFixed(0)} px`);
            if (x >= -STEP && y >= -STEP) bad.push(`${at}: to ${nodeName(to)} did not visibly widen`);
          }
          // A second one goes on up.
          const lv2 = v.levelNow(true);
          if (lv2.v !== to) bad.push(`${at}: landed, read as ${name(lv2)}, not ${nodeName(to)}`);
          const to2 = want(v, lv2, land);
          v.doubleTap(-1e4, -1e4);
          if (to2) {
            run(v);
            n.onwards++;
            if (P(v).offBy(P(v).frameOf({ v: to2 }), v.cam) > 2) bad.push(`${at}: second to ${name(v.levelNow(true))}, not ${nodeName(to2)}`);
            const [x2, y2] = tighter(v, v.cam, land);
            if (to2 !== v.fan.root && (x2 > STEP || y2 > STEP)) bad.push(`${at}: second to ${nodeName(to2)} zoomed in`);
          } else if (P(v).anim || moved(v, land)) bad.push(`${at}: second flew, wanted nothing`);
        }
        say(`${mode} ${lname}: ${JSON.stringify(n)} ${belowEg}`);
        expect(bad.slice(0, 20)).toEqual([]);
      }, 600_000);

      it(`${mode}, ${lname}: tap paths, flights under way, home`, () => {
        setGapMode(mode);
        const v = stubView(clade(), tree(), folds);
        const rnd = random(4160);
        const home = v.homeCamera();
        const bad: string[] = [];
        const n = { taps: 0, straight: 0, passed: 0, passedToHome: 0, stuck: 0, midFlight: 0, firstRan: 0, firstRanBack: 0 };
        const atPoint = (): [number, number] => {
          const hs = P(v).famHits;
          if (hs.length && rnd() < 0.7) {
            const { box } = hs[Math.floor(rnd() * hs.length)];
            return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
          }
          return [v.w * (0.3 + 0.6 * rnd()), v.h * (0.2 + 0.6 * rnd())];
        };
        const draw = () => {
          for (let k = 0; k < 3; k++) v.draw();
        };
        for (let path = 0; path < PATHS; path++) {
          stand(v, home);
          draw();
          // Down, a tap at a time, each landing remembered.
          const views: Camera[] = [{ ...v.cam }];
          for (let d = 0; d < 6; d++) {
            const [x, y] = atPoint();
            const c0 = { ...v.cam };
            v.tap(x, y);
            run(v);
            draw();
            if (P(v).offBy(v.cam, c0) <= STEP) break;
            views.push({ ...v.cam });
            n.taps++;
          }
          // Back out: every double tap zooms out, or nothing, on the way home; straight back where a tap's reversal zooms out.
          let doubles = 0;
          for (; doubles < 20; doubles++) {
            const c = { ...v.cam };
            const back = views[views.length - 2];
            const at = `${mode} ${lname} path ${path} double ${doubles}`;
            v.doubleTap(-1e4, -1e4);
            if (!P(v).anim) {
              if (moved(v, c)) bad.push(`${at}: moved with no flight`);
              if (P(v).offBy(c, home) > STEP) n.stuck++;
              break;
            }
            run(v);
            draw();
            const [x, y] = tighter(v, v.cam, c);
            const homeLast = P(v).offBy(v.cam, home) <= 2 && x < -STEP;
            if ((x > STEP || y > STEP) && !homeLast) bad.push(`${at}: zoomed in ${x.toFixed(0)}, ${y.toFixed(0)} px`);
            if (x >= -STEP && y >= -STEP) bad.push(`${at}: did not widen`);
            if (back && P(v).offBy(back, v.cam) <= 2) {
              n.straight++;
              views.pop();
            } else if (back) {
              n.passed++;
              if (P(v).offBy(v.cam, home) <= 2) n.passedToHome++;
              views.length = 1;
            }
          }
          if (doubles >= 20) bad.push(`${mode} ${lname} path ${path}: never stopped`);
          // A tap's flight under way: from where it lands.
          stand(v, home);
          draw();
          const [x1, y1] = atPoint();
          v.tap(x1, y1);
          run(v);
          draw();
          const c1 = { ...v.cam };
          const [x2, y2] = atPoint();
          v.tap(x2, y2);
          const landing = P(v).backing?.cam;
          if (P(v).anim && landing && P(v).offBy(landing, c1) > STEP) {
            n.midFlight++;
            P(v).anim!(performance.now() + 100);
            P(v).applyFold();
            v.doubleTap(-1e4, -1e4);
            run(v);
            const [x, y] = tighter(v, v.cam, landing);
            if ((x > STEP || y > STEP) && P(v).offBy(v.cam, home) > 2) bad.push(`${mode} ${lname} path ${path}: mid-flight zoomed in from where it lands, ${x.toFixed(0)}, ${y.toFixed(0)}`);
          }
          run(v);
          draw();
          // A first tap already run: from where that tap found the view, or back there.
          const c2 = { ...v.cam };
          const [x3, y3] = atPoint();
          v.tap(x3, y3);
          v.doubleTap(x3, y3, true);
          run(v);
          draw();
          n.firstRan++;
          if (P(v).offBy(v.cam, c2) <= 2) n.firstRanBack++;
          else {
            const [x, y] = tighter(v, v.cam, c2);
            if ((x > STEP || y > STEP) && P(v).offBy(v.cam, home) > 2) bad.push(`${mode} ${lname} path ${path}: first tap run, zoomed in ${x.toFixed(0)}, ${y.toFixed(0)}`);
          }
        }
        // Home stays home, a double tap whose first tap ran comes back to it, and wider than home nothing odd.
        stand(v, home);
        draw();
        v.doubleTap(-1e4, -1e4);
        if (P(v).anim || moved(v, home)) bad.push(`${mode} ${lname}: a double tap at home flew`);
        const [hx, hy] = [v.w * 0.62, v.h * 0.45];
        v.tap(hx, hy);
        v.doubleTap(hx, hy, true);
        run(v);
        if (P(v).offBy(v.cam, home) > 2) bad.push(`${mode} ${lname}: home's double tap, first tap run, did not come home`);
        stand(v, home);
        v.gestureStart();
        v.zoom(v.w / 2, v.h / 2, 0.5, 0.5);
        v.gestureEnd();
        P(v).applyFold();
        const wide = { ...v.cam };
        v.doubleTap(-1e4, -1e4);
        run(v);
        if (tighter(v, home, wide)[0] > STEP && moved(v, wide)) bad.push(`${mode} ${lname}: wider than home, a double tap flew`);
        say(`${mode} ${lname} taps: ${JSON.stringify(n)}`);
        expect(bad.slice(0, 20)).toEqual([]);
      }, 600_000);
    }
  }
});
