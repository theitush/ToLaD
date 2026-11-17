// Fossils named and pictured at their own tip (ToLaD#279 step 4, #497): on the tree on its side every name stands on the labels' line (100 kya), so a strand gone by
// then, or a hair inside a wider lane there, was never named; at the Hominins' landing 0 of the 22 pictured hominins were. Now each is named where its line ends,
// its picture (or stub) on its tip, where its branch has room and its name meets no label (view.ts tipLabels). At the Hominins' landing (a tap on humans from Primates),
// on a 700 px column and the phone's 663: the hominins named and pictured, and why each missing one is missing; no two labels meet there, at home and at the levels
// Ita checks; the column's labels (the living's) are the same with the fossils' names as without, at home, Carnivora, Felidae, Primates and Rodentia.
// TIPNAMES_SAY=1 prints the counts.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { setFlip } from './flip';
import { latinOf } from './brackets';
import { SPECIES_PX } from './gapnames';
import type { FanBranch } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { picBox } from './pics';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { chainOf, FanView, levelClade, type CutLabels, type Level } from './view';

/** The mammals' pictures (data/mammals/wiki.json; node loads the mammals without them, mammals-node.ts). */
const WIKI = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals', 'wiki.json'), 'utf8')) as Record<string, { img?: string } | null>;

let clock = 1000;
const timers: { at: number; f: () => void; id: number }[] = [];
let tid = 1;
type Rig = { v: FanView; on: Map<string, (e: unknown) => void>; w: number };
/** The view on its side (hominins.test.ts's rig), its column w px long (700, or the phone's 663: 390 x 844 under the bar, the chain and the time axis, measured in the browser). */
function rig(w = 700): Rig {
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
  return { v: new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true), on, w };
}
type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  camera: FanCamera;
  goLevel(lv: Level, cam: Camera, card?: boolean): void;
  carded: FanBranch | null;
  tipLabels?: unknown;
};
const P = (v: FanView) => v as unknown as Priv;

const proc = (globalThis as unknown as { process: { env: Record<string, string>; stderr: { write(s: string): void } } }).process;
/** A finger at view point (x, y): Input turned reads (clientY, box width - clientX), the box `w` wide. */
const finger = (id: number, x: number, y: number, w: number) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: w - y, clientY: x, timeStamp: clock, preventDefault() {} });
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
  r.on.get('pointerdown')!(finger(1, x, y, r.w));
  pass(r, 50);
  r.on.get('pointerup')!(finger(1, x, y, r.w));
}

/** Why a pictured hominin has no name here (tipLabels' reasons, and the ones it never gets to), or 'named'. */
type Why = 'named' | 'on the column' | 'off screen' | 'no room' | 'crossed' | 'meets';
const SAY_WHY: Record<Why, string> = {
  named: 'named',
  'on the column': 'none: it has a lane of its own on the labels’ line',
  'off screen': 'off screen (its tip, or its band at the screen’s edge)',
  'no room': 'no room (its band narrower than a name)',
  crossed: 'no room clear of the lines across its band after its tip',
  meets: 'overlapping: its name meets a label',
};

describe('fossils named and pictured at their own tip (ToLaD#279, #497)', () => {
  const rigs: Rig[] = [];
  beforeAll(async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    await loadMammalsFromFiles();
    setFlip(true);
    // (The 700 px column of the tests before, and the phone's, ToLaD#500.)
    rigs.push(rig(), rig(663.109375));
  }, 300_000);
  afterAll(() => {
    setFlip(false);
    vi.restoreAllMocks();
  });

  const say = (s: string) => proc.env.TIPNAMES_SAY && proc.stderr.write(s + '\n');
  const node = (v: FanView, latin: string) => v.fan.nodes.find((q) => latinOf(q.split) === latin)!;
  /** At a level as a tap on it lands (home: home's frame), nothing open; the fold at the rig's scale. */
  const at = (r: Rig, latin: string | null) => {
    const v = r.v;
    const home = v.homeCamera();
    P(v).anim = null;
    timers.length = 0;
    (v.fan.tess.fold as Steady).setScale(home.sx, v.w);
    v.cam = { ...home, ty: home.sy };
    P(v).camera.settle();
    for (let k = 0; k < 3; k++) v.draw();
    if (latin) {
      P(v).goLevel({ v: node(v, latin) }, home, false);
      settle(r);
    }
    v.onSelect(null);
    P(v).carded = null;
    for (let k = 0; k < 3; k++) v.draw();
  };
  /** The Hominins' landing as Ita reaches it: at Primates, a tap on the human picture (ToLaD#497). */
  const hominins = (r: Rig) => {
    const v = r.v;
    at(r, 'Primates');
    const b = v.fan.branches.find((q) => q.sp.sci === 'Homo sapiens')!;
    const h = v.thumbHits.find((q) => q[3] === b && !q[4])!;
    tapAt(r, h[0], h[1]);
    settle(r);
    const lv = v.levelNow(true);
    expect(lv.v === node(v, 'Hominini') && chainOf(v.fan, levelClade(v.fan, lv)).slice(-1)[0] === 'Hominins', 'at the Hominins').toBe(true);
  };
  const named = (v: FanView, b: FanBranch) => v.nameHits.some((q) => q.b === b);
  const pictured = (v: FanView, b: FanBranch) => v.thumbHits.some((q) => q[3] === b && !q[4]);
  const why = (v: FanView, b: FanBranch): Why => {
    if (named(v, b)) return 'named';
    const missed = v.tipMissed.get(b.index);
    if (missed) return missed;
    const { C, R } = (v.fan.tess.fold as Steady).rooms();
    const w = R[b.index] * v.cam.sx;
    const [c, line] = v.toScreen(C[b.index], b.tipY);
    if (line < 0 || line > v.h || c + w / 2 < 0 || c - w / 2 > v.w) return 'off screen';
    if (w < SPECIES_PX) return 'no room';
    return 'on the column';
  };
  /** Every label's boxes this frame, each with its owner: names, pills, pictures. */
  const boxes = (cut: CutLabels) => [
    ...[...cut.spots, ...cut.names].map((s) => ({ who: s.key, what: s.text, box: s.box as readonly number[] })),
    ...cut.pics.map((p) => ({ who: p.lv.b && !p.held ? `t${p.lv.b.index}` : `g${p.lv.b ? ~p.lv.b.index : p.face.index}`, what: `picture of ${p.face.sp.sci}`, box: picBox(p) })),
  ];
  const meets = (p: readonly number[], q: readonly number[]) => p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1];

  it('at the Hominins’ landing, the pictured hominins are named and pictured at their tips, each missing one for a reason', () => {
    const counts: number[] = [];
    for (const r of rigs) {
      const v = r.v;
      hominins(r);
      // (The fossil hominins with a picture: humans are the column's.)
      const pics = node(v, 'Hominini').strands.filter((b) => b.sp.extinct && WIKI[b.sp.sci]?.img);
      const rows = pics.map((b) => ({ b, why: why(v, b), pic: pictured(v, b) }));
      const both = rows.filter((q) => q.why === 'named' && q.pic).length;
      counts.push(both);
      say(`column ${r.w | 0}: the Hominins' landing, ${pics.length} pictured hominins, ${rows.filter((q) => q.why === 'named').length} named, ${both} named and pictured`);
      for (const q of rows) if (q.why !== 'named' || !q.pic) say(`  ${q.b.sp.sci}: ${q.why === 'named' ? 'named; no picture, both sizes meeting a label' : SAY_WHY[q.why]}`);
      expect(pics.length).toBe(22);
      // (No fossil unnamed with its tip on screen, room, and nothing in its way.)
      expect(rows.filter((q) => q.why === 'on the column' && q.b.sp.extinct).map((q) => q.b.sp.sci)).toEqual([]);
    }
    // (Before: 0 of 22, ToLaD#497. Now 7 on the 700 px column and 6 on the phone's, 9 and 8 named.)
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(6);
  }, 600_000);

  it('no two labels meet: the Hominins’ landing, home, Carnivora, Felidae, Panthera, Primates, Rodentia, Proboscidea, Cetacea', () => {
    const bad: string[] = [];
    for (const r of rigs) {
      const v = r.v;
      for (const lv of ['hominins', null, 'Carnivora', 'Felidae', 'Panthera', 'Primates', 'Rodentia', 'Proboscidea', 'Cetacea']) {
        if (lv === 'hominins') hominins(r);
        else at(r, lv);
        const bs = boxes(v.cutLast!);
        const tips = v.cutLast!.names.filter((s) => s.key.startsWith('t'));
        say(`column ${r.w | 0}, ${lv ?? 'home'}: ${bs.length} label boxes; the fossils named at their tips: ${tips.length} (${tips.map((s) => s.text).join(', ')})`);
        for (let i = 0; i < bs.length; i++)
          for (let j = i + 1; j < bs.length; j++) {
            const [p, q] = [bs[i], bs[j]];
            // (A label's own name and picture are one label.)
            if (p.who !== q.who && meets(p.box, q.box)) bad.push(`column ${r.w | 0}, ${lv ?? 'home'}: "${p.what}" meets "${q.what}"`);
          }
      }
    }
    expect(bad).toEqual([]);
  }, 1_200_000);

  it('the living’s labels are the same with the fossils’ names as without: home, Carnivora, Felidae, Primates, Rodentia', () => {
    const bad: string[] = [];
    const list = (cut: CutLabels) =>
      boxes(cut)
        .filter((q) => !q.who.startsWith('t'))
        .map((q) => `${q.what} @${q.box.map((n) => n.toFixed(1)).join(',')}`)
        .sort();
    for (const r of rigs) {
      const v = r.v;
      for (const lv of [null, 'Carnivora', 'Felidae', 'Primates', 'Rodentia']) {
        at(r, lv);
        const withTips = list(v.cutLast!);
        P(v).tipLabels = () => {};
        for (let k = 0; k < 2; k++) v.draw();
        const without = list(v.cutLast!);
        delete P(v).tipLabels;
        for (let k = 0; k < 2; k++) v.draw();
        const same = JSON.stringify(withTips) === JSON.stringify(without);
        say(`column ${r.w | 0}, ${lv ?? 'home'}: the column's ${without.length} label boxes, the same with the fossils' names: ${same}`);
        if (!same) bad.push(`column ${r.w | 0}, ${lv ?? 'home'}: gone ${without.filter((x) => !withTips.includes(x)).join('; ')}; new ${withTips.filter((x) => !without.includes(x)).join('; ')}`);
      }
    }
    expect(bad).toEqual([]);
  }, 1_200_000);
});
