// The fan view: one polytomy drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. The fan is a
// handful of curves, and the individuals inside a leaf are limited to what is
// visible (see mesh.ts), so Canvas 2D is enough and keeps the code small.
// Gestures come from the shared engine/input.ts.

import { formatCount } from '../data/names';
import { Input, type InputHandlers } from '../engine/input';
import { bezier, bezierTangent, layoutFan, widthAt, type Fan, type FanBranch, type WidthMode } from './layout';
import { drawMeshLeaf, drawPlainLeaf, worldToLocal, type MeshStats, type SelectedInd } from './leafdraw';
import { LeafMesh } from './leafmesh';
import type { CladeRec, SpeciesRec } from './panthera';

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

export interface Selection {
  sp: SpeciesRec;
  ind?: IndInfo;
}

export const GREEN = '#33bd66';
export const GRAY = '#676e75';
export const BG = '#0d1411';
const WITHERED = '#6d675c';

export interface Camera {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /** Pixels per world unit (same on both axes). */
  s: number;
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
  selInd: SelectedInd | null = null;
  onSelect: (sel: Selection | null) => void = () => {};
  /** What each leaf's mesh drew last frame (HUD, tests). */
  meshStats = new Map<number, MeshStats>();
  private meshes = new WeakMap<FanBranch, LeafMesh>();
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

  get s(): number {
    return this.cam.s;
  }

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

  mesh(b: FanBranch): LeafMesh {
    let m = this.meshes.get(b);
    if (!m) {
      m = new LeafMesh(b.sp, b.shape);
      this.meshes.set(b, m);
    }
    return m;
  }

  flyToLeaf(b: FanBranch): void {
    const s = Math.min((this.h * 0.8) / b.shape.L, (this.w * 0.9) / b.shape.W);
    this.flyTo({ cx: b.leaf.x, cy: b.leaf.y, s });
  }

  /** Leaf on screen length in px. */
  leafPx(b: FanBranch): number {
    return b.shape.L * this.cam.s;
  }

  hitLeaf(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    const slop = 14 / this.cam.s;
    let best: FanBranch | null = null;
    let bd = Infinity;
    for (const b of this.fan.branches) {
      const p = worldToLocal(b, wx, wy);
      const y = Math.min(b.shape.L, Math.max(0, p.y));
      const dy = Math.abs(p.y - y);
      const dx = Math.max(0, Math.abs(p.x) - b.shape.width(y) / 2);
      const d = Math.hypot(dx, dy);
      if (d <= slop && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Details of one individual for the tap card. */
  indInfo(b: FanBranch, g: number, i: number): IndInfo {
    const m = this.mesh(b);
    const sp = m.sp;
    const a = { generation: g, index: BigInt(i) };
    const at = sp.attributes(a);
    const end = m.G * sp.generationYears;
    return {
      handle: sp.handle(a),
      g,
      i,
      G: m.G,
      sex: at.sex,
      bornYearsAgo: end - at.birthTime + b.sp.t1 * 1e6,
      lifespan: at.lifespan,
      alive: at.alive,
      parents: sp.parents(a).map((p) => ({ handle: sp.handle(p), alive: m.alive(p.generation, Number(p.index)) })),
      children: Number(sp.children(a).count),
    };
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
      const zoomedIn = this.leafPx(b) > this.h * 0.6;
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
    this.selInd = null;
    let ind: IndInfo | undefined;
    const st = b && this.meshStats.get(b.sp.gid);
    if (b && st && st.mode !== 'texture' && st.mode !== 'stripes') {
      const [wx, wy] = this.toWorld(x, y);
      const a = this.mesh(b).hit(worldToLocal(b, wx, wy));
      if (a) {
        this.selInd = { g: a.generation, i: Number(a.index) };
        ind = this.indInfo(b, this.selInd.g, this.selInd.i);
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
    this.drawTrunk();
    for (const b of this.fan.branches) this.drawBranch(b);
    for (const b of this.fan.branches) this.drawLeaf(b);
    for (const b of this.fan.branches) this.drawLeafLabel(b);
    this.drawTrunkLabel();
    this.drawHud();
  }

  /** When zoomed into a leaf: which species and which generations are on screen. */
  private drawHud(): void {
    let best: FanBranch | null = null;
    for (const b of this.fan.branches) {
      if (this.meshStats.has(b.sp.gid) && (!best || this.leafPx(b) > this.leafPx(best))) best = b;
    }
    if (!best) return;
    const st = this.meshStats.get(best.sp.gid)!;
    const m = this.mesh(best);
    const ctx = this.ctx;
    const GL = m.sp.generationYears;
    const ago = (g: number) => formatYearsAgo((m.G - g) * GL + best!.sp.t1 * 1e6);
    const gens = st.g0 === st.g1 ? `generation ${fmtInt(st.g0 + 1)}` : `generations ${fmtInt(st.g0 + 1)}–${fmtInt(st.g1 + 1)}`;
    const lines = [
      `${best.sp.common}${best.sp.extinct ? ' (extinct)' : ''}`,
      `${gens} of ${fmtInt(m.G)}`,
      st.g0 === st.g1 ? `born ~${ago(st.g0)}` : `born ~${ago(st.g0)} to ~${ago(st.g1)}`,
      `${fmtInt(m.size(st.g0))} per generation · ${st.mode}`,
    ];
    ctx.save();
    ctx.font = `600 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    ctx.fillStyle = 'rgba(20,28,24,0.82)';
    ctx.beginPath();
    ctx.roundRect(10, 10, Math.min(this.w - 20, wmax), 80, 8);
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#eef4ef';
    ctx.fillText(lines[0], 20, 17);
    ctx.font = `12px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = '#b5c0b9';
    for (let k = 1; k < lines.length; k++) ctx.fillText(lines[k], 20, 20 + 16 * k);
    ctx.restore();
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

  private drawLeaf(b: FanBranch): void {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(b.leaf.x, b.leaf.y);
    const r = b.leafR * this.cam.s;
    if (cx + r < 0 || cx - r > this.w || cy + r < 0 || cy - r > this.h) {
      this.meshStats.delete(b.sp.gid);
      return;
    }
    const mesh = this.mesh(b);
    if (this.leafPx(b) < 160) {
      this.meshStats.delete(b.sp.gid);
      drawPlainLeaf(this, b, mesh);
    } else {
      const st = drawMeshLeaf(this, b, mesh, this.selected === b.sp ? this.selInd : null);
      if (st) this.meshStats.set(b.sp.gid, st);
      else this.meshStats.delete(b.sp.gid);
    }
    if (this.selected === b.sp && !this.selInd) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,240,234,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawLeafLabel(b: FanBranch): void {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(b.leaf.x, b.leaf.y);
    const r = b.leafR * this.cam.s;
    if (this.leafPx(b) >= 160) return; // Zoomed into the leaf: the HUD names it.
    const name = b.sp.common;
    const sub = `${formatCount(b.sp.ever)} ever${b.sp.extinct ? ' · extinct' : ''}`;
    ctx.save();
    ctx.textBaseline = 'middle';
    const fs = Math.max(11, Math.min(18, r * 0.5));
    ctx.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    {
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

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatYearsAgo(y: number): string {
  if (y < 1) return 'now';
  if (y < 1e4) return `${fmtInt(y)} years ago`;
  if (y < 1e6) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} thousand years ago`;
  return `${(y / 1e6).toFixed(2)} million years ago`;
}
