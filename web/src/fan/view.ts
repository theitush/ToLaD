// The fan view: the dated tree drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { formatCount } from '../data/count';
import { Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, STRAND_PX, type Camera } from './camera';
import { laneAt, layoutFan, leftAt, nodeLeftAt, nodeQ, segAt, STEM_FADE_MA, type EdgeStyle, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { FanGL, rgb01 } from './meshgl';
import { COLUMN_DIM, columnSpans, EVENT_TINT, eventAt, eventSpans, type EventSpan } from './colstyle';
import { drawTwigs, kLogAt, laneDim, LINEAGE, LIVING, TWIG_GRAY, TwigModel, type IndInfo, type TwigStats } from './twigs';
import type { MeshBatch, RectBatch } from './meshgl';

export type { IndInfo } from './twigs';
export type { Camera } from './camera';

/** Alive now: the one luminous colour. */
export const GREEN = '#3fd286';
/** Line ended: a cool slate, darker than both greens (told apart by lightness too, not hue alone). */
export const GRAY = '#67737f';
/** The ground (app.css --ground): spruce at night. */
export const BG = '#0c1714';
/** Text on the canvas (app.css --ink, --ink-2, --ink-3). */
const INK = '#e8f0ea';
const INK2 = '#a9b8ae';
const INK3 = '#7d8e84';
/** Type (app.css): a condensed sans for all that is read at a glance, a serif italic for Latin names. */
export const SANS = "'Sofia Sans Condensed', 'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif";
export const SERIF = "'Newsreader', 'Iowan Old Style', Georgia, serif";
const font = (spec: string, family = SANS) => `${spec} ${family}`;
/** A species' label: its name, upright on a dark pill LABEL_PILL px across, LABEL_PAD px past each end of the text. */
const LABEL_FONT = '650 15px';
const LABEL_PILL = 22;
const LABEL_PAD = 8;
/** Right edge (px) of the time axis's labels: species' labels keep right of it. */
const LABEL_AXIS_X = 72;
/** The scale bar and legend at the bottom (px): labels fade out over the 30 px above it. */
const LABEL_BOTTOM_PX = 104;
/** How long a label takes to fade in or out when another takes or gives up its place (ms). */
const LABEL_FADE_MS = 180;

/** Gap (px) a label keeps from the column it sits beside. */
const LABEL_GAP = 3;
/** Highest a label standing on "now" may reach where the buttons are not above it (px from the top). */
const LABEL_CEIL = 6;

/**
 * Where a label goes (#97). One pill everywhere (#54): the name upright on a
 * dark pill, the same text and size at every zoom. Two places for it:
 *
 *  - On its tip (`tip`): standing on the "now" line at the top of its column
 *    for a living species (an extinct one: on its own tip), centred on the
 *    column and sliding along it to stay on screen. The space above "now" is
 *    empty, so a pill reaches up from the line as far as the buttons allow.
 *  - Beside its branch (`right`, `left`): when the tip is off screen (above
 *    the top line), next to the top of its column's part on screen, a gap
 *    clear of it, where no other column is in the way. A parent column (a
 *    lineage: "Small cat ancestors") is labelled this way too, but only while
 *    "now" is off screen: at home the species name the tree.
 *  - In its column (`in`), at the top line, where the column is wider on
 *    screen than the pill (zoomed into it): nothing is beside it then.
 *
 * Every spot is a continuous function of the camera; its `fit` (0–1) fades
 * it in and out over a few px of motion (the tip leaving the top, no room
 * beside the column, the time axis on the left, the legend at the bottom),
 * so a label moves from its tip to beside its branch by a cross-fade, never a
 * jump. resolveLabels picks one spot per name and never lets two meet.
 */
export interface LabelSpot {
  /** The spot's key: the name's id and the place (`tip`, `in`, `right`, `left`). */
  key: string;
  /** The name's id: a species' gid, or `n<index>` for a lineage. Place: see labelSpots. */
  id: string;
  place: 'tip' | 'in' | 'right' | 'left';
  /** The species (b) or the lineage (v) it names. */
  b?: FanBranch;
  v?: FanNode;
  /** A curated event's label (ToLaD#141): its index in `b.sp.history.events`. */
  ev?: number;
  text: string;
  rank: Rank;
  /** Centre x of the pill and its bottom (screen px): the text reads up from there. */
  x: number;
  y1: number;
  /** The pill [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** 0–1: how fully this spot is there (see above). */
  fit: number;
}

/** Priority: species before lineages, then the wider column first, then tree order. */
type Rank = [number, number, number];

type Screen = Pick<FanCamera, 'toScreen' | 'toWorld' | 'w' | 'h'> & { cam: { sx: number; sy: number } };

/** A column's world span: x (its widest reach, peel included) and y. */
interface ColBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Where its peel ends (world y). */
  lean: number;
  own: FanBranch | FanNode;
  /** Its edges [left, right] at world y (in its span). */
  at: (y: number) => [number, number];
}

/** The fan's columns as ColBoxes: the leaf columns above their splits, the parent columns over their spans (the stem below the root). Kept per fan. */
/** Each branch's styled column spans (colstyle.ts) in world y: [top, bottom, dim]; world-fixed, so built once per layout. */
const colSpanCache = new WeakMap<FanBranch, [number, number, number][]>();
export function colSpansY(fan: Fan, b: FanBranch): [number, number, number][] {
  let out = colSpanCache.get(b);
  if (!out) {
    out = columnSpans(b.sp, b.t0).map((s) => [fan.time.y(s.ago1 / 1e6), fan.time.y(s.ago0 / 1e6), COLUMN_DIM[s.style]]);
    colSpanCache.set(b, out);
  }
  return out;
}

/** Each branch's curated events (colstyle.ts eventSpans, ToLaD#141) in world y: `top` (younger) to `bot`; world-fixed. */
export interface EventY extends EventSpan {
  top: number;
  bot: number;
}
const colEventCache = new WeakMap<FanBranch, EventY[]>();
export function colEventsY(fan: Fan, b: FanBranch): EventY[] {
  let out = colEventCache.get(b);
  if (!out) {
    out = eventSpans(b.sp, b.t0).map((s) => ({ ...s, top: fan.time.y(s.ago1 / 1e6), bot: fan.time.y(s.ago0 / 1e6) }));
    colEventCache.set(b, out);
  }
  return out;
}
/** An event's tint is at least this tall and this wide on screen (px), so a short window on a thin column still reads. */
const EVENT_MIN_PX = 2;
const EVENT_MIN_W = 3;
/** How far (px) above or below a window a touch still opens it. */
const EVENT_REACH_PX = 10;

const colBoxCache = new WeakMap<Fan, Map<FanBranch | FanNode, ColBox>>();
function colBoxes(fan: Fan): Map<FanBranch | FanNode, ColBox> {
  let out = colBoxCache.get(fan);
  if (out) return out;
  out = new Map();
  // Edges are pure functions of the height, and most heights asked for are on a grid fixed in the world: memoised.
  const memo = (f: (y: number) => [number, number]) => {
    const m = new Map<number, [number, number]>();
    return (y: number) => {
      let r = m.get(y);
      if (!r) {
        if (m.size > 4096) m.clear();
        m.set(y, (r = f(y)));
      }
      return r;
    };
  };
  for (const b of fan.branches) {
    const at = memo((y) => {
      const l = leftAt(b, y);
      return [l, l + laneAt(b, y).w];
    });
    out.set(b, { x0: Math.min(b.x0, b.colLeft), x1: Math.max(b.x0, b.colLeft) + b.width, y0: b.tipY, y1: b.splitY, lean: b.leanY, own: b, at });
  }
  for (const v of fan.nodes) {
    const at = memo((y) => {
      const l = nodeLeftAt(v, y);
      return [l, l + v.width];
    });
    out.set(v, { x0: Math.min(v.tile, v.left), x1: Math.max(v.tile, v.left) + v.width, y0: v.y, y1: v.parent ? v.yBot : Infinity, lean: v.leanY, own: v, at });
  }
  colBoxCache.set(fan, out);
  return out;
}

/**
 * The species' and lineages' label spots. `top` is the labels' top line
 * (under the buttons); `barX0` the buttons' left edge: left of it a label on
 * "now" may reach higher, up to LABEL_CEIL.
 */
export function labelSpots(c: Screen, fan: Fan, top: number, measure: (text: string) => number, barX0?: number): LabelSpot[] {
  const half = LABEL_PILL / 2;
  const X = (x: number) => c.toScreen(x, 0)[0];
  const Y = (y: number) => c.toScreen(0, y)[1];
  const bottom = c.h - LABEL_BOTTOM_PX + 30;
  const botFit = (y1: number) => clamp01((bottom - y1) / 30);
  const nowY = fan.time.y(0);
  const nowS = Y(nowY);
  /** "now" on screen (below the top line): 1, fading over 24 px as it goes above. */
  const nowOn = clamp01((nowS - top) / 24);

  // Heights (world) to measure a column's edge at between wa < wb: both ends, its own ends and peel's end
  // (`at`) and a grid fixed in the world, at most 8 px apart. Points only enter at the ends, where the edge
  // is measured exactly, so what is measured changes continuously as the camera moves.
  const grid = 2 ** -Math.ceil(Math.log2(Math.max(1e-12, c.cam.sy) / 8));
  const heights = (wa: number, wb: number, at: number[]): number[] => {
    const ys = [wa, wb];
    for (const y of at) if (y > wa && y < wb) ys.push(y);
    for (let y = Math.ceil(wa / grid) * grid; y < wb; y += grid) ys.push(y);
    return ys;
  };
  // What a label beside a branch must clear: the columns near it (their widest reach within CLEAR px).
  // A gap of CLEAR px or more counts as clear (clearFit is 1 from there).
  const CLEAR = 6;
  const boxes = colBoxes(fan);
  const cols = [...boxes.values()];
  /** Least gap (px, up to CLEAR) between the strip [xa, xb] × [ya, yb] and any column but `own`'s (negative: they overlap). */
  const clearance = (xa: number, xb: number, ya: number, yb: number, own: FanBranch | FanNode) => {
    let gap = CLEAR;
    if (!(yb > ya)) return gap;
    const [wxa, wya] = c.toWorld(xa - CLEAR, ya);
    const [wxb, wyb] = c.toWorld(xb + CLEAR, yb);
    for (const q of cols) {
      if (q.own === own || q.x1 < wxa || q.x0 > wxb || q.y1 <= wya || q.y0 > wyb) continue;
      for (const wy of heights(Math.max(wya, q.y0), Math.min(wyb, q.y1 - 1e-9), [q.lean])) {
        const [l, r] = q.at(wy);
        gap = Math.min(gap, Math.max(X(l) - xb, xa - X(r)));
      }
      // Hidden from here on whatever else is near.
      if (gap <= -1) return gap;
    }
    return gap;
  };
  const clearFit = (gap: number) => clamp01((gap + 1) / 6);

  /** The spots beside a column on screen from y0 down (its own edge from `edge`, its bottom at screen yBot). */
  const beside = (id: string, text: string, rank: Rank, len: number, own: FanBranch | FanNode, yTop: number, yBot: number, fit0: number, ref: { b?: FanBranch; v?: FanNode }): LabelSpot[] => {
    const y0 = Math.max(top, yTop);
    const y1 = y0 + len;
    if (!(fit0 > 0) || y0 > bottom) return [];
    // Its widest (l, r) and narrowest (il, ir) along the pill.
    let l = Infinity;
    let r = -Infinity;
    let il = -Infinity;
    let ir = Infinity;
    const wTop = c.toWorld(0, y0)[1];
    const wBot = c.toWorld(0, Math.min(y1, yBot))[1] - 1e-9;
    if (!(wBot >= wTop)) return [];
    const ob = boxes.get(own)!;
    for (const wy of heights(wTop, wBot, [ob.lean])) {
      const [a, b] = ob.at(wy);
      l = Math.min(l, X(a));
      r = Math.max(r, X(b));
      il = Math.max(il, X(a));
      ir = Math.min(ir, X(b));
    }
    if (!(r >= l)) return [];
    // Fades: the column's part on screen too short to stand beside, and the legend.
    const f = fit0 * clamp01((yBot - y0 - 12) / 24) * botFit(y1);
    const out: LabelSpot[] = [];
    // Inside it, at the top line, when it is wide enough on screen (zoomed into it): centred on its part on screen.
    {
      const a = Math.max(il, LABEL_AXIS_X) + half + 4;
      const b = Math.min(ir, c.w) - half - 4;
      const mid = (il + ir) / 2;
      const x = a <= b ? Math.min(Math.max(mid, a), b) : Math.min(Math.max(mid, b), a);
      const fit = f * clamp01((b - a) / 8) * clamp01((yBot - y1) / 12);
      out.push({ key: `${id}:in`, id, place: 'in', ...ref, text, rank, x, y1, box: [x - half, y0, x + half, y1], fit });
    }
    for (const place of ['right', 'left'] as const) {
      const x = place === 'right' ? r + LABEL_GAP + half : l - LABEL_GAP - half;
      const xa = x - half;
      const xb = x + half;
      // Clear of the other columns and the time axis (past the screen's right edge it is only cut off).
      const fit = f > 0 && xa < c.w && xb > 0 ? f * clearFit(Math.min(xa - LABEL_AXIS_X, clearance(xa, xb, y0, y1, own))) : 0;
      out.push({ key: `${id}:${place}`, id, place, ...ref, text, rank, x, y1, box: [xa, y0, xb, y1], fit });
    }
    return out;
  };

  const out: LabelSpot[] = [];
  for (const b of fan.branches) {
    const text = b.sp.common;
    const id = String(b.sp.gid);
    const len = measure(text) + 2 * LABEL_PAD;
    const rank: Rank = [0, b.width, b.index];
    // On its tip: centred on the column there, kept on screen (right of the time axis) while the column is.
    const tl = X(leftAt(b, b.tipY));
    const tw = laneAt(b, b.tipY).w * c.cam.sx;
    const room = b.width * c.cam.sx;
    const left = X(b.colLeft);
    const cx = tl + tw / 2;
    const lo = Math.max(left, LABEL_AXIS_X) + half;
    const hi = Math.min(left + room, c.w) - half;
    const x = lo <= hi ? Math.min(Math.max(cx, lo), hi) : Math.min(Math.max(cx, hi), lo);
    const ceil = barX0 === undefined ? top : LABEL_CEIL + (top - LABEL_CEIL) * clamp01((x + half - (barX0 - 68)) / 60);
    const ty = Y(b.tipY);
    const y1 = Math.max(ty - 4, ceil + len);
    // The tip on screen (below the top line) and its column right of the axis and left of the screen's edge.
    const tipOn = clamp01((ty - top) / 24) * clamp01((left + room - LABEL_AXIS_X + 12) / LABEL_PILL) * clamp01((c.w + 12 - left) / LABEL_PILL);
    // Above the tip, clear of the other columns (an extinct tip has its neighbours around it; above "now" there are none).
    const f = tipOn * botFit(y1);
    const tipFit = f > 0 && b.tipY > nowY ? f * clearFit(clearance(x - half, x + half, y1 - len, Math.min(y1, ty - 2), b)) : f;
    out.push({ key: `${id}:tip`, id, place: 'tip', b, text, rank, x, y1, box: [x - half, y1 - len, x + half, y1], fit: tipFit });
    // Beside its branch: once the tip is off screen.
    out.push(...beside(id, text, rank, len, b, ty, Y(b.splitY), 1 - clamp01((ty - top) / 24), { b }));
  }
  // Curated events (ToLaD#141): the title beside its window (or in the column when zoomed into it),
  // centred on the window, while the window is on screen. After the species' names, before the lineages'.
  for (const b of fan.branches) {
    for (const s of colEventsY(fan, b)) {
      const text = s.ev.title;
      const len = measure(text) + 2 * LABEL_PAD;
      const st = Y(s.top);
      const sb = Y(s.bot);
      const fit0 = clamp01((sb - top) / 12) * clamp01((bottom - st) / 12);
      const rank: Rank = [0.5, b.width, b.index * 64 + s.k];
      for (const p of beside(`e${b.sp.gid}.${s.k}`, text, rank, len, b, (st + sb) / 2 - len / 2, Y(b.splitY), fit0, { b })) out.push({ ...p, ev: s.k });
    }
  }
  // The lineages (parent columns, not the stem below the root: the clade's own label is there), while "now" is off screen.
  if (nowOn < 1) {
    for (const v of fan.nodes) {
      if (!v.parent) continue;
      const text = v.name;
      const id = `n${fan.nodes.indexOf(v)}`;
      const len = measure(text) + 2 * LABEL_PAD;
      const rank: Rank = [1, v.width, fan.nodes.indexOf(v)];
      out.push(...beside(id, text, rank, len, v, Y(v.y), Y(v.yBot), 1 - nowOn, { v }));
    }
  }
  return out;
}

/**
 * Which spots show: at most one per name, never two meeting. A fixed priority
 * (species first, the wider column first, then tree order) so the order never
 * changes with the camera; a name takes the first of its spots (on its tip,
 * in its column, right, left)
 * that meets none shown before it. Hysteresis: the spots shown last frame go
 * first, each keeping its place while it fits and meets no other; a hidden
 * one waits for a clear gap and a fit over 0.6, so a newcomer never pushes a
 * shown label off.
 */
export function resolveLabels(spots: LabelSpot[], prev: Map<string, boolean>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const taken: number[][] = [];
  const done = new Set<string>();
  const placeOrder = { tip: 0, in: 1, right: 2, left: 3 };
  const order = [...spots].sort((p, q) => p.rank[0] - q.rank[0] || q.rank[1] - p.rank[1] || p.rank[2] - q.rank[2] || placeOrder[p.place] - placeOrder[q.place]);
  for (const s of spots) out.set(s.key, false);
  // The spots shown last frame first (each keeps its place while it fits and meets no other), then the rest.
  for (const pass of [true, false]) {
    for (const s of order) {
      if (done.has(s.id) || !!prev.get(s.key) !== pass) continue;
      if (!(s.fit > (pass ? 0 : 0.6))) continue;
      if (taken.some((q) => boxGap(s.box, q) < (pass ? -1 : 5))) continue;
      out.set(s.key, true);
      done.add(s.id);
      taken.push(s.box);
    }
  }
  return out;
}

/** Gap (px) between two boxes [x0, y0, x1, y1]: negative when they overlap. */
export function boxGap(a: number[], b: number[]): number {
  return Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export interface Selection {
  sp: SpeciesRec;
  ind?: IndInfo;
  /** The time touched (Ma), within the species' column: the card shows the population then. */
  ageMa?: number;
  /** The species' start (Ma): its split, where its own column begins (the card's numbers are the column's). */
  startMa?: number;
  /** A parent column touched (below the species' split): the lineage there, its numbers at the time touched. */
  lineage?: Lineage;
  /** A curated event touched (its window on the column, or its label): the card explains it (ToLaD#141). */
  event?: EventSpan;
}

/** A parent column at a time: the daughters' shared ancestors. */
export interface Lineage {
  node: FanNode;
  name: string;
  ageMa: number;
  /** Individuals alive then (model) and the share with living descendants today. */
  alive: number;
  green: number;
  /** The species it is the ancestor of, left to right (common names). */
  of: string[];
}

/** The lineage in the column strand b is in at age `ageMa` (at or below its split). */
export function lineageAt(b: FanBranch, fan: Fan, ageMa: number): Lineage {
  const v = segAt(b, fan.time.y(ageMa)).node;
  return { node: v, name: v.name, ageMa, alive: v.n, green: nodeQ(v, ageMa), of: v.strands.map((s) => s.sp.common) };
}

interface RibbonPt {
  x: number;
  y: number;
  nx: number;
  ny: number;
  w: number;
  f: number;
}

export class FanView implements InputHandlers {
  readonly ctx: CanvasRenderingContext2D;
  readonly input: Input;
  readonly camera: FanCamera;
  mode: WidthMode = 'linear';
  edge: EdgeStyle = 'curved';
  dpr = 1;
  selected: SpeciesRec | null = null;
  selInd: { g: number; i: number } | null = null;
  /** The point touched on the selected column (world x, age in Ma): marked on the graph, the card's numbers are for it. */
  touch: { x: number; ageMa: number } | null = null;
  onSelect: (sel: Selection | null) => void = () => {};
  /** The width scale bar (a DOM element above the legend / cards): its bar and label are set each frame. */
  scaleEl: HTMLElement | null = null;
  /** The buttons (a DOM element over the canvas): labels never go under them. */
  barEl: HTMLElement | null = null;
  private scaleKey = '';
  /** Each species' label: shown or not, and its fade (0–1); when it was last drawn (ms). */
  private labelState = new Map<string, { on: boolean; a: number }>();
  private labelT = 0;
  /** `?debug`: a readout of the zooms, years on screen and individuals per px. */
  readonly debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  /** What each branch's individuals view drew last frame (taps, tests). */
  twigStats = new Map<number, TwigStats>();
  /** Without the GPU layer: this frame's styled column stretches, faded once the individuals are drawn. */
  private heldRuns: { run: RibbonPt[]; hw: number; d: number }[] = [];
  /** The event labels shown last frame (screen boxes): a tap on one opens its event. */
  private eventLabels: { box: [number, number, number, number]; b: FanBranch; k: number }[] = [];
  private models = new Map<string, TwigModel>();
  private raf = 0;
  private anim: ((t: number) => boolean) | null = null;
  private ro: ResizeObserver;
  /** The WebGL2 layer under the canvas: lanes and the individuals mesh (null: Canvas 2D only). */
  readonly gl: FanGL | null = null;
  /** Frame times (ms, CPU side of draw()), for perf runs. */
  readonly frameMs: number[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clade: CladeRec,
    edge: EdgeStyle = 'curved',
  ) {
    this.edge = edge;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    this.ctx = ctx;
    // The GPU layer sits right under the 2D canvas (same box) and takes no input.
    if (canvas.parentElement && typeof document !== 'undefined' && !new URLSearchParams(location.search).has('nogl')) {
      const glc = document.createElement('canvas');
      glc.className = canvas.className;
      glc.style.pointerEvents = 'none';
      glc.setAttribute('aria-hidden', 'true');
      canvas.parentElement.insertBefore(glc, canvas);
      try {
        this.gl = new FanGL(glc);
      } catch (e) {
        console.warn('fan: no WebGL2, drawing with Canvas 2D', e);
        glc.remove();
      }
    }
    this.camera = new FanCamera(layoutFan(clade, this.mode, undefined, this.edge), (b) => this.model(b));
    // Width and time zoom separately (#138): a sideways pinch zooms width, an upright one time, a diagonal both.
    this.input = new Input(canvas, this, true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.camera.cam = this.homeCamera();
    this.camera.settle();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    this.ro.disconnect();
    this.gl?.canvas.remove();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const first = this.w === 1;
    this.camera.w = Math.max(1, r.width);
    this.camera.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (first) this.cam = this.homeCamera();
    this.camera.settle();
    this.request();
  }

  get cam(): Camera {
    return this.camera.cam;
  }
  set cam(c: Camera) {
    this.camera.cam = c;
  }
  get fan(): Fan {
    return this.camera.fan;
  }
  get w(): number {
    return this.camera.w;
  }
  get h(): number {
    return this.camera.h;
  }

  /** The whole fan: "now" near the top, the stem entering from the bottom edge. */
  homeCamera(): Camera {
    return this.camera.home();
  }

  setMode(mode: WidthMode): void {
    this.mode = mode;
    this.relayout();
  }

  /** The edges' design (the toggle): curved or straight. Same data, the camera stays put. */
  setEdge(edge: EdgeStyle): void {
    if (edge === this.edge) return;
    this.edge = edge;
    this.relayout();
  }

  private relayout(): void {
    this.camera.fan = layoutFan(this.clade, this.mode, undefined, this.edge);
    this.camera.settle();
    this.request();
  }

  resetView(): void {
    this.flyTo(this.homeCamera());
  }

  model(b: FanBranch): TwigModel {
    const key = `${b.sp.gid}:${this.mode}`;
    let m = this.models.get(key);
    if (!m || m.b !== b) {
      m = new TwigModel(b, this.fan.time, this.mode);
      this.models.set(key, m);
    }
    return m;
  }

  // ---- camera helpers -------------------------------------------------------

  get sx(): number {
    return this.cam.sx;
  }
  get sy(): number {
    return this.cam.sy;
  }

  get yNow(): number {
    return this.fan.time.y(0);
  }

  toScreen(x: number, y: number): [number, number] {
    return this.camera.toScreen(x, y);
  }

  toWorld(px: number, py: number): [number, number] {
    return this.camera.toWorld(px, py);
  }

  /** Zoom about a screen point by factors fx (width) and fy (time), within the camera's limits. */
  zoomAbout(px: number, py: number, fx: number, fy = fx): void {
    this.camera.zoomAbout(px, py, fx, fy);
  }

  /** Animate the camera to `to` over `ms`; `done` runs when it lands (not if a gesture takes over first). */
  flyTo(to: Camera, ms = 650, done?: () => void): void {
    const from = { ...this.cam };
    const t0 = performance.now();
    // Interpolate log-zoom, and each centre coordinate so it moves at constant screen speed.
    const axis = (s0: number, s1: number, c0: number, c1: number, e: number): [number, number] => {
      const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * e);
      const k = s0 === s1 ? e : (1 / s0 - 1 / s) / (1 / s0 - 1 / s1);
      return [s, c0 + (c1 - c0) * k];
    };
    this.anim = (now) => {
      const u = Math.min(1, (now - t0) / ms);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const [sx, cx] = axis(from.sx, to.sx, from.cx, to.cx, e);
      const [ty, cy] = axis(from.sy, to.ty, from.cy, to.cy, e);
      this.cam = { sx, sy: ty, ty, cx, cy };
      this.camera.settle();
      if (u >= 1) done?.();
      return u < 1;
    };
    this.request();
  }

  /**
   * Where a search pick lands (ToLaD#157): the species' column centred, its tip (now for the living,
   * the last appearance for a fossil) at a fifth of the way down so its label stands above it, and
   * its own stretch (tip to split) filling the band above the card. Width and time are framed apart
   * (#138): the column about half the screen wide, within the width limit.
   */
  speciesCamera(b: FanBranch): Camera {
    const h = this.homeCamera();
    const tipPx = Math.max(this.labelTop() + 150, 0.2 * this.h);
    const band = Math.max(80, 0.52 * this.h - tipPx);
    const sy = Math.max(h.sy, band / Math.max(1e-300, b.splitY - b.tipY));
    const cyAt = (s: number) => b.tipY + (this.h / 2 - tipPx) / s;
    const sx = Math.min(Math.max(h.sx, (0.5 * this.w) / Math.max(1e-300, b.width)), Math.max(h.sx, this.camera.sxCap(b.cx, b.tipY)));
    // Within the time limit (MIN_YEARS on screen) about the tip, where it will sit.
    const s = this.camera.timeCap(b.tipY, tipPx, sy, h.sy);
    return { cx: b.cx, cy: cyAt(s), sx, sy: s, ty: s };
  }

  /** A search pick: fly to the species' column, then open its card at its tip, as a tap there would. */
  flyToSpecies(sp: SpeciesRec, ms = 700): void {
    const b = this.fan.branches.find((x) => x.sp === sp);
    if (!b) return;
    // The card open now closes for the flight (the column stays in view under it).
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    this.flyTo(this.speciesCamera(b), ms, () => {
      const wy = b.tipY;
      this.selected = sp;
      this.selInd = null;
      this.touch = { x: leftAt(b, wy) + laneAt(b, wy).w / 2, ageMa: sp.t1 };
      this.onSelect({ sp, ageMa: sp.t1, startMa: b.t0 });
      this.request();
    });
  }

  /** Branch (column part) under a screen point, with a finger-sized slop. */
  hitBranch(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    const slop = 16 / this.cam.sx;
    const slopY = 16 / this.cam.sy;
    let best: FanBranch | null = null;
    let bd = Infinity;
    const yb = this.fan.trunkBottom.y;
    for (const b of this.fan.branches) {
      if (wy > yb + slopY || wy < b.tipY - slopY) continue;
      const yc = Math.min(yb, Math.max(b.tipY, wy));
      const left = leftAt(b, yc);
      const d = Math.max(0, left - wx, wx - left - laneAt(b, yc).w);
      if (d <= slop && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---- InputHandlers --------------------------------------------------------

  /** Fling velocity: pan (px/ms), width (z) and time (t) log-zoom (/ms), about (px, py). */
  private vel = { x: 0, y: 0, z: 0, t: 0, px: 0, py: 0 };

  gestureStart(): void {
    this.anim = null;
  }
  gestureEnd(): void {}
  pan(dx: number, dy: number): void {
    this.camera.pan(dx, dy);
    this.request();
  }
  zoom(px: number, py: number, fx: number, ft: number): void {
    this.zoomAbout(px, py, fx, ft);
    this.request();
  }
  fling(vx: number, vy: number, vz: number, px: number, py: number, vt = vz): void {
    this.vel = { x: vx, y: vy, z: vz, t: vt, px, py };
    let last = performance.now();
    this.anim = (now) => {
      const dt = Math.min(50, now - last);
      last = now;
      const v = this.vel;
      this.pan(v.x * dt, v.y * dt);
      if (v.z || v.t) this.zoomAbout(v.px, v.py, Math.exp(v.z * dt), Math.exp(v.t * dt));
      const d = Math.exp(-dt / 260);
      v.x *= d;
      v.y *= d;
      v.z *= d;
      v.t *= d;
      return Math.abs(v.x) + Math.abs(v.y) > 0.01 || Math.abs(v.z) + Math.abs(v.t) > 1e-5;
    };
    this.request();
  }
  /**
   * Double-tap a branch to fly in: first frame its width at that height (the
   * width zoom jumps straight to it, however thin the branch is in linear
   * mode), then each double-tap zooms the width 16× and time 2× towards the
   * individuals. Off a branch: 4× on both axes.
   */
  doubleTap(x: number, y: number): void {
    const [wx, wy] = this.toWorld(x, y);
    const b = this.hitBranch(x, y);
    let sx = this.cam.sx * 4;
    let sy = this.cam.sy * 4;
    let framing = false;
    if (b) {
      const [, bw] = this.spanAt(b, wy);
      const wpx = bw * this.cam.sx;
      const frame = (this.w * 0.6) / Math.max(1e-300, bw);
      if (wpx < this.w * 0.45) {
        sx = frame;
        sy = this.cam.sy * 2;
        framing = true;
      } else {
        sx = this.cam.sx * 16;
        // Time zooms enough that a generation is about as tall as two strands are wide
        // (deep in the past a screen holds thousands of generations).
        const m = this.model(b);
        const g = m.generationAt(wy);
        const genH = Math.abs(m.yOf(g * m.GL) - m.yOf((g + 1) * m.GL));
        // One individual's width (the same in both lanes).
        const cell = m.pitch(wy);
        sx = Math.min(sx, STRAND_PX / Math.max(1e-300, cell));
        sy = Math.max(this.cam.sy * 2, Math.min(this.cam.sy * 64, (2 * cell * sx) / Math.max(1e-300, genH)));
      }
    }
    // Within the camera's limits: at least 10 years on screen, the width limit where the finger is.
    sy = this.camera.timeCap(wy, y, sy);
    let cx = wx - (x - this.w / 2) / sx;
    if (b) {
      sx = Math.min(sx, Math.max(this.cam.sx, this.camera.sxCap(wx, wy)));
    }
    const wxT = wx;
    cx = wxT - (x - this.w / 2) / sx;
    if (b) {
      if (framing) {
        const [l, w] = this.spanAt(b, wy);
        cx = l + w / 2;
      }
      // In the green lane, land on a living strand rather than a vacant slot
      // (only about a third of the index slots hold someone alive).
      const m = this.model(b);
      const L = m.lanes(wy);
      const slotPx = m.pitch(wy) * sx;
      if (wxT < L.left + L.gw && slotPx > 12) cx = m.nearestLiving(wxT, wy, Math.ceil(this.w / slotPx)) ?? cx;
    }
    this.flyTo({ sx, sy, ty: sy, cx, cy: wy - (y - this.h / 2) / sy });
  }

  /** What a tap on strand b at world y frames: its own column above its split, the parent column below ([left, width]). */
  private spanAt(b: FanBranch, wy: number): [number, number] {
    const y = Math.min(this.fan.trunkBottom.y, Math.max(b.tipY, wy));
    if (y < b.splitY) return [leftAt(b, y), laneAt(b, y).w];
    const v = segAt(b, y).node;
    return [nodeLeftAt(v, y), v.width];
  }

  tap(x: number, y: number): void {
    // An event's label: opens its event, the touch at the middle of its window on the column.
    const lab = this.eventLabels.find(({ box }) => x >= box[0] - 4 && x <= box[2] + 4 && y >= box[1] - 4 && y <= box[3] + 4);
    const ev = lab && colEventsY(this.fan, lab.b).find((s) => s.k === lab.k);
    if (lab && ev) {
      const ageMa = Math.sqrt(Math.max(1, ev.ago0) * Math.max(1, ev.ago1)) / 1e6;
      const wy = this.fan.time.y(ageMa);
      this.selected = lab.b.sp;
      this.selInd = null;
      this.touch = { x: leftAt(lab.b, wy) + laneAt(lab.b, wy).w / 2, ageMa };
      this.onSelect({ sp: lab.b.sp, ageMa, startMa: lab.b.t0, event: ev });
      this.request();
      return;
    }
    const b = this.hitBranch(x, y);
    this.selected = b ? b.sp : null;
    this.selInd = null;
    let ind: IndInfo | undefined;
    const st = b && this.twigStats.get(b.sp.gid);
    if (b && st && st.mode !== 'texture') {
      const [wx, wy] = this.toWorld(x, y);
      const m = this.model(b);
      const a = m.hit(wx, wy, 14 / this.cam.sx, 14 / this.cam.sy);
      if (a) {
        this.selInd = a;
        ind = m.info(a.g, a.i);
      }
    }
    // The time touched, kept within the strand (from its tip down to the bottom of the world).
    const wy = Math.min(this.fan.trunkBottom.y, this.toWorld(x, y)[1]);
    const ageMa = b ? Math.max(b.sp.t1, this.fan.time.ageAt(wy)) : undefined;
    this.touch = b && ageMa !== undefined ? { x: this.toWorld(x, y)[0], ageMa } : null;
    // Below its split: the parent column, the lineage there (unless an individual was hit).
    const lineage = b && ageMa !== undefined && !ind && wy >= b.splitY ? lineageAt(b, this.fan, ageMa) : undefined;
    // Inside a curated event's window on its own column (or within a finger's reach of it): the card explains it.
    let event: EventSpan | undefined;
    if (b && ageMa !== undefined && !ind && !lineage) {
      const r = EVENT_REACH_PX / this.cam.sy;
      const a0 = this.fan.time.ageAt(Math.max(b.tipY, wy - r)) * 1e6;
      const a1 = this.fan.time.ageAt(Math.min(this.fan.trunkBottom.y, wy + r)) * 1e6;
      event = eventAt(colEventsY(this.fan, b), ageMa * 1e6, Math.min(a0, a1), Math.max(a0, a1)) ?? undefined;
    }
    this.onSelect(b ? { sp: b.sp, ind, ageMa, startMa: b.t0, lineage, event } : null);
    this.request();
  }

  // ---- drawing ----------------------------------------------------------------

  request(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      if (this.anim && !this.anim(t)) this.anim = null;
      this.draw();
      if (this.anim) this.request();
    });
  }

  /** Where drawTwigs sends the mesh (the GPU layer). */
  get mesh(): MeshBatch | undefined {
    return this.gl?.mesh;
  }

  /** A flat rectangle under everything else (the GPU layer, or the 2D canvas without it). */
  private under(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a = 1): void {
    if (this.gl) {
      this.gl.under.push(x0, y0, x1, y1, rgb[0], rgb[1], rgb[2], a);
      return;
    }
    this.ctx.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a})`;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  draw(): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.gl?.begin();
    if (this.gl) ctx.clearRect(0, 0, this.w, this.h);
    else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.drawTimeAxis(false);
    this.drawStem();
    for (const b of this.fan.branches) this.drawStrand(b);
    for (const b of this.fan.branches) this.drawIndividuals(b);
    this.drawHeld();
    this.drawEvents();
    this.drawStemFade();
    // Labels: one form everywhere (see labelSpots).
    this.drawGutter();
    this.drawTouch();
    const spots = labelSpots(this.camera, this.fan, this.labelTop(), (t) => this.nameWidth(t), this.barRect()?.[0]);
    this.drawLabels(spots);
    this.drawWidthScale();
    if (this.debug) this.drawDebug();
    this.drawTrunkLabel();
    this.drawTimeAxis(true);
    if (this.gl) {
      const pal = [LIVING, LINEAGE, TWIG_GRAY].map(rgb01);
      this.gl.end(this.w, this.h, this.dpr, rgb01(BG), kLogAt(this, this.fan.time, this.cam.cy), this.toScreen(0, this.yNow)[1], pal);
    }
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  /**
   * The parent columns below each split (the stem below the oldest): their
   * daughters' strands side by side with no gaps; a dark backdrop under each,
   * so a column reads as one without seams passing for lanes. It follows the
   * column's curve where it peels off its parent (chords a few px tall).
   */
  private drawStem(): void {
    const c = rgb01(this.gl ? mix(GRAY, '#131c19', 0.86) : GRAY);
    const [, wTop] = this.toWorld(0, -8);
    const [, wBot] = this.toWorld(0, this.h + 8);
    for (const v of this.fan.nodes) {
      const ya = Math.max(v.y, wTop);
      const yb = Math.min(v.yBot, wBot);
      if (!(yb > ya)) continue;
      // Straight below its peel: one piece; the peel in chords.
      const peel = v.leanY;
      const ys = [ya];
      if (peel > ya && peel < yb) ys.push(peel);
      const p0 = Math.max(ya, peel);
      if (yb > p0) {
        const n = Math.min(400, Math.max(1, Math.ceil(((yb - p0) * this.cam.sy) / 4)));
        for (let i = 1; i < n; i++) ys.push(p0 + ((yb - p0) * i) / n);
      }
      ys.push(yb);
      for (let i = 0; i + 1 < ys.length; i++) {
        const [l0, t] = this.toScreen(nodeLeftAt(v, ys[i]), ys[i]);
        const [l1, b] = this.toScreen(nodeLeftAt(v, ys[i + 1]), ys[i + 1]);
        const w = v.width * this.cam.sx;
        if (!(b > t) || Math.max(l0, l1) > this.w + 8 || Math.min(l0, l1) + w < -8) continue;
        if (this.gl) this.gl.under.push(l0, t, l0 + w, b, c[0], c[1], c[2], 1, l1 - l0, l1 - l0);
        else {
          this.ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
          this.ctx.beginPath();
          this.ctx.moveTo(l0, t);
          this.ctx.lineTo(l0 + w, t);
          this.ctx.lineTo(l1 + w, b);
          this.ctx.lineTo(l1, b);
          this.ctx.fill();
        }
      }
    }
  }

  /** The stem fades out over its last stretch (from STEM_FADE_MA down to the bottom of the world): nothing ends abruptly. */
  private drawStemFade(): void {
    const f = this.fan;
    const [, ya] = this.toScreen(0, f.time.y(STEM_FADE_MA));
    const [, yb] = this.toScreen(0, f.trunkBottom.y);
    if (yb < 0 || ya > this.h) return;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, ya, 0, yb);
    g.addColorStop(0, 'rgba(11,19,17,0)');
    g.addColorStop(1, BG);
    ctx.fillStyle = g;
    const t = Math.max(-8, ya);
    const b = Math.min(this.h + 8, yb + 2);
    if (b > t) ctx.fillRect(0, t, this.w, b - t);
  }

  /**
   * Fill a ribbon between offsets a(p) and b(p) (world width units along the
   * left normal, scaled by the width zoom), at least minPx thick (negative:
   * towards the right). The polygon is clipped to the screen in float64 before
   * it reaches the canvas, which mishandles coordinates far off screen.
   */
  private ribbon(pts: RibbonPt[], a: (p: RibbonPt) => number, bOff: (p: RibbonPt) => number, minPx = 0): void {
    const k = this.cam.sx;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of pts) {
      const off = a(p) * k;
      xs.push(p.x + p.nx * off);
      ys.push(p.y + p.ny * off);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const ao = a(p) * k;
      const bo = bOff(p) * k;
      const off = minPx >= 0 ? Math.max(bo, ao + minPx) : Math.min(bo, ao + minPx);
      xs.push(p.x + p.nx * off);
      ys.push(p.y + p.ny * off);
    }
    const [cx, cy] = clipPoly(xs, ys, -8, -8, this.w + 8, this.h + 8);
    if (cx.length < 3) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx[0], cy[0]);
    for (let i = 1; i < cx.length; i++) ctx.lineTo(cx[i], cy[i]);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * One species' strand bundle, drawn whole from the bottom of the world
   * up through the parent columns of the splits it passes and its own column
   * to its tip. A parent column is just its daughters' strands side by side
   * (widths adding up to its width), its green one prefix across them.
   *
   * Smooth curves (layout.ts): its slices of the parent columns, its peel off
   * each fork along an S-curve, its column about its centre line; sampled
   * at world-fixed heights a few px apart on screen (lanePoints), straight
   * chords between them.
   */
  private drawStrand(b: FanBranch): void {
    const yb = this.fan.trunkBottom.y;
    const [, ayTip] = this.toScreen(0, b.tipY);
    const [, byBot] = this.toScreen(0, yb);
    if (byBot < 0 || ayTip > this.h) return;
    // Wholly left or right of the screen (zoomed in, most strands are): nothing to sample.
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const xr = this.fan.tess.xRange(b, sTop, sBot);
    if (this.toScreen(xr[1], 0)[0] < -12 || this.toScreen(xr[0], 0)[0] > this.w + 12) return;
    const hw = b.width / 2;
    const pts = this.lanePoints(b, hw);
    if (pts.length < 2) return;
    const ctx = this.ctx;
    // The column's styled spans on screen ([top, bottom, dim]), clipped to it: none for most strands.
    const held: [number, number, number][] = [];
    for (const [t, bt, d] of colSpansY(this.fan, b)) {
      const st = this.toScreen(0, t)[1];
      const sb = this.toScreen(0, bt)[1];
      if (sb > -20 && st < this.h + 20) held.push([st, sb, d]);
    }
    // As the strands fade in (twigs.ts), the lanes dim to a backdrop under them: the same
    // lanes, the same geometry, never a switch.
    const tw = this.twigStats.get(b.sp.gid);
    // Under the mesh the lanes sink to a dark tint of themselves, so the individuals carry the colour:
    // each stretch by its own lanes' widths (twigs.ts laneDim), as the mesh draws them.
    const lives = tw?.fade ?? 0;
    const greenFade = tw?.fadeGreen ?? 0;
    const greenC = mix(GREEN, '#0d2318', greenFade * 0.9);
    const grayC = mix(GRAY, '#131c19', Math.max(lives, tw?.texGray ?? 0) * 0.82);
    if (this.gl) {
      // Between neighbouring samples each lane is a trapezoid (the curve's chord, a few px at most):
      // the whole lane gray (at least 0.6 px), the green lane over its left edge (at least 1 px).
      const k = this.cam.sx;
      const L = this.w;
      // ([cl, cr]: clipped along the row, so a lane's least width across a steep lean reaches only
      // as far as its chord does.)
      const trap = (batch: RectBatch, l0: number, r0: number, l1: number, r1: number, y0: number, y1: number, c: [number, number, number], a: number, cl = -8, cr = L + 8) => {
        // Lanes wholly off screen are dropped; an edge wholly off screen is pinned just outside it (float32 stays exact).
        if ((r0 < -8 && r1 < -8) || (l0 > L + 8 && l1 > L + 8)) return;
        cl = Math.max(-8, cl);
        cr = Math.min(L + 8, cr);
        if (l0 < -8 && l1 < -8) l0 = l1 = -8;
        if (r0 > L + 8 && r1 > L + 8) r0 = r1 = L + 8;
        batch.push(l0, y0, r0, y1, c[0], c[1], c[2], a, l1 - l0, r1 - r0, cl, cr);
      };
      for (let i = 0; i + 1 < pts.length; i++) {
        // p below q on screen: the trapezoid from q's row (top) to p's.
        const p = pts[i];
        const q = pts[i + 1];
        const y0 = q.y;
        const y1 = p.y;
        if (!(y1 > y0) || y1 < -4 || y0 > this.h + 4) continue;
        const xq = q.x - hw * k;
        const xp = p.x - hw * k;
        const wq = q.w * k;
        const wp = p.w * k;
        if (!(wq > 0) && !(wp > 0)) continue;
        const gq = wq * q.f;
        const gp = wp * p.f;
        const wm = (wq + wp) / 2;
        const gm = (gq + gp) / 2;
        const gc = mix01(GRAY, '#131c19', laneDim(wm - gm, lives) * 0.82);
        const ec = mix01(GREEN, '#0d2318', laneDim(gm, lives) * 0.9);
        // A styled stretch of the column (held flat for want of figures: colstyle.ts) fades towards the
        // background: the background over the whole lane, lanes and individuals alike (drawn after the mesh).
        const dim = held.length ? dimAt(held, (y0 + y1) / 2) : 0;
        // The least widths across the lane, not along the row: a thin branch-out leaning s px per px
        // is √(1 + s²) px of the row per px across (else a hairline lean breaks into dashes).
        const sq = Math.sqrt(1 + ((xp + wp / 2 - xq - wq / 2) / (y1 - y0)) ** 2);
        const xa = Math.min(xq, xp);
        const xr = Math.max(xq + Math.max(0.6, wq), xp + Math.max(0.6, wp)) + 0.5;
        trap(this.gl.under, xq, xq + Math.max(0.6 * sq, wq), xp, xp + Math.max(0.6 * sq, wp), y0, y1, gc, 1, xa - 0.5, xr);
        if (dim > 0) trap(this.gl.over, xq, xq + Math.max(sq, wq), xp, xp + Math.max(sq, wp), y0, y1, BG01, dim, xa - 0.5, xr + 0.5);
        if (gq > 0 || gp > 0) {
          const g1q = xq + Math.max(sq, gq);
          const g1p = xp + Math.max(sq, gp);
          const xb = Math.max(xq + Math.max(1, gq), xp + Math.max(1, gp));
          // The living glow faintly (fading as their lane resolves into individuals).
          const glow = (1 - lives) * (1 - dim);
          if (glow > 0.01) {
            trap(this.gl.under, xq - 4 * sq, g1q + 4 * sq, xp - 4 * sq, g1p + 4 * sq, y0, y1, ec, 0.06 * glow, xa - 4, xb + 4);
            trap(this.gl.under, xq - 1.5 * sq, g1q + 1.5 * sq, xp - 1.5 * sq, g1p + 1.5 * sq, y0, y1, ec, 0.14 * glow, xa - 1.5, xb + 1.5);
          }
          trap(this.gl.under, xq, g1q, xp, g1p, y0, y1, ec, 1, xa - 0.5, xb + 0.5);
        }
      }
    } else {
      ctx.fillStyle = grayC;
      this.ribbon(pts, (p) => hw - p.w, () => hw, 0.6);
      if (pts.some((p) => p.f > 0)) {
        // Green lane on the left, floored at 1 px.
        ctx.fillStyle = greenC;
        this.ribbon(pts, () => hw, (p) => hw - p.w * p.f, -1);
      }
      // Its styled stretches: faded over the individuals too, once they are drawn (drawHeld).
      for (const [t, bt, d] of held) {
        const run = pts.filter((p) => p.y >= t - 0.5 && p.y <= bt + 0.5);
        if (run.length > 1) this.heldRuns.push({ run, hw, d });
      }
    }
  }

  /**
   * Without the GPU layer: the styled stretches of the columns (colstyle.ts) faded towards the
   * background over their lanes and individuals, as the GPU path does with its overlay.
   */
  private drawHeld(): void {
    for (const { run, hw, d } of this.heldRuns) {
      this.ctx.fillStyle = `rgba(12,23,20,${d})`;
      this.ribbon(run, (p) => hw - p.w, () => hw, 0.6);
    }
    this.heldRuns.length = 0;
  }

  /**
   * The curated events on the columns (colstyle.ts, ToLaD#141): each window tinted over its own column,
   * lanes and individuals alike, after the held fade (so an event in a held stretch still shows). At
   * least EVENT_MIN_PX tall and EVENT_MIN_W wide, centred, so a short window on a thin column reads at
   * home. GPU layer: the overlay batch (over the mesh); without it the same polygons on the canvas.
   */
  private drawEvents(): void {
    const [r, g, bl] = EVENT_TINT.rgb;
    for (const b of this.fan.branches) {
      for (const s of colEventsY(this.fan, b)) {
        let st = this.toScreen(0, s.top)[1];
        let sb = this.toScreen(0, s.bot)[1];
        if (sb - st < EVENT_MIN_PX) {
          const m = (st + sb) / 2;
          st = m - EVENT_MIN_PX / 2;
          sb = m + EVENT_MIN_PX / 2;
        }
        if (sb < -4 || st > this.h + 4) continue;
        st = Math.max(-4, st);
        sb = Math.min(this.h + 4, sb);
        // Slices a few px tall follow the column's curve (straight between them).
        const n = Math.max(1, Math.min(64, Math.ceil((sb - st) / 6)));
        let [l0, r0] = this.eventEdges(b, st);
        for (let i = 1; i <= n; i++) {
          const y0 = st + ((sb - st) * (i - 1)) / n;
          const y1 = st + ((sb - st) * i) / n;
          const [l1, r1] = this.eventEdges(b, y1);
          if (!((r0 < -8 && r1 < -8) || (l0 > this.w + 8 && l1 > this.w + 8))) {
            if (this.gl) this.gl.over.push(l0, y0, r0, y1, r, g, bl, EVENT_TINT.a, l1 - l0, r1 - r0, -8, this.w + 8);
            else {
              const ctx = this.ctx;
              ctx.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(bl * 255)},${EVENT_TINT.a})`;
              ctx.beginPath();
              ctx.moveTo(l0, y0);
              ctx.lineTo(r0, y0);
              ctx.lineTo(r1, y1);
              ctx.lineTo(l1, y1);
              ctx.closePath();
              ctx.fill();
            }
          }
          l0 = l1;
          r0 = r1;
        }
      }
    }
  }

  /** A species' own column at screen y (clamped to it): its left and right edges on screen, at least EVENT_MIN_W apart. */
  private eventEdges(b: FanBranch, sy: number): [number, number] {
    const y = Math.min(b.splitY, Math.max(b.tipY, this.toWorld(0, sy)[1]));
    const l = this.toScreen(leftAt(b, y), y)[0];
    const w = laneAt(b, y).w * this.cam.sx;
    const pad = Math.max(0, (EVENT_MIN_W - w) / 2);
    return [l - pad, l + w + pad];
  }

  /**
   * Where the card's numbers are from: on the selected column, a ring at the
   * point touched and a thin line across the column at its time, labelled
   * with that time ("70 yr ago").
   */
  private drawTouch(): void {
    const b = this.fan.branches.find((x) => x.sp === this.selected);
    const t = this.touch;
    if (!b || !t || this.selInd) return;
    const wy = this.fan.time.y(t.ageMa);
    const [, y] = this.toScreen(0, wy);
    if (y < -10 || y > this.h + 10) return;
    const [left, cw] = this.spanAt(b, wy);
    const x0 = this.toScreen(left, wy)[0];
    const x1 = x0 + Math.max(1, cw * this.cam.sx);
    if (x1 < 0 || x0 > this.w) return;
    const rx = Math.min(Math.max(this.toScreen(t.x, wy)[0], x0), x1);
    const ctx = this.ctx;
    ctx.save();
    // The line across the column (a little past its edges), on a dark halo so it reads over the mesh.
    const lx0 = Math.max(-2, x0 - 6);
    const lx1 = Math.min(this.w + 2, x1 + 6);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(12,23,20,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx0, y);
    ctx.lineTo(lx1, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,240,234,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // The ring.
    ctx.beginPath();
    ctx.arc(rx, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(12,23,20,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.75;
    ctx.stroke();
    // Its time, on a pill above the line: right of the ring if there is room, else left of it.
    const yrs = t.ageMa * 1e6;
    const label = yrs < 0.5 ? 'now' : formatTick(yrs, 0);
    ctx.font = font('650 12.5px');
    const tw = ctx.measureText(label).width + 14;
    let px = rx + 10;
    if (px + tw > this.w - 6) px = rx - 10 - tw;
    px = Math.max(this.w > 200 ? 70 : 4, px);
    const py = y - 26;
    ctx.fillStyle = 'rgba(12,23,20,0.86)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw, 20, 10);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 7, py + 10.5);
    ctx.restore();
  }

  /**
   * A branch's lanes as screen points, bottom to top, one per sample height
   * (layout.ts Tess.cuts: its features and a world-fixed grid a few px apart
   * on screen) over the screen and a little beyond it, each exactly on the
   * edges' curves: the lanes are drawn straight between them.
   */
  lanePoints(b: FanBranch, hw: number): RibbonPt[] {
    const yb = this.fan.trunkBottom.y;
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    // The column's kept samples (twigs.ts ColumnPath: those where its chords run straight on screen dropped).
    const P = this.model(b).path;
    const [i0, i1] = P.span(this.cam.sx, this.cam.sy, sTop, Math.min(yb, sBot));
    const ys = P.ys;
    const vals = P.vals;
    // Spine at left + hw: the ribbon spans offsets [hw - w, hw] to its left (nx = -1).
    // (Where the lanes step, as at a split, where the strand leaves its parent's prefix: a point either side.)
    const pts: RibbonPt[] = [];
    const push = (y: number, o: number) => {
      const w = vals[o + 1];
      const [px, py] = this.toScreen(vals[o] + hw, y);
      pts.push({ x: px, y: py, nx: -1, ny: 0, w, f: w > 0 ? vals[o + 2] / w : 0 });
    };
    for (let i = i1; i >= i0; i--) {
      const y = ys[i];
      const o = 8 * i;
      push(y, o);
      if (P.steps[i]) push(y, o + 4);
    }
    return pts;
  }

  private drawIndividuals(b: FanBranch): void {
    const st = drawTwigs(this, b, this.model(b), this.selected === b.sp ? this.selInd : null);
    const prev = this.twigStats.get(b.sp.gid);
    // The lanes under the strands depend on the fade: redraw once when it changes,
    // and keep drawing while lineage answers are still being worked out.
    if ((prev?.fade ?? 0) !== (st?.fade ?? 0) || (prev?.fadeGreen ?? 0) !== (st?.fadeGreen ?? 0) || (prev?.texGray ?? 0) !== (st?.texGray ?? 0) || st?.pending) this.request();
    if (st) this.twigStats.set(b.sp.gid, st);
    else this.twigStats.delete(b.sp.gid);
  }

  /** The buttons' box in canvas px [x0, y0, x1, y1], if any. */
  private barRect(): number[] | null {
    if (!this.barEl) return null;
    const r = this.barEl.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return [r.left - c.left, r.top - c.top, r.right - c.left, r.bottom - c.top];
  }

  /** The labels' top line (screen y): just under the buttons, the same for every label. */
  private labelTop(): number {
    const bar = this.barRect();
    return (bar ? bar[3] : 44) + 8;
  }

  /** Length (px) of a species' name in the label font (not cached: the web font may arrive after the first frame). */
  private nameWidth(text: string): number {
    this.ctx.save();
    this.ctx.font = font(LABEL_FONT);
    const w = this.ctx.measureText(text).width;
    this.ctx.restore();
    return w;
  }

  /**
   * The species' labels (see labelSpots for where): which show is decided by
   * resolveLabels (a fixed priority, with hysteresis), and each fades in and
   * out over LABEL_FADE_MS rather than popping.
   */
  private drawLabels(spots: LabelSpot[]): void {
    const ctx = this.ctx;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.labelT));
    this.labelT = now;
    const prev = new Map<string, boolean>();
    for (const [key, st] of this.labelState) prev.set(key, st.on);
    const on = resolveLabels(spots, prev);
    this.eventLabels.length = 0;
    let moving = false;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(LABEL_FONT);
    for (const s of spots) {
      const want = on.get(s.key) ? 1 : 0;
      let st = this.labelState.get(s.key);
      if (!st) this.labelState.set(s.key, (st = { on: want === 1, a: want }));
      st.on = want === 1;
      if (st.a !== want) {
        const step = dt / LABEL_FADE_MS;
        st.a = want > st.a ? Math.min(want, st.a + step) : Math.max(want, st.a - step);
        moving = true;
      }
      const alpha = st.a * s.fit;
      const [x0, y0, x1, y1] = s.box;
      if (alpha < 0.01 || x1 < 0 || x0 > this.w || y1 < 0 || y0 > this.h) continue;
      if (s.ev !== undefined && s.b && alpha > 0.5) this.eventLabels.push({ box: [x0, y0, x1, y1], b: s.b, k: s.ev });
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(12,23,20,0.8)';
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, LABEL_PILL / 2);
      ctx.fill();
      // Upright, reading up the column.
      ctx.save();
      ctx.translate(s.x, y1 - LABEL_PAD);
      ctx.rotate(-Math.PI / 2);
      // A lineage's name in the second ink: the species' are the tree's names. An event's title in its tint.
      ctx.fillStyle = s.ev !== undefined ? EVENT_TINT.css : s.v ? INK2 : INK;
      ctx.fillText(s.text, 0, 0.5);
      ctx.restore();
    }
    ctx.restore();
    if (moving) this.request();
  }

  /**
   * The width scale, like a map's: a bar and how many individuals alive at
   * the time its width holds at the current zoom (a round 1, 2 or 5 × 10^k).
   * In log widths a width is 1 + log10(individuals), so the bar is the width
   * that multiplies the individuals by 10 (or by 10^k, or by a factor,
   * whichever fits).
   */
  widthScale(): { px: number; label: string } {
    const unitPx = this.fan.branches[0].unit * this.cam.sx; // px per individual (linear) or per decade (log)
    const target = 70;
    if (this.mode === 'linear') {
      const per = 1 / unitPx; // individuals per px
      const n = Math.max(1, niceStep(target * per));
      const px = n / per;
      return { px, label: `${formatCount(n, { exact: true })} ${n === 1 ? 'individual' : 'individuals'}` };
    }
    if (unitPx < target * 2.5) {
      const k = Math.max(1, niceStep(target / unitPx));
      return { px: k * unitPx, label: `×${k === 1 ? '10' : `10${sup(k)}`} individuals · log widths` };
    }
    const fct = Math.pow(10, target / unitPx);
    return { px: target, label: `×${fct < 1.1 ? fct.toFixed(4) : fct.toFixed(2)} individuals · log widths` };
  }

  private drawWidthScale(): void {
    const el = this.scaleEl;
    if (!el) return;
    const { px, label } = this.widthScale();
    const key = `${px.toFixed(1)}|${label}`;
    if (key === this.scaleKey) return;
    this.scaleKey = key;
    const bar = el.firstElementChild as HTMLElement | null;
    const lab = el.lastElementChild as HTMLElement | null;
    if (bar) bar.style.width = `${px.toFixed(1)}px`;
    if (lab) lab.textContent = label;
  }

  private drawDebug(): void {
    const c = this.cam;
    const h = this.homeCamera();
    const [, yTop] = this.toWorld(0, 0);
    const [, yBot] = this.toWorld(0, this.h);
    const yrs = this.camera.years(yBot) - this.camera.years(yTop);
    const perPx = 1 / this.fan.branches[0].unit / c.sx;
    const lines = [
      `width ×${(c.sx / h.sx).toPrecision(4)}  time ×${(c.sy / h.sy).toPrecision(4)} (asked ×${(c.ty / h.sy).toPrecision(3)})`,
      `screen ${formatYearsAgo(yrs).replace(' ago', '')} · top ${formatYearsAgo(Math.max(0, this.camera.years(yTop)))}`,
      `${this.mode === 'linear' ? `${perPx.toPrecision(3)} individuals/px` : `${perPx.toPrecision(3)} log units/px`}`,
    ];
    const ctx = this.ctx;
    ctx.save();
    // Under the buttons, right-aligned: clear of the axis and of the species' labels at the top.
    ctx.font = font('500 12px');
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
    const bar = this.barRect();
    const top = (bar ? bar[3] : 40) + 8;
    ctx.fillStyle = 'rgba(10,16,13,0.85)';
    ctx.fillRect(this.w - 8 - bw, top, bw, 50);
    ctx.fillStyle = '#ffd479';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    lines.forEach((l, k) => ctx.fillText(l, this.w - 14, top + 5 + k * 14));
    ctx.restore();
  }

  /**
   * The time axis, pinned to the left edge at every zoom: ticks adapt to the
   * visible range (round log ticks far out, round linear steps deep in), and
   * "now" is always labelled (pinned to the top edge when it is above the screen).
   */
  private drawTimeAxis(labels: boolean): void {
    const ctx = this.ctx;
    const ts = this.fan.time;
    const origin = ts.originMa * 1e6;
    // The axis goes on below the origin, down the stem to the bottom of the world.
    const bottom = ts.ageAt(this.fan.trunkBottom.y) * 1e6;
    const yrsAt = (py: number) => ts.ageAt(this.toWorld(0, py)[1]) * 1e6;
    const aTop = Math.min(bottom, yrsAt(-10));
    const aBot = Math.min(bottom, yrsAt(this.h + 10));
    const clear = (yrs: number) => Math.abs(Math.log10(yrs / origin)) > 0.025 && yrs <= bottom * 1.0001;
    const syOf = (yrs: number) => this.toScreen(0, ts.y(yrs / 1e6))[1];
    // Candidates in priority order: origin and now, round log ticks, then linear steps.
    const cands: { yrs: number; step: number }[] = [{ yrs: origin, step: 0 }, { yrs: 0, step: 0 }];
    for (const m of [1, 5, 2]) {
      for (let e = 9; e >= 0; e--) {
        const yrs = m * Math.pow(10, e);
        if (clear(yrs) && yrs >= aTop && yrs <= aBot) cands.push({ yrs, step: yrs });
      }
    }
    const span = aBot - aTop;
    if (span > 0) {
      for (const div of [3, 6, 12]) {
        const step = niceStep(span / div);
        for (let k = Math.ceil(aTop / step); k * step <= aBot && k - Math.ceil(aTop / step) < 40; k++) {
          const yrs = k * step;
          if (yrs > 0 && clear(yrs)) cands.push({ yrs, step });
        }
      }
    }
    const placed: { yrs: number; step: number; sy: number }[] = [];
    for (const c of cands) {
      const sy = syOf(c.yrs);
      if (sy < -10 || sy > this.h + 10) continue;
      const must = c.step === 0;
      if (!must && placed.some((p) => Math.abs(p.sy - sy) < 30)) continue;
      if (placed.some((p) => p.yrs === c.yrs)) continue;
      placed.push({ ...c, sy });
    }
    ctx.save();
    ctx.font = font('500 12px');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = BG;
    if (!labels) {
      // Grid lines go under the branches; the labels go on top of everything.
      for (const p of placed) {
        const y = Math.round(p.sy);
        if (p.yrs === 0) {
          // "Now": a lit horizon.
          this.under(0, y - 3, this.w, y + 4, rgb01(GREEN), 0.05);
          this.under(0, y, this.w, y + 1, rgb01(GREEN), 0.4);
        } else this.under(0, y, this.w, y + 1, [220 / 255, 235 / 255, 225 / 255], 0.06);
      }
      ctx.restore();
      return;
    }
    // A gutter that fades out from the left edge, and a halo of the ground round each label:
    // the labels read over the branches and the stem.
    // (The gutter itself is drawn under the species' labels: drawGutter.)
    ctx.font = font('500 12px');
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(12,23,20,0.9)';
    // "now" above the screen: a marker pinned at the top, and no tick label under it.
    const nowAbove = syOf(0) < 0;
    const nowY = Math.max(12, (this.barRect()?.[1] ?? 10) + 8);
    for (const p of placed) {
      const now = p.yrs === 0;
      if (nowAbove && !now && p.sy - 7 < nowY + 16) continue;
      // (Not under the foot: the scale bar and the key sit there.)
      if (!now && p.sy - 7 > this.h - 74) continue;
      // A short tick at the edge, visible over the branches too.
      ctx.fillStyle = now ? GREEN : '#8d9e93';
      ctx.fillRect(0, Math.round(p.sy), now ? 6 : 4, 1);
      const label = now ? 'now' : p.yrs === origin ? `${formatTick(origin, 0)}, the cats begin` : formatTick(p.yrs, p.step);
      ctx.fillStyle = now ? GREEN : p.yrs === origin ? INK : INK3;
      if (now || p.yrs === origin) ctx.font = font('650 12.5px');
      ctx.strokeText(label, 6, p.sy - 7);
      ctx.fillText(label, 6, p.sy - 7);
      ctx.font = font('500 12px');
    }
    if (nowAbove) {
      ctx.font = font('650 12.5px');
      ctx.fillStyle = GREEN;
      ctx.strokeText('↑ now', 6, nowY);
      ctx.fillText('↑ now', 6, nowY);
      ctx.font = font('500 12px');
    }
    // Honest scale note under the axis labels.
    const oy = syOf(origin);
    if (oy > 0 && oy < this.h - 20) {
      ctx.fillStyle = INK3;
      ctx.font = font('italic 400 12px', SERIF);
      ctx.strokeText('time, log scale', 6, oy + 9);
      ctx.fillText('time, log scale', 6, oy + 9);
    }
    ctx.restore();
  }

  /** The time axis's gutter: the branches fade under it at the left edge; the labels go over it. */
  private drawGutter(): void {
    const ctx = this.ctx;
    const gut = ctx.createLinearGradient(0, 0, 96, 0);
    gut.addColorStop(0, 'rgba(12,23,20,0.86)');
    gut.addColorStop(0.55, 'rgba(12,23,20,0.5)');
    gut.addColorStop(1, 'rgba(12,23,20,0)');
    ctx.fillStyle = gut;
    ctx.fillRect(0, 0, 96, this.h);
  }

  private drawTrunkLabel(): void {
    const ctx = this.ctx;
    const f = this.fan;
    // Right of the stem, just below the fork (nothing else is drawn there).
    const [sx, sy] = this.toScreen(f.stem[1], 0);
    if (sy > this.h + 20 || sy < -80 || sx > this.w) return;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const lines: [string, string, string][] = [
      [f.clade.common, font('650 17px'), INK],
      [f.clade.sci, font('italic 400 14px', SERIF), INK2],
      // The living first; the total born only as an honest secondary line (a model figure, never bare).
      [`${formatCount(f.clade.alive)} alive now`, font('600 13px'), GREEN],
      [`${formatCount(f.clade.ever)} born in total (model, grade ${f.clade.grade})`, font('500 13px'), INK2],
    ];
    let wmax = 0;
    for (const [t, ft] of lines) {
      ctx.font = ft;
      wmax = Math.max(wmax, ctx.measureText(t).width);
    }
    // Right of the stem if it fits; else on the stem itself, just below the fork, on a halo.
    const onStem = sx + 10 + wmax > this.w - 6;
    const [stemL] = this.toScreen(f.stem[0], 0);
    // (Clear of the axis's "time, log scale" note beside the fork.)
    ctx.font = font('italic 400 12px', SERIF);
    const noteR = 6 + ctx.measureText('time, log scale').width + 12;
    const x = onStem ? Math.max(noteR, stemL + 10) : Math.max(noteR, sx + 10);
    const y = sy + 8;
    if (onStem) {
      ctx.shadowColor = 'rgba(12,23,20,0.95)';
      ctx.shadowBlur = 7;
    }
    const dy = [0, 21, 39, 55];
    lines.forEach(([t, ft, c], k) => {
      ctx.font = ft;
      ctx.fillStyle = c;
      ctx.fillText(t, x, y + dy[k]);
      if (onStem) ctx.fillText(t, x, y + dy[k]);
    });
    ctx.restore();
  }

}


function sup(k: number): string {
  return String(k)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] ?? d)
    .join('');
}

/** A round step (1, 2 or 5 × 10^k) near `x`. */
export function niceStep(x: number): number {
  const e = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, e);
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * Math.pow(10, e);
}

/** Compact tick label for `yrs` years ago, with as many decimals as the tick step needs. */
export function formatTick(yrs: number, step: number): string {
  const [div, unit] = yrs >= 1e9 ? [1e9, 'Gya'] : yrs >= 1e6 ? [1e6, 'Mya'] : yrs >= 1e3 ? [1e3, 'kya'] : [1, 'yr ago'];
  const st = step > 0 ? step / div : yrs / div;
  const dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(st) + 1e-9)));
  const v = yrs / div;
  const d = step > 0 ? dec : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${tickFormat(d).format(Number(v.toFixed(d)))} ${unit}`;
}

/** en-US number formats by decimals (made once: toLocaleString makes one per call, the axis's ticks every frame). */
const tickFormats = new Map<number, Intl.NumberFormat>();
function tickFormat(d: number): Intl.NumberFormat {
  let f = tickFormats.get(d);
  if (!f) tickFormats.set(d, (f = new Intl.NumberFormat('en-US', { maximumFractionDigits: d })));
  return f;
}

/** Mix two #rrggbb colours: t = 0 gives a, 1 gives b (#rrggbb). */
function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

const BG01 = rgb01(BG);
/** The dim of the styled span (screen [top, bottom, dim]) a screen y falls in; 0 in none. */
function dimAt(spans: [number, number, number][], y: number): number {
  for (const s of spans) if (y >= s[0] && y <= s[1]) return s[2];
  return 0;
}

const rgbParsed = new Map<string, [number, number, number]>();
/** mix() straight to 0–1 channels, as rgb01(mix(a, b, t)) gives them (no strings: it runs per chord, per frame). */
function mix01(a: string, b: string, t: number): [number, number, number] {
  let A = rgbParsed.get(a);
  if (!A) rgbParsed.set(a, (A = rgb01(a)));
  let B = rgbParsed.get(b);
  if (!B) rgbParsed.set(b, (B = rgb01(b)));
  const c = (k: number) => Math.round((A[k] * (1 - t) + B[k] * t) * 255) / 255;
  return [c(0), c(1), c(2)];
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatYearsAgo(y: number): string {
  if (y < 1) return 'under a year ago';
  if (y < 1e4) return `${fmtInt(y)} years ago`;
  if (y < 999500) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} thousand years ago`;
  return `${(y / 1e6).toFixed(2)} million years ago`;
}
