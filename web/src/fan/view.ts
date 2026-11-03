// The fan view: the dated tree drawn OneZoom-style with Canvas 2D, and a camera
// with uniform (isotropic) zoom in float64 world coordinates. Height = time.
// Each species is a bundle of its individuals' strands (see layout.ts); zoomed
// in far enough, a branch resolves into the individuals themselves (twigs.ts).
// Gestures come from the shared engine/input.ts.

import { drawPic, prefetchPics } from './wiki';
import { PIC_D, PIC_LIFT, type PicSpot } from './pics';
import { formatCount, formatMass } from '../data/count';
import { stamp } from '../stamp';
import { DOUBLE_TAP_MS, Input, type InputHandlers } from '../engine/input';
import { clipPoly, FanCamera, type Camera } from './camera';
import { laneAt, layoutFan, leftAt, nearestStrand, nodeLeftAt, nodeQ, segAt, STEM_FADE_MA, type Fan, type FanBranch, type FanNode, type Measure, type WidthMode } from './layout';
import type { CladeRec, SpeciesRec } from './panthera';
import { FanGL, rgb01 } from './meshgl';
import { Lod } from './lod';
import type { Fold, FoldState } from './fold';
import { Steady } from './steady';
import { LADDER, Territories, type CutItem, type Ref, type RowsOf } from './cut';
import { COLUMN_DIM, columnSpans, EVENT_TINT, eventAt, eventSpans, type EventSpan } from './colstyle';
import { laneDim, LINEAGE, pathFrame, TwigModel } from './twigs';
import type { RectBatch } from './meshgl';
import { FAMILY_EN, familyLabel, FELIDAE_TREE, ORDER_EN, ORDER_TAXA, taxonKey, type Split } from './splits';
import { Brackets, foldedFrame, latinOf, rankOf, TAXON_EN, type StackAt } from './brackets';
import { axisInset, drawWorldOver, drawWorldUnder, worldFlags, type Box } from './world';

export type { Camera } from './camera';

/** What the widths count when the page opens (ToLaD#276): `?width=mass` (TOLAD_WIDTH=mass in node) weighs the individuals by their adult mass. */
export function initialMeasure(): Measure {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('width') === 'mass') return 'mass';
  } catch {
    /* no URL */
  }
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TOLAD_WIDTH === 'mass' ? 'mass' : 'individuals';
}

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
const LABEL_PAD = 8;
/** Right edge (px) of the time axis's labels: species' labels keep right of it. */
const LABEL_AXIS_X = 72;
/** A level's flight under way (ToLaD#258, #271): the level it lands on and its frame, so a tap or double-tap mid-flight goes on from there. */
type Step = { lv: Level; cam: Camera };
/** Where a tap's flight landed (FanView.tapAt). */
type TapAt = { b: FanBranch | null; v: FanNode | null; cam: Camera; back?: { at: TapAt | null; lv: Level; cam: Camera } };
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
/** The level the view is at (levelNow) is worked out at most this often (ms) while the camera moves without a gesture (a wheel). */
const LEVEL_MS = 200;
/** The scale bar and legend at the bottom (px): labels fade out over the 30 px above it. */
const LABEL_BOTTOM_PX = 104;
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

/** Gap (px) between a label's picture and its name pill right under it (ToLaD#358: one unit at the tip). */
const LABEL_UNDER = 4;

/**
 * A name pill (ToLaD#333, view.ts cutLabels): the name upright on a dark pill, the same text and size at every zoom,
 * right under its item's picture inside the item's territory (ToLaD#358), its "+x" at its top end.
 */
export interface LabelSpot {
  /** The spot's key: the name's id and the place (`tip`, `in`, `right`, `left`). */
  key: string;
  /** The name's id (cutLabels' key). */
  id: string;
  place: 'tip' | 'in' | 'right' | 'left' | 'fam' | 'over';
  /** A family's label (`fam`, ToLaD#146): the screen x span of its species, bracketed under the pill. */
  span?: [number, number];
  /** A cut item's label (ToLaD#359): the item's strands, first and last, which a tap on it goes into (tapItem). */
  run?: Run;
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

/** A frame's labels from the cut (ToLaD#333, #358): one per item, its name pill and its picture, and its "+x" species. */
export interface CutLabels {
  spots: LabelSpot[];
  groups: Map<string, FanBranch[][]>;
  pics: (PicSpot & { lv: Level; face: FanBranch; run?: Run })[];
  /** The cut (tests read it), and per shown item its pill and picture (`spots[i]`, `pics[i]`: one label, ToLaD#358). */
  items: CutItem[];
  /** The whole cut meeting the screen, its labels shown or not (tapItem's next split counts its pieces on it). */
  all: CutItem[];
}

/** What an item's label says (ToLaD#358): the clade or species it names, its text, its picture's species, its "+x". */
export interface ItemName {
  lv: Level;
  text: string;
  face: FanBranch;
  hid: FanBranch[][];
}

/** The territories (cut.ts) with what the labels read off a cut item: its youngest tip, its name, the species its "+x" counts. */
class CutTerritories {
  readonly t: Territories;
  /** Per node: its youngest tip (world y, "now" at most), its individuals alive now. */
  private readonly young: Float64Array;
  private readonly alive: Float64Array;
  private readonly now: number;
  constructor(fan: Fan, fold: Steady, w: number) {
    this.t = new Territories(fan, fold, w);
    this.now = fan.time.y(0);
    this.young = Float64Array.from(fan.nodes, (v) => {
      let y = Infinity;
      for (const b of v.strands) y = Math.min(y, Math.max(b.tipY, this.now));
      return y;
    });
    this.alive = Float64Array.from(fan.nodes, (v) => groupAlive({ v }));
  }
  /** Daughter k's (a node's index, ~ a strand's) youngest tip (world y). */
  youngOf(k: number): number {
    return k >= 0 ? this.young[k] : Math.max(this.t.strands[~k].tipY, this.now);
  }
  /** Daughter k's individuals alive now. */
  aliveOf(k: number): number {
    return k >= 0 ? this.alive[k] : groupAlive({ b: this.t.strands[~k] });
  }
  private readonly best = new Map<number, number>();
  /** Daughter k's most populous named clade or species (itself if named; a node's index, ~ a strand's). Ties: the leftmost. */
  bestNamed(k: number): number {
    if (k < 0 || latinOf(this.t.nodes[k].split)) return k;
    let out = this.best.get(k);
    if (out === undefined) {
      for (const d of this.t.kids[k]) {
        const c = this.bestNamed(d);
        if (out === undefined || this.aliveOf(c) > this.aliveOf(out)) out = c;
      }
      this.best.set(k, out!);
    }
    return out!;
  }
  /**
   * The widest clade daughter k (a node's index, ~ a strand's) is in whose species are all in strands f..l: k climbed
   * while its parent's are. An item's head climbed is the branch its label stands on: the same whether the clade is one
   * item or a daughter of it with her sisters riding on her.
   */
  whole(k: number, f: number, l: number): number {
    const { nodes, strands, first, last, index } = this.t;
    for (let u = k >= 0 ? nodes[k].parent : strands[~k].node; u; u = u.parent) {
      const j = index.get(u)!;
      if (first[j] < f || last[j] > l) break;
      k = j;
    }
    return k;
  }
  private readonly names = new Map<string, ItemName>();
  /**
   * Item r's label (ToLaD#358): the most populous (individuals alive now) named clade or species among those it
   * stands for, by its English name where there is one, else its Latin; its picture that one's most populous living
   * species (a fossil's own); "+x" every species of the item with no label of its own (all but the named species).
   */
  nameOf(r: Ref & { parts?: readonly number[] }): ItemName {
    const key = `${r.f}:${r.l}`;
    let out = this.names.get(key);
    if (out) return out;
    const { nodes, strands } = this.t;
    // (Its whole clades: each part climbed while its parent's species are all the item's.)
    let pick = NaN;
    for (const p of r.parts ?? [r.head]) {
      const c = this.bestNamed(this.whole(p, r.f, r.l));
      if (Number.isNaN(pick) || this.aliveOf(c) > this.aliveOf(pick)) pick = c;
    }
    const lv: Level = pick < 0 ? { b: strands[~pick] } : { v: nodes[pick] };
    const face = lv.b ?? groupFace(lv.v) ?? lv.v.strands[0];
    const hid: FanBranch[][] = [];
    for (let i = r.f; i <= r.l; i++) if (strands[i] !== lv.b) hid.push([strands[i]]);
    out = { lv, text: lv.b ? levelText(lv.b) : levelName(lv.v), face, hid };
    this.names.set(key, out);
    return out;
  }
  /** Clade v's territory (world x) at the layout as it stands. */
  spanOf(v: FanNode): [number, number] | null {
    const j = this.t.index.get(v);
    return j === undefined ? null : this.t.span(j);
  }
}

/** Priority: species before lineages, then the wider column first, then tree order. */
type Rank = [number, number, number];

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

/** How long (ms) after the fold last moved the columns' edges are made exact (FanView.applyFold). */
const FOLD_REST_MS = 120;
/** The fold's rows at a level with orders above its families (the mammals: every row folds ~5,900 strands): about this many px apart (else 3), ToLaD#247. */
const GRID_PX_ORDERS = 8;

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
 * Where a level's fossils lived (Fit fossils, ToLaD#289): the world x its columns took (each at its own width
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
 *
 * Null too when its fossil groups are fewer than its living ones (ToLaD#352): a group's label stands at its tip, a
 * living group's at "now", a fossil's in the past, and a level is framed where most of its groups' labels stand. A
 * frame on the fossils' era puts "now" above the screen, and with it every living group's name and picture: at the
 * Great apes one stem fossil (Sahelanthropus) framed the screen on its own sliver of a column, the chimpanzees,
 * gorillas, orangutans and hominins all off it.
 */
function fossilEnd(fan: Fan, v: FanNode): number | null {
  const gone = (b: FanBranch) => b.sp.extinct || !(b.pop.aliveAt(0) > 0);
  let y = Infinity;
  let fossil = 0;
  let living = 0;
  for (const g of nextLevels(fan, v)) {
    const bs = g.b ? [g.b] : g.v.strands;
    if (bs.every(gone)) {
      fossil++;
      for (const b of bs) y = Math.min(y, b.tipY);
    } else living++;
  }
  return y < Infinity && fossil >= living ? y : null;
}

/**
 * The world y a level's frame puts where "now" would stand (ToLaD#298): a level framed on its
 * fossils (fossilSpan) has its youngest fossil group's end there, "now" (and the living columns' last ~40 kyr, which
 * log time gives most of the screen) above the screen; otherwise null ("now" there).
 */
export function fossilTop(fan: Fan, v: FanNode): number | null {
  return fossilSpan(fan, v) ? fossilEnd(fan, v) : null;
}

/** The world x a level is framed on: its span at "now" (familySpan), or where its dwarfed fossils lived (fossilSpan, ToLaD#289). */
export function levelSpan(fan: Fan, v: FanNode): [number, number] {
  return fossilSpan(fan, v) || familySpan(v);
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
/** A cut item's strands (drawn order): first and last. */
export type Run = [number, number];

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
 * it sits in's other groups (the neighbours at the screen's edges); `at` itself when a species. Each clade as
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

/** A group's picture (ToLaD#258, #358): its species with the most individuals alive now, photo or not (no photo: the placeholder disc). */
const faceCache = new WeakMap<FanNode, FanBranch | null>();
export function groupFace(v: FanNode): FanBranch | null {
  let out = faceCache.get(v);
  if (out === undefined) {
    const alive = v.strands.filter((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0).sort((p, q) => q.pop.aliveAt(0) - p.pop.aliveAt(0));
    out = alive[0] ?? null;
    faceCache.set(v, out);
  }
  return out;
}

/** The species whose pictures a tap on group v would show (its next level's faces, ToLaD#351: fetched ahead). */
const nextFaceCache = new WeakMap<FanNode, string[]>();
function nextFaces(fan: Fan, v: FanNode): string[] {
  let out = nextFaceCache.get(v);
  if (!out) nextFaceCache.set(v, (out = nextLevels(fan, v).flatMap((g) => (g.b ?? groupFace(g.v))?.sp.sci ?? [])));
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


export interface Selection {
  sp: SpeciesRec;
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
  /** Individuals alive then (model; by mass, ToLaD#276: their mass, kg) and the share with living descendants today. */
  alive: number;
  green: number;
  /** What `alive` counts (the fan's widths). */
  measure: Measure;
  /** The species it is the ancestor of, left to right (common names). */
  of: string[];
}

/** The lineage in the column strand b is in at age `ageMa` (at or below its split). */
export function lineageAt(b: FanBranch, fan: Fan, ageMa: number): Lineage {
  const v = segAt(b, fan.time.y(ageMa)).node;
  return { node: v, name: v.name, ageMa, alive: v.n, green: nodeQ(v, ageMa), measure: fan.measure, of: v.strands.map((s) => s.sp.common) };
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
  /** What the widths count (ToLaD#276): individuals, or their mass. */
  measure: Measure = initialMeasure();
  dpr = 1;
  selected: SpeciesRec | null = null;
  /** The point touched on the selected column (world x, age in Ma): marked on the graph, the card's numbers are for it. */
  touch: { x: number; ageMa: number } | null = null;
  onSelect: (sel: Selection | null) => void = () => {};
  /** The width scale bar (a DOM element above the legend / cards): its bar and label are set each frame. */
  scaleEl: HTMLElement | null = null;
  /** The buttons (a DOM element over the canvas): labels never go under them. */
  barEl: HTMLElement | null = null;
  private scaleKey = '';
  /** `?debug`: a readout of the zooms, years on screen and individuals per px. */
  readonly debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
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
  thumbHits: [number, number, number, FanBranch, FanNode?, Run?][] = [];
  /** The species' name pills drawn (ToLaD#230): a tap flies to the species' branch, as a bracket's to its clade. */
  nameHits: { box: [number, number, number, number]; b: FanBranch; run?: Run }[] = [];
  /**
   * Where the last tap on a pill, a picture or a bracket flew (ToLaD#230): the species tapped (`b`, null for a clade's),
   * the clade framed (`v`, null for the species' own frame) and the camera it landed at. Tapped again there, with
   * nothing moved since, it goes one level out.
   */
  /** ...`back`: a cut item's (tapItem, ToLaD#359), where its tap came from (the frame the view was at, its own tapAt): a double tap goes back out to it. */
  private tapAt: TapAt | null = null;
  /** The family pills drawn (ToLaD#212): a tap flies to the family, as its bracket's. */
  famHits: { box: [number, number, number, number]; v: FanNode; run?: Run }[] = [];
  /** The chips with a "+x" drawn (ToLaD#197, #262): `box` the whole chip (a tap on its name or its badge alike, ToLaD#287), `badge` the badge's end. */
  plusHits: { box: [number, number, number, number]; badge: [number, number, number, number]; bs: FanBranch[]; run?: Run }[] = [];
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
    readonly tree: Split = FELIDAE_TREE,
    /** The fold (fold.ts, ToLaD#146): the order one branch from afar, its splits opening as you zoom in. */
    readonly folds = false,
  ) {
    stamp('clade');
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
    stamp('gl');
    const laid = layoutFan(clade, this.mode, tree, this.measure);
    stamp('layout');
    this.camera = new FanCamera(this.withFold(laid), (b) => this.model(b));
    stamp('fold');
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
    const n = this.fan.root.strands.length;
    return this.fan.tess.fold ? this.runFrame(0, n - 1, 0, this.fan.root) : this.withBand(this.camera.home(), this.fan.root);
  }

  /**
   * The clades' brackets above "now" (brackets.ts, ToLaD#193): this frame's stack, or null.
   * The species' pills stand on it.
   */
  private readonly brackets: Brackets | null = new Brackets(font('600 11px'), font('italic 400 11px', SERIF));
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
   * would stand, "now" itself by default (Fit fossils, ToLaD#298: a level framed on its fossils, its youngest fossil's end, fossilTop).
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
   * The one frame (ToLaD#359, research/scalable-tree.md §4): strands f..l's territory (runSpan: the rooms of the whole
   * clades they make up, half the open gap past each end) across the labels' width of the screen, from LABEL_AXIS_X to
   * its edge, at the zoom where it fills it (foldedFrame's bisection: the territory widens as the zoom opens its gaps),
   * "now" (or `top`) down to `yFork` in time. Its labels are the cut at that zoom; each stands inside a territory inside
   * this one, so none is cut off by the time axis or the screen's edge, with no padding. Home, a level, a bracket's tap,
   * a label's. `fossils`: a level whose living columns dwarf its fossils framed on where they lived (ToLaD#289).
   * Kept per screen size (a bisection at the mammals is ~40 refolds of ~6,000 strands, ToLaD#255), the fold put where
   * it leaves it.
   */
  private runFrame(f: number, l: number, yFork: number, v: FanNode, top = this.yNow, fossils = false): Camera {
    const fold = this.fan.tess.fold;
    const key = `${this.w}x${this.h}:${f}:${l}:${yFork}:${top}:${fossils}`;
    if (this.framesFan !== this.fan) [this.framesFan, this.frames] = [this.fan, new Map()];
    const hit = this.frames.get(key);
    if (hit) {
      fold?.setScale(hit.sx, this.w);
      return { ...hit };
    }
    const s: [number, number] = [0, 0];
    const cam = foldedFrame(this.fan, this.w, () => {
      const [a, b] = (fossils && fossilSpan(this.fan, v)) || this.runSpan(f, l, s);
      const x0 = LABEL_AXIS_X;
      const sx = (this.w - LABEL_AXIS_X) / Math.max(1e-300, b - a);
      return this.withBand({ ...this.camera.frame(a, b, yFork, true), sx, cx: a + (this.w / 2 - x0) / sx }, v, top);
    });
    this.frames.set(key, { ...cam });
    return cam;
  }
  /**
   * Strands f..l's territory (world x, at the layout as it stands): the union of the territories (Territories.span) of
   * the whole clades and species they make up, so a clade's is its own (rooms by life: the hull its columns stand in at
   * every time, not only its first and last strand's).
   */
  private runSpan(f: number, l: number, out: [number, number]): [number, number] {
    const T = this.territories().t;
    const s: [number, number] = [0, 0];
    out[0] = Infinity;
    out[1] = -Infinity;
    const go = (k: number) => {
      const r = T.refOf(k);
      if (r.l < f || r.f > l) return;
      if (r.f < f || r.l > l) {
        for (const q of T.kids[k]) go(q);
        return;
      }
      T.span(k, s);
      out[0] = Math.min(out[0], s[0]);
      out[1] = Math.max(out[1], s[1]);
    };
    go(T.index.get(this.fan.root)!);
    return out;
  }
  private framesFan: Fan | null = null;
  private frames = new Map<string, Camera>();

  /** Strands f..l's clade where they meet: the least clade holding them all. */
  private meetOf(f: number, l: number): FanNode {
    const T = this.territories().t;
    let u: FanNode = T.strands[f].node;
    while (u.parent && (u.strands[0].index > f || u.strands[u.strands.length - 1].index < l)) u = u.parent;
    return u;
  }

  /** A clade's frame (runFrame: its territory, from its split to "now"; a level framed on its fossils, from their end). */
  cladeCamera(v: FanNode): Camera {
    if (!v.parent) return this.homeCamera();
    const top = fossilTop(this.fan, v);
    return this.runFrame(v.strands[0].index, v.strands[v.strands.length - 1].index, v.y, v, top ?? this.yNow, top !== null);
  }

  /**
   * A bracket's tap: fly to its clade (cladeCamera), any card closed for the flight. Folded, the flight tracks the
   * frame as the fold moves and lands on it computed there (flyTo, ToLaD#246).
   */
  flyToClade(v: FanNode, landed?: () => void): void {
    this.selected = null;
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

  /** Where a "+x" tap lands (ToLaD#197, #359): the frame of the species it stands for, from where they meet (runFrame). */
  groupCamera(bs: readonly FanBranch[]): Camera {
    const f = Math.min(...bs.map((b) => b.index));
    const l = Math.max(...bs.map((b) => b.index));
    const v = this.meetOf(f, l);
    return this.runFrame(f, l, v.y, v);
  }

  flyToGroup(bs: readonly FanBranch[]): void {
    // (One species: a landing on it, its card open, ToLaD#266.)
    if (bs.length === 1) return this.flyToSpecies(bs[0].sp);
    this.selected = null;
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

  /** What the widths count (the toggle, ToLaD#276): the same tree and order, the camera stays put; `?width=mass` kept in step. */
  setMeasure(measure: Measure): void {
    if (measure === this.measure) return;
    this.measure = measure;
    this.relayout();
    try {
      const u = new URL(window.location.href);
      if (measure === 'mass') u.searchParams.set('width', 'mass');
      else u.searchParams.delete('width');
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* no URL */
    }
  }

  private relayout(): void {
    this.camera.fan = this.withFold(layoutFan(this.clade, this.mode, this.tree, this.measure));
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
      const [a, b] = this.territories().t.span(this.fan.nodes.indexOf(v));
      // (The fold stays at the frame's zoom: the camera taking the frame finds it there, nothing to follow.)
      return { ...fr, sx, cx: (a + b) / 2 - 22 / sx };
    }
    const v = this.fan.nodes.find((n) => n.split.taxon === name);
    return v ? this.cladeCamera(v) : null;
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
  /** The fold's grid (about 3 px of screen between rows; `coarse`, twice that) and openness at the camera's zoom. */
  private foldTo(f: Fold, coarse = false): void {
    f.setGrid(Math.pow(2, Math.round(Math.log2((f.ordShare.length ? GRID_PX_ORDERS * (coarse ? 2 : 1) : 3) / this.cam.sy))));
    f.setScale(this.cam.sx, this.w);
  }
  /** The fold at this frame's zoom: its grid (about 3 px of screen between rows) and openness; the columns sampled anew if they moved. */
  private applyFold(): void {
    const f = this.fan.tess.fold;
    if (!f) return;
    // (The mammal level, ~5,900 strands a row: rows further apart, GRID_PX_ORDERS, ToLaD#247; twice that while the
    // fold moves (a pinch, a pan), each frame folding every row again, ToLaD#255.)
    const coarse = f.ordShare.length > 0 && this.foldMoving;
    this.foldTo(f, coarse);
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
    // (Landed from a tap on a cut item's label (ToLaD#359): out one step, to the frame that tap came from, never deeper.)
    const back = !pre && !on && this.landedHere() ? this.tapAt!.back : undefined;
    if (back && this.offBy(back.cam, this.cam) > LEVEL_PX) return this.goBack(back);
    const step = this.upFrom(back ? back.lv : from, pre ? pre.cam : on ? this.backing!.cam : this.cam);
    if (step) this.goLevel(step.lv, step.cam, false);
    // (Home: nothing, so the first tap's flight is put back.)
    else if (pre && (this.anim || this.offBy(pre.cam, this.cam) > 0.5)) this.goLevel(pre.lv, pre.cam, false);
  }
  /** Fly back to where a cut item's tap came from (doubleTap), landing as the view was there (its tapAt, so a double tap there goes on out). */
  private goBack(back: NonNullable<TapAt['back']>): void {
    this.selected = null;
    this.touch = null;
    this.onSelect(null);
    const cam = { ...back.cam };
    this.flyTo(cam, undefined, () => (this.tapAt = back.at ? { ...back.at, cam: { ...this.cam } } : { b: back.lv.b ?? null, v: back.lv.v ?? null, cam: { ...this.cam } }));
    this.backing = { lv: back.lv, cam };
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
          // (A frame tighter than the next one in, Fit fossils: the great apes framed on "now", the hominins' wider on
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
        if (ladder[i].lv.b && off > offLv + LEVEL_PX) break;
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
      // (Deeper is never further out (ToLaD#352): a level framed wider than the view is passed over on the way in. A
      // signpost's pill (an unnamed clade named for its largest named one, as "Primates" for the primates, treeshrews and
      // colugos) frames that clade at its narrowest group's fit zoom, tighter than the Primates' own frame of two wide
      // groups: a tap on the humans' picture there flew out to the Primates, the bats and rodents beside them.)
      if (k && Math.log(cam.sx / cur.sx) + Math.log(cam.sy / cur.sy) < -Math.log(BACK_SLACK)) continue;
      if (this.offBy(cam, cur) > LEVEL_PX) {
        this.goLevel(lv, cam);
        return true;
      }
    }
    // A group whose frame is the view's (a wide species', as the house cat's in the small cats; the level the view is
    // at, a label standing for all of it, as "Cats +49" at the cats' home, ToLaD#358): on, towards its widest species.
    if (to.v && !col) {
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
  /**
   * A tap on a cut item's label, strands f..l (ToLaD#359): into exactly the item it stands for, its frame (runFrame:
   * its territory filling the screen, from where its strands meet to "now"), where the cut one step finer shows its
   * labels; one species, its landing and card.
   *
   * An item that does not split at its own frame (one label there: as "Cats +50" at the cats' home, the house cat's
   * column taking the width; or the one the view already frames) goes to its next split, the zoom where the cut first
   * makes it two or more items (its active range's end, Been et al.), its pieces' labels (where each stands there)
   * centred on the screen: no padding, no side. Every tap goes one step finer, and every species is reached by taps on
   * names.
   */
  tapItem(f: number, l: number): void {
    const T = this.territories().t;
    const cur = this.anim && this.backing ? this.backing.cam : this.cam;
    // (Where it came from: the frame the view is at (a flight's under way, where it lands), the level there and, where
    // a tap landed it, that tap's own record.)
    const here = this.landedHere();
    const back: TapAt['back'] = {
      at: here ? this.tapAt : null,
      lv: here ? (this.tapAt!.v ? { v: this.tapAt!.v } : { b: this.tapAt!.b! }) : this.anim && this.backing ? this.backing.lv : this.levelNow(true),
      cam: { ...cur },
    };
    const go = (cam: Camera, again: () => Camera, v: FanNode) => {
      this.selected = null;
      this.touch = null;
      this.onSelect(null);
      this.flyTo(again, undefined, () => (this.tapAt = { b: null, v, cam: { ...this.cam }, back }));
      this.backing = { lv: { v }, cam };
    };
    if (f === l) {
      const b = T.strands[f];
      this.goLevel({ b }, this.frameOf({ b }));
      return;
    }
    const v = this.meetOf(f, l);
    const whole = v.strands[0].index === f && v.strands[v.strands.length - 1].index === l;
    const top = (whole && fossilTop(this.fan, v)) || this.yNow;
    const keep = this.fan.tess.fold?.keep();
    const cam = this.runFrame(f, l, v.y, v, top);
    if (this.offBy(cam, cur) > LEVEL_PX && this.labelsIn(cam, f, l) > 1) {
      keep?.();
      go(cam, () => this.runFrame(f, l, v.y, v, top), v);
      return;
    }
    // (Its next split (its active range's end): the least rung of the cut's ladder (LADDER) past its frame's zoom where
    // the cut makes it two or more items, each rung tried a cut of the item alone (piecesAt: its own nodes and a path
    // down to them, never the tree). The cut only splits items as the zoom grows, so it is a search on a bracket, a
    // rung known whole (a) and one known split (b). Each rung found whole says where it surely splits: a territory on
    // screen only widens with the zoom (a daughter whose territory is w world wide holds the label by zoom PIC_D / w),
    // and the item splits once a sister riding with it fits or two of its head's daughters do. That rung tried, then the
    // one under it: two cuts where the guess is tight; a gallop up and a bisection back where it is not.)
    const kMax = Math.floor(Math.log2(cam.sx) * LADDER) + 64 * LADDER;
    let [a, b, dk, g, tight] = [kMax - 64 * LADDER, kMax + 1, 1, Infinity, false];
    const splits = (k: number): boolean => {
      const P = this.piecesAt(f, l, v, Math.pow(2, k / LADDER));
      if (P.length !== 1) return P.length > 1;
      const it = P[0];
      const at = (q: number) => {
        const t = T.terr.get(q);
        return t && t[1] > t[0] ? PIC_D / (t[1] - t[0]) : Infinity;
      };
      const kids = it.head >= 0 ? Array.from(T.kids[it.head], at).sort((p, q) => p - q) : [];
      g = Math.ceil(Math.log2(Math.min(kids[1] ?? Infinity, ...it.parts.filter((q) => q !== it.head).map(at))) * LADDER);
      return false;
    };
    while (b - a > 1) {
      let m: number;
      if (tight) m = b - 1;
      else if (g > a && g < b) m = g;
      else if (b > kMax) [m, dk] = [Math.min(kMax, a + dk), dk * 2];
      else m = (a + b) >> 1;
      if (splits(m)) [b, tight] = [m, m === g && !tight];
      else [a, tight] = [m, false];
    }
    if (b > kMax) {
      // (No zoom splits it (a fossil too short-lived for a label of its own beside its sister): the species that never
      // gets one, its least populous (its name is its most populous's), landed on.)
      keep?.();
      let nb = f;
      for (let i = f; i <= l; i++) if (groupAlive({ b: T.strands[i] }) < groupAlive({ b: T.strands[nb] })) nb = i;
      const sp = T.strands[nb];
      this.goLevel({ b: sp }, this.frameOf({ b: sp }));
      return;
    }
    // (Its pieces there framed: a piece's label shows where its territory's part on screen holds it (cutLabels), so
    // the screen's span L..L + W shows piece [x0, x1] when x0 + d - W <= L <= x1 - d. The most pieces (then species)
    // some L shows, at the middle of the L's that show them all: where the void between their territories is wider
    // than the screen, as much of the item a step finer as one screen holds. One rung past the split: at the split
    // itself a piece just holds its label, and the landing's cut can lose it.)
    const zs = Math.pow(2, (b + 1) / LADDER);
    const Q = this.piecesAt(f, l, v, zs);
    const W = (this.w - LABEL_AXIS_X) / zs;
    const d = PIC_D / zs;
    let [lo, hi, best, most] = [0, 0, 0, 0];
    for (const at of Q) {
      const L1 = at.x1 - d;
      const S = Q.filter((q) => q.x1 - d >= L1 && q.x0 + d - W <= L1);
      const n = S.reduce((c, q) => c + q.l - q.f + 1, 0);
      if (S.length > best || (S.length === best && n > most)) {
        [best, most] = [S.length, n];
        [lo, hi] = [Math.max(...S.map((q) => q.x0 + d - W)), Math.min(...S.map((q) => q.x1 - d))];
      }
    }
    const mid = (lo + hi) / 2 + W / 2;
    const again = () => this.labelsFrame(f, l, v, zs, mid);
    const ecam = again();
    keep?.();
    go(ecam, again, v);
  }

  /**
   * The labels camera `cam` would show (cutLabels; `whole`: the whole cut, not only the screen's, or with `win` only
   * what meets world x win[0]..win[1]), measured as its
   * landing draws them: the fold at its zoom and on its rows' grid (foldTo; the territories over rows are the
   * grid's), the fold's grid and the view put back after, its zoom left at cam's.
   */
  private labelsAt(cam: Camera, whole = false, win?: [number, number]): CutLabels {
    const [keep, pics] = [this.cam, this.picSpots];
    const fold = this.fan.tess.fold;
    const grid = fold?.gridH;
    this.cam = cam;
    if (fold) this.foldTo(fold);
    const c = this.cutLabels(this.territories(), this.labelTop(), whole, win);
    if (fold && grid !== undefined) fold.setGrid(grid);
    [this.cam, this.picSpots] = [keep, pics];
    return c;
  }

  /** The cut items strands f..l make at zoom `z` (the whole cut, not only the screen's; the fold left at z), left to right. */
  private piecesAt(f: number, l: number, v: FanNode, z: number): CutItem[] {
    const cam = this.labelsFrame(f, l, v, z, 0);
    // (The cut over the item's own territory only (its pieces' are inside it): what the whole cut makes of it, at the
    // cost of its own nodes and a path down to them, Territories.cut.)
    return this.labelsAt(cam, true, this.runSpan(f, l, [0, 0])).all.filter((it) => it.l >= f && it.f <= l);
  }

  /** Strands f..l at width zoom `z`, world x `mid` at the middle of the labels' width (LABEL_AXIS_X to the edge), from where they meet in clade v to "now". */
  private labelsFrame(f: number, l: number, v: FanNode, z: number, mid: number): Camera {
    this.fan.tess.fold?.setScale(z, this.w);
    const [a, b] = this.runSpan(f, l, [0, 0]);
    // (Its band in time as at the middle of its territory, wherever `mid` puts it: the labels' rows, and so their
    // territories and the cut, are the same at every mid, so its pieces measured at one are its landing's at another.)
    const cam = this.withBand({ ...this.camera.frame(a, b, v.y, true), sx: z, cx: (a + b) / 2 - LABEL_AXIS_X / 2 / z }, v, this.yNow);
    return { ...cam, cx: mid - LABEL_AXIS_X / 2 / z };
  }

  /** How many labels camera `cam` shows for strands f..l (the cut there, on screen; the fold at cam's zoom). */
  private labelsIn(cam: Camera, f: number, l: number): number {
    return this.labelsAt(cam).items.filter((it) => it.f >= f && it.l <= l).length;
  }

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

  /** The "+x" badge under (x, y) (ToLaD#197): its own part of the pill (the name before it is the group's, a level deeper). */
  private plusAt(x: number, y: number) {
    return this.plusHits.find(({ badge: q }) => x >= q[0] - 8 && x <= q[2] + 8 && y >= q[1] - 4 && y <= q[3] + 4);
  }

  /** The species' or family's name pill nearest (x, y) within a finger's slack (ToLaD#230, #212), the one under it first. */
  private pillAt(x: number, y: number): { b?: FanBranch; v?: FanNode; run?: Run } | null {
    let pill: { b?: FanBranch; v?: FanNode; run?: Run } | null = null;
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
      if (plus.run) this.tapItem(...plus.run);
      else this.flyToGroup(plus.bs);
      return;
    }
    const pill = pinned ? null : this.pillAt(x, y);
    const pic = pinned || pill ? null : this.picAt(x, y);
    // A cut item's label (ToLaD#359): into the item it stands for.
    const run = pill?.run ?? pic?.[5];
    if (run) {
      this.tapItem(...run);
      return;
    }
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
    // The time touched, kept within the strand (from its tip down to the bottom of the world).
    const wy = Math.min(this.fan.trunkBottom.y, this.toWorld(x, y)[1]);
    const ageMa = b ? Math.max(b.sp.t1, this.fan.time.ageAt(wy)) : undefined;
    this.touch = b && ageMa !== undefined ? { x: this.toWorld(x, y)[0], ageMa } : null;
    // Below its split: the parent column, the lineage there (unless an individual was hit).
    const lineage = b && ageMa !== undefined && wy >= b.splitY ? lineageAt(b, this.fan, ageMa) : undefined;
    // Inside a curated event's window on its own column (or within a finger's reach of it): the card explains it.
    let event: EventSpan | undefined;
    if (b && ageMa !== undefined && !lineage) {
      const r = EVENT_REACH_PX / this.cam.sy;
      const a0 = this.fan.time.ageAt(Math.max(b.tipY, wy - r)) * 1e6;
      const a1 = this.fan.time.ageAt(Math.min(this.fan.trunkBottom.y, wy + r)) * 1e6;
      event = eventAt(colEventsY(this.fan, b), ageMa * 1e6, Math.min(a0, a1), Math.max(a0, a1)) ?? undefined;
    }
    this.onSelect(b ? { sp: b.sp, ageMa, startMa: b.t0, lineage, event } : null);
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
    // (The mammal level, lod.ts: a closed clade of hairline strands drawn as its one branch, its columns inside it not drawn.)
    const lod = this.lodNow();
    this.drawStem(lod);
    {
      for (const b of this.fan.branches) if (!lod || lod.of[b.index] < 0) this.drawStrand(b);
      if (lod) for (const v of lod.merged) this.drawMerged(v);
    }
    this.drawHeld();
    this.drawEvents();
    this.drawStemFade();
    this.drawGutter();
    this.drawTouch();
    const tl = performance.now();
    // (The labels on the same frame as the tree, the first one too: the cut decides them each frame, ToLaD#333.)
    const { br, cut } = this.labelsNow();
    this.drawLabels(cut, br);
    br?.drawPins(this.ctx, FAMILY_INK, INK3, BG);
    this.labelAllMs.push(performance.now() - tl);
    if (this.labelAllMs.length > 600) this.labelAllMs.shift();
    this.drawWidthScale();
    if (this.debug) this.drawDebug();
    this.drawTrunkLabel();
    this.drawTimeAxis(true);
    drawWorldOver(this);
    if (this.gl) {
      this.gl.end(this.w, this.h, this.dpr);
    }
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
    if (this.frameMs.length <= 2) stamp(this.frameMs.length === 1 ? 'first' : 'second');
  }

  /**
   * The labels' spots and the brackets' stack this frame (ToLaD#333): from the cut, every frame. No carry, no pass at
   * rest, no hysteresis: what shows and where is a function of the camera alone.
   */
  private labelsNow(): { br: Brackets | null; top: number; cut: CutLabels } {
    const t0 = performance.now();
    const T = this.territories();
    if (this.brackets) this.brackets.spanOf = (v) => T.spanOf(v);
    const br = this.layoutBrackets();
    const top = this.labelTop() + (br ? br.pinH() * br.pinA : 0);
    const cut = (this.cutLast = this.cutLabels(T, top));
    this.topLast = top;
    this.labelMs.push(performance.now() - t0);
    if (this.labelMs.length > 600) this.labelMs.shift();
    return { br, top, cut };
  }
  /** This fan's territories at this screen width (ToLaD#333; the fold is always the steady one, withFold). */
  private terr: { fan: Fan; fold: unknown; w: number; t: CutTerritories } | null = null;
  private territories(): CutTerritories {
    const f = this.fan.tess.fold as Steady;
    const P = this.terr;
    if (P && P.fan === this.fan && P.fold === f && P.w === this.w) return P.t;
    const t = new CutTerritories(this.fan, f, this.w);
    this.terr = { fan: this.fan, fold: f, w: this.w, t };
    return t;
  }
  /** The last labels from the cut (tests read it). */
  cutLast: CutLabels | null = null;
  /** ...and the labels' top line it held them under (screen y: under the buttons and the pinned rows; tests read it). */
  topLast = 0;
  /** The labels over the whole tree at this camera, nothing culled for the screen (ToLaD#358's invariants, tests). */
  wholeLabels(): CutLabels {
    const f = this.fan.tess.fold;
    if (f) this.foldTo(f);
    return this.cutLabels(this.territories(), -Infinity, true);
  }

  /**
   * This frame's labels (ToLaD#358, research/scalable-tree.md §3): one cut through the tree at the label's width (a
   * picture's, PIC_D, its widest part), one label per item: its picture standing on the item's youngest tip (PIC_LIFT
   * over it; held under the top line when the tip is above it) and its name pill right under it, one unit at a fixed
   * offset from the tip, over one x (faceX), inside the item's territory over the rows they take (Territories.over:
   * the row's lineages split x between them, a lineage keeping its place a picture's height over its tip), so labels
   * of different items never meet, by construction. The label names the most populous clade or species the item stands
   * for (CutTerritories.nameOf), its picture that one's most populous living species (a placeholder disc where it has
   * no photo), its "+x" the item's other species. Shown whole, picture and name together, or not at all. `whole`: over
   * the whole tree, nothing culled for the screen (tests).
   */
  private cutLabels(T: CutTerritories, top: number, whole = false, win?: [number, number]): CutLabels {
    const half = LABEL_PILL / 2;
    const X = (x: number) => this.toScreen(x, 0)[0];
    const Y = (y: number) => this.toScreen(0, y)[1];
    const Wy = (y: number) => this.toWorld(0, y)[1];
    const left = whole ? -Infinity : LABEL_AXIS_X;
    const right = whole ? Infinity : this.w;
    const vx0 = win ? win[0] : whole ? -Infinity : this.toWorld(left, 0)[0];
    const vx1 = win ? win[1] : whole ? Infinity : this.toWorld(right, 0)[0];
    const sx = this.cam.sx;
    const spots: LabelSpot[] = [];
    const pics: CutLabels['pics'] = [];
    const shown: CutItem[] = [];
    const groups = new Map<string, FanBranch[][]>();
    const bottom = whole ? Infinity : this.h - LABEL_BOTTOM_PX + 30;
    // (A lineage keeps its place over its tip as high as a picture stands: the pictures' rows are in the partition too.)
    const ghost = (PIC_LIFT + PIC_D) / this.cam.sy;
    /**
     * An item's centre (screen x) for a box `d` wide: at `cx` (screen x), the territory [x0, x1] (world) only bounding
     * it: inside its territory always (it fits there), on screen as well where the territory's part on screen holds it.
     */
    const placeX = (x0: number, x1: number, d: number, cx: number): number => {
      const l = X(x0) + d / 2;
      const r = X(x1) - d / 2;
      const lo = Math.max(l, left + d / 2);
      const hi = Math.min(r, right - d / 2);
      const x = lo <= hi ? Math.min(Math.max(cx, lo), hi) : Math.min(Math.max(cx, hi), lo);
      return Math.min(Math.max(x, l), r);
    };
    /**
     * Item r's label, one unit at the youngest tip of its head climbed (CutTerritories.whole: a clade's own, whether it
     * is one item or her daughter with her sisters riding on her): its name, its picture's rows (screen y) PIC_LIFT over
     * the tip, and its name pill's right under the picture (Ita, ToLaD#358: "A"), the text sideways as ever. Its rows are
     * a fixed offset from the tip: the time zoom and pan move the unit rigidly, nothing in it depends on the branch's
     * part on screen.
     */
    const memo = new Map<string, { name: ItemName; disc: [number, number]; pill: [number, number] }>();
    const at = (r: Ref & { parts?: readonly number[] }) => {
      const k = T.whole(r.head, r.f, r.l);
      const key = `${k}:${r.f}:${r.l}`;
      let m = memo.get(key);
      if (!m) {
        const name = T.nameOf(r);
        const ty = Y(T.youngOf(k));
        const tlen = this.nameWidth(name.text) + 2 * LABEL_PAD + this.plusPx(name.hid.length);
        // (Its picture over its tip, or with the tip above the top line, held under it, its name right below: a label
        // stays whole on screen while its branch is, scrolled into the past too.)
        const d0 = Math.max(ty - PIC_LIFT - PIC_D, top);
        const p0 = d0 + PIC_D + LABEL_UNDER;
        m = { name, disc: [d0, d0 + PIC_D], pill: [p0, p0 + tlen] };
        memo.set(key, m);
      }
      return m;
    };
    const rows: RowsOf = (r) => {
      const { disc, pill } = at(r);
      return [Wy(disc[0]), Wy(disc[1]), Wy(pill[0]), Wy(pill[1])];
    };
    /**
     * Item it's label's place (screen x) before its territory and the screen bound it: its picture's species' column at
     * "now", walked up from that species through the item's clades it is in to the first whose territory holds the
     * label (each over its own label's rows, as the cut tries it), clamped into that; each narrower one on the way
     * gives its middle. A clade starts to fit, and is cut off as an item of its own, when its territory is just the
     * label's width: the place is its middle on both sides of the cut, so a label moves with the zoom continuously
     * through a split (ToLaD#333's handoff, #358; exactly where territories nest, under widest rooms).
     */
    const cell: [number, number] = [0, 0];
    const faceX = (it: CutItem, face: FanBranch): number => {
      const { index, first, last } = T.t;
      let cx = X(groupCentre({ b: face }));
      let r = T.t.refOf(~face.index);
      for (let u: FanNode | null = face.node; ; ) {
        T.t.over(r, rows, ghost, cell);
        if (cell[1] >= cell[0]) {
          const l = X(cell[0]) + PIC_D / 2;
          const h = X(cell[1]) - PIC_D / 2;
          if (l <= h) return Math.min(Math.max(cx, l), h);
          cx = (l + h) / 2;
        }
        const j = u ? index.get(u) : undefined;
        if (!u || j === undefined || first[j] < it.f || last[j] > it.l) return cx;
        r = T.t.refOf(j);
        u = u.parent;
      }
    };
    const cut = T.t.cut(sx, PIC_D, vx0, vx1, rows, ghost);
    for (const it of cut) {
      // (Only the root, before anything fits, does not hold its label.)
      if (!it.fits) continue;
      const { name, disc, pill } = at(it);
      // (Whole on screen or not at all: its territory's part on screen holds it, its picture under the top line.)
      if (!whole && (Math.min(X(it.x1), right) - Math.max(X(it.x0), left) < PIC_D * (1 - 1e-9) || disc[1] > this.h)) continue;
      const fit = clamp01((bottom - pill[1]) / 30);
      if (!(fit > 0)) continue;
      const x = placeX(it.x0, it.x1, PIC_D, faceX(it, name.face));
      const key = `c${it.f}:${it.l}`;
      if (name.hid.length) groups.set(key, name.hid);
      const s: LabelSpot = { key, id: key, run: [it.f, it.l], place: 'tip', text: name.text, rank: [0, it.x1 - it.x0, it.head], x, y1: pill[1], box: [x - half, pill[0], x + half, pill[1]], fit, plus: this.plusPx(name.hid.length), pic: name.face };
      // (What it opens, its head climbed: the clade or species of the tree it is; a tap on it, name, picture or "+x",
      // goes into the item itself, tapItem, ToLaD#359.)
      const k = T.whole(it.head, it.f, it.l);
      const lv: Level = k < 0 ? { b: T.t.strands[~k] } : { v: T.t.nodes[k] };
      if (lv.b) s.b = lv.b;
      else Object.assign(s, { v: lv.v, fam: lv.v });
      spots.push(s);
      pics.push({ x, y: (disc[0] + disc[1]) / 2, d: PIC_D, i: pics.length, lv, face: name.face, run: [it.f, it.l] });
      shown.push(it);
    }
    if (!whole) this.picSpots = pics;
    return { spots, groups, pics, items: shown, all: cut };
  }

  /** The labels' and brackets' work per frame (ms, labelsNow; the pictures' and fades' in drawLabels not counted). */
  readonly labelMs: number[] = [];
  /** ...and with drawLabels' (the fades, the pictures, the "+x", the pills drawn) and the pinned rows'. */
  readonly labelAllMs: number[] = [];

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
    this.drawLanes(pts, hw, held);
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
    this.drawLanes(pts, 0, NO_HELD);
  }
  private mergedExt: [number, number] = [0, 0];
  private lodTops = new WeakMap<FanNode, number>();
  private lodTop(v: FanNode): number {
    let t = this.lodTops.get(v);
    if (t === undefined) this.lodTops.set(v, (t = Lod.top(v)));
    return t;
  }

  /** A column's lanes (drawStrand's, or a merged clade's, lod.ts): its points, spine offset hw, styled spans and twig fade. */
  private drawLanes(pts: LanePts, hw: number, held: [number, number, number][]): void {
    const ctx = this.ctx;
    // On the GPU layer each stretch sinks to a dark tint of itself by its own lanes' widths (twigs.ts laneDim).
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
        const gc = mixInto(GC_MIX, GRAY01, GRAY_DARK01, laneDim(wm - gm) * 0.82);
        const ec = mixInto(EC_MIX, GREEN01, GREEN_DARK01, laneDim(gm) * 0.9);
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
          const glow = (1 - dim) * Math.min(1, gm / GLOW_W) * Math.max(0, 1 - (sq - 1) / GLOW_LEAN);
          if (glow > 0.01) {
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
      ctx.fillStyle = GRAY;
      this.ribbon(pts, (i) => hw - pts.w[i], () => hw, 0.6);
      if (pts.f.subarray(0, pts.n).some((f) => f > 0)) {
        // Green lane on the left, floored at 1 px.
        ctx.fillStyle = GREEN;
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
    if (!b || !t) return;
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

  /** This frame's pictures (cutLabels), each with the level or species it opens. */
  picSpots: (PicSpot & { lv: Level; face: FanBranch; run?: Run })[] = [];

  /** Draw this frame's pictures (cutLabels). Each a tap to its group. */
  private drawGroupPics(): void {
    const ctx = this.ctx;
    const alpha = 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = INK3;
    ctx.lineWidth = 1;
    // (Hits: the one on top found first.)
    for (const p of [...this.picSpots].reverse()) this.thumbHits.push([p.x, p.y, p.d / 2, p.face, p.lv.v, p.run]);
    // (Its placeholder at once, the picture fading in when loaded; what a tap would show next fetched ahead, ToLaD#351.)
    for (const p of this.picSpots) drawPic(ctx, p.face.sp.sci, p.x, p.y, p.d, () => this.request());
    prefetchPics(this.picSpots.flatMap((p) => (p.lv.v ? nextFaces(this.fan, p.lv.v) : [])));
    ctx.restore();
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
   * This frame's labels (cutLabels): the brackets, the pictures, the name and "+x" pills. Each drawn whole where the
   * cut puts it, no fade (a fit fades it only at the legend at the bottom: `fit`).
   */
  private drawLabels(cut: CutLabels, br: Brackets | null): void {
    const ctx = this.ctx;
    const { spots, groups, pics } = cut;
    this.famHits.length = 0;
    this.nameHits.length = 0;
    this.plusHits.length = 0;
    this.eventLabels.length = 0;
    this.thumbHits.length = 0;
    // The clades' brackets (ToLaD#193) under the pills: their labels clear of the pills and pictures, their lines behind them.
    br?.draw(ctx, FAMILY_INK, INK3, [...spots.filter((s) => s.fit > 0.3).map((s) => s.box), ...pics.map((p) => [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2])]);
    this.drawGroupPics();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(LABEL_FONT);
    for (let k = 0; k < spots.length; k++) {
      const s = spots[k];
      const alpha = s.fit;
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
        if (alpha > 0.5) this.famHits.push({ box: [x0, y0, x1, y1], v: s.fam, run: s.run });
      } else if (s.b && s.ev === undefined && !s.v && alpha > 0.5) this.nameHits.push({ box: [x0, y0, x1, y1], b: s.b, run: s.run });
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
        if (alpha > 0.5) this.plusHits.push({ box: [x0, y0, x1, y1], badge: [x0, y0, x1, y1 - LABEL_PAD - nx + PLUS_GAP / 2], bs, run: s.run });
      }
      ctx.restore();
    }
    ctx.restore();
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
    const unitPx = this.fan.branches[0].unit * this.cam.sx; // px per individual (linear) or per decade (log); per kg by mass
    const target = 70;
    const mass = this.measure === 'mass';
    // (By mass, ToLaD#276: kg, said in tonnes from one tonne up.)
    const say = (n: number) => (mass ? formatMass(n, { exact: true }) : `${formatCount(n, { exact: true })} ${n === 1 ? 'individual' : 'individuals'}`);
    if (this.mode === 'linear') {
      const per = 1 / unitPx; // individuals (kg) per px
      const n = Math.max(mass ? 0.001 : 1, niceStep(target * per));
      const px = n / per;
      return { px, label: say(n) };
    }
    if (unitPx <= target * 2.5) {
      // (Width 1 + k for 10^k: the k nearest the bar's length in ratio, within 0..10.)
      let k = 0;
      for (let j = 1; j <= 10; j++) if (Math.abs(Math.log((1 + j) * unitPx / target)) < Math.abs(Math.log((1 + k) * unitPx / target))) k = j;
      const n = 10 ** k;
      return { px: (1 + k) * unitPx, label: `${say(n)} · log widths` };
    }
    const fct = Math.pow(10, target / unitPx);
    return { px: target, label: `×${fct < 1.1 ? fct.toFixed(4) : fct.toFixed(2)} ${mass ? 'the mass' : 'individuals'} a bar wider · log widths` };
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
      `${this.mode === 'linear' ? `${perPx.toPrecision(3)} ${this.measure === 'mass' ? 'kg' : 'individuals'}/px` : `${perPx.toPrecision(3)} log units/px`}`,
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
