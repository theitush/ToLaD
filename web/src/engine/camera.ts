// Re-anchoring camera with separate width (X) and time (T) scales.
//
// The camera never holds a global coordinate. Its state is an anchor node plus
// a float64 Frame mapping the anchor's local frame to the screen. After every
// change it re-anchors (OneZoom's approach): descend into the child under the
// screen centre while that child is comfortably large, ascend when the anchor
// gets small or the centre leaves it. Every number the camera handles stays
// roughly screen-sized, so float64 never runs out of precision at any depth.

import { copyFrame, frame, toChild, toParent, zoomFrame, type Frame } from './frame';
import type { Layout, LNode } from './layout';

/** Descend into a child once it is at least this many px on both axes. */
export const DESCEND_MIN_PX = 64;
/** Ascend once the anchor is smaller than this on either axis (hysteresis). */
export const ASCEND_MIN_PX = 32;
/** Force descending (even into a thin child) once the anchor scale passes this. */
export const FORCE_DESCEND_PX = 1e6;
/** Hard cap on the anchor scale (only reachable in gaps with no child under the centre). */
export const MAX_ANCHOR_PX = 1e10;

export class Camera {
  anchor: LNode;
  readonly f: Frame = frame();
  W = 1;
  H = 1;
  reanchorCount = 0;

  constructor(readonly layout: Layout, W: number, H: number) {
    this.anchor = layout.root;
    this.setViewport(W, H);
    this.fitRoot();
  }

  setViewport(W: number, H: number): void {
    // Keep the screen centre fixed when the viewport changes.
    const dx = (W - this.W) / 2;
    const dy = (H - this.H) / 2;
    this.W = W;
    this.H = H;
    this.f.ox += dx;
    this.f.oy += dy;
  }

  fitRoot(): void {
    this.setFrameIn(this.layout.root, this.fitFrame(0.06));
  }

  /** Frame that fits a node's band to the viewport with a margin. */
  fitFrame(margin = 0.06): Frame {
    const { W, H } = this;
    const kx = W * (1 - 2 * margin);
    const kt = H * (1 - 2 * margin);
    return frame((W - kx) / 2, kx, H - (H - kt) / 2, kt);
  }

  /** Place the camera so that `node`'s frame is `f`, then re-anchor. */
  setFrameIn(node: LNode, f: Frame): void {
    this.anchor = node;
    copyFrame(this.f, f);
    this.normalize();
  }

  pan(dx: number, dy: number): void {
    this.f.ox += dx;
    this.f.oy += dy;
    this.normalize();
  }

  zoomAt(px: number, py: number, fx: number, ft: number): void {
    zoomFrame(this.f, px, py, fx, ft);
    this.normalize();
    this.clamp();
  }

  /** Re-anchor. Pure bookkeeping: the screen mapping of every node is unchanged. */
  normalize(): void {
    const L = this.layout;
    const f = this.f;
    const cx = this.W / 2;
    const cy = this.H / 2;
    // Ascend.
    for (;;) {
      const a = this.anchor;
      const p = a.parent;
      if (!p) break;
      const X = (cx - f.ox) / f.kx;
      const T = (f.oy - cy) / f.kt;
      const inside = X >= 0 && X <= 1 && T >= 0 && T <= 1;
      const xs = L.xs(a);
      const small = f.kx < ASCEND_MIN_PX || f.kt < ASCEND_MIN_PX;
      const parentTooBig = f.kx / xs > FORCE_DESCEND_PX || f.kt / a.ts > FORCE_DESCEND_PX;
      if (inside && !(small && !parentTooBig)) break;
      toParent(f, f, L.x0(a), xs, a.t0, a.ts);
      this.anchor = p;
      this.reanchorCount++;
    }
    // Descend.
    for (;;) {
      const a = this.anchor;
      const kids = L.children(a);
      const X = (cx - f.ox) / f.kx;
      const T = (f.oy - cy) / f.kt;
      const force = f.kx > FORCE_DESCEND_PX || f.kt > FORCE_DESCEND_PX;
      let next: LNode | null = null;
      for (const c of kids) {
        const x0 = L.x0(c);
        const xs = L.xs(c);
        if (X >= x0 && X <= x0 + xs && T >= c.t0 && T <= c.t0 + c.ts) {
          if (force || (f.kx * xs >= DESCEND_MIN_PX && f.kt * c.ts >= DESCEND_MIN_PX)) next = c;
          break;
        }
      }
      if (!next) break;
      toChild(f, f, L.x0(next), L.xs(next), next.t0, next.ts);
      this.anchor = next;
      this.reanchorCount++;
    }
  }

  /** Zoom limits: the root can't shrink below a quarter of the screen; the anchor scale is capped. */
  private clamp(): void {
    const f = this.f;
    const cx = this.W / 2;
    const cy = this.H / 2;
    let fx = 1;
    let ft = 1;
    if (f.kx > MAX_ANCHOR_PX) fx = MAX_ANCHOR_PX / f.kx;
    if (f.kt > MAX_ANCHOR_PX) ft = MAX_ANCHOR_PX / f.kt;
    if (this.anchor.depth < 64) {
      const r = this.frameOf(this.layout.root);
      if (r.kx < this.W * 0.25) fx = (this.W * 0.25) / r.kx;
      if (r.kt < this.H * 0.25) ft = (this.H * 0.25) / r.kt;
    }
    if (fx !== 1 || ft !== 1) {
      zoomFrame(f, cx, cy, fx, ft);
      this.normalize();
    }
  }

  /** Frame of any node, composed in float64 through the lowest common ancestor with the anchor. */
  frameOf(node: LNode, out: Frame = frame()): Frame {
    const L = this.layout;
    copyFrame(out, this.f);
    let a: LNode = this.anchor;
    let n: LNode = node;
    const down: LNode[] = [];
    while (n.depth > a.depth) {
      down.push(n);
      n = n.parent!;
    }
    while (a.depth > n.depth) {
      toParent(out, out, L.x0(a), L.xs(a), a.t0, a.ts);
      a = a.parent!;
    }
    while (a.id !== n.id) {
      toParent(out, out, L.x0(a), L.xs(a), a.t0, a.ts);
      a = a.parent!;
      down.push(n);
      n = n.parent!;
    }
    for (let i = down.length - 1; i >= 0; i--) {
      const d = down[i];
      toChild(out, out, L.x0(d), L.xs(d), d.t0, d.ts);
    }
    return out;
  }

  /** log10 of the total zoom on each axis relative to the root fitted to the screen (for display). */
  scaleExponents(): { x: number; t: number } {
    const L = this.layout;
    let lx = Math.log10(this.f.kx / this.W);
    let lt = Math.log10(this.f.kt / this.H);
    for (let n: LNode | null = this.anchor; n && n.parent; n = n.parent) {
      lx -= Math.log10(L.xs(n));
      lt -= Math.log10(n.ts);
    }
    return { x: lx, t: lt };
  }
}
