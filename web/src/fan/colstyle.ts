// Per-span styles on a species' column in the fan (ToLaD#55): stretches of the
// column drawn differently from a measured span, world-fixed (in years before
// present, so they hold still under zoom). Today one style: `held`, where the
// column is held flat for want of any figure (cited or modelled), drawn faint.
// The same mechanism can carry other per-span styles later (e.g. ToLaD#119's
// "not from a source").

import { noDataSpans } from './history';
import type { HistEvent, SpeciesRec } from './panthera';

export type ColumnStyle = 'held';

export interface ColumnSpan {
  /** Years before present: the span runs from `ago0` (older) up to `ago1`. */
  ago0: number;
  ago1: number;
  style: ColumnStyle;
}

/**
 * How far each style fades its stretch of the lanes towards the background (0: as measured, 1: gone).
 * Faint, not hidden: the column keeps its width and colour, it only reads as not measured.
 */
export const COLUMN_DIM: Record<ColumnStyle, number> = {
  held: 0.55,
};

/**
 * The styled spans of a living species' column, oldest first, clipped to its
 * start (`startMa`, its split in the fan). Held: before its history's first
 * point back to its start (population.ts holds the oldest level there) and
 * after its last point to now (history.ts
 * noDataSpans); a living species whose counts no history drives is the Red
 * List count held flat over its whole column. Extinct species: none.
 */
export function columnSpans(sp: SpeciesRec, startMa: number): ColumnSpan[] {
  if (sp.extinct) return [];
  const start = startMa * 1e6;
  const h = sp.history;
  if (!sp.births || !h) return start > 0 ? [{ ago0: start, ago1: 0, style: 'held' }] : [];
  const out: ColumnSpan[] = [];
  for (const s of noDataSpans(h)) {
    // (Before: the column holds the first level back to its start, which may be older than the history's.)
    const ago0 = s.side === 'before' ? start : Math.min(start, h.nowYear - s.year);
    const ago1 = s.side === 'before' ? Math.max(0, h.nowYear - s.year) : 0;
    if (ago0 > ago1) out.push({ ago0, ago1, style: 'held' });
  }
  return out;
}

/**
 * The second per-span style (ToLaD#141): a curated event on the column (a
 * bottleneck), tinted over its window, lanes and individuals alike, and named
 * by a label beside it. A tint, not a fade: drawn over the held fade, so an
 * event inside a held stretch still shows. No dots or lines on the column.
 */
export const EVENT_TINT = { rgb: [0.93, 0.62, 0.27] as [number, number, number], a: 0.34, css: '#eea045' };

/** An event's window on a species' column, years before present, clipped to the column (`ago0` older). */
export interface EventSpan {
  ago0: number;
  ago1: number;
  /** Index into `sp.history.events`. */
  k: number;
  ev: HistEvent;
}

/** The species' curated events as spans of its own column (above its split at `startMa`), oldest first. */
export function eventSpans(sp: SpeciesRec, startMa: number): EventSpan[] {
  const evs = sp.history?.events ?? [];
  const top = sp.t1 * 1e6;
  const start = startMa * 1e6;
  const out: EventSpan[] = [];
  evs.forEach((ev, k) => {
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
