// The individuals mesh: one function for both lanes, evaluated per pixel on
// the GPU (meshgl.ts) and mirrored here on the CPU (shadeMesh) for tests.
//
// A lane (the living's green lane or the dead's gray lane, layout.ts) is cut
// into cells fixed in the model: a slot (every s-th procgen index of the
// generation there, keeping its fraction of the lane, like a strand) by a band
// of t generations. Both lanes use the same lattice rules, the same procgen
// individuals and the same drawing; only the colour of each individual
// differs, by what it is:
//   - deep green: alive now;
//   - pale green: dead with living descendants (in the living's lane, every
//     dead individual: the lane is their line; in the dead's lane, by the
//     hashed lineage model below);
//   - gray: dead, line ended (withered for extinct species).
// Where a cell holds several, their colours mix by how much of the band their
// lives cover. Two looks, crossfaded by zoom (twigs.ts):
//   - texture (mode 0): a thin line per slot, as bright as the lives of two
//     sample generations of the band cover it (density, not a flat fill);
//   - lives (mode 1): every individual's own life, birth to death, on its
//     strand, with a dot at its end.
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
export const MESH_U = 8;

/**
 * One instance: a screen rectangle of one lane over one band (texture) or one
 * generation (lives), within one stretch of constant lane width.
 */
export interface MeshInst {
  /** Screen rectangle (CSS px). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen x of slot iBase's centre, px between lattice slots, line width, fade of the odd (finer) lattice slots. */
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
  lane: Lane;
  tipR: number;
  GL: number;
  Lm: number;
  /** procgen "now" relative to the start of generation gA (years). */
  nowRel: number;
  iBase: number;
  iStep: number;
  nA: number;
  nB: number;
  seedA: number;
  seedB: number;
  thrA: number;
  thrB: number;
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
  f[o + 19] = 0;
  const q = k * MESH_U;
  u[q] = m.iBase;
  u[q + 1] = m.iStep;
  u[q + 2] = m.nA;
  u[q + 3] = m.nB;
  u[q + 4] = m.seedA;
  u[q + 5] = m.seedB;
  u[q + 6] = m.thrA;
  u[q + 7] = m.thrB;
}

/** Colours (linear 0–1 RGB) by colour code: deep green, pale green, gray, withered. */
export type Palette = [number, number, number][];

const expm1s = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 + x * (0.5 + x / 6)) : Math.exp(x) - 1);
const log1ps = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 - x * (0.5 - x / 3)) : Math.log(1 + x));

/** Line coverage at distance d (px) from its centre, width lw (thinner than a pixel: fainter). */
export function lineAA(d: number, lw: number): number {
  const w = Math.max(lw, 1);
  return Math.max(0, Math.min(1, w * 0.5 + 0.5 - d)) * Math.min(lw, 1);
}

/**
 * The mesh at screen point (px, py) for one instance: [r, g, b, a] (not
 * premultiplied), exactly what the fragment shader computes (meshgl.ts), in
 * float64 here. kLog: log2 of (age + TIME_C) per screen px; nowPx: screen y of
 * "now" (dead lives stop DEAD_GAP px short of it).
 */
export function shadeMesh(m: MeshInst, px: number, py: number, kLog: number, nowPx: number, pal: Palette, deadGap = 3): [number, number, number, number] {
  if (px < m.x0 || px >= m.x1 || py < m.y0 || py >= m.y1) return [0, 0, 0, 0];
  const j = Math.floor((px - m.slotX0) / m.slotDx + 0.5);
  if (j < 0) return [0, 0, 0, 0];
  const lineX = m.slotX0 + j * m.slotDx;
  const d = Math.abs(px - lineX);
  const i = m.iBase + j * m.iStep;
  const fine = m.fineA < 1 && (j & 1) === 1 ? m.fineA : 1;
  const col: [number, number, number] = [0, 0, 0];
  if (m.mode === 0) {
    let cov = 0;
    let ns = 0;
    for (let s = 0; s < 2; s++) {
      if (s === 1 && !(m.gBoff > 0)) break;
      ns++;
      const n = s ? m.nB : m.nA;
      if (i >= n) continue;
      const gOff = s ? m.gBoff * m.GL : 0;
      const L = lifeGPU(s ? m.seedB : m.seedA, i, m.GL, m.Lm, m.nowRel - gOff, s ? m.thrB : m.thrA);
      const code = colourCode(m.lane, L.alive, L.lineage);
      if (code < 0) continue;
      const c = Math.max(0, Math.min(L.birth + L.life, m.nowRel - gOff) - L.birth);
      cov += c;
      for (let k = 0; k < 3; k++) col[k] += c * pal[code][k];
    }
    if (!(cov > 0)) return [0, 0, 0, 0];
    const a = Math.min(1, cov / (ns * m.GL)) * m.alpha * fine * lineAA(d, m.lw);
    return [col[0] / cov, col[1] / cov, col[2] / cov, a];
  }
  if (i >= m.nA) return [0, 0, 0, 0];
  const L = lifeGPU(m.seedA, i, m.GL, m.Lm, m.nowRel, m.thrA);
  const code = colourCode(m.lane, L.alive, L.lineage);
  if (code < 0) return [0, 0, 0, 0];
  const c = Math.LN2 * kLog;
  const pyAt = (t: number) => m.p0 + log1ps((m.T0 - t) / m.A) / c;
  const birthPx = pyAt(L.birth);
  let topPx = pyAt(Math.min(L.birth + L.life, m.nowRel));
  if (!L.alive) topPx = Math.max(topPx, nowPx + deadGap);
  if (topPx > birthPx) return [0, 0, 0, 0];
  const dy = Math.max(0, topPx - py, py - birthPx);
  const r = m.lw * 0.5;
  const dLine = Math.hypot(d, dy) - r;
  const dDot = Math.hypot(d, py - topPx) - m.tipR;
  let a = Math.max(0, Math.min(1, 0.5 - Math.min(dLine, dDot)));
  // The living glow softly.
  if (code === 0) {
    const g = Math.max(0, Math.min(1, 1 - dLine / 5));
    a = Math.max(a, 0.35 * g * g);
  }
  a *= m.alpha;
  const p = pal[code];
  return [p[0], p[1], p[2], a];
}

/** Time (years from the start of the instance's generation) at screen y, as the shader computes it. */
export function timeAt(m: MeshInst, py: number, kLog: number): number {
  return m.T0 - m.A * expm1s(Math.LN2 * kLog * (py - m.p0));
}
