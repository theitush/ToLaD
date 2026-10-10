// OneZoom-style fan for one polytomy, in world units (y grows downwards, like
// the screen). The parent branch comes up from the bottom to the fork at
// (0, 0); each species branch leaves the fork side by side (their widths add up
// to the trunk's width, so they nest) and runs up through time to its tip.
// There are no leaf blobs: a branch is the bundle of its individuals' strands.
//
// Height = time: the fork is the clade's origin, a branch's tip is the species'
// last appearance (living species: the "now" line), on a log years-before-
// present scale (TimeScale).
//
// Siblings are packed at every height (Pack), not just at the fork: at height
// y they sit side by side in tree order, GAP_PX apart on screen, the bundle
// centred, so as branches thin (and extinct ones end) their neighbours slide
// in and the bundle narrows towards "now" like the stem does. Sideways moves
// are shaped on screen, so they look the same at every zoom: gaps open over
// OPEN_PX above the fork, an ended branch's slot closes over OPEN_PX above its
// tip, and no edge drifts sideways steeper than DRIFT_SLOPE on screen (deeper
// width zooms damp the drift, so zoomed-in columns stand upright).
//
// Width at any height = the individuals whose strands pass through it: every
// individual's strand runs from the root up to its death, so at age τ the
// branch holds everyone not yet dead by τ (those alive then plus everyone born
// later). At the species' base that is everyone ever; at the tip only the
// living (living species) or nobody (extinct). Dead strands peel off on the way
// up, so the branch thins; the green (alive) lane keeps its width all the way.
//
// The stem is drawn as its children's strands side by side (view.drawStrand),
// so each green lane runs unbroken from leaf to root; the stem's width and green
// are the sums of its strands. In linear mode that equals the clade's own
// alive/ever exactly; in log mode the stem's green is the sum of its children's
// log lanes (that is what keeps strands continuous).
//
// Width = individuals (shares g/Σg, g = n linear or 1 + log10 n log, as in the
// river's layout.ts). Green = alive: each branch is split into a green lane of
// share f (alive share in the active mode) on its left and gray on its right.
// Ribbon normals point to the branch's left: for a branch going up, (-1, 0).

import type { CladeRec, SpeciesRec } from './panthera';

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 110;
export const TRUNK_LENGTH = 2400;
/** Height = time: the fork (the clade's origin) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Gap between sibling branches on screen (px). */
export const GAP_PX = 5;
/** Height on screen (px) over which gaps open above the fork, and an ended branch's slot closes above its tip. */
export const OPEN_PX = 40;
/** Steepest on-screen sideways drift (dx/dy) packing gives a branch; beyond it the drift is damped. */
export const DRIFT_SLOPE = 3;
/**
 * Width zooms (× the whole-fan view) over which the packing fades out: fully
 * packed up to the first, columns standing straight up from their slices of the
 * stem beyond the second. Zoomed in that far one looks at one branch, whose
 * strands then keep the lean of their own lane only (the living's exactly upright).
 */
export const PACK_FADE: [number, number] = [20, 2000];
/** Heights the packing is tabulated at, from the fork to "now". */
const GRID = 4096;
/**
 * Time axis offset (years). Height is log10(years before present + C). With
 * C = 10 years the axis resolves the last decades and centuries; it is close
 * to the mean lifespan of the living big cats (alive·span/ever ≈ 3–5 years),
 * which keeps the log-width taper of a living branch (the dead peeling off at
 * a constant rate) smooth right up to "now", with no bend near the tip.
 */
export const TIME_C = 10;

/** Time scale for a clade of age `originMa`: years before present ↔ height fraction (0 = origin, 1 = now). */
export class TimeScale {
  private readonly top: number;
  private readonly span: number;
  constructor(readonly originMa: number) {
    this.top = Math.log10(originMa * 1e6 + TIME_C);
    this.span = this.top - Math.log10(TIME_C);
  }
  /** Height fraction of an age given in Ma. */
  frac(ageMa: number): number {
    return (this.top - Math.log10(Math.max(0, ageMa) * 1e6 + TIME_C)) / this.span;
  }
  /** World y of an age in Ma. */
  y(ageMa: number): number {
    return -TIME_H * this.frac(ageMa);
  }
  /** Years per world unit of height at world y (the axis's local rate). */
  yearsPerUnit(y: number): number {
    return ((Math.LN10 * this.span) / TIME_H) * (this.ageAt(y) * 1e6 + TIME_C);
  }
  /** Age in Ma at world y. */
  ageAt(y: number): number {
    const f = -y / TIME_H;
    return Math.max(0, (Math.pow(10, this.top - f * this.span) - TIME_C) / 1e6);
  }
}

export interface Pt {
  x: number;
  y: number;
}

export interface FanBranch {
  sp: SpeciesRec;
  /** Index among its siblings (tree order, left to right). */
  index: number;
  /** Width share among siblings and absolute width at the fork (= individuals ever). */
  share: number;
  width: number;
  /** Alive lane fraction at the base (0 if extinct). */
  aliveFrac: number;
  /** Left edge at the fork (and down the stem): the siblings are slices of the stem there. */
  baseLeft: number;
  /** The tip (last appearance) height. */
  tipY: number;
  /** The siblings' packing, which places this branch at every height. */
  pack: Pack;
}

export interface Fan {
  clade: CladeRec;
  mode: WidthMode;
  trunkWidth: number;
  trunkBottom: Pt;
  branches: FanBranch[];
  time: TimeScale;
  pack: Pack;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Siblings packed at every height, for the screen scale (sx, sy px per world
 * unit) they are shown at. Left edges are tabulated from the fork up: at each
 * step every branch moves by the change of its packed position (the widths of
 * the siblings to its left, gaps, the bundle centred), scaled down uniformly
 * where the fastest of them would drift steeper than DRIFT_SLOPE on screen.
 * The uniform damping never makes siblings overlap (it only leaves wider gaps).
 */
export class Pack {
  sx = 1;
  sy = 1;
  /** Width zoom of the whole-fan view (PACK_FADE is relative to it). */
  sxHome = 3;
  /** World y of grid step k (k = 0 the fork, GRID "now") and the branches' widths there (scale-free). */
  private readonly dy: number;
  private readonly widths: Float64Array[];
  private readonly tipW: number[];
  private X: Float64Array[] | null = null;

  constructor(
    readonly branches: FanBranch[],
    readonly time: TimeScale,
    readonly mode: WidthMode,
  ) {
    this.dy = TIME_H / GRID;
    this.widths = branches.map((b) => {
      const a = new Float64Array(GRID + 1);
      for (let k = 0; k <= GRID; k++) {
        const y = -k * this.dy;
        a[k] = y >= b.tipY ? strandAt(b, time.ageAt(y), mode).w : 0;
      }
      return a;
    });
    this.tipW = branches.map((b) => strandAt(b, time.ageAt(b.tipY + 1e-9), mode).w);
  }

  /** Set the screen scale the packing is for (cheap if unchanged). */
  setScale(sx: number, sy: number, sxHome = this.sxHome): void {
    if (sx === this.sx && sy === this.sy && sxHome === this.sxHome && this.X) return;
    this.sx = sx;
    this.sy = sy;
    this.sxHome = sxHome;
    this.X = null;
  }

  /** How much of the packing applies at the current width zoom (1 = all, 0 = none). */
  fade(): number {
    const z = Math.log(this.sx / this.sxHome);
    const [a, b] = PACK_FADE.map(Math.log);
    return 1 - smooth((z - a) / (b - a));
  }

  private table(): Float64Array[] {
    if (this.X) return this.X;
    const bs = this.branches;
    const n = bs.length;
    const X = bs.map(() => new Float64Array(GRID + 1));
    const gapW = GAP_PX / this.sx;
    const P = new Float64Array(n);
    const prev = new Float64Array(n);
    const fade = this.fade();
    for (let k = 0; k <= GRID; k++) {
      const y = -k * this.dy;
      const open = smooth((-y * this.sy) / OPEN_PX);
      let T = -gapW * open;
      const slot = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const b = bs[j];
        const vis = y >= b.tipY ? 1 : 1 - smooth(((b.tipY - y) * this.sy) / OPEN_PX);
        const w = y >= b.tipY ? this.widths[j][k] : this.tipW[j];
        slot[j] = (w + gapW * open) * vis;
        T += slot[j];
      }
      let x = -T / 2;
      for (let j = 0; j < n; j++) {
        P[j] = x;
        x += slot[j];
      }
      if (k === 0) {
        for (let j = 0; j < n; j++) X[j][0] = bs[j].baseLeft;
      } else {
        let m = 0;
        for (let j = 0; j < n; j++) m = Math.max(m, Math.abs(P[j] - prev[j]));
        const slope = (m * this.sx) / (this.dy * this.sy);
        const lam = fade * (slope * fade > DRIFT_SLOPE ? DRIFT_SLOPE / (slope * fade) : 1);
        for (let j = 0; j < n; j++) X[j][k] = X[j][k - 1] + lam * (P[j] - prev[j]);
      }
      prev.set(P);
    }
    return (this.X = X);
  }

  /** Left edge of sibling j at world y. */
  leftAt(j: number, y: number): number {
    if (y >= 0) return this.branches[j].baseLeft;
    const X = this.table()[j];
    const f = Math.min(GRID, -y / this.dy);
    const k = Math.min(GRID - 1, Math.floor(f));
    const t = f - k;
    return X[k] + (X[k + 1] - X[k]) * t;
  }

  /**
   * Where world x lies at height y, relative to the branch holding it (or the
   * nearest one): kept fixed while the scale (and so the packing) changes, so
   * whatever is under the finger stays under it.
   */
  anchor(x: number, y: number): { j: number; dx: number } | null {
    if (y >= 0) return null;
    let best: { j: number; dx: number } | null = null;
    let bd = Infinity;
    for (const b of this.branches) {
      if (y < b.tipY) continue;
      const l = this.leftAt(b.index, y);
      const w = strandAt(b, this.time.ageAt(y), this.mode).w;
      const d = Math.max(0, l - x, x - l - w);
      if (d < bd) {
        bd = d;
        best = { j: b.index, dx: x - l };
      }
    }
    return best;
  }

  /** World x of an anchor at height y, at the current scale. */
  resolve(a: { j: number; dx: number } | null, x: number, y: number): number {
    return a ? this.leftAt(a.j, y) + a.dx : x;
  }
}

/** Left edge of a branch at world y (its green lane runs along it; the gray lies to its right). */
export function leftAt(b: FanBranch, y: number): number {
  return b.pack.leftAt(b.index, y);
}

export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : 1 + Math.max(0, Math.log10(n));
}

/**
 * Alive lane fraction at the base (everyone ever present): g(alive) / g(ever).
 * The living are present from the base to the tip, so their lane keeps this
 * absolute width all the way up; only the gray (the dead) peels off.
 */
export function aliveFrac(alive: number, ever: number, mode: WidthMode): number {
  if (!(alive > 0) || !(ever > 0)) return 0;
  return Math.min(1, g(alive, mode) / g(ever, mode));
}
/**
 * Individuals whose strands pass through age `ageMa` (not dead by then):
 * everyone ever before the species' first appearance, the living at the tip.
 * With a curated history that drives the counts, the dead peel off along its
 * real births curve (the share of all births after `ageMa`, procgen's own
 * ramps integrated); otherwise births are spread evenly over the species' span
 * (procgen's constant-size model). Either way the base is ever, the tip alive.
 */
export function remaining(sp: SpeciesRec, ageMa: number): number {
  if (ageMa >= sp.t0) return sp.ever;
  if (ageMa <= sp.t1) return sp.alive;
  const c = sp.births?.curve;
  const r = c ? Math.min(1, c.bornAfter((ageMa - sp.t1) * 1e6) / c.total) : (ageMa - sp.t1) / (sp.t0 - sp.t1);
  return sp.alive + (sp.ever - sp.alive) * r;
}

/**
 * Strand width and green fraction of a branch at age `ageMa`. The green lane
 * has the same absolute width along the whole strand (width · g(alive)/g(ever),
 * in both modes): the gray around it thins as the dead peel off, so at the tip
 * (only the living remain) the strand is exactly all green.
 */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const sp = b.sp;
  const rem = remaining(sp, ageMa);
  const gEver = g(sp.ever, mode);
  const w = rem > 0 ? (b.width * g(rem, mode)) / gEver : 0;
  const green = sp.alive > 0 ? (b.width * g(sp.alive, mode)) / gEver : 0;
  return { w, f: w > 0 ? Math.min(1, green / w) : 0 };
}


export function layoutFan(clade: CladeRec, mode: WidthMode): Fan {
  const sp = clade.species;
  const gs = sp.map((s) => g(s.ever, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const W = TRUNK_WIDTH;
  const time = new TimeScale(clade.t0);
  let x = -W / 2;
  const branches: FanBranch[] = sp.map((s, i) => {
    const share = gs[i] / sum;
    const width = share * W;
    const baseLeft = x;
    x += width;
    return {
      sp: s,
      index: i,
      share,
      width,
      aliveFrac: aliveFrac(s.alive, s.ever, mode),
      baseLeft,
      tipY: time.y(s.t1),
      pack: null as unknown as Pack,
    };
  });
  const pack = new Pack(branches, time, mode);
  for (const b of branches) b.pack = pack;
  return {
    clade,
    mode,
    trunkWidth: W,
    trunkBottom: { x: 0, y: TRUNK_LENGTH },
    branches,
    time,
    pack,
  };
}
