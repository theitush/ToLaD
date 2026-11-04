// Steady labels (ToLaD#333, Ita 2026-11-01: "the pics and tags like move and change size and stuff when i move around
// the tree.. they shouldt"). Over a recorded gesture (a pinch, a pan, a flight) at the cats, the carnivores and the
// mammals: every picture is PIC_D across and every name pill keeps its size, frame after frame; where a label stays
// shown it moves no farther than the world on screen does (a continuous function of the camera, no jumps); and within
// a pinch or a pan one way no label shows, hides, then shows again (each appears or goes at its own fit zoom, Been et
// al.'s active range). Every frame is laid out (no carry, no rest pass): the first frame has its labels.
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { PIC_D } from './pics';
import { FanView, groupCentre, type CutLabels } from './view';

function stubView(clade: CladeRec = CARNIVORA, tree: Split = CARNIVORA_TREE, folds = true): FanView {
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
  const v = new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
  // (The steady place is the named species' (#358); the middle of an item's branches (ToLaD#368, the default while Ita
  // compares) jumps where the item splits, its branches being the cut's: that switch is off here.)
  v.midLabels = false;
  return v;
}

/** A label's place and size (screen), and the screen x of the columns it stands on (its anchor: groupCentre; NaN, a "+x"). */
type Spot = { x: number; y: number; w: number; h: number; c: number };
type Shot = Map<string, Spot> & { held?: boolean };
/** A frame's labels: each name pill (by its item and text) and each picture (by what it opens), where and how big. */
function shot(v: FanView, c: CutLabels): Shot {
  const m: Shot = new Map();
  m.held = c.pics.some((p) => p.y - p.d / 2 <= v.rowLast + 1e-6);
  const at = (x: number) => v.toScreen(x, 0)[0];
  for (const s of c.spots) {
    const g = s.v ? { v: s.v } : s.b ? { b: s.b } : null;
    m.set(`name ${s.key} ${s.text}`, { x: s.x, y: s.box[3], w: s.box[2] - s.box[0], h: s.box[3] - s.box[1], c: g ? at(groupCentre(g)) : NaN });
  }
  // (A picture is its face species', whichever item of the cut it stands for.)
  for (const p of c.pics) m.set(`pic ${p.face.sp.sci}`, { x: p.x, y: p.y, w: p.d, h: p.d, c: at(groupCentre({ b: p.face })) });
  return m;
}
type Step = (v: FanView) => void;

/** Play `steps`, one a frame, drawing each; the shots, and per step the most a world point on screen moved (px). */
function play(v: FanView, steps: Step[]): { shots: Shot[]; moved: number[] } {
  v.draw();
  const shots = [shot(v, v.cutLast!)];
  const moved: number[] = [];
  const grid = [0, 0.25, 0.5, 0.75, 1].flatMap((a) => [0, 0.25, 0.5, 0.75, 1].map((b) => [a * v.w, b * v.h]));
  for (const step of steps) {
    const was = grid.map(([x, y]) => v.toWorld(x, y));
    step(v);
    v.draw();
    shots.push(shot(v, v.cutLast!));
    moved.push(Math.max(...was.map(([x, y], i) => Math.hypot(v.toScreen(x, y)[0] - grid[i][0], v.toScreen(x, y)[1] - grid[i][1]))));
  }
  return { shots, moved };
}

/**
 * Sizes that changed, jumps, and labels shown, hidden, then shown again. A jump: farther than the world on screen moved
 * plus a third and 2 px, the world being the camera's points and the columns the labels stand on (the steady fold's
 * gaps open and close with the width zoom, the columns with them: a pinch at the mammals moves bats' columns twice as
 * far as any point under the camera, and their names, on them, with them), and the labels' top line.
 */
function judge(shots: Shot[], moved: number[], monotonic: boolean): string[] {
  const bad: string[] = [];
  const size = new Map<string, Spot>();
  const gone = new Set<string>();
  moved = moved.map((m, f) => {
    let c = m;
    for (const [k, s] of shots[f + 1]) {
      const p = shots[f].get(k);
      if (p && Number.isFinite(s.c - p.c)) c = Math.max(c, Math.abs(s.c - p.c));
    }
    return c;
  });
  for (let f = 0; f < shots.length; f++) {
    for (const [k, s] of shots[f]) {
      if (k.startsWith('pic ') && s.w !== PIC_D) bad.push(`frame ${f}: ${k} is ${s.w} px, not ${PIC_D}`);
      const s0 = size.get(k);
      if (!s0) size.set(k, s);
      else if (Math.abs(s0.w - s.w) > 1e-6 || Math.abs(s0.h - s.h) > 1e-6) bad.push(`frame ${f}: ${k} resized ${s0.w.toFixed(1)}x${s0.h.toFixed(1)} -> ${s.w.toFixed(1)}x${s.h.toFixed(1)}`);
      // (A picture is its name's, ToLaD#358: a run's label names its most populous clade, so a species' picture may go
      // to a richer sister's run and come back as its own clade splits off, Bos taurus at the mammals: Laurasiatheria,
      // then a run named Pteropodidae, then Hoofed mammals. Each species' label only narrows: onelabel.test.)
      if (monotonic && !k.startsWith('pic ') && gone.has(k) && !shots[f - 1].has(k)) bad.push(`frame ${f}: ${k} shown again after it went`);
      const p = f > 0 ? shots[f - 1].get(k) : undefined;
      if (p) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d > 1.35 * moved[f - 1] + 2) bad.push(`frame ${f}: ${k} jumped ${d.toFixed(1)} px (the world ${moved[f - 1].toFixed(1)})`);
      }
    }
    // (Only where no label is held under the top line: a held label's rows come down off the room over "now", where a
    // wide column has half its width, onto the branches, where it has all of it, so a thin sister's label stops fitting
    // beside it, at a zoom it does not fit at any more than where it comes back, zoomed further in, ToLaD#373.)
    if (f > 0 && !shots[f].held && !shots[f - 1].held) for (const k of shots[f - 1].keys()) if (!shots[f].has(k)) gone.add(k);
  }
  return bad;
}

const pinch = (n: number, z: number): Step[] => Array.from({ length: n }, () => (v: FanView) => v.zoom(v.w / 2, v.h / 2, z, z));
const pan = (n: number, dx: number, dy: number): Step[] => Array.from({ length: n }, () => (v: FanView) => v.pan(dx, dy));
/** A flight to level `name`, a frame each 16 ms, as the page runs it. */
function fly(v: FanView, name: string): Step[] {
  v.flyToLevel(name);
  const P = v as unknown as { anim: ((t: number) => boolean) | null };
  const steps: Step[] = [];
  let t = performance.now();
  for (let k = 0; k < 200; k++)
    steps.push(() => {
      if (P.anim && !P.anim((t += 16))) P.anim = null;
    });
  return steps;
}

const mammals = async () => {
  await loadMammalsFromFiles();
  return stubView(mammaliaClade(), mammaliaTree(), true);
};
const FANS: [string, () => Promise<FanView>, string][] = [
  ['cats', async () => stubView(FELIDAE as CladeRec, FELIDAE_TREE as Split, false), 'Pantherinae'],
  ['carnivores', async () => stubView(), 'Felidae'],
  ['mammals', mammals, 'Carnivora'],
];

describe('steady labels while the view moves (ToLaD#333)', () => {
  for (const [name, mk, to] of FANS) {
    it(`${name}: a pinch in, one way: sizes kept, no jumps, none back once gone`, { timeout: 300_000 }, async () => {
      const v = await mk();
      v.cam = v.homeCamera();
      v.gestureStart();
      const { shots, moved } = play(v, pinch(60, 1.04));
      v.gestureEnd();
      expect(shots[0].size).toBeGreaterThan(0);
      expect(judge(shots, moved, true)).toEqual([]);
    });
    it(`${name}: a pinch out, one way`, { timeout: 300_000 }, async () => {
      const v = await mk();
      const h = v.homeCamera();
      v.cam = { ...h, sx: h.sx * 8, sy: h.sy * 8 };
      v.gestureStart();
      const { shots, moved } = play(v, pinch(50, 1 / 1.04));
      v.gestureEnd();
      expect(judge(shots, moved, true)).toEqual([]);
    });
    it(`${name}: a pan one way, zoomed in`, { timeout: 300_000 }, async () => {
      const v = await mk();
      const h = v.homeCamera();
      v.cam = { ...h, sx: h.sx * 4, sy: h.sy * 4 };
      v.gestureStart();
      const { shots, moved } = play(v, [...pan(40, -8, 0), ...pan(30, 0, 6)]);
      v.gestureEnd();
      expect(judge(shots, moved, false)).toEqual([]);
      const one = play(v, pan(40, -8, 0));
      expect(judge(one.shots, one.moved, true)).toEqual([]);
    });
    it(`${name}: a flight to ${to}: sizes kept, no jumps`, { timeout: 300_000 }, async () => {
      const v = await mk();
      v.cam = v.homeCamera();
      const { shots, moved } = play(v, fly(v, to));
      expect(judge(shots, moved, false)).toEqual([]);
    });
  }
});
