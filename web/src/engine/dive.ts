// Scripted deep zoom along a pseudo-random descendant chain. Used by the
// continuity test (Node) and the performance run (browser).

import type { Camera } from './camera';
import type { Layout, LNode } from './layout';
import { hash3 } from './hash';

export interface DiveOp {
  dx: number;
  dy: number;
  /** Zoom focus (screen px) and factors, applied after the pan. */
  px: number;
  py: number;
  fx: number;
  ft: number;
}

export class DiveDriver {
  target: LNode;
  /** Number of chain levels descended so far. */
  levels = 0;
  maxStep = 1.3;
  panFrac = 0.35;
  fill = 0.8;
  /** Prefer surviving lineages (so the green "now" rim stays in view). */
  preferAlive = false;
  /** Reached a leaf (finite real data): no deeper level to dive into. */
  done = false;

  constructor(
    readonly cam: Camera,
    readonly layout: Layout,
    readonly seed = 1,
    start?: LNode,
  ) {
    this.target = start ?? cam.anchor;
  }

  /** Compute the next camera operation (and advance the target when it is framed). */
  plan(): DiveOp {
    const { cam } = this;
    let F = cam.frameOf(this.target);
    let wantX = (this.fill * cam.W) / F.kx;
    let wantT = (this.fill * cam.H) / F.kt;
    if (Math.abs(Math.log(wantX)) < 0.05 && Math.abs(Math.log(wantT)) < 0.05) {
      let kids = this.layout.children(this.target);
      if (kids.length === 0) {
        this.done = true;
        return { dx: 0, dy: 0, px: cam.W / 2, py: cam.H / 2, fx: 1, ft: 1 };
      }
      if (this.preferAlive && kids.some((k) => k.alive)) kids = kids.filter((k) => k.alive);
      this.target = kids[hash3(this.seed, this.target.depth, 7) % kids.length];
      this.levels++;
      F = cam.frameOf(this.target);
      wantX = (this.fill * cam.W) / F.kx;
      wantT = (this.fill * cam.H) / F.kt;
    }
    const cx = F.ox + F.kx / 2;
    const cy = F.oy - F.kt / 2;
    const dx = (cam.W / 2 - cx) * this.panFrac;
    const dy = (cam.H / 2 - cy) * this.panFrac;
    const lim = (v: number) => Math.min(this.maxStep, Math.max(1 / this.maxStep, v));
    return { dx, dy, px: cx + dx, py: cy + dy, fx: lim(wantX), ft: lim(wantT) };
  }

  apply(op: DiveOp): void {
    this.cam.pan(op.dx, op.dy);
    this.cam.zoomAt(op.px, op.py, op.fx, op.ft);
  }

  step(): DiveOp {
    const op = this.plan();
    this.apply(op);
    return op;
  }
}
