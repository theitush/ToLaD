// The fan view: one polytomy drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { formatAge, formatCount } from '../data/names';
import { Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, STRAND_PX, type Camera } from './camera';
import { EDGE_DASH, edgeMarks, edgeXAt, dotAlphas, GRADE_COLOR, historySpans, pointAgo, toScreenSpans, type ScreenSpan, type Span } from './history';
import { JOG, laneAt, layoutFan, leftAt, Steps, strandAt, type Fan, type FanBranch, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { drawTwigs, TwigModel, type IndInfo, type TwigStats } from './twigs';

export type { IndInfo } from './twigs';
export type { Camera } from './camera';

export const GREEN = '#33bd66';
export const GRAY = '#676e75';
export const BG = '#0d1411';
const WITHERED = '#6d675c';
/** Least distance (px) between the labels of tips that end side by side. */
const LABEL_PX = 30;

export interface Selection {
  sp: SpeciesRec;
  ind?: IndInfo;
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
  onSelect: (sel: Selection | null) => void = () => {};
  /** The width scale bar (a DOM element above the legend / cards): its bar and label are set each frame. */
  scaleEl: HTMLElement | null = null;
  /** The buttons (a DOM element over the canvas): labels never go under them. */
  barEl: HTMLElement | null = null;
  private scaleKey = '';
  /** `?debug`: a readout of the zooms, years on screen and individuals per px. */
  readonly debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  /** What each branch's individuals view drew last frame (HUD, tests). */
  twigStats = new Map<number, TwigStats>();
  private models = new Map<string, TwigModel>();
  private spans = new Map<number, Span[]>();
  private raf = 0;
  private anim: ((t: number) => boolean) | null = null;
  private ro: ResizeObserver;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clade: CladeRec,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    this.ctx = ctx;
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
    for (const b of this.fan.branches) {
      if (wy > slopY || wy < b.tipY - slopY) continue;
      const yc = Math.min(0, Math.max(b.tipY, wy));
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
      const bw = laneAt(b, Math.min(0, Math.max(b.tipY, wy))).w;
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
        const L = m.lanes(wy);
        // The strand spacing of the lane under the finger.
        const cell = wx < L.left + L.gw ? L.gw / m.nLive : (L.w - L.gw) / m.size(g);
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
      const yc = Math.min(0, Math.max(b.tipY, wy));
      if (framing) cx = leftAt(b, yc) + laneAt(b, yc).w / 2;
      // In the green lane, land on a living strand rather than a vacant slot
      // (only about a third of the index slots hold someone alive).
      const m = this.model(b);
      const L = m.lanes(wy);
      const slotPx = (L.gw / m.nLive) * sx;
      if (wxT < L.left + L.gw && slotPx > 12) cx = m.nearestLiving(wxT, wy, Math.ceil(this.w / slotPx)) ?? cx;
    }
    this.flyTo({ sx, sy, ty: sy, cx, cy: wy - (y - this.h / 2) / sy });
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
    this.onSelect(b ? { sp: b.sp, ind } : null);
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

  draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawTimeAxis(false);
    for (const b of this.fan.branches) this.drawStrand(b);
    for (const b of this.fan.branches) this.drawIndividuals(b);
    // Labels: tips side by side (the living all end at "now", packed hairlines in
    // linear widths) are spread apart and joined to their tips by leader lines;
    // then by size, one that would still overlap a bigger species' label waits for a closer zoom.
    const lx = this.labelXs();
    const placed: number[][] = [];
    for (const b of [...this.fan.branches].sort((p, q) => q.sp.ever - p.sp.ever)) this.drawLabel(b, placed, lx.get(b));
    this.drawWidthScale();
    if (this.debug) this.drawDebug();
    this.drawTrunkLabel();
    this.drawHud();
    this.drawTimeAxis(true);
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
   * One species' strand bundle, drawn whole from the bottom of the parent stem
   * through the fork and up its column to its tip. The stem is just its
   * children's lanes side by side (widths adding up to the stem's width), so
   * each green lane runs unbroken from the tip to the root.
   *
   * All straight lines (layout.ts): the stem slice, the jog, the column; the
   * gray edge steps at the step lines on screen (Steps.lines), the width
   * constant between them. Off screen only the fork, the jog and the tip are
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
    ctx.fillStyle = mix(b.sp.extinct ? WITHERED : GRAY, '#1c2521', (tw?.fade ?? 0) * 0.85);
    this.ribbon(pts, (p) => hw - p.w, () => hw, 0.6);
    if (!b.sp.extinct) {
      // Green lane on the left, floored at 1 px all the way from the tip to the root.
      ctx.fillStyle = mix(GREEN, '#174a2b', (tw?.fadeGreen ?? 0) * 0.8);
      this.ribbon(pts, () => hw, (p) => hw - p.w * p.f, -1);
    }
    this.drawHistoryEdge(b, pts, hw, tw?.fade ?? 0);
    if (this.selected === b.sp && !this.selInd) {
      const [tx, ty] = this.toScreen(tipX(b, this.fan, this.mode), b.tipY);
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,240,234,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /**
   * A branch's lanes as screen points, bottom to top, two per stretch of
   * constant width (so the gray edge is vertical and horizontal segments):
   * breakpoints at the stem's end, the fork, the jog, the step lines on
   * screen (and one beyond each edge) and the tip.
   */
  lanePoints(b: FanBranch, hw: number): RibbonPt[] {
    const yb = this.fan.trunkBottom.y;
    const steps = this.fan.steps;
    const d = Steps.dy(steps.level);
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const ys = new Set<number>([yb, 0, -JOG, b.tipY]);
    for (const y of steps.lines(b, sTop - d, sBot + d) ?? []) ys.add(y);
    if (sBot < yb && sBot > 0) ys.add(sBot);
    const sorted = [...ys].filter((y) => y >= b.tipY && y <= yb).sort((p, q) => q - p);
    // Spine at left + hw: the ribbon spans offsets [hw - w, hw] to its left (nx = -1).
    const pts: RibbonPt[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const y0 = sorted[i];
      const y1 = sorted[i + 1];
      // Constant width between breakpoints: the lanes at the middle.
      const L = laneAt(b, (y0 + y1) / 2);
      for (const y of [y0, y1]) {
        const [px, py] = this.toScreen(leftAt(b, y) + hw, y);
        pts.push({ x: px, y: py, nx: -1, ny: 0, w: L.w, f: L.f });
      }
    }
    return pts;
  }

  /**
   * How honestly a curated history knows the branch's outer (gray, right) edge:
   * spans backed by real points are left as drawn; interpolated or modelled
   * spans get a subtle dashed line on the edge, grade D or unverified ones a
   * fainter dotted line. The patterns are screen-space (edgeMarks), so they
   * look the same at every zoom. Then a dot at each data point's year, coloured
   * by grade, once the points are far enough apart not to clutter.
   * Only for histories that drive the counts: otherwise the edge isn't theirs.
   * The green lane is left plain: its width is the living now, one number.
   */
  private drawHistoryEdge(b: FanBranch, pts: RibbonPt[], hw: number, fade: number): void {
    const h = b.sp.history;
    if (!h || !b.sp.births) return;
    const sx = this.cam.sx;
    const n = pts.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = pts[i].x - (hw - pts[i].w) * sx;
      ys[i] = pts[i].y;
    }
    const sy = (agoYears: number) => this.toScreen(0, this.fan.time.y(agoYears / 1e6))[1];
    const ctx = this.ctx;
    const marks = edgeMarks(xs, ys, this.screenSpans(b, sy), sy(0), -10, this.h + 10);
    ctx.lineCap = 'butt';
    for (const style of ['dashed', 'dotted'] as const) {
      const d = EDGE_DASH[style];
      ctx.strokeStyle = `rgba(214,226,219,${d.alpha * (1 - 0.6 * fade)})`;
      ctx.lineWidth = d.lw;
      ctx.beginPath();
      for (const m of marks) {
        if (m.style !== style) continue;
        ctx.moveTo(m.x0, m.y0);
        ctx.lineTo(m.x1, m.y1);
      }
      ctx.stroke();
    }
    const pys = h.points.map((p) => sy(pointAgo(h, p.year)));
    const alphas = dotAlphas(pys);
    for (let k = 0; k < h.points.length; k++) {
      const y = pys[k];
      if (y < -6 || y > this.h + 6) continue;
      const x = edgeXAt(xs, ys, y);
      if (!Number.isFinite(x)) continue;
      // Not on a hairline: a dot needs a branch a few px wide to sit on.
      const wPx = strandAt(b, pointAgo(h, h.points[k].year) / 1e6, this.mode).w * sx;
      const a = alphas[k] * Math.max(0, Math.min(1, (wPx - 3) / 9));
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = GRADE_COLOR[h.points[k].grade] ?? '#ccc';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = BG;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The branch's history spans on screen (spans cached per species). */
  screenSpans(b: FanBranch, sy: (agoYears: number) => number): ScreenSpan[] {
    let spans = this.spans.get(b.sp.gid);
    if (!spans) this.spans.set(b.sp.gid, (spans = b.sp.history ? historySpans(b.sp.history) : []));
    return toScreenSpans(spans, sy);
  }

  private drawIndividuals(b: FanBranch): void {
    const st = drawTwigs(this, b, this.model(b), this.selected === b.sp ? this.selInd : null);
    const prev = this.twigStats.get(b.sp.gid);
    // The lanes under the strands depend on the fade: redraw once when it changes,
    // and keep drawing while lineage answers are still being worked out.
    if ((prev?.fade ?? 0) !== (st?.fade ?? 0) || (prev?.fadeGreen ?? 0) !== (st?.fadeGreen ?? 0) || st?.pending) this.request();
    if (st) this.twigStats.set(b.sp.gid, st);
    else this.twigStats.delete(b.sp.gid);
  }

  /**
   * Screen x of each label whose tip shares its height with others: in tip
   * order, at least LABEL_PX apart, as close to their tips as that allows and
   * kept on screen.
   */
  private labelXs(): Map<FanBranch, number> {
    const out = new Map<FanBranch, number>();
    const tips = this.fan.branches
      .map((b) => ({ b, p: this.toScreen(tipX(b, this.fan, this.mode), b.tipY) }))
      .filter(({ b, p }) => p[0] > -30 && p[0] < this.w + 30 && p[1] > -10 && p[1] < this.h + 200 && !this.twigStats.has(b.sp.gid));
    const groups = new Map<number, typeof tips>();
    for (const t of tips) {
      const k = Math.round(t.p[1] / 3);
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    const D = LABEL_PX;
    for (const g of groups.values()) {
      g.sort((a, c) => a.p[0] - c.p[0]);
      const x = g.map((t) => t.p[0]);
      // Spread apart about the group's middle, then keep on screen.
      for (let i = 1; i < x.length; i++) x[i] = Math.max(x[i], x[i - 1] + D);
      const shift = (x[x.length - 1] - g[g.length - 1].p[0]) / 2;
      for (let i = 0; i < x.length; i++) x[i] -= shift;
      for (let i = x.length - 2; i >= 0; i--) x[i] = Math.min(x[i], x[i + 1] - D);
      const lo = 14 - x[0];
      const hi = this.w - 14 - x[x.length - 1];
      const d = lo > 0 ? lo : hi < 0 ? hi : 0;
      g.forEach((t, i) => out.set(t.b, x[i] + d));
    }
    return out;
  }

  /** The buttons' box in canvas px [x0, y0, x1, y1], if any. */
  private barRect(): number[] | null {
    if (!this.barEl) return null;
    const r = this.barEl.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return [r.left - c.left, r.top - c.top, r.right - c.left, r.bottom - c.top];
  }

  private drawLabel(b: FanBranch, placed: number[][], lx?: number): void {
    const ctx = this.ctx;
    const [tx, ty] = this.toScreen(tipX(b, this.fan, this.mode), b.tipY);
    if (tx < -30 || tx > this.w + 30 || ty < -10 || ty > this.h + 200) return;
    if (this.twigStats.has(b.sp.gid)) return; // Zoomed into the individuals: the HUD names it.
    // Moved off its tip: a leader line from the tip up to the label.
    let lead = lx !== undefined && Math.abs(lx - tx) > 1.5 ? 14 : 0;
    const cx = lead ? lx! : tx;
    let cy = ty - lead;
    const name = b.sp.common;
    const sub = `${formatCount(b.sp.ever)} ever${b.sp.extinct ? ` · extinct ${formatAge(b.sp.t1)}` : ''}`;
    const fs = 15;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `${fs * 0.72}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const subLen = ctx.measureText(sub).width;
    ctx.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    // Screen box of the upright two-line label (x0, y0, x1, y1).
    const len = Math.max(subLen, ctx.measureText(name).width);
    // Kept on screen and clear of the buttons: pushed down (with a leader line) if needed.
    const bar = this.barRect();
    const under = bar && cx + 14 > bar[0] - 4 && cx - 13 < bar[2] + 4;
    const minTop = (under ? bar![3] : 0) + 6;
    if (cy - 8 - len < minTop) {
      const d = minTop - (cy - 8 - len);
      cy += d;
      lead += d;
    }
    const box = [cx - 13, cy - 8 - len, cx + 14, cy - 8];
    if (placed.some((q) => box[0] < q[2] + 2 && q[0] < box[2] + 2 && box[1] < q[3] + 2 && q[1] < box[3] + 2)) {
      ctx.restore();
      return;
    }
    placed.push(box);
    if (lead && Math.abs(cx - tx) > 1.5) {
      ctx.beginPath();
      ctx.moveTo(tx, ty - 2);
      ctx.lineTo(cx, cy - 4);
      ctx.strokeStyle = 'rgba(200,214,205,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Upright text running up from the tip.
    ctx.translate(cx, cy - 8);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = b.sp.extinct ? '#b9b3a6' : '#eef4ef';
    ctx.shadowColor = BG;
    ctx.shadowBlur = 3;
    ctx.fillText(name, 0, -fs * 0.32);
    ctx.font = `${fs * 0.72}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = '#9faba3';
    ctx.fillText(sub, 0, fs * 0.55);
    ctx.restore();
  }

  /**
   * The width scale, like a map's: a bar and how many individuals its width
   * holds at the current zoom (a round 1, 2 or 5 × 10^k). In log widths a
   * width is 1 + log10(individuals), so the bar is the width that multiplies
   * the individuals by 10 (or by 10^k, or by a factor, whichever fits).
   */
  widthScale(): { px: number; label: string } {
    const f = this.fan;
    const sumG = f.branches.reduce((a, b) => a + g1(b.sp.ever, this.mode), 0);
    const unitPx = (f.trunkWidth / sumG) * this.cam.sx; // px per individual (linear) or per decade (log)
    const target = 70;
    if (this.mode === 'linear') {
      const per = 1 / unitPx; // individuals per px
      const n = Math.max(1, niceStep(target * per));
      const px = n / per;
      return { px, label: `${n === 1 ? '1 individual' : `${formatCount(n)} individuals`}` };
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
    const sumG = this.fan.branches.reduce((a, b) => a + g1(b.sp.ever, this.mode), 0);
    const perPx = sumG / this.fan.trunkWidth / c.sx;
    const lines = [
      `width ×${(c.sx / h.sx).toPrecision(4)}  time ×${(c.sy / h.sy).toPrecision(4)} (asked ×${(c.ty / h.sy).toPrecision(3)})`,
      `screen ${formatYearsAgo(yrs).replace(' ago', '')} · top ${formatYearsAgo(Math.max(0, this.camera.years(yTop)))}`,
      `${this.mode === 'linear' ? `${perPx.toPrecision(3)} individuals/px` : `${perPx.toPrecision(3)} log units/px`} · steps L${this.fan.steps.k}+${this.fan.steps.t.toFixed(2)}`,
    ];
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `11px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = 'rgba(10,16,13,0.8)';
    ctx.fillRect(60, this.h * 0.5 - 4, this.w - 66, 46);
    ctx.fillStyle = '#ffd479';
    ctx.textBaseline = 'top';
    lines.forEach((l, k) => ctx.fillText(l, 64, this.h * 0.5 + k * 14));
    ctx.restore();
  }

  /** When zoomed into a species' individuals: which species and generations are on screen. */
  private drawHud(): void {
    let best: FanBranch | null = null;
    let bestN = -1;
    for (const b of this.fan.branches) {
      const st = this.twigStats.get(b.sp.gid);
      if (st && st.drawn > bestN) {
        best = b;
        bestN = st.drawn;
      }
    }
    if (!best) return;
    const st = this.twigStats.get(best.sp.gid)!;
    const m = this.model(best);
    const ctx = this.ctx;
    const gens = st.g0 === st.g1 ? `generation ${fmtInt(st.g0 + 1)}` : `generations ${fmtInt(st.g0 + 1)}–${fmtInt(st.g1 + 1)}`;
    const lines = [
      `${best.sp.common}${best.sp.extinct ? ' (extinct)' : ''}`,
      `${gens} of ${fmtInt(m.G)}`,
      `born ~${formatYearsAgo(m.bornAgo(st.g1))}${st.g0 === st.g1 ? '' : ` to ~${formatYearsAgo(m.bornAgo(st.g0))}`}`,
      `${fmtInt(m.size(st.g0))} per generation · ${st.mode}`,
    ];
    ctx.save();
    ctx.font = `600 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    ctx.fillStyle = 'rgba(20,28,24,0.82)';
    ctx.beginPath();
    ctx.roundRect(70, 54, Math.min(this.w - 80, wmax), 80, 8);
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#eef4ef';
    ctx.fillText(lines[0], 80, 61);
    ctx.font = `12px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = '#b5c0b9';
    for (let k = 1; k < lines.length; k++) ctx.fillText(lines[k], 80, 64 + 16 * k);
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
    const yrsAt = (py: number) => ts.ageAt(this.toWorld(0, py)[1]) * 1e6;
    const aTop = Math.min(origin, yrsAt(-10));
    const aBot = Math.min(origin, yrsAt(this.h + 10));
    const syOf = (yrs: number) => this.toScreen(0, ts.y(yrs / 1e6))[1];
    // Candidates in priority order: origin and now, round log ticks, then linear steps.
    const cands: { yrs: number; step: number }[] = [{ yrs: origin, step: 0 }, { yrs: 0, step: 0 }];
    for (const m of [1, 5, 2]) {
      for (let e = 7; e >= 0; e--) {
        const yrs = m * Math.pow(10, e);
        if (yrs < origin * 0.97 && yrs >= aTop && yrs <= aBot) cands.push({ yrs, step: yrs });
      }
    }
    const span = aBot - aTop;
    if (span > 0) {
      for (const div of [3, 6, 12]) {
        const step = niceStep(span / div);
        for (let k = Math.ceil(aTop / step); k * step <= aBot && k - Math.ceil(aTop / step) < 40; k++) {
          const yrs = k * step;
          if (yrs > 0 && yrs < origin * 0.97) cands.push({ yrs, step });
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
    ctx.font = `11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = BG;
    if (!labels) {
      // Grid lines go under the branches; the labels go on top of everything.
      for (const p of placed) {
        ctx.fillStyle = p.yrs === 0 ? 'rgba(51,189,102,0.35)' : 'rgba(220,235,225,0.07)';
        ctx.fillRect(0, Math.round(p.sy), this.w, 1);
      }
      ctx.restore();
      return;
    }
    for (const p of placed) {
      const now = p.yrs === 0;
      // A short tick at the edge, visible over the branches too.
      ctx.fillStyle = now ? '#7fd69e' : '#8d998f';
      ctx.fillRect(0, Math.round(p.sy), 4, 1);
      const label = now ? 'now' : p.yrs === origin ? `${formatTick(origin, 0)} (origin)` : formatTick(p.yrs, p.step);
      ctx.fillStyle = now ? '#7fd69e' : '#8d998f';
      ctx.strokeText(label, 6, p.sy - 7);
      ctx.fillText(label, 6, p.sy - 7);
    }
    if (syOf(0) < 0) {
      // "now" is above the screen: say how far.
      ctx.fillStyle = '#7fd69e';
      const label = `↑ now`;
      ctx.strokeText(label, 6, 14);
      ctx.fillText(label, 6, 14);
    }
    // Honest scale note under the axis labels.
    const oy = syOf(origin);
    if (oy > 0 && oy < this.h - 20) {
      ctx.fillStyle = '#6f7a72';
      ctx.fillText('time, log scale', 6, oy + 9);
    }
    ctx.restore();
  }

  private drawTrunkLabel(): void {
    const ctx = this.ctx;
    const f = this.fan;
    // Right of the stem, just below the fork (nothing else is drawn there).
    const [sx, sy] = this.toScreen(f.trunkWidth / 2, 0);
    if (sy > this.h + 20 || sy < -80 || sx > this.w) return;
    const font = (w: string, px: number) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const x = sx + 10;
    const y = sy + 6;
    ctx.font = font('600', 14);
    ctx.fillStyle = '#eef4ef';
    ctx.fillText(f.clade.common, x, y);
    ctx.font = font('italic 400', 12);
    ctx.fillStyle = '#9faba3';
    ctx.fillText(f.clade.sci, x, y + 18);
    ctx.font = font('400', 12);
    ctx.fillText(`${formatCount(f.clade.ever)} ever`, x, y + 33);
    ctx.fillStyle = GREEN;
    ctx.fillText(`${formatCount(f.clade.alive)} alive`, x, y + 48);
    ctx.restore();
  }

}


/** x of the middle of a branch's tip (branches are left-aligned). */
function tipX(b: FanBranch, _fan: Fan, _mode: WidthMode): number {
  return leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2;
}

/** Width units of n individuals: n (linear) or 1 + log10 n (log), as layout.ts g(). */
function g1(n: number, mode: WidthMode): number {
  if (!(n > 0)) return 0;
  return mode === 'linear' ? n : 1 + Math.max(0, Math.log10(n));
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
  const [div, unit] = yrs >= 1e6 ? [1e6, 'Mya'] : yrs >= 1e3 ? [1e3, 'kya'] : [1, 'yr ago'];
  const st = step > 0 ? step / div : yrs / div;
  const dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(st) + 1e-9)));
  const v = yrs / div;
  const d = step > 0 ? dec : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d })} ${unit}`;
}

/** Mix two #rrggbb colours: t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
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
