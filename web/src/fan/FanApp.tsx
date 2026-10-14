// The main view: the dated Panthera tree, OneZoom-style. The time river is
// still available at ?river (and the synthetic spike tree at ?synthetic).

import * as MeshMirror from './mesh';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { approxMa, formatCount } from '../data/count';
import { HistorySpark } from './HistorySpark';
import type { EdgeStyle, WidthMode } from './layout';
import { wikiOf, type WikiRec } from './wiki';
import { RangeGlobe } from './Globe';
import { CARNIVORA, FELIDAE, mammaliaClade, NATURAL_META, type HistEvent, type SpeciesRec } from './panthera';
import { CARNIVORA_TREE, mammaliaTree } from './splits';
import { loadMammals, mammalsLoaded } from './mammals-data';
import { population } from './population';
import { WorldToggle } from './WorldToggle';
import { MagnifierIcon, SearchPanel } from './SearchPanel';
import { statusOf } from './status';
import { cardTapper, onControl } from './cardtap';
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

/**
 * The view (ToLaD#146): the whole order, each family one branch from afar, opening as you zoom (fold.ts).
 * The level button (ToLaD#247) steps cats -> carnivores -> mammals (every living mammal) -> cats; ?level= opens one.
 */
type Level = 'cats' | 'carnivores' | 'mammals';
const LEVELS: Level[] = ['cats', 'carnivores', 'mammals'];
const LEVEL_NAME: Record<Level, string> = { cats: 'Cats', carnivores: 'Carnivores', mammals: 'Mammals' };
/**
 * The mammal level's data is a file of its own (mammals-data.ts, ToLaD#247), fetched when the level first opens:
 * 'fetch' while it comes, 'build' for one painted frame (the note shows before the layout's long synchronous build),
 * then 'ready'; any other string is the error.
 */
type MammState = 'fetch' | 'build' | 'ready' | string;
const mammStart = (): MammState => (mammalsLoaded() ? 'build' : 'fetch');

function initialLevel(): Level {
  try {
    const q = new URLSearchParams(window.location.search).get('level');
    return LEVELS.includes(q as Level) ? (q as Level) : 'carnivores';
  } catch {
    return 'carnivores';
  }
}

// (A level opens on its first frame; its labels follow in the next slice, ToLaD#255.)
FanView.labelsAfterFirst = true;

export function FanApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FanView | null>(null);
  // A double tap on the card (ToLaD#301): what one on the tree does, one level up, the card closed.
  const cardUp = (x: number, y: number) => viewRef.current?.doubleTap(x, y);
  const [mode, setMode] = useState<WidthMode>('linear');
  const [edge, setEdge] = useState<EdgeStyle>(initialEdge);
  const [sel, setSel] = useState<Selection | null>(null);
  const [searching, setSearching] = useState(false);
  const [level, setLevel] = useState<Level>(initialLevel);
  const [mamm, setMamm] = useState<MammState>(mammStart);
  // The view can be built: any level but the mammals, or the mammals once their data is in.
  const viewReady = level !== 'mammals' || mamm === 'ready';
  const scaleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (level !== 'mammals' || mamm === 'ready') return;
    let live = true;
    if (mamm === 'fetch')
      loadMammals().then(
        () => live && setMamm('build'),
        (e: unknown) => live && setMamm(`could not load the mammals (${e instanceof Error ? e.message : String(e)})`),
      );
    // (Two frames: the note paints before the view's build holds the page.)
    else if (mamm === 'build') requestAnimationFrame(() => setTimeout(() => live && setMamm('ready'), 30));
    return () => {
      live = false;
    };
  }, [level, mamm]);

  useEffect(() => {
    if (!viewReady) return;
    const c = canvasRef.current!;
    const v =
      level === 'mammals'
        ? new FanView(c, mammaliaClade(), edge, mammaliaTree(), true)
        : level === 'carnivores'
          ? new FanView(c, CARNIVORA, edge, CARNIVORA_TREE, true)
          : new FanView(c, FELIDAE, edge);
    if (mode !== 'linear') v.setMode(mode);
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
    // (A new view per level; the toggles' state carries over.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, viewReady]);

  return (
    <div className="app fan">
      <canvas ref={canvasRef} className="stage" />
      {!viewReady && (
        <div className="loading" role="status">
          {mamm === 'fetch' ? 'loading mammals…' : mamm === 'build' ? 'building the mammal tree…' : mamm}
        </div>
      )}
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
        {/* Home for this level, and the level stepper joined to it (ToLaD#247): one pill, so the bar stays one row. */}
        <span className="pair">
          <button type="button" onClick={() => viewRef.current?.resetView()}>
            {level === 'cats' ? 'All cats' : level === 'mammals' ? 'All mammals' : 'All carnivores'}
          </button>
          <button
            type="button"
            className="step"
            title={`Change level (now ${LEVEL_NAME[level]})`}
            aria-label={`level: ${LEVEL_NAME[level]}; tap for ${LEVEL_NAME[LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length]]}`}
            onClick={() => {
              const next = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
              setSel(null);
              if (next === 'mammals') setMamm(mammStart());
              setLevel(next);
              try {
                const u = new URL(window.location.href);
                u.searchParams.set('level', next);
                window.history.replaceState(null, '', u);
              } catch {
                /* not in the address */
              }
            }}
          >
            ⇅
          </button>
        </span>
        <button
          type="button"
          className="icon"
          aria-label="Find a species"
          title="Find a species"
          aria-expanded={searching}
          onClick={() => {
            // Opened synchronously inside the tap, so the field's focus brings the phone's keyboard up.
            flushSync(() => setSearching(true));
          }}
        >
          <MagnifierIcon />
        </button>
        <WorldToggle get={() => viewRef.current} />
      </div>
      {searching && (
        <SearchPanel
          species={viewRef.current?.fan.branches.map((b) => b.sp) ?? []}
          onClose={() => setSearching(false)}
          onPick={(sp) => {
            setSearching(false);
            (document.activeElement as HTMLElement | null)?.blur?.();
            viewRef.current?.flyToSpecies(sp);
          }}
        />
      )}
      <div className="foot">
        <div className="wscale" ref={scaleRef} aria-label="width scale">
          <span className="wbar" />
          <span className="wlab" />
        </div>
      {sel ? (
        sel.lineage ? (
          <LineageCard lin={sel.lineage} onClose={() => viewRef.current?.tap(-1e6, -1e6)} onUp={cardUp} />
        ) : sel.ind ? (
          <IndCard sp={sel.sp} ind={sel.ind} onClose={() => viewRef.current?.tap(-1e6, -1e6)} onUp={cardUp} />
        ) : (
          <SpeciesCard sp={sel.sp} ageMa={sel.ageMa} startMa={sel.startMa} event={sel.event?.k} onClose={() => viewRef.current?.tap(-1e6, -1e6)} onUp={cardUp} />
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
  // (The carnivores bring a -f plural, ToLaD#146: "grey wolves".)
  if (/wolf$/.test(c)) return `${c.slice(0, -1)}ves`;
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

/** Years before present, written out: "25,000". */
const fmtYa = (ya: number) => Math.round(ya).toLocaleString('en-US');

/**
 * A curated event on the card (ToLaD#141): what the bottleneck was, in a sentence or two, the source's
 * own words quoted, and the source linked with its grade. Shown when the touch is inside its window.
 */
export function EventSection({ ev, k }: { ev: HistEvent; k: number }) {
  const kind = ev.kind === 'bottleneck' ? 'Bottleneck' : ev.kind;
  const unshown = ev.scope === 'species' && !ev.shown ? unshownSentence(ev.why) : '';
  return (
    <section className="event" data-event={k}>
      <p className="ev-k">
        {kind} · {fmtYa(ev.fromYa)}–{fmtYa(ev.toYa)} years ago{ev.region ? ` · ${ev.region}` : ''}
      </p>
      <p className="ev-t">{ev.title}</p>
      <p className="ev-s">{ev.summary}</p>
      {unshown && (
        <p className="ev-unshown" data-unshown={ev.why}>
          {unshown}
        </p>
      )}
      <EventSource ev={ev} />
    </section>
  );
}

/**
 * Why our curve doesn't show a species-wide bottleneck (ToLaD#149), from the pipeline's check
 * (`history.event_fall`'s `why`): one plain sentence. The fan still tints it: it is evidenced and species-wide.
 */
export function unshownSentence(why: string): string {
  const head = 'Our population curve doesn’t show this bottleneck: ';
  switch (why) {
    case 'blind spot':
      return `${head}the genome method it is drawn from can’t see the last ~20,000 years, so the curve runs straight across it.`;
    case 'before the data':
      return `${head}we have no figures from before it, so the curve holds a modelled level there.`;
    case 'joined across':
      return `${head}it falls between two different sources (the genome’s deep past and later figures), and the curve is drawn straight between them.`;
    case 'data rises':
      return `${head}the figures it is drawn from rise through this window.`;
    case 'data too shallow':
      return `${head}the figures it is drawn from fall too little here to show at this scale.`;
    case 'not drawn':
      return `${head}this species’ column is drawn from our model, not from its figures.`;
    default:
      return `${head}the curve doesn’t fall through this window.`;
  }
}

/**
 * A regional event on the card (ToLaD#149): a subpopulation's bottleneck, e.g. India's lions. Not on
 * the column (it can't narrow the whole species), so it is listed here, titled with its region, and
 * banded (outlined) on the sparkline. Open when the touch is inside its window.
 */
export function RegionalEvent({ ev, k, open }: { ev: HistEvent; k: number; open: boolean }) {
  const kind = ev.kind === 'bottleneck' ? 'Bottleneck' : ev.kind;
  return (
    <details className="event regional" data-event={k} data-regional="" open={open}>
      <summary>
        <span className="ev-k">
          {kind} in {ev.region || 'part of its range'} · {fmtYa(ev.fromYa)}–{fmtYa(ev.toYa)} years ago
        </span>
        <span className="ev-t">{ev.title}</span>
      </summary>
      <p className="ev-s">{ev.summary}</p>
      <EventSource ev={ev} />
    </details>
  );
}

/** An event's quote and its source, linked with its grade. */
function EventSource({ ev }: { ev: HistEvent }) {
  return (
    <>
      <blockquote className="ev-q">“{ev.quote}”</blockquote>
      <p className="ev-src">
        {ev.url ? (
          <a href={ev.url} target="_blank" rel="noopener noreferrer">
            {ev.cite}
          </a>
        ) : (
          ev.cite
        )}{' '}
        <span className="dim">
          · grade {ev.grade}: {GRADE_MEANS[ev.grade] ?? 'unknown'}
        </span>
      </p>
    </>
  );
}

/**
 * The species' Commons picture (ToLaD#182), hotlinked: nothing at all until it has loaded,
 * and nothing if it fails (no box, no alt text, no gap). Loading, it is a 1 px invisible
 * image, so the browser still fetches it (a lazy image that is not displayed never loads).
 * Keyed by its URL, so another species starts over.
 */
export function WikiPic({ w, initial = 'loading' }: { w: WikiRec | null; initial?: 'loading' | 'ok' | 'failed' }) {
  const [state, setState] = useState(initial);
  // A tap opens it across the card at a larger Commons thumbnail (ToLaD#182); another tap closes it.
  const [big, setBig] = useState(false);
  const [bigFailed, setBigFailed] = useState(false);
  const src = w?.img;
  if (!src || state === 'failed') return null;
  const bigSrc = bigSrcOf(src);
  const useBig = big && !bigFailed && bigSrc !== src;
  return (
    <figure className={`pic ${state}${big ? ' big' : ''}`}>
      <img
        src={useBig ? bigSrc : src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onClick={() => setBig((b) => !b)}
        onLoad={() => setState('ok')}
        onError={() => (useBig ? setBigFailed(true) : setState('failed'))}
      />
      {state === 'ok' && w?.file && (
        <a href={w.file} target="_blank" rel="noopener">
          Wikimedia Commons
        </a>
      )}
    </figure>
  );
}

/**
 * The species' range map (ToLaD#196, Wikidata P181), hotlinked like the photo: under the name,
 * beside the photo (across the card when there is none), nothing until it has loaded and nothing
 * if it fails. A tap enlarges it across the card (the 960 px thumbnail), another shrinks it back.
 * Side by side rather than stacked: stacked, the lion's card filled the whole 390×844 screen.
 */
export function RangeMap({ w, initial = 'loading' }: { w: WikiRec | null; initial?: 'loading' | 'ok' | 'failed' }) {
  const [state, setState] = useState(initial);
  const [big, setBig] = useState(false);
  const [bigFailed, setBigFailed] = useState(false);
  const src = w?.range;
  if (!src || state === 'failed') return null;
  const bigSrc = bigSrcOf(src);
  const useBig = big && !bigFailed && bigSrc !== src;
  return (
    <figure className={`range ${state}${big ? ' big' : ''}`}>
      <img
        src={useBig ? bigSrc : src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onClick={() => setBig((b) => !b)}
        onLoad={() => setState('ok')}
        onError={() => (useBig ? setBigFailed(true) : setState('failed'))}
      />
      {state === 'ok' && w?.rangeFile && (
        <a href={w.rangeFile} target="_blank" rel="noopener">
          Range map · Wikimedia Commons
        </a>
      )}
    </figure>
  );
}

/** The same Commons thumbnail at 960 px (a standard Wikimedia step); the small one if the URL isn't a sized thumb. */
export function bigSrcOf(src: string): string {
  return src.replace(/\/(\d+)px-([^/]+)$/, '/960px-$2');
}

/**
 * A card's box (the species', the split's, the individual's): its touches kept from the tree under it, and a double tap
 * on it, off its controls (links, buttons, Details, the pictures, the globe), one level up as on the tree (ToLaD#301).
 */
function CardShell({ onUp, children }: { onUp?: (x: number, y: number) => void; children: ReactNode }) {
  const up = useRef(onUp);
  up.current = onUp;
  const tapper = useRef<ReturnType<typeof cardTapper> | null>(null);
  tapper.current ??= cardTapper((x, y) => {
    // (A mouse's double click selects a word: not here.)
    window.getSelection?.()?.removeAllRanges();
    up.current?.(x, y);
  });
  const pt = (e: RPointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, ctl: onControl(e.target) });
  return (
    <div
      className="card-sp"
      onPointerDown={(e) => {
        e.stopPropagation();
        tapper.current!.down(pt(e));
      }}
      onPointerUp={(e) => tapper.current!.up(pt(e))}
      onPointerCancel={() => tapper.current!.cancel()}
    >
      {children}
    </div>
  );
}

export function SpeciesCard({ sp, onClose, onUp, open, ageMa, startMa, event }: { sp: SpeciesRec; onClose: () => void; onUp?: (x: number, y: number) => void; open?: boolean; ageMa?: number; startMa?: number; event?: number }) {
  const at = populationAt(sp, ageMa ?? sp.t1, startMa);
  const ev0 = event !== undefined ? sp.history?.events[event] : undefined;
  const ev = ev0?.scope === 'regional' ? undefined : ev0;
  // Regional events (ToLaD#149): listed under the sparkline, the one the touch is inside open.
  const touchAgo = (ageMa ?? sp.t1) * 1e6;
  const regional = (sp.history?.events ?? []).map((e, k) => ({ e, k })).filter(({ e }) => e.scope === 'regional');
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const st = statusOf(sp);
  // A domestic stock: the years its own births span (its curated segments, from domestication).
  const domestic = sp.history?.component === 'domestic' && sp.births ? sp.history.segments.reduce((a, s) => a + s.generations, 0) * sp.history.G : 0;
  const lived = `from ${plainAgo(sp.t0 * 1e6)} to ${sp.extinct ? plainAgo(sp.t1 * 1e6) : 'today'}`;
  const spark = !!sp.history && sp.history.points.length > 0;
  // The natural (pre-human) level: on the sparkline and its sources when there is one, else here.
  const nat = !spark && sp.natural ? sp.natural : null;
  const wiki = wikiOf(sp.sci);
  return (
    <CardShell onUp={onUp}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        {wiki?.wp ? (
          <a className="wp" href={wiki.wp} target="_blank" rel="noopener">
            {sp.common}
          </a>
        ) : (
          <span>{sp.common}</span>
        )}{' '}
        <i>({sp.sci})</i>
      </div>
      {/* The photo and the range side by side under the name (ToLaD#196): the globe (ToLaD#267), else the Wikimedia map. */}
      <div className="media">
        <WikiPic key={wiki?.img ?? ''} w={wiki} />
        <RangeGlobe key={sp.sci} sci={sp.sci} fallback={wiki?.range ? <RangeMap key={`range-${wiki.range}`} w={wiki} /> : null} />
      </div>
      {ev && <EventSection ev={ev} k={event!} />}
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
      {spark && <HistorySpark key={sp.gid} h={sp.history!} open={open} natural={sp.natural} naturalMeta={NATURAL_META} activeEvent={ev ? event : undefined} />}
      {regional.map(({ e, k }) => (
        <RegionalEvent key={`rg${sp.gid}-${k}`} ev={e} k={k} open={touchAgo <= e.fromYa && touchAgo >= e.toYa} />
      ))}
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
                {formatCount(nat.n)} with no human impact <span className="dim">({formatCount(nat.lo)} – {formatCount(nat.hi)})</span>: modelled, grade{' '}
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
    </CardShell>
  );
}

/** A parent column touched: the daughters' shared ancestors at that time, and their split. */
export function LineageCard({ lin, onClose, onUp }: { lin: Lineage; onClose: () => void; onUp?: (x: number, y: number) => void }) {
  const s = lin.node.split;
  const of = lin.of.length > 1 ? `${lin.of.slice(0, -1).join(', ')} and ${lin.of[lin.of.length - 1]}` : lin.of[0];
  const [lo, hi] = [approxMa(s.lo), approxMa(s.hi)];
  const range = s.lo === s.hi ? 'no range found' : lo === hi ? `range ~${lo} million` : `range ${lo}–${hi} million`;
  return (
    <CardShell onUp={onUp}>
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
          Split ~{approxMa(s.ageMa)} million years ago <span className="dim">({range}; {s.confidence} confidence)</span>
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
    </CardShell>
  );
}

function IndCard({ sp, ind, onClose, onUp }: { sp: SpeciesRec; ind: IndInfo; onClose: () => void; onUp?: (x: number, y: number) => void }) {
  return (
    <CardShell onUp={onUp}>
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
    </CardShell>
  );
}
