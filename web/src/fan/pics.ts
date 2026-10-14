/**
 * The level's group pictures on the "now" edge (ToLaD#262, #266): one disc per group one level down, always exactly
 * above its clade's centre (Ita: "pic must always be exactly about its clades center"), standing on "now" (an extinct
 * group's on its own tip), never moved sideways or up. When they crowd: each disc shrinks to the room its nearest
 * neighbour leaves (down to PIC_MIN), then
 * neighbours overlap a little (the more populous on top), then the least populous groups' pictures are dropped.
 */

/** A disc's place: centre (x, y), diameter d, and `i`, its group's index in placePics' input. */
export interface PicSpot {
  x: number;
  y: number;
  d: number;
  i: number;
}

/** Largest disc diameter (px): the species' pictures' (THUMB_D). */
export const PIC_D = 50;
/** Least gap (px) between two discs side by side, while they need not overlap. */
export const PIC_GAP = 4;
/** The discs stand this many px above "now" (or the tip). */
export const PIC_LIFT = 2;
/** The smallest disc (px): crowded past it, neighbours overlap a little, then the least populous are dropped. */
export const PIC_MIN = 18;
/** At the smallest size, two discs' centres at least this share of a diameter apart (they overlap by the rest). */
export const PIC_OVERLAP = 0.7;

/**
 * The discs over the clades' centres `xs` (screen x), each bottoming PIC_LIFT above `ys` ("now", or an extinct group's
 * tip below it), `pop` the groups' individuals alive (who stays, and on top, when they crowd). Returned least populous
 * first: drawn in that order, the more populous lie on top.
 */
export function placePics(xs: readonly number[], ys: readonly number[], pop: readonly number[]): PicSpot[] {
  const n = xs.length;
  if (!n) return [];
  // The most populous first: each kept where it stands clear (enough) of those kept before it.
  const order = [...xs.keys()].sort((a, b) => pop[b] - pop[a] || xs[a] - xs[b]);
  const at = (i: number, d: number) => [xs[i], ys[i] - PIC_LIFT - d / 2];
  const near = (i: number, j: number, d: number) => {
    const [x0, y0] = at(i, d);
    const [x1, y1] = at(j, d);
    return Math.hypot(x0 - x1, y0 - y1);
  };
  const fits = (d: number, apart: number): number[] => {
    const kept: number[] = [];
    for (const i of order) if (kept.every((j) => near(i, j, d) >= apart - 1e-9)) kept.push(i);
    return kept;
  };
  // Kept: each not nearer than a little overlap of the smallest discs to a more populous one kept (the rest dropped).
  const kept = fits(PIC_MIN, PIC_OVERLAP * PIC_MIN);
  // Each disc as large as its nearest kept neighbour leaves room for (two neighbours both so, they clear by PIC_GAP),
  // PIC_D at most, PIC_MIN at least (there they overlap a little).
  const size = kept.map((i) => {
    let room = PIC_D;
    for (const j of kept) if (j !== i) room = Math.min(room, near(i, j, PIC_D) - PIC_GAP);
    return Math.max(PIC_MIN, room);
  });
  return kept
    .map((i, k) => {
      const d = size[k];
      const [x, y] = at(i, d);
      return { x, y, d, i };
    })
    .reverse();
}
