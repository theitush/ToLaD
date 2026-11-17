// The labels answered for the screen's range (ToLaD#502, labelindex.ts) against the labels from the whole tree, as before:
// the same names, pictures and titles in the same places at every camera. Random cameras over the whole zoom range, then
// the yardstick's gestures (a pinch in and out, a pan, a flight to a species and back) at home, in the largest order and in
// its largest family, each frame drawn both ways; and the landings (openCamera, whose room reads the labels too).
// On the mammals; LABELINDEX_N=7000 (or any size) on the synthetic tree instead, on demand (one tree a process).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { picRanges, type PicCand, type PicRange } from './gaplabels';
import { setLabelIndex } from './labelindex';
import { GROUP_D, PIC_D, PIC_S } from './pics';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import type { Camera } from './camera';
import type { FanNode } from './layout';
import { FanView, type CutLabels, type GapMember } from './view';

const N = Number(process.env.LABELINDEX_N || 0);

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
  frames: Map<string, Camera>;
  framesFan: unknown;
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  openCamera(v: FanNode, deep?: boolean): Camera;
  territories(): never;
  gapCoverAt(T: never, sx: number, win?: readonly [number, number]): GapMember[];
  gapWinLast: { list: GapMember[] } | null;
  gapCoverLast: unknown;
  gapLadder: { slack: number } | null;
  toWorld(x: number, y: number): [number, number];
  toScreen(x: number, y: number): [number, number];
};

/** What a frame shows: every name, pill and picture with its place, and the fossils that went unnamed and why. */
function shown(c: CutLabels, missed: Map<number, string>): string {
  const spot = (s: CutLabels['names'][number]) => [s.key, s.text, s.x, s.y1, s.box, s.plain ?? '', s.fit];
  return JSON.stringify({
    names: c.names.map(spot),
    spots: c.spots.map(spot),
    pics: c.pics.map((p) => [p.x, p.y, p.d ?? 0, p.i, p.face?.index ?? -1, p.held, p.lv.b?.index ?? p.lv.v?.split.taxon ?? '']),
    missed: [...missed],
  });
}

/** picRanges as it was before ToLaD#502 (its scans repeated till nothing moved): the one-scan version must give the same ranges, to the bit. */
function picRangesBefore(cands: readonly PicCand[], fullRoom: number, smallRoom: number): PicRange[] {
  const n = cands.length;
  const byAt = cands.map((_, i) => i).sort((p, q) => cands[p].at - cands[q].at);
  const pos = new Int32Array(n);
  byAt.forEach((i, r) => (pos[i] = r));
  const out: PicRange[] = cands.map((c) => ({ small: c.exit, full: c.exit }));
  const fullDone = new Uint8Array(n);
  const smallDone = new Uint8Array(n);
  const place = (i: number, room: number, end: number, small: boolean): number => {
    const c = cands[i];
    let start = c.enter;
    for (let moved = true; moved && start < end; ) {
      moved = false;
      for (const dir of [-1, 1]) {
        for (let r = pos[i] + dir; r >= 0 && r < n; r += dir) {
          const j = byAt[r];
          const d = Math.abs(cands[j].at - c.at);
          if (d * start >= (room + fullRoom) / 2) break;
          for (const [held, s, e, rj] of [
            [fullDone[j], out[j].full, cands[j].exit, fullRoom],
            [small ? smallDone[j] : 0, out[j].small, out[j].full, smallRoom],
          ]) {
            if (!held || s >= e) continue;
            const part = d > 0 ? (room + rj) / 2 / d : Infinity;
            if (Math.max(start, s) < Math.min(end, e, part)) {
              start = Math.min(e, part);
              moved = true;
            }
          }
        }
      }
    }
    return Math.min(start, end);
  };
  for (let i = 0; i < n; i++) {
    out[i].full = place(i, fullRoom, cands[i].exit, false);
    fullDone[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    out[i].small = place(i, smallRoom, out[i].full, true);
    smallDone[i] = 1;
  }
  return out;
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

describe(`labels from the screen's range against the whole tree's (${N ? `synthetic ${N}` : 'mammals'})`, () => {
  let v: FanView;
  const I = () => v as unknown as Inner;
  let frames = 0;
  let windowed = 0;
  let whole = 0;
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true }));
    else await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
  }, 600000);
  afterAll(() => {
    setLabelIndex(true);
    setFlip(false);
  });

  /** Draws the frame at the view's camera both ways and holds them the same. */
  const same = (what: string) => {
    const cam = { ...I().cam };
    setLabelIndex(false);
    v.draw();
    const before = shown(I().cutLast!, I().tipMissed);
    const all = I().gapCoverAt(I().territories(), I().cam.sx).length;
    I().cam = { ...cam };
    setLabelIndex(true);
    v.draw();
    const after = shown(I().cutLast!, I().tipMissed);
    expect(after, `${what} sx ${cam.sx} cx ${cam.cx} cy ${cam.cy} sy ${cam.sy}`).toBe(before);
    frames++;
    whole += all;
    windowed += I().gapWinLast?.list.length ?? all;
  };

  it("the pictures' zoom ranges in one scan each way, as with scans till nothing moved", () => {
    // (Random sets: clustered centres, nested zoom ranges, some at one centre.)
    const rnd = rng(464);
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(rnd() * 120);
      const cands: PicCand[] = Array.from({ length: n }, () => {
        const enter = rnd() < 0.2 ? 0 : 2 ** (rnd() * 12);
        return { at: Math.floor(rnd() * 40) * (rnd() < 0.5 ? 1 : 0.37), enter, exit: rnd() < 0.3 ? Infinity : enter * 2 ** (rnd() * 6) };
      });
      expect(picRanges(cands, GROUP_D, PIC_S + GROUP_D - PIC_D), `set ${t}`).toEqual(picRangesBefore(cands, GROUP_D, PIC_S + GROUP_D - PIC_D));
    }
    // (The tree's own: every member of any cover a candidate, as gapPicsOf takes them.)
    I().gapCoverAt(I().territories(), I().cam.sx);
    const L = I().gapLadder as unknown as { T: { aliveOf(k: number): number }; root: GapMember; parts(g: GapMember): GapMember[]; hands: Map<GapMember, number> };
    const cands: (PicCand & { m: GapMember; alive: number })[] = [];
    const stack: [GapMember, number][] = [[L.root, 0]];
    while (stack.length) {
      const [g, enter] = stack.pop()!;
      const ps = L.parts(g);
      const exit = ps.length ? (L.hands.get(g) ?? Infinity) : Infinity;
      if (g.on >= 0 && enter < exit) cands.push({ m: g, at: g.at, enter, exit, alive: L.T.aliveOf(g.k) });
      for (const p of ps) stack.push([p, exit]);
    }
    cands.sort((p, q) => q.m.band - p.m.band || q.alive - p.alive || p.m.on - q.m.on);
    const plain = cands.map(({ at, enter, exit }) => ({ at, enter, exit }));
    expect(picRanges(plain, GROUP_D, PIC_S + GROUP_D - PIC_D)).toEqual(picRangesBefore(plain, GROUP_D, PIC_S + GROUP_D - PIC_D));
    console.log(`picRanges: ${cands.length} candidates the same`);
  }, 600000);

  it('at random cameras over the whole zoom range', () => {
    const rnd = rng(502);
    const home = I().homeCamera();
    I().cam = { ...home };
    const [x0] = I().toWorld(0, 0);
    const [x1] = I().toWorld(I().w, 0);
    for (let k = 0; k < (N ? 150 : 300); k++) {
      const sx = home.sx * 2 ** (rnd() * 15);
      const sy = home.sy * 2 ** (rnd() * 5 - 1);
      const cx = x0 + rnd() * (x1 - x0);
      const cy = home.cy + (rnd() - 0.5) * (I().h / home.sy);
      I().cam = { ...home, sx, sy, cx, cy };
      same(`random ${k}`);
      // (The whole cover too, its titles' test over each name from its own titles: as from all of them.)
      const cover = (on: boolean) => {
        setLabelIndex(on);
        I().gapCoverLast = null;
        return JSON.stringify(I().gapCoverAt(I().territories(), sx).map((m) => [m.k, m.heads, m.tier, m.pic, m.host?.k ?? null, m.gap]));
      };
      expect(cover(true), `cover sx ${sx}`).toBe(cover(false));
    }
  }, 1200000);

  it('through the gestures: a pinch, a pan and a flight at home, in an order and in a family', () => {
    const marks = N ? synthMarksNow! : { order: 'Carnivora', family: 'Felidae' };
    for (const [depth, cam] of [
      ['home', () => I().homeCamera()],
      ['order', () => I().levelCamera(marks.order)],
      ['family', () => I().levelCamera(marks.family)],
    ] as const) {
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
        same(`${depth} pan ${k}`);
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
  }, 1200000);

  it('the landings: a clade opened the same', () => {
    const rnd = rng(7);
    const nodes = v.fan.nodes.filter((n) => n.parent && n.strands.length > 1);
    for (let k = 0; k < Math.min(N ? 80 : 160, nodes.length); k++) {
      const n = nodes[Math.floor(rnd() * nodes.length)];
      const deep = rnd() < 0.3;
      const open = (on: boolean) => {
        setLabelIndex(on);
        I().framesFan = null;
        const keep = v.fan.tess.fold?.keep();
        const c = I().openCamera(n, deep);
        keep?.();
        return JSON.stringify(c);
      };
      expect(open(true), `${n.split.taxon ?? k}${deep ? ' deep' : ''}`).toBe(open(false));
    }
    setLabelIndex(true);
  }, 600000);

  it('answered from the window: fewer members walked', () => {
    console.log(`lanes' slack ${I().gapLadder?.slack}`);
    expect(windowed).toBeLessThan(whole);
  });

  afterAll(() => {
    console.log(`labelindex ${N || 'mammals'}: ${frames} frames the same; the cover's members a frame walked ${whole} -> ${windowed} (${((100 * windowed) / Math.max(1, whole)).toFixed(1)}%)`);
  });
});
