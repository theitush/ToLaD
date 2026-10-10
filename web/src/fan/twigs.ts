// A species branch resolved into its individuals (procgen): the same lanes as
// the zoomed-out branch, resolved into strands.
//
// Height = time on the fan's axis; width = the individuals alive at that time.
// At every height the branch is the fan's two lanes (layout.ts laneAt): those
// with living descendants today in the green lane on the left, those whose
// line ended in the gray lane on the right. The column is one lattice of
// slots, one individual wide in either lane, as many as are alive there:
//   - each generation folds onto the slots where it lives (mesh.ts): slot K
//     holds members K mod S + c·S (S its stride, the slots at its births), so
//     a slot is one individual after another, each life drawn birth to death;
//   - the lane colours who is in it: deep green alive now, pale green dead
//     with living descendants (green lane), gray line ended (gray lane);
//   - threads to both parents (procgen parents()) at each child's birth: the
//     mesh where lines interbreed.
// Only visible generations and index ranges are touched: generation from
// height via the time scale, index from x via the lanes.
//
// LOD by the on-screen spacing of strands (one procgen index slot):
//   < 2 px    the branch's green/gray lanes stand in for everyone; once the
//             width scale reads ~100 individuals the green lane becomes a
//             texture of its living strands' density (livingTexture);
//   2–10 px   strands, then individuals, fade in over the lanes (no switch);
//   links     plus threads to both parents and who has living descendants;
//   labels    plus handles (lion#…).

import { mix } from '../../../packages/procgen/src/hash.ts';
import { Species, type Address } from '../../../packages/procgen/src/index.ts';
import { laneAt, leftAt, STEM_BOTTOM_MA, TIME_C, type FanBranch, type TimeScale, type WidthMode } from './layout';
import { attrSeed, Lane, linkWidth, MAX_FOLD, packInst, type MeshInst } from './mesh';
import type { MeshBatch } from './meshgl';
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
 * procgen model of a species from its data. With a curated history that drives
 * the counts (rec.births), procgen follows its compiled segments: births per
 * generation ramp along the real population curve, counted back from now, so
 * the number of strands per generation (and the mesh's width) follows it.
 * Otherwise: G = duration / generation length generations of constant size
 * N = ever / G. Mean lifespan L = alive·duration/ever makes the number alive at
 * the end ≈ N·L/GL = the data's alive count (the pipeline's N_ever ≈ alive ÷
 * lifespan × T read backwards). Extinct species are observed long after their
 * last generation, so nobody is alive.
 */
export function speciesModel(rec: SpeciesRec): Species {
  const key = keyOf(rec.common);
  const GL = rec.genYears;
  if (rec.births) {
    return new Species({
      key,
      sexual: true,
      segments: rec.births.segments,
      generationYears: GL,
      lifespanYears: rec.births.lifespan,
    });
  }
  const years = (rec.t0 - rec.t1) * 1e6;
  const G = Math.max(1, Math.round(years / GL));
  const N = Math.max(2, Math.round(rec.ever / G));
  const lifespan = rec.alive > 0 ? (rec.alive * years) / rec.ever : GL * 0.5;
  return new Species({
    key,
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
  /** x at the birth height, and its slot in the column's lattice (TwigModel.pitch): a strand keeps its slot. */
  x: number;
  K: number;
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
  /**
   * Age (Ma) of procgen's time 0, the start of generation 0. The species' first
   * appearance, or with a history (counted back from now) the end of its last
   * generation minus all its generations, so the generations land on their
   * real calendar years and the last one ends at the tip.
   */
  readonly origin: number;

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
    this.origin = this.rec.births ? this.rec.t1 + (this.G * this.GL) / 1e6 : this.rec.t0;
  }

  size(g: number): number {
    return Number(this.sp.size(g));
  }

  /** Age (Ma) of a moment `tYears` after procgen's time 0 (the species' first appearance). */
  ageOf(tYears: number): number {
    return Math.max(0, this.origin - tYears / 1e6);
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
    const t = (this.origin - age) * 1e6;
    return Math.min(this.G - 1, Math.max(0, Math.floor(t / this.GL)));
  }

  /** Generation born at world height y, unclamped (negative below the species' first: its ancestors). */
  generationAtRaw(y: number): number {
    const age = this.time.ageAt(y);
    return Math.floor(((this.origin - age) * 1e6) / this.GL);
  }

  /** Branch width at world height y (the fan's width function, layout.ts). */
  widthAt(y: number): number {
    return laneAt(this.b, y).w;
  }

  /** Branch width and left edge at the height of generation g's births (row centre). */
  row(g: number): { y: number; left: number; w: number; n: number } {
    const y = this.yOf((g + 0.5) * this.GL);
    const w = this.widthAt(y);
    return { y, left: leftAt(this.b, y), w, n: this.size(g) };
  }

  /**
   * The branch's two lanes at height y, exactly as the fan draws them: the
   * living's green lane on the left (constant width), the dead's gray lane on
   * the right (thinning as they peel off). World units.
   */
  lanes(y: number): { left: number; w: number; gw: number } {
    const L = laneAt(this.b, y);
    return { left: leftAt(this.b, y), w: L.w, gw: L.gw };
  }

  // ---- the slot lattice ----------------------------------------------------------

  /**
   * World width of one individual at height y, the same in both lanes: the
   * column is one lattice of slots from its left edge, the green lane's
   * first, then the gray lane's. Linear widths: the fan's fixed width per
   * individual (constant: the lattice is fixed in the world). Log widths: the
   * column's width over the individuals alive there.
   */
  pitch(y: number): number {
    const lin = this.b.unit;
    if (this.mode === 'linear') return lin;
    const w = laneAt(this.b, y).w;
    const n = this.b.pop.stepAt(Math.min(this.b.t0, this.time.ageAt(y))).n;
    return w > 0 && n > 0 ? w / n : lin;
  }

  /** Green slots at height y (those alive then with living descendants today). */
  greenSlots(y: number): number {
    const L = laneAt(this.b, y);
    return L.gw > 0 ? Math.max(1, Math.round(L.gw / this.pitch(y))) : 0;
  }

  /** All the column's slots at height y (not an integer: the last one may be cut). */
  totalSlots(y: number): number {
    return laneAt(this.b, y).w / this.pitch(y);
  }

  /** x of slot K's centre at height y. */
  slotX(K: number, y: number): number {
    return leftAt(this.b, y) + (K + 0.5) * this.pitch(y);
  }

  /** The slot under x at height y (may be outside the column). */
  slotAt(x: number, y: number): number {
    return Math.floor((x - leftAt(this.b, y)) / this.pitch(y));
  }

  /**
   * Generation g's stride: its slots, the individuals alive at the middle of
   * its births (the fan's N there, exactly the column's slots: world-fixed,
   * the same at every zoom; procgen's births ramp linearly between the
   * history's points where N is log-linear, so a few % more or fewer of a
   * generation may share a slot, their lives overlapping). Its members
   * fold onto them (slot K holds K mod S + c·S).
   */
  stride(g: number): number {
    let v = this.strides.get(g);
    if (v === undefined) {
      if (this.strides.size > 50000) this.strides.clear();
      this.strides.set(g, (v = Math.max(1, Math.round(this.b.pop.aliveAt(Math.min(this.b.t0, this.ageOf((g + 0.5) * this.GL)))))));
    }
    return v;
  }
  private readonly strides = new Map<number, number>();

  /** How many of generation g fold onto one slot (⌈members ÷ stride⌉, at most MAX_FOLD). */
  fold(g: number, n = this.size(Math.max(0, g))): number {
    return Math.max(1, Math.min(MAX_FOLD, Math.ceil(n / this.stride(g))));
  }

  /**
   * The individuals of generation g on slot K at height y, as the mesh draws
   * them (mesh.ts): members K mod S + c·S. In a green slot anyone (green:
   * their line goes on); in a gray slot only the dead (the living are green).
   */
  slotIndividuals(K: number, g: number, y: number): { i: number; green: boolean; deadOnly: boolean }[] {
    const n = this.size(g);
    if (!(K >= 0) || !(n > 0) || K >= this.totalSlots(y)) return [];
    const S = this.stride(g);
    const base = (K % S) % n;
    const green = K < this.greenSlots(y);
    const out: { i: number; green: boolean; deadOnly: boolean }[] = [];
    const F = this.fold(g, n);
    for (let c = 0; c < F; c++) {
      const i = base + c * S;
      if (c > 0 && i >= n) break;
      out.push({ i, green, deadOnly: !green });
    }
    return out;
  }

  /**
   * The slot of individual (g, i) at height y, the copy nearest slot `near`
   * (a column wider than the generation's stride repeats it): K ≡ i mod S;
   * the living only in the green lane. null: not drawn at that height.
   */
  slotOf(g: number, i: number, alive: boolean, y: number, near = 0): number | null {
    const S = this.stride(g);
    const base = i % S;
    const lim = alive ? this.greenSlots(y) : this.totalSlots(y);
    const j = Math.max(0, Math.round((near - base) / S));
    for (const jj of [j, j - 1, j + 1, 0]) {
      if (jj < 0) continue;
      const K = base + jj * S;
      if (K < lim) return K;
    }
    return null;
  }

  /** Is a twig in the green lane (alive now, or on a green slot at its birth: its line goes on)? */
  isGreen(t: Twig): boolean {
    // (An extinct species' own column is all line ended; below its split it is a slice of the parent's.)
    if (this.rec.extinct && t.yBirth < this.b.splitY) return false;
    return t.alive || t.K < this.greenSlots(t.yBirth);
  }

  twig(g: number, i: number, K?: number): Twig {
    return this.twigOf(g, i, this.attrs(g, i), K);
  }

  private twigOf(g: number, i: number, a: { birthTime: number; deathTime: number; alive: boolean }, K?: number): Twig {
    const end = Math.min(a.deathTime, this.sp.now);
    const yBirth = this.yOf(a.birthTime);
    const k = K ?? this.slotOf(g, i, a.alive, yBirth) ?? i;
    return { x: this.slotX(k, yBirth), K: k, yBirth, yDeath: this.yOf(end), alive: a.alive };
  }

  /** Individual (g, i) on its copy nearest slot `near` (parents next to their child). */
  twigNear(g: number, i: number, near: number): Twig {
    const a = this.attrs(g, i);
    const alive = g >= this.aliveFrom && a.alive;
    return this.twigOf(g, i, a, this.slotOf(g, i, alive, this.yOf(a.birthTime), near) ?? undefined);
  }

  /** x of individual (g, i) at its birth. */
  x(g: number, i: number): number {
    return this.twig(g, i).x;
  }

  alive(g: number, i: number): boolean {
    if (g < this.aliveFrom) return false;
    return this.attrs(g, i).alive;
  }

  /** Does green slot k at height y hold a living strand (anyone alive now on it)? */
  livingSlot(k: number, y = this.row(this.G - 1).y): boolean {
    if (!(k >= 0)) return false;
    // (With log widths the lattice follows the height: the slots there.)
    const nG = this.greenSlots(y);
    const key = this.mode === 'linear' ? k : k * 1e6 + (nG % 1e6);
    const c = this.slotCache.get(key);
    if (c !== undefined) return c;
    let r = false;
    if (k < nG) {
      for (let g = this.aliveFrom; g < this.G && !r; g++) {
        for (const s of this.slotIndividuals(k, g, y)) if (this.alive(g, s.i)) r = true;
      }
    }
    if (this.slotCache.size > 200000) this.slotCache.clear();
    this.slotCache.set(key, r);
    return r;
  }
  private readonly slotCache = new Map<number, boolean>();

  /** World x of the living strand nearest x at height y (within `reach` slots), or null. */
  nearestLiving(x: number, y: number, reach = 64): number | null {
    if (this.aliveFrom >= this.G) return null;
    const n = this.greenSlots(y);
    const c = this.slotAt(x, y);
    for (let d = 0; d <= reach; d++) {
      for (const k of d ? [c - d, c + d] : [c]) {
        if (k >= 0 && k < n && this.livingSlot(k, y)) return this.slotX(k, y);
      }
    }
    return null;
  }

  /** The seed of the column's nested lattice of drawn lines (mesh.ts latticeRep): one per branch, the same in both lanes. */
  get latticeSeed(): number {
    return mix(this.sp.seed, 0x1a77) >>> 0;
  }

  private readonly seeds = new Map<number, number>();
  /** procgen's attribute seed of generation g (mesh.ts: the GPU mixes the index into it). */
  seedOf(g: number): number {
    let v = this.seeds.get(g);
    if (v === undefined) {
      if (this.seeds.size > 50000) this.seeds.clear();
      this.seeds.set(g, (v = attrSeed(this.sp, g)));
    }
    return v;
  }

  /** Birth, death and alive of (g, i) (procgen attributes; cached: the links redraw the same individuals every frame). */
  attrs(g: number, i: number): { birthTime: number; deathTime: number; alive: boolean } {
    const key = g * 4294967296 + i;
    let a = this.attrCache.get(key);
    if (!a) {
      if (this.attrCache.size > 50000) this.attrCache.clear();
      const x = this.sp.attributes({ generation: g, index: BigInt(i) });
      this.attrCache.set(key, (a = { birthTime: x.birthTime, deathTime: x.deathTime, alive: x.alive }));
    }
    return a;
  }
  private readonly attrCache = new Map<number, { birthTime: number; deathTime: number; alive: boolean }>();

  private readonly parentCache = new Map<number, Address[]>();
  parents(g: number, i: number): Address[] {
    const key = g * 4294967296 + i;
    let p = this.parentCache.get(key);
    if (!p) {
      if (this.parentCache.size > 20000) this.parentCache.clear();
      this.parentCache.set(key, (p = this.sp.parents({ generation: g, index: BigInt(i) })));
    }
    return p;
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
    const K0 = Math.max(0, this.slotAt(wx - slop, wy));
    const K1 = Math.min(K0 + 4000, this.slotAt(wx + slop, wy));
    for (let g = this.generationAt(wy - slopY); g >= Math.max(0, gTop - this.span); g--) {
      for (let K = K0; K <= K1; K++) {
        for (const s of this.slotIndividuals(K, g, wy)) {
          const t = this.twig(g, s.i, K);
          if (s.deadOnly && t.alive) continue;
          const yc = Math.min(t.yBirth, Math.max(t.yDeath, wy));
          const d = Math.hypot((wx - this.slotX(K, yc)) / slop, (wy - yc) / slopY);
          if (d <= 1 && d < bd) {
            bd = d;
            best = { g, i: s.i };
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
  /** Where the mesh instances go (the GPU layer); none: the mesh is not drawn. */
  mesh?: MeshBatch;
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
  /** The dead's texture fade-in (0–1): the gray lane dims under it. */
  texGray: number;
  /** Lineage answers still being worked out (drawn gray until known): redraw. */
  pending: boolean;
  /** Mesh instances sent to the GPU. */
  instances?: number;
}

/** The living: a deep, saturated green. */
export const LIVING = '#3fd286';
/** Dead, with living descendants (their strands carry the living's): a paler green. */
export const LINEAGE = '#c8efc4';
/** Dead, line ended. */
export const TWIG_GRAY = '#95a2b0';
/** Dead, of an extinct species. */
export const TWIG_WITHERED = '#a89c86';
/** Most individuals enumerated on the CPU for links and labels. */
const MAX_TWIGS = 6000;
const MAX_LINKS = 2000;

/** World y of a twig's top: its death, kept visibly below "now" if it is dead. */
function twigTop(v: TwigView, t: Twig): number {
  if (t.alive) return t.yDeath;
  return Math.max(t.yDeath, v.yNow + DEAD_GAP_PX / v.sy);
}

/**
 * Trace the strand on slot K from y0 to y1 (world): its slot's x at the
 * fan's sample heights (layout.ts Tess.cuts, a few px apart on screen), so it
 * bends with the column's edges through the forks and the population's ramps.
 */
function strandPath(v: TwigView, m: TwigModel, K: number, y0: number, y1: number, path: Path2D | CanvasRenderingContext2D, move = true): [number, number] {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const ys = m.b.tess.cuts(m.b, lo, hi, v.sy, 4);
  if (y1 < y0) ys.reverse();
  let p = v.toScreen(m.slotX(K, y0), y0);
  if (move) path.moveTo(p[0], p[1]);
  else path.lineTo(p[0], p[1]);
  for (const y of ys) {
    p = v.toScreen(m.slotX(K, y), y);
    path.lineTo(p[0], p[1]);
  }
  p = v.toScreen(m.slotX(K, y1), y1);
  path.lineTo(p[0], p[1]);
  return p;
}

/** Trace a twig from birth to top; returns the top's screen point. */
function twigPath(v: TwigView, m: TwigModel, t: Twig, path: Path2D | CanvasRenderingContext2D): [number, number] {
  return strandPath(v, m, t.K, t.yBirth, twigTop(v, t), path);
}

/**
 * Screen ends of a parent thread: the point on the parent's strand where it
 * leaves (a third of a generation before the child's birth, kept within the
 * parent's own life) and the child's base. Returns [px, py, childY].
 */
export function threadEnds(v: TwigView, m: TwigModel, parent: Twig, child: Twig, genH: number): [number, number, number] {
  const yJoin = Math.min(parent.yBirth, Math.max(twigTop(v, parent), child.yBirth + genH / 3));
  const [px, py] = v.toScreen(m.slotX(parent.K, yJoin), yJoin);
  return [px, py, v.toScreen(child.x, child.yBirth)[1]];
}

/** The width scale bar's target length (px, view.ts widthScale): textures are tied to what it reads. */
export const SCALE_BAR_PX = 70;
/**
 * The lives (mode 1) fade in over the texture of lines (mode 0) as the width
 * scale bar reads TEXTURE_IND[0] individuals down to TEXTURE_IND[1] (about
 * 100: one individual about a pixel wide); by then the lines are every slot.
 */
export const TEXTURE_IND: [number, number] = [80, 35];

/** Lives fade-in by individuals per scale-bar length (log-linear between TEXTURE_IND). */
export function textureFade(perBar: number): number {
  if (!(perBar > 0)) return 0;
  const [a, b] = TEXTURE_IND;
  return Math.max(0, Math.min(1, Math.log(a / perBar) / Math.log(a / b)));
}

/**
 * Typical px between the drawn lines by individuals per scale bar: every slot
 * (2 px apart) at TEXTURE_IND[1]; 5 px by ~100 per bar; then slowly finer (a
 * denser texture for wider spans), down to 4 px. px × individuals grows with the bar, so the
 * level only rises as one zooms out: the line sets nest.
 */
export function lineSpacing(perBar: number): number {
  const [, b] = TEXTURE_IND;
  if (perBar <= 100) return 2 + 3 * smoothstep(Math.log(Math.max(b, perBar) / b) / Math.log(100 / b));
  return Math.max(4, 5 - 0.25 * Math.log10(perBar / 100));
}

/**
 * The lattice level at a pitch (px per individual): continuous λ (the drawn
 * lines stand for 2^λ individuals each), its floor L, and the fade of the
 * lines of level L that are not of L + 1 (mesh.ts latticeRep).
 */
export function lineLevel(pitchPx: number): { lambda: number; L: number; fineA: number } {
  const lambda = Math.log2(lineSpacing(SCALE_BAR_PX / pitchPx) / pitchPx);
  const L = Math.max(0, Math.floor(lambda));
  return { lambda, L, fineA: lambda <= 0 ? 1 : smoothstep(1 - (lambda - L)) };
}

/** Opacity of the cross-links between neighbouring lines (mesh.ts shadeLinks): the lines interbreed. */
const LINK_ALPHA = 0.7;
/** Opacity of a slot's own thread under its packed lives (mode 1 baseA). */
const LIVES_FLOOR = 0.35;
/** Target screen height (px) of one texture band of generations. */
const BAND_PX = 6;
/** Most mesh instances per branch per frame. */
const MAX_INST = 6000;
const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * How much a lane `px` wide is drawn as one line its own width (mesh.ts
 * narG / narR): 1 for a hairline, 0 once it is wide enough (~10 px, two
 * lines' spacing) that its own lines show it. There is no plain lane: a lane
 * too narrow for lines still brightens and dims along its length with the
 * lives on it.
 */
export function laneNarrow(px: number): number {
  return 1 - smoothstep((px - 2) / 8);
}

/** The lanes' fill dims towards a dark tint of itself under the texture (wide lanes: the lines carry the colour)... */
const DIM_TEX = 0.72;
/** ...less where a lane is too narrow for lines (its one modulated line rides on it)... */
const DIM_NARROW = 0.3;

/** ...and fully under the lives. A lane `px` wide, the lives faded in by `lives` (0–1): its dimming (0–1). */
export function laneDim(px: number, lives: number): number {
  const d = DIM_TEX + (DIM_NARROW - DIM_TEX) * laneNarrow(px);
  return d + (1 - d) * lives;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** log2(years before present + TIME_C) per screen px, at world y (the axis is exponential in screen y). */
export function kLogAt(v: TwigView, time: TimeScale, y: number): number {
  return time.yearsPerUnit(y) / (time.ageAt(y) * 1e6 + TIME_C) / Math.LN2 / v.sy;
}

/**
 * One chord of the column between world heights ya < yb (the fan's sample
 * heights, a few px apart on screen), as the mesh sees it: at each end, the
 * screen x of the column's left edge and of the green lane's right edge, px
 * per individual (slot) and the column's slots; straight in between.
 */
interface Stretch {
  ya: number;
  yb: number;
  colX: [number, number];
  xG: [number, number];
  pitchPx: [number, number];
  nT: [number, number];
  nG: number;
  /** The lane right of the green one: withered over an extinct species' span, else gray. */
  lane: Lane;
}

/** The column's chords between yTop < yBot. */
function stretches(v: TwigView, m: TwigModel, yTop: number, yBot: number): Stretch[] {
  const y0 = m.b.splitY;
  const cuts = m.b.tess.cuts(m.b, yTop, yBot, v.sy, 4);
  const at = (y: number) => {
    const L = m.lanes(y);
    const P = m.pitch(y);
    return { L, P, colX: v.toScreen(L.left, y)[0], xG: L.gw > 0 ? v.toScreen(L.left + L.gw, y)[0] : -1e9 };
  };
  const out: Stretch[] = [];
  // (Each chord's ends from inside it: the green lane changes at a split, where the strand leaves its parent's prefix.)
  const eps = (y: number) => 1e-9 * Math.max(1, Math.abs(y));
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = at(cuts[c] + eps(cuts[c]));
    const B = at(cuts[c + 1] - eps(cuts[c + 1]));
    if (!(a.L.w > 0) && !(B.L.w > 0)) continue;
    const ym = (cuts[c] + cuts[c + 1]) / 2;
    const green = a.L.gw > 0 || B.L.gw > 0;
    // (A green lane that starts within the chord starts at the column's left edge.)
    const xGa = a.L.gw > 0 ? a.xG : a.colX;
    const xGb = B.L.gw > 0 ? B.xG : B.colX;
    const lane = m.rec.extinct && ym < y0 ? Lane.Withered : Lane.Gray;
    out.push({
      ya: cuts[c],
      yb: cuts[c + 1],
      colX: [a.colX, B.colX],
      xG: green ? [xGa, xGb] : [-1e9, -1e9],
      pitchPx: [a.P * v.sx, B.P * v.sx],
      nT: [a.L.w / a.P, B.L.w / B.P],
      nG: green ? m.greenSlots(ym) : 0,
      lane,
    });
  }
  return out;
}

/**
 * The mesh instances of one branch between world heights yTop < yBot: one
 * lattice of slots across its whole column, the same in both lanes (mesh.ts);
 * the lane only colours. mode 0: the texture, bands of t generations, slots
 * ≥ 2 px apart (a finer lattice fading in over each octave); mode 1: every
 * life, one instance per generation. Each instance stays within one stretch
 * of constant column width (the gray edge steps).
 */
export function meshInstances(v: TwigView, m: TwigModel, yTop: number, yBot: number, mode: 0 | 1, alpha: number, look: { lw: number; tipR: number; linkA?: number; baseA?: number }, out: MeshInst[], ancA = alpha): void {
  if (!(Math.max(alpha, mode ? 0 : ancA) > 0.004) || !(yBot > yTop)) return;
  const time = m.time;
  const gTop = m.generationAt(yTop);
  // The texture goes on below the species' first generation, down its column through the stem
  // to the bottom of the world: generations g < 0 (the ancestors), always texture (no lives there).
  const gBot = mode ? Math.max(0, m.generationAt(yBot) - m.span) : Math.min(gTop, m.generationAtRaw(yBot));
  if (mode && gTop - gBot > MAX_INST) return;
  const Lm = m.sp.lifespanYears;
  const now = m.sp.now;
  const st = stretches(v, m, yTop, yBot);
  const latSeed = m.latticeSeed;
  // Texture bands of t generations, t a power of two by the generations' local height on screen
  // (the time axis is logarithmic), aligned to multiples of t: fixed in the world.
  // (tauC: the continuous time level, log2 of BAND_PX over a generation's height: the cross-links' fade.)
  const tauC = (g: number) => Math.log2(BAND_PX / Math.max(1e-12, Math.abs(m.yOf((g + 1) * m.GL) - m.yOf(g * m.GL)) * v.sy));
  const bandRaw = (g: number) => Math.pow(2, Math.max(0, Math.min(24, Math.ceil(tauC(g)))));
  const start = out.length;
  let count = 0;
  const floorMod = (a: number, t: number) => ((a % t) + t) % t;
  const NONE = -Infinity;
  for (let gA = mode ? gBot : gBot - floorMod(gBot, bandRaw(gBot)), t = 1; gA <= gTop; gA += t) {
    if (!mode) for (t = bandRaw(gA); floorMod(gA, t); ) t /= 2;
    if (++count > MAX_INST) {
      out.length = start;
      return;
    }
    // (The ancestors, g < 0: generation 0's size, their own hashed seeds.)
    const nA = m.size(Math.max(0, gA));
    const gB = t > 1 && gA + t / 2 < m.G ? gA + t / 2 : NONE;
    const nB = gB !== NONE ? m.size(Math.max(0, gB)) : 0;
    const instA = gA < 0 && !mode ? Math.max(alpha, ancA) : alpha;
    if (!(instA > 0.004)) continue;
    // World heights of the instance: a band of t generations, or one generation's lives (to their latest death).
    const yLo = m.yOf(gA * m.GL);
    const yHi = mode ? m.yOf(Math.min(now, (gA + 1) * m.GL + 2 * Lm)) : m.yOf(Math.min(m.T, (gA + t) * m.GL));
    for (const S of st) {
      const ya = Math.max(S.ya, yHi);
      const yb = Math.min(S.yb, yLo);
      if (!(yb > ya)) continue;
      // The chord's ends on screen, and its edges, pitch and green edge as lines in screen y.
      const [, pa] = v.toScreen(0, S.ya);
      const [, pb] = v.toScreen(0, S.yb);
      const span = Math.max(1e-9, pb - pa);
      const lin = (e: [number, number], py: number) => e[0] + ((e[1] - e[0]) * (py - pa)) / span;
      const slope = (e: [number, number]) => (e[1] - e[0]) / span;
      const [, py0] = v.toScreen(0, ya);
      const [, py1] = v.toScreen(0, yb);
      // Room for the line caps and dots at the true ends (not at a chord's end, where the strands go on).
      // (A living strand's glow reaches 5 px past its edge.)
      const reach = Math.max(look.tipR, look.lw * 0.5 + 5) + 1;
      const padT = mode && ya === yHi ? reach : 0;
      const padB = mode && yb === yLo ? reach : 0;
      const pad = mode ? reach : 1;
      const y0 = Math.max(-4, py0 - padT);
      const y1 = Math.min(v.h + 4, py1 + padB);
      if (!(y1 > y0)) continue;
      // At the instance's top row: the column's left edge, pitch, slots, width and green edge; and how they move down it.
      const lx0 = lin(S.colX, y0);
      const P0 = Math.max(1e-12, lin(S.pitchPx, y0));
      const nT0 = Math.max(0, lin(S.nT, y0));
      const wPx = nT0 * P0;
      const xG0 = lin(S.xG, y0);
      const sL = slope(S.colX);
      const sP = slope(S.pitchPx) / P0;
      const right = (py: number) => lin(S.colX, py) + Math.max(0, lin(S.nT, py)) * lin(S.pitchPx, py);
      const sR = (right(pb) - right(pa)) / span;
      const sG = slope(S.xG);
      const lx1a = right(y0);
      const lx1b = right(y1);
      const x0 = Math.max(-4, Math.min(lx0, lin(S.colX, y1)) - pad);
      const x1 = Math.min(v.w + 4, Math.max(lx1a, lx1b) + pad);
      if (!(x1 > x0)) continue;
      // Lanes too narrow for their lines (texture only): each is one line its own width.
      const nGm = S.nG;
      const gPx = nGm > 0 ? Math.max(0, xG0 - lx0) : 0;
      const narG = mode || !(nGm > 0) ? 0 : laneNarrow(gPx);
      const narR = mode ? 0 : laneNarrow(wPx - gPx);
      // The slot lattice: one individual per slot; the nested subset of its lines drawn at this zoom.
      const { L: lvl, fineA, lambda } = lineLevel(P0);
      const bw = 2 ** lvl * P0;
      // (The lattice's own x, the column's frame at the top row, of the leftmost pixel over the instance.)
      const kB = 1 + sP * (y1 - y0);
      const xMin = Math.min(x0, lx0 + (x0 - lx0 - sL * (y1 - y0)) / Math.max(1e-6, kB));
      const B0 = Math.max(0, Math.floor((xMin - lx0) / bw) - 1);
      if (B0 * 2 ** lvl >= Math.max(nT0, lin(S.nT, y1))) continue;
      // The time axis at the top of the instance, relative to generation gA's start.
      const [, wy0] = v.toWorld(0, y0);
      const age = time.ageAt(wy0) * 1e6;
      out.push({
        x0,
        y0,
        x1,
        y1,
        xB0: lx0 + B0 * bw,
        bw,
        lw: look.lw,
        fineA,
        p0: y0,
        T0: m.origin * 1e6 - age - gA * m.GL,
        A: age + TIME_C,
        gBoff: gB !== NONE ? gB - gA : 0,
        alpha: instA,
        mode,
        lane: S.lane,
        tipR: look.tipR,
        GL: m.GL,
        Lm,
        nowRel: now - gA * m.GL,
        xG: nGm > 0 ? xG0 : -1e9,
        sL,
        sR,
        sG: nGm > 0 ? sG : 0,
        sP,
        B0,
        lvl,
        latSeed,
        nA,
        nB,
        seedA: m.seedOf(gA),
        seedB: gB !== NONE ? m.seedOf(gB) : 0,
        sA: m.stride(gA),
        sB: gB !== NONE ? m.stride(gB) : 1,
        fA: m.fold(gA, nA),
        fB: gB !== NONE ? m.fold(gB, nB) : 1,
        colL: lx0,
        colR: lx0 + Math.max(0.6, wPx),
        narG,
        narR,
        linkA: look.linkA ?? 0,
        baseA: mode ? (look.baseA ?? 0) : 0,
        lam: lambda,
        tauC: tauC(gA),
        tauB: mode ? 0 : Math.round(Math.log2(t)),
        gA,
      });
    }
  }
}

/**
 * The inside of one branch: the same lanes as the zoomed-out branch, resolved
 * into individuals on one slot lattice for both lanes (one individual per
 * slot, the same width in either), which differ only by the colour of who is
 * in them (mesh.ts, drawn on the GPU by meshgl.ts):
 *   - above ~100 individuals per width scale bar, the texture of lines: a
 *     nested, hashed subset of the slots' own lines (each standing for 2^λ
 *     individuals), fixed in the world; more fade in between as one zooms in,
 *     until every slot is drawn;
 *   - from ~100 per bar the individuals crossfade in on those same lines (no
 *     switch): every life, or while generations are too thin on screen, the
 *     texture of their lives;
 *   - links (Canvas 2D, on top): threads to both parents (procgen parents()) at
 *     each child's birth, once few enough; labels (handles) when wide apart.
 * Only the visible generations and slots are touched.
 */
export function drawTwigs(v: TwigView, b: FanBranch, m: TwigModel, sel: { g: number; i: number } | null): TwigStats | null {
  const [, wyTop] = v.toWorld(0, 0);
  const [, wyBot] = v.toWorld(v.w, v.h);
  // The visible x range at a height.
  const xr = (y: number): [number, number] => {
    const py = v.toScreen(0, y)[1];
    return [v.toWorld(0, py)[0], v.toWorld(v.w, py)[0]];
  };
  // The texture runs down the whole column, from the tip through the stem to the bottom of the
  // world (the ancestors below the species' first generation); the individuals from its first.
  const yFirst = m.time.y(STEM_BOTTOM_MA);
  if (wyBot < b.tipY || wyTop > yFirst) return null;
  const yTop = Math.max(wyTop, b.tipY);
  const yBot = Math.min(wyBot, yFirst);
  // Off the branch's column entirely?
  const Lb = m.lanes(yBot);
  const [bx0, bx1] = xr(yBot);
  if (bx1 < Lb.left || bx0 > Lb.left + Lb.w) return null;
  const ym = (yTop + yBot) / 2;
  const L = m.lanes(ym);
  const gm = m.generationAt(ym);
  const ext = b.sp.extinct;
  // One individual's width on screen: the same in both lanes.
  const cellPx = m.pitch(ym) * v.sx;
  const perBar = SCALE_BAR_PX / cellPx;
  const genPx = Math.abs(m.yOf((gm + 1) * m.GL) - m.yOf(gm * m.GL)) * v.sy;
  // Both lanes by the same rules, on the same nested lines (mesh.ts latticeRep): at every zoom
  // the texture of lines (never a plain lane); from ~100 individuals per scale bar the
  // individuals on them: every life once the generations are a few px tall.
  const meshIn = smoothstep(textureFade(perBar));
  const lives = meshIn * smoothstep((genPx - 0.5) / 2);
  const dens = 1 - lives;
  // How much the lanes' fill dims under it, here (view.ts dims each stretch by its own widths).
  const gwPx = L.gw * v.sx;
  const stats: TwigStats = { mode: 'texture', g0: gm, g1: gm, drawn: 0, cellPx, fade: lives, fadeGreen: ext || !(gwPx > 0) ? 0 : laneDim(gwPx, lives), texGray: laneDim(L.w * v.sx - gwPx, lives), pending: false };
  // Thin strands while they are packed (a dark gap between neighbours: hatching, not a fill).
  const lwL = Math.min(3.5, Math.max(Math.min(0.8, 0.4 * cellPx), cellPx * 0.22));
  // A death is a rounded end, a touch wider than the strand.
  // (Only once strands are a few px apart: packed, the dots would read as a herringbone.)
  const tipR = lwL * 0.5 + smoothstep((cellPx - 3) / 4) * Math.min(1, 0.25 + cellPx * 0.02);
  // Under packed lives, the slot's own faint thread (as the texture's floor): strands, not specks.
  const baseA = LIVES_FLOOR * (1 - smoothstep((cellPx - 3) / 6));
  const lw = Math.max(1, Math.min(4, cellPx * 0.12));
  if (v.mesh) {
    const batch = v.mesh;
    const insts: MeshInst[] = [];
    meshInstances(v, m, yTop, yBot, 0, dens > 0.02 ? dens : 0, { lw: 0.9, tipR: 0, linkA: LINK_ALPHA }, insts, 1);
    meshInstances(v, m, yTop, yBot, 1, lives, { lw: lwL, tipR, linkA: LINK_ALPHA, baseA }, insts);
    for (const inst of insts) {
      // (next() first: it may grow the arrays.)
      const k = batch.next();
      packInst(inst, batch.f, batch.u, k);
    }
    stats.instances = insts.length;
  }
  if (cellPx < 1.5) return stats;
  const ctx = v.ctx;
  const gHi = m.generationAt(yTop);
  const gLo = Math.max(0, m.generationAt(yBot) - m.span);
  stats.g0 = gLo;
  stats.g1 = gHi;
  const [mx0, mx1] = xr(ym);
  const perRow = Math.max(1, Math.min(m.totalSlots(ym), (mx1 - mx0) / m.pitch(ym)));
  const rows = gHi - gLo + 1;
  if (rows * perRow > MAX_TWIGS || lives <= 0.01) return stats;
  // The GPU draws the lives; the CPU only needs them for links, labels and the selection.
  if (rows * perRow > MAX_LINKS && !sel) return stats;
  // Threads to the parents fade in (no switch) from 4 px strands and as they get few enough.
  const linkBudget = Math.max(0, Math.min(1, (MAX_LINKS - rows * perRow) / (MAX_LINKS / 2)));
  const linksA = Math.max(0, Math.min(1, (cellPx - 4) / 2)) * linkBudget;
  const showLinks = linksA > 0.01;
  const showLabels = cellPx >= 70;
  stats.mode = showLabels ? 'labels' : showLinks ? 'links' : 'twigs';
  const livesA = lives;

  // The individuals on screen (the GPU draws their lives; links, labels and the selection are drawn here).
  const twigs: { g: number; i: number; t: Twig }[] = [];
  for (let g = gLo; g <= gHi; g++) {
    const yLow = Math.min(wyBot, m.row(g).y + m.GL);
    const [x0, x1] = xr(yLow);
    const K0 = Math.max(0, m.slotAt(x0, yLow));
    const K1 = Math.min(m.totalSlots(yLow), m.slotAt(x1, yLow) + 1);
    for (let K = K0; K < K1; K++) {
      for (const s of m.slotIndividuals(K, g, yLow)) {
        const t = m.twig(g, s.i, K);
        if (s.deadOnly && t.alive) continue;
        if (t.yBirth < wyTop || t.yDeath > wyBot) continue; // whole twig off screen vertically
        twigs.push({ g, i: s.i, t });
      }
    }
  }
  stats.drawn = twigs.length;

  if (showLinks) {
    // The mother's thread carries the line; the father's is the thin mesh joining two lines at the child's birth.
    const mk = () => ({ green: new Path2D(), gray: new Path2D(), far: new Path2D(), farGreen: new Path2D() });
    const prim = mk();
    const mesh = mk();
    for (const { g, i, t } of twigs) {
      if (g === 0) continue;
      const cx = v.toScreen(t.x, t.yBirth)[0];
      const ps = m.parents(g, i);
      const mi = Math.max(0, ps.findIndex((p) => m.sp.sexOf(p) === 'female'));
      const genH = m.row(g - 1).y - m.row(g).y;
      const childGreen = m.isGreen(t);
      ps.forEach((p, j) => {
        const pg = p.generation;
        const pi = Number(p.index);
        const pt = m.twigNear(pg, pi, t.K);
        // Leaves the parent's strand a little before the child's birth (or at the
        // parent's death, if earlier) and runs straight up into the child's base:
        // the texture's cross-links (mesh.ts shadeLinks), resolved.
        const [px, py, cy2] = threadEnds(v, m, pt, t, genH);
        // Long threads (mates from further along the range) are drawn faint, whatever their
        // colour, so the local braid reads.
        const far = Math.abs(px - cx) > 4 * cellPx;
        const pGreen = !ext && (childGreen || m.isGreen(pt));
        const set = j === mi ? prim : mesh;
        const path = far ? (pGreen ? set.farGreen : set.far) : pGreen ? set.green : set.gray;
        path.moveTo(px, py);
        path.lineTo(cx, cy2);
      });
    }
    const strokes = (s: ReturnType<typeof mk>, w: number, a: number) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = rgba(TWIG_GRAY, 0.045 * a * livesA);
      ctx.stroke(s.far);
      ctx.strokeStyle = rgba(LINEAGE, 0.045 * a * livesA);
      ctx.stroke(s.farGreen);
      ctx.strokeStyle = rgba(TWIG_GRAY, 0.55 * a * livesA);
      ctx.stroke(s.gray);
      ctx.strokeStyle = rgba(LINEAGE, 0.6 * a * livesA);
      ctx.stroke(s.green);
    };
    // (As wide as the texture's cross-links, mesh.ts linkWidth; the mother's a little bolder.)
    strokes(mesh, linkWidth(lwL), 0.8 * linksA);
    strokes(prim, linkWidth(lwL) * 1.3, linksA);
  }

  if (sel) {
    const t = m.twig(sel.g, sel.i);
    const [x, yb] = v.toScreen(t.x, t.yBirth);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw + 2;
    ctx.beginPath();
    twigPath(v, m, t, ctx);
    if (sel.g > 0) {
      const genH = m.row(sel.g - 1).y - m.row(sel.g).y;
      for (const p of m.parents(sel.g, sel.i)) {
        const [px, py] = threadEnds(v, m, m.twigNear(p.generation, Number(p.index), t.K), t, genH);
        ctx.moveTo(px, py);
        ctx.lineTo(x, yb);
      }
    }
    ctx.stroke();
  }

  if (showLabels && twigs.length <= 400) {
    ctx.save();
    ctx.font = `600 12.5px 'Sofia Sans Condensed', 'Roboto Condensed', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#dfe7e2';
    for (const { g, i, t } of twigs) {
      const top = twigTop(v, t);
      const [x, yd] = v.toScreen(m.slotX(t.K, top), top);
      const y = Math.min(v.h - 4, yd - tipR - 3);
      if (y < 14) continue; // tip above the screen: no label piled on the top edge
      ctx.fillText(m.sp.handle({ generation: g, index: BigInt(i) }), x, y, cellPx * 0.95);
    }
    ctx.restore();
  }
  return stats;
}
