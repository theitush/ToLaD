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

/**
 * The cover of a tree at one zoom (ToLaD#440): start from `root`; most weight first (`heavier`), replace a group by its
 * parts if all of them still fit `d` apart in their windows (`win`, left to right, in px at this zoom, not clipped to any screen) among
 * the groups beside them; if not it stays, and only it. More groups and narrower windows never make room, so each is
 * tried once. Each try sweeps only as far as it pushes a neighbour: a linked list of the leftmost places.
 */
export function coverOf<G>(root: G, win: (g: G) => [number, number], parts: (g: G) => readonly G[], heavier: (p: G, q: G) => number, d: number): G[] {
  return coverFrom([root], win, parts, heavier, d);
}

/**
 * The same from a cover already standing, left to right (`from`, fitting at these windows): each of it tried once more, and
 * `opened` told of each that splits. Windows only grow with the zoom and what fitted still fits, so a cover carried up the zooms only ever
 * splits (coverLadder).
 */
export function coverFrom<G>(from: readonly G[], win: (g: G) => [number, number], parts: (g: G) => readonly G[], heavier: (p: G, q: G) => number, d: number, opened?: (g: G) => void): G[] {
  type N = { g: G; lo: number; hi: number; x: number; prev: N | null; next: N | null };
  const make = (g: G): N => {
    const [lo, hi] = win(g);
    return { g, lo, hi, x: lo, prev: null, next: null };
  };
  // (A binary heap, heaviest on top.)
  const heap: N[] = [];
  const push = (n: N) => {
    let i = heap.push(n) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heavier(heap[i].g, heap[p].g) <= 0) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): N => {
    const top = heap[0];
    const end = heap.pop()!;
    if (heap.length) {
      heap[0] = end;
      for (let i = 0; ; ) {
        let m = i;
        for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heavier(heap[c].g, heap[m].g) > 0) m = c;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  let first: N | null = null;
  {
    let at: N | null = null;
    for (const g of from) {
      const n = make(g);
      if (at) {
        n.prev = at;
        at.next = n;
        n.x = Math.max(n.lo, at.x + d);
      } else first = n;
      at = n;
      push(n);
    }
  }
  while (heap.length) {
    const n = pop();
    const ps = parts(n.g);
    if (!ps.length) continue;
    const row = ps.map(make);
    let x = n.prev ? n.prev.x : -Infinity;
    let ok = true;
    for (const q of row) {
      q.x = x = Math.max(q.lo, x + d);
      if (x > q.hi) ok = false;
    }
    const pushed: [N, number][] = [];
    for (let e = n.next; ok && e; e = e.next) {
      x = Math.max(e.lo, x + d);
      if (x > e.hi) ok = false;
      else if (x <= e.x) break;
      else pushed.push([e, x]);
    }
    if (!ok) continue;
    for (const [e, ex] of pushed) e.x = ex;
    opened?.(n.g);
    row.forEach((q, i) => {
      q.prev = i ? row[i - 1] : n.prev;
      q.next = i < row.length - 1 ? row[i + 1] : n.next;
      push(q);
    });
    if (n.prev) n.prev.next = row[0];
    else first = row[0];
    if (n.next) n.next.prev = row[row.length - 1];
  }
  const out: G[] = [];
  for (let e = first; e; e = e.next) out.push(e.g);
  return out;
}

/** Zoom steps to a doubling of a cover's ladder: how finely its splits are told apart, nothing on screen measured by it. */
const LADDER_STEPS = 16;

/**
 * A cover per zoom that only ever splits as the zoom grows (ToLaD#440; active ranges, Been, Daiches & Yap 2006: each label has one range of
 * zooms it stands for): from the zoom two labels first fit across the tree, up a ladder of zooms, the cover at each the one
 * below carried on (coverFrom), each group remembering the step it split at. Any zoom's cover is then the tree cut at its step. Climbed as far as asked, once.
 */
export function coverLadder<G>(root: G, wide: number, win: (g: G, sx: number) => [number, number], parts: (g: G) => readonly G[], heavier: (p: G, q: G) => number, d: number): (sx: number) => { list: G[]; at: number } {
  const zero = d / wide;
  const opened = new Map<G, number>();
  let top = -1;
  let now: G[] = [root];
  return (sx) => {
    const k = Math.floor(Math.log2(sx / zero) * LADDER_STEPS);
    if (k < 0) return { list: [root], at: zero };
    for (; top < k; ) {
      const step = ++top;
      const s = zero * 2 ** (step / LADDER_STEPS);
      now = coverFrom(now, (g) => win(g, s), parts, heavier, d, (g) => opened.set(g, step));
    }
    const list: G[] = [];
    const cut = (g: G) => {
      if ((opened.get(g) ?? Infinity) <= k) parts(g).forEach(cut);
      else list.push(g);
    };
    cut(root);
    return { list, at: zero * 2 ** (k / LADDER_STEPS) };
  };
}

/**
 * Of groups side by side, their branches `win` on screen, which can have a label on the screen (ToLaD#440): every window clipped to [lo, hi] (a branch
 * nearer the edge than that: the picture whole against the edge), and while they don't fit, the one going off the edge
 * that doesn't leaves: first and last kept, a run. Those going off give way, nobody else.
 */
export function keepOnScreen(win: readonly (readonly [number, number])[], lo: number, hi: number, d: number): { first: number; slots: Slot[] } {
  const clip = (w: readonly [number, number], left: boolean, right: boolean): Slot => {
    const a = left ? Math.min(Math.max(w[0], lo), hi) : w[0];
    const b = right ? Math.max(Math.min(w[1], hi), lo) : w[1];
    return { lo: a, hi: b, at: (a + b) / 2 };
  };
  let [f, l] = [0, win.length - 1];
  const all = (left: boolean, right: boolean) => win.slice(f, l + 1).map((w) => clip(w, left, right));
  while (f <= l && !fits(all(true, true), d)) {
    const [L, R] = [fits(all(true, false), d), fits(all(false, true), d)];
    const part = (w: readonly [number, number]) => Math.min(w[1], hi) - Math.max(w[0], lo);
    if (!L && R) f++;
    else if (L && !R) l--;
    else if (part(win[f]) < part(win[l])) f++;
    else l--;
  }
  return { first: f, slots: f <= l ? all(true, true) : [] };
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
