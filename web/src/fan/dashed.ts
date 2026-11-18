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
