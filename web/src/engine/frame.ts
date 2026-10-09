// Float64 frame math. A Frame maps a node's local frame to screen CSS pixels:
//   screenX = ox + kx * X
//   screenY = oy - kt * T        (T grows upward: LUCA bottom, now top)
// so the node's band [0,1]x[0,1] occupies x in [ox, ox+kx], y in [oy-kt, oy].
// kx and kt are separate: width and time zoom independently.

export interface Frame {
  ox: number;
  kx: number;
  oy: number;
  kt: number;
}

export function frame(ox = 0, kx = 1, oy = 0, kt = 1): Frame {
  return { ox, kx, oy, kt };
}

export function copyFrame(out: Frame, f: Frame): Frame {
  out.ox = f.ox;
  out.kx = f.kx;
  out.oy = f.oy;
  out.kt = f.kt;
  return out;
}

/** Parent frame → child frame, given the child's placement (x0, xs, t0, ts) in the parent. */
export function toChild(out: Frame, f: Frame, x0: number, xs: number, t0: number, ts: number): Frame {
  const ox = f.ox + f.kx * x0;
  const oy = f.oy - f.kt * t0;
  out.kx = f.kx * xs;
  out.kt = f.kt * ts;
  out.ox = ox;
  out.oy = oy;
  return out;
}

/** Child frame → parent frame (inverse of toChild). */
export function toParent(out: Frame, f: Frame, x0: number, xs: number, t0: number, ts: number): Frame {
  const kx = f.kx / xs;
  const kt = f.kt / ts;
  out.ox = f.ox - kx * x0;
  out.oy = f.oy + kt * t0;
  out.kx = kx;
  out.kt = kt;
  return out;
}

/** Scale about a screen point (px, py) by fx (width) and ft (time). */
export function zoomFrame(f: Frame, px: number, py: number, fx: number, ft: number): void {
  f.ox = px + (f.ox - px) * fx;
  f.kx *= fx;
  f.oy = py + (f.oy - py) * ft;
  f.kt *= ft;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number; // top (smaller y)
  y1: number; // bottom
}

/** Screen rect of a node's band bounding box [0,1]x[0,1]. */
export function bandRect(f: Frame): Rect {
  return { x0: f.ox, x1: f.ox + f.kx, y0: f.oy - f.kt, y1: f.oy };
}
