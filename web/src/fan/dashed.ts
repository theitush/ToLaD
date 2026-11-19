// A column whose count nobody has (FLAG bit 11, `count_unknown`, ToLaD#507) drawn as one thin dashed line (ToLaD#565,
// Ita: "what we dont have pop estiamtes for lets draw as single dashed lines"): its whole life, tip to split, centred in
// the room it has (the layout is the same: its room, its place, its taps), at a constant screen width with the dash
// in screen px, so it reads the same at every zoom. Its colour by the band's rules (green, gray). A column all of whose
// species are such (a clade's below its split; a merged clade, lod.ts) is one dashed line too, at its centre; a column
// with any counted species in it is the band it was (its width still the counts', where there are counts). The old look
// (the faint band at the thinnest width, colstyle.ts `unknown`) is one tap away, `?unknown=faint`.

import { isNode, type Fan, type FanBranch, type FanNode } from './layout';

/** How a column whose count nobody has is drawn: one dashed line (the page), or the faint band (the old look). */
export type UnknownLook = 'dashed' | 'faint';
export const UNKNOWN_LOOKS: UnknownLook[] = ['dashed', 'faint'];
let lookNow: UnknownLook = 'dashed';
export const unknownLook = (): UnknownLook => lookNow;
export const setUnknownLook = (m: UnknownLook): void => {
  lookNow = m;
};

/** The line (css px): its width across, its dashes and the gaps between them along it. */
export const DASH_W = 1.25;
export const DASH_ON = 4;
export const DASH_OFF = 3;
export const DASH_PERIOD = DASH_ON + DASH_OFF;
/**
 * The least spacing (css px, centre to centre) at which neighbouring dashed lines are drawn each its own: a line's width
 * and, across, as much room as a dash's gap has along it. Closer, a clade with no count in it is one line (lod.ts): rooms
 * packed closer than this read as a striped block, not as lines. Zoomed in, it parts into its daughters' lines.
 */
export const DASH_SPACE = DASH_W + DASH_OFF;

/** A stretch of a column drawn as no line at all: another column's line holds it (its first strand's, dashSpans). */
export const DASH_SKIP = Infinity;

/** Per fan: each node's every strand count unknown (from the daughters up, as lod.ts's all gray). */
const ALL_UNKNOWN = new WeakMap<Fan, WeakMap<FanNode, boolean>>();
function allUnknownMap(fan: Fan): WeakMap<FanNode, boolean> {
  let m = ALL_UNKNOWN.get(fan);
  if (m) return m;
  m = new WeakMap();
  // (fan.nodes: parents before daughters, so from the end each node's daughters are known.)
  for (let i = fan.nodes.length - 1; i >= 0; i--) {
    const v = fan.nodes[i];
    let all = v.strands.length > 0;
    for (const k of v.kids) if (!(isNode(k) ? m.get(k) : k.sp.countUnknown)) all = false;
    m.set(v, all);
  }
  ALL_UNKNOWN.set(fan, m);
  return m;
}

/** Every species in clade v's column has no count (nobody has its number). */
export function allUnknown(fan: Fan, v: FanNode): boolean {
  return allUnknownMap(fan).get(v) ?? false;
}

/**
 * The dashed stretches of a column, world y, top down: [top, bottom, off] triples. `off`: the line's centre from the
 * column's own centre (world x; 0: its own), or DASH_SKIP: drawn by another (nothing here). Outside them the column is
 * its band. A strand (holder: its first strand's, so each column's line is drawn once) or a merged clade (lod.ts):
 * its own column from its top down to where it joins its parent, then each parent column that has no count in it, the
 * line at that column's centre, drawn by the one holding its first strand. Up the tree the columns only grow, so the
 * first one with a count in it ends the walk: below it, a slice of a band as ever.
 */
function spansDown(fan: Fan, top: number, bot: number, own: boolean, u: FanNode | null, first: FanBranch, width: number): number[] {
  const out: number[] = [];
  if (!own) return out;
  out.push(top, bot, 0);
  const all = allUnknownMap(fan);
  for (; u && all.get(u); u = u.parent) out.push(u.y, u.yBot, u.strands[0] === first ? (u.width - width) / 2 : DASH_SKIP);
  return out;
}

const STRAND_SPANS = new WeakMap<FanBranch, number[]>();
const NO_SPANS: number[] = [];
/** Strand b's dashed stretches (world, spansDown): none unless its count is unknown. Kept: world-fixed. */
export function strandDashes(fan: Fan, b: FanBranch): number[] {
  if (!b.sp.countUnknown) return NO_SPANS;
  let s = STRAND_SPANS.get(b);
  if (!s) STRAND_SPANS.set(b, (s = spansDown(fan, -Infinity, b.splitY, true, b.node, b, b.baseW)));
  return s;
}

const NODE_SPANS = new WeakMap<FanNode, number[]>();
/** Merged clade v's dashed stretches (world, spansDown): none unless no species in it has a count. Kept: world-fixed. */
export function cladeDashes(fan: Fan, v: FanNode): number[] {
  let s = NODE_SPANS.get(v);
  if (!s) NODE_SPANS.set(v, (s = v.strands.length ? spansDown(fan, -Infinity, v.yBot, allUnknown(fan, v), v.parent, v.strands[0], v.width) : NO_SPANS));
  return s;
}

/** The line's offset (spansDown's `off`) at screen y, of screen spans [top, bottom, off]; NaN in none (its band). */
export function dashAt(spans: readonly number[], y: number): number {
  for (let k = 0; k < spans.length; k += 3) if (y >= spans[k] && y <= spans[k + 1]) return spans[k + 2];
  return NaN;
}

/**
 * The dashed chords drawn this frame (screen px), by bands of rows (ToLaD#565): DASH_SPACE on screen, row by row. Two
 * columns' lines within DASH_SPACE of each other over the rows they share are one line, as a packed clade is (lod.ts):
 * the first drawn holds it, green if either lives, and they part where they part, by zoom and by height. Columns sit
 * side by side by the rows they live in (the rooms by life, steady.ts), not by the tree order: a fossil group's line
 * runs beside another's once the groups between them have died out, so the rule is read on screen, not off the tree.
 * Kept across frames (clear(), no allocation once grown): per band the chords that cross it, sorted by their least x.
 */
export class DashRows {
  /** A band's height (px). */
  static readonly BAND = 8;
  /** Per chord: its rows, its ends' x, its column, green, its place in the batch (ref, -1: none), its dash's phase. */
  private y0 = new Float64Array(256);
  private y1 = new Float64Array(256);
  private cq = new Float64Array(256);
  private cp = new Float64Array(256);
  private colOf = new Int32Array(256);
  private liveOf = new Uint8Array(256);
  private refOf = new Int32Array(256);
  private phaseOf = new Float64Array(256);
  private n = 0;
  private cols = 0;
  /** Per band: its chords' ids and least x, ascending (cap each), how many, and the widest chord in it. */
  private ids: Int32Array[] = [];
  private keys: Float64Array[] = [];
  private cnt = new Int32Array(0);
  private wide = new Float64Array(0);
  private top = 0;

  /** A new frame, its rows from y `top` (px) over `h`. */
  clear(top: number, h: number): void {
    const nb = Math.ceil(h / DashRows.BAND) + 1;
    while (this.ids.length < nb) {
      this.ids.push(new Int32Array(16));
      this.keys.push(new Float64Array(16));
    }
    if (this.cnt.length < nb) {
      this.cnt = new Int32Array(nb);
      this.wide = new Float64Array(nb);
    } else {
      this.cnt.fill(0);
      this.wide.fill(0);
    }
    this.top = top;
    this.n = 0;
    this.cols = 0;
  }

  /** A new column's line (each column's chords never hold its own). */
  column(): number {
    return ++this.cols;
  }

  private band(y: number): number {
    return Math.max(0, Math.min(this.cnt.length - 1, Math.floor((y - this.top) / DashRows.BAND)));
  }

  /** The chord drawn of another column that runs within DASH_SPACE of chord (cq, y0)-(cp, y1) over the rows they share: its id, or -1. */
  near(col: number, cq: number, y0: number, cp: number, y1: number): number {
    if (this.n === 0) return -1;
    const b0 = this.band(y0);
    const b1 = this.band(y1);
    const lo = Math.min(cq, cp) - DASH_SPACE;
    const hi = Math.max(cq, cp) + DASH_SPACE;
    for (let b = b0; b <= b1; b++) {
      const K = this.keys[b];
      const I = this.ids[b];
      const c = this.cnt[b];
      // (Those whose least x is in reach: from lo less the band's widest chord, up to hi.)
      const from = lo - this.wide[b];
      let a = 0;
      let z = c;
      while (a < z) {
        const m = (a + z) >> 1;
        if (K[m] < from) a = m + 1;
        else z = m;
      }
      for (; a < c && K[a] <= hi; a++) {
        const k = I[a];
        if (this.colOf[k] === col) continue;
        const ya = Math.max(y0, this.y0[k]);
        const yb = Math.min(y1, this.y1[k]);
        if (!(yb > ya)) continue;
        // (Straight chords: their distance is the most at an end of the rows they share.)
        if (Math.abs(this.xAt(cq, y0, cp, y1, ya) - this.xAt(this.cq[k], this.y0[k], this.cp[k], this.y1[k], ya)) >= DASH_SPACE) continue;
        if (Math.abs(this.xAt(cq, y0, cp, y1, yb) - this.xAt(this.cq[k], this.y0[k], this.cp[k], this.y1[k], yb)) >= DASH_SPACE) continue;
        return k;
      }
    }
    return -1;
  }

  private xAt(cq: number, y0: number, cp: number, y1: number, y: number): number {
    return cq + ((cp - cq) * (y - y0)) / (y1 - y0);
  }

  /** Chord (cq, y0)-(cp, y1) of column col drawn: green (live), at `ref` in its batch (-1: none), its dash's phase. */
  add(col: number, cq: number, y0: number, cp: number, y1: number, live: boolean, ref: number, phase: number): void {
    const k = this.n;
    if (k === this.y0.length) this.grow();
    this.y0[k] = y0;
    this.y1[k] = y1;
    this.cq[k] = cq;
    this.cp[k] = cp;
    this.colOf[k] = col;
    this.liveOf[k] = live ? 1 : 0;
    this.refOf[k] = ref;
    this.phaseOf[k] = phase;
    this.n++;
    const x = Math.min(cq, cp);
    const w = Math.abs(cp - cq);
    for (let b = this.band(y0), b1 = this.band(y1); b <= b1; b++) {
      let c = this.cnt[b];
      if (c === this.ids[b].length) {
        const I = new Int32Array(2 * c);
        I.set(this.ids[b]);
        this.ids[b] = I;
        const K = new Float64Array(2 * c);
        K.set(this.keys[b]);
        this.keys[b] = K;
      }
      const I = this.ids[b];
      const K = this.keys[b];
      // (Kept ascending by least x: in from the right, as most come left to right.)
      while (c > 0 && K[c - 1] > x) {
        K[c] = K[c - 1];
        I[c] = I[c - 1];
        c--;
      }
      K[c] = x;
      I[c] = k;
      this.cnt[b]++;
      if (w > this.wide[b]) this.wide[b] = w;
    }
  }

  live(k: number): boolean {
    return this.liveOf[k] === 1;
  }
  /** Chord k green from now on (a living line's it holds); its place in the batch and its ends, to draw it so. */
  liven(k: number): number {
    this.liveOf[k] = 1;
    return this.refOf[k];
  }
  ends(k: number): [number, number, number, number, number] {
    return [this.cq[k], this.y0[k], this.cp[k], this.y1[k], this.phaseOf[k]];
  }

  private grow(): void {
    const c = 2 * this.y0.length;
    const f = (a: Float64Array) => {
      const b = new Float64Array(c);
      b.set(a);
      return b;
    };
    this.y0 = f(this.y0);
    this.y1 = f(this.y1);
    this.cq = f(this.cq);
    this.cp = f(this.cp);
    this.phaseOf = f(this.phaseOf);
    const colOf = new Int32Array(c);
    colOf.set(this.colOf);
    this.colOf = colOf;
    const refOf = new Int32Array(c);
    refOf.set(this.refOf);
    this.refOf = refOf;
    const liveOf = new Uint8Array(c);
    liveOf.set(this.liveOf);
    this.liveOf = liveOf;
  }
}
