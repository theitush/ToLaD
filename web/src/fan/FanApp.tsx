// The main view: the dated Panthera tree, OneZoom-style. The time river is
// still available at ?river (and the synthetic spike tree at ?synthetic).

import * as MeshMirror from './mesh';
import { useEffect, useRef, useState } from 'react';
import { formatCount } from '../data/count';
import { HistorySpark } from './HistorySpark';
import type { EdgeStyle, WidthMode } from './layout';
import { FELIDAE, NATURAL_META, type SpeciesRec } from './panthera';
import { population } from './population';
import { statusOf } from './status';
import { FanView, fmtInt, formatYearsAgo, type IndInfo, type Lineage, type Selection } from './view';

declare global {
  interface Window {
    __fan?: FanView;
    /** The mesh's CPU mirror, for scripts/glcheck.mjs (GPU and CPU decisions compared). */
    __fanMesh?: typeof MeshMirror;
  }
}

/** The edges' design this viewer chose last (remembered on this device); ?edge=curved|straight overrides it. */
const EDGE_KEY = 'tolad.fan.edge';
function initialEdge(): EdgeStyle {
  const isEdge = (v: unknown): v is EdgeStyle => v === 'curved' || v === 'straight';
  try {
    const q = new URLSearchParams(window.location.search).get('edge');
    if (isEdge(q)) return q;
  } catch {
    /* no URL */
  }
  try {
    const v = window.localStorage.getItem(EDGE_KEY);
    if (isEdge(v)) return v;
  } catch {
    /* no storage */
  }
  return 'curved';
}

export function FanApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FanView | null>(null);
  const [mode, setMode] = useState<WidthMode>('linear');
  const [edge, setEdge] = useState<EdgeStyle>(initialEdge);
  const [sel, setSel] = useState<Selection | null>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = new FanView(canvasRef.current!, FELIDAE, edge);
    v.onSelect = setSel;
    v.scaleEl = scaleRef.current;
    v.barEl = barRef.current;
    viewRef.current = v;
    window.__fan = v;
    window.__fanMesh = MeshMirror;
    v.request();
    // The canvas text waits for the faces (drawn in system type until then).
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.all([document.fonts.load("600 16px 'Sofia Sans Condensed'"), document.fonts.load("italic 400 14px 'Newsreader'")])
        .catch(() => undefined)
        .then(() => v.request());
    }
    return () => {
      v.destroy();
      viewRef.current = null;
      if (window.__fan === v) delete window.__fan;
    };
  }, []);

  return (
    <div className="app fan">
      <canvas ref={canvasRef} className="stage" />
      <div className="bar" ref={barRef}>
        <button
          type="button"
          aria-pressed={mode === 'linear'}
          onClick={() => {
            const next = mode === 'log' ? 'linear' : 'log';
            setMode(next);
            viewRef.current?.setMode(next);
          }}
        >
          {mode === 'log' ? 'log widths' : 'linear widths'}
        </button>
        <button
          type="button"
          aria-label="branch shape"
          onClick={() => {
            const next = edge === 'curved' ? 'straight' : 'curved';
            setEdge(next);
            viewRef.current?.setEdge(next);
            try {
              window.localStorage.setItem(EDGE_KEY, next);
            } catch {
              /* not remembered */
            }
          }}
        >
          {edge}
        </button>
        <button type="button" onClick={() => viewRef.current?.resetView()}>
          All cats
        </button>
      </div>
      <div className="foot">
        <div className="wscale" ref={scaleRef} aria-label="width scale">
          <span className="wbar" />
          <span className="wlab" />
        </div>
      {sel ? (
        sel.lineage ? (
          <LineageCard lin={sel.lineage} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        ) : sel.ind ? (
          <IndCard sp={sel.sp} ind={sel.ind} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        ) : (
          <SpeciesCard sp={sel.sp} ageMa={sel.ageMa} startMa={sel.startMa} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        )
      ) : (
        <ul className="key" aria-label="key">
          <li>
            <span className="lane alive" /> alive now
          </li>
          <li>
            <span className="lane lineage" /> living descendants
          </li>
          <li>
            <span className="lane dead" /> line ended
          </li>
        </ul>
      )}
      </div>
    </div>
  );
}

/** A span of years as a duration: "~3.8 Myr", "~117 kyr", "~250 yr". */
export function formatSpan(years: number): string {
  if (years >= 1e6) return `~${(years / 1e6).toPrecision(2)} Myr`;
  if (years >= 1e3) return `~${Math.round(years / 1e3)} kyr`;
  return `~${Math.round(years)} yr`;
}

const WORDS: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
];

/** A number in words to `sig` significant figures (years ago; population counts go through formatCount): "352,000", "1.4 million". */
export function plainCount(n: number, sig = 3): string {
  if (!(n > 0)) return '0';
  const r = Number(n.toPrecision(sig));
  for (const [v, w] of WORDS) if (r >= v) return `${Number((r / v).toPrecision(sig))} ${w}`;
  return r.toLocaleString('en-US');
}

/** Years before present in words: "70 years ago", "11,700 years ago", "3.8 million years ago". */
export function plainAgo(years: number): string {
  if (years < 0.5) return 'today';
  if (years < 1e4) return `${Math.round(years).toLocaleString('en-US')} years ago`;
  return `${plainCount(years, years < 1e6 ? 3 : 2)} years ago`;
}

/** Names starting with a proper noun or adjective: they keep their capital mid-sentence. */
const PROPER = /^(Yucatán|Longdan|European|Eurasian|African|American|Andean|Asian|Canada|Geoffroy|Iberian|Pallas|Sunda)\b/;

/** "lion", "Eurasian lynx", "Yucatán cave cat": the common name, mid-sentence (a Latin name as it is). */
export function midName(sp: SpeciesRec): string {
  const c = sp.common;
  return c === sp.sci || PROPER.test(c) ? c : c[0].toLowerCase() + c.slice(1);
}

/** "lions", "Eurasian lynxes", "Yucatán cave cats": the common name, plural, mid-sentence (ToLaD#107). */
export function pluralName(sp: SpeciesRec): string {
  if (sp.common === sp.sci) return `${sp.sci} individuals`;
  const c = midName(sp);
  return /(s|x|z|ch|sh)$/.test(c) ? `${c}es` : `${c}s`;
}

/** How far off a data grade can be (research/02-population-estimates.md). */
const GRADE_MEANS: Record<string, string> = {
  A: 'a census with stated error, within about 2–3×',
  B: 'a careful estimate, within about 10×',
  C: 'a rough figure, within about 100×',
  D: 'an illustrative model, could be off 1,000× or more',
};

/**
 * The population at a time (Ma) as the card words it: how many were alive, and
 * the share with living descendants today. The species' column as the fan
 * draws it, from its start (its split in the dated tree; by default its first
 * appearance) up to its tip.
 */
export function populationAt(sp: SpeciesRec, ageMa: number, startMa = sp.t0): { when: string; alive: number; green: number; now: boolean; end: boolean } {
  const p = population(sp, startMa);
  const a = Math.min(Math.max(ageMa, sp.t1), startMa);
  const yrs = a * 1e6;
  const now = yrs < 0.5;
  const end = sp.extinct && Math.abs(a - sp.t1) < 1e-9;
  const when = now ? 'today' : end ? `at the end, ${plainAgo(yrs)}` : plainAgo(yrs);
  const st = p.stepAt(a);
  return { when, alive: st.n, green: st.q, now, end };
}

export function StatusChip({ sp }: { sp: SpeciesRec }) {
  const s = statusOf(sp);
  if (!s) return null;
  if (s.kind === 'prehistoric') return <span className="status prehistoric">{s.label}</span>;
  if (s.kind === 'domestic') return <span className="status domestic">{s.label}</span>;
  return (
    <span className={`status iucn-${s.code.toLowerCase()}`} title={`IUCN Red List: ${s.label} (${s.status.year} assessment)`}>
      {s.label}
    </span>
  );
}

export function SpeciesCard({ sp, onClose, open, ageMa, startMa }: { sp: SpeciesRec; onClose: () => void; open?: boolean; ageMa?: number; startMa?: number }) {
  const at = populationAt(sp, ageMa ?? sp.t1, startMa);
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const st = statusOf(sp);
  // A domestic stock: the years its own births span (its curated segments, from domestication).
  const domestic = sp.history?.component === 'domestic' && sp.births ? sp.history.segments.reduce((a, s) => a + s.generations, 0) * sp.history.G : 0;
  const lived = `from ${plainAgo(sp.t0 * 1e6)} to ${sp.extinct ? plainAgo(sp.t1 * 1e6) : 'today'}`;
  const spark = !!sp.history && sp.history.points.length > 0;
  // The natural (pre-human) level: on the sparkline and its sources when there is one, else here.
  const nat = !spark && sp.natural ? sp.natural : null;
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        <span>{sp.common}</span> <i>({sp.sci})</i>
      </div>
      <div className="facts">
        <StatusChip sp={sp} />
        <p className="lead">
          <span className={`lane ${sp.extinct ? 'dead' : at.now ? 'alive' : 'lineage'}`} />
          <span>
            <b>{formatCount(at.alive)}</b> alive {at.when}
          </span>
        </p>
        {!sp.extinct && !at.now && <p className="sub">{pct(at.green)} have descendants alive today</p>}
        {sp.extinct && !at.end && <p className="sub">Died out {plainAgo(sp.t1 * 1e6)}</p>}
        {!sp.extinct && !at.now && (
          <p className="lead">
            <span className="lane alive" />
            <span>
              <b>{formatCount(sp.alive)}</b> alive today
            </span>
          </p>
        )}
        <p className="ever">
          {domestic ? (
            <>
              Roughly {formatCount(sp.ever, { tilde: false })} {pluralName(sp)} born since domestication <span className="dim">(rough estimate)</span>
            </>
          ) : (
            <>
              Roughly {formatCount(sp.ever, { tilde: false })} {pluralName(sp)} have ever lived <span className="dim">(rough estimate)</span>
            </>
          )}
        </p>
      </div>
      {spark && <HistorySpark key={sp.gid} h={sp.history!} open={open} natural={sp.natural} naturalMeta={NATURAL_META} />}
      <details className="more" key={`more-${sp.gid}`}>
        <summary>Details</summary>
        <dl>
          <dt>Lived</dt>
          <dd>{lived}</dd>
          <dt>Generation</dt>
          <dd>
            about {Number(sp.genYears.toPrecision(2))} years <span className="dim">({sp.genSource})</span>
          </dd>
          <dt>Ever lived</dt>
          <dd>
            {domestic
              ? `${formatCount(sp.ever)} since domestication, ${plainAgo(domestic).replace(/ ago$/, '')} (the model's births; its wild ancestors are the wildcat's)`
              : `${formatCount(sp.ever)}, range ${formatCount(sp.everLo, { tilde: false })} – ${formatCount(sp.everHi, { tilde: false })} over ${plainAgo((sp.t0 - sp.t1) * 1e6).replace(/ ago$/, '')}`}
          </dd>
          <dt>Data grade</dt>
          <dd>
            {sp.grade}: {GRADE_MEANS[sp.grade] ?? 'unknown'}
          </dd>
          <dt>Method</dt>
          <dd>
            Modelled, not counted: births per generation × lifespan ÷ generation length gives those alive at a time
            {sp.births ? ', following the population history (the chart and its sources), its earliest level held back to the species’ start' : ', held constant over the species’ span'}.
            The share with descendants alive today comes from a randomly mixing family tree, counted back one generation at a time.
          </dd>
          {nat && (
            <>
              <dt>Natural level</dt>
              <dd data-natural="">
                {formatCount(nat.n)} without people <span className="dim">({formatCount(nat.lo)} – {formatCount(nat.hi)})</span>: {NATURAL_META?.label ?? 'modelled'}, grade{' '}
                {NATURAL_META?.grade ?? 'D'}; its natural range {formatCount(nat.km2Natural)} km²
                {nat.km2Current > 0 ? `, ${formatCount(nat.km2Current)} km² today` : ''} ·{' '}
                {NATURAL_META?.url ? (
                  <a href={NATURAL_META.url} target="_blank" rel="noopener noreferrer">
                    {NATURAL_META.cite}
                  </a>
                ) : (
                  NATURAL_META?.cite
                )}
              </dd>
            </>
          )}
          <dt>Status</dt>
          <dd>
            {st?.kind === 'iucn' && st.code === 'NE' ? (
              <>IUCN Red List: Not Evaluated (NE), on no Red List assessment{st.status.cite ? ` · ${st.status.cite}` : ''}</>
            ) : st?.kind === 'iucn' ? (
              <>
                IUCN Red List: {st.label} ({st.code}), {st.status.year} assessment ·{' '}
                {st.status.url ? (
                  <a href={st.status.url} target="_blank" rel="noopener noreferrer">
                    {st.status.cite}
                  </a>
                ) : (
                  st.status.cite
                )}
              </>
            ) : st?.kind === 'domestic' ? (
              'Domesticated: the IUCN Red List does not assess domestic forms (Not Evaluated); its wild ancestor is the wildcat.'
            ) : st?.kind === 'prehistoric' ? (
              'Known from fossils; died out before the Red List’s scope (extinctions since 1500 CE), so no IUCN category.'
            ) : (
              'No Red List category on file.'
            )}
          </dd>
        </dl>
      </details>
    </div>
  );
}

/** A parent column touched: the daughters' shared ancestors at that time, and their split. */
export function LineageCard({ lin, onClose }: { lin: Lineage; onClose: () => void }) {
  const s = lin.node.split;
  const of = lin.of.length > 1 ? `${lin.of.slice(0, -1).join(', ')} and ${lin.of[lin.of.length - 1]}` : lin.of[0];
  const range = s.lo === s.hi ? 'no range found' : `range ${s.lo}–${s.hi} million`;
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        <span>{lin.name}</span>
      </div>
      <div className="facts">
        <p className="lead">
          <span className="lane lineage" />
          <span>
            <b>{formatCount(lin.alive)}</b> alive {plainAgo(lin.ageMa * 1e6)} <span className="dim">(model)</span>
          </span>
        </p>
        <p className="sub">{Math.round(lin.green * 100)}% have descendants alive today</p>
        <p className="sub">Ancestors of {of}</p>
        <p className="sub">
          Split ~{s.ageMa} million years ago <span className="dim">({range}; {s.confidence} confidence)</span>
        </p>
      </div>
      <details className="more">
        <summary>Details</summary>
        <dl>
          <dt>Split date</dt>
          <dd>{s.cite}</dd>
          {s.note && (
            <>
              <dt>Note</dt>
              <dd>{s.note}</dd>
            </>
          )}
          <dt>Method</dt>
          <dd>
            Modelled, not counted: the daughters’ populations at the split, added up. The share with descendants alive today comes from a randomly mixing
            family tree, counted back one generation at a time from the daughters’ shares at the split.
          </dd>
        </dl>
      </details>
    </div>
  );
}

function IndCard({ sp, ind, onClose }: { sp: SpeciesRec; ind: IndInfo; onClose: () => void }) {
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        <span className={`dot ${ind.alive ? 'alive' : 'dead'}`} /> <span className="mono">{ind.handle}</span>
      </div>
      <div>
        {ind.sex} {midName(sp)} · {ind.alive ? 'alive now' : 'dead'} · born ~{formatYearsAgo(ind.bornYearsAgo)}
      </div>
      <div className="dim">
        lived {ind.lifespan.toFixed(1)} y · generation {fmtInt(ind.g + 1)} of {fmtInt(ind.G)} · {ind.children} children
      </div>
      <div className="dim">
        parents:{' '}
        {ind.parents.length === 0
          ? 'none (founding generation)'
          : ind.parents.map((p, k) => (
              <span key={k} className="mono">
                {k ? ' + ' : ''}
                {p.handle}
              </span>
            ))}
      </div>
    </div>
  );
}
