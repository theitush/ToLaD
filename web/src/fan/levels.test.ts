// One tap = one level deeper, a double-tap = one level out, one pill per group one level down (ToLaD#258).
import { describe, expect, it } from 'vitest';
import { laneAt, layoutFan, leftAt, type FanBranch, type FanNode } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView, groupAlive, groupFace, holds, isLevel, labelGroups, labelSpots, levelName, levelUp, NAME_MODES, nextLevels, type Level } from './view';
import type { Camera } from './camera';
import { wikiOf } from './wiki';
import { PIC_LIFT, PIC_OVERLAP } from './pics';

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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, 'curved', tree, folds);
}

type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  labelState: Map<string, unknown>;
  frameOf(lv: Level): Camera;
  offBy(a: Camera, c: Camera): number;
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
/** Where a double-tap from `from` should go, the view where it is (ToLaD#271): the first level up whose frame visibly moves. */
function wantUp(v: FanView, from: Level): FanNode | null {
  return upChain(v, from).find((u) => P(v).offBy(P(v).frameOf({ v: u }), v.cam) > LEVEL_PX) ?? null;
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
  P(v).labelState.clear();
  for (let k = 0; k < 3; k++) v.draw();
}
function home(v: FanView): void {
  v.cam = v.homeCamera();
  v.camera.settle();
  P(v).applyFold();
  settle(v);
}
const nameOf = (lv: Level) => (lv.b ? lv.b.sp.common : levelName(lv.v));
/** A point on b's column, above its split. */
function onColumn(v: FanView, b: FanBranch): [number, number] {
  // (Off the names and pictures, ToLaD#262: a name may stand over a neighbour's column; a tap there is the name's.)
  const iv = v as unknown as { pillAt(x: number, y: number): unknown; picAt(x: number, y: number): unknown };
  let first: [number, number] | null = null;
  for (const f of [0.4, 0.5, 0.6, 0.7, 0.3, 0.8, 0.2]) {
    const y = b.tipY + f * (b.splitY - b.tipY);
    const p = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y);
    first ??= p;
    if (!iv.pillAt(...p) && !iv.picAt(...p)) return p;
  }
  return first!;
}

/** The fans: the folded carnivores and the cats. */
const FANS = [
  ['carnivores (folded)', () => stubView()],
  ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
] as const;

describe("a group's picture is its most-populous living species with a picture (ToLaD#258)", () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      for (const u of v.fan.nodes) {
        const face = groupFace(u);
        const alive = u.strands.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0);
        const pics = alive.filter((b) => wikiOf(b.sp.sci)?.img);
        const want = pics.length ? pics : alive;
        const most = Math.max(...want.map((b) => b.pop.aliveAt(0)));
        if (!alive.length ? face !== null : !face || !want.includes(face) || face.pop.aliveAt(0) < most) bad.push(`${u.name}: ${face?.sp.common}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('one pill per group one level down, titled with its name, pictured by its face (ToLaD#258)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      home(v);
      const lv = v.levelNow();
      expect(lv.v).toBe(v.fan.root);
      const groups = nextLevels(v.fan, v.fan.root);
      // Every pill shown at home is one of home's groups: a clade's pill for a clade, a species' for a species.
      for (const h of v.famHits) expect(groups.some((g) => g.v === h.v)).toBe(true);
      for (const h of v.nameHits) expect(groups.some((g) => g.b === h.b)).toBe(true);
      expect(v.famHits.length + v.nameHits.length).toBeGreaterThan(0);
      // (A "+x" only for groups whose names are hidden, ToLaD#262.)
      for (const h of v.plusHits) for (const b of h.bs) expect(v.hiddenGroups.some((g) => (g.lv.v ? g.lv.v.strands.includes(b) : g.lv.b === b))).toBe(true);
      // Each clade's pill: its name, its face's picture.
      const spots = labelSpots(v.camera, v.fan, 60, (t) => t.length * 7.5, undefined, undefined, undefined, undefined, null, labelGroups(v.fan, lv));
      // (Beside its branch, ToLaD#262.)
      const fams = spots.filter((q) => q.fam);
      expect(fams.length).toBeGreaterThan(0);
      for (const q of fams) {
        expect(q.text).toBe(levelName(q.fam!));
        expect(q.pic).toBe(groupFace(q.fam!));
      }
      // No species pill but a group's own.
      for (const q of spots) if (q.b && q.place === 'tip') expect(labelGroups(v.fan, lv).species.has(q.b)).toBe(true);
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
      for (const b of bs) {
        home(v);
        card = null;
        const path: Level[] = [v.levelNow()];
        // One tap at a time: each flies one level deeper, towards b, to b itself at last.
        for (let k = 0; k < 12 && !path[path.length - 1].b; k++) {
          v.tap(...onColumn(v, b));
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
        }
        if (path[path.length - 1].b !== b) {
          log.push(`${b.sp.common}: ended at ${nameOf(path[path.length - 1])}`);
          continue;
        }
        // At it: a tap keeps its card, no flight.
        v.tap(...onColumn(v, b));
        if (P(v).anim || card !== b.sp.common) log.push(`${b.sp.common}: at it, a tap: card ${card}${P(v).anim ? ', and a flight' : ''}`);
        // Double-taps: each one level up (levelUp's, ToLaD#271), home at last; at home, nothing. The first closes the card.
        for (let k = 0; k < 12; k++) {
          const prev = v.levelNow(true);
          const want = wantUp(v, prev);
          v.doubleTap(-1e4, -1e4);
          if (k === 0 && card) log.push(`${b.sp.common}: a double-tap out left its card open`);
          if (!P(v).anim) {
            if (!atHome(v) || want) log.push(`${b.sp.common}: double-tap ${k + 1} did nothing at ${nameOf(prev)}`);
            break;
          }
          run(v);
          const now = v.levelNow();
          if (!want || now.v !== want || !atFrame(v, now)) log.push(`${b.sp.common}: double-tap ${k + 1} went to ${nameOf(now)} from ${nameOf(prev)}, not ${want ? levelName(want) : 'nowhere'}`);
        }
        if (!atHome(v)) log.push(`${b.sp.common}: double-taps ended away from home`);
      }
      expect(log).toEqual([]);
    });

    it(`${name}: each group's pill at home flies to that group; a double-tap, home`, () => {
      const v = mk();
      home(v);
      const pills = v.famHits.map((h) => h.v);
      expect(pills.length).toBeGreaterThan(0);
      for (const g of pills) {
        home(v);
        const h = v.famHits.find((q) => q.v === g)!;
        v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
        expect(!!P(v).anim).toBe(true);
        run(v);
        // (That group, or where its frame is the view's, on into it, ToLaD#258.)
        expect(holds({ v: g }, v.levelNow())).toBe(true);
        v.doubleTap(-1e4, -1e4);
        run(v);
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
const strandsOf = (lv: Level) => (lv.b ? [lv.b] : lv.v.strands);

/** At home and at each level a tap reaches on the way from home to a few species (each landed), `at`. */
function levelsOnTheWay(v: FanView, step: number, at: (v: FanView) => void): void {
  for (const b of v.fan.branches.filter((_, i) => i % step === 3)) {
    home(v);
    at(v);
    for (let k = 0; k < 8 && !v.levelNow().b; k++) {
      v.tap(...onColumn(v, b));
      if (!P(v).anim) break;
      run(v);
      at(v);
    }
  }
}

describe('each group\'s picture on "now", exactly above its centre; crowded, a little overlap or dropped (ToLaD#262, #266)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      let seen = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const lv = v.levelNow();
        if (lv.b) return;
        const at = nameOf(lv);
        const nowS = v.toScreen(0, v.fan.time.y(0))[1];
        const pop = groupAlive;
        // Every group one level down whose centre is on screen, with a face that has a picture, has its disc, on "now"
        // (an extinct species' on its tip), never above it; else a more populous group's disc stands too near it.
        for (const g of nextLevels(v.fan, lv.v)) {
          const [lo, hi] = nowExtent(v, strandsOf(g));
          const cx = (lo + hi) / 2;
          if (cx < 0 || cx > v.w) continue;
          const face = g.v ? groupFace(g.v) : g.b;
          if (!face || !wikiOf(face.sp.sci)?.img) continue;
          const p = v.picSpots.find((q) => (g.v ? q.lv.v === g.v : q.lv.b === g.b));
          const edge = g.b && g.b.tipY > v.fan.time.y(0) ? v.toScreen(0, g.b.tipY)[1] : nowS;
          if (!p) {
            if (!v.picSpots.some((q) => pop(q.lv) >= pop(g) && Math.abs(q.x - cx) < PIC_OVERLAP * q.d + 1e-6)) bad.push(`${at}: ${nameOf(g)} has no picture, none more populous near`);
          } else {
            seen++;
            if (Math.abs(p.x - cx) > 0.5) bad.push(`${at}: ${nameOf(g)}'s picture ${(p.x - cx).toFixed(1)} px off its centre`);
            if (Math.abs(p.y + p.d / 2 - (edge - PIC_LIFT)) > 0.5) bad.push(`${at}: ${nameOf(g)}'s picture ${(edge - PIC_LIFT - p.y - p.d / 2).toFixed(1)} px off the now edge`);
          }
        }
        const ps = v.picSpots;
        for (let i = 0; i < ps.length; i++)
          for (let j = i + 1; j < ps.length; j++)
            if (Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) < PIC_OVERLAP * Math.min(ps[i].d, ps[j].d) - 1e-6) bad.push(`${at}: ${nameOf(ps[i].lv)} and ${nameOf(ps[j].lv)} overlap more than a little`);
        // The more populous drawn later (on top).
        for (let i = 1; i < ps.length; i++) if (pop(ps[i].lv) < pop(ps[i - 1].lv)) bad.push(`${at}: ${nameOf(ps[i].lv)} drawn over the more populous ${nameOf(ps[i - 1].lv)}`);
      });
      expect(seen).toBeGreaterThan(0);
      expect(bad).toEqual([]);
    });
  }
});

describe('a level of two or three groups is framed centred, in the middle of the screen (ToLaD#262)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      let seen = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const lv = v.levelNow();
        if (lv.b || !lv.v.parent || nextLevels(v.fan, lv.v).length > 3) return;
        seen++;
        // Its columns at "now": their middle at the middle of the room right of the time axis, within 16 px, and
        // not spread past the middle 70 % of the screen.
        const [lo, hi] = nowExtent(v, lv.v.strands);
        const mid = (58 + v.w - 14) / 2;
        if (Math.abs((lo + hi) / 2 - mid) > 16) bad.push(`${nameOf(lv)}: centred ${((lo + hi) / 2 - mid).toFixed(0)} px off`);
        if (hi - lo > 0.7 * v.w) bad.push(`${nameOf(lv)}: ${(hi - lo).toFixed(0)} px across`);
      });
      expect(bad).toEqual([]);
      expect(seen).toBeGreaterThan(0);
    });
  }
});

describe('a "+x" stands for the names hidden near it; tapped, it frames them (ToLaD#262)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      let tried = 0;
      const bad: string[] = [];
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const at = nameOf(v.levelNow());
        // Each hidden group counts on a shown name's "+x" (when any is shown), each once.
        if (v.famHits.length + v.nameHits.length && v.hiddenGroups.some((h) => h.on === null)) bad.push(`${at}: a hidden name on no "+x"`);
        const n = v.plusHits.reduce((s, h) => s + h.bs.length, 0);
        const want = v.hiddenGroups.reduce((s, h) => s + (h.on ? strandsOf(h.lv).length : 0), 0);
        if (n !== want) bad.push(`${at}: the "+x" hold ${n} species, the hidden names ${want}`);
        const h = v.plusHits[0];
        if (!h || tried > 2) return;
        tried++;
        const cam = { ...v.cam };
        v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
        if (!P(v).anim) bad.push(`${at}: a "+x" tapped flew nowhere`);
        run(v);
        // Landed on the hidden groups' frame, their columns all on screen.
        // (One species hidden: a landing on it, its frame, ToLaD#266.)
        const to = h.bs.length === 1 ? v.speciesCamera(h.bs[0]) : v.groupCamera(h.bs);
        if (Math.abs(Math.log(v.cam.sx / to.sx)) > 0.05) bad.push(`${at}: a "+x" landed off its frame`);
        const [a, b] = nowExtent(v, h.bs);
        if (a < -2 || b > v.w + 2) bad.push(`${at}: a "+x" landed with its groups off screen (${a.toFixed(0)}–${b.toFixed(0)})`);
        v.cam = cam;
        v.camera.settle();
        P(v).applyFold();
        settle(v);
      });
      expect(bad).toEqual([]);
      expect(tried).toBeGreaterThan(0);
    });
  }
});

describe("the groups' names beside, mid-branch or between branches: none meet (ToLaD#266)", () => {
  for (const [name, mk] of FANS) {
    for (const mode of NAME_MODES) {
      it(`${name}: ${mode}`, () => {
        const v = mk();
        v.names = mode;
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
          if (mode === 'beside') return;
          // Along its branch: between "now" (its tip) and where it splits off, as far as the screen shows.
          for (const h of hits) {
            const wTop = h.lv.b ? Math.max(h.lv.b.tipY, v.fan.time.y(0)) : v.fan.time.y(0);
            const wBot = h.lv.b ? h.lv.b.splitY : h.lv.v.yBot;
            const y = (h.box[1] + h.box[3]) / 2;
            if (y < Math.max(nowS, v.toScreen(0, wTop)[1]) - 1 || y > v.toScreen(0, wBot)[1] + 1) bad.push(`${at}: ${nameOf(h.lv)}'s name off its branch's run (${y.toFixed(0)})`);
          }
        });
        expect(bad).toEqual([]);
        expect(shown).toBeGreaterThan(0);
      });
    }
  }
});

describe('a double tap goes up to the parent level, not back (ToLaD#271)', () => {
  for (const [name, mk] of FANS) {
    it(`${name}: from every level tapped down to from home, exactly the level it sits in (or the next that visibly moves)`, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      const bad: string[] = [];
      let n = 0;
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const from = v.levelNow(true);
        const want = wantUp(v, from);
        const cam = { ...v.cam };
        const tapAt = P(v).tapAt;
        v.doubleTap(-1e4, -1e4);
        if (card) bad.push(`${nameOf(from)}: the card left open`);
        if (!want) {
          if (P(v).anim || from.v !== v.fan.root) bad.push(`${nameOf(from)}: ${P(v).anim ? 'flew from home' : 'nowhere to go'}`);
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
    });

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
        // (Its own level: the nearest one it sits in, unless that one's frame is the species' own.)
        const first = upChain(v, { b })[0];
        if (want !== first && P(v).offBy(P(v).frameOf({ v: first }), P(v).frameOf({ b })) > LEVEL_PX) bad.push(`${b.sp.common}: skipped ${levelName(first)}`);
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
        if (!atHome(v) || k === 12) bad.push(`${b.sp.common}: double taps stopped away from home`);
      }
      expect(bad).toEqual([]);
    });

    it(`${name}: after a "+x", the level its groups sit in`, () => {
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
        // Where the groups meet; of the levels holding them, the nearest whose frame takes in the view (zoomed out at
        // least as far, within 15 %: a level of a few groups, framed narrower, does not): that one when the view is
        // zoomed well past it, else the first above it that visibly moves. Never zoomed in, never back to `at`'s for that.
        let meet: FanNode = h.bs[0].node;
        while (meet.parent && !h.bs.every((b) => meet.strands.includes(b))) meet = meet.parent;
        const zIn = (u: FanNode) => {
          const f = P(v).frameOf({ v: u });
          return Math.log(v.cam.sx / f.sx) + Math.log(v.cam.sy / f.sy);
        };
        const chain = [levelUp(v.fan, meet, true)!, ...upChain(v, { v: levelUp(v.fan, meet, true)! })];
        const i = chain.findIndex((u) => zIn(u) >= -Math.log(1.15));
        const want =
          h.bs.length === 1
            ? wantUp(v, { b: h.bs[0] })
            : i >= 0 && zIn(chain[i]) > Math.log(1.15) && P(v).offBy(P(v).frameOf({ v: chain[i] }), v.cam) > LEVEL_PX
            ? chain[i]
            : (chain.slice(i + 1).find((u) => P(v).offBy(P(v).frameOf({ v: u }), v.cam) > LEVEL_PX) ?? null);
        v.doubleTap(-1e4, -1e4);
        run(v);
        const now = v.levelNow();
        if (!want || now.v !== want || !atFrame(v, now)) bad.push(`${at}: a "+x" of ${h.bs.length} then a double tap went to ${nameOf(now)}, not ${want ? levelName(want) : 'nowhere'}`);
        v.cam = cam;
        v.camera.settle();
        P(v).applyFold();
        settle(v);
      });
      expect(bad).toEqual([]);
      expect(tried).toBeGreaterThan(0);
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
      if (!at.b) v.tap(...onColumn(v, b));
    }
    expect(v.levelNow().b).toBeTruthy();
  });
});
