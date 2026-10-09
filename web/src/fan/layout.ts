// OneZoom-style fan for one polytomy, in world units (y grows downwards, like
// the screen). The parent branch comes up from the bottom to the fork at
// (0, 0); each species branch leaves the fork side by side (their widths add up
// to the trunk's width, so they nest), curves out to its own column and then
// runs straight up through time to its tip. There are no leaf blobs: a branch
// is the bundle of its individuals' strands.
//
// Height = time: the fork is the clade's origin, a branch's tip is the species'
// last appearance (living species: the "now" line), on a log years-before-
// present scale (TimeScale). Branches are spread in tree order across the width.
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
/** Horizontal spacing of the leaves. */
export const COL_W = 46;
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
  /** Width share among siblings and absolute width at the fork (= individuals ever). */
  share: number;
  width: number;
  /** Alive lane fraction at the base (0 if extinct). */
  aliveFrac: number;
  /** S-curve from the fork (p0) to the bottom of the column (p3). */
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
  /** Column x and the tip (last appearance) height. */
  colX: number;
  tipY: number;
  /** Tip point, for labels. */
  tip: Pt;
}

export interface Fan {
  clade: CladeRec;
  mode: WidthMode;
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

/**
 * Individuals whose strands pass through age `ageMa` (not dead by then):
 * everyone ever before the species' first appearance, the living at the tip.
 * Births are spread evenly over the species' span (procgen's constant-size model).
 */
export function remaining(sp: SpeciesRec, ageMa: number): number {
  if (ageMa >= sp.t0) return sp.ever;
  if (ageMa <= sp.t1) return sp.alive;
  const r = (ageMa - sp.t1) / (sp.t0 - sp.t1);
  return sp.alive + (sp.ever - sp.alive) * r;
}

/** Strand width and green fraction of a branch at age `ageMa`. */
export function strandAt(b: FanBranch, ageMa: number, mode: WidthMode): { w: number; f: number } {
  const sp = b.sp;
  const rem = remaining(sp, ageMa);
  const w = rem > 0 ? (b.width * g(rem, mode)) / g(sp.ever, mode) : 0;
  return { w, f: aliveFrac(sp.alive, rem, mode) };
}

export function layoutFan(clade: CladeRec, mode: WidthMode): Fan {
  const sp = clade.species;
  const gs = sp.map((s) => g(s.ever, mode));
  const sum = gs.reduce((a, b) => a + b, 0);
  const n = sp.length;
  const W = TRUNK_WIDTH;
  const time = new TimeScale(clade.t0);
  let x = -W / 2;
  const branches: FanBranch[] = sp.map((s, i) => {
    const share = gs[i] / sum;
    const width = share * W;
    const x0 = x + width / 2;
    x += width;
    const colX = (i - (n - 1) / 2) * COL_W;
    const tipY = time.y(s.t1);
    // The curve takes the lower part of the branch (less for short extinct ones).
    const yC = Math.max(tipY * 0.6, -0.1 * TIME_H);
    return {
      sp: s,
      share,
      width,
      aliveFrac: aliveFrac(s.alive, s.ever, mode),
      p0: { x: x0, y: 0 },
      p1: { x: x0, y: yC * 0.55 },
      p2: { x: colX, y: yC * 0.45 },
      p3: { x: colX, y: yC },
      colX,
      tipY,
      tip: { x: colX, y: tipY },
    };
  });
  return {
    clade,
    mode,
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
