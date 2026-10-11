// The species card's population history: a tiny log(population)-vs-year chart
// (points coloured by grade, their ranges as bars, the spans between them drawn
// solid, dashed or dotted as on the fan's edge) and, on tap, every point with
// its source. Stretches held flat for want of figures (before the first point,
// after the last) are drawn faint and labelled "no data".

import { useState } from 'react';
import { GRADE_COLOR, GRADE_WORD, MODELLED_KINDS, noDataSpans, styleBetween, type SpanStyle } from './history';
import type { HistoryRec } from './panthera';

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

/** A dequantized count to 3 significant figures (the data's own precision). */
export function fmtN(n: number): string {
  return Number(n.toPrecision(3)).toLocaleString('en-US');
}

function fmtShort(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toPrecision(2))}M`;
  if (n >= 1e3) return `${Number((n / 1e3).toPrecision(2))}k`;
  return String(Math.round(n));
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

export function HistorySpark({ h, open: open0 = false }: { h: HistoryRec; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  const pts = h.points.slice().sort((a, b) => a.year - b.year);
  if (pts.length === 0) return null;
  const nd = noDataSpans(h);
  const before = nd.find((s) => s.side === 'before');
  const after = nd.find((s) => s.side === 'after');
  const held = !!after;
  const x0 = pts[0].year;
  const x1 = Math.max(pts[pts.length - 1].year, held ? h.nowYear : -Infinity);
  const ns = pts.flatMap((p) => [p.lo, p.n, p.hi]).concat(before ? [before.level] : []);
  const lo = Math.log10(Math.max(1, Math.min(...ns)));
  const hi = Math.log10(Math.max(...ns));
  const pad = Math.max(0.08, (hi - lo) * 0.08);
  const ylo = lo - pad;
  const yhi = hi + pad;
  const left = L + (before ? STUB : 0);
  const X = (y: number) => left + ((W - left - R) * (y - x0)) / (x1 - x0 || 1);
  const Y = (n: number) => T + ((H - T - B) * (yhi - Math.log10(Math.max(1, n)))) / (yhi - ylo);
  const lines = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const st = styleBetween(h, a.year, b.year);
    lines.push(
      <line key={k} x1={X(a.year)} y1={Y(a.n)} x2={X(b.year)} y2={Y(b.n)} strokeDasharray={DASH[st]} opacity={OPACITY[st]} data-style={st} />,
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
  const nTicks = popTicks(ylo, yhi);
  // Year ticks; "now" at the right end if the history runs to it (a tick too close to it gives way).
  const yTicks = yearTicks(x0, x1).filter((y) => !held || X(x1) - X(y) > 30);
  // The dots' colours, in plain words: only the grades this history uses.
  const grades = ['A', 'B', 'C', 'D'].filter((g) => pts.some((p) => p.grade === g));
  return (
    <div className="hist">
      <button
        type="button"
        className="spark"
        aria-expanded={open}
        aria-label={`Population history, ${pts.length} points: ${open ? 'hide' : 'show'} sources`}
        onClick={() => setOpen(!open)}
      >
        <span className="spark-h small">Population over time</span>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden="true">
          <g stroke="#c9d4cd" strokeWidth="1.3" fill="none">
            {lines}
          </g>
          {pts.map((p, k) => {
            // A modelled point (the range-loss trend's start) is the model's, not a cited figure: a hollow ring.
            const mod = MODELLED_KINDS.has(p.kind);
            return (
              <g key={k} data-grade={p.grade} data-modelled={mod ? '' : undefined}>
                {p.hi > p.lo && (
                  <line x1={X(p.year)} x2={X(p.year)} y1={Y(p.hi)} y2={Y(p.lo)} stroke={GRADE_COLOR[p.grade]} strokeWidth="2" opacity={mod ? 0.25 : 0.45} strokeDasharray={mod ? DASH.dashed : undefined} />
                )}
                {mod ? (
                  <circle cx={X(p.year)} cy={Y(p.n)} r="2.8" fill="#141c18" stroke={GRADE_COLOR[p.grade]} strokeWidth="1.4" />
                ) : (
                  <circle cx={X(p.year)} cy={Y(p.n)} r="3.2" fill={GRADE_COLOR[p.grade]} stroke="#141c18" strokeWidth="1" />
                )}
              </g>
            );
          })}
          <g stroke="#56625a" strokeWidth="1">
            <line x1={L} x2={W - R} y1={H - B + 0.5} y2={H - B + 0.5} />
            {yTicks.map((y) => (
              <line key={y} x1={X(y)} x2={X(y)} y1={H - B} y2={H - B + 4} data-tick="x" />
            ))}
            {held && <line x1={X(x1)} x2={X(x1)} y1={H - B} y2={H - B + 4} />}
            {nTicks.map((n) => (
              <line key={n} x1={L - 3} x2={W - R} y1={Y(n)} y2={Y(n)} strokeOpacity="0.35" strokeDasharray="2 3" data-tick="y" />
            ))}
          </g>
          <g fill="#9faba3" fontSize="11">
            {nTicks.map((n) => (
              <text key={n} x={L - 5} y={Y(n) + 3.5} textAnchor="end">
                {fmtShort(n)}
              </text>
            ))}
            {yTicks.map((y) => (
              <text key={y} x={X(y)} y={H - 2} textAnchor="middle">
                {fmtYear(y)}
              </text>
            ))}
            {held && (
              <text x={X(x1)} y={H - 2} textAnchor="middle">
                now
              </text>
            )}
          </g>
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
          </span>
          <span className="dim">{open ? 'hide sources ▴' : `${pts.length} sources ▾`}</span>
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
          No data before {fmtYear(before.year)}: held at {before.today ? "today's level" : `the ${fmtYear(before.year)} level`}.
        </div>
      )}
      {open && (
        <ol className="hist-list">
          {pts.map((p, k) => (
            <li key={k}>
              <div>
                <b>{fmtYear(p.year)}</b> · {fmtN(p.n)}
                {p.hi > p.lo && (
                  <span className="dim">
                    {' '}
                    ({fmtN(p.lo)} – {fmtN(p.hi)})
                  </span>
                )}{' '}
                · <span className="gdot" style={{ background: GRADE_COLOR[p.grade] }} /> grade {p.grade} · {p.kind}
                {p.baseline && ' · baseline'}
              </div>
              <div className="cite">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.cite}
                  </a>
                ) : (
                  p.cite
                )}
              </div>
              {p.note && <div className="dim">{p.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
