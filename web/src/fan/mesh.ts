// The individuals mesh: one function for both lanes, evaluated per pixel on
// the GPU (meshgl.ts) and mirrored here on the CPU (shadeMesh, shadeTree) for
// tests.
//
// Width = individuals, in both lanes alike. A branch's column is one lattice of
// slots fixed in the world, one individual wide each (TwigModel.pitch), from
// the column's left edge: the living's green lane holds the first slots, the
// dead's gray lane the rest (layout.ts). The structure (slot pitch, band
// height, line weight, level of detail) depends only on world position, time
// and zoom, never on the lane; the lane chooses the colour of the individual
// in a slot, and where the lanes meet the colours blend.
//
// Who is in a slot (TwigModel.individualsAt): slot K holds index K mod n of
// generation g (n its size: a lane wider than its generation repeats it); a
// green slot also holds the living of g at K + c·nG (nG green slots), so every
// living individual has a green slot. The colour is what the individual is:
//   - deep green: alive now (green lane only);
//   - pale green: dead with living descendants (in the living's lane, every
//     dead individual: the lane is their line; in the dead's lane, by the
//     hashed lineage model below);
//   - gray: dead, line ended (withered for extinct species).
// Three looks, crossfaded by zoom (twigs.ts):
//   - tree (mode 2): above ~100 individuals per width scale bar, a branching
//     tree of strands, each standing for 2^L individuals, side branches
//     joining their parent strand going back in time and ending in a tip
//     (TwigModel.treeInstances: hashed per strand and epoch on the CPU, drawn
//     as cheap segment instances);
//   - texture (mode 0): a thin line per slot, as bright as the lives of two
//     sample generations of the band cover it (when generations are too thin
//     on screen for lives);
//   - lives (mode 1): every individual's own life, birth to death, on its
//     slot, with a dot at its end.
//
// Everything the GPU needs per individual comes from procgen's integer hash
// (HASH_GLSL is bit-identical to hash.ts): the attribute seed of generation g
// (attrSeed, per instance), mixed with the index on the GPU.

import { hashNum, mix, rand, randFloat } from '../../../packages/procgen/src/hash.ts';
import type { Species } from '../../../packages/procgen/src/index.ts';

/** procgen species.ts: the attributes stream tag and its fields. */
const TAG_ATTR = 0xa7;
export const F_BIRTH = 1;
export const F_LIFE_A = 2;
export const F_LIFE_B = 3;
/** The lineage model's field (procgen leaves counters ≥ 16 free). */
export const F_LINEAGE = 17;

/** Attribute seed of generation g: procgen's genSeed(TAG_ATTR, g). */
export function attrSeed(sp: Species, g: number): number {
  return hashNum(mix(sp.seed, TAG_ATTR), g);
}

/**
 * Lineage model: a dead individual k generations before the end has a living
 * descendant with the probability that its line survives k generations of a
 * critical branching process, ≈ 2/(k+2). Returned as a uint32 threshold for
 * the individual's own hash (field F_LINEAGE): deterministic, the same on the
 * CPU and the GPU. 0 for extinct species.
 */
export function lineageThreshold(G: number, g: number, extinct: boolean): number {
  if (extinct) return 0;
  const k = Math.max(1, G - g);
  return Math.min(4294967295, Math.floor((2 / (k + 2)) * 4294967296));
}

export const enum Lane {
  Green = 0,
  Gray = 1,
  Withered = 2,
}

/** Colour of an individual: 0 deep green (alive), 1 pale green (lineage), 2 gray, 3 withered; -1 not in this lane. */
export function colourCode(lane: Lane, alive: boolean, lineage: boolean): number {
  if (lane === Lane.Green) return alive ? 0 : 1;
  if (alive) return -1; // the living are in the green lane
  if (lane === Lane.Withered) return 3;
  return lineage ? 1 : 2;
}

/** One individual as the GPU sees it: birth and life (years, from the start of its generation), alive, lineage. */
export function lifeGPU(seed: number, i: number, GL: number, Lm: number, nowRel: number, thr: number): { birth: number; life: number; alive: boolean; lineage: boolean } {
  const h = mix(seed, i >>> 0);
  const birth = randFloat(h, F_BIRTH) * GL;
  const life = Lm * (randFloat(h, F_LIFE_A) + randFloat(h, F_LIFE_B));
  return { birth, life, alive: birth <= nowRel && birth + life > nowRel, lineage: rand(h, F_LINEAGE) >>> 0 < thr };
}

/** Floats and uints per instance (meshgl.ts attribute layout). */
export const MESH_F = 20;
export const MESH_U = 12;
/** Most living folded onto one green slot (generations up to this many times the living). */
export const MAX_FOLD = 8;

/**
 * One instance of the texture (mode 0) or the lives (mode 1): a screen
 * rectangle of one branch's column (both lanes) over one band (texture) or one
 * generation (lives), within one stretch of constant column width.
 */
export interface MeshInst {
  /** Screen rectangle (CSS px). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen x of the first drawn slot's centre, px between drawn slots, line width, fade of the odd (finer) drawn slots. */
  slotX0: number;
  slotDx: number;
  lw: number;
  fineA: number;
  /** Time at screen y p0, relative to the start of generation gA (years), and age + TIME_C there (years). */
  p0: number;
  T0: number;
  A: number;
  /** Generation of the second sample after gA (0: one sample). */
  gBoff: number;
  alpha: number;
  mode: 0 | 1;
  /** The lane right of xG: Gray or Withered. */
  lane: Lane;
  tipR: number;
  GL: number;
  Lm: number;
  /** procgen "now" relative to the start of generation gA (years). */
  nowRel: number;
  /** Screen x of the green lane's right edge (no green lane: below x0). */
  xG: number;
  /** Index in generation A (B) of the first drawn slot (its slot mod the generation's size); slots per drawn slot. */
  iBase: number;
  iBaseB: number;
  iStep: number;
  nA: number;
  nB: number;
  seedA: number;
  seedB: number;
  thrA: number;
  thrB: number;
  /** Green slots (the stride of the living folded onto them) and how many fold (1: none). */
  nG: number;
  fold: number;
}

/**
 * One segment of the tree texture (mode 2): a strand from screen y yA (its
 * start, where it leaves its parent strand at x xp) up to yB (its tip), on x xm.
 */
export interface TreeInst {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  xm: number;
  xp: number;
  lw: number;
  yA: number;
  yB: number;
  /** Height (px) over which it bends from its parent onto its own x. */
  J: number;
  alpha: number;
  lane: Lane;
  /** Screen x of the green lane's right edge; above screen y aliveY the green lane is the living. */
  xG: number;
  aliveY: number;
}

export function packInst(m: MeshInst, f: Float32Array, u: Uint32Array, k: number): void {
  const o = k * MESH_F;
  f[o] = m.x0;
  f[o + 1] = m.y0;
  f[o + 2] = m.x1;
  f[o + 3] = m.y1;
  f[o + 4] = m.slotX0;
  f[o + 5] = m.slotDx;
  f[o + 6] = m.lw;
  f[o + 7] = m.fineA;
  f[o + 8] = m.p0;
  f[o + 9] = m.T0;
  f[o + 10] = m.A;
  f[o + 11] = m.gBoff;
  f[o + 12] = m.alpha;
  f[o + 13] = m.mode;
  f[o + 14] = m.lane;
  f[o + 15] = m.tipR;
  f[o + 16] = m.GL;
  f[o + 17] = m.Lm;
  f[o + 18] = m.nowRel;
  f[o + 19] = m.xG;
  const q = k * MESH_U;
  u[q] = m.iBase;
  u[q + 1] = m.iStep;
  u[q + 2] = m.nA;
  u[q + 3] = m.nB;
  u[q + 4] = m.seedA;
  u[q + 5] = m.seedB;
  u[q + 6] = m.thrA;
  u[q + 7] = m.thrB;
  u[q + 8] = m.iBaseB;
  u[q + 9] = m.nG;
  u[q + 10] = m.fold;
  u[q + 11] = 0;
}

export function packTree(m: TreeInst, f: Float32Array, u: Uint32Array, k: number): void {
  const o = k * MESH_F;
  f.fill(0, o, o + MESH_F);
  f[o] = m.x0;
  f[o + 1] = m.y0;
  f[o + 2] = m.x1;
  f[o + 3] = m.y1;
  f[o + 4] = m.xm;
  f[o + 5] = m.xp;
  f[o + 6] = m.lw;
  f[o + 8] = m.yA;
  f[o + 9] = m.yB;
  f[o + 10] = m.J;
  f[o + 12] = m.alpha;
  f[o + 13] = 2;
  f[o + 14] = m.lane;
  f[o + 16] = m.aliveY;
  f[o + 19] = m.xG;
  u.fill(0, k * MESH_U, (k + 1) * MESH_U);
}

/** Colours (linear 0–1 RGB) by colour code: deep green, pale green, gray, withered. */
export type Palette = [number, number, number][];

const expm1s = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 + x * (0.5 + x / 6)) : Math.exp(x) - 1);
const log1ps = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 - x * (0.5 - x / 3)) : Math.log(1 + x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Line coverage at distance d (px) from its centre, width lw (thinner than a pixel: fainter). */
export function lineAA(d: number, lw: number): number {
  const w = Math.max(lw, 1);
  return Math.max(0, Math.min(1, w * 0.5 + 0.5 - d)) * Math.min(lw, 1);
}

type RGBA = [number, number, number, number];

/** One lane's look at one slot (the shader's shadeLane): colour and coverage, not premultiplied. */
function shadeLane(m: MeshInst, lane: Lane, iA: number, iB: number, d: number, py: number, kLog: number, nowPx: number, pal: Palette, deadGap: number): RGBA {
  const fold = lane === Lane.Green ? m.fold : 1;
  if (m.mode === 0) {
    let cov = 0;
    let ns = 0;
    const col = [0, 0, 0];
    for (let s = 0; s < 2; s++) {
      if (s === 1 && !(m.gBoff > 0)) break;
      ns++;
      const n = s ? m.nB : m.nA;
      const i0 = s ? iB : iA;
      if (!(n > 0)) continue;
      const gOff = s ? m.gBoff * m.GL : 0;
      for (let c = 0; c < fold; c++) {
        const i = i0 + c * m.nG;
        if (c > 0 && i >= n) break;
        const L = lifeGPU(s ? m.seedB : m.seedA, i, m.GL, m.Lm, m.nowRel - gOff, s ? m.thrB : m.thrA);
        if (c > 0 && !L.alive) continue;
        const code = colourCode(lane, L.alive, L.lineage);
        if (code < 0) continue;
        const cv = Math.max(0, Math.min(L.birth + L.life, m.nowRel - gOff) - L.birth);
        cov += cv;
        for (let k = 0; k < 3; k++) col[k] += cv * pal[code][k];
      }
    }
    if (!(cov > 0)) return [0, 0, 0, 0];
    return [col[0] / cov, col[1] / cov, col[2] / cov, Math.min(1, cov / (ns * m.GL)) * lineAA(d, m.lw)];
  }
  let best = 0;
  let bc = -1;
  for (let c = 0; c < fold; c++) {
    const i = iA + c * m.nG;
    if (c > 0 && i >= m.nA) break;
    const L = lifeGPU(m.seedA, i, m.GL, m.Lm, m.nowRel, m.thrA);
    if (c > 0 && !L.alive) continue;
    const code = colourCode(lane, L.alive, L.lineage);
    if (code < 0) continue;
    const k = Math.LN2 * kLog;
    const pyAt = (t: number) => m.p0 + log1ps((m.T0 - t) / m.A) / k;
    const birthPx = pyAt(L.birth);
    let topPx = pyAt(Math.min(L.birth + L.life, m.nowRel));
    if (!L.alive) topPx = Math.max(topPx, nowPx + deadGap);
    if (topPx > birthPx) continue;
    const dy = Math.max(0, topPx - py, py - birthPx);
    const dLine = Math.hypot(d, dy) - m.lw * 0.5;
    const dDot = Math.hypot(d, py - topPx) - m.tipR;
    let a = clamp01(0.5 - Math.min(dLine, dDot));
    // The living glow softly.
    if (code === 0) {
      const g = clamp01(1 - dLine / 5);
      a = Math.max(a, 0.35 * g * g);
    }
    if (a > best) {
      best = a;
      bc = code;
    }
  }
  if (bc < 0) return [0, 0, 0, 0];
  const p = pal[bc];
  return [p[0], p[1], p[2], best];
}

/** Two lanes' looks blended: wg of the green one (coverage-weighted colours). */
function blend(g: RGBA, r: RGBA, wg: number): RGBA {
  const ag = g[3] * wg;
  const ar = r[3] * (1 - wg);
  const a = ag + ar;
  if (!(a > 0)) return [0, 0, 0, 0];
  return [(g[0] * ag + r[0] * ar) / a, (g[1] * ag + r[1] * ar) / a, (g[2] * ag + r[2] * ar) / a, a];
}

/**
 * The mesh at screen point (px, py) for one instance: [r, g, b, a] (not
 * premultiplied), exactly what the fragment shader computes (meshgl.ts), in
 * float64 here. kLog: log2 of (age + TIME_C) per screen px; nowPx: screen y of
 * "now" (dead lives stop DEAD_GAP px short of it).
 */
export function shadeMesh(m: MeshInst, px: number, py: number, kLog: number, nowPx: number, pal: Palette, deadGap = 3): RGBA {
  if (px < m.x0 || px >= m.x1 || py < m.y0 || py >= m.y1) return [0, 0, 0, 0];
  const j = Math.floor((px - m.slotX0) / m.slotDx + 0.5);
  if (j < 0) return [0, 0, 0, 0];
  const lineX = m.slotX0 + j * m.slotDx;
  const d = Math.abs(px - lineX);
  const iA = m.nA > 0 ? ((m.iBase + j * m.iStep) >>> 0) % m.nA : 0;
  const iB = m.nB > 0 ? ((m.iBaseB + j * m.iStep) >>> 0) % m.nB : 0;
  const fine = m.fineA < 1 && (j & 1) === 1 ? m.fineA : 1;
  // Where the lanes meet, the slot's colours blend by how much of it is in each.
  const wg = clamp01((m.xG - lineX) / m.slotDx + 0.5);
  const g = wg > 0 ? shadeLane(m, Lane.Green, iA, iB, d, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
  const r = wg < 1 ? shadeLane(m, m.lane, iA, iB, d, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
  const c = blend(g, r, wg);
  c[3] *= m.alpha * (m.mode === 0 ? fine : 1);
  return c;
}

/** The tree texture at screen point (px, py) for one segment: [r, g, b, a], as the shader computes it. */
export function shadeTree(t: TreeInst, px: number, py: number, pal: Palette): RGBA {
  if (px < t.x0 || px >= t.x1 || py < t.y0 || py >= t.y1) return [0, 0, 0, 0];
  if (py > t.yA) return [0, 0, 0, 0];
  const yc = Math.min(t.yA, Math.max(t.yB, py));
  const s = clamp01((t.yA - yc) / t.J);
  const xu = t.xp + (t.xm - t.xp) * s * s * (3 - 2 * s);
  const slope = ((t.xm - t.xp) * 6 * s * (1 - s)) / t.J;
  const dx = Math.abs(px - xu);
  const d = py < t.yB ? Math.hypot(dx, t.yB - py) : dx / Math.sqrt(1 + slope * slope);
  const a = lineAA(d, t.lw) * t.alpha;
  if (!(a > 0)) return [0, 0, 0, 0];
  const wg = clamp01(t.xG - px + 0.5);
  const cg = pal[py < t.aliveY ? 0 : 1];
  const cr = pal[t.lane === Lane.Withered ? 3 : 2];
  return [cg[0] * wg + cr[0] * (1 - wg), cg[1] * wg + cr[1] * (1 - wg), cg[2] * wg + cr[2] * (1 - wg), a];
}

/** Instance k of packed arrays, back (tests): a mesh instance or a tree segment, by its mode. */
export function unpackInst(f: Float32Array, u: Uint32Array, k: number): MeshInst | TreeInst {
  const o = k * MESH_F;
  const q = k * MESH_U;
  const [x0, y0, x1, y1] = [f[o], f[o + 1], f[o + 2], f[o + 3]];
  if (f[o + 13] === 2) {
    return { x0, y0, x1, y1, xm: f[o + 4], xp: f[o + 5], lw: f[o + 6], yA: f[o + 8], yB: f[o + 9], J: f[o + 10], alpha: f[o + 12], lane: f[o + 14] as Lane, aliveY: f[o + 16], xG: f[o + 19] };
  }
  return {
    x0, y0, x1, y1, slotX0: f[o + 4], slotDx: f[o + 5], lw: f[o + 6], fineA: f[o + 7], p0: f[o + 8], T0: f[o + 9], A: f[o + 10], gBoff: f[o + 11],
    alpha: f[o + 12], mode: f[o + 13] as 0 | 1, lane: f[o + 14] as Lane, tipR: f[o + 15], GL: f[o + 16], Lm: f[o + 17], nowRel: f[o + 18], xG: f[o + 19],
    iBase: u[q], iStep: u[q + 1], nA: u[q + 2], nB: u[q + 3], seedA: u[q + 4], seedB: u[q + 5], thrA: u[q + 6], thrB: u[q + 7], iBaseB: u[q + 8], nG: u[q + 9], fold: u[q + 10],
  };
}

export const isTree = (x: MeshInst | TreeInst): x is TreeInst => 'xm' in x;

/** Time (years from the start of the instance's generation) at screen y, as the shader computes it. */
export function timeAt(m: MeshInst, py: number, kLog: number): number {
  return m.T0 - m.A * expm1s(Math.LN2 * kLog * (py - m.p0));
}
