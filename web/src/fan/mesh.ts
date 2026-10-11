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
// Who is in a slot (TwigModel.slotIndividuals): a column at height t holds
// the individuals alive at t, one slot each. A generation has about
// births ÷ alive (≈ 2) times as many members as there are slots where it lives,
// so it folds onto them: slot K holds members K mod S + c·S of generation g
// (S = the stride, g's slots: those alive at its births, world-fixed; c below
// the fold, ⌈n ÷ S⌉), whose lives follow one another on the slot. The lane
// colours who is in it, by what it is:
//   - green lane (alive at t with living descendants today, population.ts):
//     deep green if alive now, else pale green (their line goes on);
//   - gray lane (line ended, an extinct species' own all of it): gray; the
//     living are never in it.
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

import { hashNum, lowbias32, mix, randFloat } from '../../../packages/procgen/src/hash.ts';
import type { Species } from '../../../packages/procgen/src/index.ts';

/** procgen species.ts: the attributes stream tag and its fields. */
const TAG_ATTR = 0xa7;
export const F_BIRTH = 1;
export const F_LIFE_A = 2;
export const F_LIFE_B = 3;

/** Attribute seed of generation g: procgen's genSeed(TAG_ATTR, g). */
export function attrSeed(sp: Species, g: number): number {
  return hashNum(mix(sp.seed, TAG_ATTR), g);
}

export const enum Lane {
  Green = 0,
  Gray = 1,
}

/** Colour of an individual by its lane: 0 deep green (alive now), 1 pale green (its line goes on), 2 gray; -1 not in this lane. */
export function colourCode(lane: Lane, alive: boolean): number {
  if (lane === Lane.Green) return alive ? 0 : 1;
  if (alive) return -1; // the living are in the green lane
  return 2;
}

/** One individual as the GPU sees it: birth and life (years, from the start of its generation), alive now. */
export function lifeGPU(seed: number, i: number, GL: number, Lm: number, nowRel: number): { birth: number; life: number; alive: boolean } {
  const h = mix(seed, i >>> 0);
  const birth = randFloat(h, F_BIRTH) * GL;
  const life = Lm * (randFloat(h, F_LIFE_A) + randFloat(h, F_LIFE_B));
  return { birth, life, alive: birth <= nowRel && birth + life > nowRel };
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

/**
 * Levels of the lattice walked below a block to place its line (and pick its
 * individual). Up to LAT_DEPTH the line is exactly its slot (latticeRep); far
 * out, beyond it, the walk stops LAT_DEPTH levels down: the line's place in its
 * block is then exact to 2^-LAT_DEPTH of the block (far below a pixel), and
 * the individual drawn on it is the one of that sub-block's index. The nesting
 * holds to the same precision. (The GPU's indices are 32-bit: wrapped alike.)
 */
export const LAT_DEPTH = 16;

/**
 * Block B's line at level L as drawn: its offset within the block in units of
 * 2^-D of the block (D levels walked), and the index it stands for (the slot
 * when D = L), wrapped to 32 bits as on the GPU.
 */
export function latticeWalk(seed: number, L: number, B: number): { off: number; D: number; K: number } {
  const D = Math.min(L, LAT_DEPTH);
  let idx = B >>> 0;
  let off = 0;
  for (let l = L; l > L - D; l--) {
    const bit = latticeBit(seed, l, idx);
    idx = (2 * idx + bit) >>> 0;
    off = 2 * off + bit;
  }
  return { off, D, K: idx };
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

// ---- cross-links: the lines interbreed ----------------------------------------
//
// Between neighbouring drawn lines, short links: a child's line meeting another
// line at a birth (the parent's end a third of a generation below the child's,
// as the real parent threads are drawn, twigs.ts). Fixed in the world and
// hashed, and nested both ways:
//   - across: a link joins the lines of two neighbouring blocks (B, B + 1) of
//     lattice level l, which are lines at every finer level too, so a link seen
//     at a coarse zoom stays where it was; as one zooms in, the links of the
//     finer levels fade in between them (with their lines) and the coarse ones,
//     grown long, fade out two octaves on (linkWeight): a constant density;
//   - in time: a pair's candidate links are one per generation (LINK_P of them
//     exist), shown by a hashed binary tree over the generations (timeRep): a
//     band of 2^τ generations shows its representative's link, which is the
//     representative of one of its halves, so finer bands keep it. The
//     generation's rank (how many levels up it still represents) against the
//     continuous τ (the generations' height on screen) fades them in.
// At the finest level the links join neighbouring slots, then fade out as the
// real parent threads (twigs.ts) fade in.

/** Share of a pair's candidate links (one per generation) that exist. */
export const LINK_P = 0.45;
/** Lattice levels whose links can show at once (the current one and two coarser). */
export const LINK_LEVELS = 3;
/** Levels of the time tree resolved by one hash (2^5 − 1 = 31 bits: one subtree). */
const TCH = 5;

/** A pair's identity: blocks (B, B + 1) of lattice level l. */
export function linkPair(seed: number, l: number, B: number): number {
  return lowbias32((Math.imul(B >>> 0, 0x27d4eb2d) ^ seed ^ Math.imul(l + 1, 0x165667b1)) >>> 0);
}

/** One hash of the time tree: chunk c (levels 5c + 1 … 5c + 5) under its top node a. */
function timeHash(P: number, c: number, a: number): number {
  return lowbias32((Math.imul(a | 0, 0x7feb352d) ^ P ^ Math.imul(c + 1, 0x846ca68b)) >>> 0);
}

/** The time tree's bit at node idx of level i ≥ 1 (which half's generation represents it). */
export function timeBit(P: number, i: number, idx: number): number {
  const c = Math.floor((i - 1) / TCH);
  const d = TCH * c + TCH - i;
  const pos = (1 << d) - 1 + (idx & ((1 << d) - 1));
  return (timeHash(P, c, idx >> d) >>> pos) & 1;
}

/**
 * The generation representing node `band` of level τ (generations
 * [band·2^τ, (band + 1)·2^τ)), if it lies in [lo, hi]; else NaN (the walk
 * stops as soon as its node leaves [lo, hi]: most pixels stop at once).
 */
export function timeRep(P: number, tau: number, band: number, lo: number, hi: number): number {
  let idx = band;
  let i = tau;
  while (i > 0) {
    const c = Math.floor((i - 1) / TCH);
    const top = TCH * c + TCH;
    const h = timeHash(P, c, idx >> (top - i));
    for (; i > TCH * c; i--) {
      const n = 2 ** i;
      if (idx * n > hi || (idx + 1) * n <= lo) return NaN;
      const d = top - i;
      idx = 2 * idx + ((h >>> ((1 << d) - 1 + (idx & ((1 << d) - 1)))) & 1);
    }
  }
  return idx >= lo && idx <= hi ? idx : NaN;
}

/** How many levels above `from` generation g still represents its node (up to `to`). */
export function timeRank(P: number, g: number, from: number, to: number): number {
  let r = from;
  for (let i = from + 1; i <= to; i++) {
    if (timeBit(P, i, g >> i) !== ((g >> (i - 1)) & 1)) break;
    r = i;
  }
  return r;
}

/** A pair's link in generation g: whether it exists, its child's birth (share of the generation), and which end is the child (0: right, 1: left). */
export function linkAt(P: number, g: number): { on: boolean; u: number; dir: number } {
  const h = lowbias32((P ^ Math.imul(g | 0, 0x9e3779b9) ^ 0x68e31da4) >>> 0);
  return { on: h >>> 8 < LINK_P * 16777216, u: 0.4 + (0.6 * ((h & 127) + 0.5)) / 128, dir: (h >>> 7) & 1 };
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Weight of level l's links at continuous lattice level λ: fading in with their lines, out once two octaves long. */
export function linkWeight(l: number, lambda: number): number {
  const s = l - lambda;
  return s < 0 ? smooth(1 + s) : 1 - smooth(s - 1);
}

/** Floats and uints per instance (meshgl.ts attribute layout). */
export const MESH_F = 36;
export const MESH_U = 12;
/** Most members of a generation folded onto one slot (a generation up to this many times its slots). */
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
  /** The lane right of xG (Gray). */
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
  /** Each sample's stride (its generation's slots) and fold (members per slot, ⌈n ÷ stride⌉). */
  sA: number;
  sB: number;
  fA: number;
  fB: number;
  /**
   * Lanes too narrow for the lines to show them (texture only): the column's
   * screen edges (the gray lane drawn at least 0.6 px, the green one 1 px, as
   * view.ts draws the lanes) and how much each lane (green, gray) is drawn as
   * one line its own width, brightening and dimming with the lives on it
   * (0: not at all, wide enough for its lines).
   */
  colL?: number;
  colR?: number;
  narG?: number;
  narR?: number;
  /**
   * The cross-links (0: none): their opacity (their width: linkWidth), the continuous
   * lattice level λ, the generations' continuous time level τ (log2 of
   * BAND_PX over a generation's height) and the band's (τb: gA is a multiple
   * of 2^τb; 0 for the lives), and generation gA itself.
   */
  linkA?: number;
  lam?: number;
  tauC?: number;
  tauB?: number;
  gA?: number;
  /**
   * Lives only: the slot's own thread under its lives, over the generation's
   * span (its opacity; 0: none): one life after another reads as one strand,
   * not as specks, while they are thin.
   */
  baseA?: number;
  /**
   * The column's curve within the instance (a chord: straight in screen y,
   * from its top row y0 down): px the left edge, the right edge (colR) and
   * the green edge (xG) move per px down, and the relative change of the
   * pitch per px. The lattice rides the left edge and scales with the pitch:
   * a pixel is shaded at its place in the column's frame at y0 (meshFrame).
   */
  sL?: number;
  sR?: number;
  sG?: number;
  sP?: number;
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
  f[o + 20] = m.colL ?? 0;
  f[o + 21] = m.colR ?? 0;
  f[o + 22] = m.narG ?? 0;
  f[o + 23] = m.narR ?? 0;
  f[o + 24] = m.linkA ?? 0;
  f[o + 25] = m.lam ?? 0;
  f[o + 26] = m.tauC ?? 0;
  f[o + 27] = m.tauB ?? 0;
  f[o + 28] = m.baseA ?? 0;
  f[o + 29] = 0;
  f[o + 30] = 0;
  f[o + 31] = 0;
  f[o + 32] = m.sL ?? 0;
  f[o + 33] = m.sR ?? 0;
  f[o + 34] = m.sG ?? 0;
  f[o + 35] = m.sP ?? 0;
  const q = k * MESH_U;
  u[q] = m.B0;
  u[q + 1] = m.lvl;
  u[q + 2] = m.nA;
  u[q + 3] = m.nB;
  u[q + 4] = m.seedA;
  u[q + 5] = m.seedB;
  u[q + 6] = m.sA;
  u[q + 7] = m.sB;
  u[q + 8] = m.latSeed;
  u[q + 9] = m.fA;
  u[q + 10] = m.fB;
  u[q + 11] = (m.gA ?? 0) >>> 0;
}

/** Colours (linear 0–1 RGB) by colour code: deep green, pale green, gray. */
export type Palette = [number, number, number][];

const expm1s = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 + x * (0.5 + x / 6)) : Math.exp(x) - 1);
const log1ps = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 - x * (0.5 - x / 3)) : Math.log(1 + x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Line coverage at distance d (px) from its centre, width lw (thinner than a pixel: fainter). */
export function lineAA(d: number, lw: number): number {
  const w = Math.max(lw, 1);
  return Math.max(0, Math.min(1, w * 0.5 + 0.5 - d)) * Math.min(lw, 1);
}

/**
 * A texture line's opacity by the share of its band its lives cover: never
 * below TEX_FLOOR, so a line reads as one thread from band to band (not as
 * dashes) and its lives only brighten it.
 */
export const TEX_FLOOR = 0.55;
export function texAlpha(share: number, floor = TEX_FLOOR): number {
  return floor + (1 - floor) * Math.min(1, share);
}

/** A narrow lane's one line (no lines of its own to show): one life per band, a stronger beat, so even a hairline reads as lives. */
export const NAR_FLOOR = 0.12;

/** Index of a narrow lane's representative individual in screen column cx (mesh.ts / the shader alike). */
export function narrowIndex(seed: number, cx: number): number {
  return lowbias32((Math.imul(cx >>> 0, 0x2c1b3c6d) ^ seed ^ 0x5bd1e995) >>> 0) >>> 0;
}

/** The first member of a generation (n members, stride S) on slot K: K mod S (and mod n, should S exceed n). */
export function slotBase(K: number, S: number, n: number): number {
  if (!(n > 0)) return 0;
  return ((K >>> 0) % Math.max(1, S)) % n;
}

type RGBA = [number, number, number, number];

/** One lane's look at one slot (the shader's shadeLane): colour and coverage, not premultiplied. */
function shadeLane(m: MeshInst, lane: Lane, iA: number, iB: number, d: number, py: number, kLog: number, nowPx: number, pal: Palette, deadGap: number, floor = TEX_FLOOR, lw = m.lw, one = false): RGBA {
  if (m.mode === 0) {
    let cov = 0;
    let ns = 0;
    const col = [0, 0, 0];
    for (let s = 0; s < 2; s++) {
      if (s === 1 && (one || !(m.gBoff > 0))) break;
      ns++;
      const n = s ? m.nB : m.nA;
      const i0 = s ? iB : iA;
      if (!(n > 0)) continue;
      const gOff = s ? m.gBoff * m.GL : 0;
      const fold = s ? m.fB : m.fA;
      const st = s ? m.sB : m.sA;
      for (let c = 0; c < fold; c++) {
        const i = i0 + c * st;
        if (c > 0 && i >= n) break;
        const L = lifeGPU(s ? m.seedB : m.seedA, i, m.GL, m.Lm, m.nowRel - gOff);
        const code = colourCode(lane, L.alive);
        if (code < 0) continue;
        const cv = Math.max(0, Math.min(L.birth + L.life, m.nowRel - gOff) - L.birth);
        cov += cv;
        for (let k = 0; k < 3; k++) col[k] += cv * pal[code][k];
      }
    }
    if (!(cov > 0)) return [0, 0, 0, 0];
    return [col[0] / cov, col[1] / cov, col[2] / cov, texAlpha(cov / (ns * m.GL), floor) * lineAA(d, lw)];
  }
  let best = 0;
  let bc = -1;
  for (let c = 0; c < m.fA; c++) {
    const i = iA + c * m.sA;
    if (c > 0 && i >= m.nA) break;
    const L = lifeGPU(m.seedA, i, m.GL, m.Lm, m.nowRel);
    const code = colourCode(lane, L.alive);
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
  // The slot's own thread under its lives, over the generation's span (the dead stop short of now).
  const baseA = m.baseA ?? 0;
  if (baseA > 0) {
    const k = Math.LN2 * kLog;
    const y0 = m.p0 + log1ps((m.T0 - Math.min(m.GL, m.nowRel)) / m.A) / k;
    const y1 = m.p0 + log1ps(m.T0 / m.A) / k;
    const top = lane === Lane.Green ? y0 : Math.max(y0, nowPx + deadGap);
    const a = py >= top && py < y1 ? baseA * lineAA(d, m.lw) : 0;
    if (a > best) {
      best = a;
      bc = lane === Lane.Green ? 1 : 2;
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

/** A link's line width by its instance's line width. */
export function linkWidth(lw: number): number {
  return Math.max(0.75, lw * 0.45);
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * The cross-links at (px, py) for one instance (the shader's shadeLinks):
 * the pairs of neighbouring lines around the pixel at the current lattice
 * level and the two coarser ones, each pair's link in the generation it shows
 * here (texture: its band's representative; lives: the instance's generation).
 */
export function shadeLinks(m: MeshInst, px: number, py: number, kLog: number, pal: Palette): RGBA {
  const linkA = m.linkA ?? 0;
  if (!(linkA > 0)) return [0, 0, 0, 0];
  const k = Math.LN2 * kLog;
  // The pixel's time (from generation gA's start) and years per px there.
  const tp = m.T0 - m.A * expm1s(k * (py - m.p0));
  const dtdy = (m.T0 - tp + m.A) * k;
  const lw = linkWidth(m.lw);
  const reachT = (lw * 0.5 + 1) * dtdy;
  const gA = m.gA ?? 0;
  const lo = gA + Math.floor((tp - reachT) / m.GL);
  const hi = gA + Math.floor((tp + reachT) / m.GL);
  const tauB = m.tauB ?? 0;
  const tauC = m.tauC ?? 0;
  const top = Math.min(tauB + 8, Math.max(tauB, Math.ceil(tauC) + 1));
  const bfL = Math.floor((px - m.xB0) / m.bw);
  if (m.B0 + bfL < 0) return [0, 0, 0, 0];
  const colL = m.colL ?? 0;
  const colR = m.colR ?? 0;
  let best: RGBA = [0, 0, 0, 0];
  for (let dl = 0; dl < LINK_LEVELS; dl++) {
    const l = m.lvl + dl;
    const w = linkWeight(l, m.lam ?? 0);
    if (!(w > 0.004)) continue;
    const Bl = Math.floor((m.B0 + bfL) / 2 ** dl);
    for (let c = -1; c <= 0; c++) {
      const Bp = Bl + c;
      if (Bp < 0) continue;
      const P = linkPair(m.latSeed, l, Bp);
      const g = m.mode === 0 ? timeRep(P, tauB, gA / 2 ** tauB, lo, hi) : gA >= lo && gA <= hi ? gA : NaN;
      if (Number.isNaN(g)) continue;
      const lk = linkAt(P, g);
      if (!lk.on) continue;
      const tb = (g - gA + lk.u) * m.GL;
      const tpar = tb - m.GL / 3;
      if (tp < tpar - reachT || tp > tb + reachT) continue;
      const wt = smooth(timeRank(P, g, tauB, top) - tauC);
      if (!(wt > 0)) continue;
      // The pair's two lines (as drawn: latticeWalk), left and right.
      const xs = [Bp, Bp + 1].map((B) => {
        const { off, D } = latticeWalk(m.latSeed, l, B);
        return m.xB0 + (B * 2 ** dl - m.B0) * m.bw + ((off + 0.5) * m.bw * 2 ** dl) / 2 ** D;
      });
      if (colR > colL && (xs[0] < colL || xs[1] > colR)) continue;
      const xC = xs[1 - lk.dir];
      const xP = xs[lk.dir];
      const yC = py + (tp - tb) / dtdy;
      const yP = py + (tp - tpar) / dtdy;
      const a = lineAA(segDist(px, py, xP, yP, xC, yC), lw) * w * wt * linkA * m.alpha;
      if (a > best[3]) {
        const code = xC < m.xG ? 1 : 2;
        best = [pal[code][0], pal[code][1], pal[code][2], a];
      }
    }
  }
  return best;
}

/**
 * The mesh at screen point (px, py) for one instance: [r, g, b, a] (not
 * premultiplied), exactly what the fragment shader computes (meshgl.ts), in
 * float64 here. kLog: log2 of (age + TIME_C) per screen px; nowPx: screen y of
 * "now" (dead lives stop DEAD_GAP px short of it).
 */
export function shadeMesh(m0: MeshInst, px0: number, py: number, kLog: number, nowPx: number, pal: Palette, deadGap = 3): RGBA {
  if (px0 < m0.x0 || px0 >= m0.x1 || py < m0.y0 || py >= m0.y1) return [0, 0, 0, 0];
  const fr = meshFrame(m0, px0, py);
  if (!fr) return [0, 0, 0, 0];
  const [px, m] = fr;
  // The texture is measured across the column, not along the row: where it leans (a branch-out),
  // a line and a narrow lane keep their width and read as lines, not as a row's dashes.
  const ks = m.mode === 0 ? perpScale(m0, px, py) : 1;
  // Nothing to draw this far from a line (only the living glow, and they are only in the green lane).
  const reach = m.mode === 0 ? (Math.max(m.lw, 1) * 0.5 + 0.5) / ks : Math.max(m.tipR, Math.max(m.lw, 1) * 0.5 + (m.xG > m.x0 ? 5 : 0)) + 0.5;
  const bf = Math.floor((px - m.xB0) / m.bw);
  let best: RGBA = [0, 0, 0, 0];
  // The lines of this block and its neighbours (each block's line is anywhere in it).
  for (let c = -1; c <= 1; c++) {
    const bb = bf + c;
    if (bb < 0) continue;
    const B = m.B0 + bb;
    const { off, D, K } = latticeWalk(m.latSeed, m.lvl, B);
    const pp = m.bw / 2 ** D;
    const lineX = m.xB0 + bb * m.bw + (off + 0.5) * pp;
    const d = Math.abs(px - lineX);
    if (d > reach) continue;
    // (Only the column's own lines: on a steep lean the pad around it reaches far along the row.)
    if ((m.colR ?? 0) > (m.colL ?? 0) && (lineX < (m.colL ?? 0) - 1 || lineX > (m.colR ?? 0) + 1)) continue;
    const dp = d * ks;
    const iA = slotBase(K, m.sA, m.nA);
    const iB = slotBase(K, m.sB, m.nB);
    const fine = m.fineA < 1 && !latticeTop(m.latSeed, m.lvl, B) ? m.fineA : 1;
    // Where the lanes meet, the slot's colours blend by how much of it is in each.
    const wg = clamp01((m.xG - lineX) / pp + 0.5);
    const g = wg > 0 ? shadeLane(m, Lane.Green, iA, iB, dp, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
    const r = wg < 1 ? shadeLane(m, m.lane, iA, iB, dp, py, kLog, nowPx, pal, deadGap) : ([0, 0, 0, 0] as RGBA);
    const col = blend(g, r, wg);
    col[3] *= m.alpha * fine;
    if (col[3] > best[3]) best = col;
  }
  const lk = shadeLinks(m, px, py, kLog, pal);
  if (lk[3] > best[3]) best = lk;
  // Lanes too narrow for their lines: the lane is one line its own width, lit by a representative's lives.
  if (m.mode === 0 && ((m.narG ?? 0) > 0 || (m.narR ?? 0) > 0)) {
    const colL = m.colL ?? 0;
    const colR = m.colR ?? 0;
    const green = m.xG >= colL;
    const i = narrowIndex(m.latSeed, Math.floor(px - colL));
    // (Each lane from its left edge, at least `min` px across the column: the green 1, the gray 0.6.)
    for (const [lane, a0, a1, min, nar] of [
      [Lane.Green, colL, m.xG, 1, m.narG ?? 0],
      [m.lane, Math.max(colL, m.xG), colR, 0.6, m.narR ?? 0],
    ] as const) {
      if (!(nar > 0)) continue;
      const cx = narrowCover(px, a0, a1, min, ks);
      if (!(cx > 0) || (lane === Lane.Green && !green)) continue;
      const c = shadeLane(m, lane, slotBase(i, m.sA, m.nA), slotBase(i, m.sB, m.nB), 0, py, kLog, nowPx, pal, deadGap, NAR_FLOOR, 1, true);
      c[3] *= Math.min(1, cx) * nar * m.alpha;
      if (c[3] > best[3]) best = c;
    }
  }
  return best;
}

/**
 * Screen px across the column per unit of the frame's x, at frame x X on
 * screen row py: the frame's scale k down the instance, over the stretch of a
 * row along a column that leans by s px per px (√(1 + s²)). 1 upright.
 */
export function perpScale(m: MeshInst, X: number, py: number): number {
  const sL = m.sL ?? 0;
  const sP = m.sP ?? 0;
  const k = Math.max(1e-6, 1 + sP * (py - m.y0));
  const s = sL + (X - (m.colL ?? 0)) * sP;
  return k / Math.sqrt(1 + s * s);
}

/**
 * A narrow lane's coverage of the pixel at frame x px: the lane [a0, a1] of
 * the frame, at least `min` screen px across the column from its left edge,
 * measured across the column (ks: perpScale).
 */
export function narrowCover(px: number, a0: number, a1: number, min: number, ks: number): number {
  const w = Math.max(min, (a1 - a0) * ks);
  const d = (px - a0) * ks - w * 0.5;
  return Math.max(0, Math.min(d + 0.5, w * 0.5) - Math.max(d - 0.5, -w * 0.5));
}

/**
 * A pixel in the column's frame at the instance's top row (y0): the column's
 * left edge, pitch, right and green edges move down the instance (sL, sP, sR,
 * sG), the lattice with them; x maps back by the left edge's shift and the
 * pitch's scale, the edges likewise. Null outside the column (and its pad).
 */
export function meshFrame(m: MeshInst, px: number, py: number): [number, MeshInst] | null {
  const sL = m.sL ?? 0;
  const sR = m.sR ?? 0;
  const sG = m.sG ?? 0;
  const sP = m.sP ?? 0;
  const colL = m.colL ?? 0;
  const dy = py - m.y0;
  const k = Math.max(1e-6, 1 + sP * dy);
  const xl = colL + sL * dy;
  const X = colL + (px - xl) / k;
  const colR = colL + ((m.colR ?? 0) + sR * dy - xl) / k;
  const pad = m.mode === 0 ? 1 + 1.5 / perpScale(m, X, py) : Math.max(m.tipR, Math.max(m.lw, 1) * 0.5 + 5) + 1;
  // (A straight, constant column needs no clip: the instance's rectangle is it.)
  if (sL === 0 && sR === 0 && sG === 0 && sP === 0) return [X, m];
  if (X < colL - pad || X > colR + pad) return null;
  return [X, { ...m, colR, xG: colL + (m.xG + sG * dy - xl) / k }];
}

/** Instance k of packed arrays, back (tests). */
export function unpackInst(f: Float32Array, u: Uint32Array, k: number): MeshInst {
  const o = k * MESH_F;
  const q = k * MESH_U;
  return {
    x0: f[o], y0: f[o + 1], x1: f[o + 2], y1: f[o + 3], xB0: f[o + 4], bw: f[o + 5], lw: f[o + 6], fineA: f[o + 7], p0: f[o + 8], T0: f[o + 9], A: f[o + 10], gBoff: f[o + 11],
    alpha: f[o + 12], mode: f[o + 13] as 0 | 1, lane: f[o + 14] as Lane, tipR: f[o + 15], GL: f[o + 16], Lm: f[o + 17], nowRel: f[o + 18], xG: f[o + 19],
    colL: f[o + 20], colR: f[o + 21], narG: f[o + 22], narR: f[o + 23], linkA: f[o + 24], lam: f[o + 25], tauC: f[o + 26], tauB: f[o + 27], baseA: f[o + 28], sL: f[o + 32], sR: f[o + 33], sG: f[o + 34], sP: f[o + 35],
    B0: u[q], lvl: u[q + 1], nA: u[q + 2], nB: u[q + 3], seedA: u[q + 4], seedB: u[q + 5], sA: u[q + 6], sB: u[q + 7], latSeed: u[q + 8], fA: u[q + 9], fB: u[q + 10], gA: u[q + 11] | 0,
  };
}

/** Time (years from the start of the instance's generation) at screen y, as the shader computes it. */
export function timeAt(m: MeshInst, py: number, kLog: number): number {
  return m.T0 - m.A * expm1s(Math.LN2 * kLog * (py - m.p0));
}
