// The fan view: the dated tree drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { drawThumb, labelThumb } from './wiki';
import { formatCount } from '../data/count';
import { Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, type Camera } from './camera';
import { isNode, laneAt, layoutFan, leftAt, nodeLeftAt, nodeQ, segAt, STEM_FADE_MA, type EdgeStyle, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { FanGL, rgb01 } from './meshgl';
import { Lod } from './lod';
import { Fold, type FoldState } from './fold';
import { COLUMN_DIM, columnSpans, EVENT_TINT, eventAt, eventSpans, type EventSpan } from './colstyle';
import { drawTwigs, kLogAt, laneDim, LINEAGE, LIVING, TEX_HAIR_PX, TWIG_GRAY, TwigModel, type IndInfo, type TwigStats } from './twigs';
import type { MeshBatch, RectBatch } from './meshgl';
import { familyLabel, FELIDAE_TREE, type Split } from './splits';
import { bandDepth, Brackets, cladeCamera, foldedFrame, latinOf, rankOf, ROW_H } from './brackets';
import { axisInset, drawWorldOver, drawWorldUnder, worldFlags, type Box } from './world';

export type { IndInfo } from './twigs';
export type { Camera } from './camera';

/** Alive now: the one luminous colour. */
export const GREEN = '#3fd286';
/** Line ended: a cool slate, darker than both greens (told apart by lightness too, not hue alone). */
export const GRAY = '#67737f';
/** The ground (app.css --ground): spruce at night. */
export const BG = '#0c1714';
/** Text on the canvas (app.css --ink, --ink-2, --ink-3). */
const INK = '#e8f0ea';
const INK2 = '#a9b8ae';
const INK3 = '#7d8e84';
/** A family's label (ToLaD#146): a pale green, the level above the species. */
const FAMILY_INK = '#b9e6c9';
/** Type (app.css): a condensed sans for all that is read at a glance, a serif italic for Latin names. */
export const SANS = "'Sofia Sans Condensed', 'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif";
export const SERIF = "'Newsreader', 'Iowan Old Style', Georgia, serif";
const font = (spec: string, family = SANS) => `${spec} ${family}`;
/** A species' label: its name, upright on a dark pill LABEL_PILL px across, LABEL_PAD px past each end of the text. */
const LABEL_FONT = '650 15px';
const LABEL_PILL = 22;
/** The "+x" badge at a pill's top end (ToLaD#197): its type, smaller and quieter than the name; the gap from the name before it. */
const PLUS_FONT = '600 11px';
const PLUS_GAP = 6;
/** The species picture under a name pill (ToLaD#182), its diameter. */
const THUMB_D = 50;
const LABEL_PAD = 8;
/** Right edge (px) of the time axis's labels: species' labels keep right of it. */
const LABEL_AXIS_X = 72;
/** A frame a double-tap steps back to (ToLaD#241): what it frames (a species, a clade, home), the frame, the flight there. */
type BackStep = { to: string; cam: Camera; go: () => void };
/**
 * A double-tap's step back (ToLaD#241): the view is "at" a frame of the ladder when it is zoomed within this factor
 * (15 %) of it, width and time together (the area's scale); zoomed in further, the step goes to that frame, else past it.
 */
const BACK_SLACK = 1.15;
/** The scale bar and legend at the bottom (px): labels fade out over the 30 px above it. */
const LABEL_BOTTOM_PX = 104;
/** How long a label takes to fade in or out when another takes or gives up its place (ms). */
const LABEL_FADE_MS = 180;
/** Folded: how far (px) below the order's start its stem fades out (drawStemFade, ToLaD#210). */
const STEM_END_PX = 48;
/** A lane's living glow at full strength from this green width (px) up, thinner ones in proportion: a family of thin columns side by side glows as one (ToLaD#231). */
const GLOW_W = 6;
/** The glow fades out across a lean: gone where the lane runs √(1 + s²) - 1 = GLOW_LEAN off straight down (s ≈ 0.75 px per px). */
const GLOW_LEAN = 0.25;

/** Rows of the clades' brackets (ToLaD#193) a framed view keeps room for above "now". */
const BAND_ROWS = 5;

/** Gap (px) a label keeps from the column it sits beside. */
const LABEL_GAP = 3;
/** Highest a label standing on "now" may reach where the buttons are not above it (px from the top). */
const LABEL_CEIL = 6;

/**
 * Where a label goes (#97). One pill everywhere (#54): the name upright on a
 * dark pill, the same text and size at every zoom. Two places for it:
 *
 *  - On its tip (`tip`): standing on the "now" line at the top of its column
 *    for a living species (an extinct one: on its own tip), centred on the
 *    column and sliding along it to stay on screen. The space above "now" is
 *    empty, so a pill reaches up from the line as far as the buttons allow.
 *  - Beside its branch (`right`, `left`): when the tip is off screen (above
 *    the top line), next to the top of its column's part on screen, a gap
 *    clear of it, where no other column is in the way. A parent column (a
 *    lineage: "Small cat ancestors") is labelled this way too, but only while
 *    "now" is off screen: at home the species name the tree.
 *  - In its column (`in`), at the top line, where the column is wider on
 *    screen than the pill (zoomed into it): nothing is beside it then.
 *
 * Every spot is a continuous function of the camera; its `fit` (0–1) fades
 * it in and out over a few px of motion (the tip leaving the top, no room
 * beside the column, the time axis on the left, the legend at the bottom),
 * so a label moves from its tip to beside its branch by a cross-fade, never a
 * jump. resolveLabels picks one spot per name and never lets two meet.
 */
export interface LabelSpot {
  /** The spot's key: the name's id and the place (`tip`, `in`, `right`, `left`). */
  key: string;
  /** The name's id: a species' gid, or `n<index>` for a lineage. Place: see labelSpots. */
  id: string;
  place: 'tip' | 'in' | 'right' | 'left' | 'fam';
  /** A family's label (`fam`, ToLaD#146): the screen x span of its species, bracketed under the pill. */
  span?: [number, number];
  /** The species (b) or the lineage (v) it names. */
  b?: FanBranch;
  v?: FanNode;
  /** A curated event's label (ToLaD#141): its index in `b.sp.history.events`. */
  ev?: number;
  text: string;
  rank: Rank;
  /** Centre x of the pill and its bottom (screen px): the text reads up from there. */
  x: number;
  y1: number;
  /** The pill [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** 0–1: how fully this spot is there (see above). */
  fit: number;
  /** A species' pill on its tip: the px kept at its top end for its "+x" badge (ToLaD#197), part of `box`. */
  plus?: number;
  /** A family's pill (ToLaD#212): the family it names (a `fam` spot's, or a species' pill standing for its family). */
  fam?: FanNode;
  /** The species whose picture it carries, when not its own `b` (a family's: its commonest living species, ToLaD#212). */
  pic?: FanBranch | null;
}

/** Priority: species before lineages, then the wider column first, then tree order. */
type Rank = [number, number, number];

type Screen = Pick<FanCamera, 'toScreen' | 'toWorld' | 'w' | 'h'> & { cam: { sx: number; sy: number } };

/** A column's world span: x (its widest reach, peel included) and y. */
interface ColBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Where its peel ends (world y). */
  lean: number;
  own: FanBranch | FanNode;
  /** Its edges [left, right] at world y (in its span). */
  at: (y: number) => [number, number];
}

/** The fan's columns as ColBoxes: the leaf columns above their splits, the parent columns over their spans (the stem below the root). Kept per fan. */
/** Each branch's styled column spans (colstyle.ts) in world y: [top, bottom, dim]; world-fixed, so built once per layout. */
const colSpanCache = new WeakMap<FanBranch, [number, number, number][]>();
export function colSpansY(fan: Fan, b: FanBranch): [number, number, number][] {
  let out = colSpanCache.get(b);
  if (!out) {
    out = columnSpans(b.sp, b.t0)
      .filter((s) => COLUMN_DIM[s.style] > 0)
      .map((s) => [fan.time.y(s.ago1 / 1e6), fan.time.y(s.ago0 / 1e6), COLUMN_DIM[s.style]]);
    colSpanCache.set(b, out);
  }
  return out;
}

/** Each branch's curated events (colstyle.ts eventSpans, ToLaD#141) in world y: `top` (younger) to `bot`; world-fixed. */
export interface EventY extends EventSpan {
  top: number;
  bot: number;
}
const colEventCache = new WeakMap<FanBranch, EventY[]>();
export function colEventsY(fan: Fan, b: FanBranch): EventY[] {
  let out = colEventCache.get(b);
  if (!out) {
    out = eventSpans(b.sp, b.t0).map((s) => ({ ...s, top: fan.time.y(s.ago1 / 1e6), bot: fan.time.y(s.ago0 / 1e6) }));
    colEventCache.set(b, out);
  }
  return out;
}
/** An event's tint is at least this tall and this wide on screen (px), so a short window on a thin column still reads. */
const EVENT_MIN_PX = 2;
const EVENT_MIN_W = 3;
/** How far (px) above or below a window a touch still opens it. */
const EVENT_REACH_PX = 10;

/** A branch's width by height (laneAt's w), kept across the fold's changes (it does not depend on where the column stands). */
const widthMemo = new WeakMap<FanBranch, Map<number, number>>();
function widthAt(b: FanBranch, y: number): number {
  let m = widthMemo.get(b);
  if (!m) widthMemo.set(b, (m = new Map()));
  let w = m.get(y);
  if (w === undefined) {
    if (m.size > 8192) m.clear();
    m.set(y, (w = laneAt(b, y).w));
  }
  return w;
}

/** How many heights over the fan a folded column's box is read at (colBoxes). */
const BOX_ROWS = 256;
/** How long (ms) after the fold last moved the columns' edges are made exact (FanView.applyFold). */
const FOLD_REST_MS = 120;
/** The fold's rows at a level with orders above its families (the mammals: every row folds ~5,900 strands): about this many px apart (else 3), ToLaD#247. */
const GRID_PX_ORDERS = 8;

/** colBoxes' boxes per fan, kept: their edges' memo entries [left, right, version, width] reused, worked out again per fold version (ToLaD#209). */
const colBoxCache = new WeakMap<Fan, { key: string; vkey: string; map: Map<FanBranch | FanNode, ColBox>; gen: number; base: Float64Array }>();
/**
 * The columns' boxes (world), kept per fold version. With `view` (world heights [vy0, vy1]) and the fold on its grid,
 * at the mammal level, each box is the column's reach over those heights only, read off the fold's rows for every strand at once
 * (Tess.xRange, ToLaD#255): a column away from the screen falls outside it, and the edges are read only near a label.
 */
function colBoxes(fan: Fan, view?: [number, number]): Map<FanBranch | FanNode, ColBox> {
  // (Folded, fold.ts: the columns move with the fold; their boxes and edges are worked out again when it changes.)
  const fold = fan.tess.fold;
  const key = fold ? `${fold.ver}:${fold.gridH}` : '';
  // (At the level with orders only, ~12,000 columns: a level's labels elsewhere as they were, ToLaD#255.)
  const rows = !!view && !!fold && fold.gridH > 0 && fold.ordShare.length > 0;
  const vkey = rows ? `${key}:${view![0]}:${view![1]}` : key;
  let hit = colBoxCache.get(fan);
  if (hit && hit.vkey === vkey) return hit.map;
  if (hit && hit.key === key && rows) {
    hit.vkey = vkey;
    viewBoxes(fan, hit.map, view!);
    return hit.map;
  }
  if (!hit) {
    const out = new Map<FanBranch | FanNode, ColBox>();
    const ent = { key, vkey, map: out, gen: 0, base: new Float64Array(2 * (fan.branches.length + fan.nodes.length)) };
    // Edges are pure functions of the height (at a fold version), and most heights asked for are on a grid fixed in
    // the world: memoised, each entry kept from version to version and worked out again in place (no garbage a frame).
    const memo = (f: (y: number, e: number[], fresh: boolean) => void) => {
      const m = new Map<number, number[]>();
      return (y: number): [number, number] => {
        let r = m.get(y);
        if (!r) {
          if (m.size > 4096) m.clear();
          m.set(y, (r = [0, 0, ent.gen, 0]));
          f(y, r, true);
        } else if (r[2] !== ent.gen) {
          r[2] = ent.gen;
          f(y, r, false);
        }
        return r as unknown as [number, number];
      };
    };
    for (const b of fan.branches) {
      const at = memo((y, e, fresh) => {
        // (Its width stands whatever the fold: kept.)
        if (fresh) e[3] = widthAt(b, y);
        const w = e[3];
        const l = leftAt(b, y, w);
        e[0] = l;
        e[1] = l + w;
      });
      out.set(b, { x0: Math.min(b.x0, b.colLeft), x1: Math.max(b.x0, b.colLeft) + b.width, y0: b.tipY, y1: b.splitY, lean: b.leanY, own: b, at });
    }
    for (const v of fan.nodes) {
      const at = memo((y, e) => {
        const l = nodeLeftAt(v, y);
        e[0] = l;
        e[1] = l + v.width;
      });
      out.set(v, { x0: Math.min(v.tile, v.left), x1: Math.max(v.tile, v.left) + v.width, y0: v.y, y1: v.parent ? v.yBot : Infinity, lean: v.leanY, own: v, at });
    }
    let i = 0;
    for (const q of out.values()) {
      ent.base[i++] = q.x0;
      ent.base[i++] = q.x1;
    }
    colBoxCache.set(fan, (hit = ent));
  } else {
    hit.gen++;
    let i = 0;
    for (const q of hit.map.values()) {
      q.x0 = hit.base[i++];
      q.x1 = hit.base[i++];
    }
  }
  hit.key = key;
  hit.vkey = vkey;
  const out = hit.map;
  if (rows) viewBoxes(fan, out, view!);
  else if (fold && fold.left(0, fan.time.y(0)) !== null) {
    // Folded: each box from its edges over its span (the fold moves columns smoothly), a hair wider, read at
    // heights on one grid for all of them, BOX_ROWS over the fan (a power of two: on the fold's own grid), so
    // the fold works out a few hundred rows a change, not a dozen per column (it changes on every pan and pinch).
    const now = fan.time.y(0);
    const yb = fan.trunkBottom.y;
    const step = 2 ** Math.ceil(Math.log2(Math.max(1e-12, (yb - now) / BOX_ROWS)));
    for (const q of out.values()) {
      const a = Math.max(q.y0, now);
      const b = Math.min(q.y1, yb);
      // (About a dozen heights: the grid's, every 2^j-th.)
      const st = Math.max(step, 2 ** Math.ceil(Math.log2(Math.max(1e-12, (b - a) / 12))));
      let k0 = Math.ceil(a / st);
      let k1 = Math.floor(b / st);
      // (A span inside one step: the grid's height nearest its middle.)
      if (k1 < k0) k0 = k1 = Math.round((a + b) / 2 / st);
      let x0 = Infinity;
      let x1 = -Infinity;
      let lp = NaN;
      let jump = 0;
      for (let k = k0; k <= k1; k++) {
        const [l, r] = q.at(k * st);
        if (k > k0) jump = Math.max(jump, Math.abs(l - lp));
        lp = l;
        x0 = Math.min(x0, l);
        x1 = Math.max(x1, r, l + q.own.width);
      }
      // (Between two heights it strays at most about as far as it moves from one to the next.)
      const pad = 0.05 * (x1 - x0) + jump;
      q.x0 = x0 - pad;
      q.x1 = x1 + pad;
    }
  }
  return out;
}

/** colBoxes' boxes over the world heights [vy0, vy1]: each strand's reach there off the fold's rows (xRange), a parent column's from its first strand's to its last's. */
function viewBoxes(fan: Fan, out: Map<FanBranch | FanNode, ColBox>, [vy0, vy1]: [number, number]): void {
  const t = fan.tess;
  // (The rows over the whole view first: each column's own heights within it read off that one table.)
  t.xRange(fan.branches[0], vy0, vy1, 2);
  for (const q of out.values()) {
    if (q.y1 <= vy0 || q.y0 > vy1) continue;
    const o = q.own;
    const a = Math.max(vy0, q.y0);
    const b = Math.min(vy1, q.y1);
    if (isNode(o)) {
      q.x0 = t.xRange(o.strands[0], a, b, 2)[0];
      q.x1 = t.xRange(o.strands[o.strands.length - 1], a, b, 2)[1];
    } else [q.x0, q.x1] = t.xRange(o, a, b, 2);
  }
}

/** How much a flight zooms out to pan (ToLaD#246): van Wijk–Nuij's ρ (√2 theirs; less, a long trip zooms out less). */
export const FLY_RHO = 1.2;
/** A flight's time (ms, ToLaD#246): this much ... */
const FLY_MS0 = 650;
/** ... and this much per unit of path (flightPath S: a screen panned, or e^ρ zoomed), ... */
const FLY_MS_PER = 220;
/** ... within these. */
const FLY_MS_MIN = 900;
const FLY_MS_MAX = 1800;

/** A flight's duration (ms) for a path S long (flightPath, ToLaD#246): longer the farther it goes, 0.9–1.8 s. */
export function flightMs(S: number): number {
  return Math.min(FLY_MS_MAX, Math.max(FLY_MS_MIN, FLY_MS0 + FLY_MS_PER * (Number.isFinite(S) ? S : 0)));
}

/** ln cosh x, without overflow. */
function lnCosh(x: number): number {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/**
 * One axis of a flight (ToLaD#246): van Wijk & Nuij's smooth zoom-and-pan from a view `w0` wide (world) to one `w1`
 * wide, `d` away (world). S: its length (log-zoom ÷ ρ plus pan in screens, as the eye sees it). at(e), e from 0 to 1
 * along it at even speed: the view's width there and the share of the pan done (0 to 1). A long trip zooms out to
 * see both ends, pans, zooms in; a short one zooms and pans together.
 */
export function flightPath(w0: number, w1: number, d: number): { S: number; at(e: number): [number, number] } {
  const rho = FLY_RHO;
  const r2 = rho * rho;
  if (!(w0 > 0) || !(w1 > 0) || !Number.isFinite(w0) || !Number.isFinite(w1)) return { S: 0, at: (e) => [w1, e] };
  if (!(d > 1e-6 * Math.max(w0, w1))) {
    // (No pan to speak of: log-zoom, any pan kept to a fixed point on screen.)
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return { S, at: (e) => { const w = w0 * Math.pow(w1 / w0, e); return [w, w0 === w1 ? e : (w0 - w) / (w0 - w1)]; } };
  }
  const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * d * d) / (2 * w0 * r2 * d);
  const b1 = (w1 * w1 - w0 * w0 - r2 * r2 * d * d) / (2 * w1 * r2 * d);
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const S = (r1 - r0) / rho;
  return {
    S,
    at: (e) => {
      const s = e * S;
      const w = w0 * Math.exp(lnCosh(r0) - lnCosh(rho * s + r0));
      const u = (w0 / r2) * Math.exp(Math.log(Math.abs(Math.sinh(rho * s)) || 1e-300) - lnCosh(rho * s + r0));
      return [w, Math.min(1, Math.max(0, u / d))];
    },
  };
}

/** A lineage's species' rooms, side by side above its split: their world x span [x0, x1]. */
const spanCache = new WeakMap<FanNode, [number, number]>();
export function familySpan(v: FanNode): [number, number] {
  if (isFolded(v.strands)) return spanOf(v.strands);
  let s = spanCache.get(v);
  if (!s) spanCache.set(v, (s = spanOf(v.strands)));
  return s;
}

const isFolded = (bs: readonly FanBranch[]): boolean => {
  const fold = bs[0]?.tess.fold;
  return !!fold && fold.left(0, bs[0].tess.time.y(0)) !== null;
};

/** Species' rooms side by side: their world x span [x0, x1] (folded, fold.ts: where the fold has them, at "now", an extinct one's at its tip). */
export function spanOf(bs: readonly FanBranch[]): [number, number] {
  const s: [number, number] = [Infinity, -Infinity];
  if (isFolded(bs)) {
    const now = bs[0].tess.time.y(0);
    for (const b of bs) {
      const y = Math.max(b.tipY, now);
      const c = leftAt(b, y) + laneAt(b, y).w / 2;
      s[0] = Math.min(s[0], c - b.width / 2);
      s[1] = Math.max(s[1], c + b.width / 2);
    }
    return s;
  }
  for (const b of bs) {
    s[0] = Math.min(s[0], b.colLeft);
    s[1] = Math.max(s[1], b.colLeft + b.width);
  }
  return s;
}

/** The fan's families (splits founding a taxon ending in -idae, splits.ts familyLabel; not the root: the clade's own label names it), with their labels. */
const famCache = new WeakMap<Fan, { v: FanNode; vi: number; text: string }[]>();
export function families(fan: Fan): { v: FanNode; vi: number; text: string }[] {
  let out = famCache.get(fan);
  if (!out) {
    out = [];
    fan.nodes.forEach((v, vi) => {
      const text = v.parent ? familyLabel(v.split) : null;
      if (text) out!.push({ v, vi, text });
    });
    famCache.set(fan, out);
  }
  return out;
}

/** Each species' family (its innermost, families()): kept per fan. */
const sfCache = new WeakMap<Fan, Map<FanBranch, FanNode>>();
export function familyOf(fan: Fan, b: FanBranch): FanNode | undefined {
  let m = sfCache.get(fan);
  if (!m) {
    m = new Map();
    // The widest first, so an inner family (were there one) wins.
    for (const { v } of [...families(fan)].sort((p, q) => q.v.strands.length - p.v.strands.length)) for (const s of v.strands) m.set(s, v);
    sfCache.set(fan, m);
  }
  return m.get(b);
}

/** A family's commonest living species (ToLaD#212): the most individuals alive today (population.ts), from the data. */
const commonCache = new WeakMap<FanNode, FanBranch | null>();
export function commonest(v: FanNode): FanBranch | null {
  let out = commonCache.get(v);
  if (out === undefined) {
    out = null;
    let most = 0;
    for (const b of v.strands) {
      if (b.sp.extinct) continue;
      const n = b.pop.aliveAt(0);
      if (n > most) [most, out] = [n, b];
    }
    commonCache.set(v, out);
  }
  return out;
}

/**
 * The species pills that stand for their family (ToLaD#212), counted with the cull: a family with exactly one
 * species shown (its pill on its tip), others of it hidden in view (their tips there, none of their spots shown) and
 * no family pill of its own shown. Keyed by that species' id: next frame its pill carries the family's name and its
 * commonest living species' picture (labelSpots' `famOf`), and its "+x" counts the family's hidden (plusGroups).
 */
export function familyPills(fan: Fan, spots: readonly LabelSpot[], on: Map<string, boolean>): Map<string, FanNode> {
  const shown = new Map<FanNode, LabelSpot[]>();
  const hid = new Map<FanNode, number>();
  const famShown = new Set<FanNode>();
  const shownIds = new Set<string>();
  for (const s of spots) if (on.get(s.key)) shownIds.add(s.id);
  for (const s of spots) {
    if (s.place === 'fam') {
      if (on.get(s.key) && s.v) famShown.add(s.v);
      continue;
    }
    if (!s.b || s.ev !== undefined) continue;
    const v = familyOf(fan, s.b);
    if (!v) continue;
    if (on.get(s.key)) {
      let g = shown.get(v);
      if (!g) shown.set(v, (g = []));
      g.push(s);
    } else if (s.place === 'tip' && s.fit > 0 && !shownIds.has(s.id)) hid.set(v, (hid.get(v) ?? 0) + 1);
  }
  const out = new Map<string, FanNode>();
  for (const [v, g] of shown) {
    const s = g[0];
    if (g.length === 1 && s.place === 'tip' && !s.b!.sp.extinct && (hid.get(v) ?? 0) > 0 && !famShown.has(v)) out.set(s.id, v);
  }
  return out;
}

/** A family's label stands on "now" over its species (its bracket under it) while its span on screen is under this many screens. */
const FAMILY_MAX_SCREENS = 1.6;

/**
 * The species' and lineages' label spots. `top` is the labels' top line
 * (under the buttons); `barX0` the buttons' left edge: left of it a label on
 * "now" may reach higher, up to LABEL_CEIL.
 */
export function labelSpots(
  c: Screen,
  fan: Fan,
  top: number,
  measure: (text: string) => number,
  barX0?: number,
  brk?: { named(v: FanNode): boolean },
  plus?: (id: string) => number,
  famOf?: (id: string) => FanNode | undefined,
  lod?: Lod | null,
): LabelSpot[] {
  const half = LABEL_PILL / 2;
  const X = (x: number) => c.toScreen(x, 0)[0];
  const Y = (y: number) => c.toScreen(0, y)[1];
  const bottom = c.h - LABEL_BOTTOM_PX + 30;
  const botFit = (y1: number) => clamp01((bottom - y1) / 30);
  const nowY = fan.time.y(0);
  const nowS = Y(nowY);
  /** "now" on screen (below the top line): 1, fading over 24 px as it goes above. */
  const nowOn = clamp01((nowS - top) / 24);

  // Heights (world) to measure a column's edge at between wa < wb: both ends, its own ends and peel's end
  // (`at`) and a grid fixed in the world, at most 8 px apart. Points only enter at the ends, where the edge
  // is measured exactly, so what is measured changes continuously as the camera moves.
  const grid = 2 ** -Math.ceil(Math.log2(Math.max(1e-12, c.cam.sy) / 8));
  const heights = (wa: number, wb: number, at: number[]): number[] => {
    const ys = [wa, wb];
    for (const y of at) if (y > wa && y < wb) ys.push(y);
    for (let y = Math.ceil(wa / grid) * grid; y < wb; y += grid) ys.push(y);
    return ys;
  };
  // What a label beside a branch must clear: the columns near it (their widest reach within CLEAR px).
  // A gap of CLEAR px or more counts as clear (clearFit is 1 from there).
  const CLEAR = 6;
  // Only the columns near the screen can meet a label on it (with hundreds of species, ToLaD#146, the rest are most).
  const [vx0, vy0] = c.toWorld(-60, -60);
  const [vx1, vy1] = c.toWorld(c.w + 60, c.h + 60);
  const boxes = colBoxes(fan, [vy0, vy1]);
  const near = (q: ColBox) => !(q.x1 < vx0 || q.x0 > vx1 || q.y1 <= vy0 || q.y0 > vy1);
  const cols = [...boxes.values()].filter(near);
  // ...and those in the strip's own few px across: the columns bucketed by their world x span.
  const NB = 64;
  const bw = Math.max(1e-12, (vx1 - vx0) / NB);
  const buckets: number[][] = Array.from({ length: NB }, () => []);
  cols.forEach((q, i) => {
    const k0 = Math.max(0, Math.floor((q.x0 - vx0) / bw));
    const k1 = Math.min(NB - 1, Math.floor((q.x1 - vx0) / bw));
    for (let k = k0; k <= k1; k++) buckets[k].push(i);
  });
  const seen = new Int32Array(cols.length);
  let stamp = 0;
  /** Least gap (px, up to CLEAR) between the strip [xa, xb] × [ya, yb] and any column but `own`'s (negative: they overlap). */
  const clearance = (xa: number, xb: number, ya: number, yb: number, own: FanBranch | FanNode) => {
    let gap = CLEAR;
    if (!(yb > ya)) return gap;
    const [wxa, wya] = c.toWorld(xa - CLEAR, ya);
    const [wxb, wyb] = c.toWorld(xb + CLEAR, yb);
    stamp++;
    const k0 = Math.max(0, Math.min(NB - 1, Math.floor((wxa - vx0) / bw)));
    const k1 = Math.max(0, Math.min(NB - 1, Math.floor((wxb - vx0) / bw)));
    for (let k = k0; k <= k1; k++) for (const qi of buckets[k]) {
      if (seen[qi] === stamp) continue;
      seen[qi] = stamp;
      const q = cols[qi];
      if (q.own === own || q.x1 < wxa || q.x0 > wxb || q.y1 <= wya || q.y0 > wyb) continue;
      // (heights()'s, without the array: the least over them.)
      const wa = Math.max(wya, q.y0);
      const wb = Math.min(wyb, q.y1 - 1e-9);
      for (let j = -3, y = Math.ceil(wa / grid) * grid; j < 0 || y < wb; j < 0 ? j++ : (y += grid)) {
        const wy = j === -3 ? wa : j === -2 ? wb : j === -1 ? q.lean : y;
        if (j === -1 && !(wy > wa && wy < wb)) continue;
        const e = q.at(wy);
        gap = Math.min(gap, Math.max(X(e[0]) - xb, xa - X(e[1])));
      }
      // Hidden from here on whatever else is near.
      if (gap <= -1) return gap;
    }
    return gap;
  };
  const clearFit = (gap: number) => clamp01((gap + 1) / 6);

  /** The spots beside a column on screen from y0 down (its own edge from `edge`, its bottom at screen yBot). */
  const beside = (id: string, text: string, rank: Rank, len: number, own: FanBranch | FanNode, yTop: number, yBot: number, fit0: number, ref: { b?: FanBranch; v?: FanNode }): LabelSpot[] => {
    const y0 = Math.max(top, yTop);
    const y1 = y0 + len;
    if (!(fit0 > 0) || y0 > bottom) return [];
    // Its widest (l, r) and narrowest (il, ir) along the pill.
    let l = Infinity;
    let r = -Infinity;
    let il = -Infinity;
    let ir = Infinity;
    const wTop = c.toWorld(0, y0)[1];
    const wBot = c.toWorld(0, Math.min(y1, yBot))[1] - 1e-9;
    if (!(wBot >= wTop)) return [];
    const ob = boxes.get(own)!;
    for (const wy of heights(wTop, wBot, [ob.lean])) {
      const [a, b] = ob.at(wy);
      l = Math.min(l, X(a));
      r = Math.max(r, X(b));
      il = Math.max(il, X(a));
      ir = Math.min(ir, X(b));
    }
    if (!(r >= l)) return [];
    // Fades: the column's part on screen too short to stand beside, and the legend.
    const f = fit0 * clamp01((yBot - y0 - 12) / 24) * botFit(y1);
    const out: LabelSpot[] = [];
    // Inside it, at the top line, when it is wide enough on screen (zoomed into it): centred on its part on screen.
    {
      const a = Math.max(il, LABEL_AXIS_X) + half + 4;
      const b = Math.min(ir, c.w) - half - 4;
      const mid = (il + ir) / 2;
      const x = a <= b ? Math.min(Math.max(mid, a), b) : Math.min(Math.max(mid, b), a);
      const fit = f * clamp01((b - a) / 8) * clamp01((yBot - y1) / 12);
      out.push({ key: `${id}:in`, id, place: 'in', ...ref, text, rank, x, y1, box: [x - half, y0, x + half, y1], fit });
    }
    for (const place of ['right', 'left'] as const) {
      const x = place === 'right' ? r + LABEL_GAP + half : l - LABEL_GAP - half;
      const xa = x - half;
      const xb = x + half;
      // Clear of the other columns and the time axis (past the screen's right edge it is only cut off).
      const fit = f > 0 && xa < c.w && xb > 0 ? f * clearFit(Math.min(xa - LABEL_AXIS_X, clearance(xa, xb, y0, y1, own))) : 0;
      out.push({ key: `${id}:${place}`, id, place, ...ref, text, rank, x, y1, box: [xa, y0, xb, y1], fit });
    }
    return out;
  };

  const out: LabelSpot[] = [];
  // The families (ToLaD#146), first of all: standing on "now" over their species while "now" is on screen, the
  // span they name bracketed under the pill; at its left end, else its middle, else its right end (whichever
  // meets no other label: the left end clears the middle of a family's one big column). The same name (`n<i>`)
  // as its lineage's label beside its parent column, so once "now" is off screen the one becomes the other.
  // (With the clades' brackets, ToLaD#193, a family is named on its bracket where that has room, else here, over the stack.)
  for (const { v, vi, text } of families(fan)) {
    // (The mammal level, lod.ts: a family inside a clade drawn as one branch is not named; the clade is.)
    if (brk?.named(v) || lod?.hidden(v)) continue;
    const [wa, wb] = familySpan(v);
    const sa = X(wa);
    const sb = X(wb);
    // (With room at its top end for the "+x" of the pills it hides, ToLaD#197.)
    const px = plus?.(`n${vi}`) ?? 0;
    const len = measure(text) + 2 * LABEL_PAD + px;
    const lo = Math.max(sa, LABEL_AXIS_X) + half;
    const hi = Math.min(sb, c.w) - half;
    // Its span on screen right of the axis (fading over a pill's width), and not so wide that the screen is inside it.
    const onX = clamp01((Math.min(sb, c.w) - Math.max(sa, LABEL_AXIS_X) + 12) / LABEL_PILL);
    const fit0 = nowOn * onX * clamp01((FAMILY_MAX_SCREENS * c.w - (sb - sa)) / (0.4 * c.w));
    if (!(fit0 > 0)) continue;
    // (On "now", under the brackets, ToLaD#193: a long one reaches up over their lines.)
    const y1 = Math.max(nowS - 4, top + len);
    const fit = fit0 * botFit(y1);
    const xs = lo <= hi - LABEL_PILL ? [lo, (lo + hi) / 2, hi] : [Math.min(Math.max((sa + sb) / 2, LABEL_AXIS_X + half), c.w - half)];
    xs.forEach((x, k) => {
      out.push({ key: `n${vi}:fam${k}`, id: `n${vi}`, place: 'fam', v, fam: v, pic: commonest(v), text, rank: [-1, wb - wa, vi], x, y1, box: [x - half, y1 - len, x + half, y1], fit, span: brk ? undefined : [sa, sb], plus: px });
    });
  }
  for (const b of fan.branches) {
    if ((lod && lod.of[b.index] >= 0) || !near(boxes.get(b)!)) continue;
    const id = String(b.sp.gid);
    // (Standing for its family, ToLaD#212: the family's name on its tip, last frame's familyPills.)
    const fam = famOf?.(id);
    const famText = fam && familyLabel(fam.split);
    const len = measure(b.sp.common) + 2 * LABEL_PAD;
    const rank: Rank = [0, b.width, b.index];
    // (On its tip, room at its top end for the "+x" of the pills it hides, ToLaD#197: as many as last frame.)
    const px = plus?.(id) ?? 0;
    const tlen = (famText ? measure(famText) + 2 * LABEL_PAD : len) + px;
    // On its tip: centred on the column there, kept on screen (right of the time axis) while the column is.
    const tl = X(leftAt(b, b.tipY));
    const tw = laneAt(b, b.tipY).w * c.cam.sx;
    const room = b.width * c.cam.sx;
    const cx = tl + tw / 2;
    // (Folded, fold.ts: its room about where the fold has its column.)
    const left = fan.tess.fold?.left(b.index, b.tipY) != null ? cx - room / 2 : X(b.colLeft);
    const lo = Math.max(left, LABEL_AXIS_X) + half;
    const hi = Math.min(left + room, c.w) - half;
    const x = lo <= hi ? Math.min(Math.max(cx, lo), hi) : Math.min(Math.max(cx, hi), lo);
    const ceil = barX0 === undefined ? top : LABEL_CEIL + (top - LABEL_CEIL) * clamp01((x + half - (barX0 - 68)) / 60);
    const ty = Y(b.tipY);
    // On "now", under the clades' brackets (ToLaD#193: a long name reaches up over their lines, opaque over them).
    const y1 = Math.max(ty - 4, ceil + tlen);
    // The tip on screen (below the top line) and its column right of the axis and left of the screen's edge.
    const tipOn = clamp01((ty - top) / 24) * clamp01((left + room - LABEL_AXIS_X + 12) / LABEL_PILL) * clamp01((c.w + 12 - left) / LABEL_PILL);
    // Above the tip, clear of the other columns (an extinct tip has its neighbours around it; above "now" there are none).
    const f = tipOn * botFit(y1);
    const tipFit = f > 0 && b.tipY > nowY ? f * clearFit(clearance(x - half, x + half, y1 - tlen, Math.min(y1, ty - 2), b)) : f;
    const tip: LabelSpot = { key: `${id}:tip`, id, place: 'tip', b, text: famText || b.sp.common, rank, x, y1, box: [x - half, y1 - tlen, x + half, y1], fit: tipFit, plus: px };
    if (famText) Object.assign(tip, { fam, pic: commonest(fam!) });
    out.push(tip);
    // Beside its branch: once the tip is off screen.
    out.push(...beside(id, b.sp.common, rank, len, b, ty, Y(b.splitY), 1 - clamp01((ty - top) / 24), { b }));
  }
  // Curated events (ToLaD#141): the title beside its window (or in the column when zoomed into it),
  // centred on the window, while the window is on screen. After the species' names, before the lineages'.
  for (const b of fan.branches) {
    if ((lod && lod.of[b.index] >= 0) || !near(boxes.get(b)!)) continue;
    // (A hairline column, ToLaD#146: its events tinted on it, their titles only once it has a few px of room.)
    if (b.width * c.cam.sx < TEX_HAIR_PX[1]) continue;
    for (const s of colEventsY(fan, b)) {
      const text = s.ev.title;
      const len = measure(text) + 2 * LABEL_PAD;
      const st = Y(s.top);
      const sb = Y(s.bot);
      const fit0 = clamp01((sb - top) / 12) * clamp01((bottom - st) / 12);
      const rank: Rank = [0.5, b.width, b.index * 64 + s.k];
      for (const p of beside(`e${b.sp.gid}.${s.k}`, text, rank, len, b, (st + sb) / 2 - len / 2, Y(b.splitY), fit0, { b })) out.push({ ...p, ev: s.k });
    }
  }
  // The lineages (parent columns, not the stem below the root: the clade's own label is there), while "now" is off screen.
  if (nowOn < 1) {
    for (let vi = 0; vi < fan.nodes.length; vi++) {
      const v = fan.nodes[vi];
      if (!v.parent || lod?.hidden(v) || !near(boxes.get(v)!)) continue;
      const text = familyLabel(v.split) ?? v.name;
      const id = `n${vi}`;
      const len = measure(text) + 2 * LABEL_PAD;
      const rank: Rank = [1, v.width, vi];
      out.push(...beside(id, text, rank, len, v, Y(v.y), Y(v.yBot), 1 - nowOn, { v }));
    }
  }
  return out;
}

/**
 * Which spots show: at most one per name, never two meeting. A fixed priority
 * (species first, the wider column first, then tree order) so the order never
 * changes with the camera; a name takes the first of its spots (on its tip,
 * in its column, right, left)
 * that meets none shown before it. Hysteresis: the spots shown last frame go
 * first, each keeping its place while it fits and meets no other; a hidden
 * one waits for a clear gap and a fit over 0.6, so a newcomer never pushes a
 * shown label off.
 */
export function resolveLabels(spots: LabelSpot[], prev: Map<string, boolean>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const taken: number[][] = [];
  const done = new Set<string>();
  const placeOrder = { fam: 0, tip: 0, in: 1, right: 2, left: 3 };
  const order = [...spots].sort((p, q) => p.rank[0] - q.rank[0] || q.rank[1] - p.rank[1] || p.rank[2] - q.rank[2] || placeOrder[p.place] - placeOrder[q.place]);
  for (const s of spots) out.set(s.key, false);
  // The spots shown last frame first (each keeps its place while it fits and meets no other), then the rest.
  for (const pass of [true, false]) {
    for (const s of order) {
      if (done.has(s.id) || !!prev.get(s.key) !== pass) continue;
      if (!(s.fit > (pass ? 0 : 0.6))) continue;
      if (taken.some((q) => boxGap(s.box, q) < (pass ? -1 : 5))) continue;
      out.set(s.key, true);
      done.add(s.id);
      taken.push(s.box);
    }
  }
  return out;
}

/**
 * The "+x" badges (ToLaD#197): for each pill shown on "now" (a species' on its tip, a family's over its species), the
 * species whose pills are hidden that it stands for. A species counts as hidden when its tip spot is there (fit > 0:
 * its tip and column on screen) and none of its spots shows; each counts once, on the shown pill nearest it (the left one on a tie), so the
 * badges add up to the species hidden in view. Keyed by the shown spot's key; the pills with none are left out.
 * Given the fan, a hidden species whose family has a pill shown counts on that one instead (ToLaD#212: the family's "+x").
 */
export function plusGroups(spots: readonly LabelSpot[], on: Map<string, boolean>, fan?: Fan): Map<string, FanBranch[]> {
  const out = new Map<string, FanBranch[]>();
  const shownIds = new Set<string>();
  for (const s of spots) if (on.get(s.key)) shownIds.add(s.id);
  const isTip = (s: LabelSpot) => s.place === 'tip' && !!s.b && s.ev === undefined;
  const shown = spots.filter((s) => (isTip(s) || s.place === 'fam') && on.get(s.key)).sort((p, q) => p.x - q.x);
  if (!shown.length) return out;
  const famPill = new Map<FanNode, LabelSpot>();
  if (fan) for (const s of shown) if (s.fam && !famPill.has(s.fam)) famPill.set(s.fam, s);
  // (The rest on the nearest species' pill: a family's counts its own family only, unless no other is shown.)
  const near = famPill.size && shown.some((s) => !s.fam) ? shown.filter((s) => !s.fam) : shown;
  for (const s of spots) {
    if (!isTip(s) || !(s.fit > 0) || shownIds.has(s.id)) continue;
    const fp = famPill.size ? famPill.get(familyOf(fan!, s.b!)!) : undefined;
    if (fp) {
      let g = out.get(fp.key);
      if (!g) out.set(fp.key, (g = []));
      g.push(s.b!);
      continue;
    }
    // The nearest shown pill: a binary search for the first right of it, then it or the one before.
    let lo = 0;
    let hi = near.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (near[m].x < s.x) lo = m + 1;
      else hi = m;
    }
    const r = near[Math.min(lo, near.length - 1)];
    const l = near[Math.max(lo - 1, 0)];
    const at = s.x - l.x <= r.x - s.x ? l : r;
    let g = out.get(at.key);
    if (!g) out.set(at.key, (g = []));
    g.push(s.b!);
  }
  return out;
}

/** Gap (px) between two boxes [x0, y0, x1, y1]: negative when they overlap. */
export function boxGap(a: number[], b: number[]): number {
  return Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export interface Selection {
  sp: SpeciesRec;
  ind?: IndInfo;
  /** The time touched (Ma), within the species' column: the card shows the population then. */
  ageMa?: number;
  /** The species' start (Ma): its split, where its own column begins (the card's numbers are the column's). */
  startMa?: number;
  /** A parent column touched (below the species' split): the lineage there, its numbers at the time touched. */
  lineage?: Lineage;
  /** A curated event touched (its window on the column, or its label): the card explains it (ToLaD#141). */
  event?: EventSpan;
}

/** A parent column at a time: the daughters' shared ancestors. */
export interface Lineage {
  node: FanNode;
  name: string;
  ageMa: number;
  /** Individuals alive then (model) and the share with living descendants today. */
  alive: number;
  green: number;
  /** The species it is the ancestor of, left to right (common names). */
  of: string[];
}

/** The lineage in the column strand b is in at age `ageMa` (at or below its split). */
export function lineageAt(b: FanBranch, fan: Fan, ageMa: number): Lineage {
  const v = segAt(b, fan.time.y(ageMa)).node;
  return { node: v, name: v.name, ageMa, alive: v.n, green: nodeQ(v, ageMa), of: v.strands.map((s) => s.sp.common) };
}

interface RibbonPt {
  x: number;
  y: number;
  nx: number;
  ny: number;
  w: number;
  f: number;
}

export class FanView implements InputHandlers {
  readonly ctx: CanvasRenderingContext2D;
  readonly input: Input;
  readonly camera: FanCamera;
  mode: WidthMode = 'linear';
  edge: EdgeStyle = 'curved';
  dpr = 1;
  selected: SpeciesRec | null = null;
  selInd: { g: number; i: number } | null = null;
  /** The point touched on the selected column (world x, age in Ma): marked on the graph, the card's numbers are for it. */
  touch: { x: number; ageMa: number } | null = null;
  onSelect: (sel: Selection | null) => void = () => {};
  /** The width scale bar (a DOM element above the legend / cards): its bar and label are set each frame. */
  scaleEl: HTMLElement | null = null;
  /** The buttons (a DOM element over the canvas): labels never go under them. */
  barEl: HTMLElement | null = null;
  private scaleKey = '';
  /** Each species' label: shown or not, and its fade (0–1); when it was last drawn (ms). */
  private labelState = new Map<string, { on: boolean; a: number }>();
  private labelT = 0;
  /** `?debug`: a readout of the zooms, years on screen and individuals per px. */
  readonly debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  /** `?debug&hide=stem,lanes,glow,ind,held,events,fade`: those layers not drawn (finding which layer draws what, ToLaD#210, #231). */
  private readonly hide = new Set(this.debug ? (new URLSearchParams(location.search).get('hide') ?? '').split(',') : []);
  /** What each branch's individuals view drew last frame (taps, tests). */
  twigStats = new Map<number, TwigStats>();
  /** Without the GPU layer: this frame's styled column stretches, faded once the individuals are drawn. */
  private heldRuns: { run: RibbonPt[]; hw: number; d: number }[] = [];
  /** drawStem's chords on screen (their left edges, their rows). */
  private stemXs = new Float64Array(64);
  private stemSy = new Float64Array(64);
  /** The event labels shown last frame (screen boxes): a tap on one opens its event. */
  private eventLabels: { box: [number, number, number, number]; b: FanBranch; k: number }[] = [];
  /**
   * The species' pictures as last drawn (ToLaD#193): [x, y, radius, its column, the family a family pill's picture
   * stands for]. A tap on one flies to its species' branch (ToLaD#230; a family pill's, to the family).
   */
  thumbHits: [number, number, number, FanBranch, FanNode?][] = [];
  /** The species' name pills drawn (ToLaD#230): a tap flies to the species' branch, as a bracket's to its clade. */
  nameHits: { box: [number, number, number, number]; b: FanBranch }[] = [];
  /**
   * Where the last tap on a pill, a picture or a bracket flew (ToLaD#230): the species tapped (`b`, null for a clade's),
   * the clade framed (`v`, null for the species' own frame) and the camera it landed at. Tapped again there, with
   * nothing moved since, it goes one level out.
   */
  private tapAt: { b: FanBranch | null; v: FanNode | null; cam: Camera } | null = null;
  /** The "+x" badges as last drawn (ToLaD#197): the count on each species' pill (by id), and where a tap on one lands. */
  private plusN = new Map<string, number>();
  /** The species pills standing for their family (ToLaD#212), from the frame before (familyPills). */
  private famPills = new Map<string, FanNode>();
  /** The family pills drawn (ToLaD#212): a tap flies to the family, as its bracket's. */
  famHits: { box: [number, number, number, number]; v: FanNode }[] = [];
  plusHits: { box: [number, number, number, number]; bs: FanBranch[] }[] = [];
  private models = new Map<string, TwigModel>();
  private raf = 0;
  private anim: ((t: number) => boolean) | null = null;
  private ro: ResizeObserver;
  /** The WebGL2 layer under the canvas: lanes and the individuals mesh (null: Canvas 2D only). */
  readonly gl: FanGL | null = null;
  /** The world on the time axis (world.ts): its layers on or off, and the axis labels it keeps clear of. */
  world = worldFlags(typeof location !== 'undefined' ? location.search : '');
  readonly axisBoxes: Box[] = [];
  /** Frame times (ms, CPU side of draw()), for perf runs. */
  readonly frameMs: number[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clade: CladeRec,
    edge: EdgeStyle = 'curved',
    readonly tree: Split = FELIDAE_TREE,
    /** The fold (fold.ts, ToLaD#146): the order one branch from afar, its splits opening as you zoom in. */
    readonly folds = false,
  ) {
    this.edge = edge;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    this.ctx = ctx;
    // The GPU layer sits right under the 2D canvas (same box) and takes no input.
    if (canvas.parentElement && typeof document !== 'undefined' && !new URLSearchParams(location.search).has('nogl')) {
      const glc = document.createElement('canvas');
      glc.className = canvas.className;
      glc.style.pointerEvents = 'none';
      glc.setAttribute('aria-hidden', 'true');
      canvas.parentElement.insertBefore(glc, canvas);
      try {
        this.gl = new FanGL(glc);
      } catch (e) {
        console.warn('fan: no WebGL2, drawing with Canvas 2D', e);
        glc.remove();
      }
    }
    this.camera = new FanCamera(this.withFold(layoutFan(clade, this.mode, tree, this.edge)), (b) => this.model(b));
    // Width and time zoom separately (#138): a sideways pinch zooms width, an upright one time, a diagonal both.
    this.input = new Input(canvas, this, true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.camera.cam = this.homeCamera();
    this.camera.settle();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.foldRestT);
    this.input.destroy();
    this.ro.disconnect();
    this.gl?.canvas.remove();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const first = this.w === 1;
    this.camera.w = Math.max(1, r.width);
    this.camera.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (first) this.cam = this.homeCamera();
    this.camera.settle();
    this.request();
  }

  get cam(): Camera {
    return this.camera.cam;
  }
  set cam(c: Camera) {
    this.camera.cam = c;
  }
  get fan(): Fan {
    return this.camera.fan;
  }
  get w(): number {
    return this.camera.w;
  }
  get h(): number {
    return this.camera.h;
  }

  /** The whole fan: "now" near the top, the stem entering from the bottom edge. */
  homeCamera(): Camera {
    return this.withBand(this.camera.home());
  }

  /**
   * The clades' brackets above "now" (brackets.ts, ToLaD#193; `?brackets=0` off): this frame's stack, or null.
   * The species' pills stand on it.
   */
  private readonly brackets = typeof location !== 'undefined' && new URLSearchParams(location.search).get('brackets') === '0' ? null : new Brackets(font('600 11px'), font('italic 400 11px', SERIF));
  private layoutBrackets(): Brackets | null {
    const br = this.brackets;
    if (!br) return null;
    const nowS = this.toScreen(0, this.yNow)[1];
    const top = this.labelTop();
    const fit = clamp01((nowS - top) / 24);
    const measure = (f: string, t: string) => {
      this.ctx.save();
      this.ctx.font = f;
      const w = this.ctx.measureText(t).width;
      this.ctx.restore();
      return w;
    };
    // (The mammal level, lod.ts: nothing inside a clade drawn as one branch is bracketed.)
    const lod = this.lodNow();
    br.hide = lod ? (v) => lod.hidden(v) : null;
    br.hideKey = lod ? String(lod.gen) : '';
    br.layout(this.camera, this.fan, nowS, LABEL_AXIS_X, fit, measure, top);
    // The groups the view is inside, pinned under the buttons as the stack scrolls off (ToLaD#233).
    br.pin(top, this.camera.toWorld(0, 0)[1], measure, br.fit < 1 ? (this.centreLine()?.node ?? null) : null);
    return br;
  }

  /** The branch whose column at screen (px, py) is nearest it (ToLaD#233: the lineage the view is in), null for none there. */
  private lineAt(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    if (wy > this.fan.trunkBottom.y) return null;
    let best: FanBranch | null = null;
    let bd = Infinity;
    for (const b of this.fan.branches) {
      if (wy < b.tipY) continue;
      const left = leftAt(b, wy);
      const d = Math.max(0, left - wx, wx - left - laneAt(b, wy).w);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** A frame with room above "now" for BAND_ROWS rows of brackets: "now" lowered by them, the fork where it was. */
  private withBand(cam: Camera): Camera {
    if (!this.brackets) return cam;
    const extra = Math.min(BAND_ROWS, bandDepth(this.fan)) * ROW_H;
    const sn = this.h / 2 + (this.yNow - cam.cy) * cam.sy;
    const sb = this.h - 150;
    const sy = cam.sy * Math.max(0.5, (sb - sn - extra) / Math.max(1, sb - sn));
    return { ...cam, sy, ty: sy, cy: this.yNow + (this.h / 2 - sn - extra) / sy };
  }

  /**
   * Where a tap on a clade's bracket lands (brackets.ts cladeCamera, ToLaD#193): the clade centred and opened,
   * "now" down to where its branch started. The whole fan for the root.
   */
  cladeCamera(v: FanNode): Camera {
    if (!v.parent) return this.homeCamera();
    return cladeCamera(this.camera, this.fan, v, familySpan, (cam) => this.withBand(cam));
  }

  /**
   * A bracket's tap: fly to its clade (cladeCamera), any card closed for the flight. Folded, the flight tracks the
   * frame as the fold moves and lands on it computed there (flyTo, ToLaD#246).
   */
  flyToClade(v: FanNode, landed?: () => void): void {
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    this.flyTo(() => this.cladeCamera(v), undefined, landed);
  }

  /** The ranked clade a species sits in (ToLaD#230): the nearest with a rank (genus, subfamily, family…), else the root. */
  cladeOf(b: FanBranch): FanNode {
    let v = b.node;
    while (v.parent && !rankOf(latinOf(v.split))) v = v.parent;
    return v;
  }

  /** One level out from clade v (ToLaD#230): the nearest ranked clade it sits in, the root last; null from the root. */
  outOf(v: FanNode): FanNode | null {
    for (let p = v.parent; p; p = p.parent) if (!p.parent || rankOf(latinOf(p.split))) return p;
    return null;
  }

  /** Whether the last pill/picture/bracket flight landed where the camera still is (ToLaD#230): nothing moved since. */
  private landedHere(): boolean {
    const t = this.tapAt;
    if (!t || this.anim) return false;
    const c = this.cam;
    const d = t.cam;
    return (
      Math.abs(Math.log(c.sx / d.sx)) < 1e-3 &&
      Math.abs(Math.log(c.sy / d.sy)) < 1e-3 &&
      Math.abs(c.cx - d.cx) * c.sx < 0.5 &&
      Math.abs(c.cy - d.cy) * c.sy < 0.5
    );
  }

  /** Fly to clade v from a tap (ToLaD#230), remembering where it lands (`b` the species tapped, if any). */
  private flyLevel(b: FanBranch | null, v: FanNode): void {
    this.flyToClade(v, () => (this.tapAt = { b, v, cam: { ...this.cam } }));
  }

  /** A tap on a species' name pill or picture (ToLaD#230): fly to its branch (speciesCamera) and open its card (ToLaD#241). */
  tapSpecies(b: FanBranch): void {
    this.flyToSpecies(b.sp);
  }

  /** A tap on a clade's bracket or family pill (ToLaD#193, #212): fly to it; already framed on it, to the clade above (ToLaD#230). */
  tapClade(v: FanNode): void {
    const t = this.landedHere() ? this.tapAt : null;
    if (t && t.v === v) this.flyLevel(t.b, this.outOf(v) ?? v);
    else this.flyLevel(null, v);
  }

  /**
   * Where a tap on a pill's "+x" lands (ToLaD#197): as a clade's bracket's tap (cladeCamera), the species it stands
   * for (`bs`, the pill's own first) framed across the screen, from "now" down to the split where they meet. Many of them
   * (more than the screen has room for) open to fewer, each with its own "+x": tap again to go on.
   */
  groupCamera(bs: readonly FanBranch[]): Camera {
    let v: FanNode | null = bs[0].node;
    while (v?.parent && !bs.every((b) => v!.strands.includes(b))) v = v.parent;
    if (!v) return this.homeCamera();
    // (Down to the split where they meet, not the clade's stem: for a group across the level, the root, not the world's bottom.)
    return cladeCamera(this.camera, this.fan, { ...v, yBot: v.y }, () => spanOf(bs), (cam) => this.withBand(cam));
  }

  flyToGroup(bs: readonly FanBranch[]): void {
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    this.flyTo(() => this.groupCamera(bs));
  }

  /** The screen point of clade `latin`'s bracket as last drawn, if it is wide enough to tap (designshot), or null. */
  bracketAt(latin: string): [number, number] | null {
    const br = this.brackets;
    const p = br?.placed.find((q) => br.list[q.i].latin === latin);
    return br && p && p.b - p.a >= 6 ? [(p.a + p.b) / 2, br.rowY(p.row)] : null;
  }

  setMode(mode: WidthMode): void {
    this.mode = mode;
    this.relayout();
  }

  /** The edges' design (the toggle): curved or straight. Same data, the camera stays put. */
  setEdge(edge: EdgeStyle): void {
    if (edge === this.edge) return;
    this.edge = edge;
    this.relayout();
  }

  private relayout(): void {
    this.camera.fan = this.withFold(layoutFan(this.clade, this.mode, this.tree, this.edge));
    this.camera.settle();
    this.request();
  }

  resetView(): void {
    this.flyTo(() => this.homeCamera());
  }

  /**
   * A level inside the fan (ToLaD#146): the split founding taxon `name` ("Felidae") framed as home frames the
   * whole fan, its species across the screen and its split near the bottom. Null if the tree has no such split.
   */
  levelCamera(name: string, zoom?: number): Camera | null {
    if (zoom !== undefined) {
      // The level's frame in time, its clade centred at `zoom` × home's width zoom (folded: as it opens there).
      const fr = this.levelCamera(name);
      const v = this.fan.nodes.find((n) => n.split.taxon === name);
      if (!fr || !v) return fr;
      const sx = this.homeCamera().sx * zoom;
      const f = this.fan.tess.fold;
      f?.setScale(sx, this.w);
      let [a, b] = familySpan(v);
      // (Anchored on the clade, as a pinch there would: what opens or grows far from it leaves it still.)
      if (f && f.setAnchor((a + b) / 2, fr.cy, sx, this.w)) [a, b] = familySpan(v);
      // (The fold stays at the frame's zoom: the camera taking the frame finds it there, nothing to follow.)
      return { ...fr, sx, cx: (a + b) / 2 - 22 / sx };
    }
    if (this.fan.root.split.taxon === name) return this.homeCamera();
    const v = this.fan.nodes.find((n) => n.split.taxon === name);
    if (!v) return null;
    // Folded (fold.ts): the clade's span at the zoom that frames it (it opens as it is framed), the rows anchored on
    // it (foldedFrame: else the fold stands on where the view was, and a small clade far from it, the whales from home,
    // is framed where it stood there, ToLaD#247).
    return foldedFrame(this.fan, this.w, () => {
      const [a, b] = familySpan(v);
      return this.withBand(this.camera.frame(a, b, v.y, true));
    });
  }

  /** Fly to a level (levelCamera), or home if the tree has no such split. */
  flyToLevel(name: string): void {
    this.flyTo(() => this.levelCamera(name) ?? this.homeCamera());
  }

  private withFold(fan: Fan): Fan {
    if (this.folds) {
      const f = new Fold(fan);
      f.setAll(0);
      fan.tess.fold = f;
    }
    return fan;
  }

  private foldKey = '';
  /** The fold at this frame's zoom: its grid (about 3 px of screen between rows) and openness; the columns sampled anew if they moved. */
  private applyFold(): void {
    const f = this.fan.tess.fold;
    if (!f) return;
    // (The mammal level, ~5,900 strands a row: rows further apart, GRID_PX_ORDERS, ToLaD#247.)
    f.setGrid(Math.pow(2, Math.round(Math.log2((f.ordShare.length ? GRID_PX_ORDERS : 3) / this.cam.sy))));
    f.setScale(this.cam.sx, this.w);
    const key = `${f.ver}:${f.gridH}`;
    if (key === this.foldKey) {
      // (A frame with the fold at rest after it moved: the columns' edges exact again, ColumnPath.exact.)
      if (this.foldMoving) for (const m of this.models.values()) m.foldRest();
      this.foldMoving = false;
      return;
    }
    this.foldKey = key;
    this.foldMoving = true;
    for (const m of this.models.values()) m.refold();
    // (One frame more once it rests, FOLD_REST_MS on: the edges exact.)
    clearTimeout(this.foldRestT);
    this.foldRestT = setTimeout(() => this.request(), FOLD_REST_MS);
  }
  private foldMoving = false;
  private foldRestT: ReturnType<typeof setTimeout> | undefined;

  model(b: FanBranch): TwigModel {
    const key = `${b.sp.gid}:${this.mode}`;
    let m = this.models.get(key);
    if (!m || m.b !== b) {
      m = new TwigModel(b, this.fan.time, this.mode);
      this.models.set(key, m);
    }
    return m;
  }

  // ---- camera helpers -------------------------------------------------------

  get sx(): number {
    return this.cam.sx;
  }
  get sy(): number {
    return this.cam.sy;
  }

  get yNow(): number {
    return this.fan.time.y(0);
  }

  toScreen(x: number, y: number): [number, number] {
    return this.camera.toScreen(x, y);
  }

  toWorld(px: number, py: number): [number, number] {
    return this.camera.toWorld(px, py);
  }

  /** Zoom about a screen point by factors fx (width) and fy (time), within the camera's limits. */
  zoomAbout(px: number, py: number, fx: number, fy = fx): void {
    this.camera.zoomAbout(px, py, fx, fy);
  }

  /**
   * Fly the camera to the frame `aim` computes (ToLaD#246): slow and smooth, in and out, so the eye can follow. Each axis
   * (width, time) takes a van Wijk–Nuij path (flightPath: a long trip zooms out a little, pans, zooms in), on one sine
   * ease, over a time by how far it goes (flightMs, 0.9–1.8 s, or `ms`). Folded, the frame's world moves as the fold
   * opens, closes and re-anchors: the start and the frame are tracked through it (fold.ts follow) and the camera aims
   * between them each step, landing on the frame computed again there (so nothing snaps at the end). `done` runs when
   * it lands (not if a gesture takes over first).
   */
  flyTo(aim: Camera | (() => Camera), ms?: number, done?: () => void): void {
    const fo = this.fan.tess.fold;
    const from = { ...this.cam };
    // (The frame computed moves the fold to it, ToLaD#211: its state kept, the fold put back where the view stands.)
    const restore = fo?.keep();
    const frame = typeof aim === 'function' ? aim : () => aim;
    const to = frame();
    const toSnap = fo?.snapshot();
    restore?.();
    const fromSnap = fo?.snapshot();
    // A frame that leaves the fold as it is (home): computed again each step where the fold then stands, the flight
    // aiming at it as it moves. One that moves it (foldedFrame's, a level's): its point followed there (fold.ts follow).
    const same = (p: FoldState, q: FoldState) => p.lambda === q.lambda && p.a.every((x, i) => x === q.a[i]) && p.wt.every((x, i) => x === q.wt[i]);
    const live = !!fo && !!toSnap && !!fromSnap && same(toSnap, fromSnap);
    // (The frame's x where the fold stands now, for the path's length.)
    const tx0 = fo && toSnap && !live ? fo.follow(to.cx, to.cy, toSnap) : to.cx;
    const px = flightPath(this.w / from.sx, this.w / to.sx, Math.abs(tx0 - from.cx));
    const py = flightPath(this.h / from.sy, this.h / to.ty, Math.abs(to.cy - from.cy));
    const dur = ms ?? flightMs(Math.max(px.S, py.S));
    const t0 = performance.now();
    let x0 = from.cx;
    let x1 = tx0;
    let at = to;
    this.anim = (now) => {
      const u = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = (1 - Math.cos(Math.PI * u)) / 2;
      if (u >= 1) {
        // Landing: the frame computed where the fold now stands (as the flight has tracked it all the way).
        this.cam = { ...(fo ? frame() : to) };
        this.camera.settle();
        done?.();
        return false;
      }
      const [wx, kx] = px.at(e);
      const [wy, ky] = py.at(e);
      // (A live frame's zoom and height as it now stands, eased in.)
      const sx = (this.w / wx) * Math.pow(at.sx / to.sx, e);
      const sy = (this.h / wy) * Math.pow(at.ty / to.ty, e);
      this.cam = { sx, sy, ty: sy, cx: x0 + (x1 - x0) * kx, cy: from.cy + (at.cy - from.cy) * ky };
      this.camera.settle();
      if (fo && fromSnap && toSnap) {
        // The start and the frame where the fold now has them; the camera between, as far along as the path is.
        x0 = fo.follow(from.cx, from.cy, fromSnap);
        if (live) at = frame();
        x1 = live ? at.cx : fo.follow(to.cx, to.cy, toSnap);
        this.cam.cx = x0 + (x1 - x0) * kx;
      }
      return true;
    };
    this.request();
  }

  /**
   * Where a search pick lands (ToLaD#157): the species' column centred, its tip (now for the living,
   * the last appearance for a fossil) at a fifth of the way down so its label stands above it, and
   * its own stretch (tip to split) filling the band above the card. Width and time are framed apart
   * (#138): the column about half the screen wide, within the width limit.
   */
  speciesCamera(b: FanBranch): Camera {
    const h = this.homeCamera();
    const tipPx = Math.max(this.labelTop() + 150, 0.2 * this.h);
    const band = Math.max(80, 0.52 * this.h - tipPx);
    const sy = Math.max(h.sy, band / Math.max(1e-300, b.splitY - b.tipY));
    const cyAt = (s: number) => b.tipY + (this.h / 2 - tipPx) / s;
    const sx = Math.min(Math.max(h.sx, (0.5 * this.w) / Math.max(1e-300, b.width)), Math.max(h.sx, this.camera.sxCap(b.cx, b.tipY)));
    // Within the time limit (MIN_YEARS on screen) about the tip, where it will sit.
    const s = this.camera.timeCap(b.tipY, tipPx, sy, h.sy);
    // Folded (fold.ts): its column where the fold has it at that zoom, the rows anchored on it (brackets.ts
    // foldedFrame, ToLaD#211: the fold stays there for the camera taking it, so it lands centred).
    const f = this.fan.tess.fold;
    const cx = () => (f && f.left(b.index, b.tipY) !== null ? leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2 : b.cx);
    return foldedFrame(this.fan, this.w, () => ({ cx: cx(), cy: cyAt(s), sx, sy: s, ty: s }));
  }

  /**
   * A search pick: fly to the species' column, then open its card at its tip, as a tap there would. Without `card`
   * (a double-tap stepping back to it, ToLaD#241): no card, the landing remembered (tapAt).
   */
  flyToSpecies(sp: SpeciesRec, card = true): void {
    const b = this.fan.branches.find((x) => x.sp === sp);
    if (!b) return;
    // The card open now closes for the flight (the column stays in view under it).
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    this.flyTo(() => this.speciesCamera(b), undefined, () => {
      if (!card) {
        this.tapAt = { b, v: null, cam: { ...this.cam } };
        this.request();
        return;
      }
      const wy = b.tipY;
      this.selected = sp;
      this.selInd = null;
      this.touch = { x: leftAt(b, wy) + laneAt(b, wy).w / 2, ageMa: sp.t1 };
      this.onSelect({ sp, ageMa: sp.t1, startMa: b.t0 });
      this.request();
    });
  }

  /** Branch (column part) under a screen point, with a finger-sized slop. */
  hitBranch(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    const slop = 16 / this.cam.sx;
    const slopY = 16 / this.cam.sy;
    let best: FanBranch | null = null;
    let bd = Infinity;
    const yb = this.fan.trunkBottom.y;
    for (const b of this.fan.branches) {
      if (wy > yb + slopY || wy < b.tipY - slopY) continue;
      const yc = Math.min(yb, Math.max(b.tipY, wy));
      const left = leftAt(b, yc);
      const d = Math.max(0, left - wx, wx - left - laneAt(b, yc).w);
      if (d <= slop && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---- InputHandlers --------------------------------------------------------

  /** Fling velocity: pan (px/ms), width (z) and time (t) log-zoom (/ms), about (px, py). */
  private vel = { x: 0, y: 0, z: 0, t: 0, px: 0, py: 0 };

  gestureStart(): void {
    this.anim = null;
  }
  gestureEnd(): void {}
  pan(dx: number, dy: number): void {
    if (dx || dy) this.tapAt = null;
    this.camera.pan(dx, dy);
    this.request();
  }
  zoom(px: number, py: number, fx: number, ft: number): void {
    if (fx !== 1 || ft !== 1) this.tapAt = null;
    this.zoomAbout(px, py, fx, ft);
    this.request();
  }
  fling(vx: number, vy: number, vz: number, px: number, py: number, vt = vz): void {
    this.vel = { x: vx, y: vy, z: vz, t: vt, px, py };
    let last = performance.now();
    this.anim = (now) => {
      const dt = Math.min(50, now - last);
      last = now;
      const v = this.vel;
      this.pan(v.x * dt, v.y * dt);
      if (v.z || v.t) this.zoomAbout(v.px, v.py, Math.exp(v.z * dt), Math.exp(v.t * dt));
      const d = Math.exp(-dt / 260);
      v.x *= d;
      v.y *= d;
      v.z *= d;
      v.t *= d;
      return Math.abs(v.x) + Math.abs(v.y) > 0.01 || Math.abs(v.z) + Math.abs(v.t) > 1e-5;
    };
    this.request();
  }
  /**
   * A double-tap (ToLaD#241, #245). On a branch other than the one the view is in (intoAt): into it, its frame, no
   * card. On the branch the view is in, or on empty space: one step back, out along the ladder of frames over what is
   * on screen (backLadder): deep in a species, its frame; at a species' frame, its clade's; at a clade's, the next clade
   * out; … home. At home on empty space, nothing.
   */
  doubleTap(x: number, y: number): void {
    const into = this.intoAt(x, y);
    if (into) {
      this.backing = null;
      into();
      return;
    }
    const step = this.backStep();
    if (!step) return;
    this.backing = step;
    step.go();
  }

  /**
   * Where a double-tap at (x, y) goes into (ToLaD#245), or null (a step back). On a species' column above its split, or
   * its name pill or picture: that species' frame (flyToSpecies, no card). On a column below its split (an ancestral
   * lineage's stretch, segAt): that lineage's clade's frame (flyToClade). On a clade's bracket, its family pill (or that
   * pill's picture) or a pinned group: that clade's frame. Not on the branch the view is in: the species whose card is
   * open (selected), or a species or clade the view is at or inside (inFrame).
   */
  private intoAt(x: number, y: number): (() => void) | null {
    let b: FanBranch | null = null;
    let v: FanNode | null = this.brackets?.pinHit(x, y)?.v ?? null;
    if (!v) {
      const pill = this.pillAt(x, y);
      const pic = pill ? null : this.picAt(x, y);
      const brk = pill || pic ? null : this.brackets?.hit(x, y);
      if (pill) [b, v] = [pill.b ?? null, pill.v ?? null];
      else if (pic) [b, v] = pic[4] ? [null, pic[4]] : [pic[3], null];
      else if (brk) v = brk.v;
      else if ((b = this.hitBranch(x, y))) {
        // (Below its split, the lineage it is in there: the parent column's.)
        const wy = Math.min(this.fan.trunkBottom.y, this.toWorld(x, y)[1]);
        if (wy >= b.splitY) [b, v] = [null, segAt(b, wy).node];
      }
    }
    if (b) {
      const sb = b;
      if (this.selected === sb.sp || this.inFrame([sb], () => this.speciesCamera(sb))) return null;
      return () => this.flyToSpecies(sb.sp, false);
    }
    if (v) {
      const sv = v;
      if (this.inFrame(sv.strands, () => this.cladeCamera(sv))) return null;
      return () => this.flyLevel(null, sv);
    }
    return null;
  }

  /**
   * Whether the view is at or inside a frame (ToLaD#245): the lineage at the screen's centre (centreLine) one of `of`,
   * and zoomed in at least as far as `frame`, width and time together (within BACK_SLACK, as backStep).
   */
  private inFrame(of: readonly FanBranch[], frame: () => Camera): boolean {
    const mid = this.centreLine();
    if (!mid || !of.includes(mid)) return false;
    // (Folded, a frame computed moves the fold to it: put back after, as backStep does.)
    const restore = this.fan.tess.fold?.keep();
    const f = frame();
    restore?.();
    return Math.log(this.cam.sx / f.sx) + Math.log(this.cam.sy / f.sy) >= -Math.log(BACK_SLACK);
  }

  /**
   * The frames a double-tap steps back through (ToLaD#241), innermost first: the species of the lineage at the
   * screen's centre (lineAt, as the pinned groups, ToLaD#233), then each ranked clade it sits in (cladeOf, outOf), the
   * root's (home) last. What is on screen, not where taps went: after a pinch or a pan it starts from there.
   */
  private backLadder(b: FanBranch | null): BackStep[] {
    const root = this.fan.root;
    const steps: BackStep[] = [];
    if (b) {
      steps.push({ to: b.sp.common, cam: this.speciesCamera(b), go: () => this.flyToSpecies(b.sp, false) });
      for (let v: FanNode | null = this.cladeOf(b); v && v !== root; v = this.outOf(v)) {
        const c = v;
        steps.push({ to: c.name, cam: this.cladeCamera(c), go: () => this.flyLevel(null, c) });
      }
    }
    steps.push({ to: 'home', cam: this.homeCamera(), go: () => this.flyLevel(null, root) });
    return steps;
  }

  /**
   * One step back from the view (ToLaD#241), or null at home. The view is inside a frame of the ladder when it is zoomed
   * in at least that far, width and time together (the area's scale, within BACK_SLACK, 15 %), and at it when also
   * zoomed in no further than that. The innermost frame it is inside: zoomed in past it, the step is to it; at it, to
   * the next frame out that the view is zoomed in past. Past the ladder's end, home unless already there. Mid-way through a step back, from where that
   * step lands.
   */
  private backStep(): BackStep & { b: FanBranch | null } | null {
    const on = this.anim && this.backing;
    const c = on ? this.backing!.cam : this.cam;
    const b = on ? this.backing!.b : this.centreLine();
    // (Folded, each frame computed moves the fold to it: put back after, so the view stands as it was.)
    const restore = this.fan.tess.fold?.keep();
    const ladder = this.backLadder(b);
    restore?.();
    // How far the view is zoomed in past frame f: width and time together (log of the area's scale), so a view deep
    // in a species' past (time zoomed far in, its wider ancestral column framed) counts as inside that species.
    const z = (f: Camera) => Math.log(c.sx / f.sx) + Math.log(c.sy / f.sy);
    const slack = Math.log(BACK_SLACK);
    // The view's level: the innermost frame it is inside (zoomed in at least as far, within the slack).
    const inside = (f: Camera) => z(f) >= -slack;
    const closer = (f: Camera) => z(f) > slack;
    const i = Math.max(0, ladder.findIndex((f) => inside(f.cam)));
    // Closer than it: that frame. At it: the next one out it is closer than.
    const next = closer(ladder[i].cam) && inside(ladder[i].cam) ? ladder[i] : ladder.slice(i + 1).find((f) => closer(f.cam));
    const home = ladder[ladder.length - 1];
    const step = next ?? (this.atHome(c) ? null : home);
    return step && { ...step, b };
  }

  /** Whether camera c is home's (within 4 px and 2 %): where a double-tap does nothing (ToLaD#241). */
  private atHome(c: Camera = this.cam): boolean {
    const h = this.homeCamera();
    return Math.abs(c.cx - h.cx) * c.sx <= 4 && Math.abs(c.cy - h.cy) * c.sy <= 4 && Math.abs(Math.log(c.sx / h.sx)) <= 0.02 && Math.abs(Math.log(c.sy / h.sy)) <= 0.02;
  }

  /** The step back under way (ToLaD#241): where it lands and the species it started from, so a double-tap mid-flight goes on from there. */
  private backing: BackStep & { b: FanBranch | null } | null = null;

  /** The lineage at the screen's centre (ToLaD#233): the pinned groups' and a double-tap's (ToLaD#241). */
  private centreLine(): FanBranch | null {
    return this.lineAt((LABEL_AXIS_X + this.w) / 2, this.h / 2);
  }

  /**
   * Whether a single tap here waits out the double-tap window (engine/input.ts, ToLaD#241), so a double-tap's first tap
   * does nothing: a tap that flies (a pill, picture, bracket, pinned group or "+x") always; one that opens a card,
   * unless a double-tap there would do nothing (on the branch the view is in, at home, ToLaD#245); a tap on nothing
   * (closing the card) never.
   */
  tapWaits(x: number, y: number): boolean {
    const k = this.tapKind(x, y);
    return k === 'fly' || (k === 'card' && (!!this.anim || !!this.intoAt(x, y) || !this.atHome()));
  }

  /** What a tap at (x, y) does: flies somewhere, opens a card, or neither (as tap() decides it). */
  private tapKind(x: number, y: number): 'fly' | 'card' | null {
    if (this.brackets?.pinHit(x, y) || this.plusAt(x, y) || this.pillAt(x, y) || this.picAt(x, y) || this.brackets?.hit(x, y)) return 'fly';
    return this.eventLabelAt(x, y) || this.hitBranch(x, y) ? 'card' : null;
  }

  /** The "+x" badge under (x, y) (ToLaD#197). */
  private plusAt(x: number, y: number) {
    return this.plusHits.find(({ box }) => x >= box[0] - 8 && x <= box[2] + 8 && y >= box[1] - 4 && y <= box[3] + 4);
  }

  /** The species' or family's name pill nearest (x, y) within a finger's slack (ToLaD#230, #212), the one under it first. */
  private pillAt(x: number, y: number): { b?: FanBranch; v?: FanNode } | null {
    let pill: { b?: FanBranch; v?: FanNode } | null = null;
    let pd = Infinity;
    for (const h of [...this.nameHits, ...this.famHits]) {
      const dx = Math.max(h.box[0] - x, x - h.box[2], 0);
      const dy = Math.max(h.box[1] - y, y - h.box[3], 0);
      if (dx <= 6 && dy <= 6 && dx + dy < pd) [pill, pd] = [h, dx + dy];
    }
    return pill;
  }

  /** The species' (or family pill's) picture under (x, y) (ToLaD#193). */
  private picAt(x: number, y: number) {
    return this.thumbHits.find(([px, py, r]) => (x - px) ** 2 + (y - py) ** 2 <= (r + 3) ** 2);
  }

  /** The span of strand b at world y: its own column above its split, the parent column below ([left, width]). */
  private spanAt(b: FanBranch, wy: number): [number, number] {
    const y = Math.min(this.fan.trunkBottom.y, Math.max(b.tipY, wy));
    if (y < b.splitY) return [leftAt(b, y), laneAt(b, y).w];
    const v = segAt(b, y).node;
    return [nodeLeftAt(v, y), v.width];
  }

  /** The event label under (x, y). */
  private eventLabelAt(x: number, y: number) {
    return this.eventLabels.find(({ box }) => x >= box[0] - 4 && x <= box[2] + 4 && y >= box[1] - 4 && y <= box[3] + 4);
  }

  tap(x: number, y: number): void {
    // A pinned group (ToLaD#233), over all under it: fly to it; tapped again there, one level out (tapClade).
    const pinned = this.brackets?.pinHit(x, y);
    if (pinned) {
      this.tapClade(pinned.v);
      return;
    }
    // A pill's "+x" (ToLaD#197): fly to the species it stands for, until their pills show.
    const plus = this.plusAt(x, y);
    if (plus) {
      this.flyToGroup(plus.bs);
      return;
    }
    // A species' name pill: fly to its branch and open its card (ToLaD#230, #241). A family's pill (ToLaD#212): fly
    // to the family, as its bracket (tapClade).
    const pill = this.pillAt(x, y);
    if (pill?.v) {
      this.tapClade(pill.v);
      return;
    }
    if (pill?.b) {
      this.tapSpecies(pill.b);
      return;
    }
    // A species' picture (ToLaD#193): as its pill (ToLaD#230); a family pill's picture, as the family's pill.
    const pic = this.picAt(x, y);
    if (pic) {
      if (pic[4]) this.tapClade(pic[4]);
      else this.tapSpecies(pic[3]);
      return;
    }
    // A clade's bracket (ToLaD#193): fly to the clade; tapped again there, one level out (ToLaD#230).
    const clade = this.brackets?.hit(x, y);
    if (clade) {
      this.tapClade(clade.v);
      return;
    }
    // An event's label: opens its event, the touch at the middle of its window on the column.
    const lab = this.eventLabelAt(x, y);
    const ev = lab && colEventsY(this.fan, lab.b).find((s) => s.k === lab.k);
    if (lab && ev) {
      const ageMa = Math.sqrt(Math.max(1, ev.ago0) * Math.max(1, ev.ago1)) / 1e6;
      const wy = this.fan.time.y(ageMa);
      this.selected = lab.b.sp;
      this.selInd = null;
      this.touch = { x: leftAt(lab.b, wy) + laneAt(lab.b, wy).w / 2, ageMa };
      this.onSelect({ sp: lab.b.sp, ageMa, startMa: lab.b.t0, event: ev });
      this.request();
      return;
    }
    const b = this.hitBranch(x, y);
    this.selected = b ? b.sp : null;
    this.selInd = null;
    let ind: IndInfo | undefined;
    const st = b && this.twigStats.get(b.sp.gid);
    if (b && st && st.mode !== 'texture') {
      const [wx, wy] = this.toWorld(x, y);
      const m = this.model(b);
      const a = m.hit(wx, wy, 14 / this.cam.sx, 14 / this.cam.sy);
      if (a) {
        this.selInd = a;
        ind = m.info(a.g, a.i);
      }
    }
    // The time touched, kept within the strand (from its tip down to the bottom of the world).
    const wy = Math.min(this.fan.trunkBottom.y, this.toWorld(x, y)[1]);
    const ageMa = b ? Math.max(b.sp.t1, this.fan.time.ageAt(wy)) : undefined;
    this.touch = b && ageMa !== undefined ? { x: this.toWorld(x, y)[0], ageMa } : null;
    // Below its split: the parent column, the lineage there (unless an individual was hit).
    const lineage = b && ageMa !== undefined && !ind && wy >= b.splitY ? lineageAt(b, this.fan, ageMa) : undefined;
    // Inside a curated event's window on its own column (or within a finger's reach of it): the card explains it.
    let event: EventSpan | undefined;
    if (b && ageMa !== undefined && !ind && !lineage) {
      const r = EVENT_REACH_PX / this.cam.sy;
      const a0 = this.fan.time.ageAt(Math.max(b.tipY, wy - r)) * 1e6;
      const a1 = this.fan.time.ageAt(Math.min(this.fan.trunkBottom.y, wy + r)) * 1e6;
      event = eventAt(colEventsY(this.fan, b), ageMa * 1e6, Math.min(a0, a1), Math.max(a0, a1)) ?? undefined;
    }
    this.onSelect(b ? { sp: b.sp, ind, ageMa, startMa: b.t0, lineage, event } : null);
    this.request();
  }

  // ---- drawing ----------------------------------------------------------------

  request(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      if (this.anim && !this.anim(t)) this.anim = null;
      this.draw();
      if (this.anim) this.request();
    });
  }

  /** Where drawTwigs sends the mesh (the GPU layer). */
  get mesh(): MeshBatch | undefined {
    return this.gl?.mesh;
  }

  /** A flat rectangle under everything else (the GPU layer, or the 2D canvas without it). */
  under(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a = 1): void {
    if (this.gl) {
      this.gl.under.push(x0, y0, x1, y1, rgb[0], rgb[1], rgb[2], a);
      return;
    }
    this.ctx.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a})`;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  draw(): void {
    const t0 = performance.now();
    this.applyFold();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.gl?.begin();
    if (this.gl) ctx.clearRect(0, 0, this.w, this.h);
    else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    drawWorldUnder(this);
    this.drawTimeAxis(false);
    const hide = this.hide;
    // (The mammal level, lod.ts: a closed clade of hairline strands drawn as its one branch, its columns inside it not drawn.)
    const lod = this.lodNow();
    if (!hide.has('stem')) this.drawStem(lod);
    if (!hide.has('lanes')) {
      for (const b of this.fan.branches) if (!lod || lod.of[b.index] < 0) this.drawStrand(b);
      if (lod) for (const v of lod.merged) this.drawMerged(v);
    }
    if (!hide.has('ind')) for (const b of this.fan.branches) if (!lod || lod.of[b.index] < 0) this.drawIndividuals(b);
    if (!hide.has('held')) this.drawHeld();
    if (!hide.has('events')) this.drawEvents();
    if (!hide.has('fade')) this.drawStemFade();
    // Labels: one form everywhere (see labelSpots).
    this.drawGutter();
    this.drawTouch();
    const br = this.layoutBrackets();
    // (The labels kept under the pinned groups, ToLaD#233, as they show.)
    const spots = labelSpots(this.camera, this.fan, this.labelTop() + (br ? br.pinH() * br.pinA : 0), (t) => this.nameWidth(t), this.barRect()?.[0], br ?? undefined, (id) => this.plusPx(this.plusN.get(id) ?? 0), (id) => this.famPills.get(id), lod);
    this.drawLabels(spots, br);
    br?.drawPins(this.ctx, FAMILY_INK, INK3, BG);
    this.drawWidthScale();
    if (this.debug) this.drawDebug();
    this.drawTrunkLabel();
    this.drawTimeAxis(true);
    drawWorldOver(this);
    if (this.gl) {
      const pal = [LIVING, LINEAGE, TWIG_GRAY].map(rgb01);
      this.gl.end(this.w, this.h, this.dpr, rgb01(BG), kLogAt(this, this.fan.time, this.cam.cy), this.toScreen(0, this.yNow)[1], pal);
    }
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  /**
   * The parent columns below each split (the stem below the oldest): their
   * daughters' strands side by side with no gaps; a dark backdrop under each,
   * so a column reads as one without seams passing for lanes. It follows the
   * column's curve where it peels off its parent (chords a few px tall).
   */
  private drawStem(lod: Lod | null = null): void {
    const c = rgb01(this.gl ? mix(GRAY, '#131c19', 0.86) : GRAY);
    const [, wTop] = this.toWorld(0, -8);
    const [, wBot] = this.toWorld(0, this.h + 8);
    const nodes = this.fan.nodes;
    for (let ni = nodes.length - 1; ni >= 0; ni--) {
      const v = nodes[ni];
      if (lod?.hidden(v)) continue;
      const ya = Math.max(v.y, wTop);
      const yb = Math.min(v.yBot, wBot);
      if (!(yb > ya)) continue;
      // Straight below its peel: one piece; the peel in chords.
      const peel = v.leanY;
      const ys = [ya];
      if (peel > ya && peel < yb && !this.fan.tess.fold) ys.push(peel);
      // (Folded, fold.ts: the column moves with its neighbours' widths at every height: chords all the way.)
      const p0 = this.fan.tess.fold ? ya : Math.max(ya, peel);
      if (yb > p0) {
        const n = Math.min(400, Math.max(1, Math.ceil(((yb - p0) * this.cam.sy) / 4)));
        for (let i = 1; i < n; i++) ys.push(p0 + ((yb - p0) * i) / n);
      }
      ys.push(yb);
      const n = ys.length - 1;
      const xs = this.stemXs.length > n ? this.stemXs : (this.stemXs = new Float64Array(2 * n + 2));
      const sy = this.stemSy.length > n ? this.stemSy : (this.stemSy = new Float64Array(2 * n + 2));
      for (let i = 0; i <= n; i++) [xs[i], sy[i]] = this.toScreen(nodeLeftAt(v, ys[i]), ys[i]);
      const w = v.width * this.cam.sx;
      for (let i = 0; i < n; i++) {
        const l0 = xs[i];
        const t = sy[i];
        const l1 = xs[i + 1];
        const b = sy[i + 1];
        if (!(b > t) || Math.max(l0, l1) > this.w + 8 || Math.min(l0, l1) + w < -8) continue;
        if (this.gl) this.gl.under.push(l0, t, l0 + w, b, c[0], c[1], c[2], 1, l1 - l0, l1 - l0);
        else {
          this.ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
          this.ctx.beginPath();
          this.ctx.moveTo(l0, t);
          this.ctx.lineTo(l0 + w, t);
          this.ctx.lineTo(l1 + w, b);
          this.ctx.lineTo(l1, b);
          this.ctx.fill();
        }
      }
    }
  }

  /** The stem fades out over its last stretch (from STEM_FADE_MA down to the bottom of the world): nothing ends abruptly. */
  /**
   * Folded (the carnivores, ToLaD#210): the order's stem below its start is no slab of its founders down to the
   * bottom of the world (its width there is the founders', its grey their lines that ended, not the order's): it
   * fades out over STEM_END_PX below the root, and one thin line, the order's lineage, goes on down to the bottom.
   */
  private drawStemFade(): void {
    const f = this.fan;
    const folded = !!f.tess.fold;
    const [, yr] = this.toScreen(0, f.root.y);
    const [, ya] = folded ? [0, yr] : this.toScreen(0, f.time.y(STEM_FADE_MA));
    const [, yBot] = this.toScreen(0, f.trunkBottom.y);
    const yb = folded ? Math.min(yBot, ya + STEM_END_PX) : yBot;
    if (yBot < 0 || ya > this.h) return;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, ya, 0, yb);
    g.addColorStop(0, 'rgba(11,19,17,0)');
    g.addColorStop(1, BG);
    ctx.fillStyle = g;
    const t = Math.max(-8, ya);
    const b = Math.min(this.h + 8, yb + 2);
    if (b > t) ctx.fillRect(0, t, this.w, b - t);
    if (!folded) return;
    // (Below the fade: the ground, and the lineage's line from the root's centre down, itself fading out at the bottom.)
    const t2 = Math.max(-8, yb + 2);
    const b2 = Math.min(this.h + 8, yBot + 2);
    if (b2 > t2) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, t2, this.w, b2 - t2);
    }
    const cx = this.toScreen(nodeLeftAt(f.root, f.root.y) + f.root.width / 2, 0)[0];
    if (cx < -4 || cx > this.w + 4) return;
    const [, yf] = this.toScreen(0, f.time.y(STEM_FADE_MA));
    const l0 = Math.max(-8, yr);
    const l1 = Math.min(this.h + 8, yBot);
    if (!(l1 > l0)) return;
    const lg = ctx.createLinearGradient(0, Math.max(yr, yf), 0, yBot);
    lg.addColorStop(0, LINEAGE);
    lg.addColorStop(1, 'rgba(11,19,17,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(cx - 0.75, l0, 1.5, l1 - l0);
  }

  /**
   * Fill a ribbon between offsets a(p) and b(p) (world width units along the
   * left normal, scaled by the width zoom), at least minPx thick (negative:
   * towards the right). The polygon is clipped to the screen in float64 before
   * it reaches the canvas, which mishandles coordinates far off screen.
   */
  private ribbon(pts: RibbonPt[], a: (p: RibbonPt) => number, bOff: (p: RibbonPt) => number, minPx = 0): void {
    const k = this.cam.sx;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of pts) {
      const off = a(p) * k;
      xs.push(p.x + p.nx * off);
      ys.push(p.y + p.ny * off);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const ao = a(p) * k;
      const bo = bOff(p) * k;
      const off = minPx >= 0 ? Math.max(bo, ao + minPx) : Math.min(bo, ao + minPx);
      xs.push(p.x + p.nx * off);
      ys.push(p.y + p.ny * off);
    }
    const [cx, cy] = clipPoly(xs, ys, -8, -8, this.w + 8, this.h + 8);
    if (cx.length < 3) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx[0], cy[0]);
    for (let i = 1; i < cx.length; i++) ctx.lineTo(cx[i], cy[i]);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * One species' strand bundle, drawn whole from the bottom of the world
   * up through the parent columns of the splits it passes and its own column
   * to its tip. A parent column is just its daughters' strands side by side
   * (widths adding up to its width), its green one prefix across them.
   *
   * Smooth curves (layout.ts): its slices of the parent columns, its peel off
   * each fork along an S-curve, its column about its centre line; sampled
   * at world-fixed heights a few px apart on screen (lanePoints), straight
   * chords between them.
   */
  private drawStrand(b: FanBranch): void {
    const yb = this.fan.trunkBottom.y;
    const [, ayTip] = this.toScreen(0, b.tipY);
    const [, byBot] = this.toScreen(0, yb);
    if (byBot < 0 || ayTip > this.h) return;
    // Wholly left or right of the screen (zoomed in, most strands are): nothing to sample.
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const xr = this.fan.tess.xRange(b, sTop, sBot);
    if (this.toScreen(xr[1], 0)[0] < -12 || this.toScreen(xr[0], 0)[0] > this.w + 12) return;
    const hw = b.width / 2;
    const pts = this.lanePoints(b, hw);
    if (pts.length < 2) return;
    // The column's styled spans on screen ([top, bottom, dim]), clipped to it: none for most strands.
    const held: [number, number, number][] = [];
    for (const [t, bt, d] of colSpansY(this.fan, b)) {
      const st = this.toScreen(0, t)[1];
      const sb = this.toScreen(0, bt)[1];
      if (sb > -20 && st < this.h + 20) held.push([st, sb, d]);
    }
    // As the strands fade in (twigs.ts), the lanes dim to a backdrop under them: the same
    // lanes, the same geometry, never a switch.
    this.drawLanes(pts, hw, held, this.twigStats.get(b.sp.gid));
  }

  private lod: Lod | null = null;
  /** The mammal level's merged clades at this frame's zoom (lod.ts), after applyFold; null at a level with no orders. */
  lodNow(): Lod | null {
    const f = this.fan.tess.fold;
    if (!f || !f.ordShare.length) return (this.lod = null);
    if (this.lod?.fan !== this.fan) this.lod = new Lod(this.fan);
    this.lod.update(f, this.cam.sx);
    return this.lod;
  }

  /** A merged clade (lod.ts): one ribbon over the grid's rows on screen, its extent the fold's, its green its strands' summed. */
  private drawMerged(v: FanNode): void {
    const f = this.fan.tess.fold!;
    const H = f.gridH;
    if (!(H > 0)) return;
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    const top = this.lodTop(v);
    const y0 = Math.max(top, sTop);
    const y1 = Math.min(this.fan.trunkBottom.y, sBot);
    if (!(y1 > y0)) return;
    const i0 = v.strands[0].index;
    const i1 = v.strands[v.strands.length - 1].index;
    const k0 = Math.ceil(y0 / H);
    const k1 = Math.floor(y1 / H);
    const pts: RibbonPt[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    const push = (k: number, y: number) => {
      const [l, r] = f.extent(i0, i1, k);
      const w = Math.max(0, r - l);
      const G = this.lod!.greenAt(v, k, H);
      const [px, py] = this.toScreen(l, y);
      lo = Math.min(lo, px);
      hi = Math.max(hi, px + w * this.cam.sx);
      pts.push({ x: px, y: py, nx: -1, ny: 0, w, f: w > 0 ? Math.min(1, G / w) : 0 });
    };
    // (Bottom up, as lanePoints: its last point at its top, read off the row under it.)
    if (y1 > k1 * H) push(Math.min(k1 + 1, Math.ceil(y1 / H)), y1);
    for (let k = k1; k >= k0; k--) push(k, k * H);
    if (y0 < k0 * H) push(k0, y0);
    if (pts.length < 2 || hi < -12 || lo > this.w + 12) return;
    this.drawLanes(pts, 0, [], undefined);
  }
  private lodTops = new WeakMap<FanNode, number>();
  private lodTop(v: FanNode): number {
    let t = this.lodTops.get(v);
    if (t === undefined) this.lodTops.set(v, (t = Lod.top(v)));
    return t;
  }

  /** A column's lanes (drawStrand's, or a merged clade's, lod.ts): its points, spine offset hw, styled spans and twig fade. */
  private drawLanes(pts: RibbonPt[], hw: number, held: [number, number, number][], tw: TwigStats | undefined): void {
    const ctx = this.ctx;
    // Under the mesh the lanes sink to a dark tint of themselves, so the individuals carry the colour:
    // each stretch by its own lanes' widths (twigs.ts laneDim), as the mesh draws them.
    const lives = tw?.fade ?? 0;
    const greenFade = tw?.fadeGreen ?? 0;
    const tex = tw?.tex ?? 1;
    const greenC = mix(GREEN, '#0d2318', greenFade * 0.9);
    const grayC = mix(GRAY, '#131c19', Math.max(lives, tw?.texGray ?? 0) * 0.82);
    if (this.gl) {
      // Between neighbouring samples each lane is a trapezoid (the curve's chord, a few px at most):
      // the whole lane gray (at least 0.6 px), the green lane over its left edge (at least 1 px).
      const k = this.cam.sx;
      const L = this.w;
      // ([cl, cr]: clipped along the row, so a lane's least width across a steep lean reaches only
      // as far as its chord does.)
      const trap = (batch: RectBatch, l0: number, r0: number, l1: number, r1: number, y0: number, y1: number, c: [number, number, number], a: number, cl = -8, cr = L + 8) => {
        // Lanes wholly off screen are dropped; an edge wholly off screen is pinned just outside it (float32 stays exact).
        if ((r0 < -8 && r1 < -8) || (l0 > L + 8 && l1 > L + 8)) return;
        cl = Math.max(-8, cl);
        cr = Math.min(L + 8, cr);
        if (l0 < -8 && l1 < -8) l0 = l1 = -8;
        if (r0 > L + 8 && r1 > L + 8) r0 = r1 = L + 8;
        batch.push(l0, y0, r0, y1, c[0], c[1], c[2], a, l1 - l0, r1 - r0, cl, cr);
      };
      const gl = this.gl;
      // A stretch: q's row (top) to p's.
      const piece = (xq: number, wq: number, gq: number, xp: number, wp: number, gp: number, y0: number, y1: number) => {
        const wm = (wq + wp) / 2;
        const gm = (gq + gp) / 2;
        const gc = mix01(GRAY, '#131c19', laneDim(wm - gm, lives, tex) * 0.82);
        const ec = mix01(GREEN, '#0d2318', laneDim(gm, lives, tex) * 0.9);
        // A styled stretch of the column (held flat for want of figures: colstyle.ts) fades towards the
        // background: the background over the whole lane, lanes and individuals alike (drawn after the mesh).
        const dim = held.length ? dimAt(held, (y0 + y1) / 2) : 0;
        // The least widths across the lane, not along the row: a thin branch-out leaning s px per px
        // is √(1 + s²) px of the row per px across (else a hairline lean breaks into dashes).
        const sq = Math.sqrt(1 + ((xp + wp / 2 - xq - wq / 2) / (y1 - y0)) ** 2);
        const xa = Math.min(xq, xp);
        const xr = Math.max(xq + Math.max(0.6, wq), xp + Math.max(0.6, wp)) + 0.5;
        trap(gl.under, xq, xq + Math.max(0.6 * sq, wq), xp, xp + Math.max(0.6 * sq, wp), y0, y1, gc, 1, xa - 0.5, xr);
        if (dim > 0) trap(gl.over, xq, xq + Math.max(sq, wq), xp, xp + Math.max(sq, wp), y0, y1, BG01, dim, xa - 0.5, xr + 0.5);
        if (gq > 0 || gp > 0) {
          const g1q = xq + Math.max(sq, gq);
          const g1p = xp + Math.max(sq, gp);
          const xb = Math.max(xq + Math.max(1, gq), xp + Math.max(1, gp));
          // The living glow faintly (fading as their lane resolves into individuals). Zoomed out a family is
          // dozens of thin columns side by side, each its own strand: each glows by its own width (full from
          // GLOW_W px), so the family glows about as one strand as wide as all of them, not as a stack of
          // dozens of halos (a wide soft smear, ToLaD#231). And only where the lane runs near-straight
          // down: a halo is a row-flat slab per sample, so across a lean (a branch leaving its parent) it
          // breaks into steps; it fades out by the lean (GLOW_LEAN), and there the branch is its crisp lane.
          const glow = (1 - lives) * (1 - dim) * Math.min(1, gm / GLOW_W) * Math.max(0, 1 - (sq - 1) / GLOW_LEAN);
          if (glow > 0.01 && !this.hide.has('glow')) {
            trap(gl.under, xq - 4 * sq, g1q + 4 * sq, xp - 4 * sq, g1p + 4 * sq, y0, y1, ec, 0.06 * glow, xa - 4 * sq, xb + 4 * sq);
            trap(gl.under, xq - 1.5 * sq, g1q + 1.5 * sq, xp - 1.5 * sq, g1p + 1.5 * sq, y0, y1, ec, 0.14 * glow, xa - 1.5 * sq, xb + 1.5 * sq);
          }
          trap(gl.under, xq, g1q, xp, g1p, y0, y1, ec, 1, xa - 0.5, xb + 0.5);
        }
      };
      for (let i = 0; i + 1 < pts.length; i++) {
        // p below q on screen: the trapezoid from q's row (top) to p's.
        const p = pts[i];
        const q = pts[i + 1];
        const y0 = q.y;
        const y1 = p.y;
        if (!(y1 > y0) || y1 < -4 || y0 > this.h + 4) continue;
        const xq = q.x - hw * k;
        const xp = p.x - hw * k;
        const wq = q.w * k;
        const wp = p.w * k;
        if (!(wq > 0) && !(wp > 0)) continue;
        const gq = wq * q.f;
        const gp = wp * p.f;
        piece(xq, wq, gq, xp, wp, gp, y0, y1);
      }
    } else {
      // (Its run drawn whole.)
      ctx.fillStyle = grayC;
      this.ribbon(pts, (p) => hw - p.w, () => hw, 0.6);
      if (pts.some((p) => p.f > 0)) {
        // Green lane on the left, floored at 1 px.
        ctx.fillStyle = greenC;
        this.ribbon(pts, () => hw, (p) => hw - p.w * p.f, -1);
      }
      // Its styled stretches: faded over the individuals too, once they are drawn (drawHeld).
      for (const [t, bt, d] of held) {
        const run = pts.filter((p) => p.y >= t - 0.5 && p.y <= bt + 0.5);
        if (run.length > 1) this.heldRuns.push({ run, hw, d });
      }
    }
  }

  /**
   * Without the GPU layer: the styled stretches of the columns (colstyle.ts) faded towards the
   * background over their lanes and individuals, as the GPU path does with its overlay.
   */
  private drawHeld(): void {
    for (const { run, hw, d } of this.heldRuns) {
      this.ctx.fillStyle = `rgba(12,23,20,${d})`;
      this.ribbon(run, (p) => hw - p.w, () => hw, 0.6);
    }
    this.heldRuns.length = 0;
  }

  /**
   * The curated events on the columns (colstyle.ts, ToLaD#141): each window tinted over its own column,
   * lanes and individuals alike, after the held fade (so an event in a held stretch still shows). At
   * least EVENT_MIN_PX tall and EVENT_MIN_W wide, centred, so a short window on a thin column reads at
   * home. GPU layer: the overlay batch (over the mesh); without it the same polygons on the canvas.
   */
  private drawEvents(): void {
    const [r, g, bl] = EVENT_TINT.rgb;
    for (const b of this.fan.branches) {
      for (const s of colEventsY(this.fan, b)) {
        let st = this.toScreen(0, s.top)[1];
        let sb = this.toScreen(0, s.bot)[1];
        if (sb - st < EVENT_MIN_PX) {
          const m = (st + sb) / 2;
          st = m - EVENT_MIN_PX / 2;
          sb = m + EVENT_MIN_PX / 2;
        }
        if (sb < -4 || st > this.h + 4) continue;
        st = Math.max(-4, st);
        sb = Math.min(this.h + 4, sb);
        // Slices a few px tall follow the column's curve (straight between them).
        const n = Math.max(1, Math.min(64, Math.ceil((sb - st) / 6)));
        let [l0, r0] = this.eventEdges(b, st);
        for (let i = 1; i <= n; i++) {
          const y0 = st + ((sb - st) * (i - 1)) / n;
          const y1 = st + ((sb - st) * i) / n;
          const [l1, r1] = this.eventEdges(b, y1);
          if (!((r0 < -8 && r1 < -8) || (l0 > this.w + 8 && l1 > this.w + 8))) {
            if (this.gl) this.gl.over.push(l0, y0, r0, y1, r, g, bl, EVENT_TINT.a, l1 - l0, r1 - r0, -8, this.w + 8);
            else {
              const ctx = this.ctx;
              ctx.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(bl * 255)},${EVENT_TINT.a})`;
              ctx.beginPath();
              ctx.moveTo(l0, y0);
              ctx.lineTo(r0, y0);
              ctx.lineTo(r1, y1);
              ctx.lineTo(l1, y1);
              ctx.closePath();
              ctx.fill();
            }
          }
          l0 = l1;
          r0 = r1;
        }
      }
    }
  }

  /** A species' own column at screen y (clamped to it): its left and right edges on screen, at least EVENT_MIN_W apart. */
  private eventEdges(b: FanBranch, sy: number): [number, number] {
    const y = Math.min(b.splitY, Math.max(b.tipY, this.toWorld(0, sy)[1]));
    const l = this.toScreen(leftAt(b, y), y)[0];
    const w = laneAt(b, y).w * this.cam.sx;
    const pad = Math.max(0, (EVENT_MIN_W - w) / 2);
    return [l - pad, l + w + pad];
  }

  /**
   * Where the card's numbers are from: on the selected column, a ring at the
   * point touched and a thin line across the column at its time, labelled
   * with that time ("70 yr ago").
   */
  private drawTouch(): void {
    const b = this.fan.branches.find((x) => x.sp === this.selected);
    const t = this.touch;
    if (!b || !t || this.selInd) return;
    const wy = this.fan.time.y(t.ageMa);
    const [, y] = this.toScreen(0, wy);
    if (y < -10 || y > this.h + 10) return;
    const [left, cw] = this.spanAt(b, wy);
    const x0 = this.toScreen(left, wy)[0];
    const x1 = x0 + Math.max(1, cw * this.cam.sx);
    if (x1 < 0 || x0 > this.w) return;
    const rx = Math.min(Math.max(this.toScreen(t.x, wy)[0], x0), x1);
    const ctx = this.ctx;
    ctx.save();
    // The line across the column (a little past its edges), on a dark halo so it reads over the mesh.
    const lx0 = Math.max(-2, x0 - 6);
    const lx1 = Math.min(this.w + 2, x1 + 6);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(12,23,20,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx0, y);
    ctx.lineTo(lx1, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,240,234,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // The ring.
    ctx.beginPath();
    ctx.arc(rx, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(12,23,20,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.75;
    ctx.stroke();
    // Its time, on a pill above the line: right of the ring if there is room, else left of it.
    const yrs = t.ageMa * 1e6;
    const label = yrs < 0.5 ? 'now' : formatTick(yrs, 0);
    ctx.font = font('650 12.5px');
    const tw = ctx.measureText(label).width + 14;
    let px = rx + 10;
    if (px + tw > this.w - 6) px = rx - 10 - tw;
    px = Math.max(this.w > 200 ? 70 : 4, px);
    const py = y - 26;
    ctx.fillStyle = 'rgba(12,23,20,0.86)';
    ctx.beginPath();
    ctx.roundRect(px, py, tw, 20, 10);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 7, py + 10.5);
    ctx.restore();
  }

  /**
   * A branch's lanes as screen points, bottom to top, one per sample height
   * (layout.ts Tess.cuts: its features and a world-fixed grid a few px apart
   * on screen) over the screen and a little beyond it, each exactly on the
   * edges' curves: the lanes are drawn straight between them.
   */
  lanePoints(b: FanBranch, hw: number): RibbonPt[] {
    const yb = this.fan.trunkBottom.y;
    const [, sTop] = this.toWorld(0, -20);
    const [, sBot] = this.toWorld(0, this.h + 20);
    // The column's kept samples (twigs.ts ColumnPath: those where its chords run straight on screen dropped).
    const P = this.model(b).path;
    const [i0, i1] = P.span(this.cam.sx, this.cam.sy, sTop, Math.min(yb, sBot));
    const ys = P.ys;
    const vals = P.vals;
    // Spine at left + hw: the ribbon spans offsets [hw - w, hw] to its left (nx = -1).
    // (Where the lanes step, as at a split, where the strand leaves its parent's prefix: a point either side.)
    const pts: RibbonPt[] = [];
    const push = (y: number, o: number) => {
      const w = vals[o + 1];
      const [px, py] = this.toScreen(vals[o] + hw, y);
      pts.push({ x: px, y: py, nx: -1, ny: 0, w, f: w > 0 ? vals[o + 2] / w : 0 });
    };
    for (let i = i1; i >= i0; i--) {
      const y = ys[i];
      const o = 8 * i;
      push(y, o);
      if (P.steps[i]) push(y, o + 4);
    }
    return pts;
  }

  private drawIndividuals(b: FanBranch): void {
    const st = drawTwigs(this, b, this.model(b), this.selected === b.sp ? this.selInd : null);
    const prev = this.twigStats.get(b.sp.gid);
    // The lanes under the strands depend on the fade: redraw once when it changes,
    // and keep drawing while lineage answers are still being worked out.
    if ((prev?.fade ?? 0) !== (st?.fade ?? 0) || (prev?.fadeGreen ?? 0) !== (st?.fadeGreen ?? 0) || (prev?.texGray ?? 0) !== (st?.texGray ?? 0) || st?.pending) this.request();
    if (st) this.twigStats.set(b.sp.gid, st);
    else this.twigStats.delete(b.sp.gid);
  }

  /** The buttons' box in canvas px [x0, y0, x1, y1], if any. */
  private barRect(): number[] | null {
    if (!this.barEl) return null;
    const r = this.barEl.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return [r.left - c.left, r.top - c.top, r.right - c.left, r.bottom - c.top];
  }

  /** The labels' top line (screen y): just under the buttons, the same for every label. */
  private labelTop(): number {
    const bar = this.barRect();
    return (bar ? bar[3] : 44) + 8;
  }

  /** Length (px) a pill keeps at its top end for a "+n" badge (ToLaD#197): none for 0. */
  private plusPx(n: number): number {
    if (!n) return 0;
    this.ctx.save();
    this.ctx.font = font(PLUS_FONT);
    const w = this.ctx.measureText(`+${n}`).width;
    this.ctx.restore();
    return Math.ceil(w) + PLUS_GAP;
  }

  /** Length (px) of a species' name in the label font (not cached: the web font may arrive after the first frame). */
  private nameWidth(text: string): number {
    this.ctx.save();
    this.ctx.font = font(LABEL_FONT);
    const w = this.ctx.measureText(text).width;
    this.ctx.restore();
    return w;
  }

  /**
   * The species' labels (see labelSpots for where): which show is decided by
   * resolveLabels (a fixed priority, with hysteresis), and each fades in and
   * out over LABEL_FADE_MS rather than popping.
   */
  private drawLabels(spots: LabelSpot[], br: Brackets | null = null): void {
    const ctx = this.ctx;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.labelT));
    this.labelT = now;
    const prev = new Map<string, boolean>();
    for (const [key, st] of this.labelState) prev.set(key, st.on);
    const on = resolveLabels(spots, prev);
    // The "+x" badges (ToLaD#197): counted with the cull; a pill keeps room for its count from the frame before, so
    // when a count changes the next frame lays the pills out again with the room it needs.
    const groups = plusGroups(spots, on, this.fan);
    // A family with one species shown stands on its pill (ToLaD#212): as the badges, next frame, laid out again for it.
    const famPills = familyPills(this.fan, spots, on);
    if (famPills.size !== this.famPills.size || [...famPills].some(([id, v]) => this.famPills.get(id) !== v)) this.request();
    this.famPills = famPills;
    this.famHits.length = 0;
    this.nameHits.length = 0;
    const plusN = new Map<string, number>();
    for (const s of spots) {
      const n = groups.get(s.key)?.length ?? 0;
      if (n) plusN.set(s.id, n);
      if (s.plus !== undefined && s.plus !== this.plusPx(n) && on.get(s.key)) this.request();
    }
    this.plusN = plusN;
    this.plusHits.length = 0;
    this.eventLabels.length = 0;
    let moving = false;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(LABEL_FONT);
    const thumbs: [number, number][] = [];
    this.thumbHits.length = 0;
    const alphas = new Float32Array(spots.length);
    spots.forEach((s, k) => {
      const want = on.get(s.key) ? 1 : 0;
      let st = this.labelState.get(s.key);
      if (!st) this.labelState.set(s.key, (st = { on: want === 1, a: want }));
      st.on = want === 1;
      if (st.a !== want) {
        const step = dt / LABEL_FADE_MS;
        st.a = want > st.a ? Math.min(want, st.a + step) : Math.max(want, st.a - step);
        moving = true;
      }
      alphas[k] = st.a * s.fit;
    });
    // The clades' brackets (ToLaD#193) under the pills: their labels clear of the pills shown, their lines behind them.
    br?.draw(ctx, FAMILY_INK, INK3, spots.filter((_, k) => alphas[k] > 0.3).map((s) => s.box));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(LABEL_FONT);
    for (let k = 0; k < spots.length; k++) {
      const s = spots[k];
      const alpha = alphas[k];
      const [x0, y0, x1, y1] = s.box;
      if (alpha < 0.01 || x1 < 0 || x0 > this.w || y1 < 0 || y0 > this.h) continue;
      if (s.ev !== undefined && s.b && alpha > 0.5) this.eventLabels.push({ box: [x0, y0, x1, y1], b: s.b, k: s.ev });
      ctx.globalAlpha = alpha;
      // (Opaque: a bracket's line behind it never shows through the name.)
      ctx.fillStyle = BG;
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, LABEL_PILL / 2);
      ctx.fill();
      if (s.fam) {
        // A family (ToLaD#146, #212): an outlined pill; tapped, it flies to the family.
        ctx.strokeStyle = FAMILY_INK;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (alpha > 0.5) this.famHits.push({ box: [x0, y0, x1, y1], v: s.fam });
      } else if (s.b && s.ev === undefined && !s.v && alpha > 0.5) this.nameHits.push({ box: [x0, y0, x1, y1], b: s.b });
      if (s.span) {
        // ...and a bracket over the species it names, just above "now".
        const a = Math.max(-2, s.span[0]);
        const b = Math.min(this.w + 2, s.span[1]);
        const y = y1 + 2.5;
        ctx.beginPath();
        ctx.moveTo(a + 0.5, y + 3);
        ctx.lineTo(a + 0.5, y);
        ctx.lineTo(b - 0.5, y);
        ctx.lineTo(b - 0.5, y + 3);
        ctx.stroke();
      }
      // Upright, reading up the column.
      ctx.save();
      ctx.translate(s.x, y1 - LABEL_PAD);
      ctx.rotate(-Math.PI / 2);
      // A lineage's name in the second ink: the species' are the tree's names. An event's title in its tint. A family's in its own.
      ctx.fillStyle = s.ev !== undefined ? EVENT_TINT.css : s.fam ? FAMILY_INK : s.v ? INK2 : INK;
      ctx.fillText(s.text, 0, 0.5);
      // Its "+x" badge (ToLaD#197), past the name in the room the pill keeps for it: a quieter chip, tapped to open them.
      const g = groups.get(s.key);
      const pw = g ? this.plusPx(g.length) : 0;
      if (g && pw > 0 && (s.plus ?? 0) >= pw) {
        const nx = this.nameWidth(s.text) + PLUS_GAP;
        ctx.font = font(PLUS_FONT);
        ctx.fillStyle = 'rgba(232,240,234,0.1)';
        ctx.beginPath();
        ctx.roundRect(nx - 3, -LABEL_PILL / 2 + 3, pw - PLUS_GAP + 6, LABEL_PILL - 6, (LABEL_PILL - 6) / 2);
        ctx.fill();
        ctx.fillStyle = INK2;
        ctx.fillText(`+${g.length}`, nx, 0.5);
        ctx.font = font(LABEL_FONT);
        if (alpha > 0.5) this.plusHits.push({ box: [x0, y0, x1, y1 - LABEL_PAD - nx + PLUS_GAP / 2], bs: s.b ? [s.b, ...g] : g });
      }
      ctx.restore();
      // ToLaD#182: the species' Commons picture under its pill, before the name, once loaded (wiki.ts; `?thumbs=0` off).
      // (A family's, ToLaD#212: its commonest living species'.)
      const pb = s.fam ? s.pic : s.b;
      const th = pb && s.ev === undefined ? labelThumb(pb.sp.sci, () => this.request()) : null;
      // (One picture where two would overlap, the first one shown: fewer and clearer, ToLaD#193. A fading one still draws.)
      const ty = y1 + THUMB_D / 2 + 2;
      if (th && alpha > 0.5 && !thumbs.some(([x, y]) => Math.abs(x - s.x) < THUMB_D - 4 && Math.abs(y - ty) < THUMB_D - 4)) {
        thumbs.push([s.x, ty]);
        if (pb) this.thumbHits.push([s.x, ty, THUMB_D / 2, pb, s.fam]);
        drawThumb(ctx, th, s.x, ty, THUMB_D);
      } else if (th && alpha <= 0.5) drawThumb(ctx, th, s.x, ty, THUMB_D);
    }
    ctx.restore();
    if (moving) this.request();
  }

  /**
   * The width scale, like a map's: a bar and how many individuals alive at
   * the time its width holds at the current zoom (a round 1, 2 or 5 × 10^k).
   * In log widths a width is 1 + log10(individuals), so the bar is the width
   * that multiplies the individuals by 10 (or by 10^k, or by a factor,
   * whichever fits).
   */
  widthScale(): { px: number; label: string } {
    const unitPx = this.fan.branches[0].unit * this.cam.sx; // px per individual (linear) or per decade (log)
    const target = 70;
    if (this.mode === 'linear') {
      const per = 1 / unitPx; // individuals per px
      const n = Math.max(1, niceStep(target * per));
      const px = n / per;
      return { px, label: `${formatCount(n, { exact: true })} ${n === 1 ? 'individual' : 'individuals'}` };
    }
    if (unitPx < target * 2.5) {
      const k = Math.max(1, niceStep(target / unitPx));
      return { px: k * unitPx, label: `×${k === 1 ? '10' : `10${sup(k)}`} individuals · log widths` };
    }
    const fct = Math.pow(10, target / unitPx);
    return { px: target, label: `×${fct < 1.1 ? fct.toFixed(4) : fct.toFixed(2)} individuals · log widths` };
  }

  private drawWidthScale(): void {
    const el = this.scaleEl;
    if (!el) return;
    const { px, label } = this.widthScale();
    const key = `${px.toFixed(1)}|${label}`;
    if (key === this.scaleKey) return;
    this.scaleKey = key;
    const bar = el.firstElementChild as HTMLElement | null;
    const lab = el.lastElementChild as HTMLElement | null;
    if (bar) bar.style.width = `${px.toFixed(1)}px`;
    if (lab) lab.textContent = label;
  }

  private drawDebug(): void {
    const c = this.cam;
    const h = this.homeCamera();
    const [, yTop] = this.toWorld(0, 0);
    const [, yBot] = this.toWorld(0, this.h);
    const yrs = this.camera.years(yBot) - this.camera.years(yTop);
    const perPx = 1 / this.fan.branches[0].unit / c.sx;
    const lines = [
      `width ×${(c.sx / h.sx).toPrecision(4)}  time ×${(c.sy / h.sy).toPrecision(4)} (asked ×${(c.ty / h.sy).toPrecision(3)})`,
      `screen ${formatYearsAgo(yrs).replace(' ago', '')} · top ${formatYearsAgo(Math.max(0, this.camera.years(yTop)))}`,
      `${this.mode === 'linear' ? `${perPx.toPrecision(3)} individuals/px` : `${perPx.toPrecision(3)} log units/px`}`,
    ];
    const ctx = this.ctx;
    ctx.save();
    // Under the buttons, right-aligned: clear of the axis and of the species' labels at the top.
    ctx.font = font('500 12px');
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
    const bar = this.barRect();
    const top = (bar ? bar[3] : 40) + 8;
    ctx.fillStyle = 'rgba(10,16,13,0.85)';
    ctx.fillRect(this.w - 8 - bw, top, bw, 50);
    ctx.fillStyle = '#ffd479';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    lines.forEach((l, k) => ctx.fillText(l, this.w - 14, top + 5 + k * 14));
    ctx.restore();
  }

  /**
   * The time axis, pinned to the left edge at every zoom: ticks adapt to the
   * visible range (round log ticks far out, round linear steps deep in), and
   * "now" is always labelled (pinned to the top edge when it is above the screen).
   */
  private drawTimeAxis(labels: boolean): void {
    const ctx = this.ctx;
    const ts = this.fan.time;
    const origin = ts.originMa * 1e6;
    // The axis goes on below the origin, down the stem to the bottom of the world.
    const bottom = ts.ageAt(this.fan.trunkBottom.y) * 1e6;
    const yrsAt = (py: number) => ts.ageAt(this.toWorld(0, py)[1]) * 1e6;
    const aTop = Math.min(bottom, yrsAt(-10));
    const aBot = Math.min(bottom, yrsAt(this.h + 10));
    const clear = (yrs: number) => Math.abs(Math.log10(yrs / origin)) > 0.025 && yrs <= bottom * 1.0001;
    const syOf = (yrs: number) => this.toScreen(0, ts.y(yrs / 1e6))[1];
    // Candidates in priority order: origin and now, round log ticks, then linear steps.
    const cands: { yrs: number; step: number }[] = [{ yrs: origin, step: 0 }, { yrs: 0, step: 0 }];
    for (const m of [1, 5, 2]) {
      for (let e = 9; e >= 0; e--) {
        const yrs = m * Math.pow(10, e);
        if (clear(yrs) && yrs >= aTop && yrs <= aBot) cands.push({ yrs, step: yrs });
      }
    }
    const span = aBot - aTop;
    if (span > 0) {
      for (const div of [3, 6, 12]) {
        const step = niceStep(span / div);
        for (let k = Math.ceil(aTop / step); k * step <= aBot && k - Math.ceil(aTop / step) < 40; k++) {
          const yrs = k * step;
          if (yrs > 0 && clear(yrs)) cands.push({ yrs, step });
        }
      }
    }
    const placed: { yrs: number; step: number; sy: number }[] = [];
    for (const c of cands) {
      const sy = syOf(c.yrs);
      if (sy < -10 || sy > this.h + 10) continue;
      const must = c.step === 0;
      if (!must && placed.some((p) => Math.abs(p.sy - sy) < 30)) continue;
      if (placed.some((p) => p.yrs === c.yrs)) continue;
      placed.push({ ...c, sy });
    }
    ctx.save();
    ctx.font = font('500 12px');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = BG;
    if (!labels) {
      // Grid lines go under the branches; the labels go on top of everything.
      for (const p of placed) {
        const y = Math.round(p.sy);
        if (p.yrs === 0) {
          // "Now": a lit horizon.
          this.under(0, y - 3, this.w, y + 4, rgb01(GREEN), 0.05);
          this.under(0, y, this.w, y + 1, rgb01(GREEN), 0.4);
        } else this.under(0, y, this.w, y + 1, [220 / 255, 235 / 255, 225 / 255], 0.06);
      }
      ctx.restore();
      return;
    }
    // A gutter that fades out from the left edge, and a halo of the ground round each label:
    // the labels read over the branches and the stem.
    // (The gutter itself is drawn under the species' labels: drawGutter.)
    ctx.translate(axisInset(this), 0);
    this.axisBoxes.length = 0;
    const box = (t: string, x: number, y: number) => this.axisBoxes.push([x + axisInset(this), y - 9, x + axisInset(this) + ctx.measureText(t).width, y + 9]);
    ctx.font = font('500 12px');
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(12,23,20,0.9)';
    // "now" above the screen: a marker pinned at the top, and no tick label under it.
    const nowAbove = syOf(0) < 0;
    const nowY = Math.max(12, (this.barRect()?.[1] ?? 10) + 8);
    for (const p of placed) {
      const now = p.yrs === 0;
      if (nowAbove && !now && p.sy - 7 < nowY + 16) continue;
      // (Not under the foot: the scale bar and the key sit there.)
      if (!now && p.sy - 7 > this.h - 74) continue;
      // A short tick at the edge, visible over the branches too.
      ctx.fillStyle = now ? GREEN : '#8d9e93';
      ctx.fillRect(0, Math.round(p.sy), now ? 6 : 4, 1);
      const label = now ? 'now' : p.yrs === origin ? `${formatTick(origin, 0)}, the ${this.clade.common.toLowerCase()} begin` : formatTick(p.yrs, p.step);
      ctx.fillStyle = now ? GREEN : p.yrs === origin ? INK : INK3;
      if (now || p.yrs === origin) ctx.font = font('650 12.5px');
      ctx.strokeText(label, 6, p.sy - 7);
      ctx.fillText(label, 6, p.sy - 7);
      box(label, 6, p.sy - 7);
      ctx.font = font('500 12px');
    }
    if (nowAbove) {
      ctx.font = font('650 12.5px');
      ctx.fillStyle = GREEN;
      ctx.strokeText('↑ now', 6, nowY);
      ctx.fillText('↑ now', 6, nowY);
      box('↑ now', 6, nowY);
      ctx.font = font('500 12px');
    }
    // Honest scale note under the axis labels.
    const oy = syOf(origin);
    if (oy > 0 && oy < this.h - 20) {
      ctx.fillStyle = INK3;
      ctx.font = font('italic 400 12px', SERIF);
      ctx.strokeText('time, log scale', 6, oy + 9);
      ctx.fillText('time, log scale', 6, oy + 9);
      box('time, log scale', 6, oy + 9);
    }
    ctx.restore();
  }

  /** The time axis's gutter: the branches fade under it at the left edge; the labels go over it. */
  private drawGutter(): void {
    const ctx = this.ctx;
    const gut = ctx.createLinearGradient(0, 0, 96, 0);
    gut.addColorStop(0, 'rgba(12,23,20,0.86)');
    gut.addColorStop(0.55, 'rgba(12,23,20,0.5)');
    gut.addColorStop(1, 'rgba(12,23,20,0)');
    ctx.fillStyle = gut;
    ctx.fillRect(0, 0, 96, this.h);
  }

  private drawTrunkLabel(): void {
    const ctx = this.ctx;
    const f = this.fan;
    // Right of the stem, just below the fork (nothing else is drawn there).
    const [sx, sy] = this.toScreen(f.stem[1], 0);
    if (sy > this.h + 20 || sy < -80 || sx > this.w) return;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const lines: [string, string, string][] = [
      [f.clade.common, font('650 17px'), INK],
      [f.clade.sci, font('italic 400 14px', SERIF), INK2],
      // The living first; the total born only as an honest secondary line (a model figure, never bare).
      [`${formatCount(f.clade.alive)} alive now`, font('600 13px'), GREEN],
      [`${formatCount(f.clade.ever)} born in total (model, grade ${f.clade.grade})`, font('500 13px'), INK2],
    ];
    let wmax = 0;
    for (const [t, ft] of lines) {
      ctx.font = ft;
      wmax = Math.max(wmax, ctx.measureText(t).width);
    }
    // Right of the stem if it fits; else on the stem itself, just below the fork, on a halo.
    const onStem = sx + 10 + wmax > this.w - 6;
    const [stemL] = this.toScreen(f.stem[0], 0);
    // (Clear of the axis's "time, log scale" note beside the fork.)
    ctx.font = font('italic 400 12px', SERIF);
    const noteR = 6 + ctx.measureText('time, log scale').width + 12;
    // (On the stem: kept on screen, the text clear of its right edge where the stem is far right.)
    const x = onStem ? Math.max(noteR, Math.min(stemL + 10, this.w - 6 - wmax)) : Math.max(noteR, sx + 10);
    const y = sy + 8;
    // Fading out as it nears the width scale and legend at the bottom (a level framed inside the fan puts the fork low).
    const fade = Math.max(0, Math.min(1, (this.h - 46 - (y + 68)) / 16));
    if (!(fade > 0)) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = fade;
    if (onStem) {
      ctx.shadowColor = 'rgba(12,23,20,0.95)';
      ctx.shadowBlur = 7;
    }
    const dy = [0, 21, 39, 55];
    lines.forEach(([t, ft, c], k) => {
      ctx.font = ft;
      ctx.fillStyle = c;
      ctx.fillText(t, x, y + dy[k]);
      if (onStem) ctx.fillText(t, x, y + dy[k]);
    });
    ctx.restore();
  }

}


function sup(k: number): string {
  return String(k)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] ?? d)
    .join('');
}

/** A round step (1, 2 or 5 × 10^k) near `x`. */
export function niceStep(x: number): number {
  const e = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, e);
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * Math.pow(10, e);
}

/** Compact tick label for `yrs` years ago, with as many decimals as the tick step needs. */
export function formatTick(yrs: number, step: number): string {
  const [div, unit] = yrs >= 1e9 ? [1e9, 'Gya'] : yrs >= 1e6 ? [1e6, 'Mya'] : yrs >= 1e3 ? [1e3, 'kya'] : [1, 'yr ago'];
  const st = step > 0 ? step / div : yrs / div;
  const dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(st) + 1e-9)));
  const v = yrs / div;
  const d = step > 0 ? dec : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${tickFormat(d).format(Number(v.toFixed(d)))} ${unit}`;
}

/** en-US number formats by decimals (made once: toLocaleString makes one per call, the axis's ticks every frame). */
const tickFormats = new Map<number, Intl.NumberFormat>();
function tickFormat(d: number): Intl.NumberFormat {
  let f = tickFormats.get(d);
  if (!f) tickFormats.set(d, (f = new Intl.NumberFormat('en-US', { maximumFractionDigits: d })));
  return f;
}

/** Mix two #rrggbb colours: t = 0 gives a, 1 gives b (#rrggbb). */
function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

const BG01 = rgb01(BG);
/** The dim of the styled span (screen [top, bottom, dim]) a screen y falls in; 0 in none. */
function dimAt(spans: [number, number, number][], y: number): number {
  for (const s of spans) if (y >= s[0] && y <= s[1]) return s[2];
  return 0;
}

const rgbParsed = new Map<string, [number, number, number]>();
/** mix() straight to 0–1 channels, as rgb01(mix(a, b, t)) gives them (no strings: it runs per chord, per frame). */
function mix01(a: string, b: string, t: number): [number, number, number] {
  let A = rgbParsed.get(a);
  if (!A) rgbParsed.set(a, (A = rgb01(a)));
  let B = rgbParsed.get(b);
  if (!B) rgbParsed.set(b, (B = rgb01(b)));
  const c = (k: number) => Math.round((A[k] * (1 - t) + B[k] * t) * 255) / 255;
  return [c(0), c(1), c(2)];
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatYearsAgo(y: number): string {
  if (y < 1) return 'under a year ago';
  if (y < 1e4) return `${fmtInt(y)} years ago`;
  if (y < 999500) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} thousand years ago`;
  return `${(y / 1e6).toFixed(2)} million years ago`;
}
