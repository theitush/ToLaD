// The fan view: the dated tree drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { drawThumb, labelThumb, thumbsOn, wikiOf } from './wiki';
import { PIC_D, PIC_LIFT, placePics, type PicSpot } from './pics';
import { formatCount } from '../data/count';
import { DOUBLE_TAP_MS, Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, type Camera } from './camera';
import { g, isNode, laneAt, layoutFan, leftAt, nearestStrand, nodeLeftAt, nodeQ, segAt, STEM_FADE_MA, type EdgeStyle, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { FanGL, rgb01 } from './meshgl';
import { Lod } from './lod';
import type { FoldState } from './fold';
import { Steady, wantFitFossils } from './steady';
import { COLUMN_DIM, columnSpans, EVENT_TINT, eventAt, eventSpans, type EventSpan } from './colstyle';
import { drawTwigs, kLogAt, laneDim, LINEAGE, LIVING, pathFrame, TEX_HAIR_PX, TWIG_GRAY, TwigModel, type IndInfo, type TwigStats } from './twigs';
import type { MeshBatch, RectBatch } from './meshgl';
import { FAMILY_EN, familyLabel, FELIDAE_TREE, ORDER_EN, ORDER_TAXA, taxonKey, type Split } from './splits';
import { Brackets, cladeCamera, foldedFrame, latinOf, rankOf, TAP_FILL, TAXON_EN, type StackAt } from './brackets';
import { axisInset, drawWorldOver, drawWorldUnder, worldFlags, type Box } from './world';

export type { IndInfo } from './twigs';
export type { Camera } from './camera';

/**
 * The texture inside the columns (the individuals' lines and lives, twigs.ts drawTwigs; ToLaD#100, #101, #192): off
 * for now (ToLaD#273, "the texture just breaks"), the columns flat bands of their green and grey lanes. `?texture=1`
 * (TOLAD_TEXTURE=1 in node) brings it back; off, nothing of it runs.
 */
export const textureOn = (() => {
  try {
    if (typeof location !== 'undefined') return new URLSearchParams(location.search).get('texture') === '1';
  } catch {
    /* no URL */
  }
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TOLAD_TEXTURE === '1';
})();

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
/** A "+x" tap's frame (groupCamera): the species' span at "now" widened this share each side, a name's room (~27 px) past the outer ones. */
const GROUP_NAME_PAD = 0.1;
/** A "+x" tap's frame: neighbouring names at least this far apart (px; a pill and a gap), and a column running off its edge this much on screen. */
const GROUP_NAME_GAP = 28;
const GROUP_DOM_PX = 40;
/** A level's flight under way (ToLaD#258, #271): the level it lands on and its frame, so a tap or double-tap mid-flight goes on from there. */
type Step = { lv: Level; cam: Camera };
/**
 * The view is "inside" a level's frame when it is zoomed in at least this far less than it (15 %), width and time
 * together (the area's scale): levelNow's. (Zoomed in past it, a pinch or a "+x" into part of it, a double-tap still goes
 * up from it, never back to its own frame: ToLaD#301.)
 */
const BACK_SLACK = 1.15;
/** The level the view was at is kept while the view is within half a screen of its frame and zoomed at most this far from it (ToLaD#311). */
const LEVEL_KEEP = 1.6;
/** A touch that has moved this many px is a pan, not a tap (engine/input.ts's tap): a level's flight under it stops (ToLaD#301). */
const TOUCH_SLOP = 12;
/** A tap's next level (ToLaD#258) is one whose frame stands more than this many px off the view's: nearer, it is passed. */
const LEVEL_PX = 12;
/** A level of one, two or three groups is framed taking this much of the screen's width (ToLaD#262; more, TAP_FILL). */
const FEW_FILL = [0.5, 0.5, 0.5, 0.6];
/** The level the view is at (levelNow) is worked out at most this often (ms) while the camera moves without a gesture (a wheel). */
const LEVEL_MS = 200;
/** The scale bar and legend at the bottom (px): labels fade out over the 30 px above it. */
const LABEL_BOTTOM_PX = 104;
/** How long a label takes to fade in or out when another takes or gives up its place (ms). */
const LABEL_FADE_MS = 180;
/** Folded: how far (px) below the order's start its stem fades out (drawStemFade, ToLaD#210). */
const STEM_END_PX = 48;
/** A lane's living glow at full strength from this green width (px) up, thinner ones in proportion: a family of thin columns side by side glows as one (ToLaD#231). */
const GLOW_W = 6;
/** A column with no styled spans on screen (drawStrand): shared, never written. */
const NO_HELD: [number, number, number][] = [];
/** The glow fades out across a lean: gone where the lane runs √(1 + s²) - 1 = GLOW_LEAN off straight down (s ≈ 0.75 px per px). */
const GLOW_LEAN = 0.25;

/** camera.frame's fork: this many px up from the screen's foot. */
const FRAME_BOTTOM = 150;
/** A level's start (its fork, a species' split) stands this many px up from the screen's foot, just over the scale bar (ToLaD#288). */
const FORK_PX = LABEL_BOTTOM_PX;
/** Room (px) a frame keeps between the brackets' stack and "now" for the level's pictures standing on it (ToLaD#274). */
const NOW_ROOM = PIC_D + 8;

/** Gap (px) a label keeps from the column it sits beside. */
const LABEL_GAP = 3;

/**
 * Where a level's group names stand (ToLaD#266, Ita: "lets try", a toggle): `beside` its branch just below "now"
 * (ToLaD#262), `mid` along its branch halfway between "now" and where it splits off, or `gap` between its branch and
 * its neighbour's at that same height. Each of the last two clamped to the part on screen.
 */
export type NameMode = 'beside' | 'mid' | 'gap';
export const NAME_MODES: readonly NameMode[] = ['beside', 'mid', 'gap'];
/** The names' place asked for: ?names=mid|gap (else beside). */
export function wantNames(): NameMode {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('names') : null;
    if (q === 'mid' || q === 'gap') return q;
  } catch {
    /* no URL */
  }
  return 'beside';
}
/** While the view moves, the labels and brackets are laid out again at most this often (ms) and every this many frames (ToLaD#255); carried with the camera between. */
const LABEL_MS = 150;
const LABEL_FRAMES = 3;
/** `?carry=0`: laid out every frame, as before ToLaD#255 (to compare). */
const labelCarry = typeof location === 'undefined' || new URLSearchParams(location.search).get('carry') !== '0';
/** The camera's change between two frames on screen: x → k[0]·x + k[1], y → k[2]·y + k[3]. */
export type Carry = [number, number, number, number];

/**
 * Carry label spots laid out at one camera to the next (ToLaD#255), in place: x with the camera; y with it too where a
 * spot stands on something in the world ("now", its tip, its column's top on screen), kept at the top line `top`
 * where it was held there (its column's top above it), and never above it. A spot carried wholly off the screen's
 * side (width `w`) no longer fits (fit 0).
 */
export function carryLabels(spots: LabelSpot[], k: Carry, top: number, w = Infinity): void {
  for (const s of spots) {
    const b = s.box;
    const dx = k[0] * s.x + k[1] - s.x;
    s.x += dx;
    b[0] += dx;
    b[2] += dx;
    // (Carried off the screen's side, it no longer fits, as a layout there would say: its hold on the place is let go, so
    // at rest a name that left and came back waits for room like it does when laid out every frame.)
    if (b[0] >= w || b[2] <= 0) s.fit = 0;
    if (s.span) {
      s.span[0] = k[0] * s.span[0] + k[1];
      s.span[1] = k[0] * s.span[1] + k[1];
    }
    // (Standing on something at its foot: "now", its tip, a fossil's picture on its tip, `over`.)
    const foot = s.place === 'tip' || s.place === 'fam' || s.place === 'over';
    const held = !foot && b[1] <= top + 0.5;
    if (held) continue;
    const at = foot ? s.y1 : b[1];
    const dy = Math.max(k[2] * at + k[3] - at, top - b[1]);
    s.y1 += dy;
    b[1] += dy;
    b[3] += dy;
  }
}

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
  place: 'tip' | 'in' | 'right' | 'left' | 'fam' | 'over';
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
  /** A level's name over other columns (ToLaD#262): taken only when no clear spot is. */
  loose?: boolean;
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

const viewList = new WeakMap<Map<FanBranch | FanNode, ColBox>, { qs: ColBox[]; lo: FanBranch[]; hi: FanBranch[] }>();
/** colBoxes' boxes over the world heights [vy0, vy1]: each strand's reach there off the fold's rows (xRange), a parent column's from its first strand's to its last's. */
function viewBoxes(fan: Fan, out: Map<FanBranch | FanNode, ColBox>, [vy0, vy1]: [number, number]): void {
  const t = fan.tess;
  // (Off the bands' rows, read once for the labels' clearance too: Tess.xRange's box (its table, slot 2), worked out alike.)
  const bd = bandBoxes(fan, vy0, vy1);
  if (bd) {
    const { GL, GR, w } = bd;
    const bot = t.bottom;
    const box = (b: FanBranch, right: boolean): number => {
      const lo = Math.max(vy0, b.tipY);
      const i = b.index;
      if (!(Math.min(vy1, bot) >= lo) || GL[i] > GR[i]) return right ? -Infinity : Infinity;
      const wMax = lo < b.splitY ? w[i] : b.baseW;
      const l = GL[i] - wMax;
      const r = GR[i] + wMax;
      const pad = 1e-6 * Math.max(1, Math.abs(l), Math.abs(r)) + (r - l) * 1e-3;
      return right ? r + pad : l - pad;
    };
    // (The boxes as flat lists, kept per map: ~11,700 at the mammal level, walked every layout, ToLaD#255.)
    let fl = viewList.get(out);
    if (!fl) {
      const qs: ColBox[] = [];
      const lo: FanBranch[] = [];
      const hi: FanBranch[] = [];
      for (const q of out.values()) {
        const o = q.own;
        qs.push(q);
        lo.push(isNode(o) ? o.strands[0] : o);
        hi.push(isNode(o) ? o.strands[o.strands.length - 1] : o);
      }
      viewList.set(out, (fl = { qs, lo, hi }));
    }
    const { qs, lo, hi } = fl;
    for (let k = 0; k < qs.length; k++) {
      const q = qs[k];
      if (q.y1 <= vy0 || q.y0 > vy1) continue;
      q.x0 = box(lo[k], false);
      q.x1 = box(hi[k], true);
    }
    return;
  }
  // (Each over the whole view's heights: one table of the fold's rows, its own (slot 2), for every column.)
  for (const q of out.values()) {
    if (q.y1 <= vy0 || q.y0 > vy1) continue;
    const o = q.own;
    if (isNode(o)) {
      q.x0 = t.xRange(o.strands[0], vy0, vy1, 2)[0];
      q.x1 = t.xRange(o.strands[o.strands.length - 1], vy0, vy1, 2)[1];
    } else [q.x0, q.x1] = t.xRange(o, vy0, vy1, 2);
  }
}

/** How many of the fold's rows bandBoxes reads at most (Tess.xTable's XR_ROWS: every one over a screen's height). */
const XR_ROWS = 512;
/** How many rows of the fold's grid a band of bandBoxes' spans (ToLaD#255). */
const BAND_ROWS = 8;
/** bandBoxes' tables per fan, kept and refilled in place (no garbage a layout). */
const bandCache = new WeakMap<Fan, Bands>();
interface Bands {
  ver: number;
  h: number;
  vy0: number;
  vy1: number;
  /** The rows kA..kB, in bands of BAND_ROWS (band j: rows kA + j·BAND_ROWS to kA + (j + 1)·BAND_ROWS, both ends). */
  kA: number;
  kB: number;
  nb: number;
  /** Per band and strand (j·S + i): the least and most of its edge at the band's rows (Fold.rowXs: a left edge or an own column's centre). */
  L: Float64Array;
  R: Float64Array;
  /** Per strand: the widest its column gets (an own column's centre ± this holds it; a slot's left + this). */
  w: Float64Array;
  /** Per strand: the least and most over every band (all the rows kA..kB: Tess.xTable's over the same heights). */
  GL: Float64Array;
  GR: Float64Array;
}
/**
 * The strands' reach per band of the fold's rows over the world heights [vy0, vy1] (ToLaD#255): labelSpots' clearance
 * skips a column whose reach over the bands its strip spans stays clear of it, as viewBoxes' box over the whole
 * view does (the edge is linear between two rows: within their least and most). Null off the fold's grid.
 */
function bandBoxes(fan: Fan, vy0: number, vy1: number): Bands | null {
  const f = fan.tess.fold;
  if (!f || !(f.gridH > 0)) return null;
  let t = bandCache.get(fan);
  if (t && t.ver === f.ver && t.h === f.gridH && t.vy0 === vy0 && t.vy1 === vy1) return t;
  const S = f.strands.length;
  const h = f.gridH;
  let tip = Infinity;
  for (const b of f.strands) if (b.tipY < tip) tip = b.tipY;
  const a = Math.max(vy0, tip);
  const z = Math.min(vy1, fan.tess.bottom);
  if (!(z >= a)) return null;
  const kA = Math.floor(a / h);
  const kB = Math.max(kA, Math.ceil(z / h));
  // (Every row read, as Tess.xTable reads them over a screen's height; more: none, the boxes as they were.)
  if (kB - kA > XR_ROWS) return null;
  const nb = Math.max(1, Math.ceil((kB - kA) / BAND_ROWS));
  if (!t || t.L.length < nb * S) {
    t = { ver: 0, h: 0, vy0: 0, vy1: 0, kA: 0, kB: 0, nb: 0, L: new Float64Array(Math.max(nb, 32) * S), R: new Float64Array(Math.max(nb, 32) * S), w: new Float64Array(S), GL: new Float64Array(S), GR: new Float64Array(S) };
    for (const b of f.strands) t.w[b.index] = Math.max(b.baseW, b.unit * g(b.pop.max, fan.tess.mode));
    bandCache.set(fan, t);
  }
  Object.assign(t, { ver: f.ver, h, vy0, vy1, kA, kB, nb });
  const { L, R, GL, GR } = t;
  for (let j = 0; j < nb; j++) {
    const o = j * S;
    const k0 = kA + j * BAND_ROWS;
    const k1 = Math.min(kB, k0 + BAND_ROWS);
    for (let k = k0; k <= k1; k++) {
      const xs = f.rowXs(k);
      if (k === k0) {
        L.set(xs.subarray(0, S), o);
        R.set(xs.subarray(0, S), o);
        continue;
      }
      for (let i = 0; i < S; i++) {
        const x = xs[i];
        if (x < L[o + i]) L[o + i] = x;
        if (x > R[o + i]) R[o + i] = x;
      }
    }
    if (j === 0) {
      GL.set(L.subarray(0, S));
      GR.set(R.subarray(0, S));
    } else
      for (let i = 0; i < S; i++) {
        if (L[o + i] < GL[i]) GL[i] = L[o + i];
        if (R[o + i] > GR[i]) GR[i] = R[o + i];
      }
  }
  return t;
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

/** The shortest share of a flight its ease speeds up over (and slows down over, at the end): see flightEase. */
const FLY_RAMP_MIN = 0.15;

/**
 * A flight's ease (ToLaD#246, #293): u (time, 0 to 1) to e (share of its path). Up to the time cap it is the sine ease
 * (slow in, fastest midway, slow out). A flight the cap cuts short (flightMs) cruises instead: it speeds up over the
 * first share r of its time on the sine's quarter, keeps that speed, and slows over the last r, so its fastest frame is
 * no faster than it must be (a cross-order flight at species depth zooms out ~10^4 and back in, ToLaD#293). r = ½ is
 * the sine ease itself.
 */
export function flightEase(S: number, ms: number): (u: number) => number {
  const want = FLY_MS0 + FLY_MS_PER * (Number.isFinite(S) ? S : 0);
  // (The speed at the sine's peak, π/2, as much slower as the cap made the flight shorter; the ramps from it.)
  const c = 1 - 2 / Math.PI;
  const V = Math.max(1 / (1 - 2 * FLY_RAMP_MIN * c), (Math.PI / 2) * Math.min(1, ms / want));
  const r = Math.min(0.5, (1 - 1 / V) / (2 * c));
  if (r >= 0.5) return (u) => (1 - Math.cos(Math.PI * u)) / 2;
  const ramp = (u: number) => V * ((2 * r) / Math.PI) * (1 - Math.cos((Math.PI * u) / (2 * r)));
  const mid = V * ((2 * r) / Math.PI);
  return (u) => (u <= r ? ramp(u) : u >= 1 - r ? 1 - ramp(1 - u) : mid + V * (u - r));
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

/** A level's fossils are dwarfed when its span at "now" is more than this many times what they and their kin stood in. */
export const FIT_DWARF = 3;

/**
 * Where a level's fossils lived (?fit=fossils, ToLaD#289): the world x its columns took (each at its own width
 * there) from the level's start up to its youngest fossil group's end (fossilEnd), or null when it has no fossil or its span at "now"
 * (familySpan) is under FIT_DWARF times that: the living columns' widening since is left to run off the screen.
 */
export function fossilSpan(fan: Fan, v: FanNode): [number, number] | null {
  const yEnd = fossilEnd(fan, v);
  if (yEnd === null) return null;
  const s: [number, number] = [Infinity, -Infinity];
  for (const b of v.strands) {
    const hi = Math.min(b.splitY, v.yBot);
    const lo = Math.max(b.tipY, yEnd);
    if (!(hi > lo)) continue;
    for (let k = 0; k <= 32; k++) {
      const y = lo + ((hi - lo) * k) / 32 - (k === 32 ? 1e-9 : 0);
      const w = laneAt(b, y).w;
      const l = leftAt(b, y, w);
      s[0] = Math.min(s[0], l);
      s[1] = Math.max(s[1], l + w);
    }
  }
  if (!(s[1] > s[0])) return null;
  const [a, z] = familySpan(v);
  return z - a > FIT_DWARF * (s[1] - s[0]) ? s : null;
}

/**
 * World y of a level's youngest fossil group's end (ToLaD#298): of its groups one level down (nextLevels) with no
 * member alive now, the one whose last member died nearest "now"; null when every group has one alive. (At the
 * Hominins the Homo group, the humans in it, is no fossil: its fossils' ~40 kya would leave the australopiths and
 * Paranthropus, the level's own fossils, at the screen's foot.)
 */
function fossilEnd(fan: Fan, v: FanNode): number | null {
  const gone = (b: FanBranch) => b.sp.extinct || !(b.pop.aliveAt(0) > 0);
  let y = Infinity;
  for (const g of nextLevels(fan, v)) {
    const bs = g.b ? [g.b] : g.v.strands;
    if (bs.every(gone)) for (const b of bs) y = Math.min(y, b.tipY);
  }
  return y < Infinity ? y : null;
}

/**
 * The world y a level's frame puts where "now" would stand (ToLaD#298): under ?fit=fossils, a level framed on its
 * fossils (fossilSpan) has its youngest fossil group's end there, "now" (and the living columns' last ~40 kyr, which
 * log time gives most of the screen) above the screen; otherwise null ("now" there).
 */
export function fossilTop(fan: Fan, v: FanNode): number | null {
  return wantFitFossils() && fossilSpan(fan, v) ? fossilEnd(fan, v) : null;
}

/** The world x a level is framed on: its span at "now" (familySpan), or under ?fit=fossils where its dwarfed fossils lived (fossilSpan, ToLaD#289). */
export function levelSpan(fan: Fan, v: FanNode): [number, number] {
  return (wantFitFossils() && fossilSpan(fan, v)) || familySpan(v);
}

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

/**
 * What a "+x" tap frames across the screen (groupCamera, ToLaD#274): the species' columns at "now" (`yNow`; an extinct
 * one's at its tip), where their names and pictures stand, not their rooms, wider where they were wider in the past.
 * Widened GROUP_NAME_PAD each side, a name's room beyond the outer ones (ToLaD#293: the leftmost's name beside it
 * right of the time axis, not squeezed against its neighbour's; MDD's mongooses: the Crab-eating mongoose at the
 * frame's edge).
 *
 * Closer in where that frame leaves neighbouring names (on their columns' centres) nearer than GROUP_NAME_GAP px, as
 * far as their names still fit on a screen `w` px wide (ToLaD#293: MDD's young splits, the Polar bear 25 px from the
 * Brown bear). A column wider than the rest together at an end (the domestic dog's, the domestic cat's) runs off that
 * edge, GROUP_DOM_PX of it kept on screen with its name, so the wild species beside it open out rather than stand as
 * slivers at its side.
 */
export function groupSpan(bs: readonly FanBranch[], yNow: number, w = 0): [number, number] {
  const cols = bs.map((b) => {
    const y = Math.max(b.tipY, yNow);
    const l = leftAt(b, y);
    const r = l + laneAt(b, y).w;
    return { l, r, c: (l + r) / 2 };
  });
  const s: [number, number] = [Math.min(...cols.map((q) => q.l)), Math.max(...cols.map((q) => q.r))];
  const pad = GROUP_NAME_PAD * (s[1] - s[0]);
  const out: [number, number] = [s[0] - pad, s[1] + pad];
  if (!w || cols.length < 2) return out;
  // (Its zoom, px per world unit: cladeCamera lays the span across `fill` px, centred `mid` px from the left, camera.frame.)
  const fill = Math.min(w - 72, TAP_FILL * w);
  const mid = w / 2 + (58 - 14) / 2;
  const p0 = fill / (out[1] - out[0]);
  // (Where the outer columns can stand: a name's room (a pill and a gap) right of the time axis and in from the
  // screen's edge, for a level's names beside their columns, not on them: MDD's Crab-eating mongoose.)
  const L = LABEL_AXIS_X + GROUP_NAME_GAP;
  const R = w - GROUP_NAME_GAP;
  cols.sort((a, b) => a.c - b.c);
  const widest = cols.reduce((a, q) => (q.r - q.l > a.r - a.l ? q : a));
  const dom = widest.r - widest.l > (s[1] - s[0]) / 2 ? (widest === cols[0] ? -1 : widest === cols[cols.length - 1] ? 1 : 0) : 0;
  const core = dom < 0 ? cols.slice(1) : dom > 0 ? cols.slice(0, -1) : cols;
  let gap = Infinity;
  for (let i = 1; i < core.length; i++) gap = Math.min(gap, core[i].c - core[i - 1].c);
  // (What has to fit between L and R: the names' centres, and a dominant column's edge GROUP_DOM_PX in from its side.)
  const x0 = dom < 0 ? widest.r : core[0].c;
  const x1 = dom > 0 ? widest.l : core[core.length - 1].c;
  const room = R - L - (dom ? GROUP_DOM_PX : 0);
  const need = GROUP_NAME_GAP / gap;
  const p = Math.min(need, x1 > x0 ? room / (x1 - x0) : Infinity);
  if (!(p > p0 * 1.001) || !Number.isFinite(p)) return out;
  // (Laid in L..R, centred on what is left over, a dominant column showing at least GROUP_DOM_PX of itself.)
  const lead = L + (dom < 0 ? GROUP_DOM_PX : 0) + (room - (x1 - x0) * p) / 2;
  const m = x0 + (mid - lead) / p;
  const half = fill / p / 2;
  return [m - half, m + half];
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
 * A level (ToLaD#258): what a tap goes one deeper into and a double-tap one out of. A named group (a clade with a rank,
 * isLevel), or a single species.
 */
export type Level = { v: FanNode; b?: undefined } | { b: FanBranch; v?: undefined };

/** The clades above an order (ToLaD#258): a superordinal one (Theria, Glires…) is no level, so mammal home opens on the orders. Kept per fan. */
const aboveCache = new WeakMap<Fan, Set<FanNode>>();
function aboveOrders(fan: Fan): Set<FanNode> {
  let out = aboveCache.get(fan);
  if (!out) {
    out = new Set();
    for (const v of fan.nodes) if (ORDER_TAXA.has(taxonKey(v.split.taxon ?? ''))) for (let p = v.parent; p; p = p.parent) out.add(p);
    aboveCache.set(fan, out);
  }
  return out;
}

/** Whether clade v is a level (ToLaD#258): the root, or a ranked clade (rankOf: order, suborder, family, …, genus) not above an order. */
export function isLevel(fan: Fan, v: FanNode): boolean {
  return !v.parent || (!!rankOf(latinOf(v.split)) && !aboveOrders(fan).has(v));
}

/** A level's name on its pill (ToLaD#258): its English name where there is one (TAXON_EN: the orders', families' …), else its Latin. */
export function levelName(v: FanNode): string {
  const latin = latinOf(v.split);
  return TAXON_EN[latin] ?? (latin || v.name);
}

/**
 * The groups one level down from clade v (ToLaD#258), left to right: each daughter that is a level or a species, an
 * unnamed daughter's own groups in its place. A group with all of v's species (v's one named daughter) opens to its own;
 * a named group of a single species is that species.
 */
export function nextLevels(fan: Fan, v: FanNode): Level[] {
  const out: Level[] = [];
  const go = (u: FanNode) => {
    for (const k of u.kids) {
      if ('sp' in k) out.push({ b: k });
      else if (k.strands.length === 1) out.push({ b: k.strands[0] });
      else if (isLevel(fan, k) && k.strands.length < v.strands.length) out.push({ v: k });
      else go(k);
    }
  };
  go(v);
  return out;
}

/** The nearest level clade v sits in, from v itself (`self`) or its parent up (ToLaD#258); null past the root. */
export function levelUp(fan: Fan, v: FanNode | null, self = false): FanNode | null {
  for (let p = self ? v : (v?.parent ?? null); p; p = p.parent) if (isLevel(fan, p)) return p;
  return null;
}

/** Whether clade v has a familiar name (ToLaD#288): an English one (TAXON_EN, ORDER_EN, FAMILY_EN), or is the root. */
export function familiar(v: FanNode): boolean {
  const latin = latinOf(v.split);
  return !v.parent || !!(TAXON_EN[latin] ?? ORDER_EN[latin] ?? FAMILY_EN[latin]);
}

/**
 * What the brackets' stack shows at level clade v (ToLaD#288): its groups one level down (nextLevels' clades), then v
 * and every familiar level up from it (levelUp; a Latin-only one, as Theria, gets no row), innermost first. Kept per fan.
 */
const stackCache = new WeakMap<Fan, Map<FanNode, StackAt>>();
export function stackAt(fan: Fan, v: FanNode): StackAt {
  let m = stackCache.get(fan);
  if (!m) stackCache.set(fan, (m = new Map()));
  let out = m.get(v);
  if (!out) {
    const groups = nextLevels(fan, v).flatMap((g) => (g.v ? [g.v] : []));
    const up = [v];
    for (let u = levelUp(fan, v); u; u = levelUp(fan, u)) if (familiar(u)) up.push(u);
    m.set(v, (out = { groups, up }));
  }
  return out;
}

/** A clade's number for cache keys (FanNode carries none). */
const nodeIds = new WeakMap<FanNode, number>();
let nodeN = 0;
function nodeId(v: FanNode): number {
  let k = nodeIds.get(v);
  if (k === undefined) nodeIds.set(v, (k = nodeN++));
  return k;
}

/** A level's clade (ToLaD#288): itself, a species' the level it sits in, the root's last. */
export function levelClade(fan: Fan, lv: Level): FanNode {
  return lv.v ?? levelUp(fan, lv.b.node, true) ?? fan.root;
}

/** Whether level a holds level x (itself or inside it). */
export function holds(a: Level, x: Level): boolean {
  if (a.b) return a.b === x.b;
  if (x.b) return a.v.strands.includes(x.b);
  for (let u: FanNode | null = x.v; u; u = u.parent) if (u === a.v) return true;
  return false;
}

/**
 * The groups named at level `at` (ToLaD#258): the groups one level down in it (nextLevels), and around it, each level
 * it sits in's other groups (the neighbours at the screen's edges); `at` itself when a species. Each clade as labelSpots'
 * groups ({ v, vi, text }), each species in `species`.
 */
export interface LabelGroups {
  groups: { v: FanNode; vi: number; text: string }[];
  species: Set<FanBranch>;
  /** The level's clade (ToLaD#312: its own unnamed columns carry no lineage name; a species' level, the one it sits in). */
  at?: FanNode | null;
  /** The species that are groups of the level itself, not its neighbours' (ToLaD#297: named first). */
  own?: Set<FanBranch>;
}
const groupCache = new WeakMap<object, LabelGroups>();
export function labelGroups(fan: Fan, at: Level): LabelGroups {
  const key = at.v ?? at.b;
  let out = groupCache.get(key);
  if (out) return out;
  const index = new Map(fan.nodes.map((v, i) => [v, i]));
  const o: LabelGroups = { groups: [], species: new Set<FanBranch>(), at: at.v ?? levelUp(fan, at.b.node, true) };
  const add = (g: Level) => (g.b ? o.species.add(g.b) : o.groups.push({ v: g.v, vi: index.get(g.v)!, text: levelName(g.v) }));
  let u: FanNode | null;
  if (at.b) {
    add(at);
    u = levelUp(fan, at.b.node, true);
  } else {
    nextLevels(fan, at.v).forEach(add);
    u = levelUp(fan, at.v);
  }
  o.own = new Set(o.species);
  for (let inner: Level = at; u; inner = { v: u }, u = levelUp(fan, u)) for (const g of nextLevels(fan, u)) if (!holds(g, inner) && !holds(inner, g)) add(g);
  groupCache.set(key, (out = o));
  return out;
}

/** A group's picture (ToLaD#258): the species with the most individuals alive now that has a picture (wiki.ts), else the commonest. */
const faceCache = new WeakMap<FanNode, FanBranch | null>();
export function groupFace(v: FanNode): FanBranch | null {
  let out = faceCache.get(v);
  if (out === undefined) {
    const alive = v.strands.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0).sort((p, q) => q.pop.aliveAt(0) - p.pop.aliveAt(0));
    out = alive.find((b) => wikiOf(b.sp.sci)?.img) ?? alive[0] ?? null;
    faceCache.set(v, out);
  }
  return out;
}

/** A level's group's individuals alive now (ToLaD#266: whose picture stays, and on top, when they crowd). */
const aliveCache = new WeakMap<FanNode, number>();
export function groupAlive(g: Level): number {
  if (g.b) return g.b.sp.extinct ? 0 : g.b.pop.aliveAt(0);
  let n = aliveCache.get(g.v);
  if (n === undefined) aliveCache.set(g.v, (n = g.v.strands.reduce((s, b) => s + (b.sp.extinct ? 0 : b.pop.aliveAt(0)), 0)));
  return n;
}

/** Strand b's middle (world x) at "now", an extinct one's at its tip. */
export function stripMid(b: FanBranch): number {
  const y = Math.max(b.tipY, b.tess.time.y(0));
  return leftAt(b, y) + laneAt(b, y).w / 2;
}

/**
 * A level's group's centre (world x, ToLaD#262): the middle of its columns at "now" (its living species'; an extinct
 * group's at their tips). Its picture stands exactly over it.
 */
const extentCache = new WeakMap<FanNode, { ver: number; s: [number, number] }>();
export function groupCentre(g: Level): number {
  if (g.b) return stripMid(g.b);
  const [lo, hi] = groupExtent(g.v);
  return (lo + hi) / 2;
}

/** Clade v's columns at "now" (world x): its living species' (their tips', if none lives). Kept while the fold stands. */
export function groupExtent(v: FanNode): [number, number] {
  const ver = v.strands[0].tess.fold?.ver ?? 0;
  const hit = extentCache.get(v);
  if (hit && hit.ver === ver) return hit.s;
  const live = livingOf(v);
  let s: [number, number];
  if (live.length) {
    // (Side by side at "now" in tree order, columns never crossing: its first's left edge to its last's right.)
    const y = v.strands[0].tess.time.y(0);
    const last = live[live.length - 1];
    s = [leftAt(live[0], y), leftAt(last, y) + laneAt(last, y).w];
  } else {
    s = [Infinity, -Infinity];
    for (const b of v.strands) {
      const l = leftAt(b, b.tipY);
      s = [Math.min(s[0], l), Math.max(s[1], l + laneAt(b, b.tipY).w)];
    }
  }
  extentCache.set(v, { ver, s });
  return s;
}

/** Clade v's species alive now, in tree order (left to right). Kept per clade. */
const livingCache = new WeakMap<FanNode, FanBranch[]>();
export function livingOf(v: FanNode): FanBranch[] {
  let out = livingCache.get(v);
  if (!out) livingCache.set(v, (out = v.strands.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0)));
  return out;
}

/** Clade v's column nearest world x at "now" (ToLaD#262): a living one, found by halving (they stand in order); else any. */
function columnNear(v: FanNode, x: number): FanBranch {
  const live = livingOf(v);
  if (!live.length) return v.strands.reduce((p, q) => (Math.abs(stripMid(q) - x) < Math.abs(stripMid(p) - x) ? q : p));
  let lo = 0;
  let hi = live.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (stripMid(live[m]) < x) lo = m + 1;
    else hi = m;
  }
  return lo > 0 && Math.abs(stripMid(live[lo - 1]) - x) < Math.abs(stripMid(live[lo]) - x) ? live[lo - 1] : live[lo];
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

/**
 * A level's species' name (ToLaD#297): a fossil known only by its Latin binomial with its genus abbreviated, as the
 * paleontologists write it ("A. afarensis", "H. erectus"), so the hominins' pills fit beside their narrow columns.
 */
export function levelText(b: FanBranch): string {
  // (Its name a binomial with its Latin's epithet: the tree's Latin may file it in another genus, "Ardipithecus ramidus"
  // under Australopithecus.)
  const t = b.sp.common;
  const m = b.sp.extinct ? /^([A-Z])[a-z]+ ([a-z-]+)$/.exec(t) : null;
  // (Ardipithecus as "Ar.", the australopiths' "A." being taken.)
  return m && b.sp.sci.endsWith(` ${m[2]}`) ? `${t.startsWith('Ardipithecus ') ? 'Ar' : m[1]}. ${m[2]}` : t;
}

/** A family's label stands on "now" over its species (its bracket under it) while its span on screen is under this many screens. */
const FAMILY_MAX_SCREENS = 1.6;

/**
 * The species' and lineages' label spots. `top` is the labels' top line
 * (under the buttons); `barX0` the buttons' left edge: left of it a label on
 * "now" may reach higher, up to LABEL_CEIL.
 */
/** labelSpots' working arrays (the columns near the screen, their buckets), kept from layout to layout. */
const SCRATCH = {
  cols: [] as ColBox[],
  cx: new Float64Array(0),
  ck: new Int32Array(0),
  cs: new Int32Array(0),
  cw: new Float64Array(0),
  wide: new Int32Array(0),
  cand: new Float64Array(0),
  nbStart: new Int32Array(65),
  nbucket: new Int32Array(1024),
  bStart: new Int32Array(65),
  bFill: new Int32Array(64),
  bucket: new Int32Array(1024),
  seen: new Int32Array(1024),
};
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
  level?: LabelGroups,
  names: NameMode = 'beside',
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
  // (?fit=fossils, ToLaD#298: a level framed on its fossils has "now" above the screen; a living group's picture stands
  // under the top line then (groupPics), its name under that, and the level's names show.)
  const fossils = !!level && wantFitFossils();
  const standS = fossils ? Math.max(nowS, top + NOW_ROOM) : nowS;
  const levelOn = fossils ? 1 : nowOn;

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
  const fold0 = fan.tess.fold;
  const near = (q: ColBox) => !(q.x1 < vx0 || q.x0 > vx1 || q.y1 <= vy0 || q.y0 > vy1);
  // (Into arrays kept from layout to layout: no garbage a layout, ToLaD#255.)
  const cols = SCRATCH.cols;
  cols.length = 0;
  for (const q of boxes.values()) if (near(q)) cols.push(q);
  // ...and those in the strip's own few px across: the columns bucketed by their world x span (cols' order in each).
  const NB = 64;
  const bw = Math.max(1e-12, (vx1 - vx0) / NB);
  const nc = cols.length;
  // (Each column's box and first and last bucket, in flat arrays: clearance scans them, ToLaD#255.)
  if (SCRATCH.cx.length < 4 * nc) {
    SCRATCH.cx = new Float64Array(8 * nc);
    SCRATCH.ck = new Int32Array(4 * nc);
    SCRATCH.cs = new Int32Array(2 * nc);
    SCRATCH.cw = new Float64Array(2 * nc);
    SCRATCH.wide = new Int32Array(2 * nc);
    SCRATCH.cand = new Float64Array(2 * nc);
  }
  const { cx, ck, cs, cw, wide } = SCRATCH;
  // (A column across more than WIDE_NB buckets (leaning across the view) is scanned for every strip; the rest are
  // found in the strip's buckets, nb*.)
  const WIDE_NB = 8;
  let nw = 0;
  const nbStart = SCRATCH.nbStart;
  nbStart.fill(0);
  for (let i = 0; i < nc; i++) {
    const q = cols[i];
    cx[4 * i] = q.x0;
    cx[4 * i + 1] = q.x1;
    cx[4 * i + 2] = q.y0;
    cx[4 * i + 3] = q.y1;
    const a = Math.max(0, Math.floor((q.x0 - vx0) / bw));
    const z = Math.min(NB - 1, Math.floor((q.x1 - vx0) / bw));
    ck[2 * i] = a;
    ck[2 * i + 1] = z;
    const o = q.own;
    const node = isNode(o);
    cs[i] = node ? o.strands[0].index : o.index;
    cw[i] = node ? o.width : 0;
    if (z - a >= WIDE_NB) wide[nw++] = i;
    else for (let k = a; k <= z; k++) nbStart[k + 1]++;
  }
  for (let k = 0; k < NB; k++) nbStart[k + 1] += nbStart[k];
  if (SCRATCH.nbucket.length < nbStart[NB]) SCRATCH.nbucket = new Int32Array(2 * nbStart[NB]);
  const nbucket = SCRATCH.nbucket;
  {
    const fill = SCRATCH.bFill;
    fill.set(nbStart.subarray(0, NB));
    for (let i = 0; i < nc; i++) if (ck[2 * i + 1] - ck[2 * i] < WIDE_NB) for (let k = ck[2 * i]; k <= ck[2 * i + 1]; k++) nbucket[fill[k]++] = i;
  }
  // (Bucket k's columns: bucket[bStart[k] .. bStart[k + 1]), in cols' order; built when first asked for, by nextEdge.)
  const bStart = SCRATCH.bStart;
  let bucket = SCRATCH.bucket;
  let bucketed = false;
  const buckets = () => {
    bucketed = true;
    bStart.fill(0);
    for (let i = 0; i < nc; i++) for (let k = ck[2 * i]; k <= ck[2 * i + 1]; k++) bStart[k + 1]++;
    for (let k = 0; k < NB; k++) bStart[k + 1] += bStart[k];
    if (SCRATCH.bucket.length < bStart[NB]) SCRATCH.bucket = new Int32Array(2 * bStart[NB]);
    bucket = SCRATCH.bucket;
    const bFill = SCRATCH.bFill;
    bFill.set(bStart.subarray(0, NB));
    for (let i = 0; i < nc; i++) for (let k = ck[2 * i]; k <= ck[2 * i + 1]; k++) bucket[bFill[k]++] = i;
  };
  if (SCRATCH.seen.length < nc) SCRATCH.seen = new Int32Array(2 * nc);
  const seen = SCRATCH.seen;
  seen.fill(0, 0, nc);
  // (At the mammal level, on the fold's grid: the columns' reach per band of its rows, for clearance.)
  const bands = fold0 && fold0.gridH > 0 && fold0.ordShare.length > 0 ? bandBoxes(fan, vy0, vy1) : null;
  let stamp = 0;
  /** Column q's reach (world [lo, hi]) over bands j0..j1 (bandBoxes'), into `reach`. */
  const reach = new Float64Array(2);
  const bandReach = (ci: number, j0: number, j1: number) => {
    const i0 = cs[ci];
    const S = bands!.w.length;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      if (bands!.L[j * S + i0] < lo) lo = bands!.L[j * S + i0];
      if (bands!.R[j * S + i0] > hi) hi = bands!.R[j * S + i0];
    }
    const pad = 1e-6 * Math.max(1, Math.abs(lo), Math.abs(hi)) + bands!.w[i0];
    reach[0] = lo - pad;
    reach[1] = hi + pad + cw[ci];
  };
  /**
   * Least gap (px, up to CLEAR) between the strip [xa, xb] × [ya, yb] and any column but `own`'s (negative: they overlap).
   * The columns in the order the buckets give them (the first bucket of the strip's each is in, then cols' order),
   * the first that makes it -1 or less ending it (ToLaD#255: found by a scan of the flat boxes, not the buckets).
   */
  const clearance = (xa: number, xb: number, ya: number, yb: number, own: FanBranch | FanNode) => {
    let gap = CLEAR;
    if (!(yb > ya)) return gap;
    const [wxa, wya] = c.toWorld(xa - CLEAR, ya);
    const [wxb, wyb] = c.toWorld(xb + CLEAR, yb);
    // (The bands of the fold's rows from the one at or above wya to the one at or below wyb: -1 for none.)
    let bj0 = -1;
    let bj1 = -1;
    if (bands) {
      const qa = Math.floor(wya / bands.h);
      const qb = Math.ceil(wyb / bands.h);
      if (qa >= bands.kA && qb <= bands.kB) {
        bj0 = Math.floor((qa - bands.kA) / BAND_ROWS);
        bj1 = Math.min(bands.nb - 1, Math.max(bj0, Math.ceil((qb - bands.kA) / BAND_ROWS) - 1));
      }
    }
    const k0 = Math.max(0, Math.min(NB - 1, Math.floor((wxa - vx0) / bw)));
    const k1 = Math.max(0, Math.min(NB - 1, Math.floor((wxb - vx0) / bw)));
    // The columns that can come near it (in a bucket of its, their box and their reach over its bands meeting it),
    // each keyed by the first of its buckets it is in, then its place in cols (as a walk through the buckets meets them).
    const cand = SCRATCH.cand;
    let n = 0;
    stamp++;
    const test = (i: number) => {
      if (cx[4 * i + 1] < wxa || cx[4 * i] > wxb || cx[4 * i + 3] <= wya || cx[4 * i + 2] > wyb) return;
      const first = Math.max(ck[2 * i], k0);
      if (first > Math.min(ck[2 * i + 1], k1)) return;
      if (cols[i].own === own) return;
      if (bj0 >= 0) {
        bandReach(i, bj0, bj1);
        if (reach[1] < wxa || reach[0] > wxb) return;
      }
      cand[n++] = first * 1048576 + i;
    };
    for (let k = k0; k <= k1; k++)
      for (let m = nbStart[k], mEnd = nbStart[k + 1]; m < mEnd; m++) {
        const i = nbucket[m];
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        test(i);
      }
    for (let m = 0; m < nw; m++) test(wide[m]);
    const cs1 = cand.subarray(0, n).sort();
    for (let m = 0; m < n; m++) {
      const ci = cs1[m] % 1048576;
      const q = cols[ci];
      // (Nowhere nearer than the gap found so far: none of its edges can make it less.)
      if (Math.max(X(q.x0) - xb, xa - X(q.x1)) >= gap) continue;
      if (bj0 >= 0) {
        bandReach(ci, bj0, bj1);
        if (Math.max(X(reach[0]) - xb, xa - X(reach[1])) >= gap) continue;
      }
      // (heights()'s, without the array: the least over them.)
      const wa = Math.max(wya, q.y0);
      const wb = Math.min(wyb, q.y1 - 1e-9);
      // (Which side of the strip it is on at each height, wa then the grid up to wb: an edge that lies nearly flat
      // (a peel across the screen, MDD's Chinese mountain cat at the Felis polytomy, ToLaD#293) can cross the strip
      // between two heights, on neither, and is then through it.)
      let side = 0;
      let sideB = 0;
      for (let j = -3, y = Math.ceil(wa / grid) * grid; j < 0 || y < wb; j < 0 ? j++ : (y += grid)) {
        const wy = j === -3 ? wa : j === -2 ? wb : j === -1 ? q.lean : y;
        if (j === -1 && !(wy > wa && wy < wb)) continue;
        const e = q.at(wy);
        const ea = X(e[0]);
        const eb = X(e[1]);
        gap = Math.min(gap, Math.max(ea - xb, xa - eb));
        const sd = eb < xa ? -1 : ea > xb ? 1 : 0;
        if (j === -2) sideB = sd;
        else if (j !== -1) {
          if (side * sd < 0) gap = Math.min(gap, -(xb - xa) / 2);
          side = sd;
        }
      }
      if (side * sideB < 0) gap = Math.min(gap, -(xb - xa) / 2);
      // Hidden from here on whatever else is near.
      if (gap <= -1) return gap;
    }
    return gap;
  };
  const clearFit = (gap: number) => clamp01((gap + 1) / 6);

  /** The spots beside a column on screen from y0 down (its own edge from `edge`, its bottom at screen yBot). */
  const beside = (id: string, text: string, rank: Rank, len: number, own: FanBranch | FanNode, yTop: number, yBot: number, fit0: number, ref: { b?: FanBranch; v?: FanNode }, loose = false): LabelSpot[] => {
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
    // (Faded out whatever its edges (its part on screen too short, or the legend): its spots, none shown, with no edges read, ToLaD#255.)
    const f = fit0 * clamp01((yBot - y0 - 12) / 24) * botFit(y1);
    if (!(f > 0)) return (['in', 'right', 'left'] as const).map((place) => ({ key: `${id}:${place}`, id, place, ...ref, text, rank, x: 0, y1, box: [-half, y0, half, y1], fit: 0 }));
    const ob = boxes.get(own)!;
    for (const wy of heights(wTop, wBot, [ob.lean])) {
      const [a, b] = ob.at(wy);
      l = Math.min(l, X(a));
      r = Math.max(r, X(b));
      il = Math.max(il, X(a));
      ir = Math.min(ir, X(b));
    }
    if (!(r >= l)) return [];
    // Fades: the column's part on screen too short to stand beside, and the legend (f, above).
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
      // (A level's group's name, ToLaD#262, `loose`: failing a clear spot, over the columns beside its own, opaque; clear of the axis and the other names.)
      if (loose) out.push({ key: `${id}:${place}~`, id, place, loose: true, ...ref, text, rank, x, y1, box: [xa, y0, xb, y1], fit: f > 0 && xa < c.w && xb > 0 ? f * clearFit(xa - LABEL_AXIS_X) : 0 });
    }
    return out;
  };

  /** Screen x of clade (or strand) u's left (or right) edge among its columns at world y wy, null where none spans it. */
  const edgeAt = (u: FanNode | FanBranch, wy: number, right: boolean): number | null => {
    const q = boxes.get(u);
    if (q && wy >= q.y0 && wy <= q.y1) return X(q.at(wy)[right ? 1 : 0]);
    if (isNode(u) && wy < u.y)
      for (let k = 0; k < u.kids.length; k++) {
        const e = edgeAt(u.kids[right ? u.kids.length - 1 - k : k], wy, right);
        if (e !== null) return e;
      }
    return null;
  };
  /** The nearest column edge (screen x) past x at world y wy, rightwards (a left edge) or leftwards (a right edge); null for none near. */
  const nextEdge = (x: number, wy: number, right: boolean): number | null => {
    if (!bucketed) buckets();
    let best: number | null = null;
    const k0 = Math.max(0, Math.min(NB - 1, Math.floor((c.toWorld(x, 0)[0] - vx0) / bw)));
    stamp++;
    for (let k = k0; k >= 0 && k < NB; k += right ? 1 : -1) {
      // (Past the best found so far: done.)
      const kx = X(vx0 + (right ? k : k + 1) * bw);
      if (best !== null && (right ? kx > best : kx < best)) break;
      for (let n = bStart[k], nEnd = bStart[k + 1]; n < nEnd; n++) {
        const qi = bucket[n];
        if (seen[qi] === stamp) continue;
        seen[qi] = stamp;
        const q = cols[qi];
        if (!(wy >= q.y0 && wy <= q.y1)) continue;
        const e = q.at(wy);
        const ex = X(e[right ? 0 : 1]);
        if (right ? ex > x + 0.5 && (best === null || ex < best) : ex < x - 0.5 && (best === null || ex > best)) best = ex;
      }
    }
    return best;
  };
  /**
   * A level's group's name along its branch (ToLaD#266, `mid`) or between it and its neighbour (`gap`): centred
   * halfway between "now" (or its tip, wTop) and where it splits off (wBot), over the part of that on screen.
   */
  const along = (id: string, text: string, rank: Rank, len: number, own: FanNode | FanBranch, wTop: number, wBot: number, fit0: number, ref: { b?: FanBranch; v?: FanNode }): LabelSpot[] => {
    const a = Math.max(top, Y(wTop));
    const z = Math.min(bottom, Y(wBot));
    if (!(fit0 > 0) || !(z > a)) return [];
    const y0 = Math.max(top, (a + z) / 2 - len / 2);
    const y1 = y0 + len;
    const wy = c.toWorld(0, (y0 + y1) / 2)[1];
    const L = edgeAt(own, wy, false);
    const R = edgeAt(own, wy, true);
    if (L === null || R === null || R < 0 || L > c.w) return [];
    // (Its part on screen too short to hold a name: faded out; the legend at the bottom too.)
    const f = fit0 * botFit(y1) * clamp01((z - a - 12) / 24);
    const spot = (key: string, place: LabelSpot['place'], x: number, loose: boolean): LabelSpot => {
      const box: [number, number, number, number] = [x - half, y0, x + half, y1];
      // (Whole on screen; in a gap with LABEL_GAP px either side, clear: its full ink.)
      const onX = x - half >= 0 && x + half <= c.w + 0.5;
      const fit = f > 0 && onX ? f * clearFit(Math.min(x - half - LABEL_AXIS_X, loose ? CLEAR : clearance(x - half, x + half, y0, y1, own) + 2)) : 0;
      return { key: `${id}:${key}`, id, place, ...ref, text, rank, x, y1, box, fit, loose: loose || undefined };
    };
    if (names === 'mid') {
      // On its branch, opaque (over its own columns), its middle on screen right of the axis.
      const lo = Math.max(L, LABEL_AXIS_X + half + 4);
      const hi = Math.min(R, c.w) - half;
      const x = lo <= hi ? (lo + hi) / 2 : Math.min(Math.max((L + R) / 2, LABEL_AXIS_X + half + 4), c.w - half);
      return [spot('mid', 'in', x, true)];
    }
    // In the gap to its right, else to its left (with no neighbour there, just beside the branch); clear of the
    // columns, else over them.
    const nr = nextEdge(R, wy, true);
    const nl = nextEdge(L, wy, false);
    const xr = nr !== null && nr - R >= LABEL_PILL + 2 * LABEL_GAP ? (R + nr) / 2 : R + LABEL_GAP + half;
    const xl = nl !== null && L - nl >= LABEL_PILL + 2 * LABEL_GAP ? (L + nl) / 2 : L - LABEL_GAP - half;
    const xr2 = nr !== null ? (R + nr) / 2 : xr;
    const xl2 = nl !== null ? (L + nl) / 2 : xl;
    return [spot('gapR', 'right', xr, false), spot('gapL', 'left', xl, false), spot('gapR~', 'right', xr2, true), spot('gapL~', 'left', xl2, true)];
  };

  const out: LabelSpot[] = [];
  // The families (ToLaD#146), first of all: standing on "now" over their species while "now" is on screen, the
  // span they name bracketed under the pill; at its left end, else its middle, else its right end (whichever
  // meets no other label: the left end clears the middle of a family's one big column). The same name (`n<i>`)
  // as its lineage's label beside its parent column, so once "now" is off screen the one becomes the other.
  // (With the clades' brackets, ToLaD#193, a family is named on its bracket where that has room, else here, over the stack.)
  // (Given the level's groups, ToLaD#258: each group one level down, named whether or not its bracket is, with its picture.)
  for (const { v, vi, text } of level?.groups ?? families(fan)) {
    // (The mammal level, lod.ts: a family inside a clade drawn as one branch is not named; the clade is.)
    if ((!level && brk?.named(v)) || lod?.hidden(v)) continue;
    if (level) {
      // A level's group (ToLaD#262): its name beside its branch, down from "now" (its picture stands over "now",
      // groupPics): beside the column nearest its centre, room at the name's end for the "+x" of the groups hidden.
      if (!(levelOn > 0)) continue;
      const [wa, wb] = groupExtent(v);
      const cx = (wa + wb) / 2;
      if (!(X(wb) > 0 && X(wa) < c.w)) continue;
      // (A living column, where it has one: on "now", under its picture.)
      const own = columnNear(v, cx);
      const px = plus?.(`n${vi}`) ?? 0;
      const rank: Rank = [-1, wb - wa, vi];
      // (Or along its branch, or between it and its neighbour, ToLaD#266: halfway down to where it splits off.)
      if (names !== 'beside') {
        for (const p of along(`n${vi}`, text, rank, measure(text) + 2 * LABEL_PAD + px, v, nowY, v.yBot, nowOn, { v })) out.push({ ...p, fam: v, pic: groupFace(v), plus: px });
        continue;
      }
      for (const p of beside(`n${vi}`, text, rank, measure(text) + 2 * LABEL_PAD + px, own, Math.max(standS, Y(own.tipY)) + 4, Y(own.splitY), levelOn, { v }, true))
        out.push({ ...p, fam: v, pic: groupFace(v), plus: px });
      continue;
    }
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
    // (A level's groups, ToLaD#258: the middle first, so a wide group leaves its ends to the narrow ones beside it.)
    const xs = lo <= hi - LABEL_PILL ? (level ? [(lo + hi) / 2, lo, hi] : [lo, (lo + hi) / 2, hi]) : [Math.min(Math.max((sa + sb) / 2, LABEL_AXIS_X + half), c.w - half)];
    xs.forEach((x, k) => {
      out.push({ key: `n${vi}:fam${k}`, id: `n${vi}`, place: 'fam', v, fam: v, pic: level ? groupFace(v) : commonest(v), text, rank: [-1, wb - wa, vi], x, y1, box: [x - half, y1 - len, x + half, y1], fit, span: brk ? undefined : [sa, sb], plus: px });
    });
  }
  for (const b of fan.branches) {
    // (Given the level's groups, ToLaD#258: only a species that is a group of its own.)
    if ((lod && lod.of[b.index] >= 0) || (level && !level.species.has(b)) || !near(boxes.get(b)!)) continue;
    const id = String(b.sp.gid);
    if (level) {
      // (A level's species, ToLaD#262: its name beside its column, down from "now" or its tip; its picture over "now".)
      const px = plus?.(id) ?? 0;
      const text = levelText(b);
      const len = measure(text) + 2 * LABEL_PAD + px;
      if (names !== 'beside') {
        out.push(...along(id, text, [0, b.width, b.index], len, b, Math.max(nowY, b.tipY), b.splitY, 1, { b }).map((p) => ({ ...p, plus: px })));
        continue;
      }
      const y0 = Math.max(standS, Y(b.tipY)) + 4;
      // (A neighbouring level's species after the level's own, ToLaD#297.)
      const mine = !level.own || level.own.has(b);
      const rank: Rank = [mine ? 0 : 0.25, b.width, b.index];
      // (The fossils' frame, its own species: more places to try, ToLaD#297; a neighbour's name stays by its column.)
      const more = fossils && mine;
      const sp = beside(id, text, rank, len, b, y0, Y(b.splitY), 1, { b }, true).map((p) => ({ ...p, plus: px }));
      // (ToLaD#297: or further down its column, a name's length at a time, where a neighbour's name stands at its tip.)
      if (more) for (let k = 1; k <= 2; k++) for (const p of beside(id, text, rank, len, b, y0 + k * (len + LABEL_GAP), Y(b.splitY), 1, { b }, true)) sp.push({ ...p, key: `${p.key}+${k}`, plus: px });
      // (A fossil's, ToLaD#297: failing room beside its column, over its picture on its tip, as the clear spots go.
      // An old one near the screen's foot has no room below its tip; over it, the air the younger ones left.)
      const ty = Y(b.tipY);
      if (b.tipY > nowY && ty > top && ty < c.h) {
        const x = X(stripMid(b));
        const y1 = ty - PIC_LIFT - PIC_D - LABEL_GAP;
        const ya = y1 - len;
        const xa = x - half;
        const xb = x + half;
        // (Faded in over 24 px under the top line and 12 px in from the screen's sides, not cut: a pinch's frames keep it, ToLaD#311.)
        const onFit = (xa: number, ya: number, xb: number, y1: number) => botFit(y1) * clamp01((ya - top) / 24) * clamp01(xa / 12) * clamp01((c.w - xb) / 12);
        const f0 = onFit(xa, ya, xb, y1);
        const fit = f0 > 0 ? f0 * clearFit(Math.min(xa - LABEL_AXIS_X, clearance(xa, xb, ya, y1, b))) : 0;
        const o = { id, place: 'over' as const, b, text, rank, x, y1, plus: px };
        sp.push({ ...o, key: `${id}:over`, box: [xa, ya, xb, y1], fit });
        // (Failing a clear one, over the columns there, opaque: clear of the axis and the other names. Under fossils'
        // frame, crowded, beside its picture, or further up, a name's length at a time.)
        const loose = (key: string, x: number, y1: number) => {
          const [xa, ya, xb] = [x - half, y1 - len, x + half];
          sp.push({ ...o, key: `${id}:${key}`, x, y1, box: [xa, ya, xb, y1], loose: true, fit: onFit(xa, ya, xb, y1) * clearFit(xa - LABEL_AXIS_X) });
        };
        loose('over~', x, y1);
        if (more) {
          const side = PIC_D / 2 + LABEL_GAP + half;
          loose('over~r', x + side, ty - 2);
          loose('over~l', x - side, ty - 2);
          for (let k = 1; k <= 2; k++) loose(`over~${k}`, x, y1 - k * (len + LABEL_GAP));
        }
      }
      out.push(...sp);
      continue;
    }
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
  // (At a level, ToLaD#312: a column inside one of its groups is named as the group, one pill for all of them, a tap
  // flying to it; the level's own unnamed columns between its groups carry no name of their own ("Human ancestors" on
  // each split of the humans' line, "Homo floresiensis lineage" on the erectus' column): its groups name them.)
  const groupIn = new Map<FanNode, { v: FanNode; vi: number; text: string }>();
  for (const g of level?.groups ?? []) groupIn.set(g.v, g);
  if (nowOn < 1) {
    for (let vi = 0; vi < fan.nodes.length; vi++) {
      const v = fan.nodes[vi];
      if (!v.parent || lod?.hidden(v) || !near(boxes.get(v)!)) continue;
      let g: { v: FanNode; vi: number; text: string } | undefined;
      let inLevel = false;
      if (level)
        for (let u: FanNode | null = v; u && !g; u = u.parent) {
          g = groupIn.get(u);
          if (u === level.at) inLevel = true;
          if (inLevel) break;
        }
      if (g) {
        const id = `n${g.vi}`;
        const px = plus?.(id) ?? 0;
        const rank: Rank = [1, v.width, vi];
        for (const p of beside(id, g.text, rank, measure(g.text) + 2 * LABEL_PAD + px, v, Y(v.y), Y(v.yBot), 1 - nowOn, { v: g.v })) out.push({ ...p, key: `${p.key}.${vi}`, fam: g.v, pic: groupFace(g.v), plus: px });
        continue;
      }
      if (inLevel && !v.split.taxon) continue;
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
export function resolveLabels(spots: LabelSpot[], prev: Map<string, boolean> | ((key: string) => boolean)): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const taken: number[][] = [];
  const done = new Set<string>();
  // (The order kept per layout: carried frames, ToLaD#255, resolve the same spots again.)
  let order = orderCache.get(spots);
  if (!order || order.length !== spots.length) {
    const placeOrder = { fam: 0, tip: 0, in: 1, right: 2, left: 3, over: 4 };
    order = [...spots].sort((p, q) => p.rank[0] - q.rank[0] || q.rank[1] - p.rank[1] || p.rank[2] - q.rank[2] || +!!p.loose - +!!q.loose || placeOrder[p.place] - placeOrder[q.place]);
    orderCache.set(spots, order);
  }
  const was = typeof prev === 'function' ? prev : (key: string) => !!prev.get(key);
  for (const s of spots) out.set(s.key, false);
  // The spots shown last frame first (each keeps its place while it fits and meets no other), then the rest.
  for (const pass of [true, false]) {
    for (const s of order) {
      if (done.has(s.id) || was(s.key) !== pass) continue;
      if (!(s.fit > (pass ? 0 : 0.6))) continue;
      if (taken.some((q) => boxGap(s.box, q) < (pass ? -1 : 5))) continue;
      out.set(s.key, true);
      done.add(s.id);
      taken.push(s.box);
    }
  }
  return out;
}

const orderCache = new WeakMap<LabelSpot[], LabelSpot[]>();

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

/**
 * A column's lane points on screen, bottom up (lanePoints, drawMerged): x the spine's left edge (px), y (px), w the
 * lanes' width (world), f the green's share of it. Flat and pooled, written afresh by each column: no objects a
 * point (a frame at the mammal level samples ~1M, ToLaD#255). Read only until the next column is written.
 */
class LanePts {
  x = new Float64Array(256);
  y = new Float64Array(256);
  w = new Float64Array(256);
  f = new Float64Array(256);
  n = 0;
  push(x: number, y: number, w: number, f: number): void {
    if (this.n === this.x.length) {
      const grow = (a: Float64Array) => {
        const b = new Float64Array(2 * a.length);
        b.set(a);
        return b;
      };
      this.x = grow(this.x);
      this.y = grow(this.y);
      this.w = grow(this.w);
      this.f = grow(this.f);
    }
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.w[i] = w;
    this.f[i] = f;
  }
  /** Points i0..i1 (inclusive) copied out (the 2D path's held runs, kept past the next column). */
  slice(i0: number, i1: number): LanePts {
    const r = new LanePts();
    for (let i = i0; i <= i1; i++) r.push(this.x[i], this.y[i], this.w[i], this.f[i]);
    return r;
  }
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
  private heldRuns: { run: LanePts; hw: number; d: number }[] = [];
  /** The lane points (lanePoints, drawMerged), pooled. */
  private lanePts = new LanePts();
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
  /** The family pills drawn (ToLaD#212): a tap flies to the family, as its bracket's. */
  famHits: { box: [number, number, number, number]; v: FanNode }[] = [];
  /** The chips with a "+x" drawn (ToLaD#197, #262): `box` the whole chip (a tap on its name or its badge alike, ToLaD#287), `badge` the badge's end. */
  plusHits: { box: [number, number, number, number]; badge: [number, number, number, number]; bs: FanBranch[] }[] = [];
  private models = new Map<string, TwigModel>();
  private raf = 0;
  private anim: ((t: number) => boolean) | null = null;
  private ro: ResizeObserver;
  /** The WebGL2 layer under the canvas: lanes and the individuals mesh (null: Canvas 2D only). */
  readonly gl: FanGL | null = null;
  /** The world on the time axis (world.ts): its layers on or off, and the axis labels it keeps clear of. */
  world = worldFlags(typeof location !== 'undefined' ? location.search : '');
  /** Where a level's group names stand (ToLaD#266): ?names=, switched in the globe menu. */
  names: NameMode = wantNames();
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
    return this.withBand(this.camera.home(), this.fan.root);
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
    // (The stack at the level the view is at, ToLaD#288: its groups, it and the familiar levels up, "…" over three rows.)
    br.layout(this.camera, this.fan, nowS, LABEL_AXIS_X, fit, measure, top, stackAt(this.fan, levelClade(this.fan, this.levelNow())));
    // The groups the view is inside, pinned under the buttons as the stack scrolls off (ToLaD#233): the familiar levels.
    br.pin(top, this.camera.toWorld(0, 0)[1], measure, br.fit < 1 ? (this.centreLine()?.node ?? null) : null, (v) => isLevel(this.fan, v) && familiar(v));
    return br;
  }

  /** The branch whose column at screen (px, py) is nearest it (ToLaD#233: the lineage the view is in), null for none there. */
  private lineAt(px: number, py: number): FanBranch | null {
    const [wx, wy] = this.toWorld(px, py);
    if (wy > this.fan.trunkBottom.y) return null;
    // (Folded: a search on the strands in order, not every species a frame, ToLaD#255.)
    const near = nearestStrand(this.fan, wx, wy);
    if (near !== undefined) return near;
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

  /**
   * A level's frame spans the clade's life (ToLaD#288): "now" under the brackets' stack this frame lays out with
   * room for the level's pictures under it (nowUnder, ToLaD#274); its start (the fork
   * camera.frame puts FRAME_BOTTOM px up from the screen's foot) down at FORK_PX from the foot, over the scale bar.
   * Only the time is moved: the width (and with it the stack) stays as framed. `top`: the world y put where "now"
   * would stand, "now" itself by default (?fit=fossils, ToLaD#298: a level framed on its fossils, its youngest fossil's end, fossilTop).
   */
  private withBand(cam: Camera, lv: FanNode | null = null, top = this.yNow): Camera {
    const sn = this.h / 2 + (this.yNow - cam.cy) * cam.sy;
    const yFork = cam.cy + (this.h - FRAME_BOTTOM - this.h / 2) / cam.sy;
    const nowS = this.brackets ? Math.max(this.nowUnder(cam, lv), this.labelTop() + NOW_ROOM) : sn;
    const sy = Math.max(1e-300, this.h - FORK_PX - nowS) / Math.max(1e-300, yFork - top);
    return { ...cam, sy, ty: sy, cy: top + (this.h / 2 - nowS) / sy };
  }

  /**
   * The highest screen y "now" may stand at in camera `cam` (ToLaD#274): under the labels' top line, the brackets'
   * whole stack as that frame lays it out (its rows at that zoom, the fold as it stands), and NOW_ROOM for the
   * level's pictures standing on "now".
   */
  private nowUnder(cam: Camera, lv: FanNode | null = null): number {
    const br = this.probeBr;
    if (!br) return 0;
    const at = lv ?? this.fan.root;
    // (Kept per zoom (a sixteenth of a doubling), centre (8 px) and level: a folded frame's bisection asks ~40 times, ToLaD#255.)
    const key = `${this.w}x${this.h}:${Math.round(Math.log2(cam.sx) * 16)}:${Math.round((cam.cx * cam.sx) / 8)}:${nodeId(at)}`;
    if (this.nowUnderFan !== this.fan || this.nowUnderAt.size > 2000) [this.nowUnderFan, this.nowUnderAt] = [this.fan, new Map()];
    const hit = this.nowUnderAt.get(key);
    if (hit !== undefined) return hit;
    const f = this.fan.tess.fold;
    let hide: ((v: FanNode) => boolean) | null = null;
    if (f?.ordShare.length) {
      if (this.probeLod?.fan !== this.fan) this.probeLod = new Lod(this.fan);
      const lod = this.probeLod;
      lod.update(f, cam.sx);
      hide = (v) => lod.hidden(v);
    }
    br.hide = hide;
    br.hideKey = hide ? `p${cam.sx}` : '';
    const hw = this.w / 2;
    const hh = this.h / 2;
    const c = { w: this.w, cam, toScreen: (x: number, y: number): [number, number] => [(x - cam.cx) * cam.sx + hw, (y - cam.cy) * cam.sy + hh] };
    const top = this.labelTop();
    const measure = (font: string, t: string) => {
      this.ctx.save();
      this.ctx.font = font;
      const w = this.ctx.measureText(t).width;
      this.ctx.restore();
      return w;
    };
    const placed = br.layout(c, this.fan, this.h, LABEL_AXIS_X, 1, measure, top, stackAt(this.fan, at));
    let rows = br.moreRow + 1;
    for (const p of placed) rows = Math.max(rows, p.row + 1);
    const y = top + (rows ? br.rowTop(rows - 1) : 0) + NOW_ROOM;
    this.nowUnderAt.set(key, y);
    return y;
  }
  private nowUnderFan: Fan | null = null;
  private nowUnderAt = new Map<string, number>();
  /** A stack and a level of detail of their own for nowUnder's frames (the drawn ones keep theirs). */
  private readonly probeBr = this.brackets ? new Brackets(font('600 11px'), font('italic 400 11px', SERIF)) : null;
  private probeLod: Lod | null = null;

  /**
   * Where a tap on a clade's bracket lands (brackets.ts cladeCamera, ToLaD#193): the clade centred and opened,
   * "now" down to where its branch started. The whole fan for the root.
   */
  cladeCamera(v: FanNode): Camera {
    if (!v.parent) return this.homeCamera();
    // (A level of two or three groups, ToLaD#262: centred on its columns at "now" and kept to the screen's middle,
    // FEW_FILL of it, not spread to its edges; its whole span, its past's columns too, still on screen.)
    const few = nextLevels(this.fan, v).length;
    const span =
      few <= 3
        ? (u: FanNode): [number, number] => {
            const [a, b] = familySpan(u);
            const m = Math.min(Math.max(groupCentre({ v: u }), a), b);
            const h = Math.max(m - a, b - m, ((b - a) / 2) * (TAP_FILL / FEW_FILL[few]));
            return [m - h, m + h];
          }
        : familySpan;
    // (?fit=fossils, ToLaD#289: a level whose living columns dwarf its fossils framed on where the fossils lived.)
    const fit = wantFitFossils() ? (u: FanNode) => fossilSpan(this.fan, u) ?? span(u) : span;
    return cladeCamera(this.camera, this.fan, v, fit, (cam) => this.withBand(cam, v, fossilTop(this.fan, v) ?? this.yNow));
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

  /** One level out from clade v (ToLaD#230): the nearest ranked clade it sits in, the root last; null from the root. */
  outOf(v: FanNode): FanNode | null {
    return levelUp(this.fan, v);
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
    // (Across the screen: their columns at "now" (an extinct one's at its tip), where their names and pictures stand,
    // not their rooms, wider where they were wider in the past: the most room each name and picture can have, ToLaD#274.)
    return cladeCamera(this.camera, this.fan, { ...v, yBot: v.y }, () => groupSpan(bs, this.yNow, this.w), (cam) => this.withBand(cam, v));
  }

  flyToGroup(bs: readonly FanBranch[]): void {
    // (One species: a landing on it, its card open, ToLaD#266.)
    if (bs.length === 1) return this.flyToSpecies(bs[0].sp);
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    const to = this.flyTo(() => this.groupCamera(bs));
    // (A level's flight (ToLaD#301): the level its groups sit in, so a tap or double-tap mid-way goes on from there.)
    let v: FanNode | null = bs[0].node;
    while (v?.parent && !bs.every((b) => v!.strands.includes(b))) v = v.parent;
    this.backing = { lv: { v: levelUp(this.fan, v, true) ?? this.fan.root }, cam: to };
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
      const [a, b] = levelSpan(this.fan, v);
      // (The fold stays at the frame's zoom: the camera taking the frame finds it there, nothing to follow.)
      return { ...fr, sx, cx: (a + b) / 2 - 22 / sx };
    }
    if (this.fan.root.split.taxon === name) return this.homeCamera();
    const v = this.fan.nodes.find((n) => n.split.taxon === name);
    if (!v) return null;
    // The clade's span at the zoom that frames it (it opens as it is framed: foldedFrame, ToLaD#247).
    return foldedFrame(this.fan, this.w, () => {
      // (?fit=fossils, ToLaD#289: as a tap's frame, cladeCamera, a level whose living columns dwarf its fossils framed on them.)
      const [a, b] = levelSpan(this.fan, v);
      return this.withBand(this.camera.frame(a, b, v.y, true), v, fossilTop(this.fan, v) ?? this.yNow);
    });
  }

  /** Fly to a level (levelCamera), or home if the tree has no such split. */
  flyToLevel(name: string): void {
    this.flyTo(() => this.levelCamera(name) ?? this.homeCamera());
  }

  private withFold(fan: Fan): Fan {
    // (The steady layout, ToLaD#259: rooms fixed between each branch's own splits, steady.ts; at the cats' level every split open.)
    const f = new Steady(fan, !this.folds);
    f.setAll(0);
    fan.tess.fold = f;
    return fan;
  }

  private foldKey = '';
  /** The fold at this frame's zoom: its grid (about 3 px of screen between rows) and openness; the columns sampled anew if they moved. */
  private applyFold(): void {
    const f = this.fan.tess.fold;
    if (!f) return;
    // (The mammal level, ~5,900 strands a row: rows further apart, GRID_PX_ORDERS, ToLaD#247; twice that while the
    // fold moves (a pinch, a pan), each frame folding every row again, ToLaD#255.)
    const coarse = f.ordShare.length > 0 && this.foldMoving;
    f.setGrid(Math.pow(2, Math.round(Math.log2((f.ordShare.length ? GRID_PX_ORDERS * (coarse ? 2 : 1) : 3) / this.cam.sy))));
    f.setScale(this.cam.sx, this.w);
    const key = `${f.ver}:${f.gridH}`;
    if (key === this.foldKey) {
      // (A frame with the fold at rest after it moved: the columns' edges exact again, ColumnPath.exact; on the finer grid next frame.)
      if (this.foldMoving) for (const m of this.models.values()) m.foldRest();
      this.foldMoving = false;
      if (coarse) this.request();
      return;
    }
    this.foldKey = key;
    const moved = f.ver !== this.foldVer;
    this.foldVer = f.ver;
    for (const m of this.models.values()) m.refold();
    if (!moved && f.ordShare.length) {
      // (Only the grid changed (finer, at rest): the edges exact at once.)
      for (const m of this.models.values()) m.foldRest();
      return;
    }
    this.foldMoving = true;
    // (One frame more once it rests, FOLD_REST_MS on: the edges exact.)
    clearTimeout(this.foldRestT);
    this.foldRestT = setTimeout(() => this.request(), FOLD_REST_MS);
  }
  private foldMoving = false;
  private foldVer = -1;
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
   * ease, over a time by how far it goes (flightMs, 0.9–1.8 s, or `ms`). Laid out, the frame's world moves as the
   * splits open and close: the start and the frame are tracked through it (fold.ts follow) and the camera aims
   * between them each step, landing on the frame computed again there (so nothing snaps at the end). `done` runs when
   * it lands (not if a gesture takes over first). Returns the frame aimed at (computed now).
   */
  flyTo(aim: Camera | (() => Camera), ms?: number, done?: () => void): Camera {
    // (A level's flight, backing, is set again after this by what flies it: a tap, a double-tap, a search pick, ToLaD#258.)
    this.backing = null;
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
    const same = (p: FoldState, q: FoldState) => p.a.every((x, i) => x === q.a[i]);
    const live = !!fo && !!toSnap && !!fromSnap && same(toSnap, fromSnap);
    // (The frame's x where the fold stands now, for the path's length.)
    const tx0 = fo && toSnap && !live ? fo.follow(to.cx, to.cy, toSnap) : to.cx;
    // (The pan as it stands at the flight's widest (ToLaD#293): the gaps the zoom opened between the two ends close as it
    // zooms out, so a trip measured where it starts zoomed out far past both ends, and the far end raced in as they closed.)
    let dx = Math.abs(tx0 - from.cx);
    if (fo && toSnap && fromSnap) {
      const back = fo.keep();
      for (let i = 0; i < 2; i++) {
        const p = flightPath(this.w / from.sx, this.w / to.sx, dx);
        const wTop = Math.max(...Array.from({ length: 33 }, (_, k) => p.at(k / 32)[0]));
        if (!(wTop > 1.01 * Math.max(this.w / from.sx, this.w / to.sx))) break;
        fo.setScale(this.w / wTop, this.w);
        dx = Math.min(dx, Math.abs(fo.follow(tx0, to.cy, fromSnap) - fo.follow(from.cx, from.cy, fromSnap)));
      }
      back();
    }
    const px = flightPath(this.w / from.sx, this.w / to.sx, dx);
    const py = flightPath(this.h / from.sy, this.h / to.ty, Math.abs(to.cy - from.cy));
    const dur = ms ?? flightMs(Math.max(px.S, py.S));
    const ease = flightEase(Math.max(px.S, py.S), ms == null ? dur : Infinity);
    const t0 = performance.now();
    let x0 = from.cx;
    let x1 = tx0;
    let at = to;
    this.anim = (now) => {
      const u = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = ease(u);
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
    return to;
  }

  /**
   * Where a search pick lands (ToLaD#157): the species' column centred, its tip (now for the living,
   * the last appearance for a fossil) at a fifth of the way down so its label stands above it, and
   * its own stretch (tip to split) filling the band above the card. Width and time are framed apart
   * (#138): the column about half the screen wide, within the width limit.
   */
  speciesCamera(b: FanBranch): Camera {
    const h = this.homeCamera();
    // (Its tip under the stack its frame lays out at its level, room for its picture between, ToLaD#274, #288: a
    // provisional frame's; its own split down at FORK_PX from the foot: its whole life on screen.)
    const tipPx = Math.max(this.labelTop() + NOW_ROOM, this.nowUnder({ ...h, cx: b.cx, sx: Math.max(h.sx, (0.5 * this.w) / Math.max(1e-300, b.width)) }, levelUp(this.fan, b.node, true)));
    const band = Math.max(80, this.h - FORK_PX - tipPx);
    const sy = Math.max(h.sy, band / Math.max(1e-300, b.splitY - b.tipY));
    const cyAt = (s: number) => b.tipY + (this.h / 2 - tipPx) / s;
    const sx = Math.min(Math.max(h.sx, (0.5 * this.w) / Math.max(1e-300, b.width)), Math.max(h.sx, this.camera.sxCap(b.cx, b.tipY)));
    // Within the time limit (MIN_YEARS on screen) about the tip, where it will sit.
    const s = this.camera.timeCap(b.tipY, tipPx, sy, h.sy);
    // Laid out (steady.ts): its column where the layout has it at that zoom (brackets.ts foldedFrame, ToLaD#211: the
    // layout stays there for the camera taking it, so it lands centred).
    const f = this.fan.tess.fold;
    const cx = () => (f && f.left(b.index, b.tipY) !== null ? leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2 : b.cx);
    return foldedFrame(this.fan, this.w, () => ({ cx: cx(), cy: cyAt(s), sx, sy: s, ty: s }));
  }

  /**
   * A search pick or a tap landing on a species (ToLaD#266): fly to the species' column, then open its card at its tip,
   * as a tap there would. Without `card` (a double-tap stepping back to it, ToLaD#241): no card. The landing remembered (tapAt).
   */
  flyToSpecies(sp: SpeciesRec, card = true): void {
    const b = this.fan.branches.find((x) => x.sp === sp);
    if (!b) return;
    // The card open now closes for the flight (the column stays in view under it).
    this.selected = null;
    this.selInd = null;
    this.touch = null;
    this.onSelect(null);
    const to = this.flyTo(() => this.speciesCamera(b), undefined, () => {
      this.tapAt = { b, v: null, cam: { ...this.cam } };
      if (!card) {
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
    // (A level's flight: a double-tap mid-way goes up from the species, ToLaD#271.)
    this.backing = { lv: { b }, cam: to };
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
    // (A level's flight goes on under a touch until it pans or pinches (ToLaD#301): a tap or double-tap mid-flight goes
    // on from where it lands, not from where the touch stopped it. A fling or any other flight stops.)
    if (!this.backing) this.anim = null;
    this.panned = 0;
    this.gesturing = true;
  }
  /** How far (px) the touch under way has panned (ToLaD#301): a level's flight stops once it is a pan (TOUCH_SLOP). */
  private panned = 0;
  /** A level's flight stops under a pan or pinch: the view is the user's. */
  private stopFlight(): void {
    this.anim = null;
    this.backing = null;
  }
  gestureEnd(): void {
    this.gesturing = false;
    this.request();
  }
  pan(dx: number, dy: number): void {
    if (this.gesturing && this.anim && this.backing) {
      // (A tap's jitter leaves the flight be; a pan takes the view.)
      if ((this.panned += Math.abs(dx) + Math.abs(dy)) < TOUCH_SLOP) return;
      this.stopFlight();
    }
    if (dx || dy) this.tapAt = null;
    this.camera.pan(dx, dy);
    this.request();
  }
  zoom(px: number, py: number, fx: number, ft: number): void {
    if (fx !== 1 || ft !== 1) {
      this.tapAt = null;
      if (this.backing) this.stopFlight();
    }
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
   * A double-tap (ToLaD#258, #271): one level up, anywhere: from the level the view is at (levelNow; a level's flight
   * under way, from where it lands) to the level it sits in (levelUp), the tree a tap goes down, so the two mirror each
   * other. Not back the way it came: after a search pick, a "+x" or a pinch, the parent of where the view is. A level
   * whose frame is within LEVEL_PX of the view is passed (every double-tap visibly moves). At home, nothing. The card
   * closes for the flight. `firstRan` (ToLaD#301): its first tap already ran as a single tap (a level deeper, a "+x"),
   * so from the level the view was at before that tap, never from where that tap went: up, not back.
   */
  doubleTap(_x: number, _y: number, firstRan = false): void {
    const pre = firstRan && this.preTap && performance.now() - this.preTap.t < 4 * DOUBLE_TAP_MS ? this.preTap : null;
    const on = !pre && this.anim && this.backing;
    const from = pre ? pre.lv : on ? this.backing!.lv : this.levelNow(true);
    const step = this.upFrom(from, pre ? pre.cam : on ? this.backing!.cam : this.cam);
    if (step) this.goLevel(step.lv, step.cam, false);
    // (Home: nothing, so the first tap's flight is put back.)
    else if (pre && (this.anim || this.offBy(pre.cam, this.cam) > 0.5)) this.goLevel(pre.lv, pre.cam, false);
  }
  /** Where the last single tap found the view (ToLaD#301): its level (a flight's under way, where it lands) and frame, and when. */
  private preTap: (Step & { t: number }) | null = null;

  /**
   * Where a double-tap from level `from` goes, the view at camera c (ToLaD#271, #301): the first level `from` sits in
   * (levelUp, home's root last) whose frame is more than LEVEL_PX off the view. Never `from`'s own frame, even zoomed
   * in past it (a pinch, a "+x" into part of it): that is back where the view was, not up. Null when there is none (home).
   */
  private upFrom(from: Level, c: Camera): Step | null {
    for (const u of this.levelsAbove(from)) {
      const cam = this.frameOf({ v: u });
      if (this.offBy(cam, c) > LEVEL_PX) return { lv: { v: u }, cam };
    }
    return null;
  }

  /** The levels level `from` sits in (levelUp's tree, ToLaD#258), nearest first, home's root last. */
  levelsAbove(from: Level): FanNode[] {
    const out: FanNode[] = [];
    for (let u = from.b ? levelUp(this.fan, from.b.node, true) : levelUp(this.fan, from.v); u; u = levelUp(this.fan, u)) out.push(u);
    return out;
  }

  /**
   * The level the view is at (ToLaD#258): the innermost frame of the ladder over the lineage at the screen's centre
   * (its species, then each level it sits in, levelUp's, home's root last) that the view is zoomed in at least as far as. Worked out again once the camera
   * has moved and is still (no flight, fling or gesture under way), at most every LEVEL_MS; the last one meanwhile.
   * `now`: worked out now whatever the view is doing (a tap's).
   */
  levelNow(now = false): Level {
    // (Where a level's flight landed, nothing moved since: that level. From the camera, a wide species' frame, as the
    // domestic dog's, can take in its clade's.)
    const at = this.landedHere() ? this.tapAt! : null;
    if (at) return at.v ? { v: at.v } : { b: at.b! };
    const k = this.lvAt;
    const c = this.cam;
    if (k && k.fan === this.fan && k.cam.cx === c.cx && k.cam.cy === c.cy && k.cam.sx === c.sx && k.cam.sy === c.sy) return k.lv;
    const t = performance.now();
    if (k && k.fan === this.fan && !now && (this.anim || this.gesturing || t - k.t < LEVEL_MS)) {
      if (!this.anim && !this.gesturing && !this.lvTimer) this.lvTimer = setTimeout(() => ((this.lvTimer = 0), this.request()), LEVEL_MS);
      return k.lv;
    }
    const b = this.centreLine();
    const z = (f: Camera) => Math.log(c.sx / f.sx) + Math.log(c.sy / f.sy);
    const ladder: Step[] = [];
    const push = (lv: Level) => ladder.push({ lv, cam: this.frameOf(lv) });
    if (b) push({ b });
    for (let u = b ? levelUp(this.fan, b.node, true) : null; u; u = levelUp(this.fan, u)) push({ v: u });
    if (ladder[ladder.length - 1]?.lv.v !== this.fan.root) push({ v: this.fan.root });
    // At a frame (within LEVEL_PX, as a tap passes them): the outermost there. Else from home in, while the view is
    // inside each (a wide species' frame, as the house cat's, can take in its group's, even home's).
    const on = [...ladder].reverse().find((f) => this.offBy(f.cam, c) <= LEVEL_PX);
    // (The level the view was at, while it is still near its frame: a pan of a third of the screen at the Hominins put
    // the centre on a gibbon's line, or the human's, and the level flipped to theirs, the names and pictures with it, ToLaD#311.)
    const was = k && k.fan === this.fan ? k.lv : null;
    const near = (lv: Level) => {
      const f = this.frameOf(lv);
      return this.offBy(f, c) <= this.w / 2 && Math.abs(z(f)) <= Math.log(LEVEL_KEEP);
    };
    let lv: Level = { v: this.fan.root };
    if (on) lv = on.lv;
    else if (was && near(was)) lv = was;
    else {
      let offLv = this.offBy(ladder[ladder.length - 1].cam, c);
      for (let i = ladder.length - 2; i >= 0; i--) {
        const zi = z(ladder[i].cam);
        if (zi < -Math.log(BACK_SLACK)) {
          // (A frame tighter than the next one in, ?fit=fossils: the great apes framed on "now", the hominins' wider on
          // their fossils. Passed over, not where the walk ends: else a pan off the Hominins' frame read the view as at
          // the Catarrhini, the pictures and names gone, ToLaD#311.)
          if (i > 0 && z(ladder[i - 1].cam) >= zi) continue;
          break;
        }
        // (A level whose frame stands further off the view than the one it sits in is not where the view is, however
        // far in: a species', the human, its column filling the Hominins' and Homo's frames, else read as the level
        // there, ToLaD#302; a fossil genus' a pan away from the Hominins' frame, Paranthropus', ToLaD#311. A clade's only
        // while the view is within a screen of the one it sits in: far from every frame, the outer ones stand further
        // off the deeper they go.)
        const off = this.offBy(ladder[i].cam, c);
        if (off > offLv + LEVEL_PX && (ladder[i].lv.b || offLv < this.w)) break;
        lv = ladder[i].lv;
        offLv = off;
      }
    }
    this.lvAt = { fan: this.fan, cam: { ...c }, lv, t };
    return lv;
  }
  private lvAt: { fan: Fan; cam: Camera; lv: Level; t: number } | null = null;
  private lvTimer: ReturnType<typeof setTimeout> | 0 = 0;
  /** A pinch or drag under way (InputHandlers' gestureStart to gestureEnd): the level is worked out once it ends. */
  private gesturing = false;

  /**
   * A tap on a branch, a group's pill, picture, bracket or pinned row (ToLaD#258): one level deeper, to the next level
   * on the way from the level the view is at to what was tapped (`to`: a species, or a clade, an ancestral stretch's
   * lineage among them). From the level holding both, down: the first whose frame is more than LEVEL_PX off the view's
   * (so every tap visibly moves). Already at a species: false, for its card. A clade that holds the view's level (a
   * pinned group, an ancestor's bracket): out to it, unless a column's stretch (`col`: false, its card).
   */
  private tapInto(to: Level, col: boolean): boolean {
    const on = this.anim && this.backing;
    const from = on ? this.backing!.lv : this.levelNow(true);
    const cur = on ? this.backing!.cam : this.cam;
    // What was tapped, then each level it sits in, the root last.
    const chain: Level[] = [to];
    for (let u = to.v ? levelUp(this.fan, to.v) : levelUp(this.fan, to.b.node, true); u; u = levelUp(this.fan, u)) chain.push({ v: u });
    const k = Math.max(0, chain.findIndex((a) => holds(a, from)));
    for (const lv of k ? chain.slice(0, k).reverse() : col ? [] : [to]) {
      const cam = this.frameOf(lv);
      if (this.offBy(cam, cur) > LEVEL_PX) {
        this.goLevel(lv, cam);
        return true;
      }
    }
    // A group whose frame is the view's (a wide species', as the house cat's in the small cats): on, towards that species.
    if (to.v && !col && k > 0) {
      const w = to.v.strands.reduce((p, q) => (q.width > p.width ? q : p));
      return this.tapInto({ b: w }, false);
    }
    // At it already: a species' pill or picture opens its card (a column, the card where it was tapped: false).
    if (to.b && !col) {
      this.flyToSpecies(to.b.sp);
      return true;
    }
    return !col;
  }

  /** Level lv's frame: a species' (speciesCamera) or a clade's (cladeCamera; the root's, home), the fold put back after. */
  private frameOf(lv: Level): Camera {
    const restore = this.fan.tess.fold?.keep();
    const cam = lv.b ? this.speciesCamera(lv.b) : lv.v.parent ? this.cladeCamera(lv.v) : this.homeCamera();
    restore?.();
    return cam;
  }

  /** How far (px) frame a's edges stand from the screen's, the view at camera c: the most of its four. */
  private offBy(a: Camera, c: Camera): number {
    const hw = this.w / 2;
    const hh = this.h / 2;
    const x = (wx: number) => (wx - c.cx) * c.sx + hw;
    const y = (wy: number) => (wy - c.cy) * c.sy + hh;
    return Math.max(Math.abs(x(a.cx - hw / a.sx)), Math.abs(x(a.cx + hw / a.sx) - this.w), Math.abs(y(a.cy - hh / a.sy)), Math.abs(y(a.cy + hh / a.sy) - this.h));
  }

  /**
   * Fly to level lv's frame `cam`, remembered as the step under way (backing), so a tap or double-tap mid-flight goes on
   * from there. Landing on a species, its card opens (ToLaD#266), unless `card` is false (a double-tap's).
   */
  private goLevel(lv: Level, cam: Camera, card = true): void {
    if (lv.b) this.flyToSpecies(lv.b.sp, card);
    else this.flyLevel(null, lv.v);
    this.backing = { lv, cam };
  }

  /** The level's flight under way (ToLaD#258): where it lands, so a tap or double-tap mid-flight goes on from there (a search pick's too). */
  private backing: Step | null = null;

  /** The lineage at the screen's centre (ToLaD#233): the pinned groups' and levelNow's. */
  private centreLine(): FanBranch | null {
    return this.lineAt((LABEL_AXIS_X + this.w) / 2, this.h / 2);
  }

  /**
   * Whether a single tap here waits out the double-tap window (engine/input.ts, ToLaD#241): a double-tap anywhere is
   * one level out (ToLaD#258), so every tap that flies or opens a card waits (a double-tap's first tap does nothing);
   * a tap on nothing (closing the card) never.
   */
  tapWaits(x: number, y: number): boolean {
    return this.tapKind(x, y) !== null;
  }

  /** What a tap at (x, y) does: flies somewhere, opens a card, or neither (as tap() decides it). */
  private tapKind(x: number, y: number): 'fly' | 'card' | null {
    if (this.brackets?.moreHit(x, y) || this.brackets?.pinHit(x, y) || this.plusAt(x, y) || this.pillAt(x, y) || this.picAt(x, y) || this.brackets?.hit(x, y)) return 'fly';
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
    // (Where this tap finds the view: a double-tap whose first tap this was goes up from here, ToLaD#301.)
    const on = this.anim && this.backing;
    this.preTap = { ...(on ? this.backing! : { lv: this.levelNow(true), cam: { ...this.cam } }), t: performance.now() };
    // One level deeper (ToLaD#258), towards what was tapped: a pinned group (ToLaD#233), a species' or group's pill
    // (ToLaD#230, #212) or picture (ToLaD#193), a clade's bracket. The stack's "…": one level up (ToLaD#288).
    if (this.brackets?.moreHit(x, y)) {
      this.doubleTap(x, y);
      return;
    }
    const pinned = this.brackets?.pinHit(x, y);
    // A "+x" (ToLaD#262): the smallest frame holding the groups whose names it stands for.
    const plus = pinned ? null : this.plusAt(x, y);
    if (plus) {
      this.flyToGroup(plus.bs);
      return;
    }
    const pill = pinned ? null : this.pillAt(x, y);
    const pic = pinned || pill ? null : this.picAt(x, y);
    const brk = pinned || pill || pic ? null : this.brackets?.hit(x, y);
    const to: Level | null = pinned ? { v: pinned.v } : pill?.v ? { v: pill.v } : pill?.b ? { b: pill.b } : pic ? (pic[4] ? { v: pic[4] } : { b: pic[3] }) : brk ? { v: brk.v } : null;
    if (to) {
      this.tapInto(to, false);
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
    // A column (ToLaD#258): one level deeper towards its species, or below its split towards the lineage there; at it, its card.
    if (b) {
      const wy = Math.min(this.fan.trunkBottom.y, this.toWorld(x, y)[1]);
      if (this.tapInto(wy >= b.splitY ? { v: segAt(b, wy).node } : { b }, true)) return;
    }
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
    // (The columns' paths made again a few a frame while the view moves, all at once at rest: ToLaD#313.)
    pathFrame.start(this.gesturing || !!this.anim);
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
    if (textureOn && !hide.has('ind')) for (const b of this.fan.branches) if (!lod || lod.of[b.index] < 0) this.drawIndividuals(b);
    if (!hide.has('held')) this.drawHeld();
    if (!hide.has('events')) this.drawEvents();
    if (!hide.has('fade')) this.drawStemFade();
    // Labels: one form everywhere (see labelSpots).
    this.drawGutter();
    this.drawTouch();
    const tl = performance.now();
    const { br, top, lg, spots, carried } = this.labelsNow(lod);
    this.drawLabels(spots, br, { ...lg, top, lod }, carried);
    br?.drawPins(this.ctx, FAMILY_INK, INK3, BG);
    this.labelAllMs.push(performance.now() - tl);
    if (this.labelAllMs.length > 600) this.labelAllMs.shift();
    if (this.labelMs.length > 600) this.labelMs.shift();
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
   * The labels' spots and the brackets' stack this frame (ToLaD#255): laid out (layoutBrackets, labelSpots) at rest,
   * and while the view moves (a gesture, a flight, a fling) at most every LABEL_MS and LABEL_FRAMES frames; between,
   * the last layout carried with the camera (carryLabels): names, pictures and lines move rigidly with the pan and
   * zoom, and fade as they meet or leave (drawLabels, each frame). `carried` the camera's change carried, null when laid out.
   */
  private labelsNow(lod: Lod | null): { br: Brackets | null; top: number; lg: ReturnType<typeof labelGroups>; spots: LabelSpot[]; carried: Carry | null } {
    const t0 = performance.now();
    const lg = labelGroups(this.fan, this.levelNow());
    const L = this.labLast;
    const c = this.cam;
    const moving = this.gesturing || !!this.anim;
    // (Carried across a change in the clades drawn as one, lod.gen, ToLaD#255: at the mammal level a pinch changes them on
    // almost every frame. Carried names may then differ from a layout's; at rest they never do, below.)
    const same = L && L.fan === this.fan && L.lg === lg && L.lod === lod && L.w === this.w && L.h === this.h && L.names === this.names && L.topLine === this.labelTop();
    if (L && same && moving && labelCarry && (t0 - L.t < LABEL_MS || L.frames < LABEL_FRAMES)) {
      const ax = c.sx / L.cam.sx;
      const ay = c.sy / L.cam.sy;
      const k: Carry = [ax, this.w / 2 - (ax * this.w) / 2 + (L.cam.cx - c.cx) * c.sx, ay, this.h / 2 - (ay * this.h) / 2 + (L.cam.cy - c.cy) * c.sy];
      L.cam = { ...c };
      L.frames++;
      const br = this.brackets && L.br ? L.br : null;
      br?.carry(k[0], k[1], this.toScreen(0, this.yNow)[1]);
      carryLabels(L.spots, k, L.top, this.w);
      this.labelMs.push(performance.now() - t0);
      return { br, top: L.top, lg, spots: L.spots, carried: k };
    }
    const br = this.layoutBrackets();
    // (The labels kept under the pinned groups, ToLaD#233, as they show.)
    // (One pill per group one level down from the level the view is at, ToLaD#258: no "+x", no species standing for its family.)
    // (ToLaD#262: each group's name beside its branch, room at its end for the "+x" of the names hidden near it last frame.)
    const topLine = this.labelTop();
    const top = topLine + (br ? br.pinH() * br.pinA : 0);
    const lay = (room: Map<string, number>) => labelSpots(this.camera, this.fan, top, (t) => this.nameWidth(t), this.barRect()?.[0], br ?? undefined, (id) => room.get(id) ?? 0, undefined, lod, lg, this.names);
    let spots: LabelSpot[];
    this.labClean = !moving;
    if (moving) spots = lay(this.plusRoom);
    else {
      // At rest (ToLaD#255): what a still view at this camera gives, whatever the way here. The names shown chosen afresh
      // (no hysteresis, drawLabels), and the "+x" room from none: laid out, its room counted, again until the room
      // holds (once more as a rule). The room it settled on kept for the frames after at this same camera.
      const key = `${c.cx}|${c.cy}|${c.sx}|${c.sy}|${this.w}|${this.h}|${top}|${this.names}|${lod?.gen ?? -1}|${this.nameWFont}`;
      const R = this.restRoom;
      let room = R && R.fan === this.fan && R.lg === lg && R.key === key ? R.room : new Map<string, number>();
      spots = lay(room);
      for (let i = 0; i < 3 && lg.groups.length + lg.species.size > 0; i++) {
        const next = this.groupPlus({ ...lg, lod }, spots, resolveLabels(spots, new Map()), new Map());
        if (next.size === room.size && [...next].every(([id, px]) => room.get(id) === px)) break;
        // (After the first, the room only grows: a pill whose room for its "+x" crowds it out, its count then gone, the
        // room with it, shown again, laid out at rest frame after frame: it flickered, ToLaD#311.)
        if (i > 0) for (const [id, px] of room) next.set(id, Math.max(px, next.get(id) ?? 0));
        room = next;
        spots = lay(room);
      }
      this.plusRoom = room;
      this.restRoom = { fan: this.fan, lg, key, room };
    }
    this.labLast = { fan: this.fan, lg, lod, lodGen: lod?.gen ?? -1, w: this.w, h: this.h, names: this.names, topLine, t: t0, frames: 0, cam: { ...c }, br, top, spots };
    this.labelMs.push(performance.now() - t0);
    this.labelLayMs.push(performance.now() - t0);
    if (this.labelLayMs.length > 600) this.labelLayMs.shift();
    return { br, top, lg, spots, carried: null };
  }
  /** At rest: the labels shown chosen afresh, not kept from the frame before (drawLabels, ToLaD#255). */
  private labClean = false;
  /** The "+x" room the labels laid out at rest settled on, and where (labelsNow). */
  private restRoom: { fan: Fan; lg: ReturnType<typeof labelGroups>; key: string; room: Map<string, number> } | null = null;
  /** The last labels laid out (labelsNow), carried with the camera since. */
  private labLast: {
    fan: Fan;
    lg: ReturnType<typeof labelGroups>;
    lod: Lod | null;
    lodGen: number;
    w: number;
    h: number;
    names: NameMode;
    topLine: number;
    t: number;
    frames: number;
    cam: Camera;
    br: Brackets | null;
    top: number;
    spots: LabelSpot[];
  } | null = null;
  /** The labels' and brackets' work per frame (ms, labelsNow; the pictures' and fades' in drawLabels not counted). */
  readonly labelMs: number[] = [];
  /** ...and with drawLabels' (the fades, the pictures, the "+x", the pills drawn) and the pinned rows'. */
  readonly labelAllMs: number[] = [];
  /** Each label layout's time (labelsNow when it laid out, not carried: ToLaD#255's ≤50 ms on the phone proxy). */
  readonly labelLayMs: number[] = [];

  /**
   * The parent columns below each split (the stem below the oldest): their
   * daughters' strands side by side with no gaps; a dark backdrop under each,
   * so a column reads as one without seams passing for lanes. It follows the
   * column's curve where it peels off its parent (chords a few px tall).
   */
  /** drawStem's heights, pooled. */
  private stemYs: number[] = [];
  private drawStem(lod: Lod | null = null): void {
    const c = rgb01(this.gl ? mix(GRAY, '#131c19', 0.86) : GRAY);
    const cam = this.camera;
    const wTop = cam.worldY(-8);
    const wBot = cam.worldY(this.h + 8);
    const nodes = this.fan.nodes;
    const ys = this.stemYs;
    for (let ni = nodes.length - 1; ni >= 0; ni--) {
      const v = nodes[ni];
      if (lod?.hidden(v)) continue;
      const ya = Math.max(v.y, wTop);
      const yb = Math.min(v.yBot, wBot);
      if (!(yb > ya)) continue;
      // Straight below its peel: one piece; the peel in chords.
      const peel = v.leanY;
      ys.length = 0;
      ys.push(ya);
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
      for (let i = 0; i <= n; i++) {
        xs[i] = cam.screenX(nodeLeftAt(v, ys[i]));
        sy[i] = cam.screenY(ys[i]);
      }
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
  private ribbon(pts: LanePts, a: (i: number) => number, bOff: (i: number) => number, minPx = 0): void {
    const k = this.cam.sx;
    const xs: number[] = [];
    const ys: number[] = [];
    // (The lanes run down the screen: their normal is (-1, 0).)
    for (let i = 0; i < pts.n; i++) {
      const off = a(i) * k;
      xs.push(pts.x[i] - off);
      ys.push(pts.y[i]);
    }
    for (let i = pts.n - 1; i >= 0; i--) {
      const ao = a(i) * k;
      const bo = bOff(i) * k;
      const off = minPx >= 0 ? Math.max(bo, ao + minPx) : Math.min(bo, ao + minPx);
      xs.push(pts.x[i] - off);
      ys.push(pts.y[i]);
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
    const cam = this.camera;
    const ayTip = cam.screenY(b.tipY);
    const byBot = cam.screenY(yb);
    if (byBot < 0 || ayTip > this.h) return;
    // Wholly left or right of the screen (zoomed in, most strands are): nothing to sample.
    const sTop = cam.worldY(-20);
    const sBot = cam.worldY(this.h + 20);
    const xr = this.fan.tess.xRange(b, sTop, sBot);
    if (cam.screenX(xr[1]) < -12 || cam.screenX(xr[0]) > this.w + 12) return;
    const hw = b.width / 2;
    const pts = this.lanePoints(b, hw);
    if (pts.n < 2) return;
    // The column's styled spans on screen ([top, bottom, dim]), clipped to it: none for most strands.
    let held = NO_HELD;
    for (const [t, bt, d] of colSpansY(this.fan, b)) {
      const st = cam.screenY(t);
      const sb = cam.screenY(bt);
      if (sb > -20 && st < this.h + 20) (held === NO_HELD ? (held = []) : held).push([st, sb, d]);
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
    const pts = this.lanePts;
    pts.n = 0;
    const ext = this.mergedExt;
    let lo = Infinity;
    let hi = -Infinity;
    const cam = this.camera;
    const push = (k: number, y: number) => {
      const [l, r] = f.extent(i0, i1, k, ext);
      const w = Math.max(0, r - l);
      const G = this.lod!.greenAt(v, k, H);
      const px = cam.screenX(l);
      lo = Math.min(lo, px);
      hi = Math.max(hi, px + w * this.cam.sx);
      pts.push(px, cam.screenY(y), w, w > 0 ? Math.min(1, G / w) : 0);
    };
    // (Bottom up, as lanePoints: its last point at its top, read off the row under it.)
    if (y1 > k1 * H) push(Math.min(k1 + 1, Math.ceil(y1 / H)), y1);
    for (let k = k1; k >= k0; k--) push(k, k * H);
    if (y0 < k0 * H) push(k0, y0);
    if (pts.n < 2 || hi < -12 || lo > this.w + 12) return;
    this.drawLanes(pts, 0, NO_HELD, undefined);
  }
  private mergedExt: [number, number] = [0, 0];
  private lodTops = new WeakMap<FanNode, number>();
  private lodTop(v: FanNode): number {
    let t = this.lodTops.get(v);
    if (t === undefined) this.lodTops.set(v, (t = Lod.top(v)));
    return t;
  }

  /** A column's lanes (drawStrand's, or a merged clade's, lod.ts): its points, spine offset hw, styled spans and twig fade. */
  private drawLanes(pts: LanePts, hw: number, held: [number, number, number][], tw: TwigStats | undefined): void {
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
        const gc = mixInto(GC_MIX, GRAY01, GRAY_DARK01, laneDim(wm - gm, lives, tex) * 0.82);
        const ec = mixInto(EC_MIX, GREEN01, GREEN_DARK01, laneDim(gm, lives, tex) * 0.9);
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
      const { x: X, y: Y, w: W, f: F } = pts;
      const hk = hw * k;
      for (let i = 0; i + 1 < pts.n; i++) {
        // p (i) below q (i + 1) on screen: the trapezoid from q's row (top) to p's.
        const y0 = Y[i + 1];
        const y1 = Y[i];
        if (!(y1 > y0) || y1 < -4 || y0 > this.h + 4) continue;
        const xq = X[i + 1] - hk;
        const xp = X[i] - hk;
        const wq = W[i + 1] * k;
        const wp = W[i] * k;
        if (!(wq > 0) && !(wp > 0)) continue;
        // Wholly off screen, every trapezoid piece() would send dropped by trap() (zoomed out most are, ToLaD#255):
        // its widest reach is the glow's, 4 px a unit of lean past the lane's floored width.
        const gq = wq * F[i + 1];
        const gp = wp * F[i];
        const sq = Math.sqrt(1 + ((xp + wp / 2 - xq - wq / 2) / (y1 - y0)) ** 2);
        if ((xq + Math.max(wq, gq, sq) + 4 * sq < -8 && xp + Math.max(wp, gp, sq) + 4 * sq < -8) || (xq - 4 * sq > L + 8 && xp - 4 * sq > L + 8)) continue;
        piece(xq, wq, gq, xp, wp, gp, y0, y1);
      }
    } else {
      // (Its run drawn whole.)
      ctx.fillStyle = grayC;
      this.ribbon(pts, (i) => hw - pts.w[i], () => hw, 0.6);
      if (pts.f.subarray(0, pts.n).some((f) => f > 0)) {
        // Green lane on the left, floored at 1 px.
        ctx.fillStyle = greenC;
        this.ribbon(pts, () => hw, (i) => hw - pts.w[i] * pts.f[i], -1);
      }
      // Its styled stretches: faded over the individuals too, once they are drawn (drawHeld).
      for (const [t, bt, d] of held) {
        // (The points are bottom up: y falls along them.)
        let i1 = 0;
        while (i1 < pts.n && !(pts.y[i1] <= bt + 0.5)) i1++;
        let i0 = i1;
        while (i0 < pts.n && pts.y[i0] >= t - 0.5) i0++;
        if (i0 - i1 > 1) this.heldRuns.push({ run: pts.slice(i1, i0 - 1), hw, d });
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
      this.ribbon(run, (i) => hw - run.w[i], () => hw, 0.6);
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
  lanePoints(b: FanBranch, hw: number): LanePts {
    const yb = this.fan.trunkBottom.y;
    const cam = this.camera;
    const sTop = cam.worldY(-20);
    const sBot = cam.worldY(this.h + 20);
    // The column's kept samples (twigs.ts ColumnPath: those where its chords run straight on screen dropped).
    const P = this.model(b).path;
    const [i0, i1] = P.span(this.cam.sx, this.cam.sy, sTop, Math.min(yb, sBot));
    const ys = P.ys;
    const vals = P.vals;
    // Spine at left + hw: the ribbon spans offsets [hw - w, hw] to its left (nx = -1).
    // (Where the lanes step, as at a split, where the strand leaves its parent's prefix: a point either side.)
    const pts = this.lanePts;
    pts.n = 0;
    for (let i = i1; i >= i0; i--) {
      const py = cam.screenY(ys[i]);
      for (let o = 8 * i, e = P.steps[i] ? o + 4 : o; o <= e; o += 4) {
        const w = vals[o + 1];
        pts.push(cam.screenX(vals[o] + hw), py, w, w > 0 ? vals[o + 2] / w : 0);
      }
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

  /** The level's groups on screen (ToLaD#262), left to right: each its id (its names' spots'), level, centre (screen x). */
  private levelGroupsOn(lg: ReturnType<typeof labelGroups> & { lod: Lod | null }, carried = false): { id: string; lv: Level; x: number }[] {
    // (The groups and their centres (world x) found once per layout; carried frames, ToLaD#255, only move them on screen.)
    let G = this.groupsLaid;
    const ver = this.fan.tess.fold?.ver ?? 0;
    const gen = lg.lod?.gen ?? -1;
    if (!G || G.lg !== lg.groups || (!carried && (G.ver !== ver || G.gen !== gen))) {
      const all: { id: string; lv: Level; wx: number }[] = [];
      for (const g of lg.groups) if (!lg.lod?.hidden(g.v)) all.push({ id: `n${g.vi}`, lv: { v: g.v }, wx: groupCentre({ v: g.v }) });
      for (const b of lg.species) if (!lg.lod || lg.lod.of[b.index] < 0) all.push({ id: String(b.sp.gid), lv: { b }, wx: groupCentre({ b }) });
      // (Left to right in the world is left to right on screen.)
      all.sort((p, q) => p.wx - q.wx);
      G = this.groupsLaid = { lg: lg.groups, ver, gen, all };
    }
    const out: { id: string; lv: Level; x: number }[] = [];
    for (const g of G.all) {
      const x = this.toScreen(g.wx, 0)[0];
      if (x > -PIC_D / 2 && x < this.w + PIC_D / 2) out.push({ id: g.id, lv: g.lv, x });
    }
    return out;
  }
  private groupsLaid: { lg: unknown; ver: number; gen: number; all: { id: string; lv: Level; wx: number }[] } | null = null;

  /** The level's pictures this frame (ToLaD#262): each group's on screen with a picture, as placed (pics.ts) and the group it opens. */
  picSpots: (PicSpot & { lv: Level; face: FanBranch })[] = [];
  /** The level's groups hidden this frame (ToLaD#262): each the shown name it counts on as "+x" (its id), or null for none shown. */
  hiddenGroups: { lv: Level; on: string | null }[] = [];

  /**
   * The level's groups' pictures (ToLaD#262, #266): on "now" (an extinct species' on its tip), each exactly above its
   * group's centre; crowded, smaller, then overlapping a little, then the least populous dropped (pics.ts).
   */
  private groupPics(lg: ReturnType<typeof labelGroups> & { lod: Lod | null }, top: number, carried: Carry | null = null): PicSpot[] {
    // (Carried with the camera between layouts, ToLaD#255: each standing on "now", or its tip, where it was placed.)
    if (carried) {
      for (const p of this.picSpots) {
        p.x = carried[0] * p.x + carried[1];
        p.y = carried[2] * p.y + carried[3];
      }
      return this.picSpots;
    }
    this.picSpots = [];
    const nowS = this.toScreen(0, this.yNow)[1];
    // (?fit=fossils, ToLaD#298: the fossils' frame has "now" above the screen, an extinct species' picture still on its tip.)
    const fossils = wantFitFossils();
    if (!thumbsOn || nowS > this.h || (!fossils && nowS < top + 12)) return [];
    const gs: { lv: Level; face: FanBranch; x: number; y: number; n: number }[] = [];
    for (const g of this.levelGroupsOn(lg)) {
      const face = g.lv.v ? groupFace(g.lv.v) : g.lv.b;
      if (!face || !wikiOf(face.sp.sci)?.img) continue;
      // (Fossils framed, ToLaD#298: a genus all gone on its youngest tip; a living group's, "now" above the screen,
      // under the top line, over its name.)
      const tip = g.lv.b ? g.lv.b.tipY : fossils && g.lv.v.strands.every((b) => b.tipY > this.yNow) ? Math.min(...g.lv.v.strands.map((b) => b.tipY)) : this.yNow;
      const y = tip > this.yNow ? this.toScreen(0, tip)[1] : fossils ? Math.max(nowS, top + NOW_ROOM) : nowS;
      if (y < top + 12 || y > this.h) continue;
      gs.push({ lv: g.lv, face, x: g.x, y, n: groupAlive(g.lv) });
    }
    const placed = placePics(gs.map((g) => g.x), gs.map((g) => g.y), gs.map((g) => g.n));
    this.picSpots = placed.map((p) => ({ ...p, lv: gs[p.i].lv, face: gs[p.i].face }));
    return placed;
  }

  /** Draw the level's pictures (groupPics), the least populous first (the more populous on top). Each a tap to its group. */
  private drawGroupPics(): void {
    const ctx = this.ctx;
    const nowS = this.toScreen(0, this.yNow)[1];
    // (?fit=fossils: each faded by where it stands, "now" off the screen's top or not, ToLaD#298.)
    const alpha = wantFitFossils() ? 1 : clamp01((nowS - this.labelTop()) / 24);
    if (!(alpha > 0)) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK3;
    ctx.lineWidth = 1;
    // (Hits: the one on top found first.)
    for (const p of [...this.picSpots].reverse()) this.thumbHits.push([p.x, p.y, p.d / 2, p.face, p.lv.v]);
    for (const p of this.picSpots) {
      const th = labelThumb(p.face.sp.sci, () => this.request());
      if (th) drawThumb(ctx, th, p.x, p.y, p.d);
      else {
        // (Its picture still loading: the disc's place kept, an empty ring.)
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.d / 2 - 1, 0, 2 * Math.PI);
        ctx.fillStyle = BG;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The "+x" room each name keeps (its id: px), from the frame before (ToLaD#262). */
  private plusRoom = new Map<string, number>();

  /**
   * The level's names hidden (ToLaD#262): each group on screen with no name shown counts as "+x" on the shown name
   * nearest it (by their centres); `groups` gets, per shown spot, the hidden groups' species (a tap frames them all).
   */
  private groupPlus(lg: ReturnType<typeof labelGroups> & { lod: Lod | null }, spots: readonly LabelSpot[], on: Map<string, boolean>, groups: Map<string, FanBranch[][]>, carried = false): Map<string, number> {
    const shownKey = new Map<string, string>();
    for (const s of spots) if (on.get(s.key)) shownKey.set(s.id, s.key);
    const gs = this.levelGroupsOn(lg, carried).filter((g) => g.x >= LABEL_AXIS_X - 4 && g.x <= this.w + 4);
    const shown = gs.filter((g) => shownKey.has(g.id));
    this.hiddenGroups = [];
    const count = new Map<string, number>();
    for (const g of gs) {
      if (shownKey.has(g.id)) continue;
      let at: (typeof gs)[number] | null = null;
      for (const q of shown) if (!at || Math.abs(q.x - g.x) < Math.abs(at.x - g.x)) at = q;
      this.hiddenGroups.push({ lv: g.lv, on: at?.id ?? null });
      if (!at) continue;
      const key = shownKey.get(at.id)!;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(g.lv.v ? g.lv.v.strands : [g.lv.b!]);
      count.set(at.id, (count.get(at.id) ?? 0) + 1);
    }
    return new Map([...count].map(([id, n]) => [id, this.plusPx(n)]));
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
    // (Kept per font, and while the faces load or not (the canvas measures in system type until then): a layout
    // measures every name it places, ToLaD#255.)
    const f = font(LABEL_FONT);
    const fk = typeof document !== 'undefined' && document.fonts ? `${f}|${document.fonts.status}` : f;
    if (fk !== this.nameWFont) {
      this.nameW.clear();
      this.nameWFont = fk;
    }
    let w = this.nameW.get(text);
    if (w === undefined) {
      this.ctx.save();
      this.ctx.font = f;
      w = this.ctx.measureText(text).width;
      this.ctx.restore();
      if (this.nameW.size > 20000) this.nameW.clear();
      this.nameW.set(text, w);
    }
    return w;
  }
  private nameW = new Map<string, number>();
  private nameWFont = '';

  /**
   * The species' labels (see labelSpots for where): which show is decided by
   * resolveLabels (a fixed priority, with hysteresis), and each fades in and
   * out over LABEL_FADE_MS rather than popping.
   */
  private drawLabels(spots: LabelSpot[], br: Brackets | null = null, lg?: ReturnType<typeof labelGroups> & { top: number; lod: Lod | null }, carried: Carry | null = null): void {
    const ctx = this.ctx;
    const now = performance.now();
    const dt = Math.min(100, Math.max(0, now - this.labelT));
    this.labelT = now;
    // (At rest, chosen afresh: what a still view gives, whatever the way here, ToLaD#255.)
    const st0 = this.labelState;
    const on = resolveLabels(spots, this.labClean ? () => false : (key) => !!st0.get(key)?.on);
    // The "+x" badges (ToLaD#197): counted with the cull; a pill keeps room for its count from the frame before, so
    // when a count changes the next frame lays the pills out again with the room it needs.
    // (Not with one pill per group, ToLaD#258: plusGroups and familyPills, ToLaD#197 and #212, give way to labelGroups.)
    const groups = new Map<string, FanBranch[][]>();
    this.famHits.length = 0;
    this.nameHits.length = 0;
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
    // The level's groups (ToLaD#262): each one's picture over "now", exactly above its centre; the names hidden, as "+x".
    const pics = lg ? this.groupPics(lg, lg.top, carried) : [];
    if (lg) {
      // (At rest the room was settled already, labelsNow.)
      const room = this.groupPlus(lg, spots, on, groups, !!carried);
      if (!this.labClean) this.plusRoom = room;
    }
    // The clades' brackets (ToLaD#193) under the pills: their labels clear of the pills shown, their lines behind them.
    br?.draw(ctx, FAMILY_INK, INK3, [...spots.filter((_, k) => alphas[k] > 0.3).map((s) => s.box), ...pics.map((p) => [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2])]);
    this.drawGroupPics();
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
      const bs = g?.flat() ?? [];
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
        // (The whole chip, its name too, is the badge's one tap target, ToLaD#287: "its all the same chip".)
        if (alpha > 0.5) this.plusHits.push({ box: [x0, y0, x1, y1], badge: [x0, y0, x1, y1 - LABEL_PAD - nx + PLUS_GAP / 2], bs });
      }
      ctx.restore();
      // ToLaD#182: the species' Commons picture under its pill, before the name, once loaded (wiki.ts; `?thumbs=0` off).
      // (A family's, ToLaD#212: its commonest living species'.)
      const pb = s.fam ? s.pic : s.b;
      // (A level's groups' pictures stand over "now" instead, groupPics, ToLaD#262.)
      const th = pb && s.ev === undefined && !lg ? labelThumb(pb.sp.sci, () => this.request()) : null;
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
   * In log widths a width is 1 + log10(individuals) (layout.ts g), so the bar is
   * a column's width, the individuals a column that wide holds: a power of ten,
   * the one whose column comes nearest the bar's length, from 1 to 10 billion (ToLaD#299: a
   * bar of ten to the hundredth was a sum of decades no column has). Zoomed in so far
   * that one individual's column is more than 2.5 bars, the bar is what a column
   * that much wider holds more: a factor near 1.
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
    if (unitPx <= target * 2.5) {
      // (Width 1 + k for 10^k: the k nearest the bar's length in ratio, within 0..10.)
      let k = 0;
      for (let j = 1; j <= 10; j++) if (Math.abs(Math.log((1 + j) * unitPx / target)) < Math.abs(Math.log((1 + k) * unitPx / target))) k = j;
      const n = 10 ** k;
      return { px: (1 + k) * unitPx, label: `${formatCount(n, { exact: true })} ${n === 1 ? 'individual' : 'individuals'} · log widths` };
    }
    const fct = Math.pow(10, target / unitPx);
    return { px: target, label: `×${fct < 1.1 ? fct.toFixed(4) : fct.toFixed(2)} individuals a bar wider · log widths` };
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

/** mix() straight to 0–1 channels, as rgb01(mix(a, b, t)) gives them, of parsed colours, into out (no strings, no tuple: it runs per chord, per frame); out returned. */
function mixInto(out: [number, number, number], A: readonly number[], B: readonly number[], t: number): [number, number, number] {
  for (let k = 0; k < 3; k++) out[k] = Math.round((A[k] * (1 - t) + B[k] * t) * 255) / 255;
  return out;
}
const GRAY01 = rgb01(GRAY);
const GRAY_DARK01 = rgb01('#131c19');
const GREEN01 = rgb01(GREEN);
const GREEN_DARK01 = rgb01('#0d2318');
/** drawLanes' piece colours: written per piece, read at once by trap(). */
const GC_MIX: [number, number, number] = [0, 0, 0];
const EC_MIX: [number, number, number] = [0, 0, 0];

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatYearsAgo(y: number): string {
  if (y < 1) return 'under a year ago';
  if (y < 1e4) return `${fmtInt(y)} years ago`;
  if (y < 999500) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} thousand years ago`;
  return `${(y / 1e6).toFixed(2)} million years ago`;
}
