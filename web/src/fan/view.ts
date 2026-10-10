// The fan view: the dated tree drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { formatCount } from '../data/names';
import { Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, STRAND_PX, type Camera } from './camera';
import { commonSplit, laneAt, layoutFan, leftAt, nodeQ, segAt, STEM_FADE_MA, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { FanGL, rgb01, type RectBatch } from './meshgl';
import { drawTwigs, kLogAt, laneDim, LINEAGE, LIVING, TWIG_GRAY, TWIG_WITHERED, TwigModel, type IndInfo, type TwigStats } from './twigs';
import type { MeshBatch } from './meshgl';

export type { IndInfo } from './twigs';
export type { Camera } from './camera';

/** Alive now: the one luminous colour. */
export const GREEN = '#3fd286';
/** Line ended: a cool slate, darker than both greens (told apart by lightness too, not hue alone). */
export const GRAY = '#67737f';
/** The ground (app.css --ground): spruce at night. */
export const BG = '#0c1714';
const WITHERED = '#8b806d';
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
/** A label hangs this share of the way down its own column from its widest (youngest) point to its split (alternating). */
const LABEL_DROP = [0.05, 0.45];
const LABEL_PAD = 8;
/** Right edge (px) of the time axis's labels: species' labels keep right of it. */
const LABEL_AXIS_X = 72;
/** The scale bar and legend at the bottom (px): labels fade out over the 30 px above it. */
const LABEL_BOTTOM_PX = 104;
/** How long a label takes to fade in or out when another takes or gives up its place (ms). */
const LABEL_FADE_MS = 180;

/**
 * Where a species' label goes. One rule at every zoom and scroll: the common
 * name (the Latin name is on the card), upright on a dark pill at the left
 * edge of its column (the columns are left-aligned, so that is where the tip
 * and the narrowest times are), standing on the tip; when the tip scrolls up
 * past the top line it sticks there, inside the column, until the column's
 * split (its start) pushes it off. Off the left (under the time axis) it slides along the
 * column, never past its right edge (fading as that edge goes under the
 * axis). All of it is a continuous function of the camera.
 */
export interface LabelSpot {
  b: FanBranch;
  text: string;
  /** Centre x of the pill and its bottom (screen px): the text reads up from there. */
  x: number;
  y1: number;
  /** The pill [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** 0–1: fades with the column's width on screen (too narrow) and near the legend at the bottom. */
  fit: number;
}

type Screen = Pick<FanCamera, 'toScreen' | 'toWorld' | 'w' | 'h'> & { cam: { sx: number } };

export function labelSpots(c: Screen, fan: Fan, top: number, measure: (text: string) => number): LabelSpot[] {
  const half = LABEL_PILL / 2;
  return fan.branches.map((b) => {
    const text = b.sp.common;
    const len = measure(text) + 2 * LABEL_PAD;
    // At the youngest height where its column is widest (in a band without gaps the tips can be
    // thin: a recent crash, an extinct species' pinch), so the labels sit where the columns spread.
    let kw = 0;
    for (let k = 1; k < b.kw.length; k++) if (b.kw[k] > b.kw[kw] * (1 + 1e-9)) kw = k;
    // Then some way down its own column, alternating between neighbours (the living, and the extinct,
    // each in tree order): side by side without gaps, neighbouring pills stagger instead of colliding.
    const rank = fan.steps.order.filter((o) => o.sp.extinct === b.sp.extinct && o.index < b.index).length;
    const tipW0 = b.ky.length ? b.ky[kw] : b.tipY;
    const tipW = tipW0 + (b.sp.extinct ? 0.9 : LABEL_DROP[rank % 2]) * (b.splitY - tipW0);
    const ty = c.toScreen(0, tipW)[1];
    const fy = c.toScreen(0, b.splitY)[1];
    // On the tip; stuck under the top line once the tip is above it; never below its split (its own column).
    // (Its anchor below the screen: it waits above the legend, on its column.)
    const y1 = Math.min(Math.max(Math.min(ty - 4, c.h - LABEL_BOTTOM_PX), top + len), fy - 4);
    const wy = Math.min(b.splitY, Math.max(tipW, c.toWorld(0, y1)[1]));
    const left = c.toScreen(leftAt(b, wy), wy)[0];
    // Placed inside the column as wide as it is there; faded by its room (its widest), steady.
    const w = laneAt(b, wy).w * c.cam.sx;
    const room = b.width * c.cam.sx;
    // Centred on its column (side by side without gaps, neighbours' pills keep apart); off the time axis.
    const mid = left + w / 2;
    // (Within the column's part on screen, right of the axis: zoomed in, the column is wider than the screen.)
    const inset = Math.min(half, w / 2);
    const xl = Math.max(LABEL_AXIS_X + half, left + inset);
    const xr = Math.min(c.w - half, left + w - inset);
    const x = xr >= xl ? Math.min(Math.max(mid, xl), xr) : Math.max(mid, Math.min(xl, left + w - inset));
    // Fades: a column too narrow, one leaving under the time axis on the left, and near the legend.
    // (Every column has its pill, even one narrower than it, as the snow leopard's in linear widths: it overhangs.)
    const fit = clamp01(room / 0.5) * clamp01((left + room - LABEL_AXIS_X + 12) / LABEL_PILL) * clamp01((c.h - LABEL_BOTTOM_PX + 30 - y1) / 30);
    return { b, text, x, y1, box: [x - half, y1 - len, x + half, y1], fit };
  });
}

/**
 * Which labels show. A fixed priority (the wider column first, then tree
 * order) so the order never changes with the camera; a label shows unless it
 * would meet one shown before it. Hysteresis: a shown label keeps
 * its place until it overlaps, a hidden one waits for a clear gap.
 */
export function resolveLabels(spots: LabelSpot[], prev: Map<number, boolean>): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const taken: number[][] = [];
  const order = [...spots].sort((p, q) => Number(p.b.sp.extinct) - Number(q.b.sp.extinct) || q.b.width - p.b.width || p.b.index - q.b.index);
  for (const s of order) {
    const gid = s.b.sp.gid;
    if (!(s.fit > 0)) {
      out.set(gid, false);
      continue;
    }
    const need = prev.get(gid) ? -1 : 5;
    const on = !taken.some((q) => boxGap(s.box, q) < need);
    out.set(gid, on);
    if (on && s.fit > 0.3) taken.push(s.box);
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
  private labelState = new Map<number, { on: boolean; a: number }>();
  private labelT = 0;
  /** `?debug`: a readout of the zooms, years on screen and individuals per px. */
  readonly debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  /** What each branch's individuals view drew last frame (taps, tests). */
  twigStats = new Map<number, TwigStats>();
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
  ) {
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
    this.camera = new FanCamera(layoutFan(clade, this.mode), (b) => this.model(b));
    this.input = new Input(canvas, this);
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
    this.camera.fan = layoutFan(this.clade, mode);
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

  flyTo(to: Camera, ms = 650): void {
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
      return u < 1;
    };
    this.request();
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

  private vel = { x: 0, y: 0, z: 0, px: 0, py: 0 };

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
  fling(vx: number, vy: number, vz: number, px: number, py: number): void {
    this.vel = { x: vx, y: vy, z: vz, px, py };
    let last = performance.now();
    this.anim = (now) => {
      const dt = Math.min(50, now - last);
      last = now;
      const v = this.vel;
      this.pan(v.x * dt, v.y * dt);
      if (v.z) this.zoomAbout(v.px, v.py, Math.exp(v.z * dt), Math.exp(v.z * dt));
      const d = Math.exp(-dt / 260);
      v.x *= d;
      v.y *= d;
      v.z *= d;
      return Math.abs(v.x) + Math.abs(v.y) > 0.01 || Math.abs(v.z) > 1e-5;
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
    return [leftAt(v.strands[0], y), v.width];
  }

  tap(x: number, y: number): void {
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
    this.onSelect(b ? { sp: b.sp, ind, ageMa, startMa: b.t0, lineage } : null);
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
    this.drawSeparators();
    for (const b of this.fan.branches) this.drawIndividuals(b);
    this.drawStemFade();
    // Labels: one form everywhere (see labelSpots).
    this.drawGutter();
    this.drawTouch();
    const spots = labelSpots(this.camera, this.fan, this.labelTop(), (t) => this.nameWidth(t));
    this.drawLabels(spots);
    this.drawWidthScale();
    if (this.debug) this.drawDebug();
    this.drawTrunkLabel();
    this.drawTimeAxis(true);
    if (this.gl) {
      const pal = [LIVING, LINEAGE, TWIG_GRAY, TWIG_WITHERED].map(rgb01);
      this.gl.end(this.w, this.h, this.dpr, rgb01(BG), kLogAt(this, this.fan.time, this.cam.cy), this.toScreen(0, this.yNow)[1], pal);
    }
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  /**
   * The band's backdrop: one dark trapezoid per stretch between knots (on
   * screen), from its left edge to its right, so the strands side by side
   * read as one band without seams passing for lanes.
   */
  private drawStem(): void {
    if (!this.gl) return;
    const band = this.fan.steps;
    const n = band.n;
    const c = rgb01(mix(GRAY, '#131c19', 0.86));
    const ys = this.knotsOnScreen(band.ys, -Infinity, this.fan.trunkBottom.y);
    for (let i = 0; i + 1 < ys.length; i++) {
      const ya = ys[i];
      const yb = ys[i + 1];
      const [la, ta] = this.toScreen(band.edgeAt(0, ya), ya);
      const [ra] = this.toScreen(band.edgeAt(n, ya), ya);
      const [lb, tb] = this.toScreen(band.edgeAt(0, yb), yb);
      const [rb] = this.toScreen(band.edgeAt(n, yb), yb);
      this.trap(this.gl.under, la, ra, ta, lb, rb, tb, c, 1);
    }
  }

  /**
   * The knots of `all` (ascending world y) between y0 and y1 that are on
   * screen, the nearest beyond each screen edge, and the ends: every edge is
   * straight between two of them.
   */
  private knotsOnScreen(all: Float64Array | number[], y0: number, y1: number): number[] {
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const out: number[] = [];
    if (Number.isFinite(y0)) out.push(y0);
    for (let k = 0; k < all.length; k++) {
      const y = all[k];
      if (y <= y0 || y >= y1) continue;
      if ((y >= sTop && y <= sBot) || (y < sTop && !(all[k + 1] < sTop)) || (y > sBot && !(all[k - 1] > sBot))) out.push(y);
    }
    if (!Number.isFinite(y0) && all.length && all[0] >= y0) out.unshift(all[0]);
    out.push(y1);
    return [...new Set(out)].sort((p, q) => p - q);
  }

  /**
   * A trapezoid from screen row ya ([la, ra]) down to row yb ([lb, rb]),
   * clipped to the screen rows (the edges cut where they cross).
   */
  private trap(batch: RectBatch, la: number, ra: number, ya: number, lb: number, rb: number, yb: number, c: [number, number, number], a: number, minPx = 0): void {
    if (!(yb > ya)) return;
    const t0 = Math.max(-4, ya);
    const t1 = Math.min(this.h + 4, yb);
    if (!(t1 > t0)) return;
    const at = (u: number, v: number, y: number) => u + ((v - u) * (y - ya)) / (yb - ya);
    let l0 = at(la, lb, t0);
    let r0 = at(ra, rb, t0);
    let l1 = at(la, lb, t1);
    let r1 = at(ra, rb, t1);
    if (minPx > 0) {
      r0 = Math.max(r0, l0 + minPx);
      r1 = Math.max(r1, l1 + minPx);
    }
    if (Math.max(r0, r1) < -8 || Math.min(l0, l1) > this.w + 8) return;
    // (Far off screen sideways: clamp, keeping the slant on screen roughly right.)
    const cl = (x: number) => Math.max(-1e5, Math.min(1e5, x));
    l0 = cl(l0);
    r0 = cl(r0);
    l1 = cl(l1);
    r1 = cl(r1);
    batch.push(l0, t0, r0, t1, c[0], c[1], c[2], a, l1 - l0, r1 - r0);
  }

  /**
   * The separators: a hairline in the background's colour on each edge
   * between two neighbouring strands, from their last common split up to now
   * (below it they are one column, no line). Where an extinct strand has
   * pinched out its two edges meet, one line.
   */
  private drawSeparators(): void {
    if (!this.gl) return;
    const band = this.fan.steps;
    const order = band.order;
    const c = rgb01('#07100d');
    for (let i = 1; i < order.length; i++) {
      const v = commonSplit(order[i - 1], order[i]);
      if (!v) continue;
      const ys = this.knotsOnScreen(band.ys, this.fan.time.y(0), v.y);
      for (let k = 0; k + 1 < ys.length; k++) {
        const ya = ys[k];
        const yb = ys[k + 1];
        const [xa, sa] = this.toScreen(band.edgeAt(i, ya), ya);
        const [xb, sb] = this.toScreen(band.edgeAt(i, yb), yb);
        this.trap(this.gl.over, xa - 0.75, xa + 0.75, sa, xb - 0.75, xb + 0.75, sb, c, 1);
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
   * All straight lines (layout.ts): its slices of the parent columns, the jogs, its column; the
   * gray edge steps at the step lines on screen (Steps.lines), the width
   * constant between them. Off screen only the splits and the tip are
   * kept, whose chords stay off screen above or below it.
   */
  private drawStrand(b: FanBranch): void {
    const yb = this.fan.trunkBottom.y;
    const [, ayTip] = this.toScreen(0, b.tipY);
    const [, byBot] = this.toScreen(0, yb);
    if (byBot < 0 || ayTip > this.h) return;
    const hw = b.width / 2;
    const pts = this.lanePoints(b, hw);
    if (pts.length < 2) return;
    const ctx = this.ctx;
    // As the strands fade in (twigs.ts), the lanes dim to a backdrop under them: the same
    // lanes, the same geometry, never a switch.
    const tw = this.twigStats.get(b.sp.gid);
    // Under the mesh the lanes sink to a dark tint of themselves, so the individuals carry the colour:
    // each stretch by its own lanes' widths (twigs.ts laneDim), as the mesh draws them.
    const lives = tw?.fade ?? 0;
    const grayBase = b.sp.extinct ? WITHERED : GRAY;
    const greenFade = tw?.fadeGreen ?? 0;
    const greenC = mix(GREEN, '#0d2318', greenFade * 0.9);
    const yT0 = this.toScreen(0, b.splitY)[1];
    const grayC = mix(grayBase, '#131c19', Math.max(lives, tw?.texGray ?? 0) * 0.82);
    if (this.gl) {
      // Each stretch between knots is a trapezoid (every edge straight there): the whole lane
      // gray (at least 0.6 px), the green lane over its left edge (at least 1 px).
      const k = this.cam.sx;
      const gl = this.gl;
      for (let i = 0; i + 1 < pts.length; i++) {
        // (Bottom to top: p below, q above.)
        const p = pts[i];
        const q = pts[i + 1];
        if (!(p.w > 0 || q.w > 0)) continue;
        const pl = p.x - hw * k;
        const ql = q.x - hw * k;
        const wm = ((p.w + q.w) / 2) * k;
        const gp = p.w * p.f * k;
        const gq = q.w * q.f * k;
        const gm = (gp + gq) / 2;
        // (An extinct species' line ended: withered over its own column; below its split, its ancestors.)
        const base = b.sp.extinct && (p.y + q.y) / 2 < yT0 ? grayBase : GRAY;
        const gc = rgb01(mix(base, '#131c19', laneDim(wm - gm, lives) * 0.82));
        const ec = rgb01(mix(GREEN, '#0d2318', laneDim(gm, lives) * 0.9));
        this.trap(gl.under, ql, ql + q.w * k, q.y, pl, pl + p.w * k, p.y, gc, 1, 0.6);
        if (gp > 0 || gq > 0) {
          // The living glow faintly (fading as their lane resolves into individuals).
          const glow = 1 - lives;
          if (glow > 0.01) {
            this.trap(gl.under, ql - 4, ql + Math.max(1, gq) + 4, q.y, pl - 4, pl + Math.max(1, gp) + 4, p.y, ec, 0.06 * glow);
            this.trap(gl.under, ql - 1.5, ql + Math.max(1, gq) + 1.5, q.y, pl - 1.5, pl + Math.max(1, gp) + 1.5, p.y, ec, 0.14 * glow);
          }
          this.trap(gl.under, ql, ql + Math.max(gq > 0 ? 1 : 0, gq), q.y, pl, pl + Math.max(gp > 0 ? 1 : 0, gp), p.y, ec, 1);
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
    }
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
   * A branch's lanes as screen points, bottom to top, one per knot (layout.ts:
   * every edge is straight between two): the bottom of the world, the knots
   * on screen (and one beyond each edge) and the tip.
   */
  lanePoints(b: FanBranch, hw: number): RibbonPt[] {
    const yb = this.fan.trunkBottom.y;
    const ys = this.knotsOnScreen(this.fan.steps.bounds(b), b.tipY, yb);
    const pts: RibbonPt[] = [];
    for (let i = ys.length - 1; i >= 0; i--) {
      const y = ys[i];
      const L = laneAt(b, y);
      const [px, py] = this.toScreen(leftAt(b, y) + hw, y);
      pts.push({ x: px, y: py, nx: -1, ny: 0, w: L.w, f: L.f });
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
  /** The last frame's label spots (scripts, tests). */
  lastSpots: LabelSpot[] = [];

  private drawLabels(spots: LabelSpot[]): void {
    this.lastSpots = spots;
    const ctx = this.ctx;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.labelT));
    this.labelT = now;
    const prev = new Map<number, boolean>();
    for (const [gid, st] of this.labelState) prev.set(gid, st.on);
    const on = resolveLabels(spots, prev);
    let moving = false;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(LABEL_FONT);
    for (const s of spots) {
      const gid = s.b.sp.gid;
      const want = on.get(gid) ? 1 : 0;
      let st = this.labelState.get(gid);
      if (!st) this.labelState.set(gid, (st = { on: want === 1, a: want }));
      st.on = want === 1;
      if (st.a !== want) {
        const step = dt / LABEL_FADE_MS;
        st.a = want > st.a ? Math.min(want, st.a + step) : Math.max(want, st.a - step);
        moving = true;
      }
      const alpha = st.a * s.fit;
      const [x0, y0, x1, y1] = s.box;
      if (alpha < 0.01 || x1 < 0 || x0 > this.w || y1 < 0 || y0 > this.h) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(12,23,20,0.8)';
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, LABEL_PILL / 2);
      ctx.fill();
      // Upright, reading up the column.
      ctx.save();
      ctx.translate(s.x, y1 - LABEL_PAD);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = s.b.sp.extinct ? '#cfc4b1' : INK;
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
      return { px, label: `${formatCount(n)} ${n === 1 ? 'individual' : 'individuals'}` };
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
      const label = now ? 'now' : p.yrs === origin ? `${formatTick(origin, 0)}, Panthera begins` : formatTick(p.yrs, p.step);
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
      [`~${formatCount(f.clade.ever)} born in total (model, grade ${f.clade.grade})`, font('500 13px'), INK2],
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
  return `${Number(v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d })} ${unit}`;
}

/** Mix two #rrggbb colours: t = 0 gives a, 1 gives b (#rrggbb). */
function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
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
