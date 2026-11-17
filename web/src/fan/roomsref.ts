// The rooms' answers as the whole rows gave them before ToLaD#502, kept as the reference the range answers are held to
// (rooms.test.ts, roomsynth.test.ts): a merged clade's extent from every strand of a row, xRange's table from every
// strand of every row, and follow from every column of a row (Steady's followRows, still the fallback of a tree whose
// splits are not each under its parent's). Tests only: nothing in the page imports it.

import { g, laneW, type Fan } from './layout';
import type { Steady } from './steady';
import { Fold, type FoldState } from './fold';

/** Grid row k's widths summed along the drawn order (its columns', its live strands' own): as Steady.widthSums had them. */
function widthSums(fan: Fan, f: Steady, k: number): Float64Array {
  const y = k * f.gridH;
  const age = fan.time.ageAt(y);
  const S = f.strands;
  const cW = new Float64Array(S.length + 1);
  for (let i = 0; i < S.length; i++) {
    const b = S[i];
    const own = y < b.splitY;
    const dead = own && y < b.tipY;
    cW[i + 1] = cW[i] + (dead ? 0 : own ? laneW(b, y, age) : b.baseW);
  }
  return cW;
}

/** Strands i0..i1 at grid row k as one ribbon: the hull of every strand's place in the row (Steady.extent before ToLaD#502). */
export function extentRows(fan: Fan, f: Steady, i0: number, i1: number, k: number): [number, number] {
  const cW = widthSums(fan, f, k);
  const xs = f.rowXs(k);
  const y = k * f.gridH;
  let L = Infinity;
  let R = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const w = cW[i + 1] - cW[i];
    if (!(w > 0)) continue;
    const l = y < f.strands[i].splitY ? xs[i] - w / 2 : xs[i];
    if (l < L) L = l;
    if (l + w > R) R = l + w;
  }
  if (L > R) L = R = (xs[i0] + xs[i1]) / 2;
  return [L, R];
}

/** xRange's table over [y0, y1] from every strand of every row (Tess.xTable before ToLaD#502): per strand its edge's least and most. */
export function xTableRows(fan: Fan, f: Steady, y0: number, y1: number): { L: Float64Array; R: Float64Array } {
  const tess = fan.tess as unknown as { bottom: number; tipMin: number };
  const S = f.strands.length;
  const L = new Float64Array(S).fill(Infinity);
  const R = new Float64Array(S).fill(-Infinity);
  const prev = new Float64Array(S);
  const dPrev = new Float64Array(S);
  const h = f.gridH;
  const a = Math.max(y0, tess.tipMin);
  const z = Math.min(y1, tess.bottom);
  if (!(z >= a)) return { L, R };
  const kA = Math.floor(a / h);
  const kB = Math.max(kA, Math.ceil(z / h));
  const st = Math.max(1, Math.ceil((kB - kA) / 512));
  let first = true;
  for (let k = kA; ; k = Math.min(kB, k + st)) {
    const xs = f.rowXs(k);
    if (first) {
      for (let i = 0; i < S; i++) {
        L[i] = R[i] = prev[i] = xs[i];
        dPrev[i] = 0;
      }
      first = false;
    } else if (st === 1) {
      for (let i = 0; i < S; i++) {
        const x = xs[i];
        if (x < L[i]) L[i] = x;
        else if (x > R[i]) R[i] = x;
      }
    } else {
      for (let i = 0; i < S; i++) {
        const x = xs[i];
        if (x < L[i]) L[i] = x;
        if (x > R[i]) R[i] = x;
        const p = prev[i];
        const dx = x - p;
        const dp = dPrev[i];
        if ((dp > 0 && dx < 0) || (dp < 0 && dx > 0)) {
          const over = 0.5 * Math.max(Math.abs(dx), Math.abs(dp));
          if (dp > 0) R[i] = Math.max(R[i], p + over);
          else L[i] = Math.min(L[i], p - over);
        }
        dPrev[i] = dx;
        prev[i] = x;
      }
    }
    if (k >= kB) break;
  }
  return { L, R };
}

/** Tess.xRange's folded answer for strand i from a table of xTableRows'. */
export function xRangeRows(fan: Fan, t: { L: Float64Array; R: Float64Array }, i: number, y0: number, y1: number): [number, number] {
  const b = fan.tess.fold!.strands[i];
  const tess = fan.tess as unknown as { bottom: number };
  const lo = Math.max(y0, b.tipY);
  const hi = Math.min(y1, tess.bottom);
  if (!(hi >= lo)) return [Infinity, -Infinity];
  if (t.L[i] > t.R[i]) return [Infinity, -Infinity];
  const wMax = Math.max(b.baseW, lo < b.splitY ? b.unit * g(b.pop.max, fan.tess.mode) : 0);
  const l = t.L[i] - wMax;
  const r = t.R[i] + wMax;
  const pad = 1e-6 * Math.max(1, Math.abs(l), Math.abs(r)) + (r - l) * 1e-3;
  return [l - pad, r + pad];
}

/** follow from every column of the row (Steady.followRows), the layouts laid out afresh. */
export function followRows(f: Steady, x: number, y: number, prev: FoldState): number {
  const s = f as unknown as { compute(a: Float64Array): unknown; cur(): unknown; followRows(x: number, y: number, L0: unknown, L1: unknown): number };
  return s.followRows(x, y, s.compute(prev.a), s.cur());
}

/** Old against new at random cameras: how many answers, how many to the bit, the largest difference (over the tree's width). */
export interface RoomsReport {
  extent: { n: number; exact: number; worst: number; at?: unknown };
  xRange: { n: number; exact: number; worst: number; asked: number; passed: number; wrong: number };
  /** drawMerged's cull (offSideRun) of random clades: how many passed by, and how many of those had a row on screen. */
  runs: { n: number; off: number; wrong: number };
  follow: { n: number; exact: number; worst: number };
  /** Steady.rowSpan (read where the entries change) against Fold.rowSpan (every row's rowX): to the bit. */
  span: { n: number; exact: number };
}

/**
 * The rooms answered by range against the whole rows (ToLaD#502), at `cams` random cameras (width zoom from home to 10⁴
 * deeper, a grid of 60 to 15,000 rows over the tree, a random window and screen): every merged-clade extent asked of
 * a sample of clades and rows, every strand's xRange and drawStrand's cull (offSide: never true where the whole rows'
 * reach shows), and follow at random points from a random earlier zoom.
 */
export function checkRooms(fan: Fan, f: Steady, cams = 12, seed = 1): RoomsReport {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const W = 844;
  const [h0, h1] = f.homeExtent();
  const home = W / ((h1 - h0) * 1.04);
  const yNow = fan.time.y(0);
  const yBot = fan.trunkBottom.y;
  const root = fan.nodes.indexOf(fan.root);
  const rep: RoomsReport = { extent: { n: 0, exact: 0, worst: 0 }, xRange: { n: 0, exact: 0, worst: 0, asked: 0, passed: 0, wrong: 0 }, follow: { n: 0, exact: 0, worst: 0 }, span: { n: 0, exact: 0 }, runs: { n: 0, off: 0, wrong: 0 } };
  const setCam = (sx: number) => {
    f.setScale(sx, W);
    f.keep()();
  };
  for (let c = 0; c < cams; c++) {
    const sx = home * Math.pow(10, 4 * rnd());
    setCam(sx);
    const H = Math.pow(2, Math.round(Math.log2((yBot - yNow) / (60 * Math.pow(250, rnd())))));
    f.setGrid(H);
    const { roomL, roomW } = f.rooms();
    const span = Math.max(Math.abs(roomL[root]), Math.abs(roomL[root] + roomW[root]), roomW[root]);
    const diff = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / span);
    // Extents: a sample of clades, at rows about their split (where a merged clade is drawn) and anywhere.
    for (let q = 0; q < 120; q++) {
      const v = fan.nodes[Math.floor(rnd() * fan.nodes.length)];
      const i0 = v.strands[0].index;
      const i1 = v.strands[v.strands.length - 1].index;
      const tip = Math.min(...v.strands.map((b) => b.tipY));
      for (let r = 0; r < 6; r++) {
        const y = r < 4 ? tip + (Math.min(yBot, v.y + (v.y - tip)) - tip) * rnd() : yNow + (yBot - yNow) * rnd();
        const k = r === 5 ? y / H : Math.round(y / H);
        const a = f.extent(i0, i1, k, [0, 0]);
        const b = extentRows(fan, f, i0, i1, k);
        const d = Math.max(diff(a[0], b[0]), diff(a[1], b[1]));
        rep.extent.n++;
        if (d === 0) rep.extent.exact++;
        if (d > rep.extent.worst) rep.extent.at = { v: v.name, i0, i1, k, y: k * H, split: v.y, sx, H, new: a, old: b };
        rep.extent.worst = Math.max(rep.extent.worst, d);
      }
    }
    // xRange and the cull: a window a screen tall (50 to 300 rows), a screen W px wide about a random x.
    const y0 = yNow + (yBot - yNow) * rnd() - 20 * H;
    const y1 = y0 + H * (50 + 250 * rnd());
    const t = xTableRows(fan, f, y0, y1);
    const cx = roomL[root] + roomW[root] * (1.2 * rnd() - 0.1);
    const xm = (W / 2 + 13) / sx;
    const xe = (W / 2 + 12) / sx;
    for (let i = 0; i < f.strands.length; i++) {
      const b = f.strands[i];
      const old = xRangeRows(fan, t, i, y0, y1);
      const off = f.offSide(i, y0, y1, cx - xm, cx + xm);
      const shows = !(old[1] < cx - xe || old[0] > cx + xe);
      if (off && shows) rep.xRange.wrong++;
      if (!off) rep.xRange.asked++;
      if (shows) rep.xRange.passed++;
      const a = fan.tess.xRange(b, y0, y1);
      const d = old[0] === a[0] && old[1] === a[1] ? 0 : Math.max(diff(a[0], old[0]), diff(a[1], old[1]));
      rep.xRange.n++;
      if (d === 0) rep.xRange.exact++;
      rep.xRange.worst = Math.max(rep.xRange.worst, d);
    }
    // offSideRun: a clade passed by has no row (its extent, held to the whole rows above) within 12 px of the screen.
    for (let q = 0; q < 300; q++) {
      const v = fan.nodes[Math.floor(rnd() * fan.nodes.length)];
      const i0 = v.strands[0].index;
      const i1 = v.strands[v.strands.length - 1].index;
      rep.runs.n++;
      if (!f.offSideRun(i0, i1, y0, y1, cx - xm, cx + xm)) continue;
      rep.runs.off++;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = Math.floor(y0 / H); k <= Math.ceil(y1 / H); k++) {
        const [l, r] = f.extent(i0, i1, k, [0, 0]);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l, r);
      }
      if (!(hi < cx - xe || lo > cx + xe)) rep.runs.wrong++;
    }
    // rowSpan: every strand's least and most over the window's rows, read where they change against every row's.
    const ka = Math.floor(y0 / H);
    const kb = Math.ceil(y1 / H);
    for (let i = 0; i < f.strands.length; i += 3) {
      const a = f.rowSpan(i, ka, kb, H, [0, 0]);
      const b = Fold.prototype.rowSpan.call(f, i, ka, kb, H, [0, 0]);
      rep.span.n++;
      if (a[0] === b[0] && a[1] === b[1]) rep.span.exact++;
    }
    // follow: from a random earlier zoom (its snapshot), at random points; asked twice (the kept layout's answer).
    setCam(home * Math.pow(10, 4 * rnd()));
    const snap = f.snapshot();
    setCam(sx);
    for (let q = 0; q < 200; q++) {
      const x = roomL[root] + roomW[root] * (1.2 * rnd() - 0.1);
      const y = yNow + (yBot - yNow) * (1.05 * rnd() - 0.02);
      const a = f.follow(x, y, snap);
      const a2 = f.follow(x, y, snap);
      const b = followRows(f, x, y, snap);
      const d = Math.max(diff(a, b), diff(a2, b));
      rep.follow.n++;
      if (d === 0) rep.follow.exact++;
      rep.follow.worst = Math.max(rep.follow.worst, d);
    }
  }
  return rep;
}
