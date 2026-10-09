// The fan view: one polytomy drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { formatAge, formatCount } from '../data/names';
import { Input, type InputHandlers } from '../engine/input';
import { bezier, bezierTangent, layoutFan, strandAt, type Fan, type FanBranch, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { drawTwigs, TwigModel, type IndInfo, type TwigStats } from './twigs';

export type { IndInfo } from './twigs';

export const GREEN = '#33bd66';
export const GRAY = '#676e75';
export const BG = '#0d1411';
const WITHERED = '#6d675c';

export interface Camera {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /**
   * Pixels per world unit, per axis: width (x) and time (y) zoom separately,
   * because a linear-width branch is ~10^10 times thinner than it is tall.
   */
  sx: number;
  sy: number;
}

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
  cam: Camera = { cx: 0, cy: 0, sx: 1, sy: 1 };
  fan: Fan;
  mode: WidthMode = 'linear';
  w = 1;
  h = 1;
  dpr = 1;
  selected: SpeciesRec | null = null;
  selInd: { g: number; i: number } | null = null;
  onSelect: (sel: Selection | null) => void = () => {};
  /** What each branch's individuals view drew last frame (HUD, tests). */
  twigStats = new Map<number, TwigStats>();
  private models = new Map<string, TwigModel>();
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
    this.fan = layoutFan(clade, this.mode);
    this.input = new Input(canvas, this, true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.cam = this.homeCamera();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    this.ro.disconnect();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const first = this.w === 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (first) this.cam = this.homeCamera();
    this.request();
  }

  /** The whole fan: "now" near the top, the stem entering from the bottom edge. */
  homeCamera(): Camera {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const b of this.fan.branches) {
      x0 = Math.min(x0, b.colX - b.width);
      x1 = Math.max(x1, b.colX + b.width);
    }
    const y0 = this.fan.time.y(0);
    // Pixel margins: time labels on the left, species labels above "now", some stem below the fork.
    const left = 58;
    const right = 14;
    const top = 120;
    const bottom = 110;
    const s = Math.min((this.w - left - right) / (x1 - x0), (this.h - top - bottom) / -y0);
    const cx = (x0 + x1) / 2 - (left - right) / 2 / s;
    return { cx, cy: y0 + (this.h / 2 - top) / s, sx: s, sy: s };
  }

  setMode(mode: WidthMode): void {
    this.mode = mode;
    this.fan = layoutFan(this.clade, mode);
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
    const c = this.cam;
    return [(x - c.cx) * c.sx + this.w / 2, (y - c.cy) * c.sy + this.h / 2];
  }

  toWorld(px: number, py: number): [number, number] {
    const c = this.cam;
    return [c.cx + (px - this.w / 2) / c.sx, c.cy + (py - this.h / 2) / c.sy];
  }

  /** Zoom about a screen point by factors fx (width) and fy (time). */
  zoomAbout(px: number, py: number, fx: number, fy = fx): void {
    const [wx, wy] = this.toWorld(px, py);
    const h = this.homeCamera().sx * 0.3;
    this.cam.sx = Math.min(1e15, Math.max(h, this.cam.sx * fx));
    this.cam.sy = Math.min(1e9, Math.max(h, this.cam.sy * fy));
    this.cam.cx = wx - (px - this.w / 2) / this.cam.sx;
    this.cam.cy = wy - (py - this.h / 2) / this.cam.sy;
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
      const [sy, cy] = axis(from.sy, to.sy, from.cy, to.cy, e);
      this.cam = { sx, sy, cx, cy };
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
      if (wy > b.p3.y + slopY || wy < b.tipY - slopY) continue;
      const age = this.fan.time.ageAt(Math.min(b.p3.y, Math.max(b.tipY, wy)));
      const half = strandAt(b, age, this.mode).w / 2;
      const d = Math.max(0, Math.abs(wx - b.colX) - half);
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
    this.cam.cx -= dx / this.cam.sx;
    this.cam.cy -= dy / this.cam.sy;
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
    let cx = wx - (x - this.w / 2) / sx;
    if (b) {
      const age = this.fan.time.ageAt(Math.min(b.p3.y, Math.max(b.tipY, wy)));
      const wpx = strandAt(b, age, this.mode).w * this.cam.sx;
      const frame = (this.w * 0.6) / Math.max(1e-300, strandAt(b, age, this.mode).w);
      if (wpx < this.w * 0.45) {
        sx = frame;
        sy = this.cam.sy * 2;
        cx = b.colX;
      } else {
        sx = this.cam.sx * 16;
        sy = this.cam.sy * 2;
        cx = wx - (x - this.w / 2) / sx;
      }
    }
    sx = Math.min(1e15, sx);
    sy = Math.min(1e9, sy);
    this.flyTo({ sx, sy, cx, cy: wy - (y - this.h / 2) / sy });
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
    for (const b of this.fan.branches) this.drawLabel(b);
    this.drawTrunkLabel();
    this.drawHud();
    this.drawTimeAxis(true);
  }

  /** Fill a ribbon between lane offsets a(p) and b(p) (fractions of the width along the left normal). */
  private ribbon(pts: RibbonPt[], a: (p: RibbonPt) => number, bOff: (p: RibbonPt) => number, minPx = 0): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      const off = a(p) * p.w * this.cam.sx;
      ctx[i ? 'lineTo' : 'moveTo'](sx + p.nx * off, sy + p.ny * off);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      const wpx = p.w * this.cam.sx;
      const ao = a(p) * wpx;
      const bo = bOff(p) * wpx;
      const off = minPx >= 0 ? Math.max(bo, ao + minPx) : Math.min(bo, ao + minPx);
      ctx.lineTo(sx + p.nx * off, sy + p.ny * off);
    }
    ctx.closePath();
    ctx.fill();
  }

  /**
   * One species' strand bundle, drawn whole from the bottom of the parent stem
   * through the fork, out to its column and up through time to its tip. The
   * stem is just its children's strands side by side (in branch order, widths
   * adding up to the stem's width), so each green lane runs unbroken from the
   * tip to the root. The same rule nests for a deeper tree.
   */
  private drawStrand(b: FanBranch): void {
    const yb = this.fan.trunkBottom.y;
    const [ax, ay] = this.toScreen(Math.min(b.p0.x, b.colX) - b.width, b.tipY);
    const [bx, by] = this.toScreen(Math.max(b.p0.x, b.colX) + b.width, yb);
    if (bx < 0 || ax > this.w || by < 0 || ay > this.h) return;
    const time = this.fan.time;
    const at = (y: number) => strandAt(b, time.ageAt(y), this.mode);
    const pts: RibbonPt[] = [];
    // Stem part, straight up to the fork. Left normal of an upward strand is (-1, 0).
    const base = at(0);
    for (let i = 0; i < 4; i++) pts.push({ x: b.p0.x, y: yb * (1 - i / 4), nx: -1, ny: 0, w: base.w, f: base.f });
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = bezier(b, t);
      const d = bezierTangent(b, t);
      const st = at(p.y);
      pts.push({ x: p.x, y: p.y, nx: d.y, ny: -d.x, w: st.w, f: st.f });
    }
    // Column: sample the visible part finely (the taper follows log time).
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const ya = Math.min(b.p3.y, sBot);
    const yt = Math.max(b.tipY, sTop);
    if (ya > yt) {
      if (ya < b.p3.y) pts.push({ x: b.colX, y: ya, nx: -1, ny: 0, ...at(ya) });
      const M = 80;
      for (let i = 1; i <= M; i++) {
        const y = ya + ((yt - ya) * i) / M;
        pts.push({ x: b.colX, y, nx: -1, ny: 0, ...at(y) });
      }
      if (yt > b.tipY) pts.push({ x: b.colX, y: b.tipY, nx: -1, ny: 0, ...at(b.tipY) });
    }
    // Keep only points within a screen of the viewport: canvas paths with
    // coordinates far beyond the screen (deep zoom) are not drawn reliably.
    const mY = this.h / this.cam.sy;
    const mX = (4 * this.w) / this.cam.sx;
    const [sLeft] = this.toWorld(0, 0);
    const [sRight] = this.toWorld(this.w, 0);
    const kept = pts.filter((p) => p.y >= sTop - mY && p.y <= sBot + mY && p.x >= sLeft - mX && p.x <= sRight + mX);
    pts.length = 0;
    pts.push(...kept);
    if (pts.length < 2) return;
    const ctx = this.ctx;
    // When the individuals are drawn, they are the truth: the bundle becomes a dim backdrop.
    const tw = this.twigStats.get(b.sp.gid);
    const backdrop = !!tw && tw.mode !== 'texture';
    ctx.fillStyle = backdrop ? '#1c2521' : b.sp.extinct ? WITHERED : GRAY;
    this.ribbon(pts, () => -0.5, () => 0.5, 0.6);
    if (!b.sp.extinct && !backdrop) {
      // Green lane on the left, floored at 1 px all the way from the tip to the root.
      ctx.fillStyle = GREEN;
      this.ribbon(pts, () => 0.5, (p) => 0.5 - p.f, -1);
    }
    if (this.selected === b.sp && !this.selInd) {
      const [tx, ty] = this.toScreen(b.colX, b.tipY);
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,240,234,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawIndividuals(b: FanBranch): void {
    const st = drawTwigs(this, b, this.model(b), this.selected === b.sp ? this.selInd : null);
    const prev = this.twigStats.get(b.sp.gid);
    // The bundle under the twigs depends on the mode: redraw once when it changes.
    if ((prev?.mode ?? null) !== (st?.mode ?? null)) this.request();
    if (st) this.twigStats.set(b.sp.gid, st);
    else this.twigStats.delete(b.sp.gid);
  }

  private drawLabel(b: FanBranch): void {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(b.colX, b.tipY);
    if (cx < -30 || cx > this.w + 30 || cy < -10 || cy > this.h + 200) return;
    if (this.twigStats.has(b.sp.gid)) return; // Zoomed into the individuals: the HUD names it.
    const name = b.sp.common;
    const sub = `${formatCount(b.sp.ever)} ever${b.sp.extinct ? ` · extinct ${formatAge(b.sp.t1)}` : ''}`;
    const fs = 15;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
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

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatYearsAgo(y: number): string {
  if (y < 1) return 'under a year ago';
  if (y < 1e4) return `${fmtInt(y)} years ago`;
  if (y < 999500) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} thousand years ago`;
  return `${(y / 1e6).toFixed(2)} million years ago`;
}
