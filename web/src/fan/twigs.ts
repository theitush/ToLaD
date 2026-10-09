// A species branch resolved into its individuals (procgen): the same lanes as
// the zoomed-out branch, resolved into strands.
//
// Height = time on the fan's axis; width = individuals whose strands pass.
// At every height the branch is the fan's two lanes (layout.ts strandAt): the
// living's green lane on the left (constant width) and the dead's gray lane
// (thinning as they peel off). Every strand keeps its fraction of its lane
// from its tip all the way down to the root, so strands follow the branch's
// silhouette and never leave it:
//   - one deep-green strand per living individual, from "now" to the base;
//   - in the gray lane, one strand slot per procgen index; each individual's
//     own life (birth to death) is drawn on its slot: pale green if it has
//     living descendants, gray if its line ended. Procgen keeps children right
//     above their parents in index space, so a slot is roughly a family line.
//   - threads to both parents (procgen parents()) at each child's birth: the
//     mesh where lines interbreed.
// Only visible generations and index ranges are touched: generation from
// height via the time scale, index from x via the lanes.
//
// LOD by the on-screen spacing of strands (one procgen index slot):
//   < 2 px    the branch's green/gray lanes stand in for everyone;
//   2–10 px   strands, then individuals, fade in over the lanes (no switch);
//   links     plus threads to both parents and who has living descendants;
//   labels    plus handles (lion#…).

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

  /**
   * The branch's two lanes at height y, exactly as the fan draws them: the
   * living's green lane on the left (constant width), the dead's gray lane on
   * the right (thinning as they peel off). World units.
   */
  lanes(y: number): { left: number; w: number; gw: number } {
    const st = strandAt(this.b, this.time.ageAt(y), this.mode);
    return { left: this.b.colX - st.w / 2, w: st.w, gw: st.w * st.f };
  }

  /** Fraction across its lane of individual (g, i): the centre of its equal share of its generation. */
  u(g: number, i: number): number {
    return (i + 0.5) / this.size(g);
  }

  /**
   * x of the strand at lane fraction u at height y, in the green lane (alive) or
   * the gray lane (dead). A strand keeps its fraction of its lane from its tip
   * all the way down, so it follows the branch's silhouette and the lanes, and
   * never sticks out of the bundle drawn when zoomed out.
   */
  xAt(u: number, y: number, alive = false): number {
    const L = this.lanes(y);
    return alive ? L.left + u * L.gw : L.left + L.gw + u * (L.w - L.gw);
  }

  /** x of individual (g, i) at its birth. */
  x(g: number, i: number): number {
    return this.twig(g, i).x;
  }

  /** Index range [i0, i1) of generation g whose shares of a lane overlap [x0, x1] at height y (default: g's birth row). */
  indexRange(g: number, x0: number, x1: number, y?: number, alive = false): [number, number] {
    const L = this.lanes(y ?? this.row(g).y);
    const left = alive ? L.left : L.left + L.gw;
    const w = Math.max(1e-300, alive ? L.gw : L.w - L.gw);
    const n = this.size(g);
    const i0 = Math.max(0, Math.floor(((x0 - left) / w) * n));
    const i1 = Math.min(n, Math.ceil(((x1 - left) / w) * n));
    return [i0, Math.max(i0, i1)];
  }

  twig(g: number, i: number): Twig {
    const a = this.sp.attributes({ generation: g, index: BigInt(i) });
    const end = Math.min(a.deathTime, this.sp.now);
    const u = this.u(g, i);
    const yBirth = this.yOf(a.birthTime);
    return { x: this.xAt(u, yBirth, a.alive), u, yBirth, yDeath: this.yOf(end), alive: a.alive };
  }

  alive(g: number, i: number): boolean {
    if (g < this.aliveFrom) return false;
    return this.sp.attributes({ generation: g, index: BigInt(i) }).alive;
  }

  parents(g: number, i: number): Address[] {
    return this.sp.parents({ generation: g, index: BigInt(i) });
  }

  // ---- living descendants ------------------------------------------------------

  private lineageCache = new Map<string, boolean>();

  /**
   * Does (g, i) have a living descendant? Its children (procgen's contiguous
   * child range, for either sex: a father's children are his couple's), then
   * down the mother line (the strands' line): daughters' children, and so on,
   * until someone alive is found or every line has ended. Exact when the
   * search finishes within `budget` children() lookups, which it does for
   * everyone near "now" and for every line that dies out early (most do).
   *
   * Approximation, for a line still going when the budget runs out far from
   * "now": f mother lines at generation gF each survive the k generations to
   * the living with the critical branching-process probability ≈ 2/(k+2)
   * (one daughter per mother on average), so p = 1 − (1 − 2/(k+2))^f; the
   * individual's own hash decides against p. Deterministic: the same answer at
   * every zoom and on every device.
   */
  hasLivingDescendant(g: number, i: number, budget = 400): boolean {
    const key = `${g}:${i}`;
    const hit = this.lineageCache.get(key);
    if (hit !== undefined) return hit;
    const res = this.searchLiving(g, i, budget);
    this.lineageCache.set(key, res);
    return res;
  }

  /** Has this been worked out already (cheap to ask while drawing)? */
  knowsLineage(g: number, i: number): boolean {
    return this.lineageCache.has(`${g}:${i}`);
  }

  private searchLiving(g0: number, i0: number, budget: number): boolean {
    const sp = this.sp;
    let frontier: Address[] = [{ generation: g0, index: BigInt(i0) }];
    let calls = 0;
    while (frontier.length) {
      const next: Address[] = [];
      for (const a of frontier) {
        if (calls >= budget) {
          // Out of budget: the expected-value shortcut on what is left.
          const gF = frontier[0].generation;
          const k = Math.max(0, this.aliveFrom - gF);
          const f = frontier.length;
          const p = 1 - Math.pow(1 - Math.min(1, 2 / (k + 2)), f);
          return sp.fieldHash({ generation: g0, index: BigInt(i0) }, 17) / 4294967296 < p;
        }
        calls++;
        const ch = sp.children(a);
        if (ch.count === 0n) continue;
        const cg = ch.generation;
        for (let c = ch.start; c < ch.start + ch.count; c++) {
          const ca = { generation: cg, index: c };
          if (cg >= this.aliveFrom && sp.attributes(ca).alive) return true;
          if (sp.sexOf(ca) === 'female') next.push(ca);
        }
      }
      frontier = next;
    }
    return false;
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
      for (const alive of g >= this.aliveFrom ? [false, true] : [false]) {
        const [i0, i1] = this.indexRange(g, wx - slop, wx + slop, wy, alive);
        for (let i = i0; i < i1; i++) {
          const t = this.twig(g, i);
          if (t.alive !== alive) continue;
          const yc = Math.min(t.yBirth, Math.max(t.yDeath, wy));
          const d = Math.hypot((wx - this.xAt(t.u, yc, alive)) / slop, (wy - yc) / slopY);
          if (d <= 1 && d < bd) {
            bd = d;
            best = { g, i };
          }
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
  /** On-screen width of one strand slot (the wider lane), and the strands' fade-in (0–1) per lane. */
  cellPx: number;
  fade: number;
  fadeGreen: number;
  /** Lineage answers still being worked out (drawn gray until known): redraw. */
  pending: boolean;
}

/** The living: a deep, saturated green. */
export const LIVING = '#33bd66';
/** Dead, with living descendants (their strands carry the living's): a paler green. */
export const LINEAGE = '#86c49a';
const TWIG_GRAY = '#9aa3ab';
const TWIG_WITHERED = '#a39a88';
const MAX_TWIGS = 6000;
const MAX_LINKS = 2000;
const MAX_STRANDS = 500;
/** Milliseconds per frame spent working out who has living descendants. */
const LINEAGE_MS = 8;

/** Mesh fade-in by the on-screen strand spacing: none below 2 px, full from 10 px. */
export function meshFade(cellPx: number): number {
  return Math.max(0, Math.min(1, (cellPx - 2) / 8));
}

/** World y of a twig's top: its death, kept visibly below "now" if it is dead. */
function twigTop(v: TwigView, t: Twig): number {
  if (t.alive) return t.yDeath;
  return Math.max(t.yDeath, v.yNow + DEAD_GAP_PX / v.sy);
}

/** Trace the strand at lane fraction u from y0 to y1 (world), following the lanes. */
function strandPath(v: TwigView, m: TwigModel, u: number, alive: boolean, y0: number, y1: number, path: Path2D | CanvasRenderingContext2D, move = true): [number, number] {
  const lenPx = Math.abs(y0 - y1) * v.sy;
  const K = Math.max(1, Math.min(16, Math.ceil(lenPx / 50)));
  let p = v.toScreen(m.xAt(u, y0, alive), y0);
  if (move) path.moveTo(p[0], p[1]);
  else path.lineTo(p[0], p[1]);
  for (let k = 1; k <= K; k++) {
    const y = y0 + ((y1 - y0) * k) / K;
    p = v.toScreen(m.xAt(u, y, alive), y);
    path.lineTo(p[0], p[1]);
  }
  return p;
}

/** Trace a twig from birth to top; returns the top's screen point. */
function twigPath(v: TwigView, m: TwigModel, t: Twig, path: Path2D | CanvasRenderingContext2D): [number, number] {
  return strandPath(v, m, t.u, t.alive, t.yBirth, twigTop(v, t), path);
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/**
 * The inside of one branch: the same lanes as the zoomed-out branch, resolved
 * into strands. Every strand keeps its fraction of its lane from its tip all
 * the way down to the root, like the fan's lanes:
 *   - the green lane holds one deep-green strand per living individual, from
 *     "now" down to the base: green lines all the way back;
 *   - the gray lane holds the dead, one strand slot per procgen index (procgen
 *     keeps children right above their parents in index space, so a slot is
 *     roughly a family line); each individual's own life is drawn on its slot,
 *     pale green if it has living descendants, gray if its line ended.
 *   - links: threads to both parents (procgen parents()) at the child's birth,
 *     the mother's and the father's, green when that parent has living descendants.
 * Everything fades in from the lanes as strands become 2–10 px apart, so the
 * zoom is continuous. Only the visible generations and index ranges are touched.
 */
export function drawTwigs(v: TwigView, b: FanBranch, m: TwigModel, sel: { g: number; i: number } | null): TwigStats | null {
  const [, wyTop] = v.toWorld(0, 0);
  const [, wyBot] = v.toWorld(v.w, v.h);
  // The visible x range at a height (the camera may shear x with height, view.ts).
  const xr = (y: number): [number, number] => {
    const py = v.toScreen(0, y)[1];
    return [v.toWorld(0, py)[0], v.toWorld(v.w, py)[0]];
  };
  if (wyBot < b.tipY || wyTop > b.p3.y) return null;
  const yTop = Math.max(wyTop, b.tipY);
  const yBot = Math.min(wyBot, b.p3.y);
  // Off the branch's column entirely?
  const Lb = m.lanes(yBot);
  const [bx0, bx1] = xr(yBot);
  if (bx1 < Lb.left || bx0 > Lb.left + Lb.w) return null;
  const ym = (yTop + yBot) / 2;
  const L = m.lanes(ym);
  const gm = m.generationAt(ym);
  const n = m.size(gm);
  const cellGray = ((L.w - L.gw) / n) * v.sx;
  const cellGreen = (L.gw / n) * v.sx;
  const cellPx = Math.max(cellGray, cellGreen);
  if (cellPx < 2) return null;
  const fade = meshFade(cellGray);
  const fadeGreen = meshFade(cellGreen);
  const gHi = m.generationAt(yTop);
  const gLo = Math.max(0, m.generationAt(yBot) - m.span);
  const [mx0, mx1] = xr(ym);
  const visFrac = Math.min(1, (mx1 - mx0) / Math.max(1e-300, L.w - L.gw));
  const perRow = Math.max(1, n * visFrac);
  const rows = gHi - gLo + 1;
  const ctx = v.ctx;
  const ext = b.sp.extinct;
  const stats: TwigStats = { mode: 'texture', g0: gLo, g1: gHi, drawn: 0, cellPx, fade, fadeGreen, pending: false };

  // 1. Strand slots: lines from the tips all the way down, in both lanes.
  const slots = (alive: boolean, cell: number, color: string, alpha: number) => {
    if (cell < 2) return;
    const a = alpha * meshFade(cell);
    // Visible slots: the union of the index ranges at the top and the bottom of the screen.
    const [p0, p1] = m.indexRange(gm, ...xr(yTop), yTop, alive);
    const [q0, q1] = m.indexRange(gm, ...xr(yBot), yBot, alive);
    const i0 = Math.min(p0, q0);
    const i1 = Math.max(p1, q1);
    if (i1 - i0 > MAX_STRANDS) return;
    const path = new Path2D();
    for (let i = i0; i < i1; i++) {
      // In the green lane a slot is a strand only if someone in it is alive now.
      if (alive) {
        let any = false;
        for (let g = m.aliveFrom; g < m.G && !any; g++) any = i < m.size(g) && m.alive(g, i);
        if (!any) continue;
      }
      strandPath(v, m, (i + 0.5) / n, alive, alive ? yTop : Math.max(yTop, v.yNow + DEAD_GAP_PX / v.sy), yBot, path);
    }
    ctx.strokeStyle = rgba(color, a);
    ctx.lineWidth = alive ? 1.5 : 1;
    ctx.stroke(path);
  };
  slots(false, cellGray, ext ? TWIG_WITHERED : TWIG_GRAY, 0.22);
  if (!ext) slots(true, cellGreen, LIVING, 0.9);

  if (rows * perRow > MAX_TWIGS) return stats;
  const showLinks = cellPx >= 5 && rows * perRow <= MAX_LINKS;
  const showLabels = cellPx >= 70;
  stats.mode = showLabels ? 'labels' : showLinks ? 'links' : 'twigs';

  // 2. Individuals: each one's own life on its strand.
  const twigs: { g: number; i: number; t: Twig }[] = [];
  for (let g = gLo; g <= gHi; g++) {
    const yLow = Math.min(wyBot, m.row(g).y + m.GL);
    for (const alive of g >= m.aliveFrom ? [false, true] : [false]) {
      const [i0, i1] = m.indexRange(g, ...xr(yLow), yLow, alive);
      for (let i = i0; i < i1; i++) {
        const t = m.twig(g, i);
        if (t.alive !== alive) continue;
        if (t.yBirth < wyTop || t.yDeath > wyBot) continue; // whole twig off screen vertically
        twigs.push({ g, i, t });
      }
    }
  }
  // Who has living descendants: worked out progressively (a few ms per frame), cached.
  const tEnd = performance.now() + LINEAGE_MS;
  const lineage = (g: number, i: number): boolean | null => {
    if (m.knowsLineage(g, i) || performance.now() < tEnd) return m.hasLivingDescendant(g, i);
    stats.pending = true;
    return null;
  };
  const kind = (g: number, i: number, t: Twig): 'alive' | 'lineage' | 'dead' => {
    if (t.alive) return 'alive';
    if (ext || !showLinks) return 'dead';
    return lineage(g, i) ? 'lineage' : 'dead';
  };

  const lw = Math.max(1, Math.min(4, cellPx * 0.12));
  const kinds = twigs.map(({ g, i, t }) => kind(g, i, t));
  if (showLinks) {
    const green = new Path2D();
    const gray = new Path2D();
    const grayFar = new Path2D();
    for (let k = 0; k < twigs.length; k++) {
      const { g, i, t } = twigs[k];
      if (g === 0) continue;
      const [cx, cy] = v.toScreen(t.x, t.yBirth);
      for (const p of m.parents(g, i)) {
        const pg = p.generation;
        const pi = Number(p.index);
        const pt = m.twig(pg, pi);
        // From the parent's strand at the child's birth (or at its own death, if earlier) to the child's base.
        const yl = Math.max(twigTop(v, pt), t.yBirth);
        const [px, py] = v.toScreen(m.xAt(pt.u, yl, pt.alive), yl);
        // Long links (the rare migrants) are drawn faint so the local braid reads.
        const far = Math.abs(px - cx) > 8 * cellPx;
        const pGreen = !ext && (pt.alive || kinds[k] !== 'dead' || m.knowsLineage(pg, pi) ? pt.alive || kinds[k] !== 'dead' || m.hasLivingDescendant(pg, pi) : false);
        const path = pGreen ? green : far ? grayFar : gray;
        path.moveTo(px, py);
        path.lineTo(cx, cy);
      }
    }
    ctx.lineWidth = Math.max(0.75, lw * 0.6);
    ctx.strokeStyle = rgba('#aab2ba', 0.14 * fade);
    ctx.stroke(grayFar);
    ctx.strokeStyle = rgba('#aab2ba', 0.45 * fade);
    ctx.stroke(gray);
    ctx.strokeStyle = rgba(LINEAGE, 0.75 * fade);
    ctx.stroke(green);
  }

  const paths = { alive: new Path2D(), lineage: new Path2D(), dead: new Path2D() };
  const tipR = Math.max(1.2, Math.min(5, cellPx * 0.18));
  for (let k = 0; k < twigs.length; k++) {
    const path = paths[kinds[k]];
    const [x, yd] = twigPath(v, m, twigs[k].t, path);
    path.moveTo(x + tipR, yd);
    path.arc(x, yd, tipR, 0, Math.PI * 2);
  }
  ctx.lineWidth = lw;
  for (const [k, color] of [
    ['dead', ext ? TWIG_WITHERED : TWIG_GRAY],
    ['lineage', LINEAGE],
    ['alive', LIVING],
  ] as const) {
    ctx.strokeStyle = rgba(color, fade);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.stroke(paths[k]);
    ctx.fill(paths[k]);
  }
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
        const yl = Math.max(twigTop(v, pt), t.yBirth);
        const [px, py] = v.toScreen(m.xAt(pt.u, yl, pt.alive), yl);
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
      const top = twigTop(v, t);
      const [x, yd] = v.toScreen(m.xAt(t.u, top, t.alive), top);
      const y = Math.min(v.h - 4, Math.max(16, yd - tipR - 3));
      ctx.fillText(m.sp.handle({ generation: g, index: BigInt(i) }), x, y, cellPx * 0.95);
    }
    ctx.restore();
  }
  return stats;
}
