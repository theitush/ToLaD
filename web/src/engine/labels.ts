// Screen-space overlays drawn with SDF text: clade labels (with a budget and
// collision handling) and the time axis ("years ago" ticks plus the "now" line).
// Runs on the main thread once per rendered frame; the work is bounded by the
// candidate cap, not by the number of nodes in the tree.

import type { Camera } from './camera';
import type { Frame } from './frame';
import { RIVER_S, type Layout, type LNode } from './layout';
import type { SceneBuilder } from './scene';
import type { RGBA, TextBatch } from './text';

export interface LabelOptions {
  /** Display label of a node ('' = none). Called once per node and cached by the caller. */
  labelOf: (n: LNode) => string;
  /** Max labels on screen. */
  budget: number;
  /** Format an age in Ma for the axis, given the tick step in years. */
  formatAge: (ageMa: number, stepYears: number) => string;
}

interface Candidate {
  n: LNode;
  text: string;
  ox: number;
  kx: number;
  oy: number;
  kt: number;
  score: number;
}

interface Placed {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const WHITE: RGBA = [0.95, 0.97, 0.96, 1];
const DIM: RGBA = [0.78, 0.84, 0.8, 0.92];
const AXIS: RGBA = [0.66, 0.74, 0.7, 1];
const RAIL: RGBA = [0.02, 0.035, 0.03, 0.55];
const NOW: RGBA = [0.33, 0.85, 0.5, 0.9];
const MAX_CANDIDATES = 260;
export const AXIS_W = 52;
const TOP_CLEAR = 54;
const BOTTOM_CLEAR = 64;

export class LabelPlacer {
  private lastT = new Map<string, number>();
  private placed: Placed[] = [];
  private cands: Candidate[] = [];
  private e: [number, number] = [0, 1];
  /** Labels placed in the last frame (for tests / perf). */
  count = 0;

  constructor(
    readonly layout: Layout,
    readonly opts: LabelOptions,
  ) {}

  /** Place labels for the scene just built, and draw the time axis. */
  build(scene: SceneBuilder, cam: Camera, out: TextBatch, axis: boolean): void {
    out.reset();
    this.placed.length = 0;
    const W = cam.W;
    const H = cam.H;
    const axisW = axis ? AXIS_W : 0;
    if (axis) this.placed.push({ x0: 0, y0: 0, x1: axisW, y1: H });
    // Keep clear of the button bar and the legend.
    this.placed.push({ x0: 0, y0: 0, x1: W, y1: TOP_CLEAR });
    this.placed.push({ x0: 0, y0: H - BOTTOM_CLEAR, x1: W, y1: H });
    this.gather(scene, W, H);
    const cands = this.cands;
    cands.sort((a, b) => b.score - a.score);
    let n = 0;
    const nextT = new Map<string, number>();
    for (let i = 0; i < cands.length && n < this.opts.budget; i++) {
      const c = cands[i];
      if (this.place(c, W, H, axisW, out, nextT)) n++;
    }
    this.lastT = nextT;
    this.count = n;
    if (axis) this.axis(cam, out);
  }

  private gather(scene: SceneBuilder, W: number, H: number): void {
    const cands = this.cands;
    cands.length = 0;
    const seen = new Set<LNode>();
    const add = (n: LNode, ox: number, kx: number, oy: number, kt: number) => {
      if (kx < 9 || kt < 16) return;
      if (ox > W || ox + kx < 0 || oy < 0 || oy - kt > H) return;
      if (seen.has(n)) return;
      seen.add(n);
      const text = this.opts.labelOf(n);
      if (!text) return;
      const vw = Math.min(W, ox + kx) - Math.max(0, ox);
      const vh = Math.min(H, oy) - Math.max(0, oy - kt);
      cands.push({ n, text, ox, kx, oy, kt, score: vw * Math.sqrt(vh) });
    };
    for (const it of scene.nearList) add(it.n, it.f.ox, it.f.kx, it.f.oy, it.f.kt);
    for (const d of scene.draws) {
      const c = d.chunk;
      const f = d.f;
      const r = c.rel;
      for (let i = 0; i < c.nodes.length; i++) {
        const o = i * 4;
        const kx = f.kx * r[o + 1];
        const kt = f.kt * r[o + 3];
        if (kx < 9 || kt < 16) continue;
        add(c.nodes[i], f.ox + f.kx * r[o], kx, f.oy - f.kt * r[o + 2], kt);
      }
    }
    if (cands.length > MAX_CANDIDATES) {
      cands.sort((a, b) => b.score - a.score);
      cands.length = MAX_CANDIDATES;
    }
  }

  /** Screen x-extent of a node's band at own time T. */
  private span(c: Candidate, T: number): [number, number] {
    const e = this.layout.edgesAt(c.n, T, this.e);
    return [c.ox + c.kx * e[0], c.ox + c.kx * e[1]];
  }

  private place(c: Candidate, W: number, H: number, axisW: number, out: TextBatch, nextT: Map<string, number>): boolean {
    const Tlo = Math.max(0, (c.oy - H) / c.kt);
    const Thi = Math.min(1, c.oy / c.kt);
    if (Thi <= Tlo) return false;
    // Candidate times: the node's own samples in view, the view edges and the middle.
    const ts: number[] = [Tlo + (Thi - Tlo) * 0.04, (Tlo + Thi) / 2, Thi - (Thi - Tlo) * 0.04];
    const rv = c.n.rv;
    if (rv) {
      for (let k = 0; k < RIVER_S; k++) {
        const t = rv.T[rv.o + k];
        if (t > Tlo && t < Thi) ts.push(t);
      }
    }
    const prev = this.lastT.get(c.n.id);
    if (prev !== undefined && prev > Tlo && prev < Thi) ts.push(prev);
    let best = -1;
    let bestW = 0;
    let prevW = 0;
    const clampW = (T: number) => {
      const [a, b] = this.span(c, T);
      return Math.min(W, b) - Math.max(axisW, a);
    };
    for (const t of ts) {
      const w = clampW(t);
      if (w > bestW) {
        bestW = w;
        best = t;
      }
      if (t === prev) prevW = w;
    }
    // Hysteresis: keep last frame's spot while it is still nearly as good.
    if (prev !== undefined && prevW >= bestW * 0.8 && prevW > 0) best = prev;
    if (best < 0) return false;
    const [a, b] = this.span(c, best);
    const xl = Math.max(axisW, a);
    const xr = Math.min(W, b);
    const width = xr - xl;
    const y = c.oy - c.kt * best;
    const big = width > 220 && c.kt > 260;
    const size = big ? 15 : 12.5;
    const tw = out.width(c.text, size);
    const col = big ? WHITE : DIM;
    if (width >= tw + 8) {
      const cx = (xl + xr) / 2;
      const cy = Math.min(H - BOTTOM_CLEAR - size, Math.max(TOP_CLEAR + size, y));
      const r = { x0: cx - tw / 2 - 3, y0: cy - size * 0.75, x1: cx + tw / 2 + 3, y1: cy + size * 0.75 };
      if (!this.free(r)) return false;
      this.placed.push(r);
      out.text(c.text, cx, cy, size, col, { center: true });
      nextT.set(c.n.id, best);
      return true;
    }
    // Vertical, reading bottom-to-top, if the band is a tall thin river.
    const vs = Math.min(12, Math.max(9.5, width - 2));
    if (width < vs + 1) return false;
    const vtw = out.width(c.text, vs);
    const dT = (vtw / 2 + 4) / c.kt;
    if (best - dT < Tlo || best + dT > Thi) {
      // Shift the label inside the visible part of the band.
      best = Math.min(Thi - dT, Math.max(Tlo + dT, best));
      if (best - dT < Tlo) return false;
    }
    for (const t of [best - dT, best, best + dT]) {
      const [l, rr] = this.span(c, t);
      if (Math.min(W, rr) - Math.max(axisW, l) < vs + 1) return false;
    }
    const [l2, r2] = this.span(c, best);
    const cx = (Math.max(axisW, l2) + Math.min(W, r2)) / 2;
    const cy = c.oy - c.kt * best;
    const r = { x0: cx - vs * 0.75, y0: cy - vtw / 2 - 3, x1: cx + vs * 0.75, y1: cy + vtw / 2 + 3 };
    if (!this.free(r)) return false;
    this.placed.push(r);
    out.text(c.text, cx, cy, vs, DIM, { rot: true });
    nextT.set(c.n.id, best);
    return true;
  }

  private free(r: Placed): boolean {
    for (const p of this.placed) if (r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0) return false;
    return true;
  }

  /** "Years ago" tick rail on the left edge and the "now" line. */
  private axis(cam: Camera, out: TextBatch): void {
    const a = cam.anchor;
    const a0 = a.info.age0;
    const a1 = a.info.age1;
    if (a0 === undefined || a1 === undefined) return;
    const f: Frame = cam.f;
    const H = cam.H;
    const W = cam.W;
    const span = a0 - a1;
    const ageAt = (y: number) => a0 - ((f.oy - y) / f.kt) * span;
    const yAt = (age: number) => f.oy - (f.kt * (a0 - age)) / span;
    const top = ageAt(0);
    const bot = ageAt(H);
    out.rect(0, 0, AXIS_W, H, RAIL);
    const lo = Math.max(0, top);
    if (bot > lo) {
      const stepMa = niceStep((bot - lo) / Math.max(3, H / 95));
      const stepYears = stepMa * 1e6;
      const first = Math.ceil(lo / stepMa);
      for (let i = first; i * stepMa <= bot && i < first + 60; i++) {
        const age = i * stepMa;
        if (age <= 0) continue;
        const y = yAt(age);
        if (y < 14 || y > H - 4) continue;
        out.rect(AXIS_W - 7, y - 0.5, 7, 1, AXIS);
        out.text(this.opts.formatAge(age, stepYears), 4, y + 4, 10.5, AXIS, { halo: 0.25 });
      }
    }
    if (top <= 0) {
      const y = yAt(0);
      if (y >= -2 && y <= H + 2) {
        out.rect(0, y - 0.75, W, 1.5, NOW);
        out.text('now', 6, y - 6, 12, NOW, { halo: 0.3 });
      }
    }
    out.text('years ago', 4, H - 6, 9.5, [0.55, 0.62, 0.58, 0.9], { halo: 0.2 });
  }
}

/** 1, 2 or 5 × 10^k, at least `x`. */
export function niceStep(x: number): number {
  const e = Math.floor(Math.log10(x));
  const b = Math.pow(10, e);
  const m = x / b;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * b;
}
