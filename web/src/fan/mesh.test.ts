// The individuals mesh (mesh.ts): one function for both lanes, and the GPU's
// decisions (the shader's integer hash, mirrored by lifeGPU) agree with procgen.
import { describe, expect, it } from 'vitest';
import { MESH_F, MESH_U, colourCode, Lane, latticeLines, latticeRep, latticeTop, lifeGPU, lineageThreshold, packInst, shadeMesh, unpackInst, type MeshInst } from './mesh';
import { layoutFan } from './layout';
import { FanCamera } from './camera';
import { MeshBatch } from './meshgl';
import { PANTHERA } from './panthera';
import { drawTwigs, kLogAt, lineLevel, SCALE_BAR_PX, TwigModel, type TwigView } from './twigs';
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
  const insts: MeshInst[] = [];
  for (let k = 0; k < v.mesh!.n; k++) insts.push(unpackInst(v.mesh!.f, v.mesh!.u, k));
  const xG = c.toScreen(L.left + L.gw, c.cam.cy)[0];
  return { c, v, mm, insts, xG, kLog: kLogAt(v, f.time, c.cam.cy), nowPx: c.toScreen(0, c.yNow)[1] };
}

/** Shade one instance at a point (CPU mirror of the shader). */
function shade(x: MeshInst, px: number, py: number, kLog: number, nowPx: number) {
  return shadeMesh(x, px, py, kLog, nowPx, PAL);
}

// overview, mid, close and deep: the texture of lines, the lives.
const SCENES: [string, string, number, number, number][] = [
  ['overview', 'Lion', 2e5, 1e9, 0.7],
  ['mid', 'Lion', 3000, 1e4, 40],
  ['crossfade', 'Lion', 3000, 50, 40],
  ['close (texture of lives)', 'Lion', 3000, 20, 3],
  ['close (lives)', 'Lion', 3000, 10, 400],
  ['deep (texture)', 'Tiger', 1.5e6, 1e4, 50],
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
        // (The lines only: a lane too narrow for lines is one line its own width, tested below.)
        const allGreen = { ...x, xG: 1e9, narG: 0, narR: 0 };
        const allGray = { ...x, xG: -1e9, narG: 0, narR: 0 };
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
        // The lattice: blocks of 2^lvl individuals, the level of this zoom; the boundary inside the instance's span.
        expect(x.bw / 2 ** x.lvl / pitchPx, `${sp} ${perBar}`).toBeCloseTo(1, 5);
        expect(x.lvl).toBe(lineLevel(pitchPx).L);
        expect(x.latSeed).toBe(mm.latticeSeed);
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
    const a: MeshInst = { x0: 1, y0: 2, x1: 3, y1: 4, xB0: 5, bw: 6, lw: 7, fineA: 0.5, p0: 9, T0: 10, A: 11, gBoff: 12, alpha: 0.25, mode: 1, lane: Lane.Gray, tipR: 16, GL: 17, Lm: 18, nowRel: 19, xG: 20, B0: 1, lvl: 2, latSeed: 9, nA: 3, nB: 4, seedA: 4294967295, seedB: 6, thrA: 7, thrB: 8, nG: 10, fold: 3 };
    packInst(a, f, u, 0);
    expect([...f]).toEqual([1, 2, 3, 4, 5, 6, 7, 0.5, 9, 10, 11, 12, 0.25, 1, 1, 16, 17, 18, 19, 20, 0, 0, 0, 0]);
    expect([...u]).toEqual([1, 2, 3, 4, 4294967295, 6, 7, 8, 9, 10, 3, 0]);
    const b: MeshInst = { ...a, colL: 21, colR: 22, narG: 0.75, narR: 0.5 };
    packInst(b, f, u, 0);
    expect([...f].slice(20)).toEqual([21, 22, 0.75, 0.5]);
    expect(unpackInst(f, u, 0)).toEqual(b);
  });
});

describe('the texture at every zoom: never a plain lane', () => {
  /** Mean coverage of the mesh over the screen columns [x0, x1) (CPU mirror), on rows a few px apart. */
  function coverage(insts: MeshInst[], x0: number, x1: number, kLog: number, nowPx: number, h: number) {
    let a = 0;
    let n = 0;
    for (let py = 60.5; py < h - 60; py += 3) {
      for (let px = Math.floor(x0) + 0.5; px < x1; px += 1) {
        let s = 0;
        for (const x of insts) if (px >= x.x0 && px < x.x1 && py >= x.y0 && py < x.y1) s = Math.max(s, shade(x, px, py, kLog, nowPx)[3]);
        a += s;
        n++;
      }
    }
    return n ? a / n : NaN;
  }
  // The overview (home and beyond), and down in the stem below the species' first generation.
  for (const [name, sp, ago, perBar, sy] of [
    ['overview', 'Lion', 2e5, 1e9, 0.7],
    ['max zoom-out', 'Lion', 1e6, 1e11, 0.25],
    ['the stem, below the species', 'Tiger', 2e7, 1e9, 0.7],
  ] as const) {
    it(`in both lanes the lines cover some of the lane, never none and never all (${name})`, () => {
      const { insts, kLog, nowPx, c, mm } = scene(sp, ago, perBar, sy);
      expect(insts.some((x) => x.mode === 0 && x.alpha > 0.5)).toBe(true);
      const L = mm.lanes(c.cam.cy);
      const [colL] = c.toScreen(L.left, c.cam.cy);
      const gPx = Math.max(1, L.gw * c.cam.sx);
      const wPx = L.w * c.cam.sx;
      // Green lane (drawn at least 1 px), then the gray lane right of it (on screen).
      const g = coverage(insts, colL, colL + gPx, kLog, nowPx, c.h);
      const r = coverage(insts, colL + gPx + 1, Math.min(c.w, colL + wPx), kLog, nowPx, c.h);
      for (const cov of [g, r]) {
        expect(cov).toBeGreaterThan(0.03);
        expect(cov).toBeLessThan(0.97);
      }
    });
  }
});

describe('the drawn lines nest: a line seen at a coarse zoom stays, in place, at every finer one', () => {
  const seed = m.latticeSeed;
  it('the lines of level l + 1 are lines of level l, one per block of 2^l, anywhere in it', () => {
    for (const K0 of [0, 123457, 9e6]) {
      let prev = new Set(latticeLines(seed, 0, K0, K0 + 4096));
      expect(prev.size).toBe(4096);
      for (let l = 1; l <= 10; l++) {
        const cur = latticeLines(seed, l, K0, K0 + 4096);
        for (const K of cur) expect(prev.has(K)).toBe(true);
        expect(cur.length).toBeGreaterThanOrEqual(Math.floor(4096 / 2 ** l) - 1);
        expect(cur.length).toBeLessThanOrEqual(Math.ceil(4096 / 2 ** l) + 1);
        // Block B's line is in block B; a half's line is on top (of level l too) exactly when it is the block's.
        for (let B = Math.ceil(K0 / 2 ** l); B < Math.ceil(K0 / 2 ** l) + 8; B++) {
          const K = latticeRep(seed, l, B);
          expect(Math.floor(K / 2 ** l)).toBe(B);
          for (const h of [2 * B, 2 * B + 1]) expect(latticeTop(seed, l - 1, h)).toBe(latticeRep(seed, l - 1, h) === K);
        }
        prev = new Set(cur);
      }
    }
  });

  it('not a regular grid: the gaps between lines vary', () => {
    const ks = latticeLines(seed, 4, 0, 4096);
    const gaps = new Set(ks.slice(1).map((k, j) => k - ks[j]));
    expect(gaps.size).toBeGreaterThan(8);
  });

  it('zooming out only raises the level (the sets nest), and the full mesh is every slot by ~35 per bar', () => {
    let prev = -Infinity;
    for (let perBar = 10; perBar < 1e8; perBar *= 1.07) {
      const { lambda } = lineLevel(SCALE_BAR_PX / perBar);
      expect(lambda).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = lambda;
    }
    expect(lineLevel(SCALE_BAR_PX / 35).lambda).toBeLessThanOrEqual(1e-9);
    expect(lineLevel(SCALE_BAR_PX / 35).fineA).toBe(1);
    expect(lineLevel(SCALE_BAR_PX / 100).L).toBeGreaterThanOrEqual(2);
    // The fade is continuous across a level: fading lines are gone just as the level steps up.
    const eps = 1e-6;
    for (const L of [1, 2, 5]) {
      // Find the pitch where λ crosses L.
      let lo = 1e-9;
      let hi = 2;
      for (let k = 0; k < 200; k++) {
        const mid = Math.sqrt(lo * hi);
        if (lineLevel(mid).lambda > L) lo = mid;
        else hi = mid;
      }
      expect(lineLevel(lo * (1 - eps)).fineA).toBeCloseTo(1, 3);
      expect(lineLevel(hi * (1 + eps)).fineA).toBeLessThan(1e-3);
    }
  });

  it('the CPU mirror and the shader hash the lattice alike', async () => {
    const { MESH_FS } = await import('./meshgl');
    expect(MESH_FS).toContain('(idx * 0x9e3779b1u) ^ vIdx2.x ^ (l * 0x85ebca6bu)');
  });
});
