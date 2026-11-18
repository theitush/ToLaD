// One tap = one level deeper, a double-tap = one level out, one pill per group one level down (ToLaD#258).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setGapMode } from './fold';
import { setLabelMode } from './pics';
import { forkNames } from './brackets';
import { laneAt, layoutFan, leftAt, type FanBranch, type FanNode } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView, groupFace, holds, isLevel, levelName, levelUp, nextLevels, type Level } from './view';
import type { Camera } from './camera';

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

type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  frameOf(lv: Level): Camera;
  offBy(a: Camera, c: Camera): number;
  zoomsOut(a: Camera, c: Camera): boolean;
  upOne(lv: Level, c: Camera): { lv: Level; cam: Camera } | null;
  landOf(lv: Level): Camera;
  tapAt: unknown;
};
const P = (v: FanView) => v as unknown as Priv;
/** Whether the view is at home's frame (within 4 px and 2 %). */
function atHome(v: FanView): boolean {
  const c = v.cam;
  const h = v.homeCamera();
  return Math.abs(c.cx - h.cx) * c.sx <= 4 && Math.abs(c.cy - h.cy) * c.sy <= 4 && Math.abs(Math.log(c.sx / h.sx)) <= 0.02 && Math.abs(Math.log(c.sy / h.sy)) <= 0.02;
}
/** view.ts's LEVEL_PX: a level whose frame is nearer the view than this is passed. */
const LEVEL_PX = 12;
/** The levels a level sits in (levelUp's tree, ToLaD#258), nearest first, home's root last. */
function upChain(v: FanView, from: Level): FanNode[] {
  const out: FanNode[] = [];
  for (let u = from.b ? levelUp(v.fan, from.b.node, true) : levelUp(v.fan, from.v); u; u = levelUp(v.fan, u)) out.push(u);
  return out;
}
/**
 * Where a double tap (or the stack's "…") from `from` should go, the view where it is (ToLaD#472): one level up, the level it sits in; at home's level
 * off home, home. Null where that would zoom in (ToLaD#416: tighter than the view on width or time; home, the last resort, while wider on width) or at home.
 */
function wantUp(v: FanView, from: Level): FanNode | null {
  // (From a species at its landing, its group whatever its landing does, ToLaD#481: the human's search pick, Homo's.)
  if (from.b && P(v).offBy(P(v).landOf(from), v.cam) <= LEVEL_PX) return v.levelAbove(from);
  // (Elsewhere, where one up would zoom in, the nearest level up that zooms out, ToLaD#416.)
  for (let at = from; ; ) {
    const u = v.levelAbove(at) ?? (atHome(v) ? null : v.fan.root);
    if (!u) return null;
    const f = P(v).landOf({ v: u });
    const [x, y] = [v.w * (f.sx / v.cam.sx - 1), v.h * (f.sy / v.cam.sy - 1)];
    if (x <= LEVEL_PX && y <= LEVEL_PX) return u;
    if (u === v.fan.root) return x < -LEVEL_PX ? u : null;
    at = { v: u };
  }
}
/** Whether the view stands at level lv's frame (within 2 px). */
const atFrame = (v: FanView, lv: Level) => P(v).offBy(P(v).frameOf(lv), v.cam) <= 2;

/** Run the flight under way to its landing, a frame each 16 ms (the fold at each frame's zoom), then draw settled. */
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
  settle(v);
}
function settle(v: FanView): void {
  // (A first draw lays the "+x" rooms out for this frame: run() flies without drawing, so they are the take-off's.
  // Without it a name moved by its new room restarts its fade and is checked half there, ToLaD#273.)
  v.draw();
  for (let k = 0; k < 3; k++) v.draw();
}
function home(v: FanView): void {
  v.cam = v.homeCamera();
  v.camera.settle();
  P(v).applyFold();
  settle(v);
}
const nameOf = (lv: Level) => (lv.b ? lv.b.sp.common : levelName(lv.v));
/** A point on b's column, above its split, clear of every label; null where a label covers all of it (a tap there is the label's). */
function onColumn(v: FanView, b: FanBranch): [number, number] | null {
  // (Off the names and pictures, ToLaD#262: a name may stand over a neighbour's column; a tap there is the name's. A fork's
  // name too (ToLaD#373): with every fossil a fossil's column, a hair across, can run its whole length under a fork's name, and
  // there is no column to tap.)
  const iv = v as unknown as { pillAt(x: number, y: number): unknown; picAt(x: number, y: number): unknown; brackets: { hit(x: number, y: number): unknown } | null };
  for (const f of [0.4, 0.5, 0.6, 0.7, 0.3, 0.8, 0.2, 0.9, 0.1]) {
    const y = b.tipY + f * (b.splitY - b.tipY);
    const p = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y);
    if (!iv.pillAt(...p) && !iv.picAt(...p) && !(forkNames() && iv.brackets?.hit(...p))) return p;
  }
  return null;
}

/** The fans: the folded carnivores and the cats. */
const FANS = [
  ['carnivores (folded)', () => stubView()],
  ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
] as const;

describe("a group's picture is its most-populous living species, photo or not (ToLaD#258, #358; no photo: a relative's on its disc, or the stub, #400)", () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      for (const u of v.fan.nodes) {
        const face = groupFace(u);
        const alive = u.strands.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0);
        const most = Math.max(...alive.map((b) => b.pop.aliveAt(0)));
        if (!alive.length ? face !== null : !face || !alive.includes(face) || face.pop.aliveAt(0) < most) bad.push(`${u.name}: ${face?.sp.common}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('a tap goes one level deeper, a double-tap one level out (ToLaD#258)', () => {
  for (const [name, mk] of FANS) {
    it(`${name}: a column, tapped again and again from home, then double-tapped home`, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      const log: string[] = [];
      // (Folded, a flight frame by frame takes seconds: a few of the carnivores, more of the cats.)
      const bs = v.fan.branches.filter((_, i) => i % (v.fan.tess.fold ? 61 : 7) === 3);
      let reached = 0;
      for (const b of bs) {
        home(v);
        card = null;
        let covered = false;
        const path: Level[] = [v.levelNow()];
        // (The frames the taps left, and their levels: a tap that opened a card where the view stood is no step, ToLaD#376.)
        const frames = [{ cam: { ...v.cam }, lv: path[0] }];
        // One tap at a time: each flies one level deeper, towards b, to b itself at last.
        for (let k = 0; k < 12 && !path[path.length - 1].b; k++) {
          const p = onColumn(v, b);
          if (!p) {
            covered = true;
            break;
          }
          v.tap(...p);
          if (!P(v).anim) {
            log.push(`${b.sp.common}: tap ${k + 1} flew nowhere (at ${nameOf(path[path.length - 1])})`);
            break;
          }
          run(v);
          const now = v.levelNow();
          const prev = path[path.length - 1];
          if (!holds(prev, now) || (now.v && now.v === prev.v) || !holds(now, { b })) log.push(`${b.sp.common}: tap ${k + 1} went to ${nameOf(now)} from ${nameOf(prev)}`);
          // (No card on the way; landing on the species, its card open, ToLaD#266.)
          if (now.b ? card !== now.b.sp.common : card) log.push(`${b.sp.common}: tap ${k + 1} landed at ${nameOf(now)}, the card: ${card}`);
          path.push(now);
          if (P(v).offBy(frames[frames.length - 1].cam, v.cam) > LEVEL_PX) frames.push({ cam: { ...v.cam }, lv: now });
        }
        if (path[path.length - 1].b !== b) {
          // (No column left to tap, a label over all of it: the walk ends there, no tap rule broken.)
          if (!covered) log.push(`${b.sp.common}: ended at ${nameOf(path[path.length - 1])}`);
          continue;
        }
        reached++;
        // At it: a tap keeps its card, no flight.
        const p = onColumn(v, b);
        if (p) v.tap(...p);
        if (P(v).anim || card !== b.sp.common) log.push(`${b.sp.common}: at it, a tap: card ${card}${P(v).anim ? ', and a flight' : ''}`);
        // Double-taps: each one level up (ToLaD#472), on its frame, home at last; at home, nothing. The first closes the card.
        for (let k = 0; k < 12 && !atHome(v); k++) {
          const prev = v.levelNow(true);
          const want = wantUp(v, prev);
          v.doubleTap(-1e4, -1e4);
          if (k === 0 && card) log.push(`${b.sp.common}: a double-tap out left its card open`);
          if (!P(v).anim) {
            log.push(`${b.sp.common}: double-tap did nothing at ${nameOf(prev)}`);
            break;
          }
          run(v);
          const now = v.levelNow();
          if (now.v !== want || !atFrame(v, now)) log.push(`${b.sp.common}: double-tap went to ${nameOf(now)} from ${nameOf(prev)}, not ${want ? levelName(want) : 'nowhere'}`);
        }
        void frames;
        v.doubleTap(-1e4, -1e4);
        if (P(v).anim) log.push(`${b.sp.common}: a double-tap at home flew`);
        if (!atHome(v)) log.push(`${b.sp.common}: double-taps ended away from home`);
      }
      expect(log).toEqual([]);
      expect(reached).toBeGreaterThan(0);
    });

    it(`${name}: each group's pill at home flies one level deeper towards that group; a double-tap, home`, () => {
      const v = mk();
      home(v);
      const pills = v.famHits.map((h) => h.v);
      expect(pills.length).toBeGreaterThan(0);
      for (const g of pills) {
        home(v);
        const h = v.famHits.find((q) => q.v === g)!;
        // (On its name: a "+x" badge at its top end is a tap of its own, ToLaD#262.)
        const badge = (v as unknown as { plusHits: { badge: number[] }[] }).plusHits.find((q) => q.badge[0] === h.box[0] && q.badge[1] === h.box[1]);
        const y0 = badge ? badge.badge[3] + 6 : h.box[1];
        v.tap((h.box[0] + h.box[2]) / 2, (y0 + h.box[3]) / 2);
        expect(!!P(v).anim).toBe(true);
        run(v);
        // (That group, or where its frame is the view's, on into it; a deeper group's name, as the cut shows them at
        // home (the bears' in the carnivores, ToLaD#333): the next level on its way, one tap one level, ToLaD#258.)
        const now = v.levelNow();
        // (An item with sisters riding on it that meet only at the root, as "Lynxes +29" in the cats: the root's level,
        // framed in, the tapped label given way to finer ones: never a mere zoom-in.)
        const inside = (v.cutLast?.spots ?? []).filter((s) => s.run && h.run && s.run[0] >= h.run[0] && s.run[1] <= h.run[1]);
        const finer = inside.length >= 2 && !inside.some((s) => s.run![0] === h.run![0] && s.run![1] === h.run![1]);
        const into = now.v === v.fan.root ? v.cam.sx > v.homeCamera().sx * 1.01 && finer : !!now.v;
        expect(holds({ v: g }, now) || (into && holds(now, { v: g }))).toBe(true);
        // (Double taps one level up each (ToLaD#472): a pill that went past a level the chain names comes home in more than one.)
        for (let k = 0; k < 6 && !atHome(v); k++) {
          const want = wantUp(v, v.levelNow(true));
          v.doubleTap(-1e4, -1e4);
          run(v);
          expect(v.levelNow(true).v).toBe(want);
        }
        expect(atHome(v)).toBe(true);
      }
    });
  }
});

describe('mammal home opens on the orders (ToLaD#258, #256)', () => {
  it('the groups one level down from the root are the orders, named in English', async () => {
    // (The page fetches mammals.json; here it is built from the files the same way.)
    await loadMammalsFromFiles();
    const fan = layoutFan(mammaliaClade(), 'log', mammaliaTree());
    const groups = nextLevels(fan, fan.root);
    const names = groups.map((g) => (g.b ? g.b.sp.common : levelName(g.v)));
    console.log(`mammal home: ${groups.length} groups: ${names.join(', ')}`);
    for (const o of ['Rodents', 'Bats', 'Carnivores', 'Primates', 'Shrews & moles', 'Hoofed mammals & whales']) expect(names).toContain(o);
    // Every group is an order (or a family or species standing for one): none above an order.
    for (const g of groups) if (g.v) expect(isLevel(fan, g.v)).toBe(true);
    // (47 today: the armadillos and bandicoots the tree does not join under their order's split stand on their own, ToLaD#256.)
    expect(groups.length).toBeLessThan(60);
  }, 120000);
});

/** The span (screen x) of species bs's columns at "now" (the living ones'; an extinct one's at its tip), as groupCentre's. */
function nowExtent(v: FanView, all: readonly FanBranch[]): [number, number] {
  const alive = all.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of alive.length ? alive : all) {
    const y = Math.max(b.tipY, v.fan.time.y(0));
    lo = Math.min(lo, v.toScreen(leftAt(b, y), 0)[0]);
    hi = Math.max(hi, v.toScreen(leftAt(b, y) + laneAt(b, y).w, 0)[0]);
  }
  return [lo, hi];
}

/** At home and at each level a tap reaches on the way from home to a few species (each landed), `at`. */
function levelsOnTheWay(v: FanView, step: number, at: (v: FanView) => void): void {
  for (const b of v.fan.branches.filter((_, i) => i % step === 3)) {
    home(v);
    at(v);
    for (let k = 0; k < 8 && !v.levelNow().b; k++) {
      const p = onColumn(v, b);
      if (!p) break;
      v.tap(...p);
      if (!P(v).anim) break;
      run(v);
      at(v);
    }
  }
}

describe('a level of two or three groups is framed in the labels\' width (ToLaD#262, #359)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      let seen = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const lv = v.levelNow();
        if (lv.b || !lv.v.parent || nextLevels(v.fan, lv.v).length > 3) return;
        seen++;
        // Its columns at "now" inside the room levels are framed in (ToLaD#333: the labels' width, LABEL_AXIS_X to the
        // screen's edge, as cutframe.test). (Since ToLaD#359's one frame a level's
        // frame is its territory filling that room, not its columns at "now" centred in the middle 70 % (FEW_FILL's, deleted): a
        // territory, rooms by life at every time, need not be centred on the living columns (the cats 16 px, big cats 20).)
        const [lo, hi] = nowExtent(v, lv.v.strands);
        if (lo < 72 - 0.5 || hi > v.w + 0.5) bad.push(`${nameOf(lv)}: its columns at ${lo.toFixed(0)}..${hi.toFixed(0)} px`);
      });
      expect(bad).toEqual([]);
      expect(seen).toBeGreaterThan(0);
    });
  }
});

describe("the groups' names beside their branch: none meet, each within its branch's run (ToLaD#262, #266, #342)", () => {
  for (const [name, mk] of FANS) {
    {
      it(name, () => {
        const v = mk();
        const bad: string[] = [];
        let shown = 0;
        levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
          const at = nameOf(v.levelNow());
          const nowS = v.toScreen(0, v.fan.time.y(0))[1];
          const hits: { box: [number, number, number, number]; lv: Level }[] = [...v.famHits.map((h) => ({ box: h.box, lv: { v: h.v } as Level })), ...v.nameHits.map((h) => ({ box: h.box, lv: { b: h.b } as Level }))];
          shown += hits.length;
          for (let i = 0; i < hits.length; i++)
            for (let j = i + 1; j < hits.length; j++) {
              const [p, q] = [hits[i].box, hits[j].box];
              if (p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]) bad.push(`${at}: ${nameOf(hits[i].lv)} meets ${nameOf(hits[j].lv)}`);
            }
          // Over its branch's run: above where it splits off, as far as the screen shows, standing on its tip (ToLaD#373). A group's tip its youngest: "now", or a fossil group's
          // youngest fossil's end (ToLaD#279: Desmatophocidae, framed on its own time, "now" 4,000 px over the screen).
          for (const h of hits) {
            const y0 = v.fan.time.y(0);
            const wTop = h.lv.b ? Math.max(h.lv.b.tipY, y0) : h.lv.v.strands.reduce((y, b) => Math.min(y, Math.max(b.tipY, y0)), Infinity);
            const wBot = h.lv.b ? h.lv.b.splitY : h.lv.v.yBot;
            const y = (h.box[1] + h.box[3]) / 2;
            if (h.box[3] > Math.max(nowS, v.toScreen(0, wTop)[1]) + 1 || y > v.toScreen(0, wBot)[1] + 1) bad.push(`${at}: ${nameOf(h.lv)}'s name off its branch's run (${y.toFixed(0)})`);
          }
        });
        expect(bad).toEqual([]);
        expect(shown).toBeGreaterThan(0);
      });
    }
  }
});

describe('a double tap goes up to the parent level, never back (ToLaD#271, #472)', () => {
  // (Retired look, ToLaD#446: a "+x", pinned to the old modes; the app is `groups` and `clades`, ToLaD#439.)
  beforeEach(({ task }) => {
    if (!task.name.includes('after a "+x"')) return;
    setLabelMode('cut');
    setGapMode('groups');
  });
  afterEach(() => {
    setLabelMode('groups');
    setGapMode('clades');
  });
  for (const [name, mk] of FANS) {
    it(`${name}: from every level tapped down to from home, after a pinch, exactly the level it sits in`, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      const bad: string[] = [];
      let n = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const cam = { ...v.cam };
        const tapAt = P(v).tapAt;
        // (A real pinch, in a hair.)
        v.gestureStart();
        v.zoom(v.w / 2, v.h / 2, 1.001, 1.001);
        v.gestureEnd();
        settle(v);
        const from = v.levelNow(true);
        const want = wantUp(v, from);
        v.doubleTap(-1e4, -1e4);
        if (card) bad.push(`${nameOf(from)}: the card left open`);
        if (!want) {
          if (P(v).anim) bad.push(`${nameOf(from)}: flew with nowhere out`);
          v.cam = cam;
          v.camera.settle();
          P(v).applyFold();
          P(v).tapAt = tapAt;
          settle(v);
          return;
        }
        run(v);
        n++;
        const now = v.levelNow();
        if (now.v !== want || !atFrame(v, now)) bad.push(`${nameOf(from)}: went to ${nameOf(now)}, not ${levelName(want)}`);
        // (Back where it was, to tap on down.)
        v.cam = cam;
        v.camera.settle();
        P(v).applyFold();
        P(v).tapAt = tapAt;
        settle(v);
      });
      expect(bad).toEqual([]);
      // (Steady widths, ToLaD#259: the cats' taps from home pass fewer levels.)
      expect(n).toBeGreaterThan(1);
      // (Folded, with every fossil (the page's default, ToLaD#279), its taps and flights take ~2-3 minutes.)
    }, 300_000);

    it(`${name}: after a search pick, the species' own level, not home; double taps on reach home and stop`, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      const bad: string[] = [];
      for (const b of v.fan.branches.filter((_, i) => i % (v.fan.tess.fold ? 97 : 11) === 5)) {
        home(v);
        v.flyToSpecies(b.sp);
        run(v);
        const want = wantUp(v, { b });
        v.doubleTap(-1e4, -1e4);
        if (card) bad.push(`${b.sp.common}: the card left open`);
        run(v);
        const now = v.levelNow();
        if (!want || now.v !== want || !atFrame(v, now)) bad.push(`${b.sp.common}: went to ${nameOf(now)}, not ${want ? levelName(want) : 'nowhere'}`);
        // (Its own level: the nearest one it sits in, unless that one's frame does not zoom out from the species'.)
        const first = upChain(v, { b })[0];
        if (want !== first && P(v).zoomsOut(P(v).frameOf({ v: first }), P(v).frameOf({ b }))) bad.push(`${b.sp.common}: skipped ${levelName(first)}`);
        // On up: each a level higher, home at last, then nothing.
        let k = 0;
        for (; k < 12; k++) {
          const prev = v.levelNow(true);
          const up = wantUp(v, prev);
          v.doubleTap(-1e4, -1e4);
          if (!P(v).anim) break;
          run(v);
          if (v.levelNow().v !== up) bad.push(`${b.sp.common}: from ${nameOf(prev)} went to ${nameOf(v.levelNow())}`);
        }
        if (k === 12 || (!atHome(v) && wantUp(v, v.levelNow(true)))) bad.push(`${b.sp.common}: double taps stopped away from home`);
      }
      expect(bad).toEqual([]);
    });

    // (A "+x" is a tap like any (ToLaD#359): a double tap goes one level up from where it landed (ToLaD#472), never in (ToLaD#416).)
    it(`${name}: after a "+x", one level up from where it landed`, () => {
      const v = mk();
      const bad: string[] = [];
      let tried = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        // (One of several species where there is one; else one species', a landing on it, ToLaD#266.)
        const h = v.plusHits.find((q) => q.bs.length > 1) ?? v.plusHits[0];
        if (!h || tried > 3) return;
        tried++;
        const at = nameOf(v.levelNow());
        const cam = { ...v.cam };
        v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
        run(v);
        const inside = { ...v.cam };
        const from = v.levelNow(true);
        const want = wantUp(v, from);
        v.doubleTap(-1e4, -1e4);
        run(v);
        if (want ? v.levelNow(true).v !== want : P(v).offBy(inside, v.cam) > 0.5) bad.push(`${at}: a "+x" of ${h.bs.length} to ${nameOf(from)}, then a double tap went to ${nameOf(v.levelNow())}, not ${want ? levelName(want) : 'nowhere'}`);
        const [x, y] = [v.w * (v.cam.sx / inside.sx - 1), v.h * (v.cam.sy / inside.sy - 1)];
        if ((x > LEVEL_PX || y > LEVEL_PX) && !atHome(v)) bad.push(`${at}: a "+x" then a double tap zoomed in`);
        v.cam = cam;
        v.camera.settle();
        P(v).applyFold();
        settle(v);
      });
      expect(bad).toEqual([]);
      expect(tried).toBeGreaterThan(0);
      // (Folded, with every fossil (the page's default, ToLaD#279), its taps and flights take ~2-3 minutes.)
    }, 300_000);
  }
});

/** Run the flight under way n frames of 16 ms (not to its landing). */
function fly(v: FanView, n: number): void {
  const iv = P(v);
  for (let t = performance.now() + 16, k = 0; iv.anim && k < n; t += 16, k++) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}
/** The brackets' stack's innermost row as the view now draws it (stackAt of levelNow, ToLaD#288). */
const stackTop = (v: FanView) => (v as unknown as { brackets: { atKey: { up: FanNode[] } | null } | null }).brackets?.atKey?.up[0] ?? null;
const backing = (v: FanView) => (v as unknown as { backing: { lv: Level; cam: Camera } | null }).backing;

describe('a double tap goes up one level on every route, never back (ToLaD#301, #472)', () => {
  /**
   * A double tap from where the view is (`how`: landed; mid-flight, its touch coming down while a tap's flight is under
   * way; or its first tap already run as a single tap, the double-tap window's timer first): one level up (ToLaD#472), the
   * parent of the level the view was at (first tap run: before that tap), or that the flight lands on, and the stack shows it.
   * The view put back.
   */
  const check = (v: FanView, label: string, bad: string[], how: 'landed' | 'mid' | 'ran', tapTo?: [number, number]) => {
    const cam = { ...v.cam };
    const tapAt = P(v).tapAt;
    let from = v.levelNow(true);
    let want = wantUp(v, from);
    if (how !== 'landed') {
      if (!tapTo) return;
      v.tap(...tapTo);
      if (!P(v).anim) return;
      if (how === 'mid') {
        // (Its flight a few frames along, then the double tap's touch: down, a little jitter, up.)
        const to = backing(v)!;
        from = to.lv;
        const at = v.cam;
        v.cam = to.cam;
        want = wantUp(v, from);
        v.cam = at;
        fly(v, 5);
        v.gestureStart();
        v.pan(2, -1);
        v.gestureEnd();
      } else fly(v, 2);
    }
    v.doubleTap(-1e4, -1e4, how === 'ran');
    run(v);
    const now = v.levelNow(true);
    if (want ? now.v !== want || !atFrame(v, now) : !atFrame(v, from)) bad.push(`${label} (${how}): from ${nameOf(from)} went to ${nameOf(now)}, not ${want ? levelName(want) : 'nowhere'}`);
    if (want && stackTop(v) !== want) bad.push(`${label} (${how}): the stack shows ${stackTop(v) ? levelName(stackTop(v)!) : 'nothing'}, not ${levelName(want)}`);
    v.cam = cam;
    v.camera.settle();
    P(v).applyFold();
    P(v).tapAt = tapAt;
    settle(v);
  };
  /** Down each target's column tap by tap from home, every route checked at each level; then a search pick of it, double taps up to home. */
  const walk = (v: FanView, targets: FanBranch[], bad: string[], down = true) => {
    for (const b of targets) {
      const name = b.sp.common || b.sp.sci;
      home(v);
      for (let k = 0; down && k < 10; k++) {
        const lv = v.levelNow(true);
        const p = onColumn(v, b);
        for (const how of ['landed', 'mid', 'ran'] as const) check(v, `${name} at ${nameOf(lv)}`, bad, how, p ?? undefined);
        if (lv.b || !p) break;
        v.tap(...p);
        if (!P(v).anim) break;
        run(v);
      }
      home(v);
      v.flyToSpecies(b.sp);
      run(v);
      for (let k = 0; k < 12; k++) {
        const from = v.levelNow(true);
        const want = wantUp(v, from);
        v.doubleTap(-1e4, -1e4);
        if (!want) break;
        run(v);
        const now = v.levelNow(true);
        if (now.v !== want) bad.push(`${name} (search): from ${nameOf(from)} went to ${nameOf(now)}, not ${levelName(want)}`);
        if (stackTop(v) !== want) bad.push(`${name} (search): the stack shows ${stackTop(v) ? levelName(stackTop(v)!) : 'nothing'}, not ${levelName(want)}`);
      }
      if (!atHome(v)) bad.push(`${name} (search): double taps stopped away from home`);
    }
  };
  for (const [name, mk] of FANS) {
    it(`${name}: tapped down, from each level landed, mid-flight and with the first tap run; a search pick`, () => {
      const v = mk();
      const bad: string[] = [];
      const bs = v.fan.branches;
      walk(v, [bs[4], bs[Math.floor(bs.length / 2)], bs[bs.length - 3]], bad);
      expect(bad).toEqual([]);
    });
  }

  it('carnivores: after a pinch into a level, up from it, not back to its frame', () => {
    const v = stubView();
    const bad: string[] = [];
    let n = 0;
    levelsOnTheWay(v, Math.ceil(v.fan.branches.length / 3), (v) => {
      const lv = v.levelNow(true);
      if (lv.b) return;
      const cam = { ...v.cam };
      v.gestureStart();
      v.zoom(v.w / 2, v.h / 2, 1.8, 1.4);
      v.gestureEnd();
      settle(v);
      n++;
      check(v, `${nameOf(lv)} pinched`, bad, 'landed');
      v.cam = cam;
      v.camera.settle();
      P(v).applyFold();
      settle(v);
    });
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(3);
  });

  it("at home, a double tap whose first tap ran puts that tap's flight back: home", () => {
    const v = stubView(FELIDAE, FELIDAE_TREE, false);
    home(v);
    v.tap(...onColumn(v, v.fan.branches[7])!);
    expect(!!P(v).anim).toBe(true);
    fly(v, 3);
    v.doubleTap(-1e4, -1e4, true);
    run(v);
    expect(atHome(v)).toBe(true);
  });

  it('mammals: down to the humans (Hominini, Homo), the chimpanzee and the polar bear, and a search pick of each', async () => {
    await loadMammalsFromFiles();
    const v = stubView(mammaliaClade(), mammaliaTree(), false);
    const bad: string[] = [];
    const targets = ['Homo sapiens', 'Pan troglodytes', 'Ursus maritimus'].map((s) => v.fan.branches.find((b) => b.sp.sci === s)!).filter(Boolean);
    expect(targets.length).toBe(3);
    walk(v, targets.slice(0, 1), bad);
    walk(v, targets.slice(1), bad, false);
    expect(bad).toEqual([]);
  }, 300000);
});

describe('a double tap after taps, pans, a "…": one level up each, home at last (ToLaD#376, #472)', () => {
  type Frame = { cam: Camera; lv: Level };
  const frameNow = (v: FanView): Frame => ({ cam: { ...v.cam }, lv: v.levelNow(true) });
  /** The label of the most species on screen, its run: the route that stays longest above the species. */
  const widest = (v: FanView) => {
    settle(v);
    const on = v.cutLast!.spots.filter((s) => s.v && s.v.strands.length > 1 && s.box[1] >= 0 && s.box[3] <= v.h);
    return on.length ? on.reduce((p, q) => (q.v!.strands.length > p.v!.strands.length ? q : p)) : null;
  };
  const tapSpot = (v: FanView, box: readonly number[]) => v.tap((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  /** `n` taps down through labels, landed: the frame before each, and each tap's label. */
  const down = (v: FanView, n: number, frames: Frame[]): void => {
    for (let k = 0; k < n; k++) {
      const s = widest(v);
      expect(s, `a label to tap after ${k} taps`).toBeTruthy();
      frames.push(frameNow(v));
      const was = { ...v.cam };
      const lv = v.levelNow(true);
      tapSpot(v, s!.box);
      expect(!!P(v).anim, `tap ${k + 1} flew`).toBe(true);
      run(v);
      // (One level deeper (ToLaD#258), never out (ToLaD#352, #446): a level inside the last, the view tighter on width and time
      // together. A species' frame can be wider on width than its group's and tighter in time: the domestic dog's in Canini's,
      // where with every fossil the one label on screen, "Carnivores", walks down to it.)
      const now = v.levelNow(true);
      expect(holds(lv, now) && (now.v ?? now.b) !== (lv.v ?? lv.b), `tap ${k + 1} went a level deeper: ${nameOf(lv)} to ${nameOf(now)}`).toBe(true);
      expect(Math.log(v.cam.sx / was.sx) + Math.log(v.cam.sy / was.sy), `tap ${k + 1} went deeper`).toBeGreaterThan(0);
    }
  };
  const pan = (v: FanView, dx: number) => {
    v.gestureStart();
    v.pan(dx, 0);
    v.gestureEnd();
    settle(v);
  };
  /** Double taps until home: each one level up from the level on screen (ToLaD#472), on that level's frame to under a pixel. */
  const up = (v: FanView, bad: string[]) => {
    for (let i = 0; i < 12 && !atHome(v); i++) {
      const from = v.levelNow(true);
      const want = wantUp(v, from);
      v.doubleTap(-1e4, -1e4);
      run(v);
      const now = v.levelNow(true);
      if (now.v !== want) bad.push(`from ${nameOf(from)}: at ${nameOf(now)}, not ${want ? levelName(want) : 'nowhere'}`);
      else if (!atFrame(v, now)) bad.push(`from ${nameOf(from)}: ${P(v).offBy(P(v).frameOf(now), v.cam).toFixed(2)} px off ${nameOf(now)}'s frame`);
      if (!want) break;
    }
  };
  const ROUTES: [string, () => FanView][] = [
    ['carnivores', () => stubView()],
    ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
  ];
  for (const [name, mk] of ROUTES) {
    it(`${name}: four taps down through labels, then double taps one level up each, home at last`, () => {
      const v = mk();
      home(v);
      const frames: Frame[] = [];
      down(v, 4, frames);
      const bad: string[] = [];
      up(v, bad);
      expect(bad).toEqual([]);
      expect(atHome(v)).toBe(true);
      // (At home: nothing.)
      v.doubleTap(-1e4, -1e4);
      expect(!!P(v).anim).toBe(false);
    });

    it(`${name}: a sideways pan in the middle, and one before the first double tap: one level up from the level on screen each`, () => {
      const v = mk();
      home(v);
      const frames: Frame[] = [];
      down(v, 2, frames);
      pan(v, 40);
      down(v, 2, frames);
      pan(v, -40);
      const bad: string[] = [];
      up(v, bad);
      expect(bad).toEqual([]);
      expect(atHome(v)).toBe(true);
    });

    it(`${name}: mid-flight, each double tap goes one level up from where its flight lands; with its first tap run, from where that tap found the view`, () => {
      const v = mk();
      home(v);
      down(v, 3, []);
      // (Its first tap run, its flight under way: that tap undone, and one level up from where it found the view.)
      const at = v.levelNow(true);
      const want = v.levelAbove(at)!;
      const s = widest(v)!;
      tapSpot(v, s.box);
      fly(v, 2);
      v.doubleTap(-1e4, -1e4, true);
      expect(nameOf(backing(v)!.lv)).toBe(levelName(want));
      // (More, each a few frames into the last's flight: one level up from where it lands, home at last.)
      for (let k = 0; k < 12 && backing(v); k++) {
        const to = backing(v)!.lv;
        if (to.v === v.fan.root) break;
        fly(v, 5);
        v.doubleTap(-1e4, -1e4);
        if (!backing(v)) break;
        expect(backing(v)!.lv.v, `from ${nameOf(to)}`).toBe(v.levelAbove(to));
      }
      run(v);
      expect(atHome(v)).toBe(true);
    });

    // (The cats' stack is never deep enough for a "…".)
    it.runIf(name === 'carnivores' && !forkNames())(`${name}: the stack's "…" is a tap: tap, tap, "…" lands one named level up, then double taps one level up each, home at last`, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      /** A point on the "…" this frame, if there is one. */
      const moreAt = (): [number, number] | null => {
        const br = (v as unknown as { brackets: { x0: number; moreHit(x: number, y: number): boolean } | null }).brackets;
        if (!br) return null;
        const x = br.x0 + 8;
        for (let y = 0; y < v.h; y++) if (br.moreHit(x, y)) return [x, y];
        return null;
      };
      let checked = 0;
      for (const b of v.fan.branches) {
        // (A few routes are enough: each a walk down and back.)
        if (checked >= 3) break;
        home(v);
        const frames: Frame[] = [];
        // Tapped down its column, each tap a step, to the first frame with a "…" at least two taps in.
        for (let k = 0; k < 12 && !(frames.length >= 2 && moreAt()); k++) {
          const before = frameNow(v);
          const p = onColumn(v, b);
          if (!p) break;
          v.tap(...p);
          if (!P(v).anim) break;
          frames.push(before);
          run(v);
        }
        const more = frames.length >= 2 ? moreAt() : null;
        if (!more) continue;
        checked++;
        const start = frameNow(v);
        const want = wantUp(v, start.lv);
        expect(want, `${b.sp.common}: a level over ${nameOf(start.lv)}`).toBeTruthy();
        v.tap(...more);
        expect(card, `${b.sp.common}: "…" left the card open`).toBe(null);
        run(v);
        expect(nameOf(v.levelNow(true)), `${b.sp.common}: "…" from ${nameOf(start.lv)}`).toBe(levelName(want!));
        expect(atFrame(v, { v: want! }), `${b.sp.common}: at ${levelName(want!)}'s frame`).toBe(true);
        const bad: string[] = [];
        up(v, bad);
        expect(bad, b.sp.common).toEqual([]);
        expect(atHome(v), `${b.sp.common}: home at last`).toBe(true);
      }
      expect(checked, 'a stack with a "…" on some route').toBeGreaterThan(0);
    });

    it(`${name}: after a pinch or a search pick, one level up from there`, () => {
      const v = mk();
      home(v);
      down(v, 3, []);
      v.gestureStart();
      v.zoom(v.w / 2, v.h / 2, 1.3, 1.2);
      v.gestureEnd();
      settle(v);
      const want = wantUp(v, v.levelNow(true));
      v.doubleTap(-1e4, -1e4);
      run(v);
      expect(v.levelNow(true).v).toBe(want);
      home(v);
      down(v, 2, []);
      const b = v.fan.branches[3];
      v.flyToSpecies(b.sp);
      run(v);
      const above = wantUp(v, { b });
      v.doubleTap(-1e4, -1e4);
      run(v);
      expect(v.levelNow(true).v).toBe(above);
    });
  }
});

describe('a tap landing on a species opens its card; a search pick too (ToLaD#266)', () => {
  it('the cats: a search pick, then a species picture or name tapped at its level', () => {
    const v = stubView(FELIDAE, FELIDAE_TREE, false);
    let card: string | null = null;
    v.onSelect = (s) => void (card = s ? s.sp.common : null);
    home(v);
    const sp = v.fan.branches[5];
    v.flyToSpecies(sp.sp);
    expect(card).toBe(null);
    run(v);
    expect(card).toBe(sp.sp.common);
    // A double tap out closes it.
    v.doubleTap(-1e4, -1e4);
    expect(card).toBe(null);
    run(v);
    // Its level: a species among its groups, its picture (or name) tapped lands there, the card open.
    expect(v.levelNow().v).toBeTruthy();
    const one = v.picSpots.find((p) => p.lv.b) ?? null;
    const pill = v.nameHits[0] ?? null;
    expect(one || pill).toBeTruthy();
    const b = one ? one.lv.b! : pill!.b;
    if (one) v.tap(one.x, one.y);
    else v.tap((pill!.box[0] + pill!.box[2]) / 2, (pill!.box[1] + pill!.box[3]) / 2);
    // (Tap by tap, one level deeper each, towards it: no card until a species, then its own.)
    for (let k = 0; k < 6 && !v.levelNow().b; k++) {
      expect(!!P(v).anim).toBe(true);
      run(v);
      const at = v.levelNow();
      expect(card).toBe(at.b ? at.b.sp.common : null);
      if (!at.b) v.tap(...onColumn(v, b)!);
    }
    expect(v.levelNow().b).toBeTruthy();
  });
});
