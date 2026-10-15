// A species' column resolved along its height (procgen's model of the species): its lanes and width at any height
// (TwigModel), and the samples its lanes are drawn through (ColumnPath, CutMemo). The individuals' texture inside
// the columns (lines and lives on the GPU, ToLaD#100, #101, #192) was deleted with ?texture=1 (ToLaD#342).

import { Species } from '../../../packages/procgen/src/index.ts';
import { laneAt, leftAt, type FanBranch, type TimeScale, type WidthMode } from './layout';
import type { SpeciesRec } from './panthera';
import type { GenSegment } from './history';

function keyOf(common: string): string {
  return common
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * procgen model of a species from its data. With a curated history that drives
 * the counts (rec.births), procgen follows its compiled segments: births per
 * generation ramp along the real population curve, counted back from now, so
 * the number of strands per generation (and the mesh's width) follows it.
 * Otherwise: G = duration / generation length generations of constant size
 * N = ever / G. Mean lifespan L = alive·duration/ever makes the number alive at
 * the end ≈ N·L/GL = the data's alive count (the pipeline's N_ever ≈ alive ÷
 * lifespan × T read backwards). Extinct species are observed long after their
 * last generation, so nobody is alive.
 *
 * `startMa` is the species' start in the fan (its split): a history that runs
 * on below it (a genomic deep past from its first appearance, ToLaD#60) is
 * clipped there, since below its split its births are the parent column's
 * (whose width is the sum of its daughters' founders), not its own.
 */
export function speciesModel(rec: SpeciesRec, startMa = rec.t0): Species {
  const key = keyOf(rec.common);
  const GL = rec.genYears;
  if (rec.births) {
    return new Species({
      key,
      sexual: true,
      segments: startMa < rec.t0 ? ownSegments(rec.births.segments, Math.floor(((startMa - rec.t1) * 1e6) / GL)) : rec.births.segments,
      generationYears: GL,
      lifespanYears: rec.births.lifespan,
    });
  }
  const years = (rec.t0 - rec.t1) * 1e6;
  const G = Math.max(1, Math.round(years / GL));
  const N = Math.max(2, Math.round(rec.ever / G));
  const lifespan = rec.alive > 0 ? (rec.alive * years) / rec.ever : GL * 0.5;
  return new Species({
    key,
    sexual: true,
    segments: [{ generations: G, startSize: N }],
    generationYears: GL,
    lifespanYears: lifespan,
    now: rec.extinct ? (G + 1000) * GL : undefined,
  });
}

/** procgen segments (oldest first) clipped to their newest `keep` generations; a cut segment starts at its ramp's value there. */
export function ownSegments(segs: readonly GenSegment[], keep: number): GenSegment[] {
  let drop = segs.reduce((a, s) => a + s.generations, 0) - Math.max(1, keep);
  if (drop <= 0) return segs.slice();
  const out: GenSegment[] = [];
  for (const s of segs) {
    if (drop >= s.generations) {
      drop -= s.generations;
      continue;
    }
    if (drop > 0) {
      const B = s.endSize;
      const A = Math.max(2, Math.round(s.startSize + ((B - s.startSize) * drop) / s.generations));
      out.push({ generations: s.generations - drop, startSize: A, endSize: B });
      drop = 0;
    } else out.push(s);
  }
  return out;
}

export class TwigModel {
  readonly sp: Species;
  readonly rec: SpeciesRec;
  readonly G: number;
  readonly T: number;
  readonly GL: number;
  /** Generations a twig can span (lifespans reach up to 2× the mean). */
  readonly span: number;
  /** First generation in which anybody can still be alive (G if extinct). */
  readonly aliveFrom: number;
  /**
   * Age (Ma) of procgen's time 0, the start of generation 0. The species' first
   * appearance, or with a history (counted back from now) the end of its last
   * generation minus all its generations, so the generations land on their
   * real calendar years and the last one ends at the tip.
   */
  readonly origin: number;

  constructor(
    readonly b: FanBranch,
    readonly time: TimeScale,
    readonly mode: WidthMode,
  ) {
    this.rec = b.sp;
    this.sp = speciesModel(b.sp, b.t0);
    this.G = this.sp.generations;
    this.T = Number(this.sp.totalEver);
    this.GL = this.sp.generationYears;
    this.span = Math.ceil((2 * this.sp.lifespanYears) / this.GL) + 1;
    this.aliveFrom = this.rec.extinct ? this.G : Math.max(0, this.G - this.span);
    this.origin = this.rec.births ? this.rec.t1 + (this.G * this.GL) / 1e6 : this.rec.t0;
  }

  size(g: number): number {
    return Number(this.sp.size(g));
  }

  /** Age (Ma) of a moment `tYears` after procgen's time 0 (the species' first appearance). */
  ageOf(tYears: number): number {
    return Math.max(0, this.origin - tYears / 1e6);
  }

  yOf(tYears: number): number {
    return this.time.y(this.ageOf(tYears));
  }

  /** Years before present of the middle of generation g's births. */
  bornAgo(g: number): number {
    return this.ageOf((g + 0.5) * this.GL) * 1e6;
  }

  /** Generation born at world height y (clamped). */
  generationAt(y: number): number {
    const age = this.time.ageAt(y);
    const t = (this.origin - age) * 1e6;
    return Math.min(this.G - 1, Math.max(0, Math.floor(t / this.GL)));
  }

  /** Generation born at world height y, unclamped (negative below the species' first: its ancestors). */
  generationAtRaw(y: number): number {
    const age = this.time.ageAt(y);
    return Math.floor(((this.origin - age) * 1e6) / this.GL);
  }

  /** Branch width at world height y (the fan's width function, layout.ts). */
  widthAt(y: number): number {
    return this.at(y)[1];
  }

  /** Branch width and left edge at the height of generation g's births (row centre). */
  row(g: number): { y: number; left: number; w: number; n: number } {
    const y = this.yOf((g + 0.5) * this.GL);
    const r = this.at(y);
    return { y, left: r[0], w: r[1], n: this.size(g) };
  }

  /**
   * The branch's two lanes at height y, exactly as the fan draws them: the
   * living's green lane on the left (constant width), the dead's gray lane on
   * the right (thinning as they peel off). World units.
   */
  lanes(y: number): { left: number; w: number; gw: number } {
    const r = this.at(y);
    return { left: r[0], w: r[1], gw: r[2] };
  }

  /** [left, w, gw, pitch] at y into out[o..o + 3], worked out (not remembered: at()). */
  sample(y: number, out: Float64Array, o: number): void {
    const L = laneAt(this.b, y);
    out[o] = leftAt(this.b, y, L.w);
    out[o + 1] = L.w;
    out[o + 2] = L.gw;
    out[o + 3] = this.pitchOf(y, L.w);
  }

  /** The left edge at y of a column w wide there (sample()'s first value; the fold's alone moves it). */
  left(y: number, w: number): number {
    return leftAt(this.b, y, w);
  }

  /**
   * The left edges just below and just above y (y ± 1e-9 relative) into out[o] and out[o + 4], of a column
   * out[o + 1] and out[o + 5] wide there (left()'s twice, as CutMemo and ColumnPath keep them). Folded on a grid
   * and away from its split (where the fold's edge turns from a slot's left edge into its own column's centre),
   * the fold's edge runs on through y continuously: read once, ToLaD#209.
   */
  leftPair(y: number, out: Float64Array, o: number): void {
    const b = this.b;
    const f = b.tess.fold;
    const h = f ? f.gridH : 0;
    if (!(h > 0) || Math.abs(y - b.splitY) <= 2 * h) {
      const e = 1e-9 * Math.max(1, Math.abs(y));
      out[o] = this.left(y + e, out[o + 1]);
      out[o + 4] = this.left(y - e, out[o + 5]);
      return;
    }
    const l = f!.left(b.index, y)!;
    if (y < b.splitY) {
      out[o] = l - out[o + 1] * 0.5;
      out[o + 4] = l - out[o + 5] * 0.5;
    } else out[o] = out[o + 4] = l;
  }

  /** The lanes at the fan's sample heights (CutMemo), kept from frame to frame. */
  readonly cutMemo = new CutMemo(this);
  /** The column's edges as drawn (ColumnPath). */
  readonly path: ColumnPath = new ColumnPath(this);

  /** at()'s values by height: [left, w, gw, pitch, the fold version its left is for]. */
  private readonly atMemo = new Map<number, Float64Array>();
  /** Bumped by refold(): a kept left edge from before it is worked out again (the widths and pitch stand). */
  private foldVer = 0;
  /**
   * The fold moved the columns (fold.ts): their left edges are read again, the
   * rest kept (the widths and the pitch do not depend on where a column stands:
   * ToLaD#146, the fold changes on every pan and pinch).
   */
  refold(): void {
    this.foldVer++;
    this.cutMemo.reset();
    this.path.reset();
  }
  /** The fold came to rest (fold.ts): the column's edges as drawn, exact (ColumnPath.exact). */
  foldRest(): void {
    this.path.exact();
  }
  /**
   * lanes() and pitch() at y: [left, w, gw, pitch], remembered (#32: the fan
   * samples at world-fixed heights, mostly the same ones frame after frame).
   */
  at(y: number): Float64Array {
    let r = this.atMemo.get(y);
    if (r) {
      if (r[4] !== this.foldVer) {
        r[0] = this.left(y, r[1]);
        r[4] = this.foldVer;
      }
      return r;
    }
    if (this.atMemo.size >= 1 << 15) this.atMemo.clear();
    r = new Float64Array(5);
    this.sample(y, r, 0);
    r[4] = this.foldVer;
    this.atMemo.set(y, r);
    return r;
  }

  /**
   * World width of one individual at height y, the same in both lanes: the
   * column is one lattice of slots from its left edge, the green lane's
   * first, then the gray lane's. Linear widths: the fan's fixed width per
   * individual (constant: the lattice is fixed in the world). Log widths: the
   * column's width over the individuals alive there.
   */
  pitch(y: number): number {
    // (By mass, ToLaD#276: one individual is its adult mass wide, pop.weight units.)
    return this.mode === 'linear' ? this.b.unit * this.b.pop.weight : this.at(y)[3];
  }

  /** pitch(y), the column's width there w. */
  private pitchOf(y: number, w: number): number {
    const lin = this.b.unit * this.b.pop.weight;
    if (this.mode === 'linear') return lin;
    const n = this.b.pop.stepAt(Math.min(this.b.t0, this.time.ageAt(y))).n / this.b.pop.weight;
    // (Never wider than the column: one slot at least, where the steps count under one alive.)
    return w > 0 && n > 0 ? w / Math.max(1, n) : lin;
  }
}

// ---- drawing ------------------------------------------------------------------

/** The living: a deep, saturated green. */
export const LIVING = '#3fd286';
/** Dead, with living descendants: a paler green. */
export const LINEAGE = '#c8efc4';
/** Dead, line ended. */
export const TWIG_GRAY = '#95a2b0';

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The lanes' fill dims towards a dark tint of itself (wide lanes)... */
const DIM_WIDE = 0.72;
/** ...less where a lane is narrow. A lane `px` wide: its dimming (0–1). */
const DIM_NARROW = 0.3;
export function laneDim(px: number): number {
  return DIM_WIDE + (DIM_NARROW - DIM_WIDE) * (1 - smoothstep((px - 2) / 8));
}

/**
 * A column's lanes at the fan's sample heights (Tess.cuts), just below and
 * just above each (a split steps the green lane there; each chord takes its
 * ends from inside it), kept from frame to frame (#32): the samples are
 * world-fixed, mostly the same ones as last frame, so each frame walks the
 * last one's (both ascending) and works out only the new heights.
 * Per sample k: below at [8k .. 8k + 3], above at [8k + 4 .. 8k + 7] (TwigModel.sample).
 */
export class CutMemo {
  private ys = new Float64Array(0);
  private v = new Float64Array(0);
  /** The heights of the last update(), and their values. */
  n = 0;
  /** How many of the last update()'s heights were new (worked out, not kept): a ColumnPath build's cost, pathFrame. */
  fresh = 0;
  /** Whether the kept left edges are stale (reset(): the fold moved the columns; the widths and pitch stand). */
  private stale = false;
  constructor(private readonly m: { sample(y: number, out: Float64Array, o: number): void; leftPair?(y: number, out: Float64Array, o: number): void }) {}
  /** The fold moved the columns (fold.ts): the kept left edges are read again, the rest kept. */
  reset(): void {
    if (this.m.leftPair) this.stale = true;
    else this.n = 0;
  }
  update(cuts: ArrayLike<number>): Float64Array {
    const n = cuts.length;
    const oy = this.ys;
    // (The same heights as last time (a refold's re-choice, the zoom about the same): their left edges read again in place.)
    this.fresh = 0;
    if (n === this.n) {
      let k = 0;
      while (k < n && oy[k] === cuts[k]) k++;
      if (k === n) {
        if (this.stale) for (let i = 0; i < n; i++) this.m.leftPair!(oy[i], this.v, 8 * i);
        this.stale = false;
        return this.v;
      }
    }
    // (Into the spare buffers, swapped with the kept ones at the end: no garbage a frame.)
    if (this.ys2.length < n) {
      this.ys2 = new Float64Array(n + (n >> 2));
      this.v2 = new Float64Array(8 * (n + (n >> 2)));
    }
    const ys = this.ys2;
    const v = this.v2;
    const ov = this.v;
    const stale = this.stale;
    let j = 0;
    for (let k = 0; k < n; k++) {
      const y = cuts[k];
      ys[k] = y;
      while (j < this.n && oy[j] < y) j++;
      const e = 1e-9 * Math.max(1, Math.abs(y));
      if (j < this.n && oy[j] === y) {
        for (let i = 0; i < 8; i++) v[8 * k + i] = ov[8 * j + i];
        if (stale) this.m.leftPair!(y, v, 8 * k);
        continue;
      }
      this.m.sample(y + e, v, 8 * k);
      this.m.sample(y - e, v, 8 * k + 4);
      this.fresh++;
    }
    this.ys2 = this.ys;
    this.v2 = this.v;
    this.ys = ys;
    this.v = v;
    this.n = n;
    this.stale = false;
    return v;
  }
  private ys2 = new Float64Array(0);
  private v2 = new Float64Array(0);
}

/** How far (screen px) a merged chord may stray from the samples it drops (Sleeve). */
export const CHORD_TOL_PX = 0.2;

/**
 * Merging a polyline's samples into longer chords (#32): a run from its first
 * sample may end at a later one while every sample in between stays within
 * its tolerance of the straight chord, value by value (the sleeve: the
 * slopes from the run's start that keep them all in). Screen px, y monotone.
 */
export class Sleeve {
  private y0 = 0;
  private readonly v0: Float64Array;
  private readonly lo: Float64Array;
  private readonly hi: Float64Array;
  private n = 0;
  constructor(readonly k: number) {
    this.v0 = new Float64Array(k);
    this.lo = new Float64Array(k);
    this.hi = new Float64Array(k);
  }
  /** A new run from (y, v). */
  start(y: number, v: ArrayLike<number>): void {
    this.y0 = y;
    for (let i = 0; i < this.k; i++) {
      this.v0[i] = v[i];
      this.lo[i] = -Infinity;
      this.hi[i] = Infinity;
    }
    this.n = 0;
  }
  /** Take (y, v) in as a sample the run passes (within tol[i] of value i). */
  pass(y: number, v: ArrayLike<number>, tol: ArrayLike<number>): void {
    const du = Math.abs(y - this.y0);
    for (let i = 0; i < this.k; i++) {
      this.lo[i] = Math.max(this.lo[i], (v[i] - tol[i] - this.v0[i]) / du);
      this.hi[i] = Math.min(this.hi[i], (v[i] + tol[i] - this.v0[i]) / du);
    }
    this.n++;
  }
  /** Can the run end at (y, v), keeping every sample passed within its tolerance? */
  fits(y: number, v: ArrayLike<number>): boolean {
    const du = Math.abs(y - this.y0);
    if (!(du > 0)) return false;
    for (let i = 0; i < this.k; i++) {
      const s = (v[i] - this.v0[i]) / du;
      if (!(s >= this.lo[i] && s <= this.hi[i])) return false;
    }
    return true;
  }
}

/**
 * A column's edges as drawn (#32): the fan's samples (Tess.cuts) with those
 * dropped where the chords either side of them run straight on screen (within
 * CHORD_TOL_PX at its left and right edges and its green lane's, its pitch
 * across the slots: Sleeve), over the screen and a screen beyond it either
 * way, kept while the zoom stays within PATH_ZOOM of the one it was made at
 * (the dropped samples stay within the tolerance, scaled) and the cuts' grid
 * is the same: a pinch or a pan mostly redraws the same few chords instead
 * of sampling the column anew every frame. Per kept sample k, in world units:
 * the lanes just below it at vals[8k .. 8k + 3] (the chord from it down),
 * just above it at [8k + 4 .. 8k + 7] (the chord up to it): CutMemo.
 */
export class ColumnPath {
  ys = new Float64Array(0);
  vals = new Float64Array(0);
  /** Per kept sample: 1 where the lanes step (left, width or green width differ just below and just above: a split). */
  steps = new Uint8Array(0);
  n = 0;
  private sxRef = 0;
  private grid = NaN;
  private yLo = 0;
  private yHi = 0;
  constructor(private readonly m: TwigModel) {}
  private ys2 = new Float64Array(0);
  private vals2 = new Float64Array(0);
  private steps2 = new Uint8Array(0);
  /** build()'s last cuts and the span and grid they are for. */
  private cuts: number[] = [];
  private cutsA = NaN;
  private cutsB = NaN;
  private cutsGrid = NaN;

  /** Whether some kept samples' left edges are from an older fold (reset(); read again as span() reaches them). */
  private stale = false;
  /** The fold's moves so far (reset()), and per kept sample the one its left edges were read at. */
  private gen = 0;
  private leftGen = new Int32Array(0);
  /** How many times the fold moved the columns since the kept samples were chosen (reset()), and ever. */
  private moved = 0;
  private ticks = 0;
  /** The kept samples are due to be chosen afresh (reset()'s turn, exact()): at the next span() the frame's budget allows (pathFrame). */
  private redo = false;

  /**
   * The fold moved the columns (fold.ts, ToLaD#146: on every pan and pinch, folded): the kept samples stay,
   * their left edges read again (the fold moves a column smoothly, by a little a frame), and every
   * PATH_REFOLDS-th time they are chosen afresh (the columns' phases staggered, a few a frame); exact()
   * chooses them afresh once the fold comes to rest.
   */
  reset(): void {
    this.ticks++;
    this.gen++;
    if (this.n === 0) return;
    this.stale = true;
    this.moved++;
    // (Every PATH_REFOLDS-th: chosen afresh, when the frame's budget allows (span(), pathFrame); drawn till then as they
    // are, their left edges read again: ToLaD#313, at the mammal level ~3,000 strands a frame were forgotten in turn.)
    if ((this.ticks + this.m.b.index) % PATH_REFOLDS === 0) this.redo = true;
  }

  /** The fold came to rest: the kept samples chosen afresh if it moved since they were (reset()), as the frame's budget allows. */
  exact(): void {
    if (this.moved > 0) this.redo = true;
  }

  /** The kept samples i0..i1's left edges at the fold as it is now (the widths and pitch stand): those span() hands out, the rest when it reaches them. */
  private releft(i0: number, i1: number): void {
    const v = this.vals;
    const G = this.leftGen;
    for (let k = i0; k <= i1; k++) {
      if (G[k] === this.gen) continue;
      G[k] = this.gen;
      this.m.leftPair(this.ys[k], v, 8 * k);
    }
  }

  /** The kept samples over [lo, hi] (world): [i0, i1], the last at or above lo and the first at or below hi. */
  span(sx: number, sy: number, lo: number, hi: number): [number, number] {
    const b = this.m.b;
    lo = Math.max(lo, b.tipY);
    hi = Math.min(hi, b.tess.bottom);
    if (!(hi > lo)) return [0, -1];
    const grid = Math.floor(Math.log2(4 / Math.max(1e-12, sy)));
    const z = Math.abs(Math.log(sx / this.sxRef));
    // Made again: at once where it must be (none kept, the span past the kept one's, the zoom past PATH_ZOOM twice
    // over or the grid two steps off); else (the zoom past PATH_ZOOM, the grid a step off, due afresh) as the frame's
    // budget allows (pathFrame, ToLaD#313: a pinch across PATH_ZOOM or a grid step made every path again on one frame,
    // seconds at the mammal level), meanwhile drawn as it is: its chords within CHORD_TOL_PX * PATH_ZOOM, its samples
    // at most twice as far apart.
    const must = this.n === 0 || lo < this.yLo || hi > this.yHi || !(z < 2 * Math.log(PATH_ZOOM)) || !(Math.abs(grid - this.grid) <= 1);
    if (must || ((this.redo || !(z < Math.log(PATH_ZOOM)) || grid !== this.grid) && pathFrame.spend())) {
      this.build(sx, sy, lo, hi, grid);
      pathFrame.left -= this.cuts.length + PATH_FRESH * this.m.cutMemo.fresh;
    }
    // (Bisect: the last kept at or above lo, the first at or below hi.)
    const ys = this.ys;
    let a = 0;
    let e = this.n;
    while (a < e) {
      const h = (a + e) >> 1;
      if (ys[h] <= lo) a = h + 1;
      else e = h;
    }
    const i0 = Math.max(0, a - 1);
    a = i0;
    e = this.n;
    while (a < e) {
      const h = (a + e) >> 1;
      if (ys[h] < hi) a = h + 1;
      else e = h;
    }
    const i1 = Math.min(this.n - 1, a);
    if (this.stale) this.releft(i0, i1);
    return [i0, i1];
  }

  private build(sx: number, sy: number, lo: number, hi: number, grid: number): void {
    const b = this.m.b;
    const d = hi - lo;
    const A = Math.max(b.tipY, lo - d);
    const B = Math.min(b.tess.bottom, hi + d);
    // (The same span on the same grid as last time (a refold's re-choice at home): the same cuts.)
    if (!(this.cutsA === A && this.cutsB === B && this.cutsGrid === grid)) {
      this.cuts = b.tess.cuts(b, A, B, sy, 4);
      this.cutsA = A;
      this.cutsB = B;
      this.cutsGrid = grid;
    }
    const cuts = this.cuts;
    const v = this.m.cutMemo.update(cuts);
    const n = cuts.length;
    // (Into the spare buffers, swapped with the kept ones at the end: no garbage a frame. The kept ones are read
    // only until the next span().)
    if (this.ys2.length < n) {
      const c = n + (n >> 2);
      this.ys2 = new Float64Array(c);
      this.vals2 = new Float64Array(8 * c);
      this.steps2 = new Uint8Array(c);
    }
    const ys = this.ys2;
    const out = this.vals2;
    const steps = this.steps2;
    // In world units: the tolerance at this zoom, a little under CHORD_TOL_PX (the zoom moves on).
    const tolX = CHORD_TOL_PX / PATH_ZOOM / sx;
    // The lanes step at the splits (the green lane: the strand leaves its parent's prefix there).
    const splits = b.path;
    let sp = 0;
    const isSplit = (y: number) => {
      while (sp < splits.length && splits[sp].y < y) sp++;
      return sp < splits.length && splits[sp].y === y;
    };
    let k = 0;
    const keep = (i: number) => {
      ys[k] = cuts[i];
      for (let j = 0; j < 8; j++) out[8 * k + j] = v[8 * i + j];
      steps[k] = isSplit(cuts[i]) ? 1 : 0;
      k++;
    };
    const val = new Float64Array(4);
    const tol = new Float64Array(4);
    // Per sample, from the lanes at offset o: left, right and green edges, and the pitch.
    const ends = (o: number) => {
      val[0] = v[o];
      val[1] = v[o] + v[o + 1];
      val[2] = v[o + 2] > 0 ? v[o] + v[o + 2] : 0;
      val[3] = v[o + 3];
      return val;
    };
    const sl = new Sleeve(4);
    keep(0);
    sl.start(cuts[0], ends(0));
    for (let i = 1; i + 1 < n; i++) {
      const y = cuts[i];
      const o = 8 * i;
      // A sample may go only where the lanes go on through it (not at a split, where the green lane
      // steps), its chords both drawn or both not (a column of no width), green or not alike.
      const w0 = v[o + 1] > 0;
      const g0 = v[o + 2] > 0;
      // (Elsewhere both the lanes just below it and just above it stay within the tolerance.)
      const soft =
        !isSplit(y) &&
        w0 === v[o - 8 + 1] > 0 &&
        w0 === v[o + 8 + 4 + 1] > 0 &&
        g0 === v[o - 8 + 2] > 0 &&
        g0 === v[o + 8 + 4 + 2] > 0;
      if (soft) {
        tol[0] = tol[1] = tol[2] = tolX;
        // (The pitch within the tolerance over all the column's slots: its lines stay within it.)
        tol[3] = (tolX * v[o + 3]) / Math.max(v[o + 3], v[o + 1]);
        sl.pass(y, ends(o), tol);
        sl.pass(y, ends(o + 4), tol);
        if (sl.fits(cuts[i + 1], ends(8 * (i + 1) + 4))) continue;
      }
      keep(i);
      sl.start(y, ends(o));
    }
    if (n > 1) keep(n - 1);
    this.ys2 = this.ys;
    this.vals2 = this.vals;
    this.steps2 = this.steps;
    this.ys = ys;
    this.vals = out;
    this.steps = steps;
    this.n = k;
    if (this.leftGen.length < k) this.leftGen = new Int32Array(ys.length);
    this.leftGen.fill(this.gen, 0, k);
    this.sxRef = sx;
    this.grid = grid;
    this.yLo = A;
    this.yHi = B;
    this.stale = false;
    this.moved = 0;
    this.redo = false;
  }
}

/**
 * The ColumnPaths' builds a frame (ToLaD#313), in work: each its cuts, and PATH_FRESH more for each height
 * worked out anew (CutMemo.fresh). While the view moves (a gesture, a flight) a frame spends up to PATH_BUDGET
 * on the builds that can wait (ColumnPath.span), the rest the next frames in turn; at rest, all at once.
 */
export const pathFrame = {
  left: Infinity,
  /** Builds put off this frame. */
  owed: 0,
  /** A new frame: moving, the budget; at rest, none. */
  start(moving: boolean): void {
    this.left = moving ? PATH_BUDGET : Infinity;
    this.owed = 0;
  },
  /** Whether a build that can wait goes this frame. */
  spend(): boolean {
    if (this.left > 0) return true;
    this.owed++;
    return false;
  },
};
/** ~30 ms of builds on this machine's node (~0.25 µs a unit), ~120 on a mid phone. */
const PATH_BUDGET = 120_000;
/** A height worked out anew (TwigModel.sample twice) costs about this many cuts. */
const PATH_FRESH = 4;

/** How far the zoom may move from the one a ColumnPath was made at (either way) before it is made again. */
const PATH_ZOOM = 1.4;
/** A ColumnPath chooses its samples afresh every this many moves of the fold (between, it reads their left edges again). */
const PATH_REFOLDS = 8;
