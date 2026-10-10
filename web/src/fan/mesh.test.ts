// The individuals mesh (mesh.ts): one function for both lanes, and the GPU's
// decisions (the shader's integer hash, mirrored by lifeGPU) agree with procgen.
import { describe, expect, it } from 'vitest';
import { MESH_F, MESH_U, colourCode, Lane, lifeGPU, lineageThreshold, packInst, shadeMesh, type MeshInst } from './mesh';
import { layoutFan } from './layout';
import { PANTHERA } from './panthera';
import { laneInstances, TwigModel, type MeshLane, type TwigView } from './twigs';
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

/** A plain view on the lion's lanes: width zoom sx, time zoom sy, centred at world (cx, cy). */
function view(cx: number, cy: number, sx: number, sy: number): TwigView {
  const w = 390;
  const h = 844;
  return {
    ctx: null as unknown as CanvasRenderingContext2D,
    w,
    h,
    sx,
    sy,
    toScreen: (x, y) => [(x - cx) * sx + w / 2, (y - cy) * sy + h / 2],
    toWorld: (px, py) => [cx + (px - w / 2) / sx, cy + (py - h / 2) / sy],
    yNow: fan.time.y(0),
  };
}

describe('one mesh for both lanes', () => {
  for (const mode of [0, 1] as const) {
    it(`the green and gray lanes get the same instances from the same function; only the lane differs (${mode ? 'lives' : 'texture'})`, () => {
      const y = fan.time.y(200e-6);
      const L = m.lanes(y);
      // The same strip of width given to either kind of lane.
      const at = () => ({ left: L.left, w: L.w - L.gw });
      const green: MeshLane = { lane: Lane.Green, at };
      const gray: MeshLane = { lane: Lane.Gray, at };
      const n = m.size(m.generationAt(y));
      const sx = mode ? (6 * n) / (L.w - L.gw) : (0.3 * n) / (L.w - L.gw);
      const v = view(L.left + L.gw + (L.w - L.gw) / 2, y, sx, mode ? 400 : 30);
      const [, yTop] = v.toWorld(0, 0);
      const [, yBot] = v.toWorld(0, v.h);
      const a: MeshInst[] = [];
      const b: MeshInst[] = [];
      laneInstances(v, m, green, yTop, yBot, mode, 1, { lw: 1.5, tipR: 1.5 }, a);
      laneInstances(v, m, gray, yTop, yBot, mode, 1, { lw: 1.5, tipR: 1.5 }, b);
      expect(a.length).toBeGreaterThan(1);
      expect(b.map((x) => ({ ...x, lane: 0 }))).toEqual(a);
      // Pixel by pixel: the same individuals, at the same places, lit the same; a dead one
      // differs only by colour (pale green in the living's lane, gray or pale green in the
      // dead's); the living are drawn in the green lane only.
      const kLog = 1e-3;
      let same = 0;
      let lit = 0;
      for (let k = 0; k < Math.min(a.length, 40); k++) {
        for (let py = a[k].y0 + 0.5; py < a[k].y1; py += 2) {
          for (let px = 0.5; px < v.w; px += 1.7) {
            const p = shadeMesh(a[k], px, py, kLog, -1e9, PAL);
            const q = shadeMesh(b[k], px, py, kLog, -1e9, PAL);
            if (p[3] > 0) lit++;
            if (q[3] > 0) {
              expect(q[3]).toBeCloseTo(p[3], 9);
              same++;
            }
          }
        }
      }
      expect(lit).toBeGreaterThan(50);
      expect(same).toBeGreaterThan(0.5 * lit);
    });
  }

  it('the colour of an individual is what it is: alive, line carried on, or ended', () => {
    expect(colourCode(Lane.Green, true, false)).toBe(0);
    expect(colourCode(Lane.Green, false, false)).toBe(1);
    expect(colourCode(Lane.Gray, true, true)).toBe(-1);
    expect(colourCode(Lane.Gray, false, true)).toBe(1);
    expect(colourCode(Lane.Gray, false, false)).toBe(2);
    expect(colourCode(Lane.Withered, false, true)).toBe(3);
  });

  it('a cell mixes the colours of the lives in it by how much of the band they cover', () => {
    const y = fan.time.y(3000e-6);
    const L = m.lanes(y);
    const ln: MeshLane = { lane: Lane.Gray, at: () => ({ left: L.left + L.gw, w: L.w - L.gw }) };
    const v = view(L.left + L.gw + (L.w - L.gw) / 2, y, (2 * m.size(m.generationAt(y))) / (L.w - L.gw), 3);
    const out: MeshInst[] = [];
    laneInstances(v, m, ln, ...([v.toWorld(0, 0)[1], v.toWorld(0, v.h)[1]] as [number, number]), 0, 1, { lw: 0.9, tipR: 0 }, out);
    const mixed = new Set<string>();
    for (const inst of out.slice(0, 60)) {
      expect(inst.gBoff).toBeGreaterThan(0); // two sample generations per band
      for (let px = inst.x0 + 0.5; px < inst.x1; px += 1) {
        const c = shadeMesh(inst, px, (inst.y0 + inst.y1) / 2, 1e-3, -1e9, PAL);
        if (c[3] > 0) mixed.add(c.slice(0, 3).map((x) => x.toFixed(3)).join());
      }
    }
    // Pure gray, pure pale green, and blends of the two.
    expect(mixed.size).toBeGreaterThan(2);
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
    packInst({ x0: 1, y0: 2, x1: 3, y1: 4, slotX0: 5, slotDx: 6, lw: 7, fineA: 0.5, p0: 9, T0: 10, A: 11, gBoff: 12, alpha: 0.25, mode: 1, lane: Lane.Gray, tipR: 16, GL: 17, Lm: 18, nowRel: 19, iBase: 1, iStep: 2, nA: 3, nB: 4, seedA: 4294967295, seedB: 6, thrA: 7, thrB: 8 }, f, u, 0);
    expect([...f.slice(0, 19)]).toEqual([1, 2, 3, 4, 5, 6, 7, 0.5, 9, 10, 11, 12, 0.25, 1, 1, 16, 17, 18, 19]);
    expect([...u]).toEqual([1, 2, 3, 4, 4294967295, 6, 7, 8]);
  });
});
