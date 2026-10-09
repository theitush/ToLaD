// The fan view: one polytomy drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. The fan is a
// handful of curves, and the individuals inside a leaf are limited to what is
// visible (see mesh.ts), so Canvas 2D is enough and keeps the code small.
// Gestures come from the shared engine/input.ts.

import { formatCount } from '../data/names';
import { Input, type InputHandlers } from '../engine/input';
import { bezier, bezierTangent, layoutFan, widthAt, type Fan, type FanBranch, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';

export const GREEN = '#33bd66';
export const GRAY = '#676e75';
export const BG = '#0d1411';
const WITHERED = '#6d675c';
const WITHERED_EDGE = '#8a8170';
const LEAF_DEAD = '#59606a';

export interface Camera {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /** Pixels per world unit (same on both axes). */
  s: number;
}

export interface LeafPainter {
  /** Draw a leaf's inside. Return true if it drew something (the plain leaf is skipped). */
  paint(ctx: CanvasRenderingContext2D, b: FanBranch, view: FanView): boolean;
}

export class FanView implements InputHandlers {
  readonly ctx: CanvasRenderingContext2D;
  readonly input: Input;
  cam: Camera = { cx: 0, cy: 0, s: 1 };
  fan: Fan;
  mode: WidthMode = 'log';
  w = 1;
  h = 1;
  dpr = 1;
  selected: SpeciesRec | null = null;
  onSelect: (sp: SpeciesRec | null) => void = () => {};
  leafPainter: LeafPainter | null = null;
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
    this.input = new Input(canvas, this);
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

  /** The whole fan, trunk entering from the bottom edge. */
  homeCamera(): Camera {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    for (const b of this.fan.branches) {
      x0 = Math.min(x0, b.leaf.x - b.leafR);
      x1 = Math.max(x1, b.leaf.x + b.leafR);
      y0 = Math.min(y0, b.leaf.y - b.leafR);
    }
    // Room for the radial labels (they have a fixed pixel size).
    const s = Math.min((this.w - 140) / (x1 - x0), (this.h - 230) / (120 - y0));
    y0 -= 130 / s;
    return { cx: (x0 + x1) / 2, cy: y0 + this.h / 2 / s, s };
  }

  setMode(mode: WidthMode): void {
    this.mode = mode;
    this.fan = layoutFan(this.clade, mode);
    this.request();
  }

  resetView(): void {
    this.flyTo(this.homeCamera());
  }

  // ---- camera helpers -------------------------------------------------------

  toScreen(x: number, y: number): [number, number] {
    const c = this.cam;
    return [(x - c.cx) * c.s + this.w / 2, (y - c.cy) * c.s + this.h / 2];
  }

  toWorld(px: number, py: number): [number, number] {
    const c = this.cam;
    return [c.cx + (px - this.w / 2) / c.s, c.cy + (py - this.h / 2) / c.s];
  }

  /** Zoom about a screen point by factor f. */
  zoomAbout(px: number, py: number, f: number): void {
    const [wx, wy] = this.toWorld(px, py);
    const s = Math.min(1e12, Math.max(this.homeCamera().s * 0.3, this.cam.s * f));
    this.cam.s = s;
    this.cam.cx = wx - (px - this.w / 2) / s;
    this.cam.cy = wy - (py - this.h / 2) / s;
  }

  flyTo(to: Camera, ms = 650): void {
    const from = { ...this.cam };
    const t0 = performance.now();
    const ls0 = Math.log(from.s);
    const ls1 = Math.log(to.s);
    this.anim = (now) => {
      const u = Math.min(1, (now - t0) / ms);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const s = Math.exp(ls0 + (ls1 - ls0) * e);
      // Interpolate the centre so it moves at constant screen speed in log-zoom.
      const k = ls1 === ls0 ? e : (1 / from.s - 1 / s) / (1 / from.s - 1 / to.s);
      this.cam = { s, cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k };
      return u < 1;
    };
    this.request();
  }

  flyToLeaf(b: FanBranch): void {
    const r = b.leafR * 1.15;
    this.flyTo({ cx: b.leaf.x, cy: b.leaf.y, s: Math.min(this.w, this.h) / (2 * r) });
  }

  hitLeaf(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    let best: FanBranch | null = null;
    let bd = Infinity;
    for (const b of this.fan.branches) {
      const d = Math.hypot(wx - b.leaf.x, wy - b.leaf.y);
      const slop = Math.max(b.leafR, 18 / this.cam.s);
      if (d < slop && d < bd) {
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
    this.cam.cx -= dx / this.cam.s;
    this.cam.cy -= dy / this.cam.s;
    this.request();
  }
  zoom(px: number, py: number, fx: number, ft: number): void {
    this.zoomAbout(px, py, fx !== 1 ? fx : ft);
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
      if (v.z) this.zoomAbout(v.px, v.py, Math.exp(v.z * dt));
      const d = Math.exp(-dt / 260);
      v.x *= d;
      v.y *= d;
      v.z *= d;
      return Math.abs(v.x) + Math.abs(v.y) > 0.01 || Math.abs(v.z) > 1e-5;
    };
    this.request();
  }
  doubleTap(x: number, y: number): void {
    const b = this.hitLeaf(x, y);
    if (b) {
      const zoomedIn = this.cam.s * b.leafR > Math.min(this.w, this.h) * 0.4;
      if (!zoomedIn) {
        this.flyToLeaf(b);
        return;
      }
    }
    const [wx, wy] = this.toWorld(x, y);
    const s = this.cam.s * 3;
    this.flyTo({ s, cx: wx - (x - this.w / 2) / s, cy: wy - (y - this.h / 2) / s });
  }
  tap(x: number, y: number): void {
    const b = this.hitLeaf(x, y);
    this.selected = b ? b.sp : null;
    this.onSelect(this.selected);
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
    this.drawTrunk();
    for (const b of this.fan.branches) this.drawBranch(b);
    for (const b of this.fan.branches) this.drawLeaf(b);
    for (const b of this.fan.branches) this.drawLeafLabel(b);
    this.drawTrunkLabel();
  }

  /** Fill a ribbon given its centre line and half-widths, from lane offset a to b (in [-0.5, 0.5] of width). */
  private ribbon(pts: { x: number; y: number; nx: number; ny: number; w: number }[], a: number, bOff: number, minPx = 0): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      const wpx = p.w * this.cam.s;
      const off = a * wpx;
      ctx[i ? 'lineTo' : 'moveTo'](sx + p.nx * off, sy + p.ny * off);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      const wpx = p.w * this.cam.s;
      const off = minPx >= 0 ? Math.max(bOff * wpx, a * wpx + minPx) : Math.min(bOff * wpx, a * wpx + minPx);
      ctx.lineTo(sx + p.nx * off, sy + p.ny * off);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** Two lanes: green on the left (floor 1 px if anything is alive), gray for the rest. */
  private lanes(pts: { x: number; y: number; nx: number; ny: number; w: number }[], f: number, extinct: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = extinct ? WITHERED : GRAY;
    this.ribbon(pts, -0.5, 0.5);
    if (f > 0) {
      // Offsets run along the left normal, so the green lane is [0.5 − f, 0.5].
      ctx.fillStyle = GREEN;
      this.ribbon(pts, 0.5, 0.5 - f, -1);
    }
  }

  private drawTrunk(): void {
    const f = this.fan;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const y = f.trunkBottom.y * (1 - i / 8);
      // Left normal of an upward branch is (-1, 0).
      pts.push({ x: 0, y, nx: -1, ny: 0, w: f.trunkWidth });
    }
    this.lanes(pts, f.trunkAliveFrac, false);
  }

  private drawBranch(b: FanBranch): void {
    const pts = [];
    const N = 36;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = bezier(b, t);
      const d = bezierTangent(b, t);
      pts.push({ x: p.x, y: p.y, nx: d.y, ny: -d.x, w: widthAt(b, t) });
    }
    this.lanes(pts, b.aliveFrac, b.sp.extinct);
  }

  private leafPath(b: FanBranch, cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (!b.sp.extinct) {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      return;
    }
    // Withered: shrunken, crinkled outline.
    const seed = b.sp.gid * 0.37;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const rr = r * (0.93 + 0.05 * Math.sin(7 * a + seed) + 0.03 * Math.sin(13 * a + 2 * seed));
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      ctx[i ? 'lineTo' : 'moveTo'](x, y);
    }
    ctx.closePath();
  }

  private drawLeaf(b: FanBranch): void {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(b.leaf.x, b.leaf.y);
    const r = b.leafR * this.cam.s;
    if (cx + r < 0 || cx - r > this.w || cy + r < 0 || cy - r > this.h) return;
    if (this.leafPainter && this.leafPainter.paint(ctx, b, this)) return;
    // Area = individuals ever. Living individuals are the outer rim (the mesh
    // puts the newest generation at the rim), so the rim is green, floored at
    // 2 px so it reads at fan scale; the dead fill the inside in gray.
    const rim = b.sp.extinct ? 0 : Math.max(2, r * (1 - Math.sqrt(1 - b.sp.alive / b.sp.ever)));
    this.leafPath(b, cx, cy, r);
    ctx.fillStyle = b.sp.extinct ? WITHERED : LEAF_DEAD;
    ctx.fill();
    if (b.sp.extinct) {
      ctx.strokeStyle = WITHERED_EDGE;
      ctx.lineWidth = 1;
      ctx.stroke();
      // A vein or two.
      ctx.beginPath();
      ctx.moveTo(cx - b.dir.x * r * 0.8, cy - b.dir.y * r * 0.8);
      ctx.lineTo(cx + b.dir.x * r * 0.7, cy + b.dir.y * r * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r - rim / 2), 0, Math.PI * 2);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = rim;
      ctx.stroke();
    }
    if (this.selected === b.sp) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#e8f0ea';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawLeafLabel(b: FanBranch): void {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(b.leaf.x, b.leaf.y);
    const r = b.leafR * this.cam.s;
    const big = r > Math.min(this.w, this.h) * 0.25;
    if (big) return; // Zoomed into the leaf: the leaf view labels itself.
    const name = b.sp.common;
    const sub = `${formatCount(b.sp.ever)} ever${b.sp.extinct ? ' · extinct' : ''}`;
    ctx.save();
    ctx.textBaseline = 'middle';
    const fs = Math.max(11, Math.min(18, r * 0.5));
    ctx.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const nameW = ctx.measureText(name).width;
    if (nameW < r * 1.75 && r > 26) {
      // Inside the leaf.
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2f6f3';
      ctx.fillText(name, cx, cy - fs * 0.35);
      ctx.font = `${fs * 0.7}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      ctx.fillStyle = '#c9d3cc';
      ctx.fillText(sub, cx, cy + fs * 0.6, r * 1.8);
    } else {
      // Radial, outward from the leaf, upright on both sides.
      const a = Math.atan2(b.dir.y, b.dir.x);
      const left = b.dir.x < 0;
      ctx.translate(cx + b.dir.x * (r + 5), cy + b.dir.y * (r + 5));
      ctx.rotate(left ? a + Math.PI : a);
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillStyle = b.sp.extinct ? '#b9b3a6' : '#eef4ef';
      ctx.shadowColor = BG;
      ctx.shadowBlur = 3;
      ctx.fillText(name, 0, -fs * 0.32);
      ctx.font = `${fs * 0.72}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      ctx.fillStyle = '#9faba3';
      ctx.fillText(sub, 0, fs * 0.55);
    }
    ctx.restore();
  }

  private drawTrunkLabel(): void {
    const ctx = this.ctx;
    const f = this.fan;
    const [sx, sy] = this.toScreen(-f.trunkWidth / 2, 60);
    if (sy > this.h + 20 || sy < -80) return;
    const font = (w: string, px: number) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    const x = sx - 10;
    ctx.font = font('600', 15);
    ctx.fillStyle = '#eef4ef';
    ctx.fillText(f.clade.common, x, sy);
    ctx.font = font('italic 400', 12);
    ctx.fillStyle = '#9faba3';
    ctx.fillText(f.clade.sci, x, sy + 19);
    ctx.font = font('400', 12);
    ctx.fillText(`${formatCount(f.clade.ever)} ever`, x, sy + 37);
    ctx.fillStyle = GREEN;
    ctx.fillText(`${formatCount(f.clade.alive)} alive`, x, sy + 53);
    ctx.restore();
  }
}
