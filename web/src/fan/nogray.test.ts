// The gray off (ToLaD#410, `?gray=off`): a look only. Nothing with no living descendants is drawn, named or taken by a
// tap, under either gaps mode; the frames, the cut and the living columns' places are those with it on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gapMode, setGapMode, type GapMode } from './fold';
import { laneAt, leftAt, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { grayOn, setGrayOn } from './steady';
import { allGray, cladeAllGray, FanView, GRAY, type CutLabels } from './view';

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
const frame = (v: FanView) => {
  v.camera.settle();
  inner(v).applyFold();
  v.draw();
};

/** A batch's lanes' colours that are not a green (GREEN to its dark tint: green well over blue; gray's dark tint: about level). */
function grays(b: RectBatch): number {
  let n = 0;
  for (let i = 0; i < b.n; i++) {
    const [r, g, bl] = [b.f[12 * i + 4], b.f[12 * i + 5], b.f[12 * i + 6]];
    // (The world's layers across the whole screen, the ice ages and the time grid: no part of the tree.)
    if (b.f[12 * i] <= 0 && b.f[12 * i + 2] >= 390 && b.f[12 * i + 7] <= 0.11) continue;
    if (!(g > 1.2 * bl && g > r)) n++;
  }
  return n;
}

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
      it(`${name}, gaps ${mode}: no gray drawn, no label, name or tap for what has no one living; the rest as with it on`, () => {
        const was = gapMode();
        setGapMode(mode);
        try {
          const v = stubView(c(), t());
          const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
          gl.begin = () => {
            gl.under.n = 0;
            gl.over.n = 0;
          };
          const cams = frames(v);
          let hitsOn = 0;
          for (const cam of cams) {
            // With it on: the gray there, and what is laid out.
            setGrayOn(true);
            inner(v).gl = gl;
            v.cam = { ...cam } as typeof v.cam;
            frame(v);
            const on = inner(v).cutLast!;
            const grayOnThere = grays(gl.under);
            const all = on.all.map((it) => `${it.f}:${it.l}:${it.x0}:${it.x1}`);
            const home = { ...v.cam };
            // Off: the same frame, no gray.
            setGrayOn(false);
            frame(v);
            expect(v.cam).toEqual(home);
            expect(grays(gl.under)).toBe(0);
            const off = inner(v).cutLast!;
            expect(off.all.map((it) => `${it.f}:${it.l}:${it.x0}:${it.x1}`)).toEqual(all);
            const S = v.fan.branches;
            const strands = (it: { f: number; l: number }) => {
              const out = [];
              for (const b of S) if (b.index >= it.f && b.index <= it.l) out.push(b);
              return out;
            };
            for (const it of off.items) expect(strands(it).some((b) => !allGray(b))).toBe(true);
            for (const p of off.pics) expect(allGray(p.face)).toBe(false);
            for (const s of [...off.spots, ...off.names]) {
              const [f, l] = s.run!;
              expect(strands({ f, l }).some((b) => !allGray(b))).toBe(true);
            }
            for (const [, g] of off.groups) for (const [b] of g) expect(allGray(b)).toBe(false);
            const br = inner(v).brackets;
            for (const p of br.placed) expect(cladeAllGray(br.list[p.i].v)).toBe(false);
            for (let k = 0; k < br.forkN; k++) expect(cladeAllGray(br.list[br.forks[k].i].v)).toBe(false);
            // A tap on an all-gray column on this frame, and across the screen: never one; with it on, it takes it.
            const yMid = v.toWorld(0, 400)[1];
            const taps: [number, number][] = [];
            for (const b of S) {
              if (!allGray(b) || taps.length >= 6) continue;
              const y = Math.max(b.tipY, yMid);
              const [x, sy] = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y);
              if (x >= 0 && x <= 390 && sy >= 0 && sy <= 844) taps.push([x, sy]);
            }
            for (let x = 20; x < 390; x += 60) taps.push([x, 300], [x, 600]);
            for (const [x, y] of taps) {
              const b = v.hitBranch(x, y);
              expect(b && allGray(b)).toBeFalsy();
              setGrayOn(true);
              const a = v.hitBranch(x, y);
              if (a && allGray(a)) hitsOn++;
              setGrayOn(false);
            }
            // And the 2D canvas's path, no GPU layer: no gray fill.
            inner(v).gl = null;
            fills.length = 0;
            frame(v);
            expect(fills).not.toContain(GRAY);
            setGrayOn(true);
            fills.length = 0;
            frame(v);
            if (grayOnThere > 0) expect(fills).toContain(GRAY);
            expect(grayOn()).toBe(true);
          }
          // (The cats, the carnivores and the mammals all have fossils: the sweep above met some.)
          expect(hitsOn).toBeGreaterThan(0);
        } finally {
          setGrayOn(true);
          setGapMode(was);
        }
      }, 300000);
    }
  }
});
