// One tap = one level deeper, a double-tap = one level out, one pill per group one level down (ToLaD#258).
import { describe, expect, it } from 'vitest';
import { laneAt, layoutFan, leftAt, type FanBranch } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView, groupFace, holds, isLevel, labelGroups, labelSpots, levelName, nextLevels, type Level } from './view';
import { wikiOf } from './wiki';

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

type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; labelState: Map<string, unknown>; atHome(): boolean };
const P = (v: FanView) => v as unknown as Priv;

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
          if (card) log.push(`${b.sp.common}: a card on the way`);
          path.push(now);
        }
        if (path[path.length - 1].b !== b) {
          log.push(`${b.sp.common}: ended at ${nameOf(path[path.length - 1])}`);
          continue;
        }
        // At it: a tap opens its card, no flight.
        v.tap(...onColumn(v, b));
        if (P(v).anim || card !== b.sp.common) log.push(`${b.sp.common}: at it, a tap: card ${card}${P(v).anim ? ', and a flight' : ''}`);
        v.tap(-1e4, -1e4);
        // Double-taps: each one level out, back up the way it came, home at last; at home, nothing.
        for (let k = 0; k < 12; k++) {
          const prev = v.levelNow(true);
          v.doubleTap(-1e4, -1e4);
          if (!P(v).anim) {
            if (!P(v).atHome()) log.push(`${b.sp.common}: double-tap ${k + 1} did nothing at ${nameOf(prev)}`);
            break;
          }
          run(v);
          const now = v.levelNow();
          if (!holds(now, prev) || (now.v && now.v === prev.v) || (now.b && now.b === prev.b)) log.push(`${b.sp.common}: double-tap ${k + 1} went to ${nameOf(now)} from ${nameOf(prev)}`);
        }
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
        expect(P(v).atHome()).toBe(true);
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

describe('each group\'s picture over "now", exactly above its centre; none overlap (ToLaD#262)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      levelsOnTheWay(v, v.fan.tess.fold ? 61 : 7, (v) => {
        const lv = v.levelNow();
        if (lv.b) return;
        const at = nameOf(lv);
        // Every group one level down whose centre is on screen, with a face that has a picture, has its disc.
        for (const g of nextLevels(v.fan, lv.v)) {
          const [lo, hi] = nowExtent(v, strandsOf(g));
          const cx = (lo + hi) / 2;
          if (cx < 0 || cx > v.w) continue;
          const face = g.v ? groupFace(g.v) : g.b;
          if (!face || !wikiOf(face.sp.sci)?.img) continue;
          const p = v.picSpots.find((q) => (g.v ? q.lv.v === g.v : q.lv.b === g.b));
          if (!p) bad.push(`${at}: ${nameOf(g)} has no picture`);
          else if (Math.abs(p.x - cx) > 0.5) bad.push(`${at}: ${nameOf(g)}'s picture ${(p.x - cx).toFixed(1)} px off its centre`);
        }
        const ps = v.picSpots;
        for (let i = 0; i < ps.length; i++)
          for (let j = i + 1; j < ps.length; j++)
            if (Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) < (ps[i].d + ps[j].d) / 2 - 1e-6) bad.push(`${at}: ${nameOf(ps[i].lv)} and ${nameOf(ps[j].lv)} overlap`);
      });
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
        const to = v.groupCamera(h.bs);
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
