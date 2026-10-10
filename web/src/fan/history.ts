// Curated population history (data/mammals HIST, format v1.1) as the fan uses
// it: procgen segments (births per generation, whole generations counted back
// from now), the births curve the layout integrates, and how honestly each
// span of it is known (drawn solid, dashed or dotted).

import type { HistoryRec, HistSegment } from './panthera-extract';

export interface GenSegment {
  generations: number;
  startSize: number;
  endSize: number;
}

/**
 * procgen's segments for a history: whole generations, births per generation
 * rounded to integers (≥ 2: two parents). Oldest first, the last one ends now.
 * With `ever`, the sizes are scaled so the births sum to it (the tiles' EVER is
 * this integral, quantized: the scale is within ~0.1% of 1), which keeps
 * width = individuals exact from the base (ever) to the tip.
 */
export function procgenSegments(h: HistoryRec, ever?: number): GenSegment[] {
  const gens = h.segments.map((s) => Math.max(1, Math.round(s.generations)));
  const raw = h.segments.reduce((a, s, k) => a + (gens[k] * (s.startSize + s.endSize)) / 2, 0);
  const k = ever && raw > 0 ? ever / raw : 1;
  return h.segments.map((s, j) => ({
    generations: gens[j],
    startSize: Math.max(2, Math.round(s.startSize * k)),
    endSize: Math.max(2, Math.round(s.endSize * k)),
  }));
}

/**
 * Births curve of a species, counted back from now: `ago[k]` is the age (years
 * before present) where segment k (newest first) starts and `after[k]` the births
 * after it. Integrates procgen's own linear ramps, so it is the model's curve.
 */
export class BirthCurve {
  /** Total births (the procgen model's total ever, before integer flooring). */
  readonly total: number;
  /** Years before present of each segment's start, newest first. */
  private readonly ago: number[] = [];
  private readonly after: number[] = [];
  private readonly segs: GenSegment[];

  constructor(
    segments: GenSegment[],
    readonly genYears: number,
  ) {
    this.segs = segments.slice().reverse();
    let a = 0;
    let n = 0;
    for (const s of this.segs) {
      a += s.generations * genYears;
      n += (s.generations * (s.startSize + s.endSize)) / 2;
      this.ago.push(a);
      this.after.push(n);
    }
    this.total = n;
  }

  /** Span of the curve in years. */
  get years(): number {
    return this.ago[this.ago.length - 1] ?? 0;
  }

  /** Births per generation at `agoYears` before present (the ramp's value there). */
  sizeAt(agoYears: number): number {
    const k = this.segIndex(agoYears);
    const s = this.segs[k];
    const t = (this.ago[k] - Math.min(agoYears, this.ago[k])) / this.genYears / s.generations;
    return s.startSize + (s.endSize - s.startSize) * Math.max(0, Math.min(1, t));
  }

  /** Births after `agoYears` before present (0 at now, total at the curve's start). */
  bornAfter(agoYears: number): number {
    if (!(agoYears > 0)) return 0;
    if (agoYears >= this.years) return this.total;
    const k = this.segIndex(agoYears);
    const s = this.segs[k];
    const L = s.generations;
    // generations from the segment's start to agoYears, and births in them
    const t = (this.ago[k] - agoYears) / this.genYears;
    const before = s.startSize * t + ((s.endSize - s.startSize) * t * t) / (2 * L);
    return this.after[k] - before;
  }

  private segIndex(agoYears: number): number {
    let lo = 0;
    let hi = this.ago.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ago[mid] >= agoYears) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

/** How well a span of the curve is known, as drawn on the branch edge. */
export type SpanStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Spans backed by real points (held at a measured level) are solid; spans
 * interpolated between points, or a modelled level held where nothing was
 * measured, are dashed; grade D or unverified spans are dotted (and fainter).
 */
export function spanStyle(s: Pick<HistSegment, 'grade' | 'kind'>): SpanStyle {
  if (s.grade === 'D' || s.kind === 'unverified') return 'dotted';
  if (s.kind === 'interpolated' || s.kind === 'model') return 'dashed';
  return 'solid';
}

export interface Span {
  /** Years before present: the span runs from `ago0` (older) to `ago1`. */
  ago0: number;
  ago1: number;
  style: SpanStyle;
  grade: string;
  kind: string;
}

/** The history's spans in years before present, consecutive spans of one style merged. */
export function historySpans(h: HistoryRec): Span[] {
  const out: Span[] = [];
  for (const s of h.segments) {
    const ago0 = h.nowYear - s.year0;
    const ago1 = Math.max(0, ago0 - s.generations * h.G);
    const style = spanStyle(s);
    const prev = out[out.length - 1];
    if (prev && prev.style === style && prev.kind === s.kind && prev.grade === s.grade) prev.ago1 = ago1;
    else out.push({ ago0, ago1, style, grade: s.grade, kind: s.kind });
  }
  return out;
}

/** A history point's age in years before present. */
export function pointAgo(h: HistoryRec, year: number): number {
  return Math.max(0, h.nowYear - year);
}

/** Point and span colours by grade (A best … D worst), shared by the fan's dots and the card's sparkline. */
export const GRADE_COLOR: Record<string, string> = {
  A: '#5fb3ff',
  B: '#a99cff',
  C: '#f2b84b',
  D: '#e8706a',
};

/** Screen-space dash patterns (px, along screen y): dashed edges are subtle, dotted ones fainter. */
export const EDGE_DASH: Record<Exclude<SpanStyle, 'solid'>, { period: number; on: number; alpha: number; lw: number }> = {
  dashed: { period: 7, on: 4, alpha: 0.5, lw: 1 },
  dotted: { period: 4, on: 1.2, alpha: 0.32, lw: 1.2 },
};

/** A span of a branch edge on screen: screen y range (either order) and its style. */
export interface ScreenSpan {
  y0: number;
  y1: number;
  style: SpanStyle;
}

/** History spans on screen, given the screen y of an age (years before present). */
export function toScreenSpans(spans: Span[], sy: (agoYears: number) => number): ScreenSpan[] {
  return spans.map((s) => ({ y0: sy(s.ago0), y1: sy(s.ago1), style: s.style }));
}

/** One dash (or dot) of a styled edge: a straight piece from (x0, y0) to (x1, y1) on screen. */
export interface EdgeMark {
  style: Exclude<SpanStyle, 'solid'>;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Screen x of a polyline edge at screen y (the edge is a function of height:
 * `ys` monotonic, either direction), or NaN outside it.
 */
export function edgeXAt(xs: ArrayLike<number>, ys: ArrayLike<number>, y: number): number {
  const n = ys.length;
  if (n === 0) return NaN;
  const up = ys[n - 1] >= ys[0];
  const lo = up ? ys[0] : ys[n - 1];
  const hi = up ? ys[n - 1] : ys[0];
  if (!(y >= lo && y <= hi)) return NaN;
  let a = 0;
  let b = n - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (ys[m] >= y === up) b = m;
    else a = m;
  }
  const dy = ys[b] - ys[a];
  return dy === 0 ? xs[a] : xs[a] + ((xs[b] - xs[a]) * (y - ys[a])) / dy;
}

/**
 * The dashes and dots of a branch edge: every non-solid span, clipped to the
 * edge's extent and to [yMin, yMax], cut into its style's pattern. The pattern
 * is laid along screen y from `anchorY` (a fixed world height on screen), so
 * dashes move with the branch when it pans and never crawl along it; its pixel
 * sizes are the same at every zoom. Solid spans get no marks (drawn normally).
 */
export function edgeMarks(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  spans: ScreenSpan[],
  anchorY: number,
  yMin: number,
  yMax: number,
): EdgeMark[] {
  const out: EdgeMark[] = [];
  const n = ys.length;
  if (n < 2) return out;
  const eLo = Math.max(yMin, Math.min(ys[0], ys[n - 1]));
  const eHi = Math.min(yMax, Math.max(ys[0], ys[n - 1]));
  for (const s of spans) {
    if (s.style === 'solid') continue;
    const lo = Math.max(eLo, Math.min(s.y0, s.y1));
    const hi = Math.min(eHi, Math.max(s.y0, s.y1));
    if (!(hi > lo)) continue;
    const { period, on } = EDGE_DASH[s.style];
    for (let k = Math.floor((lo - anchorY) / period); ; k++) {
      const d0 = anchorY + k * period;
      if (d0 > hi) break;
      const a = Math.max(lo, d0);
      const b = Math.min(hi, d0 + on);
      if (b <= a) continue;
      out.push({ style: s.style, x0: edgeXAt(xs, ys, a), y0: a, x1: edgeXAt(xs, ys, b), y1: b });
    }
  }
  return out;
}

/**
 * Opacity of each of a history's point dots on a branch edge, from their
 * screen y: going down the screen, a dot shows once it is `minPx` from the
 * last one shown and is fully shown from `minPx + fadePx`, so crowded points
 * (a census a year after the last) wait for a closer zoom and fade in with it.
 */
export function dotAlphas(ys: number[], minPx = 9, fadePx = 12): number[] {
  const order = ys.map((_, k) => k).sort((p, q) => ys[p] - ys[q]);
  const out = ys.map(() => 0);
  let last = -Infinity;
  for (const k of order) {
    const a = Math.max(0, Math.min(1, (ys[k] - last - minPx) / fadePx));
    if (a <= 0) continue;
    out[k] = a;
    last = ys[k];
  }
  return out;
}

/** The style of the history between two calendar years (the compiled segment at their midpoint). */
export function styleBetween(h: HistoryRec, year0: number, year1: number): SpanStyle {
  const mid = (year0 + year1) / 2;
  let seg = h.segments[0];
  for (const s of h.segments) if (s.year0 <= mid) seg = s;
  return seg ? spanStyle(seg) : 'dashed';
}
