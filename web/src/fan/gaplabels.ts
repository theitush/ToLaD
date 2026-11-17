// One kind of label on the tree on its side (ToLaD#458, Ita: "gaps only text no pic"): a name in its gap if it fits, else in its own band; a picture, a group's or a species', only in its own band, once that holds one.
//
// Which groups comes from the zoom alone, one active range a group (Been, Daiches & Yap 2006): a part has room once its gap on the column or its band on the column holds the text, a fork opens once
// every part has room, and never before its parent; it hands its band down to its parts before that, part by part, once its widest part holds that part's name and its own side by side, its title a guest there while its gap cannot hold it (gapHands, ToLaD#500). So the cover only ever splits on the way in, a pan changes nothing, and every member has a place of its own by construction: its gap and its band are
// nobody else's, so nothing meets, whatever the neighbours do. No slide: a title stands at the top of its branch, a name in a band inside that band's part on screen.
//
// Everything is read on the labels' column, the only place a label stands: a strand gone by then leaves no line there (rooms by life, steady.ts, may even stand it inside a sister's room),
// so it takes no room, claims nothing, has no label and holds no fork back; the same for a hair standing inside a wider lane (ownLanes). Those few, fossils, are named by the chain.
//
// A band is the lane's whole room, not the width the line has there: a funnel (humans, dogs) is thin at 100 kya and fat by now, and its lane is kept free for it all the way, so nothing else can stand
// there and a label on it reads as that funnel's. A group's band is its strands' whole span there, the gaps inside included.
//
// A title takes only its gap (ToLaD#483, Ita: "theres enough room for the asiatic bear name and pic under the american bear and kin title.. we should avoid them when they fit"): once a group's name
// stands in its gap, its band is its parts', each labelled there by the same rule as any member of the cover (its gap, unless that is its group's title's; its band; a picture), a second tier, and so on
// down (gapHands, gapCut). A part whose top strand is its group's has its group's gap, so the title there names it too and it hands its band down with it. Every label still stands in a room of its
// owner's alone: a title in a gap nobody else names, every other label in a band of the cut below the titles, and those bands are disjoint. Still the zoom alone: a group hands its band down once, on the way in, and never before
// its parent, so the cut below the titles only ever splits too.

/** Where a member of the cover has its name: in its gap, in its band. */
export type Tier = 'title' | 'in' | null;

export interface Rooms {
  C: Float64Array;
  R: Float64Array;
}

/**
 * Per strand, whether it has a lane of its own on the column: there at all, and not standing inside a wider lane there (a Neanderthal's hair on the centre of humans' funnel: the lane is kept for what
 * it becomes, their lines don't meet). One inside another has no room to read and no place for a label that isn't its host's, so it claims nothing and holds no fork back, as one gone by then.
 */
export function ownLanes({ C, R }: Rooms, there: (k: number) => boolean): boolean[] {
  const on: number[] = [];
  for (let k = 0; k < C.length; k++) if (there(k)) on.push(k);
  // (Top first, the wider first of a tie: anyone ending by the furthest end so far stands inside one before it.)
  on.sort((p, q) => C[p] - R[p] / 2 - (C[q] - R[q] / 2) || R[q] - R[p]);
  const own: boolean[] = new Array(C.length).fill(false);
  let end = -Infinity;
  for (const k of on) {
    const hi = C[k] + R[k] / 2;
    if (hi > end) own[k] = true;
    end = Math.max(end, hi);
  }
  return own;
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

/**
 * A group's widest part, `host`, and the zoom `until` which its name is a guest there (ToLaD#500): from its handing zoom, if that comes first, its name stands in its host's band, beside the host's
 * own label; or, once the host has handed its band down too, in its widest part's, and so on down the widest parts to the first not handed down.
 */
export interface Guest<G> {
  host: G;
  until: number;
}

/**
 * Each group's handing zoom (ToLaD#483, #500): from it, its band is its parts', each labelled there where it fits, and its name stands as their title until it opens (gapOpens: every part has room),
 * so that no part is ever left with nothing naming it. A group hands its band down once its gap holds its name (`gap(g)`, world x; px the text), or before that, once its widest part's band
 * (`band(p)`) holds that part's own name and its group's side by side (2 px and a `pad` between), and at its opening anyway; never before its parent hands down. So a group opens part by part
 * (ToLaD#500, Ita: "colinns sequirel money doesnt show the pic even at the zoom!"): a wide part has its name and picture once it has room, a thin one stays under its group's title until it fits.
 * Until its gap holds its name, the title is a guest in its widest part's band (`guests`); when that part hands its band down in turn, its guests go on down to its widest part with its own, so
 * a part hands down only once its widest part's band holds them all, its own name and theirs, side by side. Each title moves to its gap (the #483 way) or goes at its opening, once, on the way in.
 * A gap its group's (`same`: a first part's) is its group's title's till that group opens, so a title holds it only from there: a chain of first parts under one title stays named, each a guest.
 */
export function gapHands<G>(root: G, parts: (g: G) => readonly G[], opens: Map<G, number>, gap: (g: G) => number, band: (g: G) => number, room: (g: G) => number, px: number, pad: number, guests?: Map<G, Guest<G>>, same?: (g: G, p: G) => boolean): Map<G, number> {
  const hands = new Map<G, number>();
  // (Each with the untils of the guests it brings, its ancestors' titles standing in its band, and the zoom its gap is its own from: a gap its group's (`same`) is that group's title's till it opens.)
  const stack: [G, number, number[], number][] = [[root, 0, [], 0]];
  while (stack.length) {
    const [g, enter, brought, free] = stack.pop()!;
    const ps = parts(g);
    const open = opens.get(g) ?? Infinity;
    const titled = gap(g) > 0 ? Math.max(free, px / gap(g)) : Infinity;
    // (Its widest part, the first of a tie.)
    let [host, w] = [undefined as G | undefined, 0];
    for (const p of ps) if (band(p) > w) [host, w] = [p, band(p)];
    // (Its title goes once its gap holds it, or once every part has its own label, room of its own: a part handed down has had that before.)
    let all = 0;
    for (const p of ps) if (room(p) > 0) all = Math.max(all, px / room(p));
    const until = Math.min(titled, open, all);
    // (The first zoom from `enter` its widest part's band holds the names it would hold then: its own, the guests still there, and its group's till its gap holds it; none needed past those.)
    let at = Infinity;
    if (ps.length) {
      const ends = [...new Set([enter, until, ...brought].filter((z) => z >= enter && z < Infinity))].sort((p, q) => p - q);
      for (let i = 0; i < ends.length && at === Infinity; i++) {
        const n = brought.filter((u) => u > ends[i]).length + (ends[i] < until ? 1 : 0);
        const z = n ? Math.max(ends[i], ((n + 1) * px + n * pad) / w) : ends[i];
        if (z < (ends[i + 1] ?? Infinity)) at = z;
      }
      at = Math.min(open, at);
    }
    hands.set(g, at);
    if (host !== undefined) guests?.set(g, { host, until });
    const down = [...brought.filter((u) => u > at), ...(at < until ? [until] : [])];
    for (const p of ps) stack.push([p, at, p === host ? down : [], same?.(g, p) ? open : 0]);
  }
  return hands;
}


/** A member of the cut at a zoom: `heads`, its band its parts' (its name in its gap only, no picture); `taken`, its gap its group's title's (no name of its own there). */
export interface CutMember<G> {
  g: G;
  heads: boolean;
  taken: boolean;
}

/**
 * The cut at zoom sx (ToLaD#483): the tree cut where groups have not handed their bands down (gapHands), and over it each group that has but not opened, its title only, before its parts; one whose
 * gap is its group's title's left out (that title names it), unless it is a guest in its widest part's band then (`guests`, ToLaD#500).
 */
export function gapCut<G>(root: G, parts: (g: G) => readonly G[], opens: Map<G, number>, hands: Map<G, number>, same: (g: G, p: G) => boolean, sx: number, guests?: Map<G, Guest<G>>): CutMember<G>[] {
  const out: CutMember<G>[] = [];
  const stack: [G, boolean][] = [[root, false]];
  while (stack.length) {
    const [g, taken] = stack.pop()!;
    const ps = parts(g);
    if (ps.length && (hands.get(g) ?? Infinity) <= sx) {
      const open = (opens.get(g) ?? Infinity) <= sx;
      if (!open && (!taken || sx < (guests?.get(g)?.until ?? 0))) out.push({ g, heads: true, taken });
      for (let i = ps.length - 1; i >= 0; i--) stack.push([ps[i], !open && same(g, ps[i])]);
    } else out.push({ g, heads: false, taken });
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

/** A candidate for a picture: its centre on the column (world x), and the zooms its band is its own over, from `enter` (its parent hands its band down) to `exit` (it does, gapHands). */
export interface PicCand {
  at: number;
  enter: number;
  exit: number;
}

/** Each candidate's pictures as zoom ranges: a small one from `small` to `full`, a full one from `full` to its exit. A range empty when its start reaches its end. */
export interface PicRange {
  small: number;
  full: number;
}

/**
 * Who has a picture at which zoom (ToLaD#464, Ita: "its fine that the pic would be wider then the branch", "put lil pics on the ones that dont fit"): one active range a picture, Been, Daiches & Yap
 * 2006, as the names'. Every member of the cover is a candidate, its picture on its band's centre on the column whatever its band, so two pictures meet below the zoom that parts their centres by
 * their rooms; in priority order (`cands` comes sorted), a candidate's range starts where every higher one it would meet has parted from it or split. Full pictures first, then small ones in what is left,
 * each before its own full one. So a picture, once shown, stays as the view zooms in until its member splits (a small one until it grows); no two ever meet; and it is the zoom alone: a pan changes nothing.
 * `fullRoom`, `smallRoom`: px a picture needs across, its own and a hair to the next.
 */
export function picRanges(cands: readonly PicCand[], fullRoom: number, smallRoom: number): PicRange[] {
  const n = cands.length;
  const byAt = cands.map((_, i) => i).sort((p, q) => cands[p].at - cands[q].at);
  const pos = new Int32Array(n);
  byAt.forEach((i, r) => (pos[i] = r));
  const out: PicRange[] = cands.map((c) => ({ small: c.exit, full: c.exit }));
  // (Who has been placed: a range is held once its owner's turn has come.)
  const fullDone = new Uint8Array(n);
  const smallDone = new Uint8Array(n);
  const place = (i: number, room: number, end: number, small: boolean): number => {
    const c = cands[i];
    let start = c.enter;
    for (let moved = true; moved && start < end; ) {
      moved = false;
      for (const dir of [-1, 1]) {
        for (let r = pos[i] + dir; r >= 0 && r < n; r += dir) {
          const j = byAt[r];
          const d = Math.abs(cands[j].at - c.at);
          // (Past this one, nobody can meet it at any zoom it still waits for.)
          if (d * start >= (room + fullRoom) / 2) break;
          for (const [held, s, e, rj] of [
            [fullDone[j], out[j].full, cands[j].exit, fullRoom],
            [small ? smallDone[j] : 0, out[j].small, out[j].full, smallRoom],
          ]) {
            if (!held || s >= e) continue;
            const part = d > 0 ? (room + rj) / 2 / d : Infinity;
            // (Both shown and meeting over [max(start, s), min(end, e, part)): wait until it parts or splits.)
            if (Math.max(start, s) < Math.min(end, e, part)) {
              start = Math.min(e, part);
              moved = true;
            }
          }
        }
      }
    }
    return Math.min(start, end);
  };
  for (let i = 0; i < n; i++) {
    out[i].full = place(i, fullRoom, cands[i].exit, false);
    fullDone[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    out[i].small = place(i, smallRoom, out[i].full, true);
    smallDone[i] = 1;
  }
  return out;
}

/** A picture's size at zoom sx from its ranges: d, the full one's diameter, or ds, the small one's; 0 for none. */
export function picAt(r: PicRange | undefined, sx: number, d: number, ds: number): number {
  return !r ? 0 : sx >= r.full ? d : sx >= r.small ? ds : 0;
}
