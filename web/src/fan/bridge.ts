// Cross-links between sister strands (ToLaD#50, gradual speciation): the
// interbreeding across the boundary of two neighbouring strands of a parent
// column, thinning out over a window around their split (gradual.ts chooses
// the window and the schedules). One function, evaluated per pixel on the GPU
// (BRIDGE_FS) and mirrored here on the CPU (shadeBridge) for scripts/glcheck.mjs.
//
// A pair of strands (a left, b right) is one hashed pair identity P. Its
// candidate links are one per generation (BRIDGE_P of them exist, by mesh.ts
// linkAt's rule), shown by the mesh's own hashed binary tree over the
// generations (mesh.ts timeRep / timeRank): at every zoom about one per
// BRIDGE_BAND_PX px of height, the finer ones fading in between the coarser ones, each in the
// same place at every zoom. A link joins a's right edge to b's left edge, from
// the parent's row to the child's (a third of a generation apart: flat until
// the generations are px tall), and so it spans the gap as the strands part.
// The windows thin the links by generation (world-fixed): each link has its
// own hashed draw v and exists while v < keep(g),
//   keep(g) = 1 below k0, then amp · (1 − smoothstep((g − k0) ÷ (k1 − k0))),
// and, for the hybrid zone, reaches into both strands by a hashed share of
// their widths times reach(g) (0 below hIn, rmax at h0, 0 again at h1), J links per generation
// (sub-pairs of P): a strip of shared mesh that narrows to nothing. Links
// fade out once the gap they span is wider than the strands themselves.

import { lowbias32 } from '../../../packages/procgen/src/hash.ts';
import { lineAA, linkWidth, timeRank, timeRep, type Palette } from './mesh';

/** Height of a band of links on screen (px): one candidate link per pair per band (denser than the mesh's own, twigs.ts BAND_PX: one boundary carries them all). */
export const BRIDGE_BAND_PX = 1.5;
/** Share of a pair's candidate links that exist (the mesh's: LINK_P). */
export const BRIDGE_P = 0.85;
/** Most links per generation (the hybrid zone's sub-pairs). */
export const BRIDGE_J = 3;
export const BRIDGE_F = 28;
/** Links fade out as the gap they span grows from GAP0 to GAP1 times the two strands' widths (a world ratio: the same at every zoom). */
export const BRIDGE_GAP0 = 0.6;
export const BRIDGE_GAP1 = 1.5;
export const BRIDGE_U = 4;

export interface BridgeInst {
  /** Screen rectangle (CSS px). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen x of a's right edge and of b's left edge at row y0, and px each moves per px down. */
  xa: number;
  xb: number;
  sa: number;
  sb: number;
  /** a's and b's widths (px), the links' line width (mesh.ts linkWidth of it), opacity. */
  wa: number;
  wb: number;
  lw: number;
  alpha: number;
  /** Time at screen y p0, from the start of generation gA (years), age + TIME_C there, generation length (years). */
  p0: number;
  T0: number;
  A: number;
  GL: number;
  /** keep(g) (generations from gA): 1 below k0, falling to 0 at k1, times amp past k0. */
  k0: number;
  k1: number;
  amp: number;
  /** reach(g): rising from 0 at hIn to rmax at h0, falling to 0 at h1 (a strip that narrows to nothing). */
  hIn: number;
  h0: number;
  h1: number;
  rmax: number;
  /** Colour codes (palette index) of a link whose child is in a, in b. */
  cL: number;
  cR: number;
  /** The pair's identity, generation gA, links per generation (1 … BRIDGE_J). */
  P: number;
  gA: number;
  J: number;
}

export function packBridge(m: BridgeInst, f: Float32Array, u: Uint32Array, k: number): void {
  const o = k * BRIDGE_F;
  const vals = [m.x0, m.y0, m.x1, m.y1, m.xa, m.xb, m.sa, m.sb, m.wa, m.wb, m.lw, m.alpha, m.p0, m.T0, m.A, m.GL, m.k0, m.k1, m.amp, m.rmax, m.h0, m.h1, m.cL, m.cR, m.hIn, 0, 0, 0];
  for (let i = 0; i < BRIDGE_F; i++) f[o + i] = vals[i];
  const q = k * BRIDGE_U;
  u[q] = m.P >>> 0;
  u[q + 1] = m.gA >>> 0;
  u[q + 2] = m.J >>> 0;
  u[q + 3] = 0;
}

type RGBA = [number, number, number, number];
const expm1s = (x: number) => (Math.abs(x) < 1e-3 ? x * (1 + x * (0.5 + x / 6)) : Math.exp(x) - 1);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const LINK_P24 = Math.round(BRIDGE_P * 16777216);

/** Sub-pair j of pair P. */
export function subPair(P: number, j: number): number {
  return j === 0 ? P >>> 0 : lowbias32((P + Math.imul(j, 0x9e3779b9)) >>> 0);
}

/** keep(g) and reach(g) at generation gr (from gA, its middle). */
export function bridgeKeep(m: BridgeInst, gr: number): number {
  return gr < m.k0 ? 1 : m.amp * (1 - smooth((gr - m.k0) / Math.max(1e-6, m.k1 - m.k0)));
}
export function bridgeReach(m: BridgeInst, gr: number): number {
  if (!(m.rmax > 0)) return 0;
  return m.rmax * smooth((gr - m.hIn) / Math.max(1e-6, m.h0 - m.hIn)) * (1 - smooth((gr - m.h0) / Math.max(1e-6, m.h1 - m.h0)));
}

/** The cross-links between sister strands at screen point (px, py): [r, g, b, a], not premultiplied (the shader's main). */
export function shadeBridge(m: BridgeInst, px: number, py: number, kLog: number, pal: Palette): RGBA {
  if (px < m.x0 || px >= m.x1 || py < m.y0 || py >= m.y1) return [0, 0, 0, 0];
  const k = Math.LN2 * kLog;
  const tp = m.T0 - m.A * expm1s(k * (py - m.p0));
  const dtdy = (m.T0 - tp + m.A) * k;
  const lw = linkWidth(m.lw);
  const reachT = (lw * 0.5 + 1) * dtdy;
  const lo = m.gA + Math.floor((tp - reachT) / m.GL);
  const hi = m.gA + Math.floor((tp + reachT) / m.GL);
  // The generations' time level here: log2 of BAND_PX over a generation's height.
  const tauC = Math.log2((BRIDGE_BAND_PX * dtdy) / m.GL);
  const tauB = Math.max(0, Math.ceil(tauC));
  const top = tauB + 1;
  // The gap at this row, against the strands' widths: links far too long to read as a mesh fade out.
  const gap = m.xb + m.sb * (py - m.y0) - (m.xa + m.sa * (py - m.y0));
  const gapA = 1 - smooth((gap / Math.max(1e-6, m.wa + m.wb) - BRIDGE_GAP0) / (BRIDGE_GAP1 - BRIDGE_GAP0));
  if (!(gapA > 0)) return [0, 0, 0, 0];
  let best: RGBA = [0, 0, 0, 0];
  for (let j = 0; j < Math.min(m.J, BRIDGE_J); j++) {
    const P = subPair(m.P, j);
    for (let band = lo >> tauB; band <= Math.min(hi >> tauB, (lo >> tauB) + 2); band++) {
      const g = timeRep(P, tauB, band, lo, hi);
      if (Number.isNaN(g)) continue;
      const h = lowbias32((P ^ Math.imul(g | 0, 0x9e3779b9) ^ 0x68e31da4) >>> 0);
      if (h >>> 8 >= LINK_P24) continue;
      const h2 = lowbias32((P ^ Math.imul(g | 0, 0x85ebca6b) ^ 0x3c6ef372) >>> 0);
      const gr = g - m.gA + 0.5;
      if (!((h2 >>> 8) / 16777216 < bridgeKeep(m, gr))) continue;
      const u = 0.4 + (0.6 * ((h & 127) + 0.5)) / 128;
      const dir = (h >>> 7) & 1;
      const tb = (g - m.gA + u) * m.GL;
      const tpar = tb - m.GL / 3;
      if (tp < tpar - reachT || tp > tb + reachT) continue;
      const wt = smooth(timeRank(P, g, tauB, top) - tauC);
      if (!(wt > 0)) continue;
      const r = bridgeReach(m, gr);
      const h3 = lowbias32(h2);
      const ra = ((h3 & 0xffff) + 0.5) / 65536;
      const rb = ((h3 >>> 16) + 0.5) / 65536;
      const yC = py + (tp - tb) / dtdy;
      const yP = py + (tp - tpar) / dtdy;
      // dir 0: the child on the right (b), as mesh.ts linkAt.
      const yL = dir === 0 ? yP : yC;
      const yR = dir === 0 ? yC : yP;
      const xL = m.xa + m.sa * (yL - m.y0) - r * ra * m.wa;
      const xR = m.xb + m.sb * (yR - m.y0) + r * rb * m.wb;
      const a = lineAA(segDist(px, py, xL, yL, xR, yR), lw) * wt * gapA * m.alpha;
      if (a > best[3]) {
        const code = dir === 0 ? m.cR : m.cL;
        best = [pal[code][0], pal[code][1], pal[code][2], a];
      }
    }
  }
  return best;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
