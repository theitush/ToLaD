// Scene building: decides what to draw each frame and with which transforms.
// Pure TS (no WebGL), so the numerics can be unit-tested in Node.
//
// Two paths:
//  - Chunk path (the common case). A chunk is a subtree of a few levels whose
//    geometry is stored once as float32 in the chunk root's local frame (all
//    values in [0,1], features >= 1e-3). Per frame only the chunk's float64
//    transform (ox, kx, oy, kt) is composed on the CPU and handed to the GPU.
//    Chunks are only drawn this way while their scale is <= GPU_MAX_PX, so
//    float32 vertex math stays well under 0.02 px of error.
//  - Near path. Nodes around the camera anchor can be far larger than the
//    screen (a 1e9 px band whose edge is on screen). Those are emitted per
//    frame in float64 screen space, clipped to the viewport, so the GPU only
//    ever sees screen-sized numbers.

import { copyFrame, frame, toChild, toParent, type Frame } from './frame';
import type { Camera } from './camera';
import { RIVER_S, type Layout, type LNode } from './layout';
import { DRAW_STUB, TAPER_IN, TAPER_OUT } from './tree';

/** Floats per instance. Layout: lb rb lt rt | mb mt tb tt | tint flags gb gt */
export const INST_FLOATS = 12;
/** Max chunk-root scale (px) for the float32 chunk path. */
export const GPU_MAX_PX = 2e5;
/** Stop walking up from the anchor once an ancestor is this large. */
export const TOP_MAX_PX = 1e9;
/** Thread width (fraction of the band) at a node's origin. */
const THREAD = 0.08;
const CLIP_MARGIN = 2;

/** Instance flag bits (the debug outline uses 2). */
export const FLAG_ALIVE = 1;
export const FLAG_OUTLINE = 2;
export const FLAG_SELECTED = 32;
/** A stub band whose tile is on screen and large enough to be worth loading. */
export const STUB_REQUEST_PX = 24;
/** Min screen width (px) of a river chunk root before its chunk is opened. */
export const RIVER_OPEN_MIN_W = 8;

export class Chunk {
  epoch = -1;
  dataEpoch = -1;
  /** Bumped on every rebuild (the renderer re-uploads when it changes). */
  version = 0;
  nodes: LNode[] = [];
  /** First instance index of each node in `nodes`. */
  nodeFirst: number[] = [];
  /** Boundary nodes also get a flat "proxy" band in this chunk, drawn while their own chunk is too small to open. */
  proxyFirst: number[] = [];
  data = new Float32Array(0);
  /** The same instances in reverse order (deepest first), for the front-to-back interior pass. */
  rev = new Float32Array(0);
  count = 0;
  boundary: LNode[] = [];
  /** (x0, xs, t0, ts) of each boundary node relative to the chunk root, float64. */
  brel = new Float64Array(0);
  lastUsed = 0;
  /** (x0, xs, t0, ts) of every node in `nodes` relative to the chunk root (labels, picking). */
  rel = new Float64Array(0);
  /** Indices into `nodes` of pending stubs (children not loaded). */
  stubIdx: number[] = [];
  /** Renderer-owned GPU handle. */
  gpu: unknown = null;
  gpuEpoch = -1;
  constructor(readonly root: LNode) {}
}

export interface ChunkDraw {
  chunk: Chunk;
  f: Frame;
}

export interface SceneStats {
  instances: number;
  draws: number;
  chunksBuilt: number;
  chunksResident: number;
  nearInstances: number;
  topDepth: number;
}

/** Growable float32 instance writer. */
class InstanceBuf {
  data = new Float32Array(INST_FLOATS * 1024);
  count = 0;
  push(lb: number, rb: number, lt: number, rt: number, mb: number, mt: number, tb: number, tt: number, tint: number, flags: number, gb = rb, gt = rt): void {
    if ((this.count + 1) * INST_FLOATS > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const o = this.count * INST_FLOATS;
    const d = this.data;
    d[o] = lb;
    d[o + 1] = rb;
    d[o + 2] = lt;
    d[o + 3] = rt;
    d[o + 4] = mb;
    d[o + 5] = mt;
    d[o + 6] = tb;
    d[o + 7] = tt;
    d[o + 8] = tint;
    d[o + 9] = flags;
    d[o + 10] = gb;
    d[o + 11] = gt;
    this.count++;
  }
}

type PushFn = (
  b: InstanceBuf,
  lb: number,
  rb: number,
  lt: number,
  rt: number,
  mb: number,
  mt: number,
  tb: number,
  tt: number,
  tint: number,
  flags: number,
  gb?: number,
  gt?: number,
) => void;

const directPush: PushFn = (b, lb, rb, lt, rt, mb, mt, tb, tt, tint, flags, gb, gt) => b.push(lb, rb, lt, rt, mb, mt, tb, tt, tint, flags, gb, gt);

/**
 * Emit any node: a shaped river band (one trapezoid per sample segment, with
 * green / gray / ghost lanes) or a rectangular synthetic band.
 */
/**
 * The tint slot carries the node's tree depth too (integer part): the renderer
 * uses it as a depth-buffer level so nested bands occlude their ancestors.
 */
export const DEPTH_LEVELS = 4000;
function depthTint(n: LNode): number {
  return (n.depth % DEPTH_LEVELS) + n.tint * 0.999;
}

/** Chunk path: drop polyline samples whose removal moves an edge by less than this (chunk-local units). */
const SIMPLIFY_TOL = 2e-6;
const keep = new Uint8Array(RIVER_S);

function emitNode(out: InstanceBuf, L: Layout, n: LNode, x0: number, xs: number, t0: number, ts: number, clip: PushFn | null, extra = 0): void {
  if (!n.rv) {
    emitBand(out, x0, xs, t0, ts, L.aliveFrac(n), n.alive, depthTint(n), clip, extra);
    return;
  }
  L.ensureShape(n);
  const push = clip ?? directPush;
  const flags = (n.alive ? FLAG_ALIVE : 0) | (n.info.draw ?? 0) | extra;
  const f = L.aliveFrac(n);
  const g = L.ghostFrac(n);
  const T = n.rv.T;
  const o = n.rv.o;
  const tint = depthTint(n);
  const Ls = n.L!;
  const Rs = n.R!;
  keep.fill(1);
  if (!clip && xs > 0) {
    // Greedy polyline simplification (flat stretches of a profile need no extra trapezoids).
    const tol = SIMPLIFY_TOL / Math.abs(xs);
    let a = 0;
    for (let k = 1; k < RIVER_S - 1; k++) {
      const d = T[o + k + 1] - T[o + a];
      const u = d > 0 ? (T[o + k] - T[o + a]) / d : 0;
      const el = Math.abs(Ls[a] + (Ls[k + 1] - Ls[a]) * u - Ls[k]);
      const er = Math.abs(Rs[a] + (Rs[k + 1] - Rs[a]) * u - Rs[k]);
      if (el < tol && er < tol) keep[k] = 0;
      else a = k;
    }
  }
  let lb = x0 + xs * Ls[0];
  let rb = x0 + xs * Rs[0];
  let yb = t0 + ts * T[o];
  for (let k = 1; k < RIVER_S; k++) {
    if (!keep[k]) continue;
    const lt = x0 + xs * Ls[k];
    const rt = x0 + xs * Rs[k];
    const yt = t0 + ts * T[o + k];
    if (yt !== yb) {
      push(out, lb, rb, lt, rt, lb + (rb - lb) * f, lt + (rt - lt) * f, yb, yt, tint, flags, rb - (rb - lb) * g, rt - (rt - lt) * g);
    }
    lb = lt;
    rb = rt;
    yb = yt;
  }
}

/**
 * Emit a node's band as up to three trapezoids (taper-in, body, taper-out).
 * X(x) = x0 + xs*x and Y(t) = t0 + ts*t map the node's [0,1]^2 to the target
 * space (chunk-local units, or screen px with ts < 0 for the near path).
 */
function emitBand(
  out: InstanceBuf,
  x0: number,
  xs: number,
  t0: number,
  ts: number,
  f: number,
  alive: boolean,
  tint: number,
  clip: PushFn | null,
  extra = 0,
): void {
  const flags = (alive ? FLAG_ALIVE : 0) | extra;
  const push = clip ?? directPush;
  const xl = x0;
  const xr = x0 + xs;
  const xm = x0 + xs * f;
  const tl = x0 + xs * (0.5 - THREAD / 2);
  const tr = x0 + xs * (0.5 + THREAD / 2);
  const ya = t0;
  const yb = t0 + ts * TAPER_IN;
  const yc = alive ? t0 + ts : t0 + ts * (1 - TAPER_OUT);
  // Taper-in: a thread at the origin widening to the full band.
  push(out, tl, tr, xl, xr, tl + (tr - tl) * f, xm, ya, yb, tint, flags);
  // Body.
  push(out, xl, xr, xl, xr, xm, xm, yb, yc, tint, flags);
  if (!alive) {
    // Extinct: taper out to a point at the last appearance.
    const xc = x0 + xs * 0.5;
    push(out, xl, xr, xc, xc, xm, xc, yc, t0 + ts, tint, flags);
  }
}

/** Instance array in reverse order. */
export function reverseInstances(src: Float32Array, count: number, out?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const d = out && out.length >= count * INST_FLOATS ? out : new Float32Array(count * INST_FLOATS);
  for (let i = 0; i < count; i++) d.set(src.subarray(i * INST_FLOATS, (i + 1) * INST_FLOATS), (count - 1 - i) * INST_FLOATS);
  return d;
}

export class SceneBuilder {
  readonly chunks = new Map<string, Chunk>();
  maxChunks = 900;
  /** LOD: skip chunks whose root band is smaller than this (px). Adapted by the engine. */
  minPx = 1.5;
  /**
   * A child chunk is only opened once its root covers this many px² (its
   * internal detail is >= 1e-3 of the root, so below this it is sub-pixel).
   * Until then the parent chunk's proxy band stands in for it.
   */
  chunkOpenArea = 32 * 32;
  readonly near = new InstanceBuf();
  nearNodes: LNode[] = [];
  /** Nodes drawn on the near path with their screen frames (valid until the next build). */
  nearList: { n: LNode; f: Frame }[] = [];
  draws: ChunkDraw[] = [];
  private framePool: Frame[] = [];
  private frameUsed = 0;
  private frameNo = 0;
  stats: SceneStats = { instances: 0, draws: 0, chunksBuilt: 0, chunksResident: 0, nearInstances: 0, topDepth: 0 };
  onEvict: ((c: Chunk) => void) | null = null;
  /** The node the last build started from (covers the viewport, or the root). */
  top: LNode | null = null;
  /** Highlighted node (info panel open). Set through `select` so chunks rebuild. */
  selected: LNode | null = null;
  W = 1;
  H = 1;

  constructor(readonly layout: Layout) {}

  select(n: LNode | null): void {
    if (n === this.selected) return;
    this.selected = n;
    this.layout.invalidate();
  }

  private allocFrame(): Frame {
    if (this.frameUsed === this.framePool.length) this.framePool.push(frame());
    return this.framePool[this.frameUsed++];
  }

  build(cam: Camera): void {
    this.frameNo++;
    this.frameUsed = 0;
    this.near.count = 0;
    this.nearNodes.length = 0;
    this.nearList.length = 0;
    this.draws.length = 0;
    this.stats.chunksBuilt = 0;
    this.stats.instances = 0;
    this.W = cam.W;
    this.H = cam.H;
    const L = this.layout;

    // Walk up from the anchor until an ancestor covers the viewport (everything
    // above it is hidden behind it) or gets too large to matter.
    let top = cam.anchor;
    const ft = copyFrame(this.allocFrame(), cam.f);
    while (top.parent && !this.covers(top, ft) && ft.kx < TOP_MAX_PX && ft.kt < TOP_MAX_PX) {
      toParent(ft, ft, L.x0(top), L.xs(top), top.t0, top.ts);
      top = top.parent;
    }
    this.stats.topDepth = top.depth;
    this.top = top;
    this.visitNear(top, ft);

    let inst = this.near.count;
    for (const d of this.draws) inst += d.chunk.count;
    this.stats.instances = inst;
    this.stats.draws = this.draws.length + (this.near.count > 0 ? 1 : 0);
    this.stats.nearInstances = this.near.count;
    this.evict();
    this.stats.chunksResident = this.chunks.size;
  }

  private covers(n: LNode, f: Frame): boolean {
    if (f.ox > 0 || f.ox + f.kx < this.W) return false;
    if (n.rv) return this.riverCovers(n, f);
    const bodyBottom = f.oy - f.kt * TAPER_IN;
    if (bodyBottom < this.H) return false;
    if (n.alive) return true; // above "now" is empty for every node
    return f.oy - f.kt * (1 - TAPER_OUT) <= 0;
  }

  /** Does a shaped band cover the whole viewport? (Then nothing above it in the tree is visible.) */
  private riverCovers(n: LNode, f: Frame): boolean {
    // Own T at the bottom and top of the screen.
    const Tb = (f.oy - this.H) / f.kt;
    const Tt = f.oy / f.kt;
    if (Tb < 0) return false;
    if (Tt > 1 && !n.alive) return false;
    const L = this.layout;
    const e: [number, number] = [0, 1];
    const check = (T: number) => {
      L.edgesAt(n, T, e);
      return f.ox + f.kx * e[0] <= 0 && f.ox + f.kx * e[1] >= this.W;
    };
    const hi = Math.min(1, Tt);
    if (!check(Tb) || !check(hi)) return false;
    const Ts = n.rv!.T;
    const o = n.rv!.o;
    for (let k = 0; k < RIVER_S; k++) {
      const t = Ts[o + k];
      if (t > Tb && t < hi && !check(t)) return false;
    }
    return true;
  }

  private offscreen(f: Frame): boolean {
    return f.ox > this.W || f.ox + f.kx < 0 || f.oy < 0 || f.oy - f.kt > this.H;
  }

  private tooSmall(f: Frame, n?: LNode): boolean {
    const kx = n?.rv ? f.kx * this.wmax(n) : f.kx;
    return f.kt < this.minPx || kx < this.minPx * 0.25 || kx * f.kt < this.minPx * this.minPx * 2;
  }

  private wmax(n: LNode): number {
    this.layout.ensureShape(n);
    return n.wmax;
  }

  private worthOpening(f: Frame, n?: LNode): boolean {
    if (n?.rv) {
      // River bands are tall, thin and wander sideways: judge by the band's real width, not its frame.
      const kx = f.kx * this.wmax(n);
      return kx >= RIVER_OPEN_MIN_W && kx * f.kt >= this.chunkOpenArea;
    }
    return f.kx * f.kt >= this.chunkOpenArea;
  }

  private visitNear(n: LNode, f: Frame): void {
    if (this.offscreen(f) || this.tooSmall(f, n)) return;
    const L = this.layout;
    const small = n.chunkRoot && f.kx <= GPU_MAX_PX && f.kt <= GPU_MAX_PX;
    if (small && this.worthOpening(f, n)) {
      this.drawChunk(n, f);
      return;
    }
    const before = this.near.count;
    emitNode(this.near, L, n, f.ox, f.kx, f.oy, -f.kt, this.clipPush, n === this.selected ? FLAG_SELECTED : 0);
    for (let i = before; i < this.near.count; i++) this.nearNodes.push(n);
    this.nearList.push({ n, f });
    if (small) return; // too small to open: drawn as a flat band
    if (this.isPending(n)) {
      if (f.kx >= STUB_REQUEST_PX && f.kt >= STUB_REQUEST_PX) L.source.request?.(n.src as never);
      return;
    }
    const kids = L.children(n);
    for (const c of kids) {
      const fc = toChild(this.allocFrame(), f, L.x0(c), L.xs(c), c.t0, c.ts);
      this.visitNear(c, fc);
    }
  }

  /** Clip a screen-space trapezoid vertically to the viewport, in float64. */
  private isPending(n: LNode): boolean {
    return !n.kids && ((n.info.draw ?? 0) & DRAW_STUB) !== 0 && !!this.layout.source.pending?.(n.src as never);
  }

  private clipPush: PushFn = (b, lb, rb, lt, rt, mb, mt, yb, yt, tint, flags, gb = rb, gt = rt) => {
    // yb is the bottom (larger y), yt the top.
    const lo = -CLIP_MARGIN;
    const hi = this.H + CLIP_MARGIN;
    if (yb <= lo || yt >= hi || yb <= yt) return;
    if (yb > hi) {
      const u = (hi - yb) / (yt - yb);
      lb += (lt - lb) * u;
      rb += (rt - rb) * u;
      mb += (mt - mb) * u;
      gb += (gt - gb) * u;
      yb = hi;
    }
    if (yt < lo) {
      const u = (lo - yb) / (yt - yb);
      lt = lb + (lt - lb) * u;
      rt = rb + (rt - rb) * u;
      mt = mb + (mt - mb) * u;
      gt = gb + (gt - gb) * u;
      yt = lo;
    }
    const xlo = -CLIP_MARGIN;
    const xhi = this.W + CLIP_MARGIN;
    if (rb < xlo && rt < xlo) return;
    if (lb > xhi && lt > xhi) return;
    // Edges entirely off one side can be pulled in without changing what is on screen.
    if (lb < xlo && lt < xlo) lb = lt = xlo - 1;
    if (rb > xhi && rt > xhi) rb = rt = xhi + 1;
    if (mb < xlo && mt < xlo) mb = mt = xlo - 1;
    if (mb > xhi && mt > xhi) mb = mt = xhi + 1;
    if (gb < xlo && gt < xlo) gb = gt = xlo - 1;
    if (gb > xhi && gt > xhi) gb = gt = xhi + 1;
    b.push(lb, rb, lt, rt, mb, mt, yb, yt, tint, flags, gb, gt);
  };

  private drawChunk(root: LNode, f: Frame): void {
    const c = this.getChunk(root);
    this.draws.push({ chunk: c, f });
    if (c.stubIdx.length && this.layout.source.request) {
      const fs = this.allocFrame();
      for (const i of c.stubIdx) {
        const r = c.rel;
        toChild(fs, f, r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
        if (fs.kx >= STUB_REQUEST_PX && fs.kt >= STUB_REQUEST_PX && !this.offscreen(fs)) {
          this.layout.source.request(c.nodes[i].src as never);
        }
      }
      this.frameUsed--;
    }
    const br = c.brel;
    for (let i = 0; i < c.boundary.length; i++) {
      const o = i * 4;
      const fb = toChild(this.allocFrame(), f, br[o], br[o + 1], br[o + 2], br[o + 3]);
      if (this.offscreen(fb) || this.tooSmall(fb, c.boundary[i]) || !this.worthOpening(fb, c.boundary[i])) {
        this.frameUsed--;
        continue;
      }
      this.drawChunk(c.boundary[i], fb);
    }
  }

  getChunk(root: LNode): Chunk {
    let c = this.chunks.get(root.id);
    if (c) {
      this.chunks.delete(root.id); // LRU: move to the end
      this.chunks.set(root.id, c);
    } else {
      c = new Chunk(root);
      this.chunks.set(root.id, c);
    }
    c.lastUsed = this.frameNo;
    const L = this.layout;
    if (c.epoch !== L.geomEpoch) this.buildChunk(c);
    else if (c.dataEpoch !== L.dataEpoch) {
      // New tiles: only chunks whose stubs just got children need rebuilding.
      if (c.stubIdx.some((i) => !L.source.pending?.(c.nodes[i].src as never))) this.buildChunk(c);
      c.dataEpoch = L.dataEpoch;
    }
    return c;
  }

  private buildChunk(c: Chunk): void {
    const L = this.layout;
    const buf = new InstanceBuf();
    const nodes: LNode[] = [];
    const first: number[] = [];
    const proxyFirst: number[] = [];
    const boundary: LNode[] = [];
    const brel: number[] = [];
    const rel: number[] = [];
    const stubIdx: number[] = [];
    // Iterative preorder DFS (parents before children = painter's order).
    const stack: { n: LNode; x0: number; xs: number; t0: number; ts: number }[] = [{ n: c.root, x0: 0, xs: 1, t0: 0, ts: 1 }];
    while (stack.length) {
      const e = stack.pop()!;
      if (this.isPending(e.n)) stubIdx.push(nodes.length);
      nodes.push(e.n);
      first.push(buf.count);
      rel.push(e.x0, e.xs, e.t0, e.ts);
      emitNode(buf, L, e.n, e.x0, e.xs, e.t0, e.ts, null, e.n === this.selected ? FLAG_SELECTED : 0);
      const kids = L.children(e.n);
      for (let i = kids.length - 1; i >= 0; i--) {
        const k = kids[i];
        const x0 = e.x0 + e.xs * L.x0(k);
        const xs = e.xs * L.xs(k);
        const t0 = e.t0 + e.ts * k.t0;
        const ts = e.ts * k.ts;
        if (k.chunkRoot) {
          boundary.push(k);
          brel.push(x0, xs, t0, ts);
          proxyFirst.push(buf.count);
          emitNode(buf, L, k, x0, xs, t0, ts, null, k === this.selected ? FLAG_SELECTED : 0);
        } else {
          stack.push({ n: k, x0, xs, t0, ts });
        }
      }
    }
    c.nodes = nodes;
    c.nodeFirst = first;
    c.rel = new Float64Array(rel);
    c.stubIdx = stubIdx;
    c.proxyFirst = proxyFirst.reverse();
    c.data = buf.data.slice(0, buf.count * INST_FLOATS);
    c.rev = reverseInstances(c.data, buf.count);
    c.count = buf.count;
    // Boundary order: reverse of push order so child chunks draw left to right.
    c.boundary = boundary.reverse();
    const b = new Float64Array(brel.length);
    for (let i = 0; i < c.boundary.length; i++) {
      const src = (c.boundary.length - 1 - i) * 4;
      b[i * 4] = brel[src];
      b[i * 4 + 1] = brel[src + 1];
      b[i * 4 + 2] = brel[src + 2];
      b[i * 4 + 3] = brel[src + 3];
    }
    c.brel = b;
    c.epoch = L.geomEpoch;
    c.dataEpoch = L.dataEpoch;
    c.version++;
    this.stats.chunksBuilt++;
  }

  private evict(): void {
    if (this.chunks.size <= this.maxChunks) return;
    for (const [key, c] of this.chunks) {
      if (this.chunks.size <= this.maxChunks) break;
      if (c.lastUsed === this.frameNo) break; // everything after is newer
      this.chunks.delete(key);
      this.onEvict?.(c);
    }
  }
}
