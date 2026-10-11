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

import { useState } from 'react';
import { approxCountsIn, formatCount } from '../data/count';
import { GRADE_COLOR, GRADE_WORD, MODELLED_KINDS, noDataSpans, styleBetween, type SpanStyle } from './history';
import type { HistoryRec, HistPoint, NaturalMeta, NaturalRec } from './panthera';
import { TIME_C } from './population';

const W = 340;
const H = 76;
const L = 34; // left margin (population ticks)
const R = 14;
const T = 6;
const B = 16; // bottom margin (year ticks)

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
  if (out.length) return out;
  // Less than a decade: 1/2/5 round numbers inside (the outermost two), else a 2-figure one.
  const c: number[] = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (Math.log10(v) >= lo && Math.log10(v) <= hi) c.push(v);
    }
  }
  if (c.length) return c.length > 1 ? [c[0], c[c.length - 1]] : c;
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

/** A row of the sources list: a cited point, the genomic curve as one row, or the natural (pre-human) level. */
type Row = { kind: 'point'; p: HistPoint } | { kind: 'genomic'; pts: HistPoint[] } | { kind: 'natural' };

/** Points in time order, a run of genomic steps collapsed into one row; the natural level last. */
export function sourceRows(pts: HistPoint[], natural: boolean): Row[] {
  const rows: Row[] = [];
  for (const p of pts) {
    const last = rows[rows.length - 1];
    if (p.kind === 'genomic' && last?.kind === 'genomic') last.pts.push(p);
    else rows.push(p.kind === 'genomic' ? { kind: 'genomic', pts: [p] } : { kind: 'point', p });
  }
  if (natural) rows.push({ kind: 'natural' });
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

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function HistorySpark({
  h,
  open: open0 = false,
  natural = null,
  naturalMeta = null,
}: {
  h: HistoryRec;
  open?: boolean;
  /** The species' natural (pre-human) baseline, drawn as a faint level and listed with the sources. */
  natural?: NaturalRec | null;
  naturalMeta?: NaturalMeta | null;
}) {
  const [open, setOpen] = useState(open0);
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
  const ns = pts
    .flatMap((p) => [p.lo, p.n, p.hi])
    .concat(before ? [before.level] : [])
    .concat(natural ? [natural.n] : []);
  const lo = Math.log10(Math.max(1, Math.min(...ns)));
  const hi = Math.log10(Math.max(...ns));
  const pad = Math.max(0.08, (hi - lo) * 0.08);
  const ylo = lo - pad;
  const yhi = hi + pad;
  const left = L + (before ? STUB : 0);
  const sAgo = (year: number) => Math.log10(Math.max(0, x1 - year) + TIME_C);
  const X = deep
    ? (y: number) => left + ((W - left - R) * (sAgo(x0) - sAgo(y))) / (sAgo(x0) - sAgo(x1) || 1)
    : (y: number) => left + ((W - left - R) * (y - x0)) / (x1 - x0 || 1);
  const Y = (n: number) => T + ((H - T - B) * (yhi - Math.log10(Math.max(1, n)))) / (yhi - ylo);
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
      r
        .map((p) => `${X(p.year).toFixed(1)},${Y(p.hi).toFixed(1)}`)
        .concat(r.slice().reverse().map((p) => `${X(p.year).toFixed(1)},${Y(p.lo).toFixed(1)}`))
        .join(' '),
    );
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
  const rows = sourceRows(pts, !!natural);
  const natY = natural ? Y(natural.n) : 0;
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
          {bands.map((b, k) => (
            <polygon key={k} points={b} fill={GRADE_COLOR.D} opacity="0.13" data-band="" />
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
              {p.hi > p.lo && <line x1={X(p.year)} x2={X(p.year)} y1={Y(p.hi)} y2={Y(p.lo)} stroke={GRADE_COLOR[p.grade]} strokeWidth="2" opacity="0.45" />}
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
            <text x={W - R - 8} y={natY + (natY < T + 12 ? 10 : -3)} textAnchor="end" fontSize="9" fill={GRADE_COLOR.D} opacity="0.85" data-natural-label="">
              natural
            </text>
          )}
          {before && (
            <text
              x={(L + X(x0)) / 2}
              y={Y(before.level) + (Y(before.level) < T + 12 ? 10 : -4)}
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
            return (
              <li key={k} data-row="natural">
                <div>
                  <b>{cap(metaHead)}</b> · {formatCount(nat.n)}
                  <span className="dim">
                    {' '}
                    ({formatCount(nat.lo)} – {formatCount(nat.hi)})
                  </span>{' '}
                  · <span className="gdot" style={{ background: GRADE_COLOR[naturalMeta?.grade ?? 'D'] }} /> grade {naturalMeta?.grade ?? 'D'} · modelled
                </div>
                <Cite cite={naturalMeta?.cite ?? ''} url={naturalMeta?.url ?? ''} />
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
