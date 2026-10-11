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

  /**
   * The history's points, newest first: years before present and births per
   * generation there, both ends of every segment (where neighbouring
   * segments meet at different sizes, two points at the same age).
   */
  points(): { ago: number; size: number }[] {
    const out: { ago: number; size: number }[] = [];
    this.segs.forEach((s, k) => {
      const a0 = k ? this.ago[k - 1] : 0;
      const last = out[out.length - 1];
      if (!last || last.ago !== a0 || last.size !== s.endSize) out.push({ ago: a0, size: s.endSize });
      out.push({ ago: this.ago[k], size: s.startSize });
    });
    return out;
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

/** Kinds that are the pipeline's model, never a cited figure: drawn dashed, their points hollow. */
export const MODELLED_KINDS = new Set(['natural', 'rangeloss']);

/** How well a span of the curve is known (the card's sparkline draws it so). */
export type SpanStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Spans backed by real points (held at a measured level) are solid; spans
 * interpolated between points, a modelled level held where nothing was
 * measured, or a genomic (PSMC) curve, are dashed; grade D or unverified spans are dotted (and fainter).
 * The natural (pre-human) baseline and the range-loss trend from it (format v1.3) are modelled,
 * always grade D, and draw dashed like `model`.
 */
export function spanStyle(s: Pick<HistSegment, 'grade' | 'kind'>): SpanStyle {
  if (MODELLED_KINDS.has(s.kind)) return 'dashed';
  if (s.grade === 'D' || s.kind === 'unverified') return 'dotted';
  if (s.kind === 'interpolated' || s.kind === 'model' || s.kind === 'genomic') return 'dashed';
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

/** Point and span colours by grade (A best … D worst): the card's sparkline. */
export const GRADE_COLOR: Record<string, string> = {
  A: '#5fb3ff',
  B: '#a99cff',
  C: '#f2b84b',
  D: '#e8706a',
};

/** The grades in plain words, for the sparkline's key (pipeline/history/README.md). */
export const GRADE_WORD: Record<string, string> = {
  A: 'counted',
  B: 'estimated',
  C: 'rough',
  D: 'guess',
};

/** A stretch of a history held flat for want of figures, as the card's sparkline marks it. */
export interface NoDataSpan {
  /** Before the first point (back to the species' start) or after the last (to now). */
  side: 'before' | 'after';
  /** The calendar year the held stretch meets the data: the first or the last point's. */
  year: number;
  /** Individuals alive over the stretch (the level it is held at). */
  level: number;
  /** Held at today's count (no earlier level is known), not at the adjoining point's. */
  today: boolean;
}

const HELD_KINDS = new Set(['held', 'baseline', 'model']);

/**
 * The stretches of a history that no figure covers but that the curve holds
 * flat: from the species' start to the first point (at the baseline or first
 * point's level, or at today's count where no earlier level is known), and
 * from the last point to now.
 */
export function noDataSpans(h: HistoryRec): NoDataSpan[] {
  const pts = h.points.slice().sort((a, b) => a.year - b.year);
  const out: NoDataSpan[] = [];
  if (pts.length === 0 || h.segments.length === 0) return out;
  const first = h.segments[0];
  const p0 = pts[0];
  if (first.year0 < p0.year - 0.5 && HELD_KINDS.has(first.kind)) {
    const today = first.kind === 'model';
    out.push({ side: 'before', year: p0.year, level: today ? (first.startSize * h.L) / h.G : p0.n, today });
  }
  const last = h.segments[h.segments.length - 1];
  const p1 = pts[pts.length - 1];
  if (last.kind === 'held' && p1.year < h.nowYear - 0.5) out.push({ side: 'after', year: p1.year, level: p1.n, today: false });
  return out;
}

/** The style of the history between two calendar years (the compiled segment at their midpoint). */
export function styleBetween(h: HistoryRec, year0: number, year1: number): SpanStyle {
  const mid = (year0 + year1) / 2;
  let seg = h.segments[0];
  for (const s of h.segments) if (s.year0 <= mid) seg = s;
  return seg ? spanStyle(seg) : 'dashed';
}
