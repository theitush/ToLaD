// A double tap goes exactly one level up (ToLaD#472): from the level on screen, the chain's (the breadcrumb's) parent, never two, whatever came
// before: a tap that went several levels down, a pan, a pinch. Real pointer events through Input on the tree on its side, at home and down in
// the Primates, Carnivora, Rodentia and Chiroptera: the chain before each double tap and after. `UPONE_SAY=1` prints every route.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { setFlip } from './flip';
import { latinOf } from './brackets';
import type { FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { chainOf, FanView, groupName, levelClade, type GapMember, type Level } from './view';

let clock = 1000;
const timers: { at: number; f: () => void; id: number }[] = [];
let tid = 1;
type Rig = { v: FanView; on: Map<string, (e: unknown) => void> };
/** The view on its side, as on a phone (taps.test.ts's), its pointer events caught so they go through Input as a finger's. */
function rig(): Rig {
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
    getBoundingClientRect: () => ({ width: 700, height: 390, left: 0, top: 0, right: 700, bottom: 390 }),
    addEventListener: (t: string, f: (e: unknown) => void) => on.set(t, f),
    removeEventListener: noop,
    setPointerCapture: noop,
  };
  return { v: new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true), on };
}
type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  camera: FanCamera;
  famHits: { box: number[]; v: FanNode }[];
  territories(): never;
  gapCoverAt(T: never, sx: number): GapMember[];
  goLevel(lv: Level, cam: Camera, card?: boolean): void;
  landOf(lv: Level): Camera;
  offBy(a: Camera, c: Camera): number;
};
const P = (v: FanView) => v as unknown as Priv;
const proc = (globalThis as unknown as { process: { env: Record<string, string>; stderr: { write(s: string): void } } }).process;
const say = (s: string) => proc.env.UPONE_SAY && proc.stderr.write(s + '\n');

/** A finger at view point (x, y): Input turned reads (clientY, box width - clientX), taps.test.ts's box 700 wide. */
const finger = (id: number, x: number, y: number) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: 700 - y, clientY: x, timeStamp: clock, preventDefault() {} });
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
/** A one-finger drag by (dx, dy) over 20 frames, then its fling run out. */
function drag(r: Rig, dx: number, dy: number): void {
  const [x, y] = [r.v.w / 2, r.v.h / 2];
  r.on.get('pointerdown')!(finger(1, x, y));
  for (let k = 1; k <= 20; k++) {
    pass(r, 16);
    r.on.get('pointermove')!(finger(1, x + (dx * k) / 20, y + (dy * k) / 20));
  }
  pass(r, 200);
  r.on.get('pointerup')!(finger(1, x + dx, y + dy));
  settle(r);
}
/** A two-finger pinch about the screen's centre, the fingers' spread on each axis times (fx, fy) over 20 frames. */
function pinch(r: Rig, fx: number, fy: number): void {
  const [x, y] = [r.v.w / 2, r.v.h / 2];
  const [ax, ay] = [60, 60];
  r.on.get('pointerdown')!(finger(1, x - ax, y - ay));
  r.on.get('pointerdown')!(finger(2, x + ax, y + ay));
  for (let k = 1; k <= 20; k++) {
    pass(r, 16);
    const [sx, sy] = [ax * (1 + ((fx - 1) * k) / 20), ay * (1 + ((fy - 1) * k) / 20)];
    r.on.get('pointermove')!(finger(1, x - sx, y - sy));
    r.on.get('pointermove')!(finger(2, x + sx, y + sy));
  }
  pass(r, 200);
  const [sx, sy] = [ax * fx, ay * fy];
  r.on.get('pointerup')!(finger(2, x + sx, y + sy));
  r.on.get('pointerup')!(finger(1, x - sx, y - sy));
  settle(r);
}

describe('a double tap goes exactly one level up (ToLaD#472)', () => {
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
  /** The chain the view shows (chainFrame's, the view still): the groups the level on screen stands in. */
  const chain = () => chainOf(v.fan, levelClade(v.fan, v.levelNow(true)));
  const lvName = (lv: Level) => (lv.b ? `${lv.b.sp.common || lv.b.sp.sci} (species)` : chainOf(v.fan, lv.v).slice(-1)[0]);
  /** How much tighter frame a is than the view at c, px of the screen, on width and on time (positive: in). */
  const tighter = (a: Camera, c: Camera) => [v.w * (a.sx / c.sx - 1), v.h * (a.sy / c.sy - 1)];
  const node = (latin: string) => v.fan.nodes.find((q) => latinOf(q.split) === latin)!;
  const tapBox = (box: number[]) => {
    tapAt(r, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    settle(r);
  };
  /** From home, label taps down until clade u is open (taps.test.ts's way): each on the label holding it, a fat lane's title panned to. */
  const tapDownTo = (u: FanNode) => {
    const up = new Set<FanNode>();
    for (let p = u.parent; p; p = p.parent) up.add(p);
    stand(home);
    // (Open at home already, the bats: landed on as a tap on it lands, a column's or a pinned row's.)
    const [uf, ul] = [u.strands[0].index, u.strands[u.strands.length - 1].index];
    if (!P(v).gapCoverAt(P(v).territories(), v.cam.sx).some((g) => g.f <= uf && g.l >= ul)) {
      P(v).goLevel({ v: u }, home, false);
      settle(r);
      return;
    }
    for (let k = 0; k < 20; k++) {
      // (Open: the cover's members on it all inside it, its parts.)
      if (k && !P(v).gapCoverAt(P(v).territories(), v.cam.sx).some((g) => g.f <= uf && g.l >= ul)) return;
      if (!P(v).famHits.some((q) => q.v === u || up.has(q.v))) {
        const m = P(v)
          .gapCoverAt(P(v).territories(), v.cam.sx)
          .find((g) => g.lv.v === u || (g.lv.v && up.has(g.lv.v)));
        if (m) stand({ ...v.cam, cx: m.top + (v.w / 2 - v.w / 3) / v.cam.sx });
      }
      const h = P(v).famHits.find((q) => q.v === u) ?? P(v).famHits.find((q) => up.has(q.v));
      if (!h) throw new Error(`no label holds ${latinOf(u.split)} at ${chain().join(' › ')} ${(v.cam.sx / home.sx).toFixed(2)}x: ${P(v).famHits.map((q) => groupName(v.fan, q.v)).join(', ')}`);
      tapBox(h.box);
    }
  };

  /** One double tap from where the view is: what it should do, what it did. */
  type Row = { route: string; before: string[]; after: string[]; lv: string; want: string | null; inPx: number; bad: string | null; held: boolean };
  const rows: Row[] = [];
  const check = (route: string): Row => {
    for (let k = 0; k < 3; k++) v.draw();
    const lv = v.levelNow(true);
    const before = chain();
    const was = { ...v.cam };
    // (One level up: the level the view is at sits in, levelUp's; a species', the clade it is in.)
    const up = v.levelsAbove(lv)[0] ?? null;
    // (Where a tap on it lands tighter than the view, on width or on time: up would be in, so the double tap holds, ToLaD#416.)
    const into = up ? Math.max(...tighter(P(v).landOf({ v: up }), was)) > 12 : false;
    doubleTap(r, v.w / 2, v.h / 2);
    const after = chain();
    const [tx, ty] = tighter(v.cam, was);
    const inPx = Math.max(tx, ty);
    let bad: string | null = null;
    const want = up ? chainOf(v.fan, up) : before;
    // (At home's level off home, home: #416's last resort while it is wider on width, whatever it does to time.)
    const homeOk = after.length === 1 && tx < -12;
    const held = into && after.join(' › ') === before.join(' › ') && P(v).offBy(v.cam, was) < 1;
    if (held) bad = null;
    else if (after.join(' › ') !== want.join(' › ')) bad = after.length < want.length ? `up ${before.length - after.length} levels` : `went to ${after.join(' › ')}`;
    else if (inPx > 12 && !homeOk) bad = `zoomed in ${tx.toFixed(0)} px on width, ${ty.toFixed(0)} on time`;
    const row = { route, before, after, lv: lvName(lv), want: up ? lvName({ v: up }) : null, inPx, bad, held };
    rows.push(row);
    say(`${bad ? 'BAD ' : held ? 'held' : 'ok  '}${route}: [${lvName(lv)}] ${before.join(' › ')}  ->  ${after.join(' › ')}${bad ? `  (${bad})` : ''}`);
    return row;
  };

  const levels: [string, string | null][] = [
    ['home', null],
    ['Primates', 'Primates'],
    ['Carnivora', 'Carnivora'],
    ['Rodentia', 'Rodentia'],
    ['Chiroptera', 'Chiroptera'],
  ];
  for (const [name, latin] of levels) {
    it(`${name}: from views reached by taps, pans and pinches, one level up per double tap`, () => {
      const at = () => (latin ? tapDownTo(node(latin)) : stand(home));
      at();
      const start = { ...v.cam };
      const labels = P(v).famHits.map((h) => h.v);
      // The level itself, and two double taps on.
      check(`${name}`);
      check(`${name}, a second double tap`);
      // Each label there tapped once (a tap can go several levels down: Vesper bats & kin from home lands in Yangochiroptera), then a double tap; then a second.
      for (const u of labels) {
        stand(start);
        const h = P(v).famHits.find((q) => q.v === u);
        if (!h) continue;
        tapBox(h.box);
        check(`${name}: tap ${groupName(v.fan, u)}`);
        check(`${name}: tap ${groupName(v.fan, u)}, a second double tap`);
      }
      // Two taps deep, then a double tap.
      for (const u of labels.slice(0, 4)) {
        stand(start);
        const h = P(v).famHits.find((q) => q.v === u);
        if (!h) continue;
        tapBox(h.box);
        const h2 = P(v).famHits[P(v).famHits.length >> 1];
        if (!h2) continue;
        tapBox(h2.box);
        check(`${name}: tap ${groupName(v.fan, u)}, tap ${groupName(v.fan, h2.v)}`);
      }
      // Pans along the tree and along time, from the level and from a tap.
      for (const [dn, dx, dy] of [
        ['pan down the tree', v.w / 3, 0],
        ['pan up the tree', -v.w / 3, 0],
        ['pan in time', 0, v.h / 4],
        ['pan far', v.w, 0],
      ] as const) {
        stand(start);
        drag(r, dx, dy);
        check(`${name}: ${dn}`);
        if (labels[0]) {
          stand(start);
          const h = P(v).famHits.find((q) => q.v === labels[0]);
          if (h) {
            tapBox(h.box);
            drag(r, dx, dy);
            check(`${name}: tap ${groupName(v.fan, labels[0])}, ${dn}`);
          }
        }
      }
      // Pinches: in and out, on width, on time, both.
      for (const [pn, fx, fy] of [
        ['pinch in', 2.2, 2.2],
        ['pinch in on width', 2.5, 1],
        ['pinch in on time', 1, 2.5],
        ['pinch out', 0.6, 0.6],
        ['pinch in a lot', 4, 1.3],
      ] as const) {
        stand(start);
        pinch(r, fx, fy);
        check(`${name}: ${pn}`);
        if (labels[1]) {
          stand(start);
          const h = P(v).famHits.find((q) => q.v === labels[1]);
          if (h) {
            tapBox(h.box);
            pinch(r, fx, fy);
            check(`${name}: tap ${groupName(v.fan, labels[1])}, ${pn}`);
          }
        }
      }
      const bad = rows.filter((q) => q.bad && q.route.startsWith(name));
      const mine = rows.filter((q) => q.route.startsWith(name));
      say(`${name}: ${mine.length} double taps, ${bad.length} not one level up, ${mine.filter((q) => q.held).length} held (up would zoom in)`);
      expect(bad.map((q) => `${q.route}: [${q.lv}] ${q.before.join(' › ')} -> ${q.after.join(' › ')} (${q.bad})`)).toEqual([]);
    }, 600_000);
  }
});
