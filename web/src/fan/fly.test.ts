// Flights are slow and smooth, in and out (ToLaD#246): every step of a flight's camera path is small and close to the
// steps around it (no lurch mid-flight, no snap at the end: the last step no bigger than the ones before), folded and
// not, into a species, a clade, across the order and back home; and the landing is the frame computed there.
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, type FanBranch } from './layout';
import { CARNIVORA } from './panthera';
import { CARNIVORA_TREE } from './splits';
import type { Camera } from './camera';
import { flightMs, flightPath, FanView } from './view';

function stubView(folds: boolean): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, CARNIVORA, 'curved', CARNIVORA_TREE, folds);
}

type Inner = { anim: ((t: number) => boolean) | null; applyFold(): void };

/** One frame's camera and where the flight's target stands on screen. */
type Shot = { cam: Camera; at: [number, number] };

/**
 * Run the flight under way frame by frame (60 fps), as the app does (the fold at each frame's zoom), recording each
 * frame's camera and the screen point of `mark` (world, where the fold has it).
 */
function record(v: FanView, mark: () => [number, number]): Shot[] {
  const iv = v as unknown as Inner;
  const shots: Shot[] = [{ cam: { ...v.cam }, at: v.toScreen(...mark()) }];
  for (let t = performance.now() + 1000 / 60; iv.anim; t += 1000 / 60) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
    shots.push({ cam: { ...v.cam }, at: v.toScreen(...mark()) });
    if (shots.length > 400) break;
  }
  return shots;
}

/**
 * How far one frame moves the view, in screens: the zoom change (log, each axis), the pan (the screen's centre in
 * screens) and the target's move on screen (in screens), the largest. Folded, the world under the camera moves as the
 * fold opens, so the target's place on screen is what the eye follows.
 */
function step(a: Shot, b: Shot, w: number, h: number, folded: boolean): number {
  const on = (s: Shot) => s.at[0] > -w / 2 && s.at[0] < 1.5 * w && s.at[1] > -h / 2 && s.at[1] < 1.5 * h;
  // (The target's move counts while it is on screen or near: far off it races past, as everything there does.)
  const seen = on(a) && on(b);
  return Math.max(
    Math.abs(Math.log(b.cam.sx / a.cam.sx)),
    Math.abs(Math.log(b.cam.sy / a.cam.sy)),
    (Math.abs(b.cam.cy - a.cam.cy) * Math.min(a.cam.sy, b.cam.sy)) / h,
    // (Folded, world x moves with the fold under the camera: the target's place on screen tells it.)
    folded ? 0 : (Math.abs(b.cam.cx - a.cam.cx) * Math.min(a.cam.sx, b.cam.sx)) / w,
    seen ? Math.abs(b.at[0] - a.at[0]) / w : 0,
    seen ? Math.abs(b.at[1] - a.at[1]) / h : 0,
  );
}

/** What is wrong with a flight's path (none: smooth): a big step, a spike over its neighbours, a jump at the end. */
function judge(name: string, shots: Shot[], w: number, h: number, folded: boolean, ms: [number, number] = [880, 1820]): string[] {
  const d = shots.slice(1).map((s, i) => step(shots[i], s, w, h, folded));
  const bad: string[] = [];
  const dur = (d.length * 1000) / 60;
  if (dur < ms[0] || dur > ms[1]) bad.push(`${name}: ${dur.toFixed(0)} ms`);
  const max = Math.max(...d);
  // (A step: at most a quarter of a screen, or e^0.25 zoomed, at 60 fps: from home into a species zooms ~10^4 in 1.8 s,
  // ~e^0.14 a frame at the ease's fastest.)
  if (!(max <= 0.25)) bad.push(`${name}: a step of ${max.toFixed(3)} screens (frame ${d.indexOf(max)} of ${d.length})`);
  for (let i = 1; i < d.length - 1; i++) {
    const near = Math.max(d[i - 1], d[i + 1]);
    if (d[i] > 2 * near + 0.004) bad.push(`${name}: frame ${i} steps ${d[i].toFixed(4)}, its neighbours ${d[i - 1].toFixed(4)}, ${d[i + 1].toFixed(4)}`);
  }
  // No snap at the end: the landing's step no bigger than the one before (the ease slows to it), and small.
  const [prev, last] = d.slice(-2);
  if (!(last <= Math.max(prev * 1.05, 1e-3)) || last > 0.01) bad.push(`${name}: lands with a step of ${last.toFixed(4)} (the one before ${prev.toFixed(4)})`);
  return bad;
}

function colMark(b: FanBranch): () => [number, number] {
  return () => [leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2, b.tipY];
}

const near = (a: Camera, b: Camera) =>
  Math.abs(Math.log(a.sx / b.sx)) < 1e-6 && Math.abs(Math.log(a.sy / b.sy)) < 1e-6 && Math.abs(a.cx - b.cx) * a.sx < 0.5 && Math.abs(a.cy - b.cy) * a.sy < 0.5;

describe('a flight path (ToLaD#246)', () => {
  it('lands where it aims, zooms out a little for a long pan, and takes longer the farther it goes', () => {
    const p = flightPath(1, 1e-4, 0.3);
    expect(p.at(0)[0]).toBeCloseTo(1, 9);
    expect(p.at(1)[0] / 1e-4).toBeCloseTo(1, 6);
    expect(p.at(1)[1]).toBeCloseTo(1, 6);
    // (A pan of 8 screens at one zoom: out, across, in.)
    const q = flightPath(1, 1, 8);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => q.at(i / 100)[0]));
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThan(12);
    expect(flightMs(0)).toBe(900);
    expect(flightMs(100)).toBe(1800);
    expect(flightMs(q.S)).toBeGreaterThan(flightMs(flightPath(1, 1, 1).S));
  });
});

for (const folds of [true, false]) {
  describe(`flights are smooth start to finish, ${folds ? 'folded' : 'unfolded'} (ToLaD#246)`, () => {
    const v = stubView(folds);
    const iv = v as unknown as Inner;
    const home = () => {
      v.cam = v.homeCamera();
      v.camera.settle();
      iv.applyFold();
    };
    const bs = v.fan.branches;
    const sample = [bs[0], bs[Math.floor(bs.length / 3)], bs[Math.floor((2 * bs.length) / 3)], bs[bs.length - 1]];
    const keep = <T,>(f: () => T): T => {
      const r = v.fan.tess.fold?.keep();
      const x = f();
      r?.();
      return x;
    };

    it('into a species from home, across to another, and back home', () => {
      const bad: string[] = [];
      const stats: string[] = [];
      for (const [i, b] of sample.entries()) {
        home();
        v.flyToSpecies(b.sp, false);
        let s = record(v, colMark(b));
        bad.push(...judge(`home → ${b.sp.common}`, s, v.w, v.h, folds));
        // The landing is the frame computed there (as before the flight's tracking: speciesCamera).
        const want = keep(() => v.speciesCamera(b));
        if (!near(v.cam, want)) bad.push(`${b.sp.common}: landed off its frame`);
        stats.push(`${b.sp.common} ${s.length - 1}f`);
        // Across the order to another species (a long pan at depth).
        const o = sample[(i + 2) % sample.length];
        v.flyToSpecies(o.sp, false);
        s = record(v, colMark(o));
        bad.push(...judge(`${b.sp.common} → ${o.sp.common}`, s, v.w, v.h, folds));
        stats.push(`→ ${o.sp.common} ${s.length - 1}f`);
        // And back out home (the reset).
        v.resetView();
        s = record(v, colMark(o));
        bad.push(...judge(`${o.sp.common} → home`, s, v.w, v.h, folds));
        if (!near(v.cam, keep(() => v.homeCamera()))) bad.push(`${o.sp.common} → home: landed off home`);
      }
      console.log(`${folds ? 'folded' : 'unfolded'}: ${stats.join(', ')}`);
      expect(bad).toEqual([]);
    });

    it("into a clade from home and a step back out to the one above (a bracket's taps)", () => {
      const bad: string[] = [];
      for (const latin of ['Felidae', 'Canidae', 'Mustelidae', 'Ursidae']) {
        const c = v.fan.nodes.find((n) => n.split.taxon === latin);
        if (!c) continue;
        home();
        const mark = (): [number, number] => {
          const bb = v.fan.branches.filter((x) => c.strands.includes(x));
          const l = Math.min(...bb.map((x) => leftAt(x, 0)));
          const r = Math.max(...bb.map((x) => leftAt(x, 0) + laneAt(x, 0).w));
          return [(l + r) / 2, c.y];
        };
        v.tapClade(c);
        bad.push(...judge(`home → ${latin}`, record(v, mark), v.w, v.h, folds));
        if (!near(v.cam, keep(() => v.cladeCamera(c)))) bad.push(`${latin}: landed off its frame`);
        v.tapClade(c);
        bad.push(...judge(`${latin} → out`, record(v, mark), v.w, v.h, folds));
      }
      expect(bad).toEqual([]);
    });
  });
}
