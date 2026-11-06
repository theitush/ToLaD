/**
 * The clades' brackets above "now" (ToLaD#193): a stack of nested brackets, each spanning one clade's columns
 * (genus, subfamily, family, superfamily or suborder, order), the innermost nearest the line. Each is named in
 * plain English where there is a name (Big cats, Cats, Cat-like carnivores…) with the Latin as a hint; where its
 * span is too narrow for that it is the Latin or the English alone, then a plain tick, then nothing.
 *
 * The ranks come from the data's taxonomy (the dated tree's taxon names, splits.ts): a rule by the Latin ending
 * plus a small name map, no per-species lists. Drawn on the 2D overlay. A frame costs the clades' spans (one pass
 * over the species at "now") and a pass over the clades; the rows are kept per zoom bucket (they move only as
 * the zoom moves, never while panning), the label widths once per text.
 */
import type { Camera } from './camera';
import { laneW, leftAt, nodeLeftAt, type Fan, type FanNode } from './layout';
import { FAMILY_EN, ORDER_EN, ORDER_TAXA, type Split } from './splits';

// (FORKNAMES=off in the environment: the test files' run with the switch off.)
let forkNow = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FORKNAMES !== 'off';
/** The switch (ToLaD#373, `?forknames=off`, the button in FanApp): the stack's clades named at their forks, or the stack. What the views built from now on use. */
export function setForkNames(on: boolean): void {
  forkNow = on;
}
export const forkNames = (): boolean => forkNow;
// (FORKNAMES=leaders in the environment: the test files' run with the leaders on.)
let forkLeadNow = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FORKNAMES === 'leaders';
/** The names at their forks stand off on leaders (ToLaD#434, `?forknames=leaders`, the button in FanApp), a look to try; only placeForks reads it, so no new view. */
export function setForkLeaders(on: boolean): void {
  forkLeadNow = on;
}
export const forkLeaders = (): boolean => forkLeadNow;

export type CladeRank = 'genus' | 'subfamily' | 'family' | 'superfamily' | 'suborder' | 'order';

/** The Latin name the data gives a split, cleaned of a disambiguation ("Prionodon (genus in Opisthokonta)"). */
export function latinOf(s: Split): string {
  return (s.taxon ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
}

/** A taxon's rank by its ending (ICZN: -idae family, -inae subfamily, -oidea superfamily; -formia a suborder; one word otherwise a genus). */
export function rankOf(latin: string): CladeRank | null {
  if (!/^[A-Z][a-z]+$/.test(latin)) return null;
  if (ORDER_TAXA.has(latin) && !/idae$/.test(latin)) return 'order';
  if (/idae$/.test(latin)) return 'family';
  if (/inae$/.test(latin)) return 'subfamily';
  if (/oidea$/.test(latin)) return 'superfamily';
  if (/formia$/.test(latin)) return 'suborder';
  return 'genus';
}

/** Plain English names for the taxa above the species (the families' are splits.ts FAMILY_EN). A taxon not here keeps its Latin. */
export const TAXON_EN: Record<string, string> = {
  ...FAMILY_EN,
  // (The mammal orders, ToLaD#247.)
  ...ORDER_EN,
  Carnivora: 'Carnivores',
  // (Above the orders, ToLaD#440: an everyday name, or what the group is; a group with neither keeps its real one.)
  Theria: 'Marsupials & placentals',
  Metatheria: 'Marsupials',
  Eutheria: 'Placentals',
  Atlantogenata: 'Atlantogenata',
  Xenarthra: 'Armadillos & sloths',
  Afrotheria: 'Afrotherians',
  Paenungulata: 'Elephants, sea cows & hyraxes',
  Afroinsectiphilia: 'Aardvark, tenrecs & kin',
  Boreoeutheria: 'Boreoeutherians',
  Laurasiatheria: 'Laurasiatherians',
  Scrotifera: 'Bats, hoofed mammals & carnivores',
  Fereuungulata: 'Hoofed mammals & carnivores',
  Euungulata: 'Hoofed mammals',
  Ferae: 'Carnivores & pangolins',
  Euarchontoglires: 'Primates, rodents & kin',
  Euarchonta: 'Primates & treeshrews',
  Glires: 'Rodents & rabbits',
  Australidelphia: 'Australidelphians',
  // (Primates, ToLaD#275: the splits Open Tree names above and between their families.)
  Strepsirrhini: 'Lemurs & lorises',
  Lorisiformes: 'Lorises & galagos',
  Lemuriformes: 'Lemurs',
  Haplorhini: 'Tarsiers, monkeys & apes',
  Tarsiiformes: 'Tarsiers',
  Simiiformes: 'Monkeys & apes',
  Platyrrhini: 'New World monkeys',
  Catarrhini: 'Old World monkeys & apes',
  Cercopithecoidea: 'Old World monkeys',
  Colobinae: 'Leaf monkeys',
  Cercopithecinae: 'Cheek-pouch monkeys',
  Callitrichinae: 'Marmosets & tamarins',
  Homininae: 'African great apes',
  Hominini: 'Hominins',
  Homo: 'Humans',
  Pan: 'Chimpanzees',
  Gorilla: 'Gorillas',
  Pongo: 'Orangutans',
  Macaca: 'Macaques',
  Feliformia: 'Cat-like carnivores',
  Caniformia: 'Dog-like carnivores',
  Felinae: 'Small cats',
  Pantherinae: 'Big cats',
  Viverrinae: 'Civets',
  Hemigalinae: 'Banded palm civets',
  Galidiinae: 'Malagasy mongooses',
  Melinae: 'Badgers',
  Lutrinae: 'Otters',
  Guloninae: 'Martens & wolverine',
  Panthera: 'Roaring cats',
  Neofelis: 'Clouded leopards',
  Leopardus: 'Ocelot cats',
  Prionailurus: 'Leopard cats',
  Felis: 'Wildcats',
  Lynx: 'Lynxes',
  Puma: 'Pumas',
  Paradoxurus: 'Palm civets',
  Viverra: 'Oriental civets',
  Poiana: 'Oyans',
  Galidictis: 'Striped mongooses',
  Bdeogale: 'Bushy-tailed mongooses',
  Urva: 'Asian mongooses',
  Mungos: 'Banded mongooses',
  Crossarchus: 'Kusimanses',
  Helogale: 'Dwarf mongooses',
  Prionodon: 'Linsangs',
  Urocyon: 'Grey foxes',
  Zalophus: 'Zalophus sea lions',
  Mirounga: 'Elephant seals',
  Procyon: 'Raccoons',
  Bassariscus: 'Ringtails',
  Nasuella: 'Mountain coatis',
  Bassaricyon: 'Olingos',
  Meles: 'Eurasian badgers',
  Melogale: 'Ferret-badgers',
  Lontra: 'New World otters',
  Lutra: 'Old World otters',
  Conepatus: 'Hog-nosed skunks',
  Mephitis: 'Striped skunks',
  Spilogale: 'Spotted skunks',
  Mydaus: 'Stink badgers',
};

/** Shorter English for the long names, where a bracket has no room for the whole (else it is a tick). */
export const TAXON_SHORT: Record<string, string> = {
  Feliformia: 'Cat-like',
  Caniformia: 'Dog-like',
  Hemigalinae: 'Palm civets',
  Galidiinae: 'Mongooses',
  Bdeogale: 'Mongooses',
  Galidictis: 'Mongooses',
};

export interface Clade {
  v: FanNode;
  latin: string;
  /** Its English name, null if it has none (the Latin then stands alone). */
  en: string | null;
  rank: CladeRank;
  /** Index (in the list) of the nearest clade it sits in, -1 for none. Parents come before their daughters. */
  parent: number;
  /** Its species' positions in the fan's branches. */
  strands: number[];
}

const cladeCache = new WeakMap<Fan, Clade[]>();
/** The fan's ranked clades (every split with a taxon that has a rank), parents first. */
export function clades(fan: Fan): Clade[] {
  let out = cladeCache.get(fan);
  if (out) return out;
  out = [];
  const at = new Map<FanNode, number>();
  const pos = new Map(fan.branches.map((b, i) => [b, i]));
  for (const v of fan.nodes) {
    const latin = latinOf(v.split);
    const rank = rankOf(latin);
    if (!rank) continue;
    let p = v.parent;
    while (p && !at.has(p)) p = p.parent;
    at.set(v, out.length);
    out.push({ v, latin, en: TAXON_EN[latin] ?? null, rank, parent: p ? at.get(p)! : -1, strands: v.strands.map((b) => pos.get(b)!) });
  }
  cladeCache.set(fan, out);
  return out;
}

/** The deepest nesting of the fan's clades (rows a stack of all of them takes). */
export function bandDepth(fan: Fan): number {
  const list = clades(fan);
  const d = new Int16Array(list.length);
  let most = 0;
  list.forEach((q, i) => {
    d[i] = q.parent >= 0 ? d[q.parent] + 1 : 1;
    most = Math.max(most, d[i]);
  });
  return most;
}

/** Row height (px) of the stack, the font; a row of ticks alone (no name in it on screen) takes TICK_ROW_H, an empty one none. */
export const ROW_H = 14;
export const TICK_ROW_H = 6;
/** The least span (px) a bracket is drawn at. */
export const TICK_MIN = 3;
/** Room (px) kept clear each side of a label inside its bracket, and the gap between neighbouring brackets in a row. */
const LABEL_PAD = 5;
const GAP = 2;

export type Form = 'full' | 'name' | 'short' | 'tick';

export interface Placed {
  /** Index of the clade (clades()). */
  i: number;
  /** Its bracket's ends (screen x, inset by half a gap) and its row (0 = just above "now"). */
  a: number;
  b: number;
  row: number;
  form: Form;
  /** Where its label is centred (screen x) and its width, for a label form. */
  lx: number;
  lw: number;
}

/**
 * Lay the stack out (pure; brackets.test.ts): `a`/`b` the clades' screen spans, `parent` each one's enclosing clade
 * (parents before daughters), `widths(i)` its labels' widths [full, name, short]. A clade is shown when its span is at least
 * TICK_MIN px; its row is one above the highest row shown inside it (`rows`, when given, fixes them instead: the
 * zoom bucket's), so a bracket always stands above the brackets nested in it. Its label goes in the part of the span
 * on screen between `x0` and `x1`, centred there, the full one if it fits, else the name alone, else a short name, else a tick.
 */
export function layoutBrackets(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  parent: ArrayLike<number>,
  widths: (i: number) => [number, number, number],
  x0: number,
  x1: number,
  rows?: Int16Array,
): Placed[] {
  const n = a.length;
  const row = rows ?? bracketRows(a, b, parent);
  const out: Placed[] = [];
  for (let i = 0; i < n; i++) {
    if (row[i] < 0) continue;
    const pa = a[i] + GAP / 2;
    const pb = b[i] - GAP / 2;
    if (pb < x0 - 4 || pa > x1 + 4 || !(pb - pa >= TICK_MIN - GAP)) continue;
    const va = Math.max(pa, x0);
    const vb = Math.min(pb, x1);
    const room = vb - va - 2 * LABEL_PAD;
    const [wf, wn, ws] = widths(i);
    const form: Form = wf <= room ? 'full' : wn <= room ? 'name' : ws > 0 && ws <= room ? 'short' : 'tick';
    const lw = form === 'full' ? wf : form === 'name' ? wn : form === 'short' ? ws : 0;
    out.push({ i, a: pa, b: pb, row: row[i], form, lx: (va + vb) / 2, lw });
  }
  return out;
}

/** Each clade's row (−1: not shown): one above the highest shown inside it, so nesting always reads bottom-up. */
export function bracketRows(a: ArrayLike<number>, b: ArrayLike<number>, parent: ArrayLike<number>): Int16Array {
  const n = a.length;
  const row = new Int16Array(n).fill(-1);
  const inner = new Int16Array(n).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    if (b[i] - a[i] >= TICK_MIN) row[i] = inner[i] + 1;
    const p = parent[i];
    if (p >= 0) inner[p] = Math.max(inner[p], row[i] >= 0 ? row[i] : inner[i]);
  }
  return row;
}

/**
 * What the stack shows at a level (ToLaD#288): its groups' brackets (the clades one level down, one row), then the
 * level itself and the familiar (English-named) levels up from it, innermost first, at most STACK_ROWS rows in all;
 * anything above them is one leading "…" (a tap: one level up). Without it, every clade (the whole nesting).
 */
export interface StackAt {
  groups: readonly FanNode[];
  up: readonly FanNode[];
}
/** Rows the stack shows at a level (ToLaD#288), its "…" over them. */
export const STACK_ROWS = 3;

/** A clade's name at its fork (ToLaD#373): the pill's centre and size on screen, what it says. */
export interface ForkName {
  i: number;
  form: Form;
  x: number;
  y: number;
  /** The pill's width (its text lw, its padding each side). */
  pw: number;
  lw: number;
  /** Its leader's near end, on its fork (ToLaD#434); NaN: no leader (the at-the-fork names, and a fork not on screen). */
  ax: number;
  ay: number;
}
/**
 * The forks' horizontals on screen this frame, for the leaders (ToLaD#434; the view's, from what it draws): a clade's
 * fork [its left, its right, its y, its parent column's centre], screen px, by node. A clade drawn as one branch has none.
 */
export interface ForkLines {
  n: number;
  /** n x [a, b, y, c]. */
  xy: number[];
  at: Map<FanNode, number>;
}
/**
 * The leaders' rays: x per y travelled, up and then down. The compass's diagonals and verticals, no due east or west: a
 * level leader would read as one more fork. Sliding along a ray from its fork is the slider model of point-feature
 * labelling: the least slide that clears moves continuously with what it clears.
 */
const FORK_RAYS: readonly (readonly [number, 1 | -1])[] = [
  [0, -1],
  [-1, -1],
  [1, -1],
  [0, 1],
  [-1, 1],
  [1, 1],
];
/** Whether segment (x0, y0)-(x1, y1) meets the box (Liang-Barsky). */
export function segMeetsBox(x0: number, y0: number, x1: number, y1: number, a: number, t: number, b: number, u: number): boolean {
  let lo = 0;
  let hi = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (d: number, q: number): boolean => {
    if (d === 0) return q > 0;
    if (d < 0) lo = Math.max(lo, q / d);
    else hi = Math.min(hi, q / d);
    return lo <= hi;
  };
  return clip(-dx, x0 - a) && clip(dx, b - x0) && clip(-dy, y0 - t) && clip(dy, u - y0);
}
/** Whether two segments cross (touching at an end counts). */
export function segsCross(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const s1 = side(a, b, c, d, e, f);
  const s2 = side(a, b, c, d, g, h);
  const s3 = side(e, f, g, h, a, b);
  const s4 = side(e, f, g, h, c, d);
  if (s1 * s2 < 0 && s3 * s4 < 0) return true;
  // (Collinear and overlapping: two leaders up the same line.)
  if (s1 === 0 && s2 === 0) return Math.max(a, c) >= Math.min(e, g) && Math.max(e, g) >= Math.min(a, c) && Math.max(b, d) >= Math.min(f, h) && Math.max(f, h) >= Math.min(b, d);
  return false;
}
/** A fork name's pill: its height, the padding each side of its text, the gap kept to what stands near it (px). */
export const FORK_H = 16;
const FORK_PAD = 5;
const FORK_GAP = 2;
/** Rows a name whose fork is below the screen's foot may climb, clear of what stands there. */
const FORK_HOLD_ROWS = 2;
/** Rows a name may slide up into its crotch, clear of what stands there. */
const FORK_SLIDE_ROWS = 3;

/** The view's side of it: what the stack needs from the camera. */
export interface BracketCam {
  toScreen(x: number, y: number): [number, number];
  readonly w: number;
  readonly cam: { sx: number };
}

/**
 * The stack for a view: its layout at this frame (over the species' pills on "now"), drawing and hits.
 */
/** Fan.branches' positions in the columns' order (FanBranch.index), kept per fan. */
const orderCache = new WeakMap<Fan, number[]>();
function drawnOrder(fan: Fan): number[] {
  let o = orderCache.get(fan);
  if (!o) orderCache.set(fan, (o = fan.branches.map((_, k) => k).sort((p, q) => fan.branches[p].index - fan.branches[q].index)));
  return o;
}

/** Each strand's width at "now" (an extinct one's at its tip), per fan (Brackets.spans). */
const nowWidths = new WeakMap<Fan, { now: number; w: Float64Array }>();
/** Per clade list (clades()): each clade's index by its node, and its parent's index. */
const cladeIndex = new WeakMap<Clade[], { at: Map<FanNode, number>; parent: Int32Array }>();

export class Brackets {
  /** `nameFont` the English names' CSS font, `latinFont` the Latin's. */
  constructor(
    readonly nameFont: string,
    readonly latinFont: string,
  ) {}
  private widthCache = new Map<string, [number, number, number]>();
  private probe = '';
  private measure: ((font: string, text: string) => number) | null = null;
  /** Per row (this frame): the height of the band under it (px above the line's base) and its own height. */
  private rowBase = new Float32Array(1);
  private rowH = new Float32Array(1);
  private rowKey = '';
  private rows: Int16Array | null = null;
  placed: Placed[] = [];
  list: Clade[] = [];
  /** This frame's names at their forks (placeForks; forks[0..forkN), kept from frame to frame, no allocation). */
  forks: ForkName[] = [];
  forkN = 0;
  /** The screen's foot the fork names stay over (the scale bar's top, screen y; the view's). */
  forkFoot = Infinity;
  private forkBox = new Float64Array(0);
  /** This frame's leaders so far, n x [fork x, y, pill x, y] (placeForks, ToLaD#434). */
  private lead = new Float64Array(64);
  private leadN = 0;
  /** The stack's foot (screen y): over the species' pills standing on "now" (Ita: the brackets above the names). */
  baseS = 0;
  fit = 1;
  /** The time axis's right edge and the screen's width (px): the lines run between them. */
  private x0 = 0;
  private w = 0;
  /** This frame's clades' screen spans, each worked out when first asked (span(); sGen[i] the frame it was). */
  private sa = new Float64Array(0);
  private sb = new Float64Array(0);
  private sGen = new Uint32Array(0);
  private spanGen = 0;
  private spanCam: BracketCam | null = null;
  private spanFan: Fan | null = null;
  /** Clade i's screen span this frame (sa[i], sb[i]): its territory (spanOf), else its species' rooms at "now" (spans()). */
  private span(i: number): void {
    if (this.sGen[i] === this.spanGen) return;
    this.sGen[i] = this.spanGen;
    const q = this.list[i];
    const t = this.spanOf?.(q.v);
    if (!t) {
      // (No territory for it: every clade's rooms, as without territories.)
      const [a, b] = this.spans(this.spanCam!, this.spanFan!);
      this.sa.set(a);
      this.sb.set(b);
      this.sGen.fill(this.spanGen);
      return;
    }
    const c = this.spanCam!;
    this.sa[i] = c.toScreen(t[0], 0)[0];
    this.sb[i] = this.hide?.(q.v) ? this.sa[i] : c.toScreen(t[1], 0)[0];
  }
  /**
   * The groups the view is inside (ToLaD#233), pinned at the top of the screen while the stack itself is off it:
   * the order on top, the innermost last (nearest the content). Their spans, labels and how much they show (pinA).
   */
  pins: Pin[] = [];
  pinTop = 0;
  pinA = 0;
  /**
   * The clades not shown (the mammal level, lod.ts: those inside a clade drawn as one branch), and a key that changes
   * with them (the rows are laid out again).
   */
  hide: ((v: FanNode) => boolean) | null = null;
  /** A clade's span (world x) in place of its species' rooms at "now" (its territory, cut.ts), or null. */
  spanOf: ((v: FanNode) => readonly [number, number] | null) | null = null;
  hideKey = '';
  /** Room (px) kept for the labels between the stack's foot and "now" (the view's: its label band's, ToLaD#373). */
  pillRoom: number = PILL_ROOM;
  /** The "…" row over the stack (ToLaD#288): its row, or -1 for none; the pinned rows' likewise (pinMore). */
  moreRow = -1;
  pinMore = false;
  private atKey: StackAt | null = null;
  private atRows = new Int16Array(0);

  /** The clades' screen spans at "now": each species' room where its column is at "now" (an extinct one's: at its tip). */
  spans(c: BracketCam, fan: Fan): [Float64Array, Float64Array] {
    const list = (this.list = clades(fan));
    const bs = fan.branches;
    const l = new Float64Array(bs.length);
    const r = new Float64Array(bs.length);
    const now = fan.time.y(0);
    const folded = !!fan.tess.fold && fan.tess.fold.left(0, now) !== null;
    // (Each strand's width where it is read, at "now" or its tip: fixed, kept per fan, ToLaD#255.)
    let ws = nowWidths.get(fan);
    if (!ws || ws.now !== now) nowWidths.set(fan, (ws = { now, w: Float64Array.from(bs, (b) => laneW(b, Math.max(b.tipY, now))) }));
    const W = ws.w;
    bs.forEach((b, k) => {
      const y = Math.max(b.tipY, now);
      if (folded) {
        const cx = leftAt(b, y, W[k]) + W[k] / 2;
        l[k] = cx - b.width / 2;
        r[k] = cx + b.width / 2;
      } else {
        l[k] = b.colLeft;
        r[k] = b.colLeft + b.width;
      }
    });
    // Neighbours' rooms (in the columns' order) that overlap (closed up, fold.ts) meet halfway: disjoint clades never overlap.
    const order = drawnOrder(fan);
    for (let j = 1; j < order.length; j++) {
      const p = order[j - 1];
      const q = order[j];
      if (r[p] > l[q]) {
        const m = (l[p] + r[p] + l[q] + r[q]) / 4;
        r[p] = Math.min(r[p], m);
        l[q] = Math.max(l[q], m);
      }
    }
    // (Columns out of order at "now" would still meet: then each starts where the last ended.)
    for (let j = 1; j < order.length; j++) {
      const p = order[j - 1];
      const q = order[j];
      l[q] = Math.max(l[q], r[p]);
      r[q] = Math.max(r[q], l[q]);
    }
    const a = new Float64Array(list.length);
    const z = new Float64Array(list.length);
    list.forEach((q, i) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const k of q.strands) {
        lo = Math.min(lo, l[k]);
        hi = Math.max(hi, r[k]);
      }
      // (ToLaD#333: each clade's territory, cut.ts, the same boxes its names and pictures stand in.)
      const t = this.spanOf?.(q.v);
      if (t) [lo, hi] = t;
      a[i] = c.toScreen(lo, 0)[0];
      z[i] = this.hide?.(q.v) ? a[i] : c.toScreen(hi, 0)[0];
    });
    return [a, z];
  }

  /**
   * Lay the stack out for this frame; `axisX` the time axis's right edge, `fit` (0–1) how far "now" is on screen,
   * `top` the labels' top line (under the buttons). The stack stands over the labels: its foot pillRoom px
   * above "now", or, with less room, its top on the top line (a longer pill then reaches up over its lines).
   */
  layout(c: BracketCam, fan: Fan, nowS: number, axisX: number, fit: number, measure: (font: string, text: string) => number, top = 0, at: StackAt | null = null): Placed[] {
    const list = (this.list = clades(fan));
    const n = list.length;
    let ix = cladeIndex.get(list);
    if (!ix) cladeIndex.set(list, (ix = { at: new Map(list.map((q, i) => [q.v, i])), parent: Int32Array.from(list, (q) => q.parent) }));
    const parent = ix.parent;
    // (The stack is icicle rows over the clades' territories, ToLaD#333, research/scalable-tree.md §3: at a level only
    // its groups' and the levels' up rows show, so only theirs are worked out, as asked (span()); the whole nesting's,
    // or every clade's rooms without territories, all at once.)
    this.spanCam = c;
    this.spanFan = fan;
    this.spanGen++;
    if (this.sGen.length !== n) [this.sa, this.sb, this.sGen] = [new Float64Array(n), new Float64Array(n), new Uint32Array(n)];
    if (!this.spanOf) {
      const [a, b] = this.spans(c, fan);
      this.sa.set(a);
      this.sb.set(b);
      this.sGen.fill(this.spanGen);
    } else if (!at) for (let i = 0; i < n; i++) this.span(i);
    const a = this.sa;
    const b = this.sb;
    this.moreRow = -1;
    let rowsNow: Int16Array;
    if (!at) {
      // The rows per zoom bucket (an eighth of a doubling): a pan never moves them.
      const key = `${n}:${Math.round(Math.log2(c.cam.sx) * 8)}:${this.hideKey}`;
      if (key !== this.rowKey || !this.rows || this.rows.length !== n) {
        this.rowKey = key;
        this.rows = bracketRows(a, b, parent);
      }
      rowsNow = this.rows;
    } else {
      // (At a level, ToLaD#288: its groups' row if any is wide enough to show, then the level and the levels up.)
      if (at !== this.atKey || this.atRows.length !== n) {
        this.atKey = at;
        this.atRows = new Int16Array(n);
      }
      const r = this.atRows.fill(-1);
      let row = 0;
      for (const v of at.groups) {
        const i = ix.at.get(v);
        if (i !== undefined && (this.span(i), b[i] - a[i] >= TICK_MIN && b[i] > axisX && a[i] < c.w)) [r[i], row] = [0, 1];
      }
      for (const v of at.up) {
        const i = ix.at.get(v);
        if (i === undefined || this.hide?.(v)) continue;
        if (row >= STACK_ROWS) {
          this.moreRow = row;
          break;
        }
        this.span(i);
        r[i] = row++;
      }
      rowsNow = r;
    }
    this.fit = fit;
    this.measure = measure;
    this.x0 = axisX;
    this.w = c.w;
    // (The widths again once the fonts change: measured before the web font loaded, they were the fallback's.)
    const probe = `${measure(this.nameFont, 'Carnivores')}:${measure(this.latinFont, 'Carnivora')}`;
    if (probe !== this.probe) {
      this.probe = probe;
      this.widthCache.clear();
    }
    if (forkNow) fit = fit >= 0.5 ? 1 : 0;
    this.placed = fit > 0 || forkNow ? layoutBrackets(a, b, parent, (i) => this.widths(i, measure), axisX, c.w, rowsNow) : [];
    // Each row as tall as what it shows here: a name ROW_H, ticks alone TICK_ROW_H, nothing none.
    let rows = 0;
    for (const p of this.placed) rows = Math.max(rows, p.row + 1);
    // (Named at their forks: no rows to overflow.)
    if (!this.placed.length || fit <= 0 || forkNow) this.moreRow = -1;
    if (this.moreRow >= 0) {
      this.moreRow = Math.min(this.moreRow, rows);
      rows = this.moreRow + 1;
    }
    if (this.rowH.length < rows + 1) {
      this.rowH = new Float32Array(rows + 1);
      this.rowBase = new Float32Array(rows + 1);
    }
    this.rowH.fill(0);
    for (const p of this.placed) this.rowH[p.row] = Math.max(this.rowH[p.row], p.form === 'tick' ? TICK_ROW_H : ROW_H);
    if (this.moreRow >= 0) this.rowH[this.moreRow] = ROW_H;
    for (let r = 1; r <= rows; r++) this.rowBase[r] = this.rowBase[r - 1] + this.rowH[r - 1];
    const height = rows ? this.rowTop(rows - 1) : 0;
    this.stack = [top, height, rows, fit];
    this.baseS = Math.min(nowS - 4, Math.max(top + height, nowS - 4 - this.pillRoom));
    // Pushed up past the top line by "now" (under the buttons) by half a row, it is swapped for the pinned rows
    // (ToLaD#233, like a sticky header): a clean swap, never both at once (a fade showed the order twice, faintly).
    // ("Now" itself near the top line: the same swap, half way through the old fade.)
    this.fit = (rows && top + height - this.baseS > ROW_H / 2 && !forkNow) || fit < 0.5 ? 0 : 1;
    return this.placed;
  }

  /** The last layout's top line, stack height, rows and fit asked for (carry()). */
  private stack: [number, number, number, number] = [0, 0, 0, 0];

  /**
   * Carry the last layout (and pins) with the camera (ToLaD#255): between layouts, while the view moves, its x moved
   * by x → ax·x + bx (the camera's change since the frame before), its foot and fit again from "now" at `nowS`, the
   * rows, forms and pinned groups kept. layout() and pin() again once the view settles.
   */
  carry(ax: number, bx: number, nowS: number): void {
    for (const p of this.placed) {
      p.a = ax * p.a + bx;
      p.b = ax * p.b + bx;
      p.lx = ax * p.lx + bx;
    }
    for (const p of this.pins) {
      p.a = ax * p.a + bx;
      p.b = ax * p.b + bx;
      const va = Math.max(p.a - GAP / 2, this.x0);
      const vb = Math.min(p.b + GAP / 2, this.w);
      p.lx = Math.min(Math.max((va + vb) / 2, this.x0 + LABEL_PAD + p.lw / 2), this.w - LABEL_PAD - p.lw / 2);
    }
    const sa = this.sa as Float64Array;
    const sb = this.sb as Float64Array;
    for (let i = 0; i < sa.length; i++) {
      sa[i] = ax * sa[i] + bx;
      sb[i] = ax * sb[i] + bx;
    }
    const [top, height, rows, fit0] = this.stack;
    if (!(fit0 > 0)) return;
    const fit = Math.min(1, Math.max(0, (nowS - top) / 24));
    this.baseS = Math.min(nowS - 4, Math.max(top + height, nowS - 4 - this.pillRoom));
    this.fit = (rows && top + height - this.baseS > ROW_H / 2) || fit < 0.5 ? 0 : 1;
    // (The pinned rows swap in as the stack goes: those pinned at the last layout, none if the stack showed then.)
    this.pinA = this.pins.length ? 1 - this.fit : 0;
  }

  /**
   * Pin the groups the view is inside (ToLaD#233), after layout(): shown as the stack scrolls off the top (1 - fit),
   * at `top` (the labels' top line, under the buttons). `yTop` the world y at the screen's top; `at` the lineage at
   * the screen's centre (the branch whose column there is nearest it, its node), null for none. The rule: the clades
   * that lineage sits in (without one, those whose span at "now", the brackets' own, covers the centre of the room
   * right of the time axis), whose branch started below the screen's top (some of their time is on screen: zoomed
   * into a bear's past older than the bears, the bears are not pinned, the dog-like carnivores are).
   */
  pin(top: number, yTop: number, measure: (font: string, text: string) => number, at: FanNode | null = null, keep: ((v: FanNode) => boolean) | null = null): Pin[] {
    this.pinA = 1 - this.fit;
    this.pinTop = top;
    this.pins = [];
    this.pinMore = false;
    if (this.pinA <= 0) return this.pins;
    const cx = (this.x0 + this.w) / 2;
    const room = this.w - this.x0 - 2 * LABEL_PAD;
    const line = new Set<FanNode>();
    for (let u = at; u; u = u.parent) line.add(u);
    this.list.forEach((q, i) => {
      if (at ? !line.has(q.v) : (this.span(i), !(this.sa[i] <= cx && cx < this.sb[i]))) return;
      if (!(q.v.yBot > yTop) || this.hide?.(q.v)) return;
      this.span(i);
      // (Only the familiar ones, ToLaD#288: no row for a Latin-only clade between them.)
      if (keep && !keep(q.v)) return;
      const [wf, wn, ws] = this.widths(i, measure);
      const form: Form = wf <= room ? 'full' : wn <= room ? 'name' : 'short';
      const lw = form === 'full' ? wf : form === 'name' ? wn : ws || wn;
      // Its label centred on the part of it on screen, kept on screen (a narrow one's label reaches past its ends).
      const va = Math.max(this.sa[i], this.x0);
      const vb = Math.min(this.sb[i], this.w);
      const lx = Math.min(Math.max((va + vb) / 2, this.x0 + LABEL_PAD + lw / 2), this.w - LABEL_PAD - lw / 2);
      this.pins.push({ i, a: this.sa[i] + GAP / 2, b: this.sb[i] - GAP / 2, row: 0, form, lx, lw });
    });
    // (At most STACK_ROWS, the innermost; a "…" row over them for the rest, ToLaD#288.)
    if (keep && this.pins.length > STACK_ROWS) {
      this.pins = this.pins.slice(-STACK_ROWS);
      this.pinMore = true;
    }
    const k0 = this.pinMore ? 1 : 0;
    this.pins.forEach((p, k) => (p.row = k + k0));
    return this.pins;
  }

  /** The pinned rows' height (px below pinTop, the band's own backdrop included), 0 without any. */
  pinH(): number {
    return this.pins.length ? (this.pins.length + (this.pinMore ? 1 : 0)) * ROW_H + PIN_PAD : 0;
  }

  /** Pinned row k's line (screen y): the order's on top. */
  pinY(k: number): number {
    return this.pinTop + k * ROW_H + ROW_H / 2;
  }

  /** Draw the pinned groups (ToLaD#233) over everything under them, on a backdrop of the ground. */
  drawPins(ctx: CanvasRenderingContext2D, ink: string, ink2: string, bg: string): void {
    if (!this.pins.length || this.pinA <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.pinA;
    const y0 = this.pinTop - PIN_PAD / 2;
    const y1 = this.pinTop + this.pinH() - PIN_PAD / 2;
    ctx.fillStyle = bg;
    ctx.globalAlpha = this.pinA * 0.9;
    ctx.fillRect(this.x0, y0, this.w - this.x0, y1 - y0);
    ctx.globalAlpha = this.pinA;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const p of this.pins) this.drawOne(ctx, p, Math.round(this.pinY(p.row)) + 0.5, p.lx, p.form, 4, ink, ink2);
    if (this.pinMore) this.drawMore(ctx, this.pinY(0), ink2);
    ctx.restore();
  }

  /** The pinned group under screen (x, y), while the pins show (ToLaD#233): its row, along its line (a few px of slop). */
  pinHit(x: number, y: number): Clade | null {
    if (this.pinA < 0.5 || x < this.x0) return null;
    for (const p of this.pins) {
      const ry = this.pinY(p.row);
      if (y < ry - ROW_H / 2 || y >= ry + ROW_H / 2) continue;
      if (x >= Math.min(p.a, p.lx - p.lw / 2) - 3 && x <= Math.max(p.b, p.lx + p.lw / 2) + 3) return this.list[p.i];
    }
    return null;
  }

  /** The "…" (ToLaD#288), on line y at the room's left. */
  private drawMore(ctx: CanvasRenderingContext2D, y: number, ink2: string): void {
    ctx.font = this.nameFont;
    ctx.fillStyle = ink2;
    ctx.fillText('…', this.x0 + LABEL_PAD, Math.round(y) + 0.5);
  }

  /** Whether screen (x, y) is on the "…" row, the stack's or the pinned rows' (ToLaD#288): a tap there goes one level up. */
  moreHit(x: number, y: number): boolean {
    if (x < this.x0 || x > this.x0 + 60) return false;
    if (this.pinMore && this.pinA >= 0.5) return Math.abs(y - this.pinY(0)) <= ROW_H / 2;
    return this.moreRow >= 0 && this.fit >= 0.5 && Math.abs(y - this.rowY(this.moreRow)) <= ROW_H / 2;
  }

  /** Whether clade node `v`'s bracket carries its name this frame. */
  named(v: FanNode): boolean {
    if (forkNow) {
      for (let k = 0; k < this.forkN; k++) if (this.list[this.forks[k].i].v === v) return true;
      return false;
    }
    return this.placed.some((p) => p.form !== 'tick' && this.list[p.i].v === v);
  }

  private widths(i: number, measure: (font: string, text: string) => number): [number, number, number] {
    const q = this.list[i];
    let w = this.widthCache.get(q.latin);
    if (!w) {
      // (A clade with no English name is drawn in the Latin's font: measured in it, else its line ran through its end.)
      const name = measure(q.en ? this.nameFont : this.latinFont, q.en ?? q.latin);
      const short = TAXON_SHORT[q.latin];
      w = [q.en ? name + 4 + measure(this.latinFont, q.latin) : name, name, short ? measure(this.nameFont, short) : 0];
      this.widthCache.set(q.latin, w);
    }
    return w;
  }

  /** Row r's line (screen y): a name's row has its line through the name's middle, a row of ticks at its foot. */
  rowY(r: number): number {
    const h = this.rowH[r] ?? ROW_H;
    return this.baseS - 1 - (this.rowBase[r] ?? r * ROW_H) - (h >= ROW_H ? ROW_H / 2 - 2 : 1);
  }

  /** The stack's height (px above its foot) to the top of row r. */
  rowTop(r: number): number {
    return 1 + (this.rowBase[r] ?? r * ROW_H) + (this.rowH[r] ?? ROW_H);
  }

  /**
   * Draw the stack, under the pills (drawn after, opaque: a bracket's line runs behind a long one). `pills` the
   * pills' boxes on screen [x0, y0, x1, y1]: a label they would cover slides along its bracket clear of them, or,
   * with no room, leaves the bracket a plain line.
   */
  draw(ctx: CanvasRenderingContext2D, ink: string, ink2: string, pills: readonly (readonly number[])[] = [], bg = '#000'): void {
    if (forkNow) {
      // (Placed with the labels, placeForks: their boxes are its obstacles.)
      this.drawForks(ctx, ink, ink2, bg);
      return;
    }
    if (!this.placed.length || this.fit <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.fit;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const p of this.placed) {
      const y = Math.round(this.rowY(p.row)) + 0.5;
      const lx = p.form === 'tick' ? NaN : clearSpot(p, Math.max(p.a, this.x0) + LABEL_PAD, Math.min(p.b, this.w) - LABEL_PAD, y, pills);
      const form = Number.isNaN(lx) ? 'tick' : p.form;
      // (End ticks down to the row under it: shorter in a row of ticks.)
      this.drawOne(ctx, p, y, lx, form, (this.rowH[p.row] ?? ROW_H) >= ROW_H ? 4 : 3, ink, ink2);
    }
    if (this.moreRow >= 0) this.drawMore(ctx, this.rowY(this.moreRow), ink2);
    ctx.restore();
  }

  /**
   * Name each clade the stack would at its fork (ToLaD#373), after layout(): greedy point-feature placement, the wider
   * clade first, its pill centred over the fork in its crotch (node v: the fork moves it, rigidly, how its peels are
   * drawn does not). A pill that meets what is placed or `pills` (the labels' boxes) slides up the crotch, the least
   * that clears it, so it moves continuously with what it clears; with no room there down its stem from under the fork, then the same in its shorter forms; else it is
   * dropped. A fork past the screen's foot: held at the foot over the middle of the clade's span on screen, after the
   * forks on screen. Off the top, on its stem under the top line. What the pinned rows say is not said again.
   * A function of the camera alone: no state, so no flicker.
   *
   * With `lines` (the leaders, ToLaD#434) a name whose fork is on screen stands off it instead: on the ray from the fork
   * with the shortest leader that clears the forks' horizontals as well (forkRay), a name at its fork being the leader's
   * zero. A fork not on screen has nowhere to join: its name stands as above, clear of the horizontals too.
   */
  placeForks(pills: readonly (readonly number[])[], lines: ForkLines | null = null): void {
    const c = this.spanCam;
    this.forkN = 0;
    if (!c || !this.placed.length) return;
    const list = this.list;
    // (By size, the same order each frame: the set changes only with the level.)
    const by = this.placed.sort((p, q) => list[q.i].strands.length - list[p.i].strands.length || p.i - q.i);
    if (this.forkBox.length < by.length * 4) this.forkBox = new Float64Array(by.length * 4);
    const y0 = c.toScreen(0, 0)[1];
    const sy = c.toScreen(0, 1)[1] - y0;
    const top = this.pinTop + (this.pinA > 0 ? this.pinH() : 0);
    const foot = this.forkFoot;
    const sw = c.cam.sx;
    const held: Placed[] = [];
    // (On leaders what stands in a name's way takes the horizontals, and the leaders as they are placed.)
    const stand: (readonly number[])[] = lines ? [...pills] : (pills as (readonly number[])[]);
    if (lines) for (let k = 0; k < lines.n; k++) stand.push([lines.xy[4 * k], lines.xy[4 * k + 2], lines.xy[4 * k + 1], lines.xy[4 * k + 2]]);
    this.leadN = 0;
    // (The names on leaders first, then the rest clear of the leaders: their boxes, for these few.)
    const joined = new Set<Placed>();
    if (lines && sy > 0) {
      for (const p of by) {
        const q = list[p.i];
        if (this.pinA > 0 && this.pins.some((u) => u.i === p.i)) continue;
        const fork = y0 + q.v.y * sy;
        if (fork < top || fork >= foot) continue;
        // (Its fork's on-screen point nearest its parent's column; a clade drawn as one branch, its column.)
        const j = lines.at.get(q.v);
        const ax = j === undefined ? c.toScreen(nodeLeftAt(q.v, q.v.y) + q.v.width / 2, 0)[0] : Math.min(Math.max(lines.xy[4 * j + 3], lines.xy[4 * j], this.x0), lines.xy[4 * j + 1], this.w);
        if (j === undefined ? ax < this.x0 || ax > this.w : lines.xy[4 * j + 1] < this.x0 || lines.xy[4 * j] > this.w) continue;
        joined.add(p);
        this.forkRays(p, ax, fork, top, foot, pills, stand);
      }
      for (let k = 0; k < this.leadN; k++) stand.push([Math.min(this.lead[4 * k], this.lead[4 * k + 2]), Math.min(this.lead[4 * k + 1], this.lead[4 * k + 3]), Math.max(this.lead[4 * k], this.lead[4 * k + 2]), Math.max(this.lead[4 * k + 1], this.lead[4 * k + 3])]);
    }
    for (const p of by) {
      if (joined.has(p)) continue;
      const q = list[p.i];
      if (this.pinA > 0 && this.pins.some((u) => u.i === p.i)) continue;
      if (!(sy > 0)) continue;
      const fork = y0 + q.v.y * sy;
      if (fork + FORK_H >= foot) {
        held.push(p);
        continue;
      }
      const end = Math.min(foot, y0 + q.v.yBot * sy);
      if (end < top + FORK_H) continue;
      const half = FORK_H / 2;
      // (Over the fork its own x; on its stem under the fork, the stem's: never how the peels above it are drawn.)
      const xAt = (s: number) => {
        const x = c.toScreen(nodeLeftAt(q.v, (Math.max(s, fork) - y0) / sy) + q.v.width / 2, 0)[0];
        return x + (q.v.width * sw) / 2 < this.x0 || x - (q.v.width * sw) / 2 > this.w ? NaN : x;
      };
      const upTo = Math.max(top + half, fork - half - 1 - FORK_SLIDE_ROWS * (FORK_H + FORK_GAP));
      const under = Math.max(fork + half + 1, top + half);
      this.forkLadder(p, fork - half - 1, upTo, -1, under, end - half, 1, stand, xAt);
    }
    for (const p of held) {
      // (Its middle on screen, as its bracket's name was.)
      const m = (Math.max(p.a, this.x0) + Math.min(p.b, this.w)) / 2;
      const y = foot - FORK_H / 2;
      const e = y - FORK_HOLD_ROWS * (FORK_H + FORK_GAP);
      this.forkLadder(p, y, e, -1, y, e, -1, stand, () => m);
    }
  }

  /** A name on a leader from fork point (ax, ay), in its largest form with room, as forkLadder; else not at all. */
  private forkRays(p: Placed, ax: number, ay: number, top: number, foot: number, pills: readonly (readonly number[])[], stand: readonly (readonly number[])[]): void {
    const q = this.list[p.i];
    const [wf, wn, ws] = this.widths(p.i, this.measure!);
    const room = Math.min(p.b, this.w) - Math.max(p.a, this.x0) - 2 * LABEL_PAD;
    if (q.en && wf <= room && this.forkRay(p, 'full', wf, ax, ay, top, foot, pills, stand)) return;
    if (this.forkRay(p, 'name', wn, ax, ay, top, foot, pills, stand)) return;
    if (ws > 0) this.forkRay(p, 'short', ws, ax, ay, top, foot, pills, stand);
  }

  /** The shortest leader from (ax, ay), over FORK_RAYS, whose name clears `stand`, the names and the leaders, and which itself crosses no leader, name or box (`pills`); placed there if there is one. */
  private forkRay(p: Placed, form: Form, lw: number, ax: number, ay: number, top: number, foot: number, pills: readonly (readonly number[])[], stand: readonly (readonly number[])[]): boolean {
    const pw = lw + 2 * FORK_PAD;
    const half = FORK_H / 2;
    // (The pill's centre at the ray's start: its edge clear of its own fork by the gap.)
    const off = half + FORK_GAP + 0.5;
    const box = this.forkBox;
    const lead = this.lead;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (const [k, d] of FORK_RAYS) {
      let s = 0;
      for (let round = 0; round < 64; round++) {
        const y = ay + d * (off + s);
        const len = s * Math.hypot(1, k);
        if (len >= best || y - half < top || y + half > foot) break;
        const x = Math.min(Math.max(ax + k * s, this.x0 + pw / 2 + 1), this.w - pw / 2 - 1);
        // (A leader that runs into a box runs into it from here on too.)
        let dead = false;
        for (let j = 0; j < this.forkN && !dead; j++) dead = segMeetsBox(ax, ay, x, y, box[4 * j], box[4 * j + 1], box[4 * j + 2], box[4 * j + 3]);
        for (let j = 0; j < pills.length && !dead; j++) dead = segMeetsBox(ax, ay, x, y, pills[j][0], pills[j][1], pills[j][2], pills[j][3]);
        for (let j = 0; j < this.leadN && !dead; j++) dead = segsCross(ax, ay, x, y, lead[4 * j], lead[4 * j + 1], lead[4 * j + 2], lead[4 * j + 3]);
        if (dead) break;
        const a = x - pw / 2 - FORK_GAP;
        const b = x + pw / 2 + FORK_GAP;
        const t = y - half - FORK_GAP;
        const u = y + half + FORK_GAP;
        let next = NaN;
        const meet = (x0: number, y0: number, x1: number, y1: number) => {
          if (x1 <= a || x0 >= b || y1 <= t || y0 >= u) return;
          // (Past it in y, or sideways if the ray leans away and comes off it first.)
          let to = d < 0 ? ay - off - y0 + half + FORK_GAP : y1 + half + FORK_GAP - ay - off;
          if (k < 0) to = Math.min(to, ax + pw / 2 + FORK_GAP - x0);
          else if (k > 0) to = Math.min(to, x1 + pw / 2 + FORK_GAP - ax);
          if (Number.isNaN(next) || to > next) next = to;
        };
        for (const r of stand) meet(r[0], r[1], r[2], r[3]);
        for (let j = 0; j < this.forkN; j++) meet(box[4 * j], box[4 * j + 1], box[4 * j + 2], box[4 * j + 3]);
        for (let j = 0; j < this.leadN; j++) {
          const [p0, q0, p1, q1] = [lead[4 * j], lead[4 * j + 1], lead[4 * j + 2], lead[4 * j + 3]];
          if (segMeetsBox(p0, q0, p1, q1, a, t, b, u)) meet(Math.min(p0, p1), Math.min(q0, q1), Math.max(p0, p1), Math.max(q0, q1));
        }
        if (Number.isNaN(next)) {
          best = len;
          bx = x;
          by = y;
          break;
        }
        // (A ray held at an edge comes off nothing sideways: on along it.)
        s = next > s + 1e-6 ? next : s + half;
      }
    }
    if (best === Infinity) return false;
    const n = this.forkN++;
    const f = this.forks[n] ?? (this.forks[n] = { i: 0, form: 'name', x: 0, y: 0, pw: 0, lw: 0, ax: NaN, ay: NaN });
    f.i = p.i;
    f.form = form;
    f.x = bx;
    f.y = by;
    f.pw = pw;
    f.lw = lw;
    f.ax = ax;
    f.ay = ay;
    box[4 * n] = bx - pw / 2;
    box[4 * n + 1] = by - half;
    box[4 * n + 2] = bx + pw / 2;
    box[4 * n + 3] = by + half;
    if (lead.length < 4 * (this.leadN + 1)) {
      const more = new Float64Array(2 * lead.length);
      more.set(lead);
      this.lead = more;
    }
    this.lead.set([ax, ay, bx, by], 4 * this.leadN++);
    return true;
  }

  /**
   * Place clade p's name in its largest form with room: from y along `dir` (1 down, -1 up) as far as `end`, else from
   * y2 along dir2 as far as end2; then its shorter forms the same way; else not at all.
   */
  private forkLadder(p: Placed, y: number, end: number, dir: 1 | -1, y2: number, end2: number, dir2: 1 | -1, pills: readonly (readonly number[])[], xAt: (y: number) => number): void {
    const q = this.list[p.i];
    const [wf, wn, ws] = this.widths(p.i, this.measure!);
    const at = (form: Form, w: number) => this.forkAt(p, form, w, y, end, dir, pills, xAt) || this.forkAt(p, form, w, y2, end2, dir2, pills, xAt);
    // (The Latin too only where its span has the room for it, as its bracket's; a tick has no fork name, a name has.)
    const room = Math.min(p.b, this.w) - Math.max(p.a, this.x0) - 2 * LABEL_PAD;
    if (q.en && wf <= room && at('full', wf)) return;
    if (at('name', wn)) return;
    if (ws > 0) at('short', ws);
  }

  /** The least slide from y that clears everything placed and `pills`; placed there if there is one. */
  private forkAt(p: Placed, form: Form, lw: number, y: number, end: number, dir: 1 | -1, pills: readonly (readonly number[])[], xAt: (y: number) => number): boolean {
    const pw = lw + 2 * FORK_PAD;
    const half = FORK_H / 2;
    const box = this.forkBox;
    // (Each round clears one more thing it met, further along.)
    for (let round = 0; round < 16 && (dir > 0 ? y <= end : y >= end); round++) {
      let x = xAt(y);
      if (Number.isNaN(x)) return false;
      x = Math.min(Math.max(x, this.x0 + pw / 2 + 1), this.w - pw / 2 - 1);
      const a = x - pw / 2 - FORK_GAP;
      const b = x + pw / 2 + FORK_GAP;
      const t = y - half - FORK_GAP;
      const u = y + half + FORK_GAP;
      let next = NaN;
      const meet = (x0: number, y0: number, x1: number, y1: number) => {
        if (x1 <= a || x0 >= b || y1 <= t || y0 >= u) return;
        const to = dir > 0 ? y1 + half + FORK_GAP : y0 - half - FORK_GAP;
        if (Number.isNaN(next) || (dir > 0 ? to > next : to < next)) next = to;
      };
      for (const r of pills) meet(r[0], r[1], r[2], r[3]);
      for (let k = 0; k < this.forkN; k++) meet(box[4 * k], box[4 * k + 1], box[4 * k + 2], box[4 * k + 3]);
      if (Number.isNaN(next)) {
        const k = this.forkN++;
        const f = this.forks[k] ?? (this.forks[k] = { i: 0, form: 'name', x: 0, y: 0, pw: 0, lw: 0, ax: NaN, ay: NaN });
        f.i = p.i;
        f.form = form;
        f.x = x;
        f.y = y;
        f.pw = pw;
        f.lw = lw;
        f.ax = f.ay = NaN;
        box[4 * k] = x - pw / 2;
        box[4 * k + 1] = y - half;
        box[4 * k + 2] = x + pw / 2;
        box[4 * k + 3] = y + half;
        return true;
      }
      y = next;
    }
    return false;
  }

  /** Draw the names at their forks: each on an opaque pill, as the other labels. */
  private drawForks(ctx: CanvasRenderingContext2D, ink: string, ink2: string, bg: string): void {
    if (!this.forkN) return;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // (The leaders under every pill: each from a dot on its fork into its pill.)
    ctx.strokeStyle = ink2;
    ctx.fillStyle = ink2;
    ctx.lineWidth = 1;
    for (let k = 0; k < this.forkN; k++) {
      const f = this.forks[k];
      if (Number.isNaN(f.ax)) continue;
      ctx.beginPath();
      ctx.moveTo(f.ax, f.ay);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.ax, f.ay, 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    for (let k = 0; k < this.forkN; k++) {
      const f = this.forks[k];
      const x0 = Math.round(f.x - f.pw / 2);
      const y0 = Math.round(f.y - FORK_H / 2);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x0, y0, f.pw, FORK_H, FORK_H / 2);
      ctx.fill();
      this.drawLabel(ctx, this.list[f.i], f.form, x0 + FORK_PAD, y0 + FORK_H / 2 + 0.5, ink, ink2);
    }
    ctx.restore();
  }

  /** One bracket on line y: its label (`form`, centred at lx) breaking its line, its end ticks `dy` down. */
  private drawOne(ctx: CanvasRenderingContext2D, p: Placed, y: number, lx: number, form: Form, dy: number, ink: string, ink2: string): void {
    const q = this.list[p.i];
    // Past the time axis or the screen's edge it runs on, open-ended (no end tick there).
    const ta = p.a >= this.x0;
    const tb = p.b <= this.w;
    const a = Math.round(Math.max(p.a, this.x0)) + 0.5;
    const b = Math.round(Math.min(p.b, this.w)) - 0.5;
    ctx.strokeStyle = form === 'tick' ? 'rgba(185,230,201,0.45)' : 'rgba(185,230,201,0.75)';
    ctx.beginPath();
    ctx.moveTo(a, ta ? y + dy : y);
    ctx.lineTo(a, y);
    if (form === 'tick') ctx.lineTo(b, y);
    else {
      // The line broken around the label.
      ctx.lineTo(Math.max(a, lx - p.lw / 2 - 4), y);
      ctx.moveTo(Math.min(b, lx + p.lw / 2 + 4), y);
      ctx.lineTo(b, y);
    }
    if (tb) ctx.lineTo(b, y + dy);
    ctx.stroke();
    if (form === 'tick') return;
    this.drawLabel(ctx, q, form, lx - p.lw / 2, y, ink, ink2);
  }

  /** A clade's label in its form, from x on line y: its name, the Latin past it in the full form. */
  private drawLabel(ctx: CanvasRenderingContext2D, q: Clade, form: Form, x: number, y: number, ink: string, ink2: string): void {
    const short = form === 'short' && !!TAXON_SHORT[q.latin];
    ctx.font = q.en || short ? this.nameFont : this.latinFont;
    ctx.fillStyle = q.en || short ? ink : ink2;
    const name = short ? TAXON_SHORT[q.latin] : (q.en ?? q.latin);
    ctx.fillText(name, x, y);
    if (form === 'full' && q.en) {
      x += ctx.measureText(name).width + 4;
      ctx.font = this.latinFont;
      ctx.fillStyle = ink2;
      ctx.fillText(q.latin, x, y);
    }
  }

  /** The clade under screen (x, y): the bracket in that row nearest x (on it, or within a few px of slop). */
  hit(x: number, y: number): Clade | null {
    if (forkNow) {
      // (A finger's few px past its pill: nothing else stands that near, placeForks.)
      for (let k = 0; k < this.forkN; k++) {
        const f = this.forks[k];
        if (Math.abs(x - f.x) <= f.pw / 2 + 3 && Math.abs(y - f.y) <= FORK_H / 2 + 3) return this.list[f.i];
      }
      return null;
    }
    // (Faded out, handed over to the pinned rows: not there to tap.)
    if (this.fit < 0.5) return null;
    let best: Placed | null = null;
    let bestD = 3;
    for (const p of this.placed) {
      // (Its row's height, at least a name's: a row of ticks is thin to tap.)
      const ry = this.rowY(p.row);
      if (y < ry - ROW_H / 2 || y > ry + ROW_H / 2) continue;
      const d = Math.max(p.a - x, x - p.b, 0);
      if (d <= bestD && (!best || d < bestD)) {
        best = p;
        bestD = d;
      }
    }
    return best ? this.list[best.i] : null;
  }
}

/** A pinned group (ToLaD#233): a bracket placed in the pinned rows (row 0 the order's, at the top). */
export type Pin = Placed;
/** Backdrop (px) the pinned rows take beyond their own height. */
export const PIN_PAD = 6;

/** What stands over the labels at its most (px): the stack or the pinned rows at STACK_ROWS rows and the "…" (view.ts labelBand). */
export const STACK_MOST = (STACK_ROWS + 1) * ROW_H + PIN_PAD;

/** Room (px) kept for the labels between the stack's foot and "now", by default (Brackets.pillRoom: the view's own). */
export const PILL_ROOM = 96;

/**
 * Where placed bracket `p`'s label (centred at screen x, within [lo, hi]) goes on line y clear of the pills: its own
 * place if clear, else the nearest clear one along its bracket, else NaN (no room: a plain line).
 */
export function clearSpot(p: Placed, lo: number, hi: number, y: number, pills: readonly (readonly number[])[]): number {
  const half = p.lw / 2 + 4;
  const cuts: [number, number][] = [];
  for (const q of pills) if (q[1] < y + ROW_H / 2 && q[3] > y - ROW_H / 2 && q[2] > lo - half && q[0] < hi + half) cuts.push([q[0] - half, q[2] + half]);
  if (!cuts.length) return p.lx;
  // Candidates: its own place, and either side of each pill, kept within [lo + half, hi - half].
  const cands = [p.lx, ...cuts.flat()].map((x) => Math.min(Math.max(x, lo + half - 4), hi - half + 4));
  let best = NaN;
  for (const x of cands) {
    if (x - p.lw / 2 < lo - 1e-6 || x + p.lw / 2 > hi + 1e-6) continue;
    if (cuts.some(([a, b]) => x > a + 1e-6 && x < b - 1e-6)) continue;
    if (Number.isNaN(best) || Math.abs(x - p.lx) < Math.abs(best - p.lx)) best = x;
  }
  return best;
}

/**
 * The frame a flight lands on, laid out (steady.ts) or not: `frame` frames what it shows as the layout stands now (a
 * clade's span, a species' column), and what it shows moves with the zoom (its inner gaps open). The one camera both
 * agree on: the zoom that frames what that zoom opens (bisected in log zoom: the span on screen grows with the zoom).
 * The layout is left exactly at the frame's zoom, for the camera taking it (settling there moves nothing). A frame
 * whose zoom does not move with the layout (a species' column) takes no bisection. Used by every tap and search
 * flight (ToLaD#193, #197, #211).
 */
export function foldedFrame(fan: Fan, w: number, frame: () => Camera): Camera {
  let cam = frame();
  const f = fan.tess.fold;
  if (!f) return cam;
  const settleAt = (sx: number): Camera => {
    f.setScale(sx, w);
    return frame();
  };
  const fixed = settleAt(cam.sx);
  if (fixed.sx === cam.sx) cam = fixed;
  else {
    // (The zoom that frames the span it opens to is one point: the span (px) a zoom gives grows with it, so
    // g(z) = log(the zoom framing the span at z) - z falls through 0 there, once.)
    const g = (z: number) => Math.log(settleAt(Math.exp(z)).sx) - z;
    let lo = Math.log(cam.sx) - 1;
    let hi = Math.log(cam.sx) + 1;
    let [glo, ghi] = [g(lo), g(hi)];
    for (let k = 0; k < 8 && glo < 0; k++) glo = g((lo -= 2));
    for (let k = 0; k < 8 && ghi > 0; k++) ghi = g((hi += 2));
    // (To a hair of the zoom; at the mammal level a ten-thousandth, each round ~6,000 strands refolded, ToLaD#255: by
    // false position, Illinois's (the end kept twice running weighed half), a handful of rounds, not a bisection's
    // fifteen; each step at least half the tolerance inside the bracket, so it closes on both sides.)
    const tol = f.ordShare.length ? 1e-4 : 1e-7;
    let side = 0;
    for (let k = 0; k < 40 && hi - lo > tol; k++) {
      let m = glo > 0 && ghi <= 0 ? (lo * ghi - hi * glo) / (ghi - glo) : (lo + hi) / 2;
      if (!(m > lo + tol / 2)) m = lo + tol / 2;
      if (!(m < hi - tol / 2)) m = hi - tol / 2;
      const gm = g(m);
      if (gm > 0) {
        [lo, glo] = [m, gm];
        if (side > 0) ghi /= 2;
        side = 1;
      } else {
        [hi, ghi] = [m, gm];
        if (side < 0) glo /= 2;
        side = -1;
      }
    }
    cam = settleAt(Math.exp(lo));
  }
  // The layout left exactly at the frame's zoom, for the camera taking it.
  f.setScale(cam.sx, w);
  return cam;
}
