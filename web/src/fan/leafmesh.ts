// A species leaf filled with its individuals (procgen), area-honest.
//
// Geometry (leaf-local frame: y runs from the stem, y = 0, to the tip, y = L;
// x runs across, 0 on the midrib). The leaf's width is w(y) = W·(a + (1−a)·sin(πy/L)).
// Generations are rows across the leaf, oldest at the stem and newest at the tip,
// placed so that the leaf area below row g is exactly C(g)/T of the whole leaf.
// Inside a row the N(g) individuals split the width equally at every height, so
// every individual is exactly one equal unit of area. Living individuals are in
// the last rows, so a living species' leaf has a green tip.
//
// Why rows and not the concentric rings the brief suggested: with rings, ring g
// is 1/(2G) of the radius thick but holds only N(g) cells around the whole
// circumference. For the lion (G ≈ 537k generations, N ≈ 75k per generation) a
// cell would be ~90× wider than tall, and procgen's parent links (median 19
// slots sideways) would be ~1700× longer than they are tall. Rows keep cells
// close to square for a leaf of fixed shape (lion ≈ 3:1) and keep parents in
// the row just below their children.
//
// Everything is computed analytically from (g, i); nothing is stored, and only
// the visible rows and index ranges are ever touched.

import { Species, type Address } from '../../../packages/procgen/src/index.ts';
import type { SpeciesRec } from './panthera';

/** Leaf outline parameter: relative width at the stem and the tip. */
export const LEAF_A = 0.2;
/** Length / max width of every leaf. */
export const LEAF_ASPECT = 2.4;
const AREA_FACTOR = LEAF_A + (1 - LEAF_A) * (2 / Math.PI);

export class LeafShape {
  readonly total: number;
  constructor(
    readonly W: number,
    readonly L: number,
  ) {
    this.total = this.area(L);
  }
  static ofArea(area: number): LeafShape {
    const W = Math.sqrt(area / (LEAF_ASPECT * AREA_FACTOR));
    return new LeafShape(W, W * LEAF_ASPECT);
  }
  width(y: number): number {
    return this.W * (LEAF_A + (1 - LEAF_A) * Math.sin((Math.PI * y) / this.L));
  }
  /** Area between the stem and height y. */
  area(y: number): number {
    const { W, L } = this;
    return W * (LEAF_A * y + ((1 - LEAF_A) * L * (1 - Math.cos((Math.PI * y) / L))) / Math.PI);
  }
  /** Inverse of `area` (monotone; Newton from a bisection bracket). */
  yOfArea(A: number): number {
    if (A <= 0) return 0;
    if (A >= this.total) return this.L;
    let lo = 0;
    let hi = this.L;
    let y = (A / this.total) * this.L;
    for (let it = 0; it < 60; it++) {
      const f = this.area(y) - A;
      if (f > 0) hi = y;
      else lo = y;
      const ny = y - f / this.width(y);
      const next = ny > lo && ny < hi ? ny : (lo + hi) / 2;
      if (Math.abs(next - y) <= 1e-15 * this.L) {
        y = next;
        break;
      }
      y = next;
    }
    return y;
  }
}

function keyOf(common: string): string {
  return common
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * procgen model of a species from its data: G = duration / generation length
 * generations of constant size N = ever / G. Mean lifespan L = alive·duration/ever
 * makes the number alive at the end ≈ N·L/GL = the data's alive count (this is
 * the pipeline's N_ever ≈ alive ÷ lifespan × T read backwards). Extinct species
 * are observed long after their last generation, so nobody is alive.
 */
export function speciesModel(rec: SpeciesRec): Species {
  const years = (rec.t0 - rec.t1) * 1e6;
  const GL = rec.genYears;
  const G = Math.max(1, Math.round(years / GL));
  const N = Math.max(2, Math.round(rec.ever / G));
  const lifespan = rec.alive > 0 ? (rec.alive * years) / rec.ever : GL * 0.5;
  return new Species({
    key: keyOf(rec.common),
    sexual: true,
    segments: [{ generations: G, startSize: N }],
    generationYears: GL,
    lifespanYears: lifespan,
    now: rec.extinct ? (G + 1000) * GL : undefined,
  });
}

export interface Pt {
  x: number;
  y: number;
}

export class LeafMesh {
  readonly sp: Species;
  readonly T: number;
  readonly G: number;
  /** First generation in which anybody can still be alive (G if extinct). */
  readonly aliveFrom: number;
  private rowCache = new Map<number, number>();

  constructor(
    readonly rec: SpeciesRec,
    readonly shape: LeafShape,
  ) {
    this.sp = speciesModel(rec);
    this.T = Number(this.sp.totalEver);
    this.G = this.sp.generations;
    const s = this.sp;
    this.aliveFrom = rec.extinct
      ? this.G
      : Math.max(0, this.G - 1 - Math.ceil((2 * s.lifespanYears) / s.generationYears));
  }

  size(g: number): number {
    return Number(this.sp.size(g));
  }

  /** y where generation g starts (g = G gives L). */
  rowStart(g: number): number {
    let y = this.rowCache.get(g);
    if (y === undefined) {
      const C = Number(this.sp.cumulative(g));
      y = this.shape.yOfArea((C / this.T) * this.shape.total);
      if (this.rowCache.size > 20000) this.rowCache.clear();
      this.rowCache.set(g, y);
    }
    return y;
  }

  /** Generation containing height y. */
  generationAt(y: number): number {
    const A = this.shape.area(Math.min(this.shape.L, Math.max(0, y)));
    const k = Math.min(this.T - 1, Math.max(0, Math.floor((A / this.shape.total) * this.T)));
    let g = this.sp.population.generationOf(BigInt(k));
    // Float rounding can put us one row off near a boundary; fix against rowStart.
    while (g > 0 && this.rowStart(g) > y) g--;
    while (g < this.G - 1 && this.rowStart(g + 1) <= y) g++;
    return g;
  }

  /** Leaf-local centre of individual (g, i). */
  position(g: number, i: number): Pt {
    const y0 = this.rowStart(g);
    const y1 = this.rowStart(g + 1);
    const y = (y0 + y1) / 2;
    const w = this.shape.width(y);
    const n = this.size(g);
    return { x: -w / 2 + ((i + 0.5) * w) / n, y };
  }

  /** Index range [i0, i1) of row g whose cells overlap x ∈ [x0, x1] at the row centre. */
  indexRange(g: number, x0: number, x1: number): [number, number] {
    const y = (this.rowStart(g) + this.rowStart(g + 1)) / 2;
    const w = this.shape.width(y);
    const n = this.size(g);
    const i0 = Math.max(0, Math.floor(((x0 + w / 2) / w) * n));
    const i1 = Math.min(n, Math.ceil(((x1 + w / 2) / w) * n));
    return [i0, Math.max(i0, i1)];
  }

  /** Individual whose cell contains a leaf-local point, or null outside the leaf. */
  hit(p: Pt): Address | null {
    if (p.y < 0 || p.y >= this.shape.L) return null;
    const w = this.shape.width(p.y);
    if (Math.abs(p.x) > w / 2) return null;
    const g = this.generationAt(p.y);
    const n = this.size(g);
    const i = Math.min(n - 1, Math.max(0, Math.floor(((p.x + w / 2) / w) * n)));
    return { generation: g, index: BigInt(i) };
  }

  alive(g: number, i: number): boolean {
    if (g < this.aliveFrom) return false;
    return this.sp.attributes({ generation: g, index: BigInt(i) }).alive;
  }

  parents(g: number, i: number): Address[] {
    return this.sp.parents({ generation: g, index: BigInt(i) });
  }
}
