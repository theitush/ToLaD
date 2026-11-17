// The merged clades' green shares by blocks kept per row (green.ts) and the width zoom's cap by tip (camera.ts thinnestAt),
// against the walks they replace (ToLaD#502): every green share drawMerged asks and every cap the camera asks, at random
// cameras over the whole zoom range and through the yardstick's gestures (a pinch in and out, a pan, a flight to a species
// and back) at home, in an order and in a family, each held to the old walk's answer: the caps the same to the bit, the
// shares the same to 1e-12 (the same terms, added block by block). Then the cap at every branch's tip and between, and the
// shares of random clades at random grid rows, directly; and the cap with log widths.
// On the mammals; GREEN_N=7000 (or any size) on the synthetic tree instead, on demand (one tree a process).
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FanCamera, STRAND_PX, type Camera } from './camera';
import { setFlip } from './flip';
import { GreenRuns } from './green';
import { lanesAt, type FanBranch, type FanNode } from './layout';
import { Lod } from './lod';
import { loadMammals } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { synthLevelData, synthMarksNow } from './synthetic-level';
import { FanView } from './view';

const N = Number(process.env.GREEN_N || 0);
/** The counts and the worst difference, to the console (GREEN_LOG=<file>: appended there too). */
const say = (s: string) => {
  console.log(s);
  if (process.env.GREEN_LOG) appendFileSync(process.env.GREEN_LOG, s + '\n');
};

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
  lod: Lod | null;
  gestureStart(): void;
  gestureEnd(): void;
  levelNow(now?: boolean): unknown;
  homeCamera(): Camera;
  levelCamera(n: string): Camera | null;
  toWorld(px: number, py: number): [number, number];
  toScreen(x: number, y: number): [number, number];
};

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

/** The green share as lod.ts worked it out before: every strand of the clade walked, left to right. */
function shareBefore(v: FanNode, y: number): number {
  let g = 0;
  let w = 0;
  for (const b of v.strands) {
    if (y < b.tipY) continue;
    const l = lanesAt(b, y);
    w += l[0];
    g += l[1];
  }
  return w > 0 ? Math.min(1, g / w) : 0;
}

/** The width zoom's cap as camera.ts worked it out before: every branch walked. */
function capBefore(c: FanCamera, wy: number): number {
  const bs = c.fan.branches;
  const yb = c.fan.trunkBottom.y;
  const span = bs.filter((b) => wy >= b.tipY && wy <= yb);
  let cell = Infinity;
  for (const b of span.length ? span : bs) cell = Math.min(cell, c.cellAt(b, Math.min(yb, Math.max(b.tipY, wy))));
  return Math.min(1e14, STRAND_PX / cell);
}

describe(`green shares by blocks and the cap by tip against the walks (${N ? `synthetic ${N}` : 'mammals'})`, () => {
  let v: FanView;
  const I = () => v as unknown as Inner;
  const seen = { shares: 0, caps: 0, worst: 0, frames: 0 };
  /** The old walk's shares, by clade and height (a pure function of both: worked out once each). */
  const before = new Map<FanNode, Map<number, number>>();
  const was = (u: FanNode, y: number) => {
    let m = before.get(u);
    if (!m) before.set(u, (m = new Map()));
    let s = m.get(y);
    if (s === undefined) m.set(y, (s = shareBefore(u, y)));
    return s;
  };
  const green = Lod.prototype.greenShareAt;
  const cap = FanCamera.prototype.sxCap;
  beforeAll(async () => {
    if (N) await loadMammals(() => synthLevelData({ n: N, seed: true, json: true, orders: true }));
    else await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    // (Every share drawMerged asks and every cap the camera asks, held to the walk's.)
    Lod.prototype.greenShareAt = function (u: FanNode, k: number, h: number) {
      const s = green.call(this, u, k, h);
      const d = Math.abs(s - was(u, k * h));
      seen.worst = Math.max(seen.worst, d);
      if (!(d <= 1e-12)) expect(s, `${u.split.taxon ?? u.strands.length} at row ${k} of ${h}`).toBe(was(u, k * h));
      seen.shares++;
      return s;
    };
    FanCamera.prototype.sxCap = function (wx: number, wy: number, sy?: number) {
      const s = cap.call(this, wx, wy, sy);
      expect(s, `cap at ${wy}`).toBe(capBefore(this, wy));
      seen.caps++;
      return s;
    };
  }, 600000);
  afterAll(() => {
    Lod.prototype.greenShareAt = green;
    FanCamera.prototype.sxCap = cap;
    setFlip(false);
    say(`green ${N || 'mammals'}: ${seen.shares} shares (worst ${seen.worst.toExponential(1)}), ${seen.caps} caps, ${seen.frames} frames`);
  });

  const draw = () => {
    v.draw();
    seen.frames++;
  };

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
      draw();
    }
    expect(seen.shares).toBeGreaterThan(1000);
  }, 1200000);

  it('through the gestures: a pinch, a pan and a flight at home, in an order and in a family', () => {
    const marks = N ? synthMarksNow! : { order: 'Rodentia', family: 'Muridae' };
    const caps = seen.caps;
    for (const [depth, cam] of [
      ['home', () => I().homeCamera()],
      ['order', () => I().levelCamera(marks.order)],
      ['family', () => I().levelCamera(marks.family)],
    ] as const) {
      const c = cam();
      expect(c, depth).toBeTruthy();
      I().cam = c!;
      draw();
      I().gestureStart();
      for (let k = 0; k < 40; k++) {
        v.zoomAbout(I().w / 2, I().h / 2, k < 20 ? 1.06 : 1 / 1.06);
        draw();
      }
      I().gestureEnd();
      I().levelNow(true);
      I().gestureStart();
      for (let k = 0; k < 30; k++) {
        v.pan(k < 15 ? 8 : -8, k % 10 < 5 ? 3 : -3);
        draw();
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
          draw();
        }
      }
    }
    expect(seen.caps).toBeGreaterThan(caps + 100);
  }, 1200000);

  it("the cap at every branch's tip, just off it, between and past the fan's ends", () => {
    const c = (v as unknown as { camera: FanCamera }).camera;
    const rnd = rng(17);
    const yb = c.fan.trunkBottom.y;
    const ys: number[] = [NaN, yb, yb + 1, yb - 1e-9, -1e9, 1e9];
    for (const b of c.fan.branches) ys.push(b.tipY, b.tipY - 1e-9 * Math.max(1, Math.abs(b.tipY)), b.tipY + 1e-9 * Math.max(1, Math.abs(b.tipY)));
    const lo = Math.min(...c.fan.branches.map((b) => b.tipY));
    for (let k = 0; k < 2000; k++) ys.push(lo + (yb - lo) * (rnd() * 1.2 - 0.1));
    let k = 0;
    for (const y of ys) {
      // (Every ~7th, to keep the walk's cost down on the synthetic tree; the tips all on the mammals.)
      if (N && k++ % 7) continue;
      expect(c.sxCap(0, y), `cap at ${y}`).toBe(capBefore(c, y));
    }
  }, 600000);

  it('the shares of random clades at random grid rows, directly', () => {
    const fan = v.fan;
    const runs = new GreenRuns(fan);
    const rnd = rng(389);
    const nodes = fan.nodes.filter((u) => u.strands.length >= 2);
    const yb = fan.trunkBottom.y;
    let worst = 0;
    for (let t = 0; t < (N ? 3000 : 6000); t++) {
      const u = nodes[Math.floor(rnd() * nodes.length)];
      const top = Lod.top(u);
      const h = 2 ** Math.floor(rnd() * 12 - 4);
      const k0 = Math.ceil(top / h);
      const k1 = Math.floor(yb / h);
      if (k1 < k0) continue;
      const k = k0 + Math.floor(rnd() * (k1 - k0 + 1));
      const i0 = u.strands[0].index;
      const i1 = u.strands[u.strands.length - 1].index;
      expect(i1 - i0 + 1, 'one run of the tree order').toBe(u.strands.length);
      const d = Math.abs(runs.share(i0, i1, k * h) - shareBefore(u, k * h));
      worst = Math.max(worst, d);
      expect(d, `${u.split.taxon ?? t} at ${k * h}`).toBeLessThanOrEqual(1e-12);
    }
    say(`green ${N || 'mammals'} directly: worst ${worst.toExponential(1)}`);
  }, 600000);

  it('the cap with log widths, kept by height', () => {
    v.setMode('log');
    const c = (v as unknown as { camera: FanCamera }).camera;
    const rnd = rng(5);
    const yb = c.fan.trunkBottom.y;
    const lo = Math.min(...c.fan.branches.map((b: FanBranch) => b.tipY));
    for (let k = 0; k < (N ? 10 : 40); k++) {
      const y = lo + (yb - lo) * rnd();
      expect(c.sxCap(0, y), `log cap at ${y}`).toBe(capBefore(c, y));
      expect(c.sxCap(0, y), `log cap at ${y}, kept`).toBe(capBefore(c, y));
    }
    v.setMode('linear');
  }, 600000);
});
