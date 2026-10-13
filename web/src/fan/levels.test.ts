// One tap = one level deeper, a double-tap = one level out, one pill per group one level down (ToLaD#258).
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, type FanBranch } from './layout';
import { CARNIVORA, FELIDAE, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, type Split } from './splits';
import { FanView, groupFace, holds, labelGroups, labelSpots, levelName, nextLevels, type Level } from './view';
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
  const y = b.tipY + 0.4 * (b.splitY - b.tipY);
  return v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y);
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
      expect(v.plusHits).toEqual([]);
      // Each clade's pill: its name, its face's picture.
      const spots = labelSpots(v.camera, v.fan, 60, (t) => t.length * 7.5, undefined, undefined, undefined, undefined, null, labelGroups(v.fan, lv));
      const fams = spots.filter((q) => q.place === 'fam');
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
