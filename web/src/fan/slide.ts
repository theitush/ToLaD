/**
 * Labels on their branches (ToLaD#417): the 1-slider model of point-feature label placement. Each label's centre has a
 * window (its branch's span on screen) and a wish (the window's middle); the labels keep their branches' left-to-right
 * order, their centres at least `d` apart. Whether a set stands: a sweep over
 * the windows. Where: the least squares from their wishes (isotonic regression, pool adjacent violators,
 * inside what the windows leave each), so for a given set every centre is a continuous function of the windows: a
 * steady pinch or pan moves a label smoothly and it never jumps over another.
 */

export interface Slot {
  /** The window its centre may take. */
  lo: number;
  hi: number;
  /** Where it would stand alone. */
  at: number;
}

/** Whether slots `on` (left to right) fit `d` apart in their windows; `out`, if given, their leftmost places. */
function sweep(slots: readonly Slot[], on: readonly number[], d: number, out?: Float64Array): boolean {
  let x = -Infinity;
  for (let i = 0; i < on.length; i++) {
    const s = slots[on[i]];
    x = Math.max(s.lo, x + d);
    if (x > s.hi) return false;
    if (out) out[i] = x;
  }
  return true;
}

/** Whether all of `slots` (left to right) fit `d` apart in their windows. */
export function fits(slots: readonly Slot[], d: number): boolean {
  return sweep(slots, slots.map((_, i) => i), d);
}

/** The centres of slots `on` (left to right): as near their wishes as the windows and `d` let them. */
export function placeSlots(slots: readonly Slot[], on: readonly number[], d: number): Float64Array {
  const n = on.length;
  const x = new Float64Array(n);
  if (!n) return x;
  // (All that any fit allows each: the leftmost and the rightmost places.)
  const lo = new Float64Array(n);
  sweep(slots, on, d, lo);
  const hi = new Float64Array(n);
  let r = Infinity;
  for (let i = n - 1; i >= 0; i--) hi[i] = r = Math.min(slots[on[i]].hi, r - d);
  // (With the gaps taken out, "d apart" is "in order": pool the adjacent violators.)
  const mean: number[] = [];
  const count: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = slots[on[i]].at - i * d;
    let c = 1;
    while (mean.length && mean[mean.length - 1] > m) {
      const c0 = count.pop()!;
      m = (mean.pop()! * c0 + m * c) / (c0 + c);
      c += c0;
    }
    mean.push(m);
    count.push(c);
  }
  let i = 0;
  for (let b = 0; b < mean.length; b++) for (let k = 0; k < count[b]; k++, i++) x[i] = Math.min(Math.max(mean[b] + i * d, lo[i]), hi[i]);
  return x;
}
