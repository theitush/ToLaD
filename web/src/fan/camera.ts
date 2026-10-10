// The fan's camera: a plain axis-aligned map from world to screen, with width
// (x) and time (y) scaled separately. It never rotates or shears: x on screen
// depends only on world x, y only on world y.
//
// One pinch zooms both axes by the same factor. Width can go ~10^12 deeper
// than time (a linear-width branch is that much thinner than it is tall), so
// time stops at a floor and width keeps going:
//   - time: MIN_YEARS (10 years) never takes more than MAX_YEARS_FRAC (10%) of
//     the screen's height anywhere on screen, so the screen always shows at
//     least ~100 years. On the log axis years are tallest at the top of the
//     screen (the youngest), so the limit is measured there: the 10% of the
//     screen below its top edge must span 10 years. That depends on height
//     (near "now" a year is tall, deep in the past it is tiny), so the camera
//     keeps the time zoom the gestures asked for (`ty`) and shows sy = min(ty,
//     the limit there). Every path (pinch, wheel, double-tap, fly-to, resize)
//     lands in settle(), which applies it. Zooming back out undoes a zoom-in
//     exactly.
//   - width, zooming in: up to ~STRAND_PX per strand of the thinnest lane. The
//     geometry is fixed and every strand is vertical (the gray lane's edge is
//     a step function), so nothing leans and there is no slope limit.
//   - zoom out: no further than the whole fan with a margin.
//   - pan: some of the fan always stays on screen.

import { laneAt, leftAt, strandAt, type Fan, type FanBranch } from './layout';

/** A span of this many years ... */
export const MIN_YEARS = 10;
/** ... never takes more than this fraction of the screen's height (the screen shows ≥ ~100 years). */
export const MAX_YEARS_FRAC = 0.1;
/** Width zoom stops when strands are this far apart (px): handles legible. */
export const STRAND_PX = 90;
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
  /** Index slots of the green lane (twigs.ts TwigModel.nLive). */
  readonly nLive: number;
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

  /** World x extent of the fan: its columns, with a small margin. */
  extent(): [number, number] {
    const f = this.fan;
    const m = 0.04 * (f.x1 - f.x0);
    return [f.x0 - m, f.x1 + m];
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

  /**
   * Years in the tallest MAX_YEARS_FRAC of the screen: the band just below its
   * top edge (years only get shorter going up the log axis, and above "now"
   * they keep the rate they have at "now").
   */
  bandYears(wy: number, py: number, sy: number): number {
    const top = wy - py / sy;
    return this.years(top + (MAX_YEARS_FRAC * this.h) / sy) - this.years(top);
  }

  /** The largest time zoom ≤ ty at which MIN_YEARS takes at most MAX_YEARS_FRAC of the screen, anchored at (wy, py). */
  timeCap(wy: number, py: number, ty: number): number {
    // The allowed zooms need not be one interval: zooming in about a point
    // just below "now", "now" first sits in the top band (capped at its rate),
    // then leaves the screen, and only well past that are the years at the top
    // short enough again. Keep to the first interval, so zooming in time stops
    // smoothly instead of jumping across the gap (panning down reaches beyond).
    const ok = (s: number) => this.bandYears(wy, py, s) >= MIN_YEARS;
    let lo = Math.log(Math.min(ty, 1e-3));
    let hi = Math.log(ty);
    const K = 48;
    let first = -1;
    for (let k = 1; k <= K; k++) {
      if (!ok(Math.exp(lo + ((hi - lo) * k) / K))) {
        first = k;
        break;
      }
    }
    if (first < 0) return ty;
    hi = lo + ((hi - lo) * first) / K;
    lo = lo + ((hi - lo) * (first - 1)) / first;
    for (let k = 0; k < 64; k++) {
      const mid = (lo + hi) / 2;
      if (this.bandYears(wy, py, Math.exp(mid)) >= MIN_YEARS) lo = mid;
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
    const st = laneAt(b, y);
    const gw = st.gw;
    // The dead's lane closes at the tip; size its cells a couple of generations below it.
    const stF = strandAt(b, Math.max(age, b.sp.t1 + (2 * m.GL) / 1e6), this.fan.mode);
    let cell = Infinity;
    if (gw > 0) cell = Math.min(cell, gw / Math.max(1, m.nLive));
    if (stF.w - gw > 0) cell = Math.min(cell, (stF.w - gw) / n);
    return cell;
  }

  /** The deepest width zoom allowed at world point (wx, wy) (time zoom sy: kept for callers, unused). */
  sxCap(_wx: number, wy: number, _sy?: number): number {
    const bs = this.fan.branches;
    const span = bs.filter((b) => wy >= b.tipY && wy <= 0);
    let cell = Infinity;
    for (const b of span.length ? span : bs) cell = Math.min(cell, this.cellAt(b, Math.min(0, Math.max(b.tipY, wy))));
    const cap = Math.min(SX_MAX, STRAND_PX / cell);
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
    // The geometry is fixed in world units: the point stays where it is.
    c.cx = wx - (px - this.w / 2) / c.sx;
    c.cy = wy - (py - this.h / 2) / c.sy;
    this.fan.steps.setScale(c.sy);
    this.clampPan();
  }

  /** World x intervals holding drawn content at height y: the stem below the fork, else each branch. */
  contentAt(y: number): [number, number][] {
    const f = this.fan;
    if (y >= 0) return [[-f.trunkWidth / 2, f.trunkWidth / 2]];
    const out: [number, number][] = [];
    for (const b of f.branches) {
      if (y < b.tipY) continue;
      const left = leftAt(b, y);
      out.push([left, left + laneAt(b, y).w]);
    }
    return out;
  }

  /** Nearest x holding content at height y, or anywhere in heights [y, y1] (x itself if it does). */
  nearestContent(x: number, y: number, y1 = y): number {
    const ys = [y, y1];
    for (let k = 1; k < 8; k++) ys.push(y + ((y1 - y) * k) / 8);
    for (const b of this.fan.branches) for (const v of [b.tipY, 0]) if (v > y && v < y1) ys.push(v);
    let best = x;
    let bd = Infinity;
    for (const h of ys) {
      for (const [a, b] of this.contentAt(h)) {
        const p = Math.min(b, Math.max(a, x));
        if (Math.abs(p - x) < bd) {
          bd = Math.abs(p - x);
          best = p;
        }
      }
    }
    return best;
  }

  /**
   * Keep the fan on screen: content within 40% of the screen's width of the
   * centre (at some height on screen), "now" no lower than 40% down, the
   * stem's end no higher than 60%.
   */
  clampPan(): void {
    const c = this.cam;
    const yTop = this.yNow + (0.1 * this.h) / c.sy;
    const yBot = this.fan.trunkBottom.y - (0.1 * this.h) / c.sy;
    c.cy = yTop > yBot ? (yTop + yBot) / 2 : Math.min(yBot, Math.max(yTop, c.cy));
    const p = this.nearestContent(c.cx, Math.max(this.yNow, c.cy - this.h / 2 / c.sy), c.cy + this.h / 2 / c.sy);
    const m = (0.4 * this.w) / c.sx;
    c.cx = Math.min(p + m, Math.max(p - m, c.cx));
  }

  /**
   * Zoom about a screen point by factors fx (width) and fy (time). Zooming in
   * stops at the width limit where the fingers are (it never pushes out).
   */
  zoomAbout(px: number, py: number, fx: number, fy = fx): void {
    const c = this.cam;
    const [wx, wy] = this.toWorld(px, py);
    c.ty *= fy;
    let sx = c.sx * fx;
    if (fx > 1) {
      // No zooming into nothing: content stays within 30% of the screen of the fingers.
      const d = Math.abs(this.nearestContent(wx, wy) - wx);
      const cap = d > 0 ? (0.3 * this.w) / d : Infinity;
      sx = Math.min(sx, Math.max(c.sx, Math.min(cap, this.sxCap(wx, wy))));
    }
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
