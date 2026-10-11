// Per-span styles on a species' column in the fan (ToLaD#55, #164): stretches of
// the column drawn differently from a counted span, world-fixed (in years before
// present, so they hold still under zoom). Two styles: `held`, where the column
// is held flat for want of any figure (cited or modelled), drawn faint; and
// `rough`, where it rests on the genome or a model, or on a join the audit flags
// (history.ts basisSpans, ToLaD#119), drawn as a rough estimate: lower contrast,
// its width and texture still read.

import { basisSpans, noDataSpans, ROUGH_BASES } from './history';
import type { HistEvent, SpeciesRec } from './panthera';

export type ColumnStyle = 'held' | 'rough';

export interface ColumnSpan {
  /** Years before present: the span runs from `ago0` (older) up to `ago1`. */
  ago0: number;
  ago1: number;
  style: ColumnStyle;
}

type Tint = { rgb: readonly [number, number, number]; a: number };
/** The background, 0–1 (view.ts BG #0c1714). */
const BG_RGB = [12 / 255, 23 / 255, 20 / 255] as const;

/**
 * The rough look's options (ToLaD#164), `?rough=a|b`: `a` fades the stretch a little towards the
 * background (#55's no-data fade, lighter); `b` washes it towards a mid gray-green, a fog: the dark
 * gaps lift and the bright individuals sink, so the texture flattens without going dark.
 */
export const ROUGH_LOOKS: Record<'a' | 'b', Tint> = {
  a: { rgb: BG_RGB, a: 0.36 },
  b: { rgb: [0.33, 0.38, 0.36], a: 0.4 },
};
export type RoughLook = keyof typeof ROUGH_LOOKS;
export const ROUGH_DEFAULT: RoughLook = 'b';

function roughFromUrl(): RoughLook {
  if (typeof location === 'undefined') return ROUGH_DEFAULT;
  const q = new URLSearchParams(location.search).get('rough');
  return q && q in ROUGH_LOOKS ? (q as RoughLook) : ROUGH_DEFAULT;
}

/**
 * Each style's overlay over its stretch of the lanes, individuals included: a colour (0–1) and how
 * far it covers (0: as counted, 1: the colour alone). Faint, not hidden: the column keeps its width
 * and texture, it only reads as not measured (held) or not counted (rough).
 */
export const COLUMN_TINT: Record<ColumnStyle, Tint> = {
  held: { rgb: BG_RGB, a: 0.55 },
  rough: ROUGH_LOOKS[roughFromUrl()],
};
/** How far each style covers its stretch (COLUMN_TINT's alpha). */
export const COLUMN_DIM: Record<ColumnStyle, number> = {
  held: COLUMN_TINT.held.a,
  rough: COLUMN_TINT.rough.a,
};
/** The styles in the order view.ts indexes them. */
export const COLUMN_STYLES: readonly ColumnStyle[] = ['held', 'rough'];

/**
 * The styled spans of a living species' column, oldest first, clipped to its
 * start (`startMa`, its split in the fan). Held: before its history's first
 * point back to its start (population.ts holds the oldest level there) and
 * after its last point to now (history.ts
 * noDataSpans); a living species whose counts no history drives is the Red
 * List count held flat over its whole column. Rough (ToLaD#164): between
 * those, every stretch history.ts basisSpans puts on the genome, a model or a
 * flagged join. Extinct species: none.
 */
export function columnSpans(sp: SpeciesRec, startMa: number): ColumnSpan[] {
  if (sp.extinct) return [];
  const start = startMa * 1e6;
  const h = sp.history;
  if (!sp.births || !h) return start > 0 ? [{ ago0: start, ago1: 0, style: 'held' }] : [];
  const held: ColumnSpan[] = [];
  let hi = start; // the rough stretches lie below the held lead-in ...
  let lo = 0; // ... and above the held tail
  for (const s of noDataSpans(h)) {
    // (Before: the column holds the first level back to its start, which may be older than the history's.)
    const ago0 = s.side === 'before' ? start : Math.min(start, h.nowYear - s.year);
    const ago1 = s.side === 'before' ? Math.max(0, h.nowYear - s.year) : 0;
    if (s.side === 'before') hi = Math.min(hi, ago1);
    else lo = Math.max(lo, ago0);
    if (ago0 > ago1) held.push({ ago0, ago1, style: 'held' });
  }
  // Rough (ToLaD#164): the genome, model and flagged stretches between them, merged where they meet.
  const rough: ColumnSpan[] = [];
  for (const b of basisSpans(h)) {
    if (!ROUGH_BASES.has(b.basis)) continue;
    const ago0 = Math.min(b.ago0, hi);
    const ago1 = Math.max(b.ago1, lo);
    if (!(ago0 > ago1)) continue;
    const prev = rough[rough.length - 1];
    if (prev && prev.ago1 <= ago0 + 1) prev.ago1 = ago1;
    else rough.push({ ago0, ago1, style: 'rough' });
  }
  return held.concat(rough).sort((a, b) => b.ago0 - a.ago0);
}

/**
 * The second per-span style (ToLaD#141): a curated event on the column (a
 * bottleneck), tinted over its window, lanes and individuals alike, and named
 * by a label beside it. A tint, not a fade: drawn over the held fade, so an
 * event inside a held stretch still shows. No dots or lines on the column.
 */
export const EVENT_TINT = { rgb: [0.93, 0.62, 0.27] as [number, number, number], a: 0.5, css: '#eea045' };

/** An event's window on a species' column, years before present, clipped to the column (`ago0` older). */
export interface EventSpan {
  ago0: number;
  ago1: number;
  /** Index into `sp.history.events`. */
  k: number;
  ev: HistEvent;
}

/**
 * The species' curated events as spans of its own column (above its split at `startMa`), oldest first.
 * Species-wide ones only (ToLaD#149): a regional event (a subpopulation, e.g. India's lions) cannot
 * narrow the whole species' column, so it is neither tinted nor labelled there; the card lists it.
 */
export function eventSpans(sp: SpeciesRec, startMa: number): EventSpan[] {
  const evs = sp.history?.events ?? [];
  const top = sp.t1 * 1e6;
  const start = startMa * 1e6;
  const out: EventSpan[] = [];
  evs.forEach((ev, k) => {
    if (ev.scope === 'regional') return;
    const ago0 = Math.min(start, ev.fromYa);
    const ago1 = Math.max(top, ev.toYa);
    if (ago0 > ago1) out.push({ ago0, ago1, k, ev });
  });
  return out;
}

/** A window's length in log time (a window reaching now counts from 1 year). */
const spanOf = (s: EventSpan) => Math.log(Math.max(1, s.ago0) / Math.max(1, s.ago1));

/**
 * The event a touch hits: the span containing `ago` (years before present), else the nearest one
 * overlapping [agoLo, agoHi] (the touch's reach, a few px, so a window thinner than a finger still
 * answers). Null outside them all: the card is as without events.
 */
export function eventAt(spans: EventSpan[], ago: number, agoLo = ago, agoHi = ago): EventSpan | null {
  let best: EventSpan | null = null;
  let bestD = Infinity;
  for (const s of spans) {
    if (s.ago1 > agoHi || s.ago0 < agoLo) continue;
    // Distance in log time from the touch to the window (0 inside it).
    const d = ago > s.ago0 ? Math.log(ago / s.ago0) : ago < s.ago1 ? Math.log(Math.max(1e-9, s.ago1) / Math.max(1e-9, ago)) : 0;
    // Overlapping windows both holding the touch: the narrower (the more specific) one.
    if (d < bestD || (d === bestD && best && spanOf(s) < spanOf(best))) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
