// Steady labels (ToLaD#333, Ita 2026-11-01: "the pics and tags like move and change size and stuff when i move around
// the tree.. they shouldt"). Over a recorded gesture (a pinch, a pan, a flight) at the cats, the carnivores and the
// mammals: every name pill keeps its size, frame after frame; where a label stays
// shown it moves no farther than the world on screen does (a continuous function of the camera, no jumps); and within
// a pinch or a pan one way no label shows, hides, then shows again (each appears or goes at its own fit zoom, Been et
// al.'s active range). Every frame is laid out (no carry, no rest pass): the first frame has its labels.
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { PIC_D, PIC_ROOM, setLabelMode } from './pics';
import { setGapMode } from './fold';
import { FanView, groupCentre, type CutLabels, type Level } from './view';

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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
}

/** A label's place and size (screen), and the screen x of the columns it stands on (its anchor: groupCentre; NaN, a "+x"). */
type Spot = { x: number; y: number; w: number; h: number; c: number; run?: string };
type Shot = Map<string, Spot> & { held?: boolean };
/** Which group a label stands for: a species, or a clade by its strands. */
const groupId = (lv: Level): string => (lv.b ? `b${lv.b.index}` : `v${lv.v!.strands[0].index}/${lv.v!.strands.length}`);
/** A frame's labels: each name pill (by its item and text) and each picture (by what it opens), where and how big. */
function shot(v: FanView, c: CutLabels): Shot {
  const m: Shot = new Map();
  m.held = c.pics.some((p) => p.y + PIC_D / 2 - PIC_ROOM <= v.rowLast + 1e-6);
  const at = (x: number) => v.toScreen(x, 0)[0];
  for (const s of c.spots) {
    const g = s.v ? { v: s.v } : s.b ? { b: s.b } : null;
    m.set(`name ${s.key} ${s.text}`, { x: s.x, y: s.box[3], w: s.box[2] - s.box[0], h: s.box[3] - s.box[1], c: g ? at(groupCentre(g)) : NaN });
  }
  // (A picture is its face species', whichever item of the cut it stands for.)
  // (Under group labels the item is the group it stands for, ToLaD#440: a group's face is often its largest part's too, so
  // as the group splits the same picture goes on, for another group, at that group's place: Felis catus for 36 cats, then
  // for 8. Zooming changes the levels; judge() holds one group to the world.)
  for (const p of c.pics) m.set(`pic ${p.face.sp.sci}`, { x: p.x, y: p.y, w: PIC_D, h: PIC_D, c: at(groupCentre({ b: p.face })), run: p.run?.join() ?? groupId(p.lv) });
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
const HOLD_LEFT = 72 + PIC_ROOM / 2;
const HOLD_RIGHT = 390 - PIC_ROOM / 2;
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
        // (At the screen's edge, where an item's territory held its label on screen, ToLaD#373: as it splits or merges its
        // label goes to where the new item's territory has it, a picture or so past the hold; it used to vanish.)
        const atEdge = Math.min(p.x, s.x) <= HOLD_LEFT + 1e-6 || Math.max(p.x, s.x) >= HOLD_RIGHT - 1e-6;
        // (A "+x" stands at the middle of its item's branches, ToLaD#368: where the item splits or merges that is another
        // middle, so its label goes there. Within one item it moves as the world does.)
        const sameItem = p.run === s.run;
        if (sameItem && !atEdge && d > 1.35 * moved[f - 1] + 2) bad.push(`frame ${f}: ${k} jumped ${d.toFixed(1)} px, x ${p.x.toFixed(0)} to ${s.x.toFixed(0)} (the world ${moved[f - 1].toFixed(1)})`);
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
  // (Retired look, ToLaD#446: a cut label of one branch stands on it; a group's slides inside its branch's part on screen, ToLaD#440.)
  beforeEach(({ task }) => {
    if (!task.name.includes('a pan at one zoom')) return;
    setLabelMode('cut');
    setGapMode('groups');
  });
  afterEach(() => {
    setLabelMode('groups');
    setGapMode('clades');
  });
  // (Real, open, ToLaD#446: under group labels a neighbour giving way at the edge (ToLaD#440) moves a label by more than the
  // world, Shrews & kin 22.7 px in an 8 px pan at the mammals, and a label comes and goes inside the edge's margin. `it.fails` turns red when it is fixed.)
  const open = (name: string, what: 'pan' | 'across' | 'flight') => (what === 'across' || (what === 'pan' && name === 'mammals') ? it.fails : it);
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
    open(name, 'pan')(`${name}: a pan one way, zoomed in`, { timeout: 300_000 }, async () => {
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
    // (A pan at one zoom, ToLaD#373, Ita: "when sliding pics disappear suddenyl when they read the edge.. they should
    // not disappear.. leave them be": every label moves no further than the view, and comes and goes only wholly off screen.)
    if (name !== 'cats')
      open(name, 'across')(`${name}: a pan across: labels slide off the edge, none vanishes on screen`, { timeout: 300_000 }, async () => {
        const v = await mk();
        const h = v.homeCamera();
        const [z, dx] = name === 'mammals' ? [3, 12] : [3, 6];
        const sx = h.sx * z;
        const across = (v.w * z) / dx;
        const bad: string[] = [];
        let was: Map<string, number> | null = null;
        for (let k = 0; k <= across; k++) {
          v.cam = { ...h, sx, cx: h.cx - (v.w * (z - 1)) / 2 / sx + (k * dx) / sx };
          v.draw();
          const now = new Map(v.cutLast!.pics.map((p) => [p.face.sp.sci, p.x]));
          for (const [q, x] of now) {
            const p = was?.get(q);
            if (p === undefined) {
              if (was && x + PIC_ROOM / 2 > dx + 1e-6 && x - PIC_ROOM / 2 < v.w - dx - 1e-6) bad.push(`step ${k}: ${q} appeared at ${x.toFixed(1)}`);
            } else if (Math.abs(x - p) > dx + 1e-6) bad.push(`step ${k}: ${q} moved ${p.toFixed(1)} to ${x.toFixed(1)}, the view ${dx}`);
          }
          for (const [q, p] of was ?? []) if (!now.has(q) && p + PIC_ROOM / 2 > dx + 1e-6 && p - PIC_ROOM / 2 < v.w - dx - 1e-6) bad.push(`step ${k}: ${q} vanished from ${p.toFixed(1)}`);
          was = now;
        }
        expect(bad).toEqual([]);
      });
    // (A label of one branch, ToLaD#373, Ita: "it should just stay with its branch": exactly the pan, wherever it is on
    // screen, past the axis too. The first zoom, doubling, with a one-branch label around the dog.)
    if (name !== 'cats')
      it(`${name}: a pan at one zoom: a one-branch label moves exactly with it`, { timeout: 300_000 }, async () => {
        const v = await mk();
        const h = v.homeCamera();
        const dog = v.fan.branches.find((b) => b.sp.common === 'Domestic dog')!;
        const frame = (sx: number, dx: number) => {
          // (The fold first: the columns' places are the zoom's.)
          v.cam = { ...h, sx };
          v.draw();
          v.cam = { ...h, sx, cx: groupCentre({ b: dog }) - v.w / 2 / sx + dx / sx };
          v.draw();
          return new Map(v.cutLast!.spots.filter((s) => !s.over).map((s) => [s.key, s.x]));
        };
        let sx = h.sx;
        while (!frame(sx, 0).size && sx < h.sx * 2 ** 30) sx *= 2;
        expect(frame(sx, 0).size).toBeGreaterThan(0);
        const bad: string[] = [];
        let moved = 0;
        for (const dir of [1, -1]) {
          const dx = 7 * dir;
          let was = frame(sx, 0);
          for (let k = 1; k <= 60; k++) {
            const now = frame(sx, k * dx);
            for (const [q, x] of now) {
              const p = was.get(q);
              if (p === undefined) continue;
              moved++;
              if (Math.abs(x - (p - dx)) > 0.5) bad.push(`step ${k}: ${q} moved ${p.toFixed(1)} to ${x.toFixed(1)}, the pan ${-dx}`);
            }
            was = now;
          }
        }
        expect(moved).toBeGreaterThan(0);
        expect(bad).toEqual([]);
      });
    open(name, 'flight')(`${name}: a flight to ${to}: sizes kept, no jumps`, { timeout: 300_000 }, async () => {
      const v = await mk();
      v.cam = v.homeCamera();
      const { shots, moved } = play(v, fly(v, to));
      expect(judge(shots, moved, false)).toEqual([]);
    });
  }
});
