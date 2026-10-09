// Drawing a leaf: the plain leaf at fan scale, and its individuals when zoomed in.
//
// LOD inside a leaf, by the on-screen size of one individual's cell:
//   texture  cells under ~2.5 px: the leaf is one gray fill with a green tip
//            (the alive rows, floored to 2 px); generation rows show as faint
//            stripes once they are ≥ 3 px apart.
//   dots     one dot per individual, green if alive, gray if dead.
//   links    plus a line from each individual to each parent, coloured by the
//            parent (the individual it leads from).
//   labels   plus the individual's handle (lion#…).
// Only the visible rows and index ranges are generated (LeafMesh).

import type { FanBranch, Pt } from './layout';
import type { LeafMesh } from './leafmesh';

export const GREEN = '#33bd66';
export const GRAY = '#676e75';
export const LEAF_DEAD = '#59606a';
export const LEAF_DEAD_ALT = '#626a74';
export const WITHERED = '#6d675c';
export const WITHERED_ALT = '#776f63';
const WITHERED_EDGE = '#8a8170';
const LINK_GREEN = 'rgba(51,189,102,0.75)';
const LINK_GRAY = 'rgba(150,158,166,0.55)';

export interface LeafCtx {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  s: number;
  toScreen(x: number, y: number): [number, number];
  toWorld(px: number, py: number): [number, number];
}

export interface SelectedInd {
  g: number;
  i: number;
}

/** Leaf-local (x across, y from stem to tip) → world. */
export function localToWorld(b: FanBranch, x: number, y: number): Pt {
  const d = b.dir;
  return { x: b.base.x + y * d.x - x * d.y, y: b.base.y + y * d.y + x * d.x };
}

export function worldToLocal(b: FanBranch, wx: number, wy: number): Pt {
  const d = b.dir;
  const dx = wx - b.base.x;
  const dy = wy - b.base.y;
  return { x: -dx * d.y + dy * d.x, y: dx * d.x + dy * d.y };
}

/** Local AABB of the screen, clamped to the leaf. */
export function visibleLocal(v: LeafCtx, b: FanBranch): { x0: number; x1: number; y0: number; y1: number } | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [px, py] of [
    [0, 0],
    [v.w, 0],
    [0, v.h],
    [v.w, v.h],
  ]) {
    const [wx, wy] = v.toWorld(px, py);
    const p = worldToLocal(b, wx, wy);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const L = b.shape.L;
  y0 = Math.max(0, y0);
  y1 = Math.min(L, y1);
  const W = b.shape.W / 2;
  x0 = Math.max(-W, x0);
  x1 = Math.min(W, x1);
  if (y0 >= y1 || x0 >= x1) return null;
  return { x0, x1, y0, y1 };
}

/** Path of the leaf between heights ya and yb (exact outline, sampled finely for the visible part). */
function outline(v: LeafCtx, b: FanBranch, ya: number, yb: number, wither: boolean): void {
  const ctx = v.ctx;
  const n = 48;
  const seed = b.sp.gid * 0.37;
  const half = (y: number) => {
    let w = b.shape.width(y) / 2;
    if (wither) {
      const t = y / b.shape.L;
      w *= 0.9 + 0.06 * Math.sin(40 * t + seed) + 0.04 * Math.sin(97 * t + 2 * seed);
    }
    return w;
  };
  ctx.beginPath();
  for (let k = 0; k <= n; k++) {
    const y = ya + ((yb - ya) * k) / n;
    const p = localToWorld(b, -half(y), y);
    const [sx, sy] = v.toScreen(p.x, p.y);
    ctx[k ? 'lineTo' : 'moveTo'](sx, sy);
  }
  for (let k = n; k >= 0; k--) {
    const y = ya + ((yb - ya) * k) / n;
    const p = localToWorld(b, half(y), y);
    const [sx, sy] = v.toScreen(p.x, p.y);
    ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/** The leaf at fan scale: gray (all the dead) with a green tip (the living), or withered if extinct. */
export function drawPlainLeaf(v: LeafCtx, b: FanBranch, mesh: LeafMesh): void {
  const ctx = v.ctx;
  const ext = b.sp.extinct;
  outline(v, b, 0, b.shape.L, ext);
  ctx.fillStyle = ext ? WITHERED : LEAF_DEAD;
  ctx.fill();
  if (ext) {
    ctx.strokeStyle = WITHERED_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    midrib(v, b, WITHERED_EDGE);
    return;
  }
  midrib(v, b, 'rgba(160,170,178,0.35)');
  greenTip(v, b, mesh, 3);
}

function midrib(v: LeafCtx, b: FanBranch, color: string): void {
  const ctx = v.ctx;
  const a = localToWorld(b, 0, 0);
  const c = localToWorld(b, 0, b.shape.L * 0.92);
  const [ax, ay] = v.toScreen(a.x, a.y);
  const [cx, cy] = v.toScreen(c.x, c.y);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(cx, cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Rows that can hold living individuals, floored to minPx so they stay visible. */
function greenTip(v: LeafCtx, b: FanBranch, mesh: LeafMesh, minPx: number): void {
  if (b.sp.extinct || mesh.aliveFrom >= mesh.G) return;
  const L = b.shape.L;
  // Area of the living, at the tip: alive / ever of the leaf.
  const ya = Math.min(b.shape.yOfArea(b.shape.total * (1 - b.sp.alive / b.sp.ever)), L - minPx / v.s);
  outline(v, b, Math.max(0, ya), L, false);
  v.ctx.fillStyle = GREEN;
  v.ctx.fill();
}

export interface MeshStats {
  mode: 'texture' | 'stripes' | 'dots' | 'links' | 'labels';
  rows: number;
  drawn: number;
  g0: number;
  g1: number;
  cellPx: number;
  rowPx: number;
}

const MAX_DOTS = 12000;
const MAX_LINKS = 2500;

/** Leaf with its individuals. Returns what was drawn (for the HUD and tests). */
export function drawMeshLeaf(v: LeafCtx, b: FanBranch, mesh: LeafMesh, sel: SelectedInd | null): MeshStats | null {
  const ctx = v.ctx;
  const vis = visibleLocal(v, b);
  if (!vis) return null;
  const ext = b.sp.extinct;
  const g0 = mesh.generationAt(vis.y0);
  const g1 = mesh.generationAt(vis.y1);
  const gm = Math.round((g0 + g1) / 2);
  const ym = (mesh.rowStart(gm) + mesh.rowStart(gm + 1)) / 2;
  const rowPx = (mesh.rowStart(gm + 1) - mesh.rowStart(gm)) * v.s;
  const cellPx = (b.shape.width(ym) / mesh.size(gm)) * v.s;
  const rows = g1 - g0 + 1;
  const stats: MeshStats = { mode: 'texture', rows, drawn: 0, g0, g1, cellPx, rowPx };

  // Base fill of the visible part of the leaf.
  outline(v, b, vis.y0, vis.y1, false);
  ctx.fillStyle = ext ? WITHERED : LEAF_DEAD;
  ctx.fill();

  const unit = Math.min(cellPx, rowPx);
  const xw = (vis.x1 - vis.x0) / b.shape.W;
  const estimate = rows * Math.max(1, mesh.size(gm) * Math.min(1, xw));
  if (unit < 2.5 || estimate > MAX_DOTS) {
    if (rowPx >= 3 && rows <= 4000) {
      stats.mode = 'stripes';
      ctx.fillStyle = ext ? WITHERED_ALT : LEAF_DEAD_ALT;
      for (let g = g0; g <= g1; g++) {
        if (g % 2) continue;
        rowBand(v, b, mesh, g, vis.x0, vis.x1);
        ctx.fill();
      }
      ctx.fillStyle = GREEN;
      for (let g = Math.max(g0, mesh.aliveFrom); g <= g1; g++) {
        // Alive share of the row as a centred green band (dots take over when cells are visible).
        rowBand(v, b, mesh, g, vis.x0, vis.x1, aliveShare(mesh, g));
        ctx.fill();
      }
    } else {
      greenTip(v, b, mesh, 2);
    }
    return stats;
  }

  // Dots, links, labels.
  const showLinks = unit >= 7 && estimate <= MAX_LINKS;
  const showLabels = cellPx >= 64 && rowPx >= 26;
  stats.mode = showLabels ? 'labels' : showLinks ? 'links' : 'dots';
  const r = Math.min(14, Math.max(0.8, unit * 0.36));
  const pos = (g: number, i: number): [number, number] => {
    const p = mesh.position(g, i);
    const q = localToWorld(b, p.x, p.y);
    return v.toScreen(q.x, q.y);
  };

  if (showLinks) {
    // Parent links for visible children, plus links from visible parents' row into
    // the row above the screen (children just off-screen) are skipped: short edges.
    const gl = ctx.lineWidth;
    ctx.lineWidth = Math.max(0.6, Math.min(2, r * 0.25));
    const green = new Path2D();
    const gray = new Path2D();
    for (let g = Math.max(1, g0); g <= g1; g++) {
      const [i0, i1] = mesh.indexRange(g, vis.x0, vis.x1);
      for (let i = i0; i < i1; i++) {
        const [cx, cy] = pos(g, i);
        for (const p of mesh.parents(g, i)) {
          const pg = p.generation;
          const pi = Number(p.index);
          const [px, py] = pos(pg, pi);
          const path = mesh.alive(pg, pi) ? green : gray;
          path.moveTo(px, py);
          path.lineTo(cx, cy);
        }
      }
    }
    ctx.strokeStyle = LINK_GRAY;
    ctx.stroke(gray);
    ctx.strokeStyle = LINK_GREEN;
    ctx.stroke(green);
    ctx.lineWidth = gl;
  }

  const green = new Path2D();
  const gray = new Path2D();
  let drawn = 0;
  for (let g = g0; g <= g1; g++) {
    const [i0, i1] = mesh.indexRange(g, vis.x0, vis.x1);
    for (let i = i0; i < i1; i++) {
      const [x, y] = pos(g, i);
      if (x < -r || y < -r || x > v.w + r || y > v.h + r) continue;
      const path = mesh.alive(g, i) ? green : gray;
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
      drawn++;
    }
  }
  ctx.fillStyle = ext ? '#a39a88' : '#9aa3ab';
  ctx.fill(gray);
  ctx.fillStyle = GREEN;
  ctx.fill(green);
  stats.drawn = drawn;

  if (sel) {
    const [x, y] = pos(sel.g, sel.i);
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (sel.g > 0) {
      ctx.beginPath();
      for (const p of mesh.parents(sel.g, sel.i)) {
        const [px, py] = pos(p.generation, Number(p.index));
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (showLabels) {
    ctx.save();
    ctx.font = `${Math.min(13, Math.max(10, r * 0.9))}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#dfe7e2';
    for (let g = g0; g <= g1; g++) {
      const [i0, i1] = mesh.indexRange(g, vis.x0, vis.x1);
      for (let i = i0; i < i1; i++) {
        const [x, y] = pos(g, i);
        if (x < -40 || y < -20 || x > v.w + 40 || y > v.h + 20) continue;
        ctx.fillText(mesh.sp.handle({ generation: g, index: BigInt(i) }), x, y + r + 3, cellPx * 0.95);
      }
    }
    ctx.restore();
  }
  return stats;
}

/** Expected alive share of a row (closed form, for the stripes LOD). */
function aliveShare(mesh: LeafMesh, g: number): number {
  const s = mesh.sp;
  const GL = s.generationYears;
  const L = s.lifespanYears;
  if (mesh.rec.extinct || L <= 0) return 0;
  // Age at `now` of a birth at (g + u)·GL is a = now − (g + u)·GL; P(lifespan > a)
  // for lifespan = L·(u1 + u2) (triangular on [0, 2L]). Average over u numerically.
  let sum = 0;
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = s.now - (g + (k + 0.5) / n) * GL;
    const x = a / L;
    sum += x <= 0 ? 1 : x >= 2 ? 0 : x <= 1 ? 1 - (x * x) / 2 : ((2 - x) * (2 - x)) / 2;
  }
  return sum / n;
}

/** Path of row g between x0 and x1 (leaf-local), or a centred fraction of it. */
function rowBand(v: LeafCtx, b: FanBranch, mesh: LeafMesh, g: number, x0: number, x1: number, frac = 1): void {
  const ya = mesh.rowStart(g);
  const yb = mesh.rowStart(g + 1);
  const ctx = v.ctx;
  ctx.beginPath();
  const corners: [number, number][] = [];
  for (const y of [ya, yb]) {
    const hw = (b.shape.width(y) / 2) * frac;
    corners.push([Math.max(-hw, x0), y], [Math.min(hw, x1), y]);
  }
  const order = [0, 1, 3, 2];
  order.forEach((k, j) => {
    const [x, y] = corners[k];
    const p = localToWorld(b, x, y);
    const [sx, sy] = v.toScreen(p.x, p.y);
    ctx[j ? 'lineTo' : 'moveTo'](sx, sy);
  });
  ctx.closePath();
}
