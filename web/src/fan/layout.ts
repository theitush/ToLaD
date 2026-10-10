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
// y they sit side by side in tree order, GAP_PX apart on screen, so as
// branches thin (and extinct ones end) their neighbours slide in and the
// bundle narrows towards "now" like the stem does. Sideways moves are shaped on
// screen, so they look the same at every zoom: gaps open over OPEN_PX above the
// fork, an ended branch's slot closes above its tip over a height in
// proportion to its width on screen. Neighbours are packed at every zoom, so
// whenever they would fit on screen next to the branch one looks at, they are
// there. What a deeper width zoom changes is only which line stands upright:
// in the whole-fan view the bundle is centred (both sides narrow towards
// "now"); zooming in (PACK_FADE) the packing is referenced to the point at the
// centre of the screen instead (Pack.setRef), so the branch one looks at keeps
// its left edge, and so its living strands, upright, and its neighbours lean
// against its edges.
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
/** Height on screen (px) over which gaps open above the fork. */
export const OPEN_PX = 40;
/**
 * An ended branch's slot closes above its tip over CLOSE_K × its width on
 * screen (a sideways move's height in proportion to its size, so it is the
 * same S at every zoom), at least OPEN_PX and at most CLOSE_MAX_PX.
 */
export const CLOSE_K = 3;
export const CLOSE_MAX_PX = 240;
/**
 * Width zooms (× the whole-fan view) over which the packing's reference moves
 * from the bundle's centre (up to the first) to the point at the centre of the
 * screen (beyond the second). Zoomed in that far one looks at one branch, whose
 * green lane then stands exactly upright; the siblings stay packed against it.
 */
export const PACK_FADE: [number, number] = [5, 200];
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
 * unit) they are shown at. Packed positions are tabulated from the fork up: at
 * each height the branches sit side by side in tree order (their widths there,
 * GAP_PX apart on screen), the bundle centred. Then a common sideways shift per
 * height (it never changes the gaps) moves the reference that stands upright:
 * the bundle's centre in the whole-fan view, the screen centre's point (setRef)
 * zoomed in, blended over PACK_FADE.
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
  /** Packed, centred left edges per grid step, for the current scale. */
  private X: Float64Array[] | null = null;
  /** The upright reference: sibling `refJ`, at fraction `refS` across its gray lane and gap. */
  refJ = -1;
  refS = 0;

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

  /** How much the bundle stays centred at the current width zoom (1 = centred, 0 = referenced to setRef's point). */
  fade(): number {
    const z = Math.log(this.sx / this.sxHome);
    const [a, b] = PACK_FADE.map(Math.log);
    return 1 - smooth((z - a) / (b - a));
  }

  /**
   * Reference the packing to world point (x, y) (the screen centre): the
   * branch holding it (or nearest) and how far across it the point lies, 0 in
   * its green lane rising to 1 across its gray lane and the gap after it, so
   * the reference moves continuously from one branch to the next. Changing it
   * shifts every branch at a height by the same amount (the gaps never change).
   */
  setRef(x: number, y: number): void {
    const yc = Math.min(-1e-9, Math.max(this.time.y(0), y));
    const a = this.anchor(x, yc);
    if (!a) return;
    const b = this.branches[a.j];
    const st = strandAt(b, this.time.ageAt(yc), this.mode);
    const gw = st.w * st.f;
    const span = st.w + GAP_PX / this.sx - gw;
    this.refJ = a.j;
    this.refS = span > 0 ? Math.min(1, Math.max(0, (a.dx - gw) / span)) : 0;
  }

  private table(): Float64Array[] {
    if (this.X) return this.X;
    const bs = this.branches;
    const n = bs.length;
    const X = bs.map(() => new Float64Array(GRID + 1));
    const S = bs.map(() => 0);
    const gapW = GAP_PX / this.sx;
    for (let k = 0; k <= GRID; k++) {
      const y = -k * this.dy;
      const open = smooth((-y * this.sy) / OPEN_PX);
      let T = -gapW * open;
      for (let j = 0; j < n; j++) {
        const b = bs[j];
        const ramp = Math.min(CLOSE_MAX_PX, Math.max(OPEN_PX, CLOSE_K * (this.tipW[j] + gapW) * this.sx));
        const vis = y >= b.tipY ? 1 : 1 - smooth(((b.tipY - y) * this.sy) / ramp);
        const w = y >= b.tipY ? this.widths[j][k] : this.tipW[j];
        S[j] = (w + gapW * open) * vis;
        T += S[j];
      }
      let x = -T / 2;
      for (let j = 0; j < n; j++) {
        X[j][k] = x;
        x += S[j];
      }
    }
    return (this.X = X);
  }

  /** Packed, centred left edge of sibling j at world y (tabulated: used in the whole-fan view). */
  private centred(j: number, y: number): number {
    const X = this.table()[j];
    const f = Math.min(GRID, -y / this.dy);
    const k = Math.min(GRID - 1, Math.floor(f));
    const t = f - k;
    return X[k] + (X[k + 1] - X[k]) * t;
  }

  /** Slot of sibling j at world y (its width plus the gap after it), exactly. */
  private slot(j: number, y: number): number {
    const b = this.branches[j];
    const gapW = GAP_PX / this.sx;
    const open = smooth((-y * this.sy) / OPEN_PX);
    if (y >= b.tipY) return strandAt(b, this.time.ageAt(y), this.mode).w + gapW * open;
    const ramp = Math.min(CLOSE_MAX_PX, Math.max(OPEN_PX, CLOSE_K * (this.tipW[j] + gapW) * this.sx));
    return (this.tipW[j] + gapW * open) * (1 - smooth(((b.tipY - y) * this.sy) / ramp));
  }

  /**
   * Left edge of sibling j at world y packed against the reference point
   * (which stays at its x at the fork), from the exact slots between them: at
   * deep zooms only these relative positions matter, and they are exact.
   */
  private referenced(j: number, y: number): number {
    const a = this.refJ;
    const s = this.refS;
    const b = this.branches[a];
    let x = b.baseLeft + s * b.width - s * this.slot(a, y);
    if (j >= a) for (let i = a; i < j; i++) x += this.slot(i, y);
    else for (let i = j; i < a; i++) x -= this.slot(i, y);
    return x;
  }

  /** Left edge of sibling j at world y. */
  leftAt(j: number, y: number): number {
    if (y >= 0) return this.branches[j].baseLeft;
    const u = this.refJ < 0 ? 0 : 1 - this.fade();
    if (u <= 0) return this.centred(j, y);
    if (u >= 1) return this.referenced(j, y);
    return (1 - u) * this.centred(j, y) + u * this.referenced(j, y);
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
