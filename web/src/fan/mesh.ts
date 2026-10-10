// The individuals mesh: one function for both lanes, evaluated per pixel on
// the GPU (meshgl.ts) and mirrored here on the CPU (shadeMesh) for tests.
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
// Which slots are drawn: a nested, hashed subset of the lattice (the mesh's
// own lines, fixed in the world). The slots are grouped in blocks of 2^l;
// each block's line is one of its two halves' lines (a hashed choice per
// block, latticeRep), so the lines of level l + 1 are a subset of those of
// level l, one per block, irregularly placed. The zoom sets a continuous
// level λ (twigs.ts lineLevel): the lines of level ⌊λ⌋ + 1 are drawn, and those
// of level ⌊λ⌋ fade in between them as λ falls. A line seen at a coarse zoom
// stays, in the same place, at every finer zoom; at λ ≤ 0 every slot is drawn.
// Two looks, crossfaded by zoom (twigs.ts), on those same lines:
//   - texture (mode 0): a thin line per drawn slot, as bright as the lives of
//     two sample generations of the band cover it (the slot's path averaged
//     over generations too thin on screen, or the width too coarse, for lives);
//   - lives (mode 1): every individual's own life, birth to death, on its
//     slot, with a dot at its end.
//
// Everything the GPU needs per individual comes from procgen's integer hash
// (HASH_GLSL is bit-identical to hash.ts): the attribute seed of generation g
// (attrSeed, per instance), mixed with the index on the GPU.

import { hashNum, lowbias32, mix, rand, randFloat } from '../../../packages/procgen/src/hash.ts';
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

/** The lattice's hashed choice for block idx of level l (2^l slots): which half's line is the block's (0 left, 1 right). */
export function latticeBit(seed: number, l: number, idx: number): number {
  return lowbias32((Math.imul(idx >>> 0, 0x9e3779b1) ^ seed ^ Math.imul(l, 0x85ebca6b)) >>> 0) >>> 31;
}

/** The slot of block B's line at level L (block B spans slots [B·2^L, (B + 1)·2^L)). */
export function latticeRep(seed: number, L: number, B: number): number {
  let idx = B;
  for (let l = L; l > 0; l--) idx = 2 * idx + latticeBit(seed, l, idx);
  return idx;
}

/** Whether block B's line at level L is also a line of level L + 1. */
export function latticeTop(seed: number, L: number, B: number): boolean {
  return latticeBit(seed, L + 1, Math.floor(B / 2)) === B % 2;
}

/** The slots drawn at continuous level λ in [K0, K1): the lines of level ⌊λ⌋ (λ ≤ 0: every slot). */
export function latticeLines(seed: number, lambda: number, K0: number, K1: number): number[] {
  const L = Math.max(0, Math.floor(lambda));
  const out: number[] = [];
  for (let B = Math.floor(K0 / 2 ** L); B * 2 ** L < K1; B++) {
    const K = latticeRep(seed, L, B);
    if (K >= K0 && K < K1) out.push(K);
  }
  return out;
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
  /** Screen x of the left edge of lattice block B0, a block's width (px: 2^lvl slots), line width, fade of the lines of level lvl not of lvl + 1. */
  xB0: number;
  bw: number;
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
  /** The first lattice block (left of x0), the lattice level, the lattice's seed. */
  B0: number;
  lvl: number;
  latSeed: number;
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

export function packInst(m: MeshInst, f: Float32Array, u: Uint32Array, k: number): void {
  const o = k * MESH_F;
  f[o] = m.x0;
  f[o + 1] = m.y0;
  f[o + 2] = m.x1;
  f[o + 3] = m.y1;
  f[o + 4] = m.xB0;
  f[o + 5] = m.bw;
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
  u[q] = m.B0;
  u[q + 1] = m.lvl;
  u[q + 2] = m.nA;
  u[q + 3] = m.nB;
  u[q + 4] = m.seedA;
  u[q + 5] = m.seedB;
  u[q + 6] = m.thrA;
  u[q + 7] = m.thrB;
  u[q + 8] = m.latSeed;
  u[q + 9] = m.nG;
  u[q + 10] = m.fold;
  u[q + 11] = 0;
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
  const pp = m.bw / 2 ** m.lvl;
  // Nothing to draw this far from a line (only the living glow, and they are only in the green lane).
  const reach = m.mode === 0 ? Math.max(m.lw, 1) * 0.5 + 0.5 : Math.max(m.tipR, m.lw * 0.5 + (m.xG > m.x0 ? 5 : 0)) + 0.5;
  const bf = Math.floor((px - m.xB0) / m.bw);
  let best: RGBA = [0, 0, 0, 0];
  // The lines of this block and its neighbours (each block's line is anywhere in it).
  for (let c = -1; c <= 1; c++) {
    const bb = bf + c;
    if (bb < 0) continue;
    const B = m.B0 + bb;
    const K = latticeRep(m.latSeed, m.lvl, B);
    const lineX = m.xB0 + bb * m.bw + (K - B * 2 ** m.lvl + 0.5) * pp;
    const d = Math.abs(px - lineX);
    if (d > reach) continue;
    const iA = m.nA > 0 ? K % m.nA : 0;
    const iB = m.nB > 0 ? K % m.nB : 0;
    const fine = m.fineA < 1 && !latticeTop(m.latSeed, m.lvl, B) ? m.fineA : 1;
    // Where the lanes meet, the slot's colours blend by how much of it is in each.
    const wg = clamp01((m.xG - lineX) / pp + 0.5);
    const g = wg > 0 ? shadeLane(m, Lane.Green, iA, iB, d, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
    const r = wg < 1 ? shadeLane(m, m.lane, iA, iB, d, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
    const col = blend(g, r, wg);
    col[3] *= m.alpha * fine;
    if (col[3] > best[3]) best = col;
  }
  return best;
}

/** Instance k of packed arrays, back (tests). */
export function unpackInst(f: Float32Array, u: Uint32Array, k: number): MeshInst {
  const o = k * MESH_F;
  const q = k * MESH_U;
  return {
    x0: f[o], y0: f[o + 1], x1: f[o + 2], y1: f[o + 3], xB0: f[o + 4], bw: f[o + 5], lw: f[o + 6], fineA: f[o + 7], p0: f[o + 8], T0: f[o + 9], A: f[o + 10], gBoff: f[o + 11],
    alpha: f[o + 12], mode: f[o + 13] as 0 | 1, lane: f[o + 14] as Lane, tipR: f[o + 15], GL: f[o + 16], Lm: f[o + 17], nowRel: f[o + 18], xG: f[o + 19],
    B0: u[q], lvl: u[q + 1], nA: u[q + 2], nB: u[q + 3], seedA: u[q + 4], seedB: u[q + 5], thrA: u[q + 6], thrB: u[q + 7], latSeed: u[q + 8], nG: u[q + 9], fold: u[q + 10],
  };
}

/** Time (years from the start of the instance's generation) at screen y, as the shader computes it. */
export function timeAt(m: MeshInst, py: number, kLog: number): number {
  return m.T0 - m.A * expm1s(Math.LN2 * kLog * (py - m.p0));
}
