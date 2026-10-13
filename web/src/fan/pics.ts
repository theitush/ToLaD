/**
 * The level's group pictures on the "now" edge (ToLaD#262): one disc per group one level down, always exactly above
 * its clade's centre (Ita: "pic must always be exactly about its clades center"), never slid sideways. Discs that
 * would overlap side by side are resolved only upwards: each takes the lowest row where it meets none placed before it
 * (a second row, then a third), with a thin upright stalk down to "now"; the discs are smaller only when three rows
 * are not room, and past the smallest size the rows go on up.
 */

/** A disc's place: centre (x, y), diameter d, row (0 on "now"), and its stalk [x, y0, y1] (null on row 0 over "now"). */
export interface PicSpot {
  x: number;
  y: number;
  d: number;
  row: number;
  stalk: [number, number, number] | null;
}

/** Largest disc diameter (px): the species' pictures' (THUMB_D). */
export const PIC_D = 50;
/** Least gap (px) between two discs, side by side or row over row. */
export const PIC_GAP = 4;
/** Row 0's discs stand this many px above "now". */
export const PIC_LIFT = 2;
/** Diameters tried, largest first, and the rows preferred at most. */
const SIZES = [50, 44, 38, 32, 26, 22, 18, 15];
const MAX_ROWS = 3;

/** Rows for discs of diameter d centred at xs (left to right): each the lowest whose discs it clears. */
function rowsFor(xs: readonly number[], d: number): number[] {
  const right: number[] = [];
  return xs.map((x) => {
    let r = right.findIndex((e) => x - e >= d + PIC_GAP - 1e-9);
    if (r < 0) r = right.length;
    right[r] = x;
    return r;
  });
}

/**
 * The discs over the clades' centres `xs` (screen x, left to right), each its stalk down to `ys` ("now", or an
 * extinct species' tip below it): row 0 bottoms PIC_LIFT above nowS, the rows over it no higher than `top` while a
 * smaller size is left to try.
 */
export function placePics(xs: readonly number[], ys: readonly number[], nowS: number, top: number): PicSpot[] {
  if (!xs.length) return [];
  const base = nowS - PIC_LIFT;
  // (Up to three rows, the largest size that needs no more; else as many rows as the band above "now" holds; else the
  // smallest size, its rows on up.)
  const band = (d: number) => Math.max(1, Math.floor((base - top + PIC_GAP) / (d + PIC_GAP)));
  let d = SIZES[SIZES.length - 1];
  let row: number[] = [];
  found: for (const most of [(d: number) => Math.min(MAX_ROWS, band(d)), band]) {
    for (const size of SIZES) {
      const r = rowsFor(xs, size);
      if (Math.max(...r) < most(size)) {
        [d, row] = [size, r];
        break found;
      }
    }
  }
  if (!row.length) row = rowsFor(xs, d);
  return xs.map((x, i) => {
    const y = base - d / 2 - row[i] * (d + PIC_GAP);
    const low = y + d / 2;
    const stalk: [number, number, number] | null = row[i] > 0 || ys[i] > nowS + 0.5 ? [x, low, ys[i]] : null;
    return { x, y, d, row: row[i], stalk };
  });
}
