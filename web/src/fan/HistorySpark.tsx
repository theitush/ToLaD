// The species card's population history: a tiny log(population)-vs-year chart
// (points coloured by grade, their ranges as bars, the spans between them drawn
// solid, dashed or dotted as on the fan's edge) and, on tap, every point with
// its source.

import { useState } from 'react';
import { GRADE_COLOR, styleBetween, type SpanStyle } from './history';
import type { HistoryRec } from './panthera';

const W = 340;
const H = 64;
const L = 40; // left margin (n labels)
const R = 8;
const T = 6;
const B = 14; // bottom margin (year labels)

const DASH: Record<SpanStyle, string | undefined> = { solid: undefined, dashed: '4 3', dotted: '1.2 3' };
const OPACITY: Record<SpanStyle, number> = { solid: 0.9, dashed: 0.75, dotted: 0.5 };

/** A dequantized count to 3 significant figures (the data's own precision). */
export function fmtN(n: number): string {
  return Number(n.toPrecision(3)).toLocaleString('en-US');
}

function fmtShort(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toPrecision(2))}M`;
  if (n >= 1e3) return `${Number((n / 1e3).toPrecision(2))}k`;
  return String(Math.round(n));
}

export function fmtYear(y: number): string {
  return y < 0 ? `${Math.round(-y)} BCE` : String(Math.round(y));
}

export function HistorySpark({ h, open: open0 = false }: { h: HistoryRec; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  const pts = h.points.slice().sort((a, b) => a.year - b.year);
  if (pts.length === 0) return null;
  const last = h.segments[h.segments.length - 1];
  const held = last && last.kind === 'held' && pts[pts.length - 1].year < h.nowYear;
  const x0 = pts[0].year;
  const x1 = Math.max(pts[pts.length - 1].year, held ? h.nowYear : -Infinity);
  const lo = Math.log10(Math.max(1, Math.min(...pts.map((p) => Math.min(p.lo, p.n)))));
  const hi = Math.log10(Math.max(...pts.map((p) => Math.max(p.hi, p.n))));
  const pad = Math.max(0.08, (hi - lo) * 0.08);
  const ylo = lo - pad;
  const yhi = hi + pad;
  const X = (y: number) => L + ((W - L - R) * (y - x0)) / (x1 - x0 || 1);
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
  if (held) {
    const p = pts[pts.length - 1];
    lines.push(<line key="held" x1={X(p.year)} y1={Y(p.n)} x2={X(h.nowYear)} y2={Y(p.n)} opacity={OPACITY.solid} data-style="solid" />);
  }
  const nTicks = [Math.pow(10, hi), Math.pow(10, lo)];
  return (
    <div className="hist">
      <button
        type="button"
        className="spark"
        aria-expanded={open}
        aria-label={`Population history, ${pts.length} points: ${open ? 'hide' : 'show'} sources`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden="true">
          <g stroke="#c9d4cd" strokeWidth="1.3" fill="none">
            {lines}
          </g>
          {pts.map((p, k) => (
            <g key={k} data-grade={p.grade}>
              {p.hi > p.lo && (
                <line x1={X(p.year)} x2={X(p.year)} y1={Y(p.hi)} y2={Y(p.lo)} stroke={GRADE_COLOR[p.grade]} strokeWidth="2" opacity="0.45" />
              )}
              <circle cx={X(p.year)} cy={Y(p.n)} r="3.2" fill={GRADE_COLOR[p.grade]} stroke="#141c18" strokeWidth="1" />
            </g>
          ))}
          <g fill="#9faba3" fontSize="10">
            {nTicks.map((n, k) => (
              <text key={k} x={L - 5} y={k ? H - B : T + 7} textAnchor="end">
                {fmtShort(n)}
              </text>
            ))}
            <text x={L} y={H - 2}>
              {fmtYear(x0)}
            </text>
            <text x={W - R} y={H - 2} textAnchor="end">
              {held ? 'now' : fmtYear(x1)}
            </text>
          </g>
        </svg>
        <span className="dim small">
          population (log) · {pts.length} points{h.use !== 'counts' && ' · not used for widths'} · {open ? 'hide sources ▴' : 'sources ▾'}
        </span>
      </button>
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
