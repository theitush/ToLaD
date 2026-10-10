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
//   < 2 px    the branch's green/gray lanes stand in for everyone; once the
//             width scale reads ~100 individuals the green lane becomes a
//             texture of its living strands' density (livingTexture);
//   2–10 px   strands, then individuals, fade in over the lanes (no switch);
//   links     plus threads to both parents and who has living descendants;
//   labels    plus handles (lion#…).

import { Species, type Address } from '../../../packages/procgen/src/index.ts';
import { JOG, laneAt, leftAt, remaining, TIME_C, type FanBranch, type TimeScale, type WidthMode } from './layout';
import { attrSeed, F_LINEAGE, Lane, lineageThreshold, packInst, type MeshInst } from './mesh';
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

  /**
   * Index slots of the green lane: the living's generation's size (a slot is a
   * living strand if anyone at that index is alive now). The green lane has one
   * width all the way down, and so these slots: deep in the past, where a
   * history's generations were bigger, it is not the size of the generation there.
   */
  get nLive(): number {
    return this.size(this.G - 1);
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

  /** Does green-lane slot i hold a living strand (anyone at index i alive now)? */
  livingSlot(i: number): boolean {
    if (!(i >= 0)) return false;
    const c = this.slotCache.get(i);
    if (c !== undefined) return c;
    let r = false;
    for (let g = this.aliveFrom; g < this.G && !r; g++) if (i < this.size(g) && this.alive(g, i)) r = true;
    if (this.slotCache.size > 200000) this.slotCache.clear();
    this.slotCache.set(i, r);
    return r;
  }
  private readonly slotCache = new Map<number, boolean>();

  /** World x of the living strand nearest x at height y (within `reach` slots), or null. */
  nearestLiving(x: number, y: number, reach = 64): number | null {
    if (this.aliveFrom >= this.G) return null;
    const L = this.lanes(y);
    const n = this.size(this.G - 1);
    const c = Math.floor(((x - L.left) / Math.max(1e-300, L.gw)) * n);
    for (let d = 0; d <= reach; d++) {
      for (const i of d ? [c - d, c + d] : [c]) {
        if (i >= 0 && i < n && this.livingSlot(i)) return this.xAt((i + 0.5) / n, y, true);
      }
    }
    return null;
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

  /**
   * Does dead (g, i) carry the living's line? The hashed lineage model
   * (mesh.ts lineageThreshold): the same decision the GPU draws.
   */
  lineage(g: number, i: number): boolean {
    const thr = lineageThreshold(this.G, g, this.rec.extinct);
    return this.sp.fieldHash({ generation: g, index: BigInt(i) }, F_LINEAGE) >>> 0 < thr;
  }

  private readonly parentCache = new Map<string, Address[]>();
  parents(g: number, i: number): Address[] {
    const key = `${g}:${i}`;
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
export const LINEAGE = '#b4e2c4';
/** Dead, line ended. */
export const TWIG_GRAY = '#a3adb6';
/** Dead, of an extinct species. */
export const TWIG_WITHERED = '#a89c86';
/** Most individuals enumerated on the CPU for links and labels. */
const MAX_TWIGS = 6000;
const MAX_LINKS = 2000;

/** Mesh fade-in by the on-screen strand spacing: none below 2 px, full from 10 px. */
export function meshFade(cellPx: number): number {
  return Math.max(0, Math.min(1, (cellPx - 2) / 8));
}

/** World y of a twig's top: its death, kept visibly below "now" if it is dead. */
function twigTop(v: TwigView, t: Twig): number {
  if (t.alive) return t.yDeath;
  return Math.max(t.yDeath, v.yNow + DEAD_GAP_PX / v.sy);
}

/**
 * Trace the strand at lane fraction u from y0 to y1 (world), following the
 * lanes exactly: straight up between the gray edge's steps, sideways along the
 * fork's jog. At a step line every gray strand shifts sideways with its lane;
 * that shift is left as a break (the strand resumes at its new x), so the
 * shifts of neighbouring strands don't line up into a horizontal bar.
 */
function strandPath(v: TwigView, m: TwigModel, u: number, alive: boolean, y0: number, y1: number, path: Path2D | CanvasRenderingContext2D, move = true): [number, number] {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const brk: [number, boolean][] = [];
  if (!alive) for (const y of m.b.steps.lines(m.b, lo, hi, 400) ?? []) brk.push([y, true]);
  for (const y of [0, -JOG]) if (y > lo && y < hi) brk.push([y, false]);
  brk.sort((a, b) => (y1 > y0 ? a[0] - b[0] : b[0] - a[0]));
  let p = v.toScreen(m.xAt(u, y0, alive), y0);
  if (move) path.moveTo(p[0], p[1]);
  else path.lineTo(p[0], p[1]);
  // Width is constant within a step: x changes only at a step line or along the fork's jog.
  const eps = (hi - lo) * 1e-9;
  const dir = y1 > y0 ? 1 : -1;
  for (const [y, step] of brk) {
    p = v.toScreen(m.xAt(u, y - dir * eps, alive), y);
    path.lineTo(p[0], p[1]);
    if (!step) continue;
    p = v.toScreen(m.xAt(u, y + dir * eps, alive), y);
    path.moveTo(p[0], p[1]);
  }
  p = v.toScreen(m.xAt(u, y1, alive), y1);
  path.lineTo(p[0], p[1]);
  return p;
}

/** Trace a twig from birth to top; returns the top's screen point. */
function twigPath(v: TwigView, m: TwigModel, t: Twig, path: Path2D | CanvasRenderingContext2D): [number, number] {
  return strandPath(v, m, t.u, t.alive, t.yBirth, twigTop(v, t), path);
}

/**
 * Screen ends of a parent thread: the point on the parent's strand where it
 * leaves (a third of a generation before the child's birth, kept within the
 * parent's own life) and the child's base. Returns [px, py, childY].
 */
export function threadEnds(v: TwigView, m: TwigModel, parent: Twig, child: Twig, genH: number): [number, number, number] {
  const yJoin = Math.min(parent.yBirth, Math.max(twigTop(v, parent), child.yBirth + genH / 3));
  const [px, py] = v.toScreen(m.xAt(parent.u, yJoin, parent.alive), yJoin);
  return [px, py, v.toScreen(child.x, child.yBirth)[1]];
}

/** The width scale bar's target length (px, view.ts widthScale): textures are tied to what it reads. */
export const SCALE_BAR_PX = 70;
/**
 * The living's texture fades in as the width scale bar reads TEXTURE_IND[0]
 * individuals down to TEXTURE_IND[1] (about 100: well under a pixel per
 * individual, long before the strands themselves are pixels apart).
 */
export const TEXTURE_IND: [number, number] = [150, 50];

/** Texture fade-in by individuals per scale-bar length in a lane (log-linear between TEXTURE_IND). */
export function textureFade(perBar: number): number {
  if (!(perBar > 0)) return 0;
  const [a, b] = TEXTURE_IND;
  return Math.max(0, Math.min(1, Math.log(a / perBar) / Math.log(a / b)));
}

/** Target screen height (px) of one texture band of generations. */
const BAND_PX = 6;
/** Most mesh instances per lane per frame. */
const MAX_INST = 6000;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** log2(years before present + TIME_C) per screen px, at world y (the axis is exponential in screen y). */
export function kLogAt(v: TwigView, time: TimeScale, y: number): number {
  return time.yearsPerUnit(y) / (time.ageAt(y) * 1e6 + TIME_C) / Math.LN2 / v.sy;
}

/** One lane of a branch as the mesh sees it: its kind and its left edge and width at height y (world). */
export interface MeshLane {
  lane: Lane;
  at(y: number): { left: number; w: number };
}

export function meshLanes(m: TwigModel): MeshLane[] {
  const out: MeshLane[] = [];
  if (!m.rec.extinct && m.rec.alive > 0) out.push({ lane: Lane.Green, at: (y) => { const L = m.lanes(y); return { left: L.left, w: L.gw }; } });
  out.push({ lane: m.rec.extinct ? Lane.Withered : Lane.Gray, at: (y) => { const L = m.lanes(y); return { left: L.left + L.gw, w: L.w - L.gw }; } });
  return out;
}

/**
 * The mesh instances of one lane between world heights yTop < yBot: the same
 * lattice and the same individuals for either lane (mesh.ts). mode 0: the
 * texture, bands of t generations, slots ≥ 2 px apart (a finer lattice fading
 * in over each octave); mode 1: every life, one instance per generation. Each
 * instance stays within one stretch of constant lane width (the gray lane
 * steps), so strands keep their fraction of the lane, as the lanes do.
 */
export function laneInstances(v: TwigView, m: TwigModel, ln: MeshLane, yTop: number, yBot: number, mode: 0 | 1, alpha: number, look: { lw: number; tipR: number }, out: MeshInst[]): void {
  if (!(alpha > 0.004) || !(yBot > yTop)) return;
  const time = m.time;
  // Stretches of constant width: the gray edge's step lines.
  const cuts = [yTop, ...(ln.lane === Lane.Green ? [] : (m.b.steps.lines(m.b, yTop, yBot, 2000) ?? [])), yBot].sort((a, b) => a - b);
  const ym = (yTop + yBot) / 2;
  const gm = m.generationAt(ym);
  const genPx = Math.abs(m.yOf((gm + 1) * m.GL) - m.yOf(gm * m.GL)) * v.sy;
  const t = mode ? 1 : Math.pow(2, Math.max(0, Math.ceil(Math.log2(BAND_PX / Math.max(1e-9, genPx)))));
  const gTop = m.generationAt(yTop);
  const gBot = Math.max(0, m.generationAt(yBot) - (mode ? m.span : 0));
  if ((gTop - gBot) / t > MAX_INST) return;
  const Lm = m.sp.lifespanYears;
  const now = m.sp.now;
  const xL = -4;
  const xR = v.w + 4;
  for (let gA = Math.floor(gBot / t) * t; gA <= gTop; gA += t) {
    const nA = m.size(gA);
    const gB = t > 1 && gA + t / 2 < m.G ? gA + t / 2 : -1;
    // World heights of the instance: a band of t generations, or one generation's lives (to their latest death).
    const yLo = m.yOf(gA * m.GL);
    const yHi = mode ? m.yOf(Math.min(now, (gA + 1) * m.GL + 2 * Lm)) : m.yOf(Math.min(m.T, (gA + t) * m.GL));
    for (let c = 0; c + 1 < cuts.length; c++) {
      const ya = Math.max(cuts[c], yHi);
      const yb = Math.min(cuts[c + 1], yLo);
      if (!(yb > ya)) continue;
      const L = ln.at((cuts[c] + cuts[c + 1]) / 2);
      if (!(L.w > 0)) continue;
      const [lx0, py0] = v.toScreen(L.left, ya);
      const [lx1, py1] = v.toScreen(L.left + L.w, yb);
      const lanePx = lx1 - lx0;
      // Room for the line caps and dots at the true ends (not at a step line, where strands break).
      // (A living strand's glow reaches 5 px past its edge.)
      const reach = Math.max(look.tipR, look.lw * 0.5 + 5) + 1;
      const padT = mode && ya === yHi ? reach : 0;
      const padB = mode && yb === yLo ? reach : 0;
      const pad = mode ? reach : 1;
      const x0 = Math.max(xL, lx0 - pad);
      const x1 = Math.min(xR, lx1 + pad);
      const y0 = Math.max(-4, py0 - padT);
      const y1 = Math.min(v.h + 4, py1 + padB);
      if (!(x1 > x0) || !(y1 > y0)) continue;
      // The slot lattice: every s-th index, ≥ 2 px apart (texture) or every individual (lives).
      let s = 1;
      let fineA = 1;
      if (!mode) {
        const sE = Math.log2(Math.max(1, (2 * nA) / Math.max(1e-300, lanePx)));
        s = Math.pow(2, Math.ceil(sE));
        const f = s > 1 ? smoothstep(Math.ceil(sE) - sE) : 0;
        if (f > 0.02 && f < 1) fineA = f;
        else if (f >= 1) fineA = 1;
      }
      const iStep = fineA < 1 ? s / 2 : s;
      const iL = ((x0 - lx0) / lanePx) * nA - 0.5;
      const iBase = Math.max(0, Math.floor(iL / s) * s - s);
      if (iBase >= nA) continue;
      const slotX0 = lx0 + ((iBase + 0.5) / nA) * lanePx;
      const slotDx = (iStep / nA) * lanePx;
      // The time axis at the top of the instance, relative to generation gA's start.
      const [, wy0] = v.toWorld(0, y0);
      const age = time.ageAt(wy0) * 1e6;
      out.push({
        x0,
        y0,
        x1,
        y1,
        slotX0,
        slotDx,
        lw: look.lw,
        fineA,
        p0: y0,
        T0: m.origin * 1e6 - age - gA * m.GL,
        A: age + TIME_C,
        gBoff: gB >= 0 ? gB - gA : 0,
        alpha,
        mode,
        lane: ln.lane,
        tipR: look.tipR,
        GL: m.GL,
        Lm,
        nowRel: now - gA * m.GL,
        iBase,
        iStep,
        nA,
        nB: gB >= 0 ? m.size(gB) : 0,
        seedA: m.seedOf(gA),
        seedB: gB >= 0 ? m.seedOf(gB) : 0,
        thrA: lineageThreshold(m.G, gA, m.rec.extinct),
        thrB: gB >= 0 ? lineageThreshold(m.G, gB, m.rec.extinct) : 0,
      });
    }
  }
}

/**
 * The inside of one branch: the same lanes as the zoomed-out branch, resolved
 * into individuals by one mesh (mesh.ts, drawn on the GPU by meshgl.ts) in
 * both lanes, which differ only by the colour of who is in them:
 *   - the texture fades in from ~100 individuals per width scale bar (or as
 *     soon as a lane's slots are pixels apart), then every life fades in as
 *     its strands get 2–10 px apart: no switch, a crossfade;
 *   - links (Canvas 2D, on top): threads to both parents (procgen parents()) at
 *     each child's birth, once few enough; labels (handles) when wide apart.
 * Only the visible generations and index ranges are touched.
 */
export function drawTwigs(v: TwigView, b: FanBranch, m: TwigModel, sel: { g: number; i: number } | null): TwigStats | null {
  const [, wyTop] = v.toWorld(0, 0);
  const [, wyBot] = v.toWorld(v.w, v.h);
  // The visible x range at a height.
  const xr = (y: number): [number, number] => {
    const py = v.toScreen(0, y)[1];
    return [v.toWorld(0, py)[0], v.toWorld(v.w, py)[0]];
  };
  // Individuals live from the species' first generation to its tip.
  const yFirst = Math.min(0, m.yOf(0));
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
  const n = m.size(gm);
  const ext = b.sp.extinct;
  const cellGray = ((L.w - L.gw) / n) * v.sx;
  const cellGreen = (L.gw / n) * v.sx;
  const cellPx = Math.max(cellGray, cellGreen);
  const genPx = Math.abs(m.yOf((gm + 1) * m.GL) - m.yOf(gm * m.GL)) * v.sy;
  // Each lane by the same rules: the texture from ~100 individuals per scale bar (or once its
  // slots are pixels apart), then every life as the strands get 2–10 px apart and the
  // generations a few px tall.
  const dead = remaining(b.sp, m.time.ageAt(ym)) - b.sp.alive;
  const texOf = (count: number, laneW: number, cell: number) => (laneW > 0 && count > 0 ? Math.max(meshFade(cell), textureFade((SCALE_BAR_PX * count) / (laneW * v.sx))) : 0);
  const livesOf = (cell: number) => meshFade(cell) * smoothstep((genPx - 0.5) / 2);
  const texGreen = ext ? 0 : texOf(b.sp.alive, L.gw, cellGreen);
  const texGray = texOf(dead, L.w - L.gw, cellGray);
  const livesGreen = ext ? 0 : livesOf(cellGreen);
  const livesGray = livesOf(cellGray);
  const stats: TwigStats = { mode: 'texture', g0: gm, g1: gm, drawn: 0, cellPx, fade: livesGray, fadeGreen: Math.max(livesGreen, texGreen), texGray, pending: false };
  if (!(texGreen > 0 || texGray > 0)) return null;
  const lw = Math.max(1, Math.min(4, cellPx * 0.12));
  // A death is a rounded end, a touch wider than the strand.
  const tipR = lw * 0.5 + Math.min(1.2, 0.3 + cellPx * 0.02);
  if (v.mesh) {
    const insts: MeshInst[] = [];
    for (const ln of meshLanes(m)) {
      const green = ln.lane === Lane.Green;
      const tex = green ? texGreen : texGray;
      const lives = green ? livesGreen : livesGray;
      if (tex * (1 - lives) > 0.02) laneInstances(v, m, ln, yTop, yBot, 0, tex * (1 - lives), { lw: 0.9, tipR: 0 }, insts);
      // Line weight by the lane's own strand spacing: strands never run into each other.
      const cell = green ? cellGreen : cellGray;
      const lwL = Math.max(1, Math.min(3.5, cell * 0.22));
      laneInstances(v, m, ln, yTop, yBot, 1, lives, { lw: lwL, tipR: lwL * 0.5 + Math.min(1, 0.25 + cell * 0.02) }, insts);
    }
    const batch = v.mesh;
    for (const inst of insts) packInst(inst, batch.f, batch.u, batch.next());
    stats.instances = insts.length;
  }
  if (cellPx < 1.5) return stats;
  const ctx = v.ctx;
  const gHi = m.generationAt(yTop);
  const gLo = Math.max(0, m.generationAt(yBot) - m.span);
  stats.g0 = gLo;
  stats.g1 = gHi;
  const [mx0, mx1] = xr(ym);
  const visFrac = Math.min(1, (mx1 - mx0) / Math.max(1e-300, L.w - L.gw));
  const perRow = Math.max(1, n * visFrac);
  const rows = gHi - gLo + 1;
  const livesA = Math.max(livesGray, livesGreen);
  if (rows * perRow > MAX_TWIGS || livesA <= 0.01) return stats;
  // The GPU draws the lives; the CPU only needs them for links, labels and the selection.
  if (rows * perRow > MAX_LINKS && !sel) return stats;
  // Threads to the parents fade in (no switch) from 4 px strands and as they get few enough.
  const linkBudget = Math.max(0, Math.min(1, (MAX_LINKS - rows * perRow) / (MAX_LINKS / 2)));
  const linksA = Math.max(0, Math.min(1, (cellPx - 4) / 2)) * linkBudget;
  const showLinks = linksA > 0.01;
  const showLabels = cellPx >= 70;
  stats.mode = showLabels ? 'labels' : showLinks ? 'links' : 'twigs';

  // The individuals on screen (the GPU draws their lives; links, labels and the selection are drawn here).
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
  stats.drawn = twigs.length;
  const lineage = (g: number, i: number, t: Twig) => !ext && (t.alive || m.lineage(g, i));

  if (showLinks) {
    // The mother's thread carries the line; the father's is the thin mesh joining two lines at the child's birth.
    const mk = () => ({ green: new Path2D(), gray: new Path2D(), far: new Path2D() });
    const prim = mk();
    const mesh = mk();
    for (const { g, i, t } of twigs) {
      if (g === 0) continue;
      const cx = v.toScreen(t.x, t.yBirth)[0];
      const ps = m.parents(g, i);
      const mi = Math.max(0, ps.findIndex((p) => m.sp.sexOf(p) === 'female'));
      const genH = m.row(g - 1).y - m.row(g).y;
      const childGreen = lineage(g, i, t);
      ps.forEach((p, j) => {
        const pg = p.generation;
        const pi = Number(p.index);
        const pt = m.twig(pg, pi);
        // Leaves the parent's strand a little before the child's birth (or at the
        // parent's death, if earlier) and curves up into the child's base, like a fork.
        const [px, py, cy2] = threadEnds(v, m, pt, t, genH);
        // Long threads (the rare migrants) are drawn faint so the local braid reads.
        const far = Math.abs(px - cx) > 6 * cellPx;
        const pGreen = !ext && (childGreen || lineage(pg, pi, pt));
        const set = j === mi ? prim : mesh;
        const path = pGreen ? set.green : far ? set.far : set.gray;
        const dy = Math.max(3, (py - cy2) * 0.6);
        path.moveTo(px, py);
        path.bezierCurveTo(px, py - dy, cx, cy2 + dy, cx, cy2);
      });
    }
    const strokes = (s: ReturnType<typeof mk>, w: number, a: number) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = rgba('#aab2ba', 0.12 * a * livesA);
      ctx.stroke(s.far);
      ctx.strokeStyle = rgba('#aab2ba', 0.4 * a * livesA);
      ctx.stroke(s.gray);
      ctx.strokeStyle = rgba(LINEAGE, 0.7 * a * livesA);
      ctx.stroke(s.green);
    };
    strokes(mesh, Math.max(0.6, lw * 0.3), 0.7 * linksA);
    strokes(prim, Math.max(0.9, lw * 0.6), linksA);
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
        const [px, py] = threadEnds(v, m, m.twig(p.generation, Number(p.index)), t, genH);
        const dy = Math.max(3, (py - yb) * 0.6);
        ctx.moveTo(px, py);
        ctx.bezierCurveTo(px, py - dy, x, yb + dy, x, yb);
      }
    }
    ctx.stroke();
  }

  if (showLabels && twigs.length <= 400) {
    ctx.save();
    ctx.font = `12px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#dfe7e2';
    for (const { g, i, t } of twigs) {
      const top = twigTop(v, t);
      const [x, yd] = v.toScreen(m.xAt(t.u, top, t.alive), top);
      const y = Math.min(v.h - 4, yd - tipR - 3);
      if (y < 14) continue; // tip above the screen: no label piled on the top edge
      ctx.fillText(m.sp.handle({ generation: g, index: BigInt(i) }), x, y, cellPx * 0.95);
    }
    ctx.restore();
  }
  return stats;
}
