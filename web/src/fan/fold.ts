// Semantic zoom (ToLaD#146, variant B): a family too narrow on screen to tell its species apart is
// drawn as ONE column, and opens into its species as the zoom gives it room.
//
// The units are the dated tree's families: a split whose taxon (the Open Tree name the data gives it)
// ends in "-idae", the zoological code's suffix for the family rank. That is a rule over the data, not a
// list: it holds for every mammal order (#15), and a species in no named family (the red panda, the
// walrus) is simply its own column. The English label is a small name map; a family it lacks shows its
// Latin name.
//
// When a unit is closed, its column above its crown split is its species' strands side by side with no
// gaps, about the crown's centre: as wide as the sum of their individuals alive at every time, the green
// share (those with living descendants today) one prefix across it, the sum of theirs. That is the same
// honest picture the parent columns below a split already draw. Opening moves each strand from its place
// in that stack to its own place in the fan (a convex blend of two non-overlapping placements, so the
// strands never cross), and its green from its slice of the summed prefix to its own lane: one
// continuous parameter, no pop.
//
// How open a unit is, `openness`: its on-screen width per species (its open span, rooms and gaps, times
// the width zoom, over its species count) on a log ramp from FOLD_LO_PX (closed) to FOLD_HI_PX (open).
// Why those: a species' column needs ~2.5 px to show its two lanes (the drawing floors the green at 1 px
// and the gray at 0.6 px) and ~1 px of gap to read apart from its neighbour, so below ~3.4 px per species
// a family's columns blur into one anyway and it is drawn as the one column it reads as; by ~4.8 px they
// part. A family fitted across a 390 px phone gets 4.9 (the weasels, 58 species) to 70 px (the hyenas)
// per species, so every family opens fully at its own level, and none is open at the order's home (the
// cats, widest there in linear widths for the domestic cat, get 3.2 px). The ramp is short (a 1.4x zoom)
// so a family spends little of a pinch half-open; it is continuous all the same. Width zoom only: time
// zoom does not change how far apart the columns are.

import { laneAt, type Fan, type FanBranch, type FanNode } from './layout';

export const FOLD_LO_PX = 3.4;
export const FOLD_HI_PX = 4.8;
/** Heights the closed column is sampled at (world-fixed, from the latest tip down to the crown split). */
export const FOLD_K = 384;

/** A family's English name, plural, by its Latin one (the label on its closed column and its card). */
export const FAMILY_EN: Record<string, string> = {
  Felidae: 'Cats',
  Canidae: 'Dogs',
  Ursidae: 'Bears',
  Phocidae: 'Seals',
  Otariidae: 'Sea lions',
  Odobenidae: 'Walrus',
  Mustelidae: 'Weasels',
  Procyonidae: 'Raccoons',
  Mephitidae: 'Skunks',
  Ailuridae: 'Red panda',
  Herpestidae: 'Mongooses',
  Hyaenidae: 'Hyenas',
  Viverridae: 'Civets',
  Eupleridae: 'Malagasy carnivores',
  Prionodontidae: 'Linsangs',
  Nandiniidae: 'African palm civet',
};

/** The rank a fold unit is: the zoological code's family suffix. */
export const isFamily = (taxon: string | undefined): taxon is string => !!taxon && /^[A-Z][a-z]+idae$/.test(taxon);

export interface FoldUnit {
  node: FanNode;
  /** Latin (Felidae) and English (Cats). */
  taxon: string;
  label: string;
  /** Its species' strands, left to right. */
  strands: FanBranch[];
  /** World x span of its open columns (their rooms) and the closed column's centre line. */
  x0: number;
  x1: number;
  cx: number;
  /** The grid's top (the latest tip: "now" for a living family) and bottom (the crown split). */
  yTop: number;
  yBot: number;
  /** At each grid height: the summed width and green width, and each strand's left offset in the stack (strand-major). */
  W: Float64Array;
  G: Float64Array;
  P: Float64Array;
  /** Openness this frame (0 closed, 1 open), set by the view. */
  e: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The fold units of a fan: its family splits, outermost only (a family inside a family is not folded apart). */
export function foldUnits(fan: Fan): FoldUnit[] {
  const out: FoldUnit[] = [];
  const walk = (v: FanNode) => {
    if (v.parent && isFamily(v.split.taxon)) {
      out.push(unit(v, v.split.taxon));
      return;
    }
    for (const k of v.kids) if ('strands' in k) walk(k);
  };
  walk(fan.root);
  return out;
}

function unit(v: FanNode, taxon: string): FoldUnit {
  const strands = v.strands;
  const n = strands.length;
  const K = FOLD_K;
  const yTop = Math.min(...strands.map((b) => b.tipY));
  const yBot = v.y;
  const W = new Float64Array(K);
  const G = new Float64Array(K);
  const P = new Float64Array(n * K);
  for (let k = 0; k < K; k++) {
    const y = yTop + ((yBot - yTop) * k) / (K - 1);
    let acc = 0;
    let g = 0;
    for (let i = 0; i < n; i++) {
      P[i * K + k] = acc;
      const L = laneAt(strands[i], y);
      acc += L.w;
      g += L.gw;
    }
    W[k] = acc;
    G[k] = g;
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of strands) {
    x0 = Math.min(x0, b.colLeft);
    x1 = Math.max(x1, b.colLeft + b.width);
  }
  return { node: v, taxon, label: FAMILY_EN[taxon] ?? taxon, strands, x0, x1, cx: v.left + v.width / 2, yTop, yBot, W, G, P, e: 1 };
}

/** How open unit u is at width zoom sx (px per world unit): 0 closed .. 1 open, smooth in the log of its px per species. */
export function openness(u: FoldUnit, sx: number): number {
  const per = ((u.x1 - u.x0) * sx) / u.strands.length;
  if (!(per > 0)) return 0;
  return smooth(Math.log(per / FOLD_LO_PX) / Math.log(FOLD_HI_PX / FOLD_LO_PX));
}

/** Grid position of world y: index k and weight t (clamped to the grid). */
function gridAt(u: FoldUnit, y: number): [number, number] {
  const r = ((y - u.yTop) / (u.yBot - u.yTop)) * (FOLD_K - 1);
  if (!(r > 0)) return [0, 0];
  if (r >= FOLD_K - 1) return [FOLD_K - 2, 1];
  const k = Math.floor(r);
  return [k, r - k];
}

/** The closed column at world y (above the crown): its left edge, width and green width. */
export function closedAt(u: FoldUnit, y: number): { left: number; w: number; gw: number } {
  const [k, t] = gridAt(u, y);
  const w = u.W[k] + (u.W[k + 1] - u.W[k]) * t;
  const gw = u.G[k] + (u.G[k + 1] - u.G[k]) * t;
  return { left: u.cx - w / 2, w, gw };
}

/**
 * Strand i of unit u at world y, as the closed column holds it: its left edge in the stack and its green
 * fraction there (its slice of the summed green prefix). `w` is its own width there.
 */
export function stackAt(u: FoldUnit, i: number, y: number, w: number): { left: number; f: number } {
  const [k, t] = gridAt(u, y);
  const o = i * FOLD_K + k;
  const off = u.P[o] + (u.P[o + 1] - u.P[o]) * t;
  const W = u.W[k] + (u.W[k + 1] - u.W[k]) * t;
  const G = u.G[k] + (u.G[k + 1] - u.G[k]) * t;
  const f = w > 0 ? Math.min(1, Math.max(0, (G - off) / w)) : 0;
  return { left: u.cx - W / 2 + off, f };
}

/** Each strand's unit and its index in it. */
export function unitIndex(units: FoldUnit[]): Map<FanBranch, [FoldUnit, number]> {
  const m = new Map<FanBranch, [FoldUnit, number]>();
  for (const u of units) u.strands.forEach((b, i) => m.set(b, [u, i]));
  return m;
}
