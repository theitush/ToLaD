// The names written on the tree on its side (ToLaD#455): the gaps are the titles of the branches under them, a species' name inside its own branch.
//
// One rule at every level: a name shows when it fits, and nothing else decides. A gap holds the title of every clade
// that starts right under it, each on its own line, outermost on top, so a fork's upper daughter stands in its parent's
// gap under its parent; as many lines as fit its height, the innermost dropping first. A room taller than the text
// holds its species' name. Along time each needs its own stretch to be longer than the text. Which names show depends on
// the camera's two scales alone, never on where it stands, so a slide brings no name in or out but by the screen's edge
// (or a pill's cover). Each room and each gap has its own stretch of x and a stack's lines their own of it, so names
// meet only in the rare place rooms share an x (rooms by life), where the later one is not written.
//
// Per frame: a binary search for the strands on screen, two comparisons a strand, and work only for those that fit.
// A name's text and width are found once and kept.

import { upright } from './flip';
import { isNode, type Fan, type FanBranch, type FanNode } from './layout';
import type { Steady } from './steady';

/** The text's own sizes (px): what "fits" is measured against. */
export const CLADE_PX = 12;
export const SPECIES_PX = 11;
export const CLADE_FONT = `650 ${CLADE_PX}px`;
export const SPECIES_FONT = `500 ${SPECIES_PX}px`;
/** A stack's lines stand this many times the text's height apart. */
const LEAD = 1.2;
/** A name fades in while its strip grows from the text's height to this many times it. */
const FADE_TO = 1.25;
/** From the phone's edges, and from a name's own end of its stretch: a share of the text's height, so it scales with the text. */
const PAD = 0.5;

/** How far in a name is, by its strip's height on screen: 0 where the text does not fit. */
export function fitShare(strip: number, px: number): number {
  const t = (strip - px) / (px * (FADE_TO - 1));
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

export interface WrittenName {
  text: string;
  /** Its box in the view's coordinates: x across the strands (down the phone), y along time (now the least; the text's left end at y1). */
  box: [number, number, number, number];
  alpha: number;
  /** A clade's title in a gap: this clade. */
  v?: FanNode;
  /** A species' name in its branch: this strand (drawn order). */
  k?: number;
}

type Box = readonly number[];
interface Cam {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
}

export class GapNames {
  /** Per strand (drawn order): the clades starting right under the gap above it, outermost first. */
  private readonly heads: FanNode[][];
  private reachOf: { C: Float64Array; maxBottom: Float64Array; minTop: Float64Array } | null = null;
  private readonly ends = new Map<FanNode, number>();
  private readonly widths = new Map<string, number>();
  private readonly S: FanBranch[];
  readonly yNow: number;

  constructor(
    fan: Fan,
    private readonly fold: Steady,
    private readonly cladeName: (v: FanNode) => string,
    private readonly speciesName: (b: FanBranch) => string,
    private readonly measure: (font: string, text: string) => number,
  ) {
    this.S = fold.strands;
    this.heads = this.S.map(() => []);
    this.yNow = fan.time.y(0);
    // (Down the tree, parents first. Not by a strand's path: it is sorted by age, and a few dated forks stand older than their parents.)
    const stack: FanNode[] = [fan.root];
    while (stack.length) {
      const v = stack.pop()!;
      // (A title says a clade's name: an unnamed fork has none, and one repeating its parent's says nothing new.)
      const text = this.cladeName(v);
      if (text && !(v.parent && text === this.cladeName(v.parent))) this.heads[v.strands[0].index].push(v);
      for (const c of v.kids) if (isNode(c)) stack.push(c);
    }
  }

  /** The titles in the gap above strand k, outermost first: every named clade whose first strand it is. The first strand's gap is the space over the tree, so its stack starts at the root. */
  headsOf(k: number): FanNode[] {
    return this.heads[k];
  }

  private width(font: string, text: string): number {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) this.widths.set(key, (w = this.measure(font, text)));
    return w;
  }

  /** Clade v's young end, world y: "now" if any of it lives, else its last tip. Once a clade. */
  private endOf(v: FanNode): number {
    let e = this.ends.get(v);
    if (e === undefined) {
      e = Infinity;
      for (const b of v.strands) e = Math.min(e, Math.max(b.tipY, this.yNow));
      this.ends.set(v, e);
    }
    return e;
  }

  /**
   * What the search for the screen reads, once a layout: an extinct strand and the sister it never lived beside may stand
   * in each other's x (rooms by life, steady.ts), so the rooms alone are not in order. Per strand the furthest bottom edge up to
   * it and the nearest top edge from it on.
   */
  private reach(C: Float64Array, R: Float64Array): { maxBottom: Float64Array; minTop: Float64Array } {
    let r = this.reachOf;
    if (!r || r.C !== C) {
      const n = C.length;
      const maxBottom = new Float64Array(n);
      const minTop = new Float64Array(n);
      for (let k = 0, m = -Infinity; k < n; k++) maxBottom[k] = m = Math.max(m, C[k] + R[k] / 2);
      for (let k = n - 1, m = Infinity; k >= 0; k--) minTop[k] = m = Math.min(m, C[k] - R[k] / 2);
      this.reachOf = r = { C, maxBottom, minTop };
    }
    return r;
  }

  /**
   * The names that fit on this camera, w x h the view. `covers`: boxes a name must not meet (the pills, the pictures).
   * The text stays on screen in a pan across time, within its own stretch: a clade's from its stem's start to its young end,
   * a species' from its birth to its tip, the clade's left end kept at its start, the species' right end at its tip.
   */
  place(c: Cam, w: number, h: number, covers: readonly Box[], out: WrittenName[] = []): WrittenName[] {
    out.length = 0;
    const { C, R } = this.fold.rooms();
    const S = this.S;
    const n = S.length;
    const { sx, sy } = c;
    const X = (x: number) => (x - c.cx) * sx + w / 2;
    // (The phone's x of a world y: the view's y turned, "now" on the right.)
    const P = (y: number) => h - ((y - c.cy) * sy + h / 2);
    // (The first strand whose room reaches the screen: its gap, above it, is the first that may be.)
    const x0 = c.cx - w / 2 / sx;
    const x1 = c.cx + w / 2 / sx;
    const { maxBottom, minTop } = this.reach(C, R);
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (maxBottom[m] < x0) lo = m + 1;
      else hi = m;
    }
    // (One past the screen's foot: its gap may be on screen, above it.)
    for (let k = lo; k < n; k++) {
      const top = C[k] - R[k] / 2;
      const bottom = C[k] + R[k] / 2;
      // (The first strand's gap, the space over the tree, is as tall as it needs.)
      const gapPx = k > 0 ? (top - (C[k - 1] + R[k - 1] / 2)) * sx : Infinity;
      if (gapPx >= CLADE_PX) this.placeStack(k, X(top), gapPx, P, w, h, sy, covers, out);
      if (minTop[k] > x1) break;
      const bandPx = R[k] * sx;
      if (bandPx >= SPECIES_PX) {
        const alpha = fitShare(bandPx, SPECIES_PX);
        if (alpha > 0) this.placeSpecies(k, X((top + bottom) / 2), alpha, P, w, h, sy, covers, out);
      }
    }
    return out;
  }

  /** The stack in the gap above strand k, its foot just over the clade, topS. */
  private placeStack(k: number, topS: number, gapPx: number, P: (y: number) => number, w: number, h: number, sy: number, covers: readonly Box[], out: WrittenName[]): void {
    const heads = this.headsOf(k);
    const lead = CLADE_PX * LEAD;
    const pad = CLADE_PX * PAD;
    const lines: { v: FanNode; text: string; tw: number; start: number; end: number }[] = [];
    // (Outermost first, as many as its height holds; one with no room along its stretch takes no line.)
    for (const v of heads) {
      if (CLADE_PX + lines.length * lead > gapPx) break;
      const text = this.cladeName(v);
      if (!text) continue;
      const tw = this.width(CLADE_FONT, text);
      // (Its stem starts where its parent's fork has parted it.)
      const start = v.parent ? v.parent.y - this.fold.forkH(v.parent) : v.y;
      const end = this.endOf(v);
      if ((start - end) * sy >= tw + 2 * pad) lines.push({ v, text, tw, start, end });
    }
    if (!lines.length) return;
    const block = CLADE_PX + (lines.length - 1) * lead;
    const foot = topS - Math.min((gapPx - block) / 2, CLADE_PX / 4);
    lines.forEach((l, i) => {
      const cx = foot - CLADE_PX / 2 - (lines.length - 1 - i) * lead;
      const left = Math.min(Math.max(P(l.start) + pad, pad), P(l.end) - pad - l.tw);
      this.keep(CLADE_PX, cx, left, l.tw, w, h, fitShare(gapPx - i * lead, CLADE_PX), covers, out, l.text, l.v, undefined);
    });
  }

  private placeSpecies(k: number, cx: number, alpha: number, P: (y: number) => number, w: number, h: number, sy: number, covers: readonly Box[], out: WrittenName[]): void {
    const b = this.S[k];
    const text = this.speciesName(b);
    if (!text) return;
    const tw = this.width(SPECIES_FONT, text);
    const pad = SPECIES_PX * PAD;
    // (Its own column, from where it has peeled off its split to its tip.)
    const birth = b.splitY - this.fold.forkH(b.path[0].node);
    const tip = Math.max(b.tipY, this.yNow);
    if ((birth - tip) * sy < tw + 2 * pad) return;
    const right = Math.max(Math.min(P(tip) - pad, h - pad), P(birth) + pad + tw);
    this.keep(SPECIES_PX, cx, right - tw, tw, w, h, alpha, covers, out, text, undefined, k);
  }

  private keep(px: number, cx: number, left: number, tw: number, w: number, h: number, alpha: number, covers: readonly Box[], out: WrittenName[], text: string, v: FanNode | undefined, k: number | undefined): void {
    const box: [number, number, number, number] = [cx - px / 2, h - left - tw, cx + px / 2, h - left];
    // (Off the screen: no name; a pill's or picture's: not half-covered.)
    if (box[2] < 0 || box[0] > w || box[3] < 0 || box[1] > h) return;
    for (const q of covers) if (box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]) return;
    // (Strips stand apart but where a strand and a sister it never lived beside share an x, and there their stretches along time are their own.)
    for (const m of out) if (box[0] < m.box[2] && box[2] > m.box[0] && box[1] < m.box[3] && box[3] > m.box[1]) return;
    out.push({ text, box, alpha, v, k });
  }

  /** On the turned canvas, in the phone's upright coordinates (flip.ts's upright, h the view's). */
  draw(ctx: CanvasRenderingContext2D, names: readonly WrittenName[], h: number, sans: (spec: string) => string, cladeInk: string, speciesInk: string, halo: string): void {
    if (!names.length) return;
    ctx.save();
    upright(ctx, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    for (const clade of [true, false]) {
      ctx.font = sans(clade ? CLADE_FONT : SPECIES_FONT);
      ctx.fillStyle = clade ? cladeInk : speciesInk;
      for (const m of names) {
        if (!!m.v !== clade) continue;
        ctx.globalAlpha = m.alpha;
        const x = h - m.box[3];
        const y = (m.box[0] + m.box[2]) / 2 + 0.5;
        ctx.strokeText(m.text, x, y);
        ctx.fillText(m.text, x, y);
      }
    }
    ctx.restore();
  }
}
