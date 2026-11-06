// One kind of label on the tree on its side (ToLaD#458, Ita: "gaps only text no pic"): a name in its gap if it fits, else in its own band; a picture, a group's or a species', only in its own band, once that holds one.
//
// Which groups comes from the zoom alone, one active range a group (Been, Daiches & Yap 2006): a part has room once its gap on the column or its band on the column holds the text, a fork opens once
// every part has room, and never before its parent. So the cover only ever splits on the way in, a pan changes nothing, and every member has a place of its own by construction: its gap and its band are
// nobody else's, so nothing meets, whatever the neighbours do. No slide: a title stands at the top of its branch, a name in a band inside that band's part on screen.
//
// Everything is read on the labels' column, the only place a label stands: a strand gone by then leaves no line there (rooms by life, steady.ts, may even stand it inside a sister's room),
// so it takes no room, claims nothing, has no label and holds no fork back. Those few (24 of mammals' strands, fossils) are named by the chain.
//
// A band is the lane's whole room, not the width the line has there: a funnel (humans, dogs) is thin at 100 kya and fat by now, and its lane is kept free for it all the way, so nothing else can stand
// there and a label on it reads as that funnel's. A group's band is its strands' whole span there, the gaps inside included: its name stands over its parts, which then have no label of their own.

/** Where a member of the cover has its name: in its gap, in its band. */
export type Tier = 'title' | 'in' | null;

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
 * Each group's opening zoom, from `room(g)`, the world height it has of its own on the column, gap or band, the more of the two: a fork waits for every part to have the text's px there
 * and for its parent, so any zoom's cover is a cut of the tree: no ladder, and it can only split on the way in. A part with no room on the column waits for nothing.
 */
export function gapOpens<G>(root: G, parts: (g: G) => readonly G[], room: (g: G) => number, px: number): Map<G, number> {
  const opens = new Map<G, number>();
  const stack: [G, number][] = [[root, 0]];
  while (stack.length) {
    const [g, up] = stack.pop()!;
    const ps = parts(g);
    let at = up;
    for (const p of ps) {
      const r = room(p);
      if (r > 0) at = Math.max(at, px / r);
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
  /** Its band on the column, its centre and height, the top of the first strand there, and the gap above that, world x. */
  top: number;
  at: number;
  band: number;
  gap: number;
}

/**
 * Where a member's name stands at zoom sx. px: a group's name's text; inPx: a species' in its band. A group's name in its gap, else in its band ("its name over its parts"); a species' in its own band
 * ("the labels of the species are in the species"), else in the gap.
 */
export function tier(m: Member, sx: number, px: number, inPx: number): Tier {
  const [band, gap] = [m.band * sx, m.gap * sx];
  if (!m.species) return gap >= px ? 'title' : band >= px ? 'in' : null;
  return band >= inPx ? 'in' : gap >= px ? 'title' : null;
}

/** Has it a picture at zoom sx: its band holds one (d, a picture's room). Inside its own band, so it stays clear of every neighbour's name and picture, and never stands in a gap. */
export function picFits(m: Member, sx: number, d: number): boolean {
  return m.band * sx >= d;
}
