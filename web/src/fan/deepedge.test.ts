// ToLaD#210: zoomed into a small group, the deep past's far columns fade softly, never end in a cut block.
import { describe, expect, it } from 'vitest';
import { MeshBatch, RectBatch } from './meshgl';
import { CARNIVORA } from './panthera';
import { CARNIVORA_TREE } from './splits';
import type { WidthMode } from './layout';
import { FanView } from './view';
import { LEAN_CUT, LEAN_FADE_PX } from './fold';

function stubView(): FanView {
  const g = globalThis as Record<string, unknown>;
  const noop = () => {};
  class P {
    moveTo() {}
    lineTo() {}
    arc() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    rect() {}
  }
  g.Path2D = P;
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  g.window = { devicePixelRatio: 1 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  const ctx: Record<string, unknown> = new Proxy(
    {
      measureText: (t: string) => ({ width: t.length * 7.5 }),
      getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }),
      createLinearGradient: () => ({ addColorStop: noop }),
    },
    {
      get: (o: Record<string, unknown>, k: string) => (k in o ? o[k] : noop),
      set: (o: Record<string, unknown>, k: string, val) => ((o[k] = val), true),
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      width: 390,
      height: 844,
      left: 0,
      top: 0,
      right: 390,
      bottom: 844,
    }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  const v = new FanView(canvas as unknown as HTMLCanvasElement, CARNIVORA, 'curved', CARNIVORA_TREE, true);
  const gl = {
    under: new RectBatch(),
    mesh: new MeshBatch(),
    over: new RectBatch(),
    begin() {},
    end() {},
  };
  gl.begin = () => {
    gl.under.n = 0;
    gl.mesh.n = 0;
    gl.over.n = 0;
  };
  (v as unknown as { gl: unknown }).gl = gl;
  return v;
}

/** designshot.mjs's 'group' scene: the species matching `re` filling `fill` of the width at `ma` Mya, time zoom tz × home. */
function group(v: FanView, re: RegExp, fill: number, ma: number, tz: number): void {
  const fan = v.fan;
  const g = fan.branches.filter((b) => re.test(b.sp.sci));
  const h = v.homeCamera();
  const y = fan.time.y(ma);
  const fd = fan.tess.fold!;
  let sx = h.sx;
  let cx = h.cx;
  const span = () => {
    const at = (b: (typeof g)[number]) => fd.left(b.index, y) ?? v.model(b).lanes(y).left;
    const lo = Math.min(...g.map(at));
    const hi = Math.max(...g.map((b) => at(b) + v.model(b).lanes(y).w));
    return [lo, hi];
  };
  for (let k = 0; k < 8; k++) {
    fd.setScale(sx, v.w);
    let [lo, hi] = span();
    if (fd.setAnchor((lo + hi) / 2, y, sx, v.w)) [lo, hi] = span();
    cx = (lo + hi) / 2;
    sx = (fill * v.w) / Math.max(hi - lo, 1e-9);
  }
  fd.setScale(sx, v.w);
  if (fd.setAnchor(cx, y, sx, v.w)) {
    const [lo, hi] = span();
    cx = (lo + hi) / 2;
  }
  v.cam = { cx, cy: y, sx, sy: h.sy * tz, ty: h.sy * tz };
  v.camera.settle();
}

const SCENES: [string, RegExp, number, number, number][] = [
  ['weasels', /^Mustela /, 0.85, 6, 1.6],
  ['ferretbadgers', /^Melogale /, 0.85, 3, 2.5],
];

/**
 * The widest flat edge the lanes drawn end in (px): the lanes' cover (the most opaque gray or green lane at each
 * pixel, from the GPU batch's trapezoids), and in each row the longest run of pixels whose cover differs by more
 * than half from the row above (a lean's shift excused), away from "now" (where every living column ends, rightly flat) and the bottom of the world (where every one begins).
 */
function flatEdge(v: FanView): { px: number; at: string } {
  const W = Math.round(v.w);
  const H = Math.round(v.h);
  const cover = new Float32Array(W * H);
  const b = (v as unknown as { gl: { under: RectBatch } }).gl.under;
  for (let i = 0; i < b.n; i++) {
    const [x0, y0, x1, y1, , , , a, dl, dr, cl, cr] = b.f.subarray(12 * i, 12 * i + 12);
    // (The glows, 0.06 and 0.14 at most, are not lanes.)
    if (a < 0.2) continue;
    for (let y = Math.max(0, Math.ceil(y0 - 0.5)); y < Math.min(H, y1 - 0.5); y++) {
      const t = (y + 0.5 - y0) / (y1 - y0);
      let l = x0 + dl * t;
      let r = x1 + dr * t;
      if (cl < cr) {
        l = Math.max(l, cl);
        r = Math.min(r, cr);
      }
      for (let x = Math.max(0, Math.round(l)); x < Math.min(W, Math.round(r)); x++) cover[y * W + x] = Math.max(cover[y * W + x], a);
    }
  }
  const yNow = v.toScreen(0, v.fan.time.y(0))[1];
  const yBot = v.toScreen(0, v.fan.trunkBottom.y)[1];
  let px = 0;
  let at = '';
  for (let y = 1; y < H; y++) {
    if (Math.abs(y - yNow) < 4 || y > yBot - 4) continue;
    let run = 0;
    for (let x = 0; x < W; x++) {
      // (A lane leaning s px per px moves s px a row: only a change no pixel within LEAN_CUT px in the row above
      // explains is an edge across.)
      let lo = 1;
      let hi = 0;
      for (let d = Math.max(0, x - LEAN_CUT); d <= Math.min(W - 1, x + LEAN_CUT); d++) {
        lo = Math.min(lo, cover[(y - 1) * W + d]);
        hi = Math.max(hi, cover[(y - 1) * W + d]);
      }
      const c = cover[y * W + x];
      run = c - hi > 0.5 || lo - c > 0.5 ? run + 1 : 0;
      if (run > px) {
        px = run;
        at = `row ${y} (${v.fan.time.ageAt(v.toWorld(0, y)[1]).toFixed(1)} Ma) to x ${x}`;
      }
    }
  }
  return { px, at };
}

/**
 * How wide a flat edge may be (px): a column's own end, a few px (the deep columns at these zooms are 1-6 px wide),
 * never a block of them side by side, as the far families' columns cut at their culled closings were (100-300 px).
 */
const FLAT_MAX_PX = 8;

describe('deep zoom: no cut blocks (ToLaD#210)', () => {
  it(`zoomed into the weasels and the ferret badgers, no lane ends in a flat edge wider than ${FLAT_MAX_PX} px: the far families' columns fade out below their culled closings; the group's own columns are drawn whole`, () => {
    for (const mode of ['linear', 'log'] as WidthMode[]) {
      const v = stubView();
      v.setMode(mode);
      for (const [name, re, fill, ma, tz] of SCENES) {
        group(v, re, fill, ma, tz);
        v.draw();
        const e = flatEdge(v);
        if (process.env.DEEPEDGE_LOG) console.log(mode, name, e.px, e.at);
        expect(e.px, `${mode} ${name}: ${e.at}`).toBeLessThanOrEqual(FLAT_MAX_PX);
        // (The group's own columns on screen, from their tips down to their splits, are drawn whole away from their own
        // bends steeper than LEAN_MAX (a ferret badger's at this zoom): no far column's fade reaches them.)
        const L = (v as unknown as { lean: { V: Float64Array; lin: Float64Array } }).lean;
        const plan = (v as unknown as { leanPlan(p: unknown): boolean }).leanPlan.bind(v);
        let n = 0;
        for (const b of v.fan.branches.filter((b) => re.test(b.sp.sci))) {
          const hw = b.width / 2;
          const pts = v.lanePoints(b, hw);
          const ySplit = v.toScreen(0, b.splitY)[1];
          const fades = plan(pts);
          const steep = fades
            ? pts
                .slice(0, -1)
                .filter((_, j) => L.lin[j] < 1)
                .map((p) => p.y)
            : [];
          for (let i = 0; i + 1 < pts.length; i++) {
            const [p, q] = [pts[i], pts[i + 1]];
            const x = q.x - hw * v.cam.sx;
            if (!(p.y > q.y) || p.y > ySplit || q.y < 0 || p.y > v.h || x > v.w || x + q.w * v.cam.sx < 0) continue;
            if (steep.some((y) => y > q.y - LEAN_FADE_PX - 4 && y < p.y + LEAN_FADE_PX + 4)) continue;
            n++;
            if (fades) expect(Math.min(L.V[i], L.lin[i], L.V[i + 1]), `${mode} ${name} ${b.sp.sci}`).toBe(1);
          }
        }
        expect(n, `${mode} ${name}`).toBeGreaterThan(5);
      }
    }
  }, 600_000);
});
