// Gradual speciation (ToLaD#50): the viewer's choice of how a split is drawn,
// and the cross-links between sister strands that carry it (bridge.ts).
//
// Below a split its daughters' strands sit side by side in the parent column
// (layout.ts). In the clean split (the default, #46) each strand is its own
// mesh: nothing crosses between them. The gradual options let the strands
// interbreed across every boundary of a parent column (one population), and
// differ only in how that stops at the split that separates the two strands
// (a boundary's split: the node whose two neighbouring daughters they face):
//   - fading: the links thin out to none over a window from the split up,
//     while the columns part as usual (the mesh tearing);
//   - hybrid: below the split the links reach into both strands, a shared
//     strip of mesh that opens just below the window and narrows to nothing
//     over it, ending at the split, where the strands part;
//   - late: the links go on at full density up to the split, then a sparse
//     few keep appearing over a longer window above it and die off.
// The window is a share of the split's fork span (the height its daughters
// take to part), short or long: world-fixed, like everything else here. The
// columns' geometry is the same in every option, so the widths add up as in
// the clean split.

import { lowbias32 } from '../../../packages/procgen/src/hash.ts';
import { BRIDGE_GAP1, BRIDGE_J, packBridge, type BridgeInst } from './bridge';
import type { BridgeLayer } from './bridgegl';
import { isNode, laneAt, leftAt, STEM_BOTTOM_MA, TIME_C, type Fan, type FanBranch, type FanNode } from './layout';
import type { TwigView } from './twigs';

export type SplitStyle = 'clean' | 'fading' | 'hybrid' | 'late';
export type SplitWindow = 'short' | 'long';
export const SPLIT_STYLES: SplitStyle[] = ['clean', 'fading', 'hybrid', 'late'];
/** The toggle's labels (short: they share the bar), and their full names. */
export const SPLIT_LABEL: Record<SplitStyle, string> = { clean: 'clean', fading: 'fading', hybrid: 'hybrid', late: 'late flow' };
export const SPLIT_NAME: Record<SplitStyle, string> = { clean: 'clean split', fading: 'fading links', hybrid: 'hybrid zone', late: 'late gene flow' };

/** The window's height in fork spans (short, long). */
export const WINDOW_SPANS: Record<SplitWindow, number> = { short: 0.5, long: 1.2 };
/** Late gene flow: the share of the links still there just after the split, and how much longer its window is. */
export const LATE_AMP = 0.3;
export const LATE_STRETCH = 2;
/** Hybrid zone: the strip's widest reach into each strand (share of its width), and where it opens (window heights below the split). */
export const HYBRID_REACH = 0.4;
export const HYBRID_IN = 1.3;
/** The links' opacity (one per generation; the hybrid zone's J per generation). */
const BRIDGE_ALPHA = 0.95;
const HYBRID_ALPHA = 0.6;

/** Two neighbouring strands of a parent column, a left of b, and the split that separates them. */
export interface SisterPair {
  a: FanBranch;
  b: FanBranch;
  node: FanNode;
  /** The pair's identity (bridge.ts P). */
  seed: number;
  /** The split's fork span (world height its daughters take to part; at least a floor). */
  span: number;
}

const pairsCache = new WeakMap<Fan, SisterPair[]>();

/** Every boundary between neighbouring strands, by the split that separates them. */
export function sisterPairs(fan: Fan): SisterPair[] {
  const hit = pairsCache.get(fan);
  if (hit) return hit;
  const out: SisterPair[] = [];
  for (const v of fan.nodes) {
    let span = 0;
    for (const k of v.kids) span = Math.max(span, v.y - k.leanY);
    span = Math.max(span, 4);
    for (let i = 0; i + 1 < v.kids.length; i++) {
      const L = v.kids[i];
      const R = v.kids[i + 1];
      const a = isNode(L) ? L.strands[L.strands.length - 1] : L;
      const b = isNode(R) ? R.strands[0] : R;
      const seed = lowbias32((Math.imul(a.index + 1, 0x9e3779b1) ^ Math.imul(b.index + 1, 0x85ebca77) ^ 0x50a1c3e7) >>> 0);
      out.push({ a, b, node: v, seed, span });
    }
  }
  pairsCache.set(fan, out);
  return out;
}

/**
 * A pair's schedules in world heights (y grows into the past): keep falls from
 * 1 at yK0 to amp at yK1 and beyond; reach from rmax at yH0 to 0 at yH1; no
 * links above yTop.
 */
export function pairSchedule(p: SisterPair, style: SplitStyle, win: SplitWindow): { yK0: number; yK1: number; amp: number; yHIn: number; yH0: number; yH1: number; rmax: number; J: number; yTop: number } {
  const yS = p.node.y;
  const H = WINDOW_SPANS[win] * p.span;
  switch (style) {
    case 'fading':
      return { yK0: yS, yK1: yS - H, amp: 1, yHIn: yS, yH0: yS, yH1: yS, rmax: 0, J: 1, yTop: yS - H };
    case 'hybrid':
      return { yK0: yS, yK1: yS, amp: 0, yHIn: yS + HYBRID_IN * H, yH0: yS + H, yH1: yS, rmax: HYBRID_REACH, J: BRIDGE_J, yTop: yS };
    case 'late':
      return { yK0: yS, yK1: yS - LATE_STRETCH * H, amp: LATE_AMP, yHIn: yS, yH0: yS, yH1: yS, rmax: 0, J: 1, yTop: yS - LATE_STRETCH * H };
    default:
      return { yK0: yS, yK1: yS, amp: 0, yHIn: yS, yH0: yS, yH1: yS, rmax: 0, J: 0, yTop: yS };
  }
}

/**
 * This frame's cross-links between sister strands: per pair, one instance per
 * chord of their facing edges over the screen, from the top of their links
 * down to the split (the hybrid zone: to where its strip opens).
 */
export function bridgeInstances(v: TwigView, fan: Fan, style: SplitStyle, win: SplitWindow, layer: BridgeLayer): number {
  if (style === 'clean') return 0;
  const time = fan.time;
  const [, wyTop] = v.toWorld(0, -4);
  const [, wyBot] = v.toWorld(0, v.h + 4);
  const tOrigin = STEM_BOTTOM_MA * 1e6;
  let n = 0;
  for (const p of sisterPairs(fan)) {
    const s = pairSchedule(p, style, win);
    const { a, b } = p;
    const yLo = Math.max(wyTop, s.yTop, a.tipY, b.tipY);
    // (Below the split the strands touch: a link there has no length unless it reaches into them.)
    const yHi = Math.min(wyBot, time.y(STEM_BOTTOM_MA), s.rmax > 0 ? s.yHIn : p.node.y);
    if (!(yHi > yLo)) continue;
    const GL = p.node.genYears;
    const gOf = (y: number) => (tOrigin - time.ageAt(y) * 1e6) / GL;
    const xa = (y: number) => v.toScreen(leftAt(a, y) + laneAt(a, y).w, y)[0];
    const xb = (y: number) => v.toScreen(leftAt(b, y), y)[0];
    const cuts = chords(v, [a, b], yLo, yHi, xa, xb);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const ya = cuts[c];
      const yb = cuts[c + 1];
      const [, pya] = v.toScreen(0, ya);
      const [, pyb] = v.toScreen(0, yb);
      if (!(pyb - pya > 1e-3)) continue;
      const y0 = Math.max(-4, pya);
      const y1 = Math.min(v.h + 4, pyb);
      if (!(y1 > y0)) continue;
      const xa0 = xa(ya);
      const xa1 = xa(yb);
      const xb0 = xb(ya);
      const xb1 = xb(yb);
      const sa = (xa1 - xa0) / (pyb - pya);
      const sb = (xb1 - xb0) / (pyb - pya);
      const ym = (ya + yb) / 2;
      const La = laneAt(a, ym);
      const Lb = laneAt(b, ym);
      const wa = La.w * v.sx;
      const wb = Lb.w * v.sx;
      const xaT = xa0 + sa * (y0 - pya);
      const xbT = xb0 + sb * (y0 - pya);
      const xaB = xa0 + sa * (y1 - pya);
      const xbB = xb0 + sb * (y1 - pya);
      // (Every link here too long to show: bridge.ts BRIDGE_GAP1.)
      if (Math.min(xbT - xaT, xbB - xaB) >= BRIDGE_GAP1 * (wa + wb)) continue;
      const x0 = Math.max(-4, Math.min(xaT, xaB) - s.rmax * wa - 3);
      const x1 = Math.min(v.w + 4, Math.max(xbT, xbB) + s.rmax * wb + 3);
      if (!(x1 > x0)) continue;
      const [, wy0] = v.toWorld(0, y0);
      const age = time.ageAt(wy0) * 1e6;
      const t0 = tOrigin - age;
      const gA = Math.floor(t0 / GL);
      const inst: BridgeInst = {
        x0,
        y0,
        x1,
        y1,
        xa: xaT,
        xb: xbT,
        sa,
        sb,
        wa,
        wb,
        lw: 2.25,
        alpha: s.J > 1 ? HYBRID_ALPHA : BRIDGE_ALPHA,
        p0: y0,
        T0: t0 - gA * GL,
        A: age + TIME_C,
        GL,
        k0: gOf(s.yK0) - gA,
        k1: gOf(s.yK1) - gA,
        amp: s.amp,
        hIn: gOf(s.yHIn) - gA,
        h0: gOf(s.yH0) - gA,
        h1: gOf(s.yH1) - gA,
        rmax: s.rmax,
        // A link's colour by its child's end: a's right edge is its gray lane unless all of it is green; b's left edge its green lane, if any.
        cL: (La.w - La.gw) * v.sx < 0.5 && La.gw > 0 ? 1 : 2,
        cR: Lb.gw * v.sx >= 0.5 ? 1 : 2,
        P: p.seed,
        gA,
        J: s.J,
      };
      // (next() first: it may grow the arrays.)
      const k = layer.next();
      packBridge(inst, layer.f, layer.u, k);
      n++;
    }
  }
  return n;
}

/**
 * Heights cutting [yLo, yHi] into chords of the facing edges: at the strands'
 * features (their splits, peels and tips), then halved while an edge strays
 * from its chord by more than a quarter px (or a chord is over 120 px tall).
 */
function chords(v: TwigView, bs: FanBranch[], yLo: number, yHi: number, xa: (y: number) => number, xb: (y: number) => number): number[] {
  const marks = [yLo, yHi];
  for (const b of bs) {
    marks.push(b.splitY, b.leanY, b.tipY);
    for (const s of b.path) marks.push(s.y, s.node.leanY, s.node.yBot);
  }
  const ys = [...new Set(marks.filter((y) => y >= yLo && y <= yHi))].sort((p, q) => p - q);
  const out: number[] = [ys[0]];
  const py = (y: number) => v.toScreen(0, y)[1];
  const split = (y0: number, y1: number, depth: number) => {
    const h = py(y1) - py(y0);
    const ym = (y0 + y1) / 2;
    const off = Math.max(Math.abs(xa(ym) - (xa(y0) + xa(y1)) / 2), Math.abs(xb(ym) - (xb(y0) + xb(y1)) / 2));
    if (depth < 14 && h > 2 && (off > 0.25 || h > 120)) {
      split(y0, ym, depth + 1);
      split(ym, y1, depth + 1);
    } else out.push(y1);
  };
  for (let k = 0; k + 1 < ys.length; k++) if (ys[k + 1] > ys[k]) split(ys[k], ys[k + 1], 0);
  return out;
}
