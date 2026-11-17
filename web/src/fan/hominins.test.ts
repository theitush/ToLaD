// A tap on humans from above the hominins stops at the Hominins first (ToLaD#497): the hominins highlight (HIGHLIGHT_STOPS). From
// home, Primates and Great apes, a tap on the human's name, picture or column lands at the Hominins level (its chain ending
// "Hominins", no card); the next tap on humans lands on the Human species with its card (ToLaD#496); a double tap from the
// Hominins goes up one level, to African great apes (ToLaD#472, #481). Real pointer events through Input, the tree on its side.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { setFlip } from './flip';
import { latinOf } from './brackets';
import type { FanBranch } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { BirthCurve } from './history';
import { mammaliaClade, type CladeRec, type SpeciesRec } from './panthera';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { chainOf, FanView, levelClade, type Level } from './view';

/** view.ts's: a view within this many px of a frame is at it. */
const LEVEL_PX = 12;
let clock = 1000;
const timers: { at: number; f: () => void; id: number }[] = [];
let tid = 1;
type Rig = { v: FanView; on: Map<string, (e: unknown) => void> };
/** The view on its side, as on a phone (taps.test.ts's), its pointer events caught so they go through Input as a finger's. */
/** The view on its side, its column w px long (700, or the phone's 663: 390 x 844 under the bar, the chain and the time axis, measured in the browser). */
function rig(w = 700, clade: CladeRec = mammaliaClade()): Rig {
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
  g.window = {
    devicePixelRatio: 2,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: (f: () => void, ms: number) => (timers.push({ at: clock + ms, f, id: ++tid }), tid),
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  const on = new Map<string, (e: unknown) => void>();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: w, height: 390, left: 0, top: 0, right: w, bottom: 390 }),
    addEventListener: (t: string, f: (e: unknown) => void) => on.set(t, f),
    removeEventListener: noop,
    setPointerCapture: noop,
  };
  return { v: new FanView(canvas as unknown as HTMLCanvasElement, clade, mammaliaTree(), true), on };
}
type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  camera: FanCamera;
  goLevel(lv: Level, cam: Camera, card?: boolean): void;
  landOf(lv: Level): Camera;
  offBy(a: Camera, c: Camera): number;
  pillAt(x: number, y: number): unknown;
  picAt(x: number, y: number): unknown;
  plusAt(x: number, y: number): unknown;
  carded: FanBranch | null;
  selected: unknown;
};
const P = (v: FanView) => v as unknown as Priv;

/** A finger at view point (x, y): Input turned reads (clientY, box width - clientX), taps.test.ts's box 700 wide. */
const proc = (globalThis as unknown as { process: { env: Record<string, string>; stderr: { write(s: string): void } } }).process;
const pointerType = 'touch';
const finger = (id: number, x: number, y: number) => ({ pointerId: id, pointerType, button: 0, clientX: 700 - y, clientY: x, timeStamp: clock, preventDefault() {} });
/** The clock on by ms, a frame at a time, the timers due and the flight under way run. */
function pass(r: Rig, ms: number): void {
  const end = clock + ms;
  while (clock < end) {
    clock += 1000 / 60;
    for (const t of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1);
      t.f();
    }
    const iv = P(r.v);
    if (iv.anim) {
      if (!iv.anim(clock)) iv.anim = null;
      iv.applyFold();
    }
  }
}
/** Until nothing is under way: the double-tap window's held tap, a flight, a fling. */
function settle(r: Rig): void {
  for (let k = 0; (P(r.v).anim || timers.length) && k < 3000; k++) pass(r, 1);
  for (let k = 0; k < 3; k++) r.v.draw();
}
function tapAt(r: Rig, x: number, y: number): void {
  r.on.get('pointerdown')!(finger(1, x, y));
  pass(r, 50);
  r.on.get('pointerup')!(finger(1, x, y));
}
/** A real double tap at (x, y), then until it lands. */
function doubleTap(r: Rig, x: number, y: number): void {
  tapAt(r, x, y);
  pass(r, 120);
  tapAt(r, x, y);
  settle(r);
}

/** Whether home names and pictures Human in view p. */
function humanAtHome(p: FanView): { name: boolean; picture: boolean } {
  const c = p.homeCamera();
  (p.fan.tess.fold as Steady).setScale(c.sx, p.w);
  p.cam = { ...c, ty: c.sy };
  P(p).camera.settle();
  for (let k = 0; k < 3; k++) p.draw();
  const b = p.fan.branches.find((q) => q.sp.sci === 'Homo sapiens')!;
  return { name: p.nameHits.some((q) => q.b === b), picture: p.thumbHits.some((q) => q[3] === b && !q[4]) };
}

/** Clade c with every species' count times its own factor in 1 ± by (mulberry32 from seed): today's, ever, its history's points and births; no build seed, so the layout chooses its sides on these widths. */
function jittered(c: CladeRec, seed: number, by: number): CladeRec {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const one = (sp: SpeciesRec): SpeciesRec => {
    const f = 1 + by * (2 * rnd() - 1);
    // (Whole individuals, as the data's: a count stays a count, a living species keeps one at least, a segment two parents.)
    const n = (x: number, least = 0) => (x > 0 ? Math.max(least, Math.round(x * f)) : x);
    const out: SpeciesRec = { ...sp, alive: n(sp.alive, 1), ever: n(sp.ever, 1), everLo: n(sp.everLo, 1), everHi: n(sp.everHi, 1) };
    if (sp.history) out.history = { ...sp.history, points: sp.history.points.map((q) => ({ ...q, n: n(q.n, 1), lo: n(q.lo), hi: n(q.hi) })) };
    if (sp.births) {
      const segments = sp.births.segments.map((q) => ({ ...q, startSize: n(q.startSize, 2), endSize: n(q.endSize, 2) }));
      out.births = { ...sp.births, segments, curve: new BirthCurve(segments, sp.genYears) };
    }
    return out;
  };
  return { ...c, species: c.species.map(one), seed: undefined };
}

describe('a tap on humans stops at the Hominins first (ToLaD#497)', () => {
  let r: Rig;
  let v: FanView;
  let home: Camera;
  beforeAll(async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    await loadMammalsFromFiles();
    setFlip(true);
    r = rig();
    v = r.v;
    home = v.homeCamera();
  }, 300_000);
  afterAll(() => {
    setFlip(false);
    vi.restoreAllMocks();
  });

  const stand = (c: Camera) => {
    P(v).anim = null;
    timers.length = 0;
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c, ty: c.sy };
    P(v).camera.settle();
    for (let k = 0; k < 3; k++) v.draw();
  };
  const node = (latin: string) => v.fan.nodes.find((q) => latinOf(q.split) === latin)!;
  /** The chain the view shows (the breadcrumb): the groups the level on screen stands in. */
  const chain = () => chainOf(v.fan, levelClade(v.fan, v.levelNow(true))).join(' › ');
  /** At a level, landed as a tap on it lands (home: home's frame), nothing open. */
  const at = (latin: string | null) => {
    stand(home);
    if (latin) {
      P(v).goLevel({ v: node(latin) }, home, false);
      settle(r);
    }
    v.onSelect(null);
    P(v).carded = null;
    for (let k = 0; k < 3; k++) v.draw();
  };
  const human = () => v.fan.branches.find((b) => b.sp.sci === 'Homo sapiens')!;
  /** Where on screen a tap on humans goes: their name, their picture, their column off both. */
  const spot = (how: 'name' | 'picture' | 'column'): [number, number] | null => {
    const b = human();
    if (how === 'name') {
      const h = v.nameHits.find((q) => q.b === b);
      return h ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : null;
    }
    if (how === 'picture') {
      const h = v.thumbHits.find((q) => q[3] === b && !q[4]);
      return h ? [h[0], h[1]] : null;
    }
    for (let y = 8; y < v.h - 8; y += 4) for (let x = 8; x < v.w - 8; x += 2) if (v.hitBranch(x, y) === b && !P(v).pillAt(x, y) && !P(v).picAt(x, y) && !P(v).plusAt(x, y)) return [x, y];
    return null;
  };
  const lvName = (lv: Level) => (lv.b ? `${lv.b.sp.common} (species)` : chainOf(v.fan, lv.v).slice(-1)[0]);

  const say = (s: string) => proc.env.HOMININS_SAY && proc.stderr.write(s + '\n');
  /** What the view shows: its level, the chain's last row, whether a card is open. */
  const shows = () => `${lvName(v.levelNow(true))} [${chain().split(' › ').slice(-1)[0]}]${P(v).selected ? ' card' : ''}`;
  const atHominins = () => {
    const lv = v.levelNow(true);
    return lv.v === node('Hominini') && chain().endsWith('› Hominins') && !P(v).selected;
  };

  // (On the phone's column too, ToLaD#500: the human lane at home is 27.8 px there, room for its own name but not for a guest title beside it, so the label is Human's own: the highlight's
  // band is its own label's before a title's, gapHands' `dear`, whichever side of Primates' fork the lemurs fall, ToLaD#525's data.)
  it('on the phone’s column, home names and pictures Human', () => {
    expect(humanAtHome(rig(663.109375).v)).toEqual({ name: true, picture: true });
    // (Back to the 700 px rig's scale for the tests after.)
    (v.fan.tess.fold as Steady).setScale(v.cam.sx, v.w);
  });

  // (A small data change must never drop the most familiar name at home, ToLaD#500 after #507's data: every species' count jittered by up to ±20%, a few seeds, the layout's sides chosen
  // afresh on the new widths as the build's seed would be.)
  for (const seed of [1, 2, 3, 4])
    it(`on the phone’s column, home names and pictures Human with every count jittered ±20% (seed ${seed})`, () => {
      const p = rig(663.109375, jittered(mammaliaClade(), seed, 0.2)).v;
      expect(humanAtHome(p), `seed ${seed}`).toEqual({ name: true, picture: true });
      (v.fan.tess.fold as Steady).setScale(v.cam.sx, v.w);
    }, 600_000);

  it('from home, Primates and Great apes: a tap on the human name, picture or column lands at the Hominins, no card', () => {
    const bad: string[] = [];
    for (const lv of [null, 'Primates', 'Hominidae'])
      for (const how of ['name', 'picture', 'column'] as const) {
        at(lv);
        const p = spot(how);
        if (!p) {
          bad.push(`${lv ?? 'home'}: no human ${how} on screen`);
          continue;
        }
        tapAt(r, ...p);
        settle(r);
        say(`${lv ?? 'home'} ${how}: ${shows()}`);
        if (!atHominins()) bad.push(`${lv ?? 'home'} ${how}: at ${shows()}, not the Hominins`);
      }
    expect(bad).toEqual([]);
  }, 1_200_000);

  it('from the Hominins a tap on humans landed at, a double tap goes up one level: African great apes', () => {
    at('Primates');
    tapAt(r, ...spot('picture')!);
    settle(r);
    expect(atHominins(), shows()).toBe(true);
    doubleTap(r, v.w / 2, 40);
    say(`Hominins, a double tap: ${shows()}`);
    expect(v.levelNow(true).v === node('Homininae') && chain().endsWith('› African great apes'), shows()).toBe(true);
  }, 600_000);

  // The level above Human is the Hominins (its stop, ToLaD#497, Ita 2026-11-17: "double clicking on humans should return to hominins"): a double
  // tap from Human, however it was reached, card open or closed, lands at the Hominins level, on the Hominins' landing, its chain ending "Hominins";
// the next one goes on up to African great apes.
  it('from Human (two taps from Primates, a search pick, its card closed), a double tap goes back to the Hominins', () => {
    const toHuman = () => {
      at('Primates');
      tapAt(r, ...spot('picture')!);
      settle(r);
      tapAt(r, ...spot('column')!);
      settle(r);
    };
    const ways: [string, () => void][] = [
      ['Primates, Hominins, Human', toHuman],
      ['a search pick', () => (stand(home), v.flyToSpecies(human().sp), settle(r))],
      ['Human, its card closed', () => (toHuman(), v.tap(-1e6, -1e6), settle(r))],
    ];
    const bad: string[] = [];
    for (const [way, reach] of ways) {
      reach();
      const was = shows();
      const crumb = chain();
      if (v.levelNow(true).b !== human()) bad.push(`${way}: at ${was}, not Human`);
      doubleTap(r, v.w / 2, v.h / 2);
      const off = P(v).offBy(P(v).landOf({ v: node('Hominini') }), v.cam);
      say(`${way}: at ${was} (chain ${crumb}); a double tap: ${shows()}, ${off.toFixed(0)} px off the Hominins' landing`);
      if (!atHominins() || off > LEVEL_PX) bad.push(`${way}: a double tap from ${was} went to ${shows()}, ${off.toFixed(0)} px off the Hominins' landing`);
      if (!crumb.endsWith('› Hominins')) bad.push(`${way}: the chain at Human is "${crumb}", not "… › Hominins"`);
      // (A second double tap goes up from the Hominins as before: African great apes.)
      doubleTap(r, v.w / 2, v.h / 2);
      if (!(v.levelNow(true).v === node('Homininae') && chain().endsWith('› African great apes'))) bad.push(`${way}: a second double tap went to ${shows()}, not African great apes`);
    }
    expect(bad).toEqual([]);
  }, 1_200_000);

  // (The Hominins' landing (stopFrame) runs its fossil frame on to "now": humans stand in view there, a column to tap a second time.)
  it('at the Hominins: humans on screen, and the next tap on them lands on Human, its card open', () => {
    at('Primates');
    tapAt(r, ...spot('name')!);
    settle(r);
    expect(atHominins(), shows()).toBe(true);
    const p = spot('column');
    expect(p, 'a human column on screen at the Hominins').toBeTruthy();
    tapAt(r, ...p!);
    settle(r);
    say(`Hominins, a tap on humans: ${shows()}`);
    expect(v.levelNow(true).b === human() && !!P(v).selected, shows()).toBe(true);
  }, 600_000);
});
