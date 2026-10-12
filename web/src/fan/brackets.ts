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
import { laneAt, leftAt, type Fan, type FanNode } from './layout';
import { FAMILY_EN, type Split } from './splits';

export type CladeRank = 'genus' | 'subfamily' | 'family' | 'superfamily' | 'suborder' | 'order';

/** The Latin name the data gives a split, cleaned of a disambiguation ("Prionodon (genus in Opisthokonta)"). */
export function latinOf(s: Split): string {
  return (s.taxon ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
}

/** A taxon's rank by its ending (ICZN: -idae family, -inae subfamily, -oidea superfamily; -formia a suborder; one word otherwise a genus). */
export function rankOf(latin: string): CladeRank | null {
  if (!/^[A-Z][a-z]+$/.test(latin)) return null;
  if (latin === 'Carnivora') return 'order';
  if (/idae$/.test(latin)) return 'family';
  if (/inae$/.test(latin)) return 'subfamily';
  if (/oidea$/.test(latin)) return 'superfamily';
  if (/formia$/.test(latin)) return 'suborder';
  return 'genus';
}

/** Plain English names for the taxa above the species (the families' are splits.ts FAMILY_EN). A taxon not here keeps its Latin. */
export const TAXON_EN: Record<string, string> = {
  ...FAMILY_EN,
  Carnivora: 'Carnivores',
  Feliformia: 'Cat-like carnivores',
  Caniformia: 'Dog-like carnivores',
  Felinae: 'Small cats',
  Pantherinae: 'Big cats',
  Viverrinae: 'Civets',
  Hemigalinae: 'Banded palm civets',
  Galidiinae: 'Malagasy mongooses',
  Melinae: 'Badgers',
  Lutrinae: 'Otters',
  Martinae: 'Martens',
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

/** The view's side of it: what the stack needs from the camera. */
export interface BracketCam {
  toScreen(x: number, y: number): [number, number];
  readonly w: number;
  readonly cam: { sx: number };
}

/**
 * The stack for a view: its layout at this frame, the band it takes above "now" (a skyline, px per screen column)
 * for the species' pills to stand on, drawing and hits.
 */
export class Brackets {
  /** `nameFont` the English names' CSS font, `latinFont` the Latin's. */
  constructor(
    readonly nameFont: string,
    readonly latinFont: string,
  ) {}
  private widthCache = new Map<string, [number, number, number]>();
  /** Per row (this frame): the height of the band under it (px above the line's base) and its own height. */
  private rowBase = new Float32Array(1);
  private rowH = new Float32Array(1);
  private rowKey = '';
  private rows: Int16Array | null = null;
  placed: Placed[] = [];
  list: Clade[] = [];
  /** Band height (px above the "now" line) over each screen column. */
  sky = new Float32Array(0);
  nowS = 0;
  fit = 0;
  /** The time axis's right edge and the screen's width (px): the lines run between them. */
  private x0 = 0;
  private w = 0;

  /** The clades' screen spans at "now": each species' room where its column is at "now" (an extinct one's: at its tip). */
  spans(c: BracketCam, fan: Fan): [Float64Array, Float64Array] {
    const list = (this.list = clades(fan));
    const bs = fan.branches;
    const l = new Float64Array(bs.length);
    const r = new Float64Array(bs.length);
    const now = fan.time.y(0);
    const folded = !!fan.tess.fold && fan.tess.fold.left(0, now) !== null;
    bs.forEach((b, k) => {
      const y = Math.max(b.tipY, now);
      if (folded) {
        const cx = leftAt(b, y) + laneAt(b, y).w / 2;
        l[k] = cx - b.width / 2;
        r[k] = cx + b.width / 2;
      } else {
        l[k] = b.colLeft;
        r[k] = b.colLeft + b.width;
      }
    });
    // Neighbours' rooms (in the columns' order) that overlap (closed up, fold.ts) meet halfway: disjoint clades never overlap.
    const order = bs.map((_, k) => k).sort((p, q) => bs[p].index - bs[q].index);
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
      a[i] = c.toScreen(lo, 0)[0];
      z[i] = c.toScreen(hi, 0)[0];
    });
    return [a, z];
  }

  /** Lay the stack out for this frame; `axisX` the time axis's right edge, `fit` (0–1) how far "now" is on screen. */
  layout(c: BracketCam, fan: Fan, nowS: number, axisX: number, fit: number, measure: (font: string, text: string) => number): Placed[] {
    const [a, b] = this.spans(c, fan);
    const parent = this.list.map((q) => q.parent);
    // The rows per zoom bucket (an eighth of a doubling): a pan never moves them.
    const key = `${this.list.length}:${Math.round(Math.log2(c.cam.sx) * 8)}`;
    if (key !== this.rowKey || !this.rows || this.rows.length !== a.length) {
      this.rowKey = key;
      this.rows = bracketRows(a, b, parent);
    }
    this.nowS = nowS;
    this.fit = fit;
    this.x0 = axisX;
    this.w = c.w;
    this.placed = fit > 0 ? layoutBrackets(a, b, parent, (i) => this.widths(i, measure), axisX, c.w, this.rows) : [];
    // Each row as tall as what it shows here: a name ROW_H, ticks alone TICK_ROW_H, nothing none.
    let rows = 0;
    for (const p of this.placed) rows = Math.max(rows, p.row + 1);
    if (this.rowH.length < rows + 1) {
      this.rowH = new Float32Array(rows + 1);
      this.rowBase = new Float32Array(rows + 1);
    }
    this.rowH.fill(0);
    for (const p of this.placed) this.rowH[p.row] = Math.max(this.rowH[p.row], p.form === 'tick' ? TICK_ROW_H : ROW_H);
    for (let r = 1; r <= rows; r++) this.rowBase[r] = this.rowBase[r - 1] + this.rowH[r - 1];
    const sky = (this.sky = new Float32Array(Math.ceil(c.w) + 1));
    for (const p of this.placed) {
      const h = this.rowTop(p.row);
      for (let x = Math.max(0, Math.floor(p.a)); x <= Math.min(sky.length - 1, Math.ceil(p.b)); x++) sky[x] = Math.max(sky[x], h);
    }
    return this.placed;
  }

  /** Whether clade node `v`'s bracket carries its name this frame. */
  named(v: FanNode): boolean {
    return this.placed.some((p) => p.form !== 'tick' && this.list[p.i].v === v);
  }

  /** The band's height (px above "now") over screen x [x0, x1]: a pill standing there stands on it. */
  band(x0: number, x1: number): number {
    let h = 0;
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.sky.length - 1, Math.ceil(x1)); x++) h = Math.max(h, this.sky[x]);
    return h * this.fit;
  }

  private widths(i: number, measure: (font: string, text: string) => number): [number, number, number] {
    const q = this.list[i];
    let w = this.widthCache.get(q.latin);
    if (!w) {
      const name = measure(this.nameFont, q.en ?? q.latin);
      const short = TAXON_SHORT[q.latin];
      w = [q.en ? name + 4 + measure(this.latinFont, q.latin) : name, name, short ? measure(this.nameFont, short) : 0];
      this.widthCache.set(q.latin, w);
    }
    return w;
  }

  /** Row r's line (screen y): a name's row has its line through the name's middle, a row of ticks at its foot. */
  rowY(r: number): number {
    const h = this.rowH[r] ?? ROW_H;
    return this.nowS - 1 - (this.rowBase[r] ?? r * ROW_H) - (h >= ROW_H ? ROW_H / 2 - 2 : 1);
  }

  /** The band's height (px above "now") to the top of row r. */
  rowTop(r: number): number {
    return 1 + (this.rowBase[r] ?? r * ROW_H) + (this.rowH[r] ?? ROW_H);
  }

  draw(ctx: CanvasRenderingContext2D, ink: string, ink2: string): void {
    if (!this.placed.length) return;
    ctx.save();
    ctx.globalAlpha = this.fit;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const p of this.placed) {
      const q = this.list[p.i];
      const y = Math.round(this.rowY(p.row)) + 0.5;
      // Past the time axis or the screen's edge it runs on, open-ended (no end tick there).
      const ta = p.a >= this.x0;
      const tb = p.b <= this.w;
      const a = Math.round(Math.max(p.a, this.x0)) + 0.5;
      const b = Math.round(Math.min(p.b, this.w)) - 0.5;
      ctx.strokeStyle = p.form === 'tick' ? 'rgba(185,230,201,0.45)' : 'rgba(185,230,201,0.75)';
      // (End ticks down to the row under it: shorter in a row of ticks.)
      const dy = (this.rowH[p.row] ?? ROW_H) >= ROW_H ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(a, ta ? y + dy : y);
      ctx.lineTo(a, y);
      if (p.form === 'tick') ctx.lineTo(b, y);
      else {
        // The line broken around the label.
        ctx.lineTo(Math.max(a, p.lx - p.lw / 2 - 4), y);
        ctx.moveTo(Math.min(b, p.lx + p.lw / 2 + 4), y);
        ctx.lineTo(b, y);
      }
      if (tb) ctx.lineTo(b, y + dy);
      ctx.stroke();
      if (p.form === 'tick') continue;
      let x = p.lx - p.lw / 2;
      const short = p.form === 'short';
      ctx.font = q.en || short ? this.nameFont : this.latinFont;
      ctx.fillStyle = q.en || short ? ink : ink2;
      const name = short ? TAXON_SHORT[q.latin] : (q.en ?? q.latin);
      ctx.fillText(name, x, y);
      if (p.form === 'full' && q.en) {
        x += ctx.measureText(name).width + 4;
        ctx.font = this.latinFont;
        ctx.fillStyle = ink2;
        ctx.fillText(q.latin, x, y);
      }
    }
    ctx.restore();
  }

  /** The clade under screen (x, y): the bracket in that row nearest x (on it, or within a few px of slop). */
  hit(x: number, y: number): Clade | null {
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

/**
 * Where a tap on a clade's bracket lands (ToLaD#193): the clade (`span` its world x at "now") across the screen and
 * centred, its columns opened as that zoom opens them (folded: a few rounds, the fold left at the frame's zoom and
 * anchor for the camera taking it), and its time from "now" at the top down to where its branch started (its stem: its split
 * from its sister, `v.yBot`), a little of the parent below it. `band` makes room above "now" for the brackets.
 */
export function cladeCamera(
  c: { frame(x0: number, x1: number, yFork: number, stretch?: boolean): Camera; w: number },
  fan: Fan,
  v: FanNode,
  span: (v: FanNode) => [number, number],
  band: (cam: Camera) => Camera = (cam) => cam,
): Camera {
  const frame = () => {
    const [a, b] = span(v);
    return band(c.frame(a, b, v.yBot, true));
  };
  let cam = frame();
  const f = fan.tess.fold;
  if (!f) return cam;
  // Folded, the clade's span grows with the zoom (its inner gaps open, fold.ts), so framing it at the zoom it was
  // measured at swings between closed-and-zoomed-in and open-and-zoomed-out. The zoom that frames the span it opens
  // to is one point: the span (px) a zoom gives grows with it, so bisect (in log zoom) on where it fills the frame.
  const cy = cam.cy;
  const settleAt = (sx: number): Camera => {
    f.setScale(sx, c.w);
    let at = cam;
    // The rows anchored on the clade's centre (each anchoring moves the row a little: a few rounds).
    for (let k = 0; k < 6; k++) {
      at = frame();
      if (!f.setAnchor(at.cx, cy, sx, c.w)) break;
    }
    return frame();
  };
  let lo = Math.log(cam.sx) - 1;
  let hi = Math.log(cam.sx) + 1;
  for (let k = 0; k < 8 && settleAt(Math.exp(lo)).sx < Math.exp(lo); k++) lo -= 2;
  for (let k = 0; k < 8 && settleAt(Math.exp(hi)).sx > Math.exp(hi); k++) hi += 2;
  for (let k = 0; k < 40 && hi - lo > 1e-7; k++) {
    const m = (lo + hi) / 2;
    if (settleAt(Math.exp(m)).sx > Math.exp(m)) lo = m;
    else hi = m;
  }
  cam = settleAt(Math.exp(lo));
  // The fold left exactly at the frame's zoom and anchor, for the camera taking it.
  f.setScale(cam.sx, c.w);
  f.setAnchor(cam.cx, cy, cam.sx, c.w);
  return cam;
}
