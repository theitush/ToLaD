// OneZoom-style fan for one polytomy, in world units (y grows downwards, like
// the screen). The parent branch comes up from the bottom to the fork at
// (0, 0); each species branch leaves the fork side by side (their widths add up
// to the trunk's width, so they nest), curves outwards and ends in a leaf.
//
// Height = time: the fork is the clade's origin, a leaf's tip is the species'
// last appearance (living species: the "now" line), on a log years-before-
// present scale (TimeScale). Leaves are spread in tree order across the width.
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

import { LeafShape } from './leafmesh';
import type { CladeRec, SpeciesRec } from './panthera';

export type WidthMode = 'log' | 'linear';

export const TRUNK_WIDTH = 72;
export const TRUNK_LENGTH = 2400;
/** Height = time: the fork (the clade's origin) is at y = 0, "now" at y = −TIME_H. */
export const TIME_H = 900;
/** Horizontal spacing of the leaves. */
export const COL_W = 46;
/** Area of the biggest leaf (others scale by g/gmax: area = individuals). */
export const LEAF_MAX_AREA = 2300;
/**
 * Time axis offset (years). Height is log10(years before present + C), so the
 * last ~10 kyr are not squashed against "now": the cave lion (extinct ~12 kya)
 * and a 4.9 Myr old genus both read clearly. The axis is labelled as log.
 */
export const TIME_C = 1000;

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
  /** Width share among siblings and absolute width at the fork. */
  share: number;
  width: number;
  /** Width where the branch meets its leaf. */
  endWidth: number;
  /** Alive lane fraction (0 if extinct). */
  aliveFrac: number;
  /** Cubic Bézier control points, fork → leaf. */
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
  /** Leaf centre and radius. Leaf area holds the individuals. */
  leaf: Pt;
  /** Half the leaf's length (a rough radius for fitting and hit slop). */
  leafR: number;
  /** Stem end of the leaf; the leaf runs from here along `dir`. */
  base: Pt;
  shape: LeafShape;
  /** Direction the branch arrives in at the leaf (unit vector). */
  dir: Pt;
}

export interface Fan {
  clade: CladeRec;
  trunkWidth: number;
  trunkBottom: Pt;
  branches: FanBranch[];
  time: TimeScale;
}

export function g(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : 1 + Math.max(0, Math.log10(n));
}

/** Alive lane fraction: g(alive) / (g(alive) + g(dead)), floored by the renderer. */
export function aliveFrac(alive: number, ever: number, mode: WidthMode): number {
  if (!(alive > 0)) return 0;
  if (mode === 'linear') return alive / ever;
  const ga = g(alive, mode);
  const gd = g(Math.max(0, ever - alive), mode);
  return ga / (ga + gd);
}

export function layoutFan(clade: CladeRec, mode: WidthMode): Fan {
  const sp = clade.species;
  const gs = sp.map((s) => g(s.ever, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const gMax = Math.max(...gs);
  const n = sp.length;
  const W = TRUNK_WIDTH;
  const time = new TimeScale(clade.t0);
  let x = -W / 2;
  const branches: FanBranch[] = sp.map((s, i) => {
    const share = gs[i] / sum;
    const width = share * W;
    const x0 = x + width / 2;
    x += width;
    // Height = time: the leaf's tip is the species' last appearance (now for the living).
    const shape = LeafShape.ofArea((LEAF_MAX_AREA * gs[i]) / gMax);
    const tipX = (i - (n - 1) / 2) * COL_W;
    const tipY = time.y(s.t1);
    const dl = Math.hypot(tipX * 0.12, TIME_H);
    const dir = { x: (tipX * 0.12) / dl, y: -TIME_H / dl };
    const base = { x: tipX - dir.x * shape.L, y: tipY - dir.y * shape.L };
    const leafR = shape.L / 2;
    const leaf = { x: base.x + dir.x * leafR, y: base.y + dir.y * leafR };
    const end = base;
    const R = Math.hypot(base.x - x0, base.y);
    const p0 = { x: x0, y: 0 };
    const p1 = { x: x0, y: Math.max(base.y * 0.5, -R * 0.45) };
    const p2 = { x: end.x - dir.x * R * 0.3, y: end.y - dir.y * R * 0.3 };
    return {
      sp: s,
      share,
      width,
      endWidth: Math.min(width, shape.width(0)),
      aliveFrac: aliveFrac(s.alive, s.ever, mode),
      p0,
      p1,
      p2,
      p3: end,
      leaf,
      leafR,
      base,
      shape,
      dir,
    };
  });
  return {
    clade,
    trunkWidth: W,
    trunkBottom: { x: 0, y: TRUNK_LENGTH },
    branches,
    time,
  };
}

export function bezier(b: FanBranch, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const c = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * b.p0.x + c * b.p1.x + d * b.p2.x + e * b.p3.x,
    y: a * b.p0.y + c * b.p1.y + d * b.p2.y + e * b.p3.y,
  };
}

export function bezierTangent(b: FanBranch, t: number): Pt {
  const u = 1 - t;
  const x = 3 * u * u * (b.p1.x - b.p0.x) + 6 * u * t * (b.p2.x - b.p1.x) + 3 * t * t * (b.p3.x - b.p2.x);
  const y = 3 * u * u * (b.p1.y - b.p0.y) + 6 * u * t * (b.p2.y - b.p1.y) + 3 * t * t * (b.p3.y - b.p2.y);
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** Smooth taper from the fork width to the leaf width. */
export function widthAt(b: FanBranch, t: number): number {
  const s = t * t * (3 - 2 * t);
  return b.width + (b.endWidth - b.width) * s;
}
