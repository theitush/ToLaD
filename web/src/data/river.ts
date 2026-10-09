// Decode one .tld file and compute its river layout. Pure (no DOM), so it runs
// in the data worker and in Node tests alike.
//
// Geometry (00-synthesis, confirmed): band width at time t ∝ births per year,
// so a band's area = individuals ever lived.
//
// Every node gets S samples along its own time axis T ∈ [0,1] (0 = its start,
// the oldest age; 1 = its end, the youngest age or "now"):
//   - the 16 profile-bin midpoints (log-spaced toward the young end),
//   - the start, the end of a short taper-in, and (for extinct clades) the start
//     of a short taper-out to a point at the last appearance.
// The intrinsic births rate r(T) is log-linear between bin midpoints, constant
// past the outermost midpoints, times the taper ramps, drawn piecewise-linear
// between samples. It is scaled so that its integral is exactly EVER.
//
// Children nest inside their parent at every sample: at a child's sample time
// the parent band (whatever its shape) is split among the siblings alive then,
// in proportion to their rates (linear) or to log10(1 + rate) (log). If the
// coarse 16-bin profiles of the siblings add up to more than the parent's rate
// at some time, the siblings are scaled down to fit. The block of siblings is
// centred in the parent; the rest of the parent band (stem fill and the
// parent's own ghost lineages) shows on both sides.
//
// Layout stability (03 §3.3): a node's placement depends only on its own row,
// its siblings' rows and its parent's row, never on deeper data. A stub row
// carries the same values as row 0 of its tile, so loading the tile places the
// stub's children without moving anything already drawn.

import { decodeFile, FLAG, profileEdges, Q, type TileFile } from './tolad-decoder.js';

/** Samples per node. */
export const S = 20;
/** Taper-in length (fraction of the node's own span): a thread widening to full rate. */
export const TAPER_IN_T = 0.04;
/** Taper-out length for extinct clades: the band narrows to a point at its last appearance. */
export const TAPER_OUT_T = 0.03;

const K = Q.PROFILE_K;

export interface ProcessedFile {
  kind: number;
  /** Tile id, or -1 for the skeleton. */
  tileId: number;
  n: number;
  gid: Uint32Array;
  /** Parent row in this file (-1 for row 0). */
  parent: Int32Array;
  nchild: Uint16Array;
  /** Tile holding this row's children, or -1. */
  stubTile: Int32Array;
  /** Band start (oldest) and end ages, Ma. */
  age0: Float64Array;
  age1: Float64Array;
  ever: Float64Array;
  alive: Float64Array;
  ghost: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
  flags: Uint16Array;
  meth: Uint16Array;
  srcm: Uint16Array;
  ntip: Uint32Array;
  ott: Uint32Array;
  pbdb: Uint32Array;
  /** Names of row i: nameBlob.slice(nameOff[i], nameOff[i+1]), "primary|alt|alt". */
  nameBlob: string;
  nameOff: Uint32Array;
  /** Representative names of stub / unnamed rows: [row, name] pairs. */
  reps: [number, string][];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  // ---- layout (S samples per row) ----
  /** Own-frame T of each sample, increasing. */
  sT: Float64Array;
  /** Parent polyline segment holding each sample, and the weight inside it. */
  sSeg: Uint8Array;
  sW: Float64Array;
  /** Offset and width of the band at each sample, as fractions of the parent band's width there. */
  offLin: Float64Array;
  wLin: Float64Array;
  offLog: Float64Array;
  wLog: Float64Array;
  /** Time placement in the parent frame: T_parent = tPar0 + tParS * T. */
  tPar0: Float64Array;
  tParS: Float64Array;
  /** Green (alive) and ghost lane fractions of the band width, per width mode. */
  fLin: Float32Array;
  fLog: Float32Array;
  gLin: Float32Array;
  gLog: Float32Array;
}

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** log10(1 + r): the log-mode weight of a births rate. */
export const gRate = (r: number) => Math.log10(1 + Math.max(0, r));

/** Log-mode lane fraction g(a)/(g(a)+g(rest)) with g = 1 + log10 n (as in the spike). */
function logFrac(part: number, total: number): number {
  if (!(part > 0) || !(total > 0)) return 0;
  const rest = Math.max(0, total - part);
  const g = (n: number) => (n >= 1 ? 1 + Math.log10(n) : n);
  const ga = g(part);
  const gr = g(rest);
  return ga + gr > 0 ? ga / (ga + gr) : 0;
}

/**
 * Sample times and births rates (per year) of one row.
 * Writes S values into T and R at offset o. Returns the area scale applied.
 */
export function sampleRow(f: TileFile, i: number, T: Float64Array, R: Float64Array, o: number): number {
  const a0 = f.t0(i);
  const a1 = f.t1(i);
  const span = Math.max(a0 - a1, 1e-12);
  const extinct = f.extinct(i);
  const edges = profileEdges(a0, a1);
  const prof = f.profile(i);
  // Bin midpoints in own T (bin 15 = oldest = smallest T).
  const mT = new Float64Array(K);
  const mR = new Float64Array(K);
  for (let j = 0; j < K; j++) {
    const k = K - 1 - j;
    const mid = (edges[k] + edges[k + 1]) / 2;
    mT[j] = (a0 - mid) / span;
    mR[j] = prof[k];
  }
  const base = (t: number): number => {
    if (t <= mT[0]) return mR[0];
    if (t >= mT[K - 1]) return mR[K - 1];
    let j = 0;
    while (j < K - 2 && t > mT[j + 1]) j++;
    const u = (t - mT[j]) / (mT[j + 1] - mT[j]);
    const ra = mR[j];
    const rb = mR[j + 1];
    if (ra > 0 && rb > 0) return ra * Math.pow(rb / ra, u);
    return ra + (rb - ra) * u;
  };
  const ts: number[] = [0, TAPER_IN_T, 1 - TAPER_OUT_T, 1];
  for (let j = 0; j < K; j++) ts.push(Math.min(1, Math.max(0, mT[j])));
  ts.sort((a, b) => a - b);
  let area = 0;
  for (let k = 0; k < S; k++) {
    const t = ts[k];
    let ramp = smooth(t / TAPER_IN_T);
    if (extinct) ramp *= smooth((1 - t) / TAPER_OUT_T);
    T[o + k] = t;
    R[o + k] = base(t) * ramp;
    if (k > 0) area += ((R[o + k] + R[o + k - 1]) / 2) * (t - ts[k - 1]);
  }
  area *= span * 1e6; // T units → years
  const ever = f.ever(i);
  const scale = area > 0 ? ever / area : 0;
  for (let k = 0; k < S; k++) R[o + k] *= scale;
  return scale;
}

/** Piecewise-linear value of a sampled function at t (0 outside [T0, T_{S-1}]). */
export function evalPoly(T: Float64Array, V: Float64Array, o: number, t: number): number {
  if (t < T[o] || t > T[o + S - 1]) return 0;
  let k = 0;
  while (k < S - 2 && t > T[o + k + 1]) k++;
  const d = T[o + k + 1] - T[o + k];
  const u = d > 0 ? (t - T[o + k]) / d : 0;
  return V[o + k] + (V[o + k + 1] - V[o + k]) * u;
}

/** Segment index s (0..S-2) and weight u of t in a sampled axis. */
function segOf(T: Float64Array, o: number, t: number): [number, number] {
  if (t <= T[o]) return [0, 0];
  if (t >= T[o + S - 1]) return [S - 2, 1];
  let k = 0;
  while (k < S - 2 && t > T[o + k + 1]) k++;
  const d = T[o + k + 1] - T[o + k];
  return [k, d > 0 ? (t - T[o + k]) / d : 0];
}

export interface RateSamples {
  T: Float64Array;
  R: Float64Array;
  scale: Float64Array;
}

export function rateSamples(f: TileFile): RateSamples {
  const T = new Float64Array(f.n * S);
  const R = new Float64Array(f.n * S);
  const scale = new Float64Array(f.n);
  for (let i = 0; i < f.n; i++) scale[i] = sampleRow(f, i, T, R, i * S);
  return { T, R, scale };
}

export function processBuffer(buf: ArrayBuffer | ArrayBufferView, tileId: number): ProcessedFile {
  return processFile(decodeFile(buf), tileId);
}

export function processFile(f: TileFile, tileId: number): ProcessedFile {
  const n = f.n;
  const c = f.col;
  const gid = new Uint32Array(n);
  const stubTile = new Int32Array(n).fill(-1);
  const age0 = new Float64Array(n);
  const age1 = new Float64Array(n);
  const ever = new Float64Array(n);
  const alive = new Float64Array(n);
  const ghost = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const nameOff = new Uint32Array(n + 1);
  const nameParts: string[] = [];
  let off = 0;
  for (let i = 0; i < n; i++) {
    gid[i] = f.gid(i);
    age0[i] = f.t0(i);
    age1[i] = f.t1(i);
    ever[i] = f.ever(i);
    alive[i] = f.alive(i);
    ghost[i] = f.ghost(i);
    lo[i] = f.everLo(i);
    hi[i] = f.everHi(i);
    const nm = f.names(i).join('|');
    nameOff[i] = off;
    nameParts.push(nm);
    off += nm.length;
  }
  nameOff[n] = off;
  const reps: [number, string][] = [];
  for (const [row, s] of f.stubs) {
    stubTile[row] = s.tile;
    if (s.rep) reps.push([row, s.rep]);
  }

  // ---- layout ----
  const { T, R } = rateSamples(f);
  const sSeg = new Uint8Array(n * S);
  const sW = new Float64Array(n * S);
  const offLin = new Float64Array(n * S);
  const wLin = new Float64Array(n * S);
  const offLog = new Float64Array(n * S);
  const wLog = new Float64Array(n * S);
  const tPar0 = new Float64Array(n);
  const tParS = new Float64Array(n).fill(1);
  const fLin = new Float32Array(n);
  const fLog = new Float32Array(n);
  const gLin = new Float32Array(n);
  const gLog = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const e = ever[i];
    fLin[i] = e > 0 ? Math.min(1, alive[i] / e) : 0;
    fLog[i] = logFrac(alive[i], e);
    gLin[i] = e > 0 ? Math.min(1 - fLin[i], ghost[i] / e) : 0;
    gLog[i] = Math.min(1 - fLog[i], logFrac(ghost[i], e));
  }

  // Row 0. Skeleton root: its band is its own rate, centred in [0,1].
  // Tile root: the same node as the stub in the parent file, which owns its placement.
  {
    let rmax = 0;
    for (let k = 0; k < S; k++) rmax = Math.max(rmax, R[k]);
    const gmax = gRate(rmax);
    for (let k = 0; k < S; k++) {
      const wl = rmax > 0 ? R[k] / rmax : 1;
      const wg = gmax > 0 ? gRate(R[k]) / gmax : 1;
      wLin[k] = wl;
      offLin[k] = (1 - wl) / 2;
      wLog[k] = wg;
      offLog[k] = (1 - wg) / 2;
    }
  }

  const kids: number[] = [];
  for (let p = 0; p < n; p++) {
    const nc = c.CHLD[p];
    if (nc === 0) continue;
    kids.length = 0;
    let j = p + 1;
    for (let k = 0; k < nc; k++) {
      kids.push(j);
      j = f.subtreeEnd(j);
    }
    const pa0 = age0[p];
    const pspan = Math.max(pa0 - age1[p], 1e-12);
    for (const ch of kids) {
      tPar0[ch] = (pa0 - age0[ch]) / pspan;
      tParS[ch] = Math.max(age0[ch] - age1[ch], 1e-12) / pspan;
    }
    const po = p * S;
    const rs = new Float64Array(nc);
    for (let a = 0; a < nc; a++) {
      const ch = kids[a];
      const co = ch * S;
      for (let k = 0; k < S; k++) {
        const tau = tPar0[ch] + tParS[ch] * T[co + k];
        const [sg, u] = segOf(T, po, tau);
        sSeg[co + k] = sg;
        sW[co + k] = u;
        const rp = evalPoly(T, R, po, Math.min(Math.max(tau, T[po]), T[po + S - 1]));
        let sum = 0;
        let sumG = 0;
        for (let b = 0; b < nc; b++) {
          const sb = kids[b];
          const r = sb === ch ? R[co + k] : evalPoly(T, R, sb * S, (tau - tPar0[sb]) / tParS[sb]);
          rs[b] = r;
          sum += r;
          sumG += gRate(r);
        }
        const den = Math.max(rp, sum);
        const denG = Math.max(gRate(rp), sumG);
        let before = 0;
        let beforeG = 0;
        for (let b = 0; b < a; b++) {
          before += rs[b];
          beforeG += gRate(rs[b]);
        }
        if (den > 0) {
          offLin[co + k] = (1 - sum / den) / 2 + before / den;
          wLin[co + k] = rs[a] / den;
        } else {
          offLin[co + k] = 0.5;
          wLin[co + k] = 0;
        }
        if (denG > 0) {
          offLog[co + k] = (1 - sumG / denG) / 2 + beforeG / denG;
          wLog[co + k] = gRate(rs[a]) / denG;
        } else {
          offLog[co + k] = 0.5;
          wLog[co + k] = 0;
        }
      }
    }
  }

  return {
    kind: f.kind,
    tileId,
    n,
    gid,
    parent: f.parent,
    nchild: c.CHLD,
    stubTile,
    age0,
    age1,
    ever,
    alive,
    ghost,
    lo,
    hi,
    flags: c.FLAG,
    meth: c.METH,
    srcm: c.SRCM,
    ntip: c.NTIP,
    ott: c.OTT_,
    pbdb: c.PBDB,
    nameBlob: nameParts.join(''),
    nameOff,
    reps,
    meta: f.meta,
    sT: T,
    sSeg,
    sW,
    offLin,
    wLin,
    offLog,
    wLog,
    tPar0,
    tParS,
    fLin,
    fLog,
    gLin,
    gLog,
  };
}

/** Typed arrays of a processed file, for postMessage transfer lists. */
export function transferables(p: ProcessedFile): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const v of Object.values(p)) {
    if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  }
  return [...out];
}

export { FLAG };
