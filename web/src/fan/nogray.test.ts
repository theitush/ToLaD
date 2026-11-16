// The gray off (ToLaD#410, `?gray=off`): a look only. Only the "line ended" part of a branch with living descendants goes,
// under either gaps mode: what is extinct is drawn gray; the frames, the cut, the labels and the taps are those with it on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gapMode, setGapMode, type GapMode } from './fold';
import { isNode, laneAt, leftAt, nodeLeftAt, type FanBranch, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { forkMode, grayOn, setForkMode, setGrayOn, type ForkMode } from './steady';
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
  drawCorners(lod: unknown): void;
  drawLanes(pts: { n: number; y: Float64Array; w: Float64Array; f: Float64Array }, hw: number, held: unknown, gray: boolean): void;
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

  // ToLaD#444: anyone alive then is still shown. With it off a column is painted all the way from its tip to the bottom of the screen
  // (or of the tree), the only breaks those a fork's line stands in for; and every line a fork draws with it on is drawn, green if anyone in it lives.
  for (const forks of ['peel', 'thin'] as ForkMode[]) {
    it(`gaps clades, forks ${forks}: no column has a gap or floats, every fork is drawn`, () => {
      const was = gapMode();
      const wasForks = forkMode();
      setGapMode('clades');
      setForkMode(forks);
      try {
        const v = stubView(mammaliaClade(), mammaliaTree());
        const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
        gl.begin = () => {
          gl.under.n = 0;
          gl.over.n = 0;
        };
        inner(v).gl = gl;
        const self = v as unknown as Spied;
        const proto = FanView.prototype as unknown as Spied;
        let now: FanBranch | FanNode | null = null;
        let painted = new Map<FanBranch | FanNode, [number, number][]>();
        let lines: [number, number] = [0, 0];
        self.drawStrand = (b) => {
          now = b;
          proto.drawStrand.call(v, b);
        };
        self.drawMerged = (n) => {
          now = n;
          proto.drawMerged.call(v, n);
        };
        self.drawCorners = (lod) => {
          const n0 = gl.under.n;
          proto.drawCorners.call(v, lod);
          lines = [n0, gl.under.n];
        };
        self.drawLanes = (pts, _hw, _held, gray) => {
          const { y: Y, w: W, f: F, n } = pts;
          let at = painted.get(now!);
          if (!at) painted.set(now!, (at = []));
          for (let i = 0; i + 1 < n; i++) if (Y[i] > Y[i + 1] && (W[i] > 0 || W[i + 1] > 0) && (gray || W[i] * F[i] > 0 || W[i + 1] * F[i + 1] > 0)) at.push([Y[i + 1], Y[i]]);
        };
        const rects = () => {
          const out: { box: string; y0: number; y1: number; green: boolean; edge: boolean }[] = [];
          for (let i = lines[0]; i < lines[1]; i++) {
            const [x0, y0, x1, y1, r, g, bl] = Array.from(gl.under.f.subarray(12 * i, 12 * i + 7));
            out.push({ box: [x0, y0, x1, y1].map((a) => a.toFixed(2)).join(), y0, y1, green: g > 1.2 * bl && g > r, edge: x0 <= -8 || x1 >= 398 });
          }
          return out;
        };
        const by = (t: string) => v.fan.nodes.find((n) => n.split.taxon === t)!;
        const cams = [v.homeCamera(), ...['Didelphimorphia', 'Carnivora', 'Hominini'].flatMap((t) => {
          const c = v.cladeCamera(by(t));
          // (Its frame, and pinched in on its fork in time, as Ita's opossums.)
          return [c, { ...c, sy: c.sy * 3, ty: c.sy * 3, cy: by(t).y - 150 / (c.sy * 3) }];
        })];
        const bad: string[] = [];
        let met = 0;
        for (const cam of cams) {
          v.cam = { ...cam } as typeof v.cam;
          setGrayOn(true);
          frame(v);
          const on = rects();
          setGrayOn(false);
          painted = new Map();
          frame(v);
          const off = rects();
          expect(off.map((r) => r.box).sort()).toEqual(on.map((r) => r.box).sort());
          // A line stands in where a column has no width at a fork, only under `thin`.
          const green = off.filter((r) => r.green).sort((p, q) => p.y0 - q.y0);
          const bridged = (y0: number, y1: number) => {
            if (forks !== 'thin') return false;
            let y = y0;
            // (A flat line running off the screen's edge: the upright from it is off screen, not sent.)
            for (const r of green) if ((r.y0 <= y + 1 || r.edge) && r.y1 > y) y = r.y1;
            return y >= y1 - 1;
          };
          const bottom = Math.min(844, v.camera.screenY(v.fan.trunkBottom.y));
          // (Where its lane is on screen at all: a line off screen is not sent.)
          const seen = (of: FanBranch | FanNode, y0: number, y1: number) => {
            if (isNode(of)) return true;
            for (let k = 0; k <= 8; k++) {
              const x = v.camera.screenX(leftAt(of, v.camera.worldY(y0 + ((y1 - y0) * k) / 8)));
              if (x >= -8 && x <= 398) return true;
            }
            return false;
          };
          for (const [of, at] of painted) {
            // (No founders, a domestic species' (ToLaD#435): no width below its split, with the gray on or off; its column stands on its wild form's.)
            if (!isNode(of) && !(of.baseW > 0)) continue;
            // (Under thin an extinct column may be all gray line, whose breaks are not this test's: its living ones are.)
            if (forks === 'thin' && (isNode(of) ? cladeAllGray(of) : allGray(of))) continue;
            const name = isNode(of) ? of.split.taxon : of.sp.sci;
            at.sort((p, q) => p[0] - q[0]);
            let y = at.length ? at[0][0] : Infinity;
            if (!isNode(of) && y > Math.max(-20, v.camera.screenY(of.tipY)) + 1) bad.push(`${name}: its tip not drawn, starts at ${y}`);
            for (const [t, b] of at) {
              if (t > y + 0.01 && !bridged(y, t) && seen(of, y, t)) bad.push(`${name}: a gap ${y}..${t}`);
              y = Math.max(y, b);
              met++;
            }
            // (Under thin, a line whose fork is below the screen is not sent, gray on or off: nothing to judge past the last line.)
            if (at.length && y < bottom - 1 && !bridged(y, bottom) && (forks !== 'thin' || green.some((r) => r.y1 > y))) bad.push(`${name}: floats, stops at ${y} of ${bottom}`);
          }
        }
        expect(met).toBeGreaterThan(0);
        expect(bad.slice(0, 12)).toEqual([]);
      } finally {
        setGrayOn(true);
        setGapMode(was);
        setForkMode(wasForks);
      }
    }, 300000);
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
