// The fan's camera: a plain axis-aligned map from world to screen, with width
// (x) and time (y) scaled separately. It never rotates or shears: x on screen
// depends only on world x, y only on world y.
//
// One pinch zooms both axes by the same factor. Width can go ~10^12 deeper
// than time (a linear-width branch is that much thinner than it is tall), so
// time stops at a floor and width keeps going:
//   - time: the screen always spans at least MIN_YEARS. On the log axis that is
//     a limit that depends on height (near "now" a year is tall, deep in the
//     past it is tiny), so the camera keeps the time zoom the gestures asked for
//     (`ty`) and shows sy = min(ty, the 10-year limit there). Zooming back out
//     undoes a zoom-in exactly, and panning at the floor keeps ~10 years on screen.
//   - width, zooming in: up to ~STRAND_PX per strand of the thinnest lane, and
//     never so far that the strands under the finger lie flatter than MAX_SLOPE
//     (near "now" the dead's lane narrows to nothing within a few generations).
//   - zoom out: no further than the whole fan with a margin.
//   - pan: some of the fan always stays on screen.

import { strandAt, type Fan, type FanBranch, branchLeft } from './layout';

/** The visible time span never drops below this (years). */
export const MIN_YEARS = 10;
/** Width zoom stops when strands are this far apart (px): handles legible. */
export const STRAND_PX = 90;
/** Steepest on-screen lean (dx/dy) of the strands under the finger that zoom-in allows. */
export const MAX_SLOPE = 1.5;
/** Zoom out to this fraction of the home view at most. */
export const MIN_ZOOM = 0.75;
const SX_MAX = 1e14;
const TY_MAX = 1e9;

export interface Camera {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /** Pixels per world unit: width (x), and time (y) as shown. */
  sx: number;
  sy: number;
  /** Time zoom the gestures asked for; sy = min(ty, the MIN_YEARS limit at this height). */
  ty: number;
}

export interface CellModel {
  size(g: number): number;
  generationAt(y: number): number;
  readonly GL: number;
}

export class FanCamera {
  cam: Camera = { cx: 0, cy: 0, sx: 1, sy: 1, ty: 1 };
  w = 1;
  h = 1;

  constructor(
    public fan: Fan,
    public model: (b: FanBranch) => CellModel,
  ) {}

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

  /** World x extent of the fan. */
  extent(): [number, number] {
    let x0 = -this.fan.trunkWidth / 2;
    let x1 = this.fan.trunkWidth / 2;
    for (const b of this.fan.branches) {
      x0 = Math.min(x0, b.colX - b.width / 2);
      x1 = Math.max(x1, b.colX + b.width / 2);
    }
    return [x0, x1];
  }

  /** The whole fan: "now" near the top, the stem entering from the bottom edge. */
  home(): Camera {
    const [x0, x1] = this.extent();
    const y0 = this.yNow;
    // Pixel margins: time labels on the left, species labels above "now", some stem below the fork.
    const left = 58;
    const right = 14;
    const top = 120;
    const bottom = 150; // room for the clade label below the fork, above the legend
    // Width and time each fill the screen (a narrow fan is not stretched past its height).
    const sy = (this.h - top - bottom) / -y0;
    const sx = Math.min((this.w - left - right) / (x1 - x0), 4 * sy);
    const cx = (x0 + x1) / 2 - (left - right) / 2 / sx;
    return { cx, cy: y0 + (this.h / 2 - top) / sy, sx, sy, ty: sy };
  }

  /** Zoom-out bounds (px per world unit) for width and time. */
  minScale(): [number, number] {
    const h = this.home();
    return [h.sx * MIN_ZOOM, h.sy * MIN_ZOOM];
  }

  /**
   * Years before present at world y, continued above "now" at the rate it has
   * at "now" (so a span reaching past "now" still counts its screen height).
   */
  years(y: number): number {
    const t = this.fan.time;
    const yn = this.yNow;
    if (y >= yn) return t.ageAt(y) * 1e6;
    return -(yn - y) * t.yearsPerUnit(yn);
  }

  /** Years spanned by the screen with the anchor (world wy at screen py) and time zoom sy. */
  spanYears(wy: number, py: number, sy: number): number {
    return this.years(wy + (this.h - py) / sy) - this.years(wy - py / sy);
  }

  /** The largest time zoom ≤ ty that keeps MIN_YEARS on screen, anchored at (wy, py). */
  timeCap(wy: number, py: number, ty: number): number {
    if (this.spanYears(wy, py, ty) >= MIN_YEARS) return ty;
    let lo = Math.log(Math.min(ty, 1e-3));
    let hi = Math.log(ty);
    for (let k = 0; k < 64; k++) {
      const mid = (lo + hi) / 2;
      if (this.spanYears(wy, py, Math.exp(mid)) >= MIN_YEARS) lo = mid;
      else hi = mid;
    }
    return Math.exp(lo);
  }

  /** On-screen spacing cell (world) of the thinnest lane of a branch at height y. */
  cellAt(b: FanBranch, y: number): number {
    const t = this.fan.time;
    const m = this.model(b);
    const age = t.ageAt(y);
    const n = Math.max(1, m.size(m.generationAt(y)));
    const st = strandAt(b, age, this.fan.mode);
    const gw = st.w * st.f;
    // The dead's lane closes at the tip; size its cells a couple of generations below it.
    const stF = strandAt(b, Math.max(age, b.sp.t1 + (2 * m.GL) / 1e6), this.fan.mode);
    let cell = Infinity;
    if (gw > 0) cell = Math.min(cell, gw / n);
    if (stF.w - gw > 0) cell = Math.min(cell, (stF.w - gw) / n);
    return cell;
  }

  /** The deepest width zoom allowed at world point (wx, wy) with time zoom sy. */
  sxCap(wx: number, wy: number, sy: number): number {
    const bs = this.fan.branches;
    const span = bs.filter((b) => wy >= b.tipY && wy <= b.p3.y);
    let cell = Infinity;
    for (const b of span.length ? span : bs) cell = Math.min(cell, this.cellAt(b, Math.min(b.p3.y, Math.max(b.tipY, wy))));
    let cap = Math.min(SX_MAX, STRAND_PX / cell);
    // The dead's lane narrows going up, and its strands keep their share of it,
    // so they lean in proportion to how far across the lane they are.
    const t = this.fan.time;
    for (const b of span) {
      const st = strandAt(b, t.ageAt(wy), this.fan.mode);
      const left = branchLeft(b);
      const gw = st.w * st.f;
      if (wx < left + gw || wx > left + st.w) continue;
      const u = (wx - left - gw) / Math.max(1e-300, st.w - gw);
      const dy = 1 / sy;
      const wAt = (y: number) => strandAt(b, t.ageAt(y), this.fan.mode).w;
      const slope = (u * Math.abs(wAt(wy + dy) - wAt(wy - dy))) / (2 * dy);
      if (slope > 0) cap = Math.min(cap, (MAX_SLOPE * sy) / slope);
    }
    return cap;
  }

  /**
   * Re-derive the shown time zoom and centre so world (wx, wy) stays under
   * screen (px, py), then keep part of the fan on screen.
   */
  settle(px = this.w / 2, py = this.h / 2, wx = this.cam.cx, wy = this.cam.cy): void {
    const c = this.cam;
    const [sxMin, syMin] = this.minScale();
    c.sx = Math.min(SX_MAX, Math.max(sxMin, c.sx));
    c.ty = Math.min(TY_MAX, Math.max(syMin, c.ty));
    c.sy = this.timeCap(wy, py, c.ty);
    c.cx = wx - (px - this.w / 2) / c.sx;
    c.cy = wy - (py - this.h / 2) / c.sy;
    this.clampPan();
  }

  /** Keep some of the fan on screen: 30% of the screen's width, "now" no lower than 40% down, the stem's end no higher than 60%. */
  clampPan(): void {
    const c = this.cam;
    const [x0, x1] = this.extent();
    const m = (0.2 * this.w) / c.sx;
    c.cx = Math.min(x1 + m, Math.max(x0 - m, c.cx));
    const yTop = this.yNow + (0.1 * this.h) / c.sy;
    const yBot = this.fan.trunkBottom.y - (0.1 * this.h) / c.sy;
    c.cy = yTop > yBot ? (yTop + yBot) / 2 : Math.min(yBot, Math.max(yTop, c.cy));
  }

  /**
   * Zoom about a screen point by factors fx (width) and fy (time). Zooming in
   * stops at the width limit where the fingers are (it never pushes out).
   */
  zoomAbout(px: number, py: number, fx: number, fy = fx): void {
    const c = this.cam;
    const [wx, wy] = this.toWorld(px, py);
    c.ty *= fy;
    // The time zoom this lands on, for the slope limit.
    const sy = this.timeCap(wy, py, Math.min(TY_MAX, Math.max(this.minScale()[1], c.ty)));
    let sx = c.sx * fx;
    if (fx > 1) sx = Math.min(sx, Math.max(c.sx, this.sxCap(wx, wy, sy)));
    c.sx = sx;
    this.settle(px, py, wx, wy);
  }

  pan(dx: number, dy: number): void {
    const c = this.cam;
    c.cx -= dx / c.sx;
    c.cy -= dy / c.sy;
    this.settle();
  }
}

/**
 * Clip a polygon to the rectangle [x0, x1] × [y0, y1] (Sutherland–Hodgman), in
 * float64, so the canvas only ever sees coordinates near the screen.
 */
export function clipPoly(xs: number[], ys: number[], x0: number, y0: number, x1: number, y1: number): [number[], number[]] {
  let px = xs;
  let py = ys;
  // Each edge of the rectangle: keep the side where inside(x, y) ≥ 0.
  const sides: ((x: number, y: number) => number)[] = [(x) => x - x0, (x) => x1 - x, (_, y) => y - y0, (_, y) => y1 - y];
  for (const inside of sides) {
    const n = px.length;
    if (!n) break;
    const ox: number[] = [];
    const oy: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = px[i];
      const ay = py[i];
      const bx = px[(i + 1) % n];
      const by = py[(i + 1) % n];
      const da = inside(ax, ay);
      const db = inside(bx, by);
      if (da >= 0) {
        ox.push(ax);
        oy.push(ay);
      }
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        ox.push(ax + (bx - ax) * t);
        oy.push(ay + (by - ay) * t);
      }
    }
    px = ox;
    py = oy;
  }
  return [px, py];
}
