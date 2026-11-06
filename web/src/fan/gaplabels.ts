// One kind of label on the tree on its side (ToLaD#458, Ita: "gaps only text no pic"): a group's name, plain text, in the gap above its branch; a species' picture and pill in its own branch.
//
// Which groups comes from the zoom alone, one active range a group (Been, Daiches & Yap 2006): a fork opens once the gap above each of its parts but the first
// is taller than the text, the first part inheriting the gap above the fork, and never before its parent has opened. So the cover only ever splits on the way in, a pan changes nothing, and every part
// has a gap of its own to stand in, by construction. No slide: a title stands at the top of its branch.
//
// The gaps are read on the labels' column, the only place a label stands: a strand gone by then leaves no line there (rooms by life, steady.ts, may even stand it inside a sister's room),
// so it takes no room, has no label and holds no fork back. Those few (24 of mammals' strands, fossils) are named by the chain.
//
// A species asks more than a title: its picture needs `d` across. Each neighbour claims its own label's extent, a title its text over its branch, a species half of d whether or not it gets one,
// so who gets a picture depends on neither order nor the screen: it gets one if its d stays clear of both neighbours' claims; else its name in its branch if that holds the text; else its name in the gap above, as any label.

/** A tier a member of the cover takes. */
export type Tier = 'title' | 'pic' | 'in' | null;

export interface Rooms {
  C: Float64Array;
  R: Float64Array;
}

/** Per strand, world x: the height free above it on the column, up to the nearest strand above it still there; Infinity for the first of them. Not positive: it has no place of its own there. */
export function columnGaps({ C, R }: Rooms, there: (k: number) => boolean): Float64Array {
  const out = new Float64Array(C.length);
  let bottom = -Infinity;
  for (let k = 0; k < C.length; k++) {
    out[k] = C[k] - R[k] / 2 - bottom;
    if (there(k)) bottom = Math.max(bottom, C[k] + R[k] / 2);
  }
  return out;
}

/**
 * Each group's opening zoom, by world height of the gaps: `first(g)`, the strand its label stands over, -1 for a group with none on the column. A fork waits for its own gaps
 * and for its parent, so any zoom's cover is a cut of the tree: no ladder, and it can only split on the way in. A part with no gap on the column waits for nothing.
 */
export function gapOpens<G>(root: G, parts: (g: G) => readonly G[], first: (g: G) => number, gaps: Float64Array, px: number): Map<G, number> {
  const opens = new Map<G, number>();
  const stack: [G, number][] = [[root, 0]];
  while (stack.length) {
    const [g, up] = stack.pop()!;
    const ps = parts(g);
    let at = up;
    let seen = false;
    for (const p of ps) {
      const k = first(p);
      if (k < 0) continue;
      if (seen && gaps[k] > 0) at = Math.max(at, px / gaps[k]);
      seen = true;
    }
    opens.set(g, at);
    for (const p of ps) stack.push([p, at]);
  }
  return opens;
}

/** The cover at zoom sx: the tree cut where groups have not opened. */
export function gapCover<G>(root: G, parts: (g: G) => readonly G[], opens: Map<G, number>, sx: number): G[] {
  const out: G[] = [];
  const stack = [root];
  while (stack.length) {
    const g = stack.pop()!;
    const ps = parts(g);
    if (ps.length && (opens.get(g) ?? Infinity) <= sx) for (let i = ps.length - 1; i >= 0; i--) stack.push(ps[i]);
    else out.push(g);
  }
  return out;
}

export interface Member {
  /** A species (else a group). */
  species: boolean;
  /** The top of the room of the strand its label stands over, its band's centre and height, and the gap above it, world x. */
  top: number;
  at: number;
  band: number;
  gap: number;
}

/** Each member's tier at zoom sx, the members in order down the column. d: a picture's room; px: a title's text; inPx: a species' name's. */
export function tiers(list: readonly Member[], sx: number, d: number, px: number, inPx: number): Tier[] {
  const up = (m: Member) => (m.species ? m.at * sx + d / 2 : m.top * sx);
  const down = (m: Member) => (m.species ? m.at * sx - d / 2 : m.top * sx - px);
  return list.map((m, i) => {
    const fitsGap = m.gap * sx >= px;
    if (!m.species) return fitsGap ? 'title' : null;
    const c = m.at * sx;
    const clear = (i === 0 || up(list[i - 1]) <= c - d / 2) && (i === list.length - 1 || down(list[i + 1]) >= c + d / 2);
    return clear ? 'pic' : m.band * sx >= inPx ? 'in' : fitsGap ? 'title' : null;
  });
}
