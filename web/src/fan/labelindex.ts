// The labels answered for the screen's range only (ToLaD#502, step 2; scalable-tree.md §3, §5 "the cut walk"): a frame's
// labels walk the cover from the root down the branches whose band on the labels' column meets the screen's world x (a
// band holds its parts' bands, so a branch whose band misses the screen has nothing on it: the walk skips it whole), and
// the fossils at their own tips are found by an interval query over their rooms; neither walks every item. What shows is
// the same as from the whole tree: the window is the screen and a margin wider than anything a label stands off its band
// by (WIN_PX), and the one thing a label reads from a neighbour off screen, the next picture's centre (gapLabels' slide),
// is brought in by widening the window to it (slideWindow). That rests on one property of the layout, checked once a
// layout (lanesInOrder): the column's own lanes stand in drawn order, so the cover's members' bands do too.

import { CLADE_PX } from './gapnames';
import { GROUP_D, PIC_D } from './pics';

let indexOn = true;
/** Whether the labels are answered for the screen's range (else from the whole tree, as before ToLaD#502: tests compare the two). */
export const labelIndexOn = (): boolean => indexOn;
/** (Tests.) */
export function setLabelIndex(on: boolean): void {
  indexOn = on;
}

/**
 * How far (px) past the screen a member's band may stand and still put something on it (gapLabels): a picture slides
 * at most its half off its band's ends, a title stands within its own size of its band's top, a guest title within two
 * steps (a title and a hair) of its host's band, and anything is kept up to a title's size off the screen's edge. Twice that.
 */
export const WIN_PX = 2 * (PIC_D + CLADE_PX + GROUP_D);

/**
 * Whether the column's own lanes (ownLanes) stand in drawn order: by strand, each own lane's two edges no lower than
 * the last one's. Then two members of a cut (disjoint runs of strands) have bands in the order of their runs, and the
 * members whose band meets a window are a run of the cut in its order (gapCoverAt's), which the windowed walk relies on.
 */
export function lanesInOrder(own: readonly boolean[], C: ArrayLike<number>, R: ArrayLike<number>): boolean {
  let [lo, hi] = [-Infinity, -Infinity];
  for (let k = 0; k < own.length; k++) {
    if (!own[k]) continue;
    const [a, b] = [C[k] - R[k] / 2, C[k] + R[k] / 2];
    if (a < lo || b < hi) return false;
    [lo, hi] = [a, b];
  }
  return true;
}

/** A member of the cover as the window sees it: its band on the column (world x) from `top`, `band` wide; `on` < 0 for none. */
export interface Banded {
  on: number;
  top: number;
  band: number;
}

/** Whether m's band on the column meets world x [lo, hi]. */
export const bandMeets = (m: Banded, lo: number, hi: number): boolean => m.on >= 0 && m.top <= hi && m.top + m.band >= lo;

/**
 * The window that brings in the pictures a windowed cover's shown pictures slide against (gapLabels: each picture
 * slides clear of the previous and next ones' centres, in the cover's order): the first and the last shown ones'
 * neighbours matter only where their centres stand within `reach` (world: a picture's half and a hair) of those
 * bands' ends, and a neighbour off the window has its band past the window's end (lanesInOrder). So the window reaching
 * that far past both bands holds them; one step, as the members inside keep their neighbours inside. Null: nothing to add.
 */
export function slideWindow(shown: readonly Banded[], lo: number, hi: number, reach: number): [number, number] | null {
  if (!shown.length) return null;
  const [a, b] = [shown[0], shown[shown.length - 1]];
  const [lo1, hi1] = [Math.min(lo, a.top - reach), Math.max(hi, b.top + b.band + reach)];
  return lo1 < lo || hi1 > hi ? [lo1, hi1] : null;
}

/**
 * The strands named at their own tip (tipOrder) as rooms on the world x axis, for the ones whose room meets a window, in
 * tipOrder's order (the order they claim room in: greedy, so the order is kept). An interval query: the rooms by their
 * left edge, a tree of the largest right edge over them, pruned where it ends short of the window; O(log n + found).
 */
export class TipIndex {
  /** The tips (their places in `tips`) by their room's left edge, those edges, and a tree of the largest right edge over them (leaves from `size`). */
  private readonly byLo: Int32Array;
  private readonly lo: Float64Array;
  private readonly maxHi: Float64Array;
  private readonly size: number;
  constructor(
    readonly tips: readonly number[],
    C: ArrayLike<number>,
    R: ArrayLike<number>,
  ) {
    const left = (i: number) => C[tips[i]] - R[tips[i]] / 2;
    const order = tips.map((_, i) => i).sort((p, q) => left(p) - left(q) || p - q);
    this.byLo = Int32Array.from(order);
    this.lo = Float64Array.from(order, left);
    let size = 1;
    while (size < order.length) size *= 2;
    this.size = size;
    this.maxHi = new Float64Array(2 * size).fill(-Infinity);
    order.forEach((i, r) => (this.maxHi[size + r] = C[tips[i]] + R[tips[i]] / 2));
    for (let j = size - 1; j >= 1; j--) this.maxHi[j] = Math.max(this.maxHi[2 * j], this.maxHi[2 * j + 1]);
  }

  /** The tips whose room meets world x [lo, hi], in tipOrder's order. */
  within(lo: number, hi: number): number[] {
    // (The rooms starting at or before hi, a prefix by left edge; of those, the ones ending at or after lo.)
    let [a, b] = [0, this.lo.length];
    while (a < b) {
      const m = (a + b) >> 1;
      if (this.lo[m] <= hi) a = m + 1;
      else b = m;
    }
    const end = a;
    const found: number[] = [];
    // (Node j covers leaves [s, s + n).)
    const stack: number[] = end ? [1, 0, this.size] : [];
    while (stack.length) {
      const n = stack.pop()!;
      const s = stack.pop()!;
      const j = stack.pop()!;
      if (s >= end || this.maxHi[j] < lo) continue;
      if (n === 1) found.push(this.byLo[s]);
      else stack.push(2 * j + 1, s + n / 2, n / 2, 2 * j, s, n / 2);
    }
    return found.sort((p, q) => p - q).map((i) => this.tips[i]);
  }
}
