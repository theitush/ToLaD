// The individuals mesh (mesh.ts): one function for both lanes, and the GPU's
// decisions (the shader's integer hash, mirrored by lifeGPU) agree with procgen.
import { describe, expect, it } from 'vitest';
import { MESH_F, MESH_U, colourCode, isTree, Lane, lifeGPU, lineageThreshold, packInst, packTree, shadeMesh, shadeTree, unpackInst, type MeshInst, type TreeInst } from './mesh';
import { layoutFan } from './layout';
import { FanCamera } from './camera';
import { MeshBatch } from './meshgl';
import { PANTHERA } from './panthera';
import { drawTwigs, kLogAt, SCALE_BAR_PX, TwigModel, type TwigView } from './twigs';
import { HASH_GLSL } from '../../../packages/procgen/src/glsl.ts';

const fan = layoutFan(PANTHERA, 'linear');
const lion = fan.branches.find((b) => b.sp.common === 'Lion')!;
const m = new TwigModel(lion, fan.time, 'linear');
const PAL: [number, number, number][] = [
  [0, 1, 0],
  [0.5, 1, 0.5],
  [0.5, 0.5, 0.5],
  [0.6, 0.5, 0.4],
];

/**
 * The camera of a scene: species, years ago, individuals per width scale bar,
 * time zoom; centred on the boundary of the species' lanes (green left, gray right).
 */
function scene(sp: string, ago: number, perBar: number, sy: number) {
  const f = layoutFan(PANTHERA, 'linear');
  const b = f.branches.find((x) => x.sp.common === sp)!;
  const mm = new TwigModel(b, f.time, 'linear');
  const c = new FanCamera(f, (x) => new TwigModel(x, f.time, 'linear'));
  c.w = 390;
  c.h = 844;
  const sumEver = f.branches.reduce((a, x) => a + x.sp.ever, 0);
  const y = f.time.y(ago * 1e-6);
  c.cam = { cx: 0, cy: y, sx: ((SCALE_BAR_PX / perBar) * sumEver) / f.trunkWidth, sy, ty: sy };
  c.settle();
  const L = mm.lanes(c.cam.cy);
  c.cam.cx = L.left + L.gw;
  const v: TwigView = {
    mesh: new MeshBatch(),
    ctx: { save() {}, restore() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, fillText() {} } as unknown as CanvasRenderingContext2D,
    w: c.w,
    h: c.h,
    sx: c.cam.sx,
    sy: c.cam.sy,
    toScreen: (x, yy) => c.toScreen(x, yy),
    toWorld: (x, yy) => c.toWorld(x, yy),
    yNow: c.yNow,
  };
  (globalThis as { Path2D?: unknown }).Path2D = class {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
  };
  drawTwigs(v, b, mm, null);
  const insts: (MeshInst | TreeInst)[] = [];
  for (let k = 0; k < v.mesh!.n; k++) insts.push(unpackInst(v.mesh!.f, v.mesh!.u, k));
  const xG = c.toScreen(L.left + L.gw, c.cam.cy)[0];
  return { c, v, mm, insts, xG, kLog: kLogAt(v, f.time, c.cam.cy), nowPx: c.toScreen(0, c.yNow)[1] };
}

/** Shade one instance at a point (CPU mirror of the shader). */
function shade(x: MeshInst | TreeInst, px: number, py: number, kLog: number, nowPx: number) {
  return isTree(x) ? shadeTree(x, px, py, PAL) : shadeMesh(x, px, py, kLog, nowPx, PAL);
}

// overview, mid, close and deep: the tree, the texture of lives, the lives.
const SCENES: [string, string, number, number, number][] = [
  ['overview', 'Lion', 2e5, 1e9, 0.7],
  ['mid', 'Lion', 3000, 1e4, 40],
  ['crossfade', 'Lion', 3000, 50, 40],
  ['close (texture of lives)', 'Lion', 3000, 20, 3],
  ['close (lives)', 'Lion', 3000, 10, 400],
  ['deep (tree)', 'Tiger', 1.5e6, 1e4, 50],
  ['deep (lives)', 'Tiger', 1.5e6, 10, 3000],
];

describe('one mesh for both lanes: the lane only colours', () => {
  for (const [name, sp, ago, perBar, sy] of SCENES) {
    it(`the same geometry and coverage in either lane, colour aside (${name})`, () => {
      const { insts, kLog, nowPx, c } = scene(sp, ago, perBar, sy);
      const lit = insts.filter((x) => x.alpha > 0.01);
      expect(lit.length).toBeGreaterThan(0);
      // Every instance with the lanes' boundary moved off to either side: all green, all gray.
      // (Nobody here is alive: the living, in the green lane only, are the one difference.)
      let n = 0;
      let differ = 0;
      for (const x of lit.slice(0, 400)) {
        const allGreen = { ...x, xG: 1e9 };
        const allGray = { ...x, xG: -1e9 };
        for (let py = Math.max(0, x.y0) + 0.25; py < Math.min(c.h, x.y1); py += 1.7) {
          for (let px = Math.max(0, x.x0) + 0.25; px < Math.min(c.w, x.x1); px += 0.9) {
            const p = shade(allGreen, px, py, kLog, nowPx);
            const q = shade(allGray, px, py, kLog, nowPx);
            expect(q[3]).toBeCloseTo(p[3], 9);
            if (p[3] > 0.02) {
              n++;
              if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 0.05) differ++;
            }
          }
        }
      }
      expect(n).toBeGreaterThan(50);
      // ...and the colour is the lane's (gray: some pale green lineage among the dead).
      expect(differ).toBeGreaterThan(0.3 * n);
    });
  }

  for (const [name, sp, ago, perBar, sy] of SCENES.filter((s) => s[0] !== 'overview')) {
    it(`a patch of the green lane and one of the gray lane have the same statistics (${name})`, () => {
      const { insts, kLog, nowPx, c, xG } = scene(sp, ago, perBar, sy);
      // Mean coverage over a patch left of the boundary (green) and one right of it (gray).
      const W = 40;
      const cover = (x0: number) => {
        let a = 0;
        let n = 0;
        for (let py = 100.5; py < c.h - 100; py += 2) {
          for (let px = x0 + 0.5; px < x0 + W; px += 1) {
            let s = 0;
            for (const x of insts) if (px >= x.x0 && px < x.x1 && py >= x.y0 && py < x.y1) s = Math.max(s, shade(x, px, py, kLog, nowPx)[3]);
            a += s;
            n++;
          }
        }
        return a / n;
      };
      const g = cover(xG - 4 - W);
      const r = cover(xG + 4);
      expect(g).toBeGreaterThan(0.01);
      expect(r / g).toBeGreaterThan(0.6);
      expect(r / g).toBeLessThan(1 / 0.6);
    });
  }

  it('every instance spans both lanes with one lattice: one pitch per individual, whichever lane', () => {
    for (const [, sp, ago, perBar, sy] of SCENES) {
      const { insts, mm, c, xG } = scene(sp, ago, perBar, sy);
      const pitchPx = mm.pitch(c.cam.cy) * c.cam.sx;
      for (const x of insts) {
        if (isTree(x)) continue;
        // The lattice: drawn slots a power of two of individuals apart; the boundary inside the instance's span.
        const k = Math.log2(x.slotDx / pitchPx);
        expect(Math.abs(k - Math.round(k)), `${sp} ${perBar}`).toBeLessThan(1e-5);
        if (x.x0 > 0 && x.x1 < c.w) {
          expect(x.xG).toBeCloseTo(xG, 6);
        }
      }
    }
  });

  it('the colour of an individual is what it is: alive, line carried on, or ended', () => {
    expect(colourCode(Lane.Green, true, false)).toBe(0);
    expect(colourCode(Lane.Green, false, false)).toBe(1);
    expect(colourCode(Lane.Gray, true, true)).toBe(-1);
    expect(colourCode(Lane.Gray, false, true)).toBe(1);
    expect(colourCode(Lane.Gray, false, false)).toBe(2);
    expect(colourCode(Lane.Withered, false, true)).toBe(3);
  });

  it('the living are all in the green lane: every living individual has a green slot that draws it', () => {
    const y = m.row(m.G - 1).y;
    const nG = m.greenSlots(y);
    let alive = 0;
    for (let g = m.aliveFrom; g < m.G; g++) {
      const n = m.size(g);
      for (let k = 0; k < 300; k++) {
        const i = Math.floor(((k * 2654435761) % 4294967296) / 4294967296 * n);
        if (!m.alive(g, i)) continue;
        alive++;
        const K = m.slotOf(g, i, true, y)!;
        expect(K).not.toBeNull();
        expect(K).toBeLessThan(nG);
        expect(m.slotIndividuals(K, g, y).some((s) => s.i === i && s.green)).toBe(true);
      }
    }
    expect(alive).toBeGreaterThan(20);
  });
});

describe('GPU and CPU decide alike', () => {
  it('the GPU mirror (24-bit floats from the shared hash) matches procgen: births, lifespans, alive, lineage', () => {
    let alive = 0;
    let lin = 0;
    for (const g of [0, 1000, m.G - 40, m.G - 3, m.G - 1]) {
      const n = m.size(g);
      for (let k = 0; k < 400; k++) {
        const i = Math.floor(((k * 2654435761) % 4294967296) / 4294967296 * n);
        const a = m.sp.attributes({ generation: g, index: BigInt(i) });
        const l = lifeGPU(m.seedOf(g), i, m.GL, m.sp.lifespanYears, m.sp.now - g * m.GL, lineageThreshold(m.G, g, false));
        expect(l.birth + g * m.GL).toBeCloseTo(a.birthTime, 3);
        expect(l.life).toBeCloseTo(a.lifespan, 3);
        // The same decision but within float rounding of a boundary (none of these samples are).
        expect(l.alive).toBe(a.alive);
        expect(l.lineage).toBe(m.lineage(g, i));
        if (l.alive) alive++;
        if (l.lineage) lin++;
      }
    }
    expect(alive).toBeGreaterThan(10);
    expect(lin).toBeGreaterThan(10);
  });

  it('the shader uses procgen\'s own hash and the same fields', async () => {
    const { MESH_FS } = await import('./meshgl');
    expect(MESH_FS).toContain(HASH_GLSL);
    for (const f of ['randFloat(h, 1u)', 'randFloat(h, 2u)', 'randFloat(h, 3u)', 'rand(h, 17u)', 'mixh(seed, i)']) expect(MESH_FS).toContain(f);
  });

  it('instances pack into the attribute layout', () => {
    const f = new Float32Array(MESH_F);
    const u = new Uint32Array(MESH_U);
    const a: MeshInst = { x0: 1, y0: 2, x1: 3, y1: 4, slotX0: 5, slotDx: 6, lw: 7, fineA: 0.5, p0: 9, T0: 10, A: 11, gBoff: 12, alpha: 0.25, mode: 1, lane: Lane.Gray, tipR: 16, GL: 17, Lm: 18, nowRel: 19, xG: 20, iBase: 1, iBaseB: 9, iStep: 2, nA: 3, nB: 4, seedA: 4294967295, seedB: 6, thrA: 7, thrB: 8, nG: 10, fold: 3 };
    packInst(a, f, u, 0);
    expect([...f]).toEqual([1, 2, 3, 4, 5, 6, 7, 0.5, 9, 10, 11, 12, 0.25, 1, 1, 16, 17, 18, 19, 20]);
    expect([...u]).toEqual([1, 2, 3, 4, 4294967295, 6, 7, 8, 9, 10, 3, 0]);
    expect(unpackInst(f, u, 0)).toEqual(a);
    const t: TreeInst = { x0: 1, y0: 2, x1: 3, y1: 4, xm: 5, xp: 6, lw: 0.5, yA: 8, yB: 9, J: 10, alpha: 0.25, lane: Lane.Withered, xG: 13, aliveY: 14 };
    packTree(t, f, u, 0);
    expect(unpackInst(f, u, 0)).toEqual(t);
  });
});
