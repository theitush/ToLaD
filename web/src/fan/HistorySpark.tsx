// The species card's population history: a tiny log(population)-vs-year chart
// (points coloured by grade, their ranges as bars, the spans between them drawn
// solid, dashed or dotted as on the fan's edge) and, on tap, every point with
// its source. Stretches held flat for want of figures (before the first point,
// after the last) are drawn faint and labelled "no data". A history reaching
// into the deep past (a genomic curve, ToLaD#60/#64) takes a log-time axis in
// years ago, as the fan's own (log10(years ago + TIME_C)), so its shape over
// millions of years reads beside the last century. The genomic curve is one
// band, not a dot per step, and one source row saying how it was joined to the
// next level (ToLaD#80); the natural (pre-human) level is a faint line and its
// own row (ToLaD#61, ToLaD#69).

import { useId, useState } from 'react';
import { approxCountsIn, formatCount } from '../data/count';
import { GRADE_COLOR, GRADE_WORD, MODELLED_KINDS, noDataSpans, styleBetween, type SpanStyle } from './history';
import type { HistoryRec, HistPoint, NaturalMeta, NaturalRec } from './panthera';
import { TIME_C } from './population';
import { EVENT_TINT } from './colstyle';

const W = 340;
const H = 90;
const L = 34; // left margin (population ticks)
const R = 14;
const T = 6;
const B = 16; // bottom margin (year ticks)
const PAD = 0.12; // decades of headroom above and below the central values, at least
const PAD_MAX = 0.25; // and at most, however far the ranges run past them
const NAT_W = 29; // px of the "natural" label (9px type)
const TAPER = 14; // px over which a band flares to a single much wider point (ToLaD#123)
const TOP = T; // the plot's top and bottom edges: bars and bands are clipped here
const BOT = H - B;

const DASH: Record<SpanStyle, string | undefined> = { solid: undefined, dashed: '4 3', dotted: '1.2 3' };
const OPACITY: Record<SpanStyle, number> = { solid: 0.9, dashed: 0.75, dotted: 0.5 };
/** A stretch held flat for want of figures: faint, finely dashed. */
const NODATA = { dash: '2 2.5', opacity: 0.4 };
const STUB = 40; // px of chart left of the first point for a "no data" lead-in

/** Kinds whose figures are cited from a source (a census, an agency estimate), not modelled. */
const CITED = new Set(['census', 'estimate', 'index-scaled', 'unverified']);

/** A point's count, approximately; a small cited count exactly (37 red wolves). */
export function fmtN(n: number, kind = ''): string {
  return formatCount(n, { cited: CITED.has(kind) });
}

/** A round step (1, 2 or 5 × 10^k) near x. */
function nice(x: number): number {
  const e = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, e);
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * Math.pow(10, e);
}

/** 3–5 round years in [x0, x1] (e.g. 1800, 1900, 2000). */
export function yearTicks(x0: number, x1: number): number[] {
  if (!(x1 > x0)) return [x0];
  for (const div of [4, 3, 5, 2, 6]) {
    const step = nice((x1 - x0) / div);
    const out: number[] = [];
    for (let y = Math.ceil(x0 / step) * step; y <= x1 + 1e-9; y += step) out.push(y);
    if (out.length >= 3 && out.length <= 5) return out;
  }
  const step = nice((x1 - x0) / 4);
  const out: number[] = [];
  for (let y = Math.ceil(x0 / step) * step; y <= x1 + 1e-9; y += step) out.push(y);
  return out;
}

/** One or two round populations (powers of ten, or 1/2/5 × 10^k) inside [10^lo, 10^hi]. */
export function popTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) out.push(Math.pow(10, e));
  if (out.length >= 3) return [out[0], out[out.length - 1]];
  if (out.length === 2) return out;
  // Less than two decades: 1/2/5 round numbers inside (the outermost two), else the power of ten or a 2-figure one.
  const c: number[] = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (Math.log10(v) >= lo && Math.log10(v) <= hi) c.push(v);
    }
  }
  if (c.length > 1) return [c[0], c[c.length - 1]];
  if (out.length) return out;
  if (c.length) return c;
  return [Number(Math.pow(10, (lo + hi) / 2).toPrecision(2))];
}

export function fmtYear(y: number): string {
  return y < 0 ? `${Math.round(-y)} BCE` : String(Math.round(y));
}

/**
 * Kinds that are the pipeline's reconstruction, not a cited figure: the genomic (PSMC) curve, the
 * natural level, the range-loss trend and the model's count today. The sparkline draws them as one
 * guessed curve (a line over a faint lo–hi band), never as dots; dots are for cited figures only.
 */
export const CURVE_KINDS = new Set(['genomic', 'natural', 'rangeloss', 'model']);

/** A history spanning more than this many years draws its time axis in log years ago. */
export const DEEP_YEARS = 5000;

/** A date in the sources list: a calendar year, or "~3 million years ago" in the deep past. */
export function fmtWhen(year: number, nowYear: number): string {
  return year < -10000 ? `${formatCount(nowYear - year)} years ago` : fmtYear(year);
}

/** Round "years ago" ticks of a log-time axis: powers of ten from 100 years, below agoMax. */
export function agoTicks(agoMax: number): number[] {
  const out: number[] = [];
  for (let v = 100; v < agoMax; v *= 10) out.push(v);
  return out;
}

/**
 * A row of the sources list: a cited point, the genomic curve as one row, or the natural (pre-human)
 * level (with the range-loss trend's start, when that is the natural level held to 1500 CE).
 */
type Row = { kind: 'point'; p: HistPoint } | { kind: 'genomic'; pts: HistPoint[] } | { kind: 'natural'; start?: HistPoint };

/** A range-loss trend's first point that is the natural level itself (the same count), not a figure of its own. */
export function isNaturalStart(p: HistPoint, natural: { n: number } | null | undefined): boolean {
  return !!natural && p.kind === 'rangeloss' && Math.abs(p.n - natural.n) <= 1e-6 * natural.n;
}

/**
 * Points in time order, a run of genomic steps collapsed into one row; the natural level last, or in
 * place of the range-loss trend's first point when that point is the natural level (listed once, ToLaD#123).
 */
export function sourceRows(pts: HistPoint[], natural: { n: number } | null | undefined): Row[] {
  const rows: Row[] = [];
  let nat = false;
  for (const p of pts) {
    const last = rows[rows.length - 1];
    if (!nat && isNaturalStart(p, natural)) {
      rows.push({ kind: 'natural', start: p });
      nat = true;
    } else if (p.kind === 'genomic' && last?.kind === 'genomic') last.pts.push(p);
    else rows.push(p.kind === 'genomic' ? { kind: 'genomic', pts: [p] } : { kind: 'point', p });
  }
  if (natural && !nat) rows.push({ kind: 'natural' });
  return rows;
}

/** The genomic curve's Ne/N ratio, from its steps' notes ("N = Ne / 0.1"), or null. */
function neRatio(pts: HistPoint[]): string | null {
  for (const p of pts) {
    const m = /N = Ne \/ ([\d.]+)/.exec(p.note);
    if (m) return m[1];
  }
  return null;
}

/**
 * One edge (hi or lo) of a run's band as [x, count] vertices. Where a point's range is much wider
 * than its neighbour's (the jaguar's or the leopard's natural level at 1500 against the genomic
 * curve), the band keeps the narrower width until TAPER px from that point, then flares to it,
 * instead of ballooning across the whole span between them (ToLaD#123).
 */
export function bandEdge(r: HistPoint[], side: 'hi' | 'lo', X: (year: number) => number): [number, number][] {
  const off = (p: HistPoint) => Math.log10(Math.max(1, p[side]) / Math.max(1, p.n)); // signed, in decades
  const out: [number, number][] = [[X(r[0].year), r[0][side]]];
  for (let k = 1; k < r.length; k++) {
    const a = r[k - 1];
    const b = r[k];
    const xa = X(a.year);
    const xb = X(b.year);
    const oa = off(a);
    const ob = off(b);
    const t = Math.min(TAPER, 0.35 * (xb - xa)) / (xb - xa || 1);
    if (Math.abs(ob - oa) > 0.1 && t > 0 && t < 0.5) {
      // A vertex near the wider end, on the straight centre line, at the narrower width.
      const f = Math.abs(ob) > Math.abs(oa) ? 1 - t : t;
      const c = Math.log10(Math.max(1, a.n)) + f * (Math.log10(Math.max(1, b.n)) - Math.log10(Math.max(1, a.n)));
      const o = Math.abs(ob) > Math.abs(oa) ? oa : ob;
      out.push([xa + f * (xb - xa), Math.pow(10, c + o)]);
    }
    out.push([xb, b[side]]);
  }
  return out;
}

/** A small arrowhead at the plot's top (up) or bottom edge: a range running off the chart. */
function chevron(x: number, up: boolean): string {
  return up ? `M${x - 2.5} ${TOP + 2.5} L${x} ${TOP} L${x + 2.5} ${TOP + 2.5}` : `M${x - 2.5} ${BOT - 2.5} L${x} ${BOT} L${x + 2.5} ${BOT - 2.5}`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function HistorySpark({
  h,
  open: open0 = false,
  natural = null,
  naturalMeta = null,
  activeEvent,
}: {
  h: HistoryRec;
  open?: boolean;
  /** The curated event the card is on (its index in h.events): its band drawn stronger. */
  activeEvent?: number;
  /** The species' natural (pre-human) baseline, drawn as a faint level and listed with the sources. */
  natural?: NaturalRec | null;
  naturalMeta?: NaturalMeta | null;
}) {
  const [open, setOpen] = useState(open0);
  const clipId = `spark-clip${useId().replace(/:/g, '')}`;
  const pts = h.points.slice().sort((a, b) => a.year - b.year);
  if (pts.length === 0) return null;
  const nd = noDataSpans(h);
  const before = nd.find((s) => s.side === 'before');
  const after = nd.find((s) => s.side === 'after');
  const held = !!after;
  const x0 = pts[0].year;
  const deep = Math.max(pts[pts.length - 1].year, h.nowYear) - x0 > DEEP_YEARS;
  // A deep history runs to now on its log-time axis; a recent one to its last point (or now, if held to it).
  const x1 = deep ? Math.max(pts[pts.length - 1].year, h.nowYear) : Math.max(pts[pts.length - 1].year, held ? h.nowYear : -Infinity);
  const toNow = deep || held;
  // The y range is the central values' (every point's n, the held and natural levels), not their
  // ranges: a 95% CI ten times the estimate would otherwise flatten a 30% fall to a few pixels
  // (ToLaD#57). Range bars and bands that run past it are clipped at the plot's edge, with a marker.
  const ns = pts
    .map((p) => p.n)
    .concat(before ? [before.level] : [])
    .concat(natural ? [natural.n] : []);
  const lo = Math.log10(Math.max(1, Math.min(...ns)));
  const hi = Math.log10(Math.max(1, ...ns));
  // Headroom: enough for the ranges (bars, the reconstructed band) where they run a little past
  // the central values, never more than PAD_MAX; anything further is clipped.
  const rlo = Math.log10(Math.max(1, Math.min(...pts.map((p) => p.lo))));
  const rhi = Math.log10(Math.max(1, ...pts.map((p) => p.hi)));
  const ylo = lo - Math.min(PAD_MAX, Math.max(PAD, (hi - lo) * 0.1, lo - rlo));
  const yhi = hi + Math.min(PAD_MAX, Math.max(PAD, (hi - lo) * 0.1, rhi - hi));
  const left = L + (before ? STUB : 0);
  const sAgo = (year: number) => Math.log10(Math.max(0, x1 - year) + TIME_C);
  const X = deep
    ? (y: number) => left + ((W - left - R) * (sAgo(x0) - sAgo(y))) / (sAgo(x0) - sAgo(x1) || 1)
    : (y: number) => left + ((W - left - R) * (y - x0)) / (x1 - x0 || 1);
  const Y = (n: number) => T + ((H - T - B) * (yhi - Math.log10(Math.max(1, n)))) / (yhi - ylo);
  // Curated events (ToLaD#141): each window a labelled band over the plot, at least 3 px wide; labels
  // alternate between two rows so neighbouring windows keep both names.
  const evBands = (h.events ?? []).flatMap((ev, k) => {
    const ya = Math.max(x0, h.nowYear - ev.fromYa);
    const yb = Math.min(x1, h.nowYear - ev.toYa);
    if (!(yb > ya)) return [];
    let xa = X(ya);
    let xb = X(yb);
    if (xb - xa < 3) [xa, xb] = [(xa + xb) / 2 - 1.5, (xa + xb) / 2 + 1.5];
    const mid = (xa + xb) / 2;
    const anchor: 'start' | 'middle' | 'end' = mid > W - R - 50 ? 'end' : mid < left + 50 ? 'start' : 'middle';
    const tx = anchor === 'end' ? xb : anchor === 'start' ? xa : mid;
    const on = activeEvent === undefined || activeEvent === k;
    // Its name: only the active event's when the card is on one (neighbouring windows' names would collide).
    const named = activeEvent === undefined || activeEvent === k;
    const tw = ev.title.length * 4.4; // ~px at 9px type
    const lx0 = anchor === 'end' ? tx - tw : anchor === 'start' ? tx : tx - tw / 2;
    const ty = TOP + 9 + (activeEvent === undefined ? (k % 2) * 10 : 0);
    return [{ k, ev, xa, xb, tx, anchor, ty, on, named, lx0, lx1: lx0 + tw }];
  });
  const lines = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const st = styleBetween(h, a.year, b.year);
    // Between two reconstructed points: the guessed curve, in the guess colour.
    const curve = CURVE_KINDS.has(a.kind) && CURVE_KINDS.has(b.kind);
    lines.push(
      <line
        key={k}
        x1={X(a.year)}
        y1={Y(a.n)}
        x2={X(b.year)}
        y2={Y(b.n)}
        stroke={curve ? GRADE_COLOR.D : undefined}
        strokeDasharray={curve ? DASH.dashed : DASH[st]}
        opacity={curve ? 0.8 : OPACITY[st]}
        data-style={st}
        data-curve={curve ? '' : undefined}
      />,
    );
  }
  if (after) {
    const p = pts[pts.length - 1];
    lines.push(
      <line key="held" x1={X(p.year)} y1={Y(after.level)} x2={X(h.nowYear)} y2={Y(after.level)} strokeDasharray={NODATA.dash} opacity={NODATA.opacity} data-nodata="after" />,
    );
  }
  if (before) {
    // Held flat from the species' start to the first figure: a faint lead-in at the held level
    // (with a step if the first figure differs), labelled.
    const p = pts[0];
    lines.push(
      <path
        key="nodata"
        d={`M${L} ${Y(before.level)} H${X(p.year)}${Math.abs(Y(before.level) - Y(p.n)) > 0.5 ? ` V${Y(p.n)}` : ''}`}
        strokeDasharray={NODATA.dash}
        opacity={NODATA.opacity}
        data-nodata="before"
      />,
    );
  }
  // The reconstructed curve (genomic steps, the range-loss trend and today's modelled count): each run
  // of consecutive reconstructed points one faint band (their lo–hi) under its dashed line, no dots.
  const runs: HistPoint[][] = [];
  pts.forEach((p, k) => {
    if (!CURVE_KINDS.has(p.kind)) return;
    if (k > 0 && CURVE_KINDS.has(pts[k - 1].kind)) runs[runs.length - 1].push(p);
    else runs.push([p]);
  });
  const bands = runs
    .filter((r) => r.length > 1)
    .map((r) =>
      bandEdge(r, 'hi', X)
        .concat(bandEdge(r, 'lo', X).reverse())
        .map(([x, v]) => `${x.toFixed(1)},${Y(v).toFixed(1)}`)
        .join(' '),
    );
  // Where a band runs past the plot's top or bottom: one small marker per run and edge, at the
  // point that runs furthest past it.
  const bandMarks: { x: number; up: boolean }[] = [];
  for (const r of runs.filter((r) => r.length > 1)) {
    const top = r.reduce((a, p) => (p.hi > a.hi ? p : a));
    const bot = r.reduce((a, p) => (p.lo < a.lo ? p : a));
    if (Y(top.hi) < TOP - 0.5) bandMarks.push({ x: X(top.year), up: true });
    if (Y(bot.lo) > BOT + 0.5) bandMarks.push({ x: X(bot.year), up: false });
  }
  // A lone reconstructed point (no neighbour to draw a curve to): a small hollow ring.
  const lone = runs.filter((r) => r.length === 1).map((r) => r[0]);
  const nTicks = popTicks(ylo, yhi);
  // Time ticks: round years ago on a deep (log) axis, round calendar years otherwise; "now" at the
  // right end if the history runs to it (a tick too close to it gives way).
  const tTicks: { x: number; label: string }[] = deep
    ? agoTicks(x1 - x0).map((v) => ({ x: X(x1 - v), label: formatCount(v, { exact: true, short: true }) }))
    : yearTicks(x0, x1).map((y) => ({ x: X(y), label: fmtYear(y) }));
  const ticks = tTicks.filter((t) => (!toNow || X(x1) - t.x > 30) && t.x - L > 14);
  // The dots' colours, in plain words: only the grades this history uses.
  const cited = pts.filter((p) => !CURVE_KINDS.has(p.kind));
  const grades = ['A', 'B', 'C', 'D'].filter((g) => cited.some((p) => p.grade === g));
  const reconstructed = runs.length > 0 || !!natural;
  const rows = sourceRows(pts, natural);
  const natY = natural ? Y(natural.n) : 0;
  // The "no data" label above its held line, or below it if that is where it clears the plot's top
  // and the natural line (ToLaD#123: on the cougar it touched the natural line).
  let noDataY = 0;
  if (before) {
    const y = Y(before.level);
    const clear = (base: number) => Math.min(base - 7 - TOP, BOT - 1 - base, natural ? Math.max(natY - base, base - 7 - natY) - 1.5 : Infinity);
    const opts = [y - 3.5, y + 10];
    noDataY = opts.find((b) => clear(b) >= 0) ?? opts.reduce((a, b) => (clear(b) > clear(a) ? b : a));
  }
  // The "natural" label: on its line at the right end, above it (or below, near the top), else
  // further left: the first place clear of the curve, the held line and the cited dots and bars.
  let natLabel = { x: W - R - 8, y: natY + (natY < TOP + 10 ? 10 : -3) };
  if (natural) {
    const segs: [number, number, number, number][] = [];
    for (let k = 1; k < pts.length; k++) segs.push([X(pts[k - 1].year), Y(pts[k - 1].n), X(pts[k].year), Y(pts[k].n)]);
    if (after) segs.push([X(pts[pts.length - 1].year), Y(after.level), X(h.nowYear), Y(after.level)]);
    if (before) segs.push([L, Y(before.level), X(x0), Y(before.level)]);
    // The events' names (ToLaD#141).
    for (const e of evBands) if (e.named) segs.push([e.lx0, e.ty - 3, e.lx1, e.ty - 3]);
    // A cited dot (r 3.2) and its bar.
    for (const p of cited) segs.push([X(p.year), Math.max(TOP, Math.min(Y(p.hi), Y(p.n) - 4)), X(p.year), Math.min(BOT, Math.max(Y(p.lo), Y(p.n) + 4))]);
    const free = (x: number, y: number) =>
      y - 8 >= TOP - 1 &&
      y + 1 <= BOT &&
      segs.every(([ax, ay, bx, by]) => {
        for (let i = 0; i <= 24; i++) {
          const px = ax + ((bx - ax) * i) / 24;
          const py = ay + ((by - ay) * i) / 24;
          if (px > x - NAT_W - 3.5 && px < x + 3.5 && py > y - 9 && py < y + 2) return false;
        }
        return true;
      });
    outer: for (let x = W - R - 2; x - NAT_W >= L + 4; x -= 12) {
      for (const y of [natY - 3, natY + 10]) {
        if (free(x, y)) {
          natLabel = { x, y };
          break outer;
        }
      }
    }
  }
  const metaHead = naturalMeta?.label.split(':')[0] || 'natural (pre-human) level';
  const metaRest = naturalMeta?.label.split(':').slice(1).join(':').trim() ?? '';
  return (
    <div className="hist">
      <button
        type="button"
        className="spark"
        aria-expanded={open}
        aria-label={`Population history, ${pts.length} points: ${open ? 'hide' : 'show'} sources`}
        onClick={() => setOpen(!open)}
      >
        <span className="spark-h small">Population over time{deep ? ', years ago' : ''}</span>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden="true" data-axis={deep ? 'log' : 'linear'}>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y={TOP} width={W} height={BOT - TOP} />
            </clipPath>
          </defs>
          {evBands.map((e) => (
            <g key={`ev${e.k}`} data-event={e.k}>
              {e.ev.scope === 'regional' ? (
                // A regional event (ToLaD#149): a subpopulation's, so outlined (dashed) and barely filled, not a species-wide tint.
                <rect x={e.xa} y={TOP} width={e.xb - e.xa} height={BOT - TOP} fill={EVENT_TINT.css} fillOpacity={0.06} stroke={EVENT_TINT.css} strokeWidth="1" strokeDasharray="2 2" strokeOpacity={e.on ? 0.8 : 0.45} data-regional="" />
              ) : (
                <rect x={e.xa} y={TOP} width={e.xb - e.xa} height={BOT - TOP} fill={EVENT_TINT.css} opacity={e.on ? 0.3 : 0.14} />
              )}
              {e.named && (
                <text x={e.tx} y={e.ty} textAnchor={e.anchor} fontSize="9" fill={EVENT_TINT.css} opacity={e.on ? 1 : 0.6}>
                  {e.ev.title}
                </text>
              )}
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {bands.map((b, k) => (
              <polygon key={k} points={b} fill={GRADE_COLOR.D} opacity="0.13" data-band="" />
            ))}
          </g>
          {bandMarks.map((m, k) => (
            <path key={`bm${k}`} d={chevron(m.x, m.up)} stroke={GRADE_COLOR.D} strokeWidth="1.2" fill="none" opacity="0.55" data-clip={m.up ? 'band-top' : 'band-bottom'} />
          ))}
          {natural && (
            <line x1={L} x2={W - R} y1={natY} y2={natY} stroke={GRADE_COLOR.D} strokeWidth="1" strokeDasharray="1.5 3" opacity="0.6" data-natural="" />
          )}
          <g stroke="#c9d4cd" strokeWidth="1.3" fill="none">
            {lines}
          </g>
          {lone.map((p, k) => (
            <circle key={`r${k}`} cx={X(p.year)} cy={Y(p.n)} r="2.6" fill="#141c18" stroke={GRADE_COLOR.D} strokeWidth="1.3" data-modelled="" />
          ))}
          {cited.map((p, k) => (
            // A cited figure: a dot coloured by its grade, its range as a bar.
            <g key={k} data-grade={p.grade}>
              {p.hi > p.lo && <line x1={X(p.year)} x2={X(p.year)} y1={Math.max(TOP, Y(p.hi))} y2={Math.min(BOT, Y(p.lo))} stroke={GRADE_COLOR[p.grade]} strokeWidth="2" opacity="0.45" />}
              {Y(p.hi) < TOP - 0.5 && <path d={chevron(X(p.year), true)} stroke={GRADE_COLOR[p.grade]} strokeWidth="1.2" fill="none" opacity="0.7" data-clip="bar-top" />}
              {Y(p.lo) > BOT + 0.5 && <path d={chevron(X(p.year), false)} stroke={GRADE_COLOR[p.grade]} strokeWidth="1.2" fill="none" opacity="0.7" data-clip="bar-bottom" />}
              <circle cx={X(p.year)} cy={Y(p.n)} r="3.2" fill={GRADE_COLOR[p.grade]} stroke="#141c18" strokeWidth="1" />
            </g>
          ))}
          <g stroke="#56625a" strokeWidth="1">
            <line x1={L} x2={W - R} y1={H - B + 0.5} y2={H - B + 0.5} />
            {ticks.map((t) => (
              <line key={t.label} x1={t.x} x2={t.x} y1={H - B} y2={H - B + 4} data-tick="x" />
            ))}
            {toNow && <line x1={X(x1)} x2={X(x1)} y1={H - B} y2={H - B + 4} />}
            {nTicks.map((n) => (
              <line key={n} x1={L - 3} x2={W - R} y1={Y(n)} y2={Y(n)} strokeOpacity="0.35" strokeDasharray="2 3" data-tick="y" />
            ))}
          </g>
          <g fill="#9faba3" fontSize="11">
            {nTicks.map((n) => (
              <text key={n} x={L - 5} y={Y(n) + 3.5} textAnchor="end">
                {formatCount(n, { exact: true, short: true })}
              </text>
            ))}
            {ticks.map((t) => (
              <text key={t.label} x={t.x} y={H - 2} textAnchor="middle">
                {t.label}
              </text>
            ))}
            {toNow && (
              <text x={X(x1)} y={H - 2} textAnchor="middle">
                now
              </text>
            )}
          </g>
          {natural && (
            <text x={natLabel.x} y={natLabel.y} textAnchor="end" fontSize="9" fill={GRADE_COLOR.D} opacity="0.85" data-natural-label="">
              natural
            </text>
          )}
          {before && (
            <text
              x={(L + X(x0)) / 2}
              y={noDataY}
              textAnchor="middle"
              fontSize="9"
              fill="#9faba3"
              opacity="0.8"
              data-nodata-label=""
            >
              no data
            </text>
          )}
        </svg>
        <span className="spark-foot small">
          <span className="gkey" aria-label="dot colours: how each number was got">
            {grades.map((g) => (
              <span key={g} data-key={g}>
                <span className="gdot" style={{ background: GRADE_COLOR[g] }} /> {GRADE_WORD[g]}
              </span>
            ))}
            {reconstructed && (
              <span data-key="reconstructed">
                <span className="gdash" style={{ borderColor: GRADE_COLOR.D }} /> reconstructed guess
              </span>
            )}
          </span>
          <span className="dim">{open ? 'hide sources ▴' : `${rows.length} source${rows.length === 1 ? '' : 's'} ▾`}</span>
        </span>
      </button>
      {open && h.use !== 'counts' && <div className="dim small">These numbers are shown for reference; the tree's widths use the model.</div>}
      {open && h.modelled === 'rangeloss' && (
        <div className="dim small" data-modelled-note="">
          Modelled, not counted: the natural level held to 1500 CE, then a steady change to today's count.
        </div>
      )}
      {open && before && (
        <div className="dim small" data-nodata-note="">
          No data before {fmtWhen(before.year, h.nowYear)}: held at {before.today ? "today's level" : deep ? 'the oldest figure’s level' : `the ${fmtYear(before.year)} level`}.
        </div>
      )}
      {open && (
        <ol className="hist-list">
          {rows.map((r, k) => {
            if (r.kind === 'point') {
              const p = r.p;
              return (
                <li key={k}>
                  <div>
                    <b>{fmtWhen(p.year, h.nowYear)}</b> · {fmtN(p.n, p.kind)}
                    {p.hi > p.lo && (
                      <span className="dim">
                        {' '}
                        ({fmtN(p.lo, p.kind)} – {fmtN(p.hi, p.kind)})
                      </span>
                    )}{' '}
                    · <span className="gdot" style={{ background: GRADE_COLOR[p.grade] }} /> grade {p.grade} · {MODELLED_KINDS.has(p.kind) ? `${p.kind}, modelled` : p.kind}
                    {p.baseline && ' · baseline'}
                  </div>
                  <Cite cite={p.cite} url={p.url} />
                  {p.note && <div className="dim">{approxCountsIn(p.note)}</div>}
                </li>
              );
            }
            if (r.kind === 'genomic') {
              const g = r.pts;
              const a = g[0];
              const b = g[g.length - 1];
              const nLo = Math.min(...g.map((p) => p.n));
              const nHi = Math.max(...g.map((p) => p.n));
              const ratio = neRatio(g);
              return (
                <li key={k} data-row="genomic">
                  <div>
                    <b>
                      {fmtWhen(a.year, h.nowYear)} – {fmtWhen(b.year, h.nowYear)}
                    </b>{' '}
                    · {formatCount(nLo)} – {formatCount(nHi)}
                    <span className="dim">
                      {' '}
                      (band {formatCount(Math.min(...g.map((p) => p.lo)))} – {formatCount(Math.max(...g.map((p) => p.hi)))})
                    </span>{' '}
                    · <span className="gdot" style={{ background: GRADE_COLOR[a.grade] }} /> grade {a.grade} · genomic curve, modelled
                  </div>
                  <Cite cite={a.cite} url={a.url} extra={ratio ? `Ne/N ${ratio}` : ''} />
                  <div className="dim">
                    {g.length} steps of a PSMC curve of effective population (Ne){ratio ? `, divided by ${ratio} for the individuals alive` : ''}.
                  </div>
                  {h.deepJoin && (
                    <div className="dim" data-deep-join="">
                      {approxCountsIn(h.deepJoin)}
                    </div>
                  )}
                </li>
              );
            }
            const nat = natural!;
            const st = r.start;
            return (
              <li key={k} data-row="natural">
                <div>
                  <b>{cap(metaHead)}</b> · {formatCount(nat.n)}
                  <span className="dim">
                    {' '}
                    ({formatCount(nat.lo)} – {formatCount(nat.hi)})
                  </span>{' '}
                  · <span className="gdot" style={{ background: GRADE_COLOR[naturalMeta?.grade ?? 'D'] }} /> grade {naturalMeta?.grade ?? 'D'} · modelled
                  {st && <> · held to {fmtWhen(st.year, h.nowYear)}, where the {st.kind} trend starts</>}
                </div>
                <Cite cite={naturalMeta?.cite ?? ''} url={naturalMeta?.url ?? ''} />
                {st && <Cite cite={st.cite} url={st.url} />}
                <div className="dim">
                  {metaRest ? `${cap(metaRest)}: ` : ''}its natural range {formatCount(nat.km2Natural)} km²
                  {nat.km2Current > 0 ? `, ${formatCount(nat.km2Current)} km² today (${Math.round((100 * nat.km2Current) / nat.km2Natural)}%)` : ''}.
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Cite({ cite, url, extra = '' }: { cite: string; url: string; extra?: string }) {
  return (
    <div className="cite">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {cite}
        </a>
      ) : (
        cite
      )}
      {extra && <span className="dim"> · {extra}</span>}
    </div>
  );
}
