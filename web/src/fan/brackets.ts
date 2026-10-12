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

/** Row height (px) of the stack, the font, and the least span (px) a bracket is drawn at. */
export const ROW_H = 14;
export const TICK_MIN = 3;
/** Room (px) kept clear each side of a label inside its bracket, and the gap between neighbouring brackets in a row. */
const LABEL_PAD = 5;
const GAP = 2;

export type Form = 'full' | 'name' | 'tick';

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
 * (parents before daughters), `widths(i)` its labels' widths [full, name]. A clade is shown when its span is at least
 * TICK_MIN px; its row is one above the highest row shown inside it (`rows`, when given, fixes them instead: the
 * zoom bucket's), so a bracket always stands above the brackets nested in it. Its label goes in the part of the span
 * on screen between `x0` and `x1`, centred there, the full one if it fits, else the name alone, else a tick.
 */
export function layoutBrackets(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  parent: ArrayLike<number>,
  widths: (i: number) => [number, number],
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
    const [wf, wn] = widths(i);
    const form: Form = wf <= room ? 'full' : wn <= room ? 'name' : 'tick';
    const lw = form === 'full' ? wf : form === 'name' ? wn : 0;
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
  private widthCache = new Map<string, [number, number]>();
  private rowKey = '';
  private rows: Int16Array | null = null;
  placed: Placed[] = [];
  list: Clade[] = [];
  /** Band height (px above the "now" line) over each screen column. */
  sky = new Float32Array(0);
  nowS = 0;
  fit = 0;

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
    this.placed = fit > 0 ? layoutBrackets(a, b, parent, (i) => this.widths(i, measure), axisX, c.w, this.rows) : [];
    const sky = (this.sky = new Float32Array(Math.ceil(c.w) + 1));
    for (const p of this.placed) {
      const h = (p.row + 1) * ROW_H;
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

  private widths(i: number, measure: (font: string, text: string) => number): [number, number] {
    const q = this.list[i];
    let w = this.widthCache.get(q.latin);
    if (!w) {
      const name = measure(this.nameFont, q.en ?? q.latin);
      w = [q.en ? name + 4 + measure(this.latinFont, q.latin) : name, name];
      this.widthCache.set(q.latin, w);
    }
    return w;
  }

  /** Row r's line (screen y). */
  rowY(r: number): number {
    return this.nowS - 6 - r * ROW_H;
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
      const a = Math.round(p.a) + 0.5;
      const b = Math.round(p.b) - 0.5;
      ctx.strokeStyle = p.form === 'tick' ? 'rgba(185,230,201,0.45)' : 'rgba(185,230,201,0.75)';
      ctx.beginPath();
      ctx.moveTo(a, y + 4);
      ctx.lineTo(a, y);
      if (p.form === 'tick') ctx.lineTo(b, y);
      else {
        // The line broken around the label.
        ctx.lineTo(Math.max(a, p.lx - p.lw / 2 - 4), y);
        ctx.moveTo(Math.min(b, p.lx + p.lw / 2 + 4), y);
        ctx.lineTo(b, y);
      }
      ctx.lineTo(b, y + 4);
      ctx.stroke();
      if (p.form === 'tick') continue;
      let x = p.lx - p.lw / 2;
      ctx.font = q.en ? this.nameFont : this.latinFont;
      ctx.fillStyle = q.en ? ink : ink2;
      const name = q.en ?? q.latin;
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

  /** The clade under screen (x, y): a bracket's line or label, a few px of slop; the innermost first. */
  hit(x: number, y: number): Clade | null {
    let best: Placed | null = null;
    for (const p of this.placed) {
      const ry = this.rowY(p.row);
      if (x < p.a - 3 || x > p.b + 3 || y < ry - ROW_H / 2 || y > ry + ROW_H / 2) continue;
      if (!best || p.row < best.row) best = p;
    }
    return best ? this.list[best.i] : null;
  }
}
