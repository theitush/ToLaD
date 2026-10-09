// A species branch resolved into its individuals (procgen), as twigs.
//
// Height = time on the fan's axis. Every individual is a thin vertical twig
// from its birth to its death: dead ones stop on the way up (gray), the living
// reach the "now" line (green). Generation g is born across the branch at the
// height of its births; the N(g) individuals split the branch's width there
// equally, in procgen index order, so each is one equal unit of width and the
// branch's width (= individuals not yet dead, layout.ts) is fully partitioned.
// Each twig starts where its parents' strands meet: two parent links (procgen
// parents()) converge on the twig's base, coloured by the parent they lead
// from. Because procgen keeps children right above their parents in index
// space, the links are short and the inside of a branch is a braided mesh,
// while above species level the fan stays a tree.
//
// Only visible generations and index ranges are touched: generation from
// height via the time scale, index from x via the equal split.
//
// LOD by the on-screen width of one individual's share:
//   texture  < 2 px: the branch's green/gray lanes stand in for everyone;
//   twigs    one twig per individual, green alive / gray dead;
//   links    plus links to both parents;
//   labels   plus handles (lion#…).

import { Species, type Address } from '../../../packages/procgen/src/index.ts';
import { strandAt, type FanBranch, type TimeScale, type WidthMode } from './layout';
import type { SpeciesRec } from './panthera';

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
 * makes the number alive at the end ≈ N·L/GL = the data's alive count (the
 * pipeline's N_ever ≈ alive ÷ lifespan × T read backwards). Extinct species are
 * observed long after their last generation, so nobody is alive.
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

export interface IndInfo {
  handle: string;
  g: number;
  i: number;
  G: number;
  sex: string;
  bornYearsAgo: number;
  lifespan: number;
  alive: boolean;
  parents: { handle: string; alive: boolean }[];
  children: number;
}

export interface Twig {
  /** x at the birth height, and the fraction across the branch it keeps. */
  x: number;
  u: number;
  /** Birth and death heights (world y; death is clamped to "now"). */
  yBirth: number;
  yDeath: number;
  alive: boolean;
}

export class TwigModel {
  readonly sp: Species;
  readonly rec: SpeciesRec;
  readonly G: number;
  readonly T: number;
  readonly GL: number;
  /** Generations a twig can span (lifespans reach up to 2× the mean). */
  readonly span: number;
  /** First generation in which anybody can still be alive (G if extinct). */
  readonly aliveFrom: number;

  constructor(
    readonly b: FanBranch,
    readonly time: TimeScale,
    readonly mode: WidthMode,
  ) {
    this.rec = b.sp;
    this.sp = speciesModel(b.sp);
    this.G = this.sp.generations;
    this.T = Number(this.sp.totalEver);
    this.GL = this.sp.generationYears;
    this.span = Math.ceil((2 * this.sp.lifespanYears) / this.GL) + 1;
    this.aliveFrom = this.rec.extinct ? this.G : Math.max(0, this.G - this.span);
  }

  size(g: number): number {
    return Number(this.sp.size(g));
  }

  /** Age (Ma) of a moment `tYears` after the species' first appearance. */
  ageOf(tYears: number): number {
    return Math.max(0, this.rec.t0 - tYears / 1e6);
  }

  yOf(tYears: number): number {
    return this.time.y(this.ageOf(tYears));
  }

  /** Years before present of the middle of generation g's births. */
  bornAgo(g: number): number {
    return this.ageOf((g + 0.5) * this.GL) * 1e6;
  }

  /** Generation born at world height y (clamped). */
  generationAt(y: number): number {
    const age = this.time.ageAt(y);
    const t = (this.rec.t0 - age) * 1e6;
    return Math.min(this.G - 1, Math.max(0, Math.floor(t / this.GL)));
  }

  /** Branch width at world height y (the fan's width function, layout.ts). */
  widthAt(y: number): number {
    return strandAt(this.b, this.time.ageAt(y), this.mode).w;
  }

  /** Branch width and left edge at the height of generation g's births (row centre). */
  row(g: number): { y: number; left: number; w: number; n: number } {
    const y = this.yOf((g + 0.5) * this.GL);
    const w = this.widthAt(y);
    return { y, left: this.b.colX - w / 2, w, n: this.size(g) };
  }

  /** Fraction across the branch of individual (g, i): the centre of its equal share of its generation. */
  u(g: number, i: number): number {
    return (i + 0.5) / this.size(g);
  }

  /**
   * x of a strand at fraction u at height y. A twig keeps its fraction of the
   * branch, so it follows the branch's silhouette as the branch narrows: the
   * twigs never stick out of the bundle drawn when zoomed out.
   */
  xAt(u: number, y: number): number {
    return this.b.colX + (u - 0.5) * this.widthAt(y);
  }

  /** x of individual (g, i) at the height of its generation's births. */
  x(g: number, i: number): number {
    const r = this.row(g);
    return r.left + ((i + 0.5) * r.w) / r.n;
  }

  /** Index range [i0, i1) of generation g whose shares overlap [x0, x1] at height y (default: g's birth row). */
  indexRange(g: number, x0: number, x1: number, y?: number): [number, number] {
    const r = this.row(g);
    const w = y === undefined ? r.w : this.widthAt(y);
    const left = this.b.colX - w / 2;
    const i0 = Math.max(0, Math.floor(((x0 - left) / w) * r.n));
    const i1 = Math.min(r.n, Math.ceil(((x1 - left) / w) * r.n));
    return [i0, Math.max(i0, i1)];
  }

  twig(g: number, i: number): Twig {
    const a = this.sp.attributes({ generation: g, index: BigInt(i) });
    const end = Math.min(a.deathTime, this.sp.now);
    return { x: this.xAt(this.u(g, i), this.yOf(a.birthTime)), u: this.u(g, i), yBirth: this.yOf(a.birthTime), yDeath: this.yOf(end), alive: a.alive };
  }

  alive(g: number, i: number): boolean {
    if (g < this.aliveFrom) return false;
    return this.sp.attributes({ generation: g, index: BigInt(i) }).alive;
  }

  parents(g: number, i: number): Address[] {
    return this.sp.parents({ generation: g, index: BigInt(i) });
  }

  /**
   * Nearest twig to a world point within `slop` (x) and `slopY` (y): a finger's
   * reach in world units per axis. Searches the generations that can reach that height.
   */
  hit(wx: number, wy: number, slop: number, slopY = slop): { g: number; i: number } | null {
    const gTop = this.generationAt(wy);
    let best: { g: number; i: number } | null = null;
    let bd = Infinity;
    for (let g = this.generationAt(wy - slopY); g >= Math.max(0, gTop - this.span); g--) {
      const [i0, i1] = this.indexRange(g, wx - slop, wx + slop, wy);
      for (let i = i0; i < i1; i++) {
        const t = this.twig(g, i);
        const yc = Math.min(t.yBirth, Math.max(t.yDeath, wy));
        const d = Math.hypot((wx - this.xAt(t.u, yc)) / slop, (wy - yc) / slopY);
        if (d <= 1 && d < bd) {
          bd = d;
          best = { g, i };
        }
      }
    }
    return best;
  }

  info(g: number, i: number): IndInfo {
    const sp = this.sp;
    const a = { generation: g, index: BigInt(i) };
    const at = sp.attributes(a);
    return {
      handle: sp.handle(a),
      g,
      i,
      G: this.G,
      sex: at.sex,
      bornYearsAgo: this.ageOf(at.birthTime) * 1e6,
      lifespan: at.lifespan,
      alive: at.alive,
      parents: sp.parents(a).map((p) => ({ handle: sp.handle(p), alive: this.alive(p.generation, Number(p.index)) })),
      children: Number(sp.children(a).count),
    };
  }
}

// ---- drawing ------------------------------------------------------------------

/** Pixels a dead twig stops short of "now", at any zoom: only the living touch it. */
const DEAD_GAP_PX = 3;

/** World y of a twig's top: its death, kept visibly below "now" if it is dead. */
function twigTop(v: TwigView, t: Twig): number {
  if (t.alive) return t.yDeath;
  return Math.max(t.yDeath, v.yNow + DEAD_GAP_PX / v.sy);
}

/** Trace a twig from birth to top, following the branch's silhouette; returns the top's screen point. */
function twigPath(v: TwigView, m: TwigModel, t: Twig, path: Path2D | CanvasRenderingContext2D): [number, number] {
  const top = twigTop(v, t);
  const [x0, y0] = v.toScreen(t.x, t.yBirth);
  path.moveTo(x0, y0);
  const lenPx = (t.yBirth - top) * v.sy;
  const K = Math.max(1, Math.min(12, Math.ceil(lenPx / 60)));
  let p: [number, number] = [x0, y0];
  for (let k = 1; k <= K; k++) {
    const y = t.yBirth + ((top - t.yBirth) * k) / K;
    p = v.toScreen(m.xAt(t.u, y), y);
    path.lineTo(p[0], p[1]);
  }
  return p;
}

export interface TwigView {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Pixels per world unit: width and time. */
  sx: number;
  sy: number;
  toScreen(x: number, y: number): [number, number];
  toWorld(px: number, py: number): [number, number];
  /** World y of "now". */
  readonly yNow: number;
}

export interface TwigStats {
  mode: 'twigs' | 'links' | 'labels' | 'texture';
  g0: number;
  g1: number;
  drawn: number;
  cellPx: number;
}

const GREEN = '#33bd66';
const TWIG_GRAY = '#9aa3ab';
const TWIG_WITHERED = '#a39a88';
const LINK_GREEN = 'rgba(51,189,102,0.7)';
const LINK_GRAY = 'rgba(170,178,186,0.45)';
const MAX_TWIGS = 6000;
const MAX_LINKS = 2000;

/** Individuals of one branch, or null when they are below a pixel (the lanes stand in). */
export function drawTwigs(v: TwigView, b: FanBranch, m: TwigModel, sel: { g: number; i: number } | null): TwigStats | null {
  const [wx0, wyTop] = v.toWorld(0, 0);
  const [wx1, wyBot] = v.toWorld(v.w, v.h);
  // Off the branch's column entirely?
  if (wx1 < b.colX - b.width || wx0 > b.colX + b.width) return null;
  if (wyBot < b.tipY || wyTop > b.p3.y) return null;
  const gHi = m.generationAt(Math.max(wyTop, b.tipY));
  const gLo = Math.max(0, m.generationAt(Math.min(wyBot, b.p3.y)) - m.span);
  const gm = Math.round((gHi + Math.max(gLo, gHi - 50)) / 2);
  const r = m.row(gm);
  const cellPx = (r.w / r.n) * v.sx;
  if (cellPx < 2) return null;
  // Estimate how many twigs are visible.
  const visFrac = Math.min(1, (wx1 - wx0) / Math.max(1e-300, r.w));
  const perRow = Math.max(1, r.n * visFrac);
  const rows = gHi - gLo + 1;
  if (rows * perRow > MAX_TWIGS) return { mode: 'texture', g0: gLo, g1: gHi, drawn: 0, cellPx };
  const ctx = v.ctx;
  const showLinks = cellPx >= 5 && rows * perRow <= MAX_LINKS;
  const showLabels = cellPx >= 70;
  const stats: TwigStats = { mode: showLabels ? 'labels' : showLinks ? 'links' : 'twigs', g0: gLo, g1: gHi, drawn: 0, cellPx };
  const ext = b.sp.extinct;

  const twigs: { g: number; i: number; t: Twig }[] = [];
  for (let g = gLo; g <= gHi; g++) {
    // The branch is widest at the lowest visible point of this generation's twigs.
    const [i0, i1] = m.indexRange(g, wx0, wx1, Math.min(wyBot, m.row(g).y + m.GL));
    for (let i = i0; i < i1; i++) {
      const t = m.twig(g, i);
      if (t.yBirth < wyTop || t.yDeath > wyBot) continue; // whole twig off screen vertically
      twigs.push({ g, i, t });
    }
  }

  const lw = Math.max(1, Math.min(4, cellPx * 0.12));
  if (showLinks) {
    const green = new Path2D();
    const gray = new Path2D();
    const grayFar = new Path2D();
    for (const { g, i, t } of twigs) {
      if (g === 0) continue;
      const [cx, cy] = v.toScreen(t.x, t.yBirth);
      for (const p of m.parents(g, i)) {
        const pg = p.generation;
        const pi = Number(p.index);
        const pt = m.twig(pg, pi);
        // From the parent's strand at the child's birth (or at its own death, if earlier) to the child's base.
        const yl = Math.max(pt.yDeath, t.yBirth);
        const [px, py] = v.toScreen(m.xAt(pt.u, yl), yl);
        // Long links (the rare migrants) are drawn faint so the local braid reads.
        const far = Math.abs(px - cx) > 8 * cellPx;
        const path = pt.alive ? green : far ? grayFar : gray;
        path.moveTo(px, py);
        path.lineTo(cx, cy);
      }
    }
    ctx.lineWidth = Math.max(0.75, lw * 0.6);
    ctx.strokeStyle = 'rgba(170,178,186,0.14)';
    ctx.stroke(grayFar);
    ctx.strokeStyle = LINK_GRAY;
    ctx.stroke(gray);
    ctx.strokeStyle = LINK_GREEN;
    ctx.stroke(green);
  }

  const green = new Path2D();
  const gray = new Path2D();
  const tipR = Math.max(1.2, Math.min(5, cellPx * 0.18));
  for (const { t } of twigs) {
    const path = t.alive ? green : gray;
    const [x, yd] = twigPath(v, m, t, path);
    path.moveTo(x + tipR, yd);
    path.arc(x, yd, tipR, 0, Math.PI * 2);
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = ext ? TWIG_WITHERED : TWIG_GRAY;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.stroke(gray);
  ctx.fill(gray);
  ctx.strokeStyle = GREEN;
  ctx.fillStyle = GREEN;
  ctx.stroke(green);
  ctx.fill(green);
  stats.drawn = twigs.length;

  if (sel) {
    const t = m.twig(sel.g, sel.i);
    const [x, yb] = v.toScreen(t.x, t.yBirth);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw + 2;
    ctx.beginPath();
    twigPath(v, m, t, ctx);
    if (sel.g > 0) {
      for (const p of m.parents(sel.g, sel.i)) {
        const pt = m.twig(p.generation, Number(p.index));
        const yl = Math.max(pt.yDeath, t.yBirth);
        const [px, py] = v.toScreen(m.xAt(pt.u, yl), yl);
        ctx.moveTo(px, py);
        ctx.lineTo(x, yb);
      }
    }
    ctx.stroke();
  }

  if (showLabels) {
    ctx.save();
    ctx.font = `12px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#dfe7e2';
    for (const { g, i, t } of twigs) {
      const [x, yd] = v.toScreen(m.xAt(t.u, twigTop(v, t)), twigTop(v, t));
      const y = Math.min(v.h - 4, Math.max(16, yd - tipR - 3));
      ctx.fillText(m.sp.handle({ generation: g, index: BigInt(i) }), x, y, cellPx * 0.95);
    }
    ctx.restore();
  }
  return stats;
}
