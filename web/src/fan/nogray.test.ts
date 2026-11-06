// The gray off (ToLaD#410, `?gray=off`): a look only. Only the "line ended" part of a branch with living descendants goes,
// under either gaps mode: what is extinct is drawn gray; the frames, the cut, the labels and the taps are those with it on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gapMode, setGapMode, type GapMode } from './fold';
import { isNode, laneAt, leftAt, nodeLeftAt, type FanBranch, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { grayOn, setGrayOn } from './steady';
import { allGray, cladeAllGray, FanView, GRAY, grayFoot, type CutLabels } from './view';

const fills: string[] = [];
function stubView(clade: CladeRec, tree: Split): FanView {
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
  const props = ['font', 'fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'filter', 'imageSmoothingEnabled'];
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && !props.includes(k) ? noop : undefined),
    set: (_, k, x) => {
      if (k === 'fillStyle') fills.push(String(x));
      return true;
    },
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, true);
}

type Inner = {
  gl: unknown;
  applyFold(): void;
  cutLast: CutLabels | null;
  brackets: { placed: { i: number }[]; list: { v: FanNode }[]; forks: { i: number }[]; forkN: number };
  thumbHits: unknown[];
};
const inner = (v: FanView) => v as unknown as Inner;
type Spied = {
  drawStrand(b: FanBranch): void;
  drawMerged(v: FanNode): void;
  drawLanes(pts: { n: number; y: Float64Array }, hw: number, held: unknown, gray: boolean): void;
};
const frame = (v: FanView) => {
  v.camera.settle();
  inner(v).applyFold();
  v.draw();
};

/** The frames looked at: a level's home, and each named clade's own (fossils in view at some). */
const LEVELS: [string, () => CladeRec, () => Split][] = [
  ['cats', () => FELIDAE, () => FELIDAE_TREE],
  ['carnivores', () => CARNIVORA, () => CARNIVORA_TREE],
  ['mammals', () => mammaliaClade(), () => mammaliaTree()],
];
const FRAMES = 3;
function frames(v: FanView): { sx: number; cx: number; cy: number; sy: number; ty?: number }[] {
  const named = v.fan.nodes.filter((n) => n.parent);
  const step = Math.max(1, Math.floor(named.length / FRAMES));
  const cams = [v.homeCamera()];
  for (let i = 0; i < named.length; i += step) cams.push(v.cladeCamera(named[i]));
  // (Every clade with no one living, a look right at what goes.)
  for (const n of named.filter(cladeAllGray).slice(0, 2)) cams.push(v.cladeCamera(n));
  return cams;
}

describe('gray off (ToLaD#410)', () => {
  beforeAll(async () => {
    await loadMammalsFromFiles();
  });
  afterEach(() => setGrayOn(true));

  it('a strand counted all gray never has green, a living one always has', () => {
    for (const [, c, t] of LEVELS) {
      const v = stubView(c(), t());
      for (const b of v.fan.branches) {
        const ages = [0, 1e-3, 0.01, 0.1, b.t0 / 2, b.t0 * 0.99];
        const green = ages.some((a) => b.pop.greenAt(a) > 0 && b.pop.aliveAt(a) > 0);
        expect([b.sp.sci, allGray(b)]).toEqual([b.sp.sci, !green]);
      }
    }
  });

  for (const mode of ['groups', 'clades'] as GapMode[]) {
    for (const [name, c, t] of LEVELS) {
      it(`${name}, gaps ${mode}: gray only on what is extinct, drawn gray; labels, names and taps as with it on`, () => {
        const was = gapMode();
        setGapMode(mode);
        try {
          const v = stubView(c(), t());
          const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
          gl.begin = () => {
            gl.under.n = 0;
            gl.over.n = 0;
          };
          const S = v.fan.branches;
          const self = v as unknown as Spied;
          const proto = FanView.prototype as unknown as Spied;
          // Each column drawn and whether its gray is: the lanes held back, so the batch is left with the stems and the corners.
          let now: FanBranch | FanNode | null = null;
          let graysOn: { of: FanBranch | FanNode; bottom: number }[] = [];
          self.drawStrand = (b) => {
            now = b;
            proto.drawStrand.call(v, b);
          };
          self.drawMerged = (n) => {
            now = n;
            proto.drawMerged.call(v, n);
          };
          const hold = (pts: { n: number; y: Float64Array }, _hw: number, _held: unknown, gray: boolean) => {
            if (gray && pts.n > 1) graysOn.push({ of: now!, bottom: pts.y[0] });
          };
          const release = () => {
            delete (self as Partial<Spied>).drawLanes;
          };
          let hitsOn = 0;
          let drawnGray = 0;
          for (const cam of frames(v)) {
            // With it on: what is laid out, and the tap on each.
            release();
            setGrayOn(true);
            inner(v).gl = gl;
            v.cam = { ...cam } as typeof v.cam;
            // (Twice: a frame's fork names stand on the one before's.)
            frame(v);
            frame(v);
            const labels = () => {
              const l = inner(v).cutLast!;
              const br = inner(v).brackets;
              return JSON.stringify({
                all: l.all.map((it) => `${it.f}:${it.l}:${it.x0}:${it.x1}`),
                items: l.items.map((it) => `${it.f}:${it.l}`),
                pics: l.pics.map((p) => p.face.index),
                spots: [...l.spots, ...l.names].map((s) => s.run),
                groups: [...l.groups].map(([, g]) => g.map(([b]) => b.index)),
                placed: br.placed.map((p) => p.i),
                forks: br.forks.slice(0, br.forkN).map((p) => p.i),
              });
            };
            const on = labels();
            const home = { ...v.cam };
            const yMid = v.toWorld(0, 400)[1];
            const taps: [number, number][] = [];
            for (const b of S) {
              if (!allGray(b) || taps.length >= 6) continue;
              const y = Math.max(b.tipY, yMid);
              const [x, sy] = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y);
              if (x >= 0 && x <= 390 && sy >= 0 && sy <= 844) taps.push([x, sy]);
            }
            for (let x = 20; x < 390; x += 60) taps.push([x, 300], [x, 600]);
            const hitOn = taps.map(([x, y]) => v.hitBranch(x, y));
            for (const a of hitOn) if (a && allGray(a)) hitsOn++;

            // Off: the same frame, the same labels and taps, and its gray with it.
            setGrayOn(false);
            graysOn = [];
            self.drawLanes = hold;
            frame(v);
            expect(v.cam).toEqual(home);
            expect(JSON.parse(labels())).toEqual(JSON.parse(on));
            expect(taps.map(([x, y]) => v.hitBranch(x, y))).toEqual(hitOn);

            // No gray lane on a branch with living descendants, nor below where an extinct one joins it.
            for (const { of, bottom } of graysOn) {
              const foot = isNode(of) ? grayFoot(of.parent, of.yBot) : grayFoot(of.node, of.splitY);
              expect(isNode(of) ? cladeAllGray(of) : allGray(of)).toBe(true);
              expect(bottom).toBeLessThanOrEqual(v.camera.screenY(foot) + 1e-6);
            }
            // Every extinct species' own column on screen is drawn gray (unless inside a ribbon drawn as one).
            const lod = v.lodNow();
            const drawn = new Set(graysOn.map((g) => g.of));
            const [, wTop] = v.toWorld(0, 0);
            const [, wBot] = v.toWorld(0, 844);
            for (const b of S) {
              if (!allGray(b) || (lod && lod.of[b.index] >= 0)) continue;
              const y0 = Math.max(b.tipY, wTop);
              const y1 = Math.min(b.splitY, wBot);
              if (!(y1 > y0)) continue;
              const y = (y0 + y1) / 2;
              const x = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y)[0];
              if (x < 4 || x > 386) continue;
              expect([b.sp.sci, drawn.has(b)]).toEqual([b.sp.sci, true]);
              drawnGray++;
            }
            // All that is left in the batch: the stems' backdrop and the corner lines, only for what has no one living.
            const allGrayKid = (n: FanNode) => n.kids.some((k) => (isNode(k) ? cladeAllGray(k) : allGray(k)));
            const b = gl.under;
            for (let i = 0; i < b.n; i++) {
              const [x0, y0, x1, y1, r, g, bl, a] = Array.from(b.f.subarray(12 * i, 12 * i + 8));
              if (x0 <= 0 && x1 >= 390 && a <= 0.11) continue;
              if (g > 1.2 * bl && g > r) continue;
              const wy = v.toWorld(0, (y0 + y1) / 2)[1];
              const wx = v.toWorld((x0 + x1) / 2, 0)[0];
              const stem = v.fan.nodes.some((n) => cladeAllGray(n) && wy >= n.y - 1e-6 && wy <= n.yBot + 1e-6 && wx >= nodeLeftAt(n, wy) - 1 / v.cam.sx && wx <= nodeLeftAt(n, wy) + n.width + 1 / v.cam.sx);
              const corner = x1 - x0 <= 1.01 || y1 - y0 <= 1.01 ? v.fan.nodes.some((n) => allGrayKid(n) && Math.abs(v.camera.screenY(n.y) - y1) <= 0.6) : false;
              expect(stem || corner).toBe(true);
            }

            // And the real thing, on the 2D canvas's path: gray fills where a gray lane was, off and on.
            release();
            const any = graysOn.length > 0;
            inner(v).gl = null;
            fills.length = 0;
            frame(v);
            if (any) expect(fills).toContain(GRAY);
            setGrayOn(true);
            expect(grayOn()).toBe(true);
          }
          // (The cats, the carnivores and the mammals all have fossils: the sweep above met some.)
          expect(hitsOn).toBeGreaterThan(0);
          expect(drawnGray).toBeGreaterThan(0);
        } finally {
          setGrayOn(true);
          setGapMode(was);
        }
      }, 300000);
    }
  }

  it('a living column with gray keeps no gray fill with it off, on the 2D path', () => {
    const v = stubView(FELIDAE, FELIDAE_TREE);
    const lion = v.fan.branches.find((b) => !allGray(b))!;
    const self = v as unknown as Spied;
    setGrayOn(false);
    inner(v).gl = null;
    v.cam = { ...v.homeCamera() } as typeof v.cam;
    v.camera.settle();
    inner(v).applyFold();
    fills.length = 0;
    self.drawStrand.call(v, lion);
    expect(fills).not.toContain(GRAY);
    setGrayOn(true);
    fills.length = 0;
    self.drawStrand.call(v, lion);
    expect(fills).toContain(GRAY);
  });
});
