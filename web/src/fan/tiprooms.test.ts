// The fossils' names at their tips (ToLaD#502, view.ts clearAt) with their rooms across kept per zoom, against them scanned every
// frame, as before: the same names, pictures and fossils unnamed (and why) in the same places at every camera. Random cameras over
// the whole zoom range, each with a pan at its zoom, then the yardstick's gestures (a pinch in and out, a pan, a flight to a species and
// back) at home and at two depths, each frame drawn both ways, the kept rooms carried from frame to frame as the page does.
// On the page's data (every fossil; TOLAD_FOSSILS=old the old look, TOLAD_TREE=amniotes the amniotes); TIPROOMS_N=31000 (any size) the
// synthetic tree instead, TIPROOMS_FOSSIL its fossils (1.6 as the yardstick's), TIPROOMS_MARKS=order,family the depths.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { setTipRooms } from './labelindex';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles, NODE_TREE } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import type { Camera } from './camera';
import { FanView, type CutLabels } from './view';

const N = Number(process.env.TIPROOMS_N || 0);

function stubView(): FanView {
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
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
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
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Inner = {
  cam: Camera;
  anim: ((now: number) => boolean) | null;
  w: number;
  h: number;
  cutLast: CutLabels | null;
  tipMissed: Map<number, string>;
  tipWork: number;
  tipCut: number;
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  toWorld(x: number, y: number): [number, number];
  toScreen(x: number, y: number): [number, number];
};

/**
 * What a frame shows of the fossils at their tips (and all else): every name and picture with its place, and the fossils unnamed. Why one went unnamed may differ: where its
 * rooms are kept the columns are read first, so a place the columns and the labels standing shut out only together is "meets" or "crossed" by which came last (counted).
 */
function shown(c: CutLabels, missed: Map<number, string>): string {
  const spot = (s: CutLabels['names'][number]) => [s.key, s.text, s.x, s.y1, s.box, s.plain ?? '', s.fit];
  return JSON.stringify({
    names: c.names.map(spot),
    spots: c.spots.map(spot),
    pics: c.pics.map((p) => [p.x, p.y, p.d ?? 0, p.i, p.face?.index ?? -1, p.held, p.lv.b?.index ?? p.lv.v?.split.taxon ?? '']),
    missed: [...missed.keys()],
  });
}

/** What two frames' `shown` differ in, a few of each. */
function diff(a: string, b: string): string {
  const [A, B] = [JSON.parse(a), JSON.parse(b)] as Record<string, unknown[]>[];
  const out: string[] = [];
  for (const k of Object.keys(A)) {
    const [sa, sb] = [new Set(A[k].map((x) => JSON.stringify(x))), new Set(B[k].map((x) => JSON.stringify(x)))];
    const only = (s: Set<string>, t: Set<string>) => [...s].filter((x) => !t.has(x)).slice(0, 4);
    const [oa, ob] = [only(sa, sb), only(sb, sa)];
    if (oa.length || ob.length) out.push(`${k}: before only ${oa.join(' ')} | after only ${ob.join(' ')}`);
  }
  return out.join('; ');
}

/** A small, seeded random source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe(`fossils' rooms kept per zoom against scanned each frame (${N ? `synthetic ${N}` : `${NODE_TREE}, fossils ${process.env.TOLAD_FOSSILS || 'all'}`})`, () => {
  let v: FanView;
  const I = () => v as unknown as Inner;
  let frames = 0;
  let named = 0;
  // (Strands read on a row a frame, scanned against kept; and frames whose scan ran out of a budget, TIP_WORK or TIP_TRY.)
  const work = { before: 0, after: 0, panBefore: 0, panAfter: 0, budget: 0, budgetAfter: 0, whys: 0, whyOther: 0 };
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true, ...(process.env.TIPROOMS_FOSSIL ? { fossil: Number(process.env.TIPROOMS_FOSSIL) } : {}) }));
    else await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
  }, 600000);
  afterAll(() => {
    setTipRooms(true);
    setFlip(false);
  });

  /** Draws the frame at the view's camera both ways and holds them the same. */
  const same = (what: string, pan = false) => {
    const cam = { ...I().cam };
    setTipRooms(false);
    v.draw();
    const before = shown(I().cutLast!, I().tipMissed);
    const [wb, cut] = [I().tipWork, I().tipCut];
    const whyBefore = new Map(I().tipMissed);
    I().cam = { ...cam };
    setTipRooms(true);
    v.draw();
    const after = shown(I().cutLast!, I().tipMissed);
    work.budgetAfter += I().tipCut ? 1 : 0;
    for (const [k, w] of I().tipMissed) {
      const w0 = whyBefore.get(k);
      if (w0 !== undefined && w0 !== w) work[w0 === 'meets' ? 'whys' : 'whyOther']++;
    }
    // (Where the scan ran out of its budget (TIP_WORK) it named less than it could: no answer to hold the kept rooms to.)
    if (cut) work.budget++;
    else {
      if (after !== before) console.log(`${what}: ${diff(before, after)}`);
      expect(after, `${what} sx ${cam.sx} cx ${cam.cx} cy ${cam.cy} sy ${cam.sy}`).toBe(before);
    }
    frames++;
    named += I().cutLast!.names.filter((s) => /^tg?\d/.test(s.key)).length;
    work.before += wb;
    work.after += I().tipWork;
    if (pan) [work.panBefore, work.panAfter] = [work.panBefore + wb, work.panAfter + I().tipWork];
  };

  it('at random cameras over the whole zoom range, each with a pan', () => {
    const rnd = rng(502);
    const home = I().homeCamera();
    I().cam = { ...home };
    const [x0] = I().toWorld(0, 0);
    const [x1] = I().toWorld(I().w, 0);
    for (let k = 0; k < (N ? 100 : 200); k++) {
      const sx = home.sx * 2 ** (rnd() * 15);
      const sy = home.sy * 2 ** (rnd() * 5 - 1);
      const cx = x0 + rnd() * (x1 - x0);
      const cy = home.cy + (rnd() - 0.5) * (I().h / home.sy);
      I().cam = { ...home, sx, sy, ty: sy, cx, cy };
      same(`random ${k}`);
      I().cam = { ...home, sx, sy, ty: sy, cx: cx + (rnd() - 0.5) * (200 / sx), cy: cy + (rnd() - 0.5) * (200 / sy) };
      same(`random ${k} panned`, true);
    }
  }, 1800000);

  it('through the gestures: a pinch, a pan and a flight at home and at two depths', () => {
    const marks = process.env.TIPROOMS_MARKS?.split(',') ?? (N ? [synthMarksNow!.order, synthMarksNow!.family] : ['Rodentia', 'Primates']);
    for (const [depth, cam] of [['home', () => I().homeCamera()], ...marks.map((m) => [m, () => I().levelCamera(m)] as const)] as const) {
      const c = cam();
      expect(c, depth).toBeTruthy();
      I().cam = c!;
      same(`${depth} landed`);
      I().gestureStart();
      for (let k = 0; k < 40; k++) {
        v.zoomAbout(I().w / 2, I().h / 2, k < 20 ? 1.06 : 1 / 1.06);
        same(`${depth} pinch ${k}`);
      }
      I().gestureEnd();
      I().levelNow(true);
      I().gestureStart();
      for (let k = 0; k < 30; k++) {
        v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3);
        same(`${depth} pan ${k}`, true);
      }
      I().gestureEnd();
      I().levelNow(true);
      const on = v.fan.branches.filter((b) => {
        const [x] = I().toScreen(b.cx, b.tipY);
        return x > 0 && x < I().w;
      });
      const b = (on.length ? on : v.fan.branches).reduce((p, x) => (x.width > p.width ? x : p));
      for (const go of [() => v.flyToSpecies(b.sp, false), () => v.resetView()]) {
        go();
        let now = performance.now();
        for (let k = 0; k < 600 && I().anim; k++) {
          now += 16.7;
          const a = I().anim!;
          if (!a(now)) I().anim = null;
          same(`${depth} flight ${k}`);
        }
      }
    }
  }, 1800000);

  afterAll(() => {
    console.log(
      `tiprooms ${N || NODE_TREE}: ${frames} frames the same, ${named} fossil names; strands read on a row ${work.before} -> ${work.after}, on pans ${work.panBefore} -> ${work.panAfter}; frames the scan ran out of TIP_WORK ${work.budget}; kept ran out of TIP_WORK ${work.budgetAfter}; why "meets" -> "crossed" ${work.whys}, "crossed" -> "meets" ${work.whyOther}`,
    );
  });
});
