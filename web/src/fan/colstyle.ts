// Per-span styles on a species' column in the fan (ToLaD#55): stretches of the
// column drawn differently from a measured span, world-fixed (in years before
// present, so they hold still under zoom). Today one style: `held`, where the
// column is held flat for want of any figure (cited or modelled), drawn faint.
// The same mechanism can carry other per-span styles later (e.g. ToLaD#119's
// "not from a source").

import { noDataSpans } from './history';
import type { SpeciesRec } from './panthera';

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
