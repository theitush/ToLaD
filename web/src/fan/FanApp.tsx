// The main view: the dated tree, OneZoom-style.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { approxMa, formatCount, formatMass } from '../data/count';
import { HistorySpark } from './HistorySpark';
import type { Measure } from './layout';
import { drawStub, wikiOf, type WikiRec } from './wiki';
import { RangeGlobe } from './Globe';
import { Alone, AloneImg, useAlone } from './Alone';
import { mammaliaClade, NATURAL_META, type HistEvent, type SpeciesRec } from './panthera';
import { mammaliaTree } from './splits';
import { fossilsAll, loadMammalCard, loadMammals, mammalCardLoaded, mammalsLoaded } from './mammals-data';
import { synthLoader } from './synthetic-level';
import { stamp } from '../stamp';
import { population } from './population';
import { WorldToggle } from './WorldToggle';
import { ChoiceChip, chosenIn, type Choice } from './ChoiceChip';
import { forkLeaders, forkNames, setForkLeaders, setForkNames } from './brackets';
import { FORK_MODES, forkMode, setForkMode, type ForkMode } from './steady';
import { MagnifierIcon, SearchPanel } from './SearchPanel';
import { SourcesPanel } from './SourcesPanel';
import { GRADE_MEANS, METHOD_IDS, MethodLink, OpenMethods, WORD_IDS } from './Methods';
import { aliveSource, aliveStep, LossLine, SOURCE_WORD, useMethodsPage } from './cardwords';
import { statusOf, wildPartSentence } from './status';
import { cardTapper, onControl } from './cardtap';
import { sheetSwipe, useBackCloses } from './sheet';
import { flipOn, forkQuiet, setForkQuiet } from './flip';
import { CARD_SHARE, FanView, initialMeasure, levelName, type CardKey, type Lineage, type Place, type Selection } from './view';
import { keptPlace, treeKey, watchBack } from './back';

declare global {
  interface Window {
    __fan?: FanView;
    /** The name a group's pill shows, for the browser probes (scripts/tapshot.mjs). */
    __levelName?: typeof levelName;
  }
}

/**
 * The view (ToLaD#146): every mammal, each order and family one branch from afar, opening as you zoom (fold.ts). The one
 * page since ToLaD#418: the cats' and carnivores' are clades in it, and their old links land on their frames.
 *
 * Its data is a file of its own (mammals-data.ts, ToLaD#247), fetched on open: 'fetch' while it comes, 'build' for one
 * painted frame (the note shows before the layout's long synchronous build), then 'ready'; any other string is the error.
 */
type MammState = 'fetch' | 'build' | 'ready' | string;
const mammStart = (): MammState => (mammalsLoaded() ? 'build' : 'fetch');

/** The clade an old `?level=` link means (ToLaD#418): `?level=mammals`, or none, is home. */
export function levelLinkClade(search: string): string | null {
  const q = new URLSearchParams(search).get('level');
  return q === 'cats' ? 'Felidae' : q === 'carnivores' ? 'Carnivora' : null;
}

/** How a fork is drawn (ToLaD#377, `?forks=`): a look only, no new view. (The first, `thin`, is forkMode's default: the address leaves it out.) */
const FORK_LOOKS: Record<ForkMode, string> = { thin: 'thin: wide stems as lines', peel: 'peel: ribbons, the old look', flat: 'flat' };
export const FORK_CHOICES: Choice<ForkMode>[] = FORK_MODES.map((m) => ({ value: m, short: m, label: FORK_LOOKS[m] }));
function initialForks(): ForkMode {
  try {
    const m = chosenIn(window.location.search, 'forks', FORK_CHOICES);
    if (m) setForkMode(m);
  } catch {
    /* no address */
  }
  return forkMode();
}

/** The upper clades' names (ToLaD#373, #434, #458): at their forks (`?forknames=fork`), on leaders off them (`?forknames=leaders`), or none: on the tree on its side the labels in the gaps name them (ToLaD#458), elsewhere the stack over "now" (`?forknames=off`). */
type ForkNaming = 'at fork' | 'leaders' | 'off';
const FORK_NAMINGS: Record<ForkNaming, Choice<ForkNaming>> = {
  off: { value: 'off', short: 'off', label: flipOn() ? 'off: named in the gaps' : 'off: the stack over now' },
  'at fork': { value: 'at fork', short: 'at fork', label: 'at their forks', q: 'fork' },
  leaders: { value: 'leaders', short: 'leaders', label: 'on leaders off the forks' },
};
/** The default first (the address leaves it out): on its side none, upright at the forks. */
export const FORK_NAMING_CHOICES = (flipOn() ? (['off', 'at fork', 'leaders'] as const) : (['at fork', 'leaders', 'off'] as const)).map((k) => FORK_NAMINGS[k]);
const forkNaming = (m: ForkNaming) => {
  // (On its side `off` asks no stack: the brackets keep their fork mode and place no names.)
  setForkNames(flipOn() || m !== 'off');
  setForkLeaders(m === 'leaders');
  setForkQuiet(m === 'off');
};
/** Set before the first view is built. */
function initialForkNames(): ForkNaming {
  try {
    const m = chosenIn(window.location.search, 'forknames', FORK_NAMING_CHOICES);
    if (m) forkNaming(m);
  } catch {
    /* no address */
  }
  return forkQuiet() || !forkNames() ? 'off' : forkLeaders() ? 'leaders' : 'at fork';
}

/** Which fossils the tree carries (ToLaD#279, `?fossils=old`): a data switch, so a pick reloads (mammals-data.ts reads it). */
export const FOSSIL_CHOICES: Choice<'all' | 'old'>[] = [
  { value: 'all', short: 'all', label: 'every fossil' },
  { value: 'old', short: 'old', label: 'old: dated tree only' },
];

export function FanApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FanView | null>(null);
  // Where the view stood when a look's switch asked for a new one (ToLaD#412): the new one's first place.
  // (Or where it stood when the page went hidden, this load that page coming back, ToLaD#478; with the card it had open.)
  const placeRef = useRef<Place | null>(keptPlace()?.place ?? null);
  const cardRef = useRef<CardKey | null>(keptPlace()?.card ?? null);
  // A double tap on the card (ToLaD#301): what one on the tree does, one level up, the card closed.
  const cardUp = (x: number, y: number) => viewRef.current?.doubleTap(x, y);
  const [forks, setForks] = useState(initialForkNames);
  const [forkLook, setForkLook] = useState<ForkMode>(initialForks);
  // What the widths count (ToLaD#276): individuals, or their mass (`?width=mass`).
  const [measure, setMeasure] = useState<Measure>(initialMeasure);
  const [sel, setSel] = useState<Selection | null>(null);
  // (Back closes the card, whichever it is (ToLaD#509): the same close as its ×.)
  const closeCard = useCallback(() => viewRef.current?.tap(-1e6, -1e6), []);
  useBackCloses(!!sel, closeCard);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [searching, setSearching] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const closeSources = useCallback(() => setShowSources(false), []);
  // "How we count" opened from a card's word at its section (ToLaD#508): over everything, the card left as it was under it.
  const [methodsPage, openMethods] = useMethodsPage();
  const [mamm, setMamm] = useState<MammState>(mammStart);
  // The view can be built: the mammals' data is in.
  const viewReady = mamm === 'ready';
  // Where the first view stands, from an old link.
  const linkRef = useRef(typeof location === 'undefined' ? null : levelLinkClade(location.search));
  const scaleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mamm === 'ready') return;
    let live = true;
    if (mamm === 'fetch')
      loadMammals(synthLoader()).then(
        () => live && setMamm('build'),
        (e: unknown) => live && setMamm(`could not load the mammals (${e instanceof Error ? e.message : String(e)})`),
      );
    // (Two frames: the note paints before the view's build holds the page.)
    else if (mamm === 'build') requestAnimationFrame(() => setTimeout(() => live && setMamm('ready'), 30));
    return () => {
      live = false;
    };
  }, [mamm]);

  useEffect(() => {
    if (!viewReady) return;
    const c = canvasRef.current!;
    stamp('build');
    const v = new FanView(c, mammaliaClade(), mammaliaTree(), true);
    stamp('view');
    v.setMeasure(measure);
    v.onSelect = setSel;
    v.scaleEl = scaleRef.current;
    v.barEl = barRef.current;
    // (A look's switch stays where the view was, ToLaD#412; an old link stands on its clade's frame, no flight.)
    // (A place kept before a reload from another build of the tree is not this one's: home, ToLaD#478.)
    const kept = keptPlace();
    if (kept && placeRef.current === kept.place && kept.tree !== treeKey(v)) placeRef.current = cardRef.current = null;
    try {
      if (placeRef.current) v.goToPlace(placeRef.current);
      else if (linkRef.current) v.goToClade(linkRef.current);
      if (cardRef.current) v.openCard(cardRef.current);
    } catch (e) {
      // (A place that no longer fits never leaves the page blank: the view stays home.)
      console.warn('fan: could not go back to the place kept', e);
    }
    placeRef.current = linkRef.current = cardRef.current = null;
    viewRef.current = v;
    window.__fan = v;
    window.__levelName = levelName;
    v.request();
    // The card's kinds (mammals-card.json, ToLaD#502; downloaded while the tree was built) read once the first frame is
    // on screen, so a tap rarely waits for them.
    let later = 0;
    const first = requestAnimationFrame(() => (later = window.setTimeout(() => loadMammalCard().catch((e: unknown) => console.warn('fan: the card data did not load', e)), 0)));
    // (Back on the tab, ToLaD#478: drawn again, or the page reloaded to here.)
    const unwatch = watchBack(v, () => selRef.current);
    // The canvas text waits for the faces (drawn in system type until then).
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.all([document.fonts.load("600 16px 'Sofia Sans Condensed'"), document.fonts.load("italic 400 14px 'Newsreader'")])
        .catch(() => undefined)
        .then(() => v.fontsIn());
    }
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(later);
      unwatch();
      v.destroy();
      viewRef.current = null;
      if (window.__fan === v) delete window.__fan;
    };
    // (A new view per look's switch; the toggles' state carries over.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewReady, forks]);

  return (
    <div className="app fan">
      <canvas ref={canvasRef} className="stage" />
      {!viewReady && (
        <div className="loading" role="status">
          <b>Tree of Life and Death</b>
          <br />
          {mamm === 'fetch' ? (
            'Every mammal, alive and dead: loading…'
          ) : mamm === 'build' ? (
            'Every mammal, alive and dead: building the tree…'
          ) : (
            <>
              {mamm} <button type="button" onClick={() => setMamm('fetch')}>Try again</button>
            </>
          )}
        </div>
      )}
      <div className="bar" ref={barRef} style={viewReady ? undefined : { visibility: 'hidden' }}>
        {/* ToLaD#537: each chip opens its choices (ChoiceChip); a pick applies, the address kept in step. */}
        {/* ToLaD#373, #434: the upper clades named at their forks, on leaders off them, or in the stack over "now". */}
        <ChoiceChip
          name="fork names"
          title="Upper clades' names: on the gaps above them (the tree on its side), at their forks, on leaders off them, or off (the stack over now)"
          param="forknames"
          choices={FORK_NAMING_CHOICES}
          value={forks}
          onPick={(m) => {
            placeRef.current = viewRef.current?.place() ?? null;
            forkNaming(m);
            setSel(null);
            setForks(m);
          }}
        />
        {/* ToLaD#377, #402, #439: how a fork with too little height is drawn: a rectangular tree's corner, and a stem wider than tall a line (thin), or a ribbon (peel, the old look). */}
        <ChoiceChip
          name="forks"
          title="Forks: thin lines for wide stems, or peeling ribbons"
          param="forks"
          choices={FORK_CHOICES}
          value={forkLook}
          onPick={(m) => {
            setForkMode(m);
            setForkLook(m);
            viewRef.current?.request();
          }}
        />
        {/* ToLaD#279: every fossil on the tree is the page; the old look (the dated phylogeny's fossils only) to compare. Its own data files, so a reload. */}
        <ChoiceChip
          name="fossils"
          title="Fossils: every one on the tree (new), or only those in the dated phylogeny (old), to compare"
          param="fossils"
          choices={FOSSIL_CHOICES}
          value={fossilsAll ? 'all' : 'old'}
          reload
        />
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
        <WorldToggle get={() => viewRef.current} onMeasure={setMeasure} />
      </div>
      {/* ToLaD#452: the chain of groups the view is in, written by the view (chainFrame). */}
      {flipOn() && viewReady && <div className="chain" />}
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
      <div className="foot" style={{ ['--card-share' as string]: CARD_SHARE, visibility: viewReady ? undefined : 'hidden' }}>
        <div className="wscale" ref={scaleRef} aria-label="width scale">
          <span className="wbar" />
          <span className="wlab" />
        </div>
      <OpenMethods.Provider value={openMethods}>
      {sel ? (
        sel.lineage ? (
          <LineageCard lin={sel.lineage} onClose={closeCard} onUp={cardUp} />
        ) : (
          <SpeciesCardWhenIn
            sp={sel.sp}
            mass={measure === 'mass'}
            ageMa={sel.ageMa}
            startMa={sel.startMa}
            event={sel.event?.k}
            onClose={closeCard}
            onUp={cardUp}
            onBox={sel.event ? undefined : (el) => viewRef.current?.cardBox(el)}
          />
        )
      ) : showSources ? (
        <SourcesPanel onClose={closeSources} />
      ) : (
        <div className="foot-row">
          <ul className="key" aria-label="key">
            <li>
              <span className="lane alive" /> alive now
            </li>
            <li>
              <span className="lane lineage" /> living descendants
            </li>
            <li>
              <span className="lane dead" /> extinct
            </li>
          </ul>
          <button type="button" className="sources-link" onClick={() => setShowSources(true)}>
            sources
          </button>
        </div>
      )}
      </OpenMethods.Provider>
      </div>
      {methodsPage}
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
  // (The domestic stocks bring these, ToLaD#435: "sheep", "dromedaries".)
  if (/(sheep|cattle|deer)$/.test(c)) return c;
  if (/[^aeiou]y$/.test(c)) return `${c.slice(0, -1)}ies`;
  return /(s|x|z|ch|sh)$/.test(c) ? `${c}es` : `${c}s`;
}

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
    <>
      <span className={`status iucn-${s.code.toLowerCase()}`} title={`IUCN Red List: ${s.label} (${s.status.year} assessment)`}>
        {s.label}
      </span>
      {sp.rangeExPe && (
        <span className="status-note" data-range-ex="">
          {RANGE_EX_PE_WORDS}
        </span>
      )}
    </>
  );
}

/** FLAG bit 12 (ToLaD#507) on the status line: IUCN's map codes every part of its range as gone or perhaps gone. */
export const RANGE_EX_PE_WORDS = 'whole range coded extinct or possibly extinct by IUCN';

/** A species nobody knows the number of (FLAG bit 11, ToLaD#507): why, in the card's few words. */
export const UNKNOWN_WHY = 'no range map, never counted';

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
 * The species' Commons picture (ToLaD#182), hotlinked. Loading, its square and its credit line are held at their
 * loaded size with a spinner over them (ToLaD#479: nothing moves when it arrives; app.css shows the spinner only after
 * a moment, so a cached picture never flashes it). With none, or once it fails, the tree's stub in its box (ToLaD#492).
 * Keyed by its URL, so another species starts over.
 */
export function WikiPic({ w, initial = 'loading' }: { w: WikiRec | null; initial?: 'loading' | 'ok' | 'failed' }) {
  const [state, setState] = useState(initial);
  // A tap shows it alone, full screen, at a larger Commons thumbnail (ToLaD#506, Alone.tsx); a tap there closes it.
  const [alone, show, close] = useAlone();
  const src = w?.img;
  if (!src || state === 'failed') return <PicStub />;
  const credit = w?.file && (
    <a href={w.file} target="_blank" rel="noopener">
      Wikimedia Commons
    </a>
  );
  return (
    <figure className={`pic ${state}`}>
      <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" onClick={show} onLoad={() => setState('ok')} onError={() => setState('failed')} />
      {/* (Its credit line from the start, hidden while loading: the box is its loaded height.) */}
      {credit}
      {alone && (
        <Alone credit={credit} onClose={close}>
          <AloneImg src={src} big={bigSrcOf(src)} />
        </Alone>
      )}
    </figure>
  );
}

/**
 * The species' range map (ToLaD#196, Wikidata P181), hotlinked like the photo: under the name,
 * beside the photo, its place held with a spinner while it loads, `none` (the globe with no range, ToLaD#492) if it
 * fails. A tap shows it alone, full screen (the 960 px thumbnail, ToLaD#506); a tap there closes it.
 * Side by side rather than stacked: stacked, the lion's card filled the whole 390×844 screen.
 */
export function RangeMap({ w, initial = 'loading', none = null }: { w: WikiRec | null; initial?: 'loading' | 'ok' | 'failed'; none?: ReactNode }) {
  const [state, setState] = useState(initial);
  const [alone, show, close] = useAlone();
  const src = w?.range;
  if (!src || state === 'failed') return none;
  const credit = w?.rangeFile && (
    <a href={w.rangeFile} target="_blank" rel="noopener">
      Range map · Wikimedia Commons
    </a>
  );
  return (
    <figure className={`range ${state}`}>
      <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" onClick={show} onLoad={() => setState('ok')} onError={() => setState('failed')} />
      {credit}
      {alone && (
        <Alone credit={credit} onClose={close}>
          <AloneImg src={src} big={bigSrcOf(src)} />
        </Alone>
      )}
    </figure>
  );
}

/**
 * No photo (none in the wiki, or it failed for good): the tree's stub (ToLaD#400, wiki.drawStub), in the picture's box
 * at its size, its caption in the credit's line (ToLaD#492), so the card shows what is missing as the tree does.
 */
function PicStub() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = Math.round((c.clientWidth || 120) * Math.min(2, window.devicePixelRatio || 1));
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    if (ctx) drawStub(ctx, px / 2, px / 2, px);
  }, []);
  return (
    <figure className="pic stub">
      <canvas ref={ref} />
      <span className="cap">No photo</span>
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
 * A bottom sheet (ToLaD#509, sheet.ts): its head (a grab bar, the ×, the name) stays, and the rest scrolls under it, the
 * whole held to its share of the screen (view.CARD_SHARE); a swipe down closes it.
 */
export function CardShell({
  onUp,
  onBox,
  onClose,
  head,
  children,
}: {
  onUp?: (x: number, y: number) => void;
  onBox?: (el: HTMLElement) => void;
  onClose: () => void;
  head: ReactNode;
  children: ReactNode;
}) {
  const up = useRef(onUp);
  up.current = onUp;
  const shut = useRef(onClose);
  shut.current = onClose;
  // (Its box as laid out, and again whenever it changes, to whoever frames the tree in the room it leaves (FanView.cardBox, ToLaD#496).)
  const box = useRef(onBox);
  box.current = onBox;
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    box.current?.(el);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => box.current?.(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tapper = useRef<ReturnType<typeof cardTapper> | null>(null);
  tapper.current ??= cardTapper((x, y) => {
    // (A mouse's double click selects a word: not here.)
    window.getSelection?.()?.removeAllRanges();
    up.current?.(x, y);
  });
  const swipe = useRef<ReturnType<typeof sheetSwipe> | null>(null);
  swipe.current ??= sheetSwipe();
  // (A swipe's end is no click on the link or the picture it started on.)
  const swiped = useRef(false);
  const shift = (dy: number, snap = false) => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle('snap', snap);
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  // (A touch pulling the sheet down is not also the content's scroll, nor the page's: its moves are kept from the browser
  // while the sheet follows. React's touch listeners are passive, so this one is the element's own.)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const keep = (e: TouchEvent) => {
      if (swipe.current?.following) e.preventDefault();
    };
    el.addEventListener('touchmove', keep, { passive: false });
    return () => el.removeEventListener('touchmove', keep);
  }, []);
  const pt = (e: RPointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, ctl: onControl(e.target) });
  return (
    <div
      ref={ref}
      className="card-sp sheet"
      onPointerDown={(e) => {
        e.stopPropagation();
        const p = pt(e);
        tapper.current!.down(p);
        const b = body.current;
        swiped.current = false;
        swipe.current!.down(p, !b || !b.contains(e.target as Node) || b.scrollTop <= 0);
      }}
      onPointerMove={(e) => {
        const dy = swipe.current!.move(pt(e));
        if (dy === null) return;
        if (!swiped.current) {
          swiped.current = true;
          tapper.current!.cancel();
          ref.current?.setPointerCapture?.(e.pointerId);
        }
        shift(dy);
      }}
      onPointerUp={(e) => {
        const p = pt(e);
        tapper.current!.up(p);
        const h = ref.current?.getBoundingClientRect().height ?? 0;
        if (swipe.current!.up(p, h)) {
          shift(0);
          shut.current();
        } else if (swiped.current) shift(0, true);
      }}
      onPointerCancel={() => {
        tapper.current!.cancel();
        swipe.current!.cancel();
        shift(0, true);
      }}
      onClickCapture={(e) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="head">
        <span className="grab" aria-hidden="true" />
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        {head}
      </div>
      <div className="body" ref={body}>
        {children}
      </div>
    </div>
  );
}

/** Where a species' adult mass comes from, as the card's mass line ends (ToLaD#276; dated.MASS_HOW). */
function massNote(how: string | undefined): string {
  if (!how) return '';
  // (A domestic stock weighs its herd's mean live mass, young in it: Greenspoon 2023's livestock and pets, ToLaD#328.)
  if (how === 'domestic stock') return " (the herd's mean, young ones in it; Greenspoon 2023)";
  if (how.endsWith(' mean')) return how === 'Mammalia mean' ? ' (the mammals\' mean: no mass known)' : ` (its ${how.replace(' mean', '')}'s mean: its own not known)`;
  const src: Record<string, string> = { phylacine: 'PHYLACINE 1.2', combine: 'COMBINE', pantheria: 'PanTHERIA', 'combine-imputed': 'COMBINE, imputed' };
  return ` (adult, ${src[how] ?? how})`;
}

/** For a card: whether mammals-card.json's kinds are in (ToLaD#502), loading them if not; a re-render when they come. */
export function useMammalCard(): boolean {
  const [isIn, setIn] = useState(() => !mammalsLoaded() || mammalCardLoaded());
  useEffect(() => {
    if (isIn) return;
    let live = true;
    loadMammalCard().then(
      () => live && setIn(true),
      (e: unknown) => console.warn('fan: the card data did not load', e),
    );
    return () => {
      live = false;
    };
  }, [isIn]);
  return isIn;
}

type SpeciesCardProps = {
  sp: SpeciesRec;
  onClose: () => void;
  onUp?: (x: number, y: number) => void;
  onBox?: (el: HTMLElement) => void;
  open?: boolean;
  ageMa?: number;
  startMa?: number;
  event?: number;
  mass?: boolean;
};

/** The page's species card: until the card's kinds are in (ToLaD#502), its name, its picture and its range, the rest a spinner. */
function SpeciesCardWhenIn(p: SpeciesCardProps) {
  return useMammalCard() ? <SpeciesCard {...p} /> : <SpeciesCardWait {...p} />;
}

/** The card while mammals-card.json comes: what the open data has (the name, the picture, the globe), the facts' place a spinner. */
function SpeciesCardWait({ sp, onClose, onUp, onBox }: SpeciesCardProps) {
  const wiki = wikiOf(sp.sci);
  return (
    <CardShell
      onUp={onUp}
      onBox={onBox}
      onClose={onClose}
      head={
        <div className="t">
          <span>{sp.common}</span> <i>({sp.sci})</i>
        </div>
      }
    >
      <div className="media">
        <WikiPic key={wiki?.img ?? ''} w={wiki} />
        <RangeGlobe key={sp.sci} sci={sp.sci} />
      </div>
      <div className="facts-wait loading" role="status" aria-label="loading" />
    </CardShell>
  );
}

export function SpeciesCard({ sp, onClose, onUp, onBox, open, ageMa, startMa, event, mass }: SpeciesCardProps) {
  const at = populationAt(sp, ageMa ?? sp.t1, startMa);
  const ev0 = event !== undefined ? sp.history?.events[event] : undefined;
  const ev = ev0?.scope === 'regional' ? undefined : ev0;
  // Regional events (ToLaD#149): listed under the sparkline, the one the touch is inside open.
  const touchAgo = (ageMa ?? sp.t1) * 1e6;
  const regional = (sp.history?.events ?? []).map((e, k) => ({ e, k })).filter(({ e }) => e.scope === 'regional');
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  // Nobody knows how many (ToLaD#507): its count is a width, the thinnest, never a figure; the card says "unknown" and why.
  const unknown = sp.countUnknown && !sp.extinct;
  const why = (
    <MethodLink to={METHOD_IDS.unknown} className="src">
      {UNKNOWN_WHY}
    </MethodLink>
  );
  const st = statusOf(sp);
  const wildPart = wildPartSentence(sp, formatCount);
  // A domestic stock: the years its own births span (its curated segments, from domestication).
  const domestic = sp.history?.component === 'domestic' && sp.births ? sp.history.segments.reduce((a, s) => a + s.generations, 0) * sp.history.G : 0;
  const lived = `from ${plainAgo(sp.t0 * 1e6)} to ${sp.extinct ? plainAgo(sp.t1 * 1e6) : 'today'}`;
  const spark = !!sp.history && sp.history.points.length > 0;
  // The natural level (the level in 1500, or an extinct species' own): on the sparkline and its sources when there is one, else here.
  const nat = !spark && sp.natural ? sp.natural : null;
  const wiki = wikiOf(sp.sci);
  // Every number says in a word or two where it came from, and that word opens "How we count" at its step (ToLaD#508).
  const src = aliveSource(sp);
  const today = (
    <MethodLink to={aliveStep(sp)} className="src">
      {src ? SOURCE_WORD[src] : 'counted or modelled'}
    </MethodLink>
  );
  // A time before today: its own history's (step 3), an extinct species' (step 7), else the level in 1500 held back (step 2).
  const past =
    sp.history && !sp.history.modelled ? (
      <MethodLink to={METHOD_IDS.histories} className="src">
        from its history
      </MethodLink>
    ) : (
      <MethodLink to={sp.extinct ? METHOD_IDS.fossils : METHOD_IDS.past} className="src">
        modelled
      </MethodLink>
    );
  return (
    <CardShell
      onUp={onUp}
      onBox={onBox}
      onClose={onClose}
      head={
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
      }
    >
      {/* The photo and the range side by side under the name (ToLaD#196): the globe (ToLaD#267), else the Wikimedia map;
          either missing, what says so in its box (ToLaD#492), so every card has the same two. */}
      <div className="media">
        <WikiPic key={wiki?.img ?? ''} w={wiki} />
        <RangeGlobe key={sp.sci} sci={sp.sci} fallback={wiki?.range ? (none) => <RangeMap key={`range-${wiki.range}`} w={wiki} none={none} /> : undefined} />
      </div>
      {ev && <EventSection ev={ev} k={event!} />}
      <div className="facts">
        <StatusChip sp={sp} />
        {wildPart && (
          <p className="sub" data-wild-part>
            {wildPart}
          </p>
        )}
        <p className="lead" data-unknown={unknown ? '' : undefined}>
          <span className={`lane ${sp.extinct ? 'dead' : at.now ? 'alive' : 'lineage'}`} />
          {unknown ? (
            <span>
              <b>Unknown</b> alive {at.when}: {why}
            </span>
          ) : (
            <span>
              <b>{formatCount(at.alive)}</b> alive {at.when} {at.now ? today : past}
            </span>
          )}
        </p>
        {mass && sp.massKg && !unknown ? (
          <p className="sub" data-mass>
            <MethodLink to={WORD_IDS.weighing}>Weighing</MethodLink> {formatMass(at.alive * sp.massKg)}, at {formatMass(sp.massKg)} each{massNote(sp.massHow)}
          </p>
        ) : null}
        {!sp.extinct && !at.now && !unknown && (
          <p className="sub">
            {pct(at.green)} have descendants alive today{' '}
            <MethodLink to={METHOD_IDS.descendants} className="src">
              modelled
            </MethodLink>
          </p>
        )}
        {sp.extinct && !at.end && <p className="sub">Died out {plainAgo(sp.t1 * 1e6)}</p>}
        {/* A fossil the data grafts on by taxonomy only (ToLaD#279): how it was placed, and its fossils' date range. */}
        {sp.placed && (
          <p className="sub" data-placed>
            Fossils from {plainAgo(sp.t0 * 1e6).replace(/ years ago$/, '')} to {plainAgo(sp.t1 * 1e6)}. Placed on its {sp.placed} by name; no family tree data.
          </p>
        )}
        {!sp.extinct && !at.now && !unknown && (
          <p className="lead">
            <span className="lane alive" />
            <span>
              <b>{formatCount(sp.alive)}</b> alive today {today}
            </span>
          </p>
        )}
        {unknown ? (
          <p className="ever">
            How many {pluralName(sp)} have ever lived: unknown
          </p>
        ) : (
          <p className="ever">
            Roughly {formatCount(sp.ever, { tilde: false })} {pluralName(sp)} {domestic ? 'born since domestication' : 'have ever lived'}{' '}
            <MethodLink to={METHOD_IDS.ever} className="src">
              (rough estimate)
            </MethodLink>
          </p>
        )}
      </div>
      {spark && <HistorySpark key={sp.gid} h={sp.history!} open={open} natural={sp.natural} naturalMeta={NATURAL_META} loss={sp.loss} activeEvent={ev ? event : undefined} />}
      {/* What dates the change since 1500 (ToLaD#507), under it: a source's year, a bound, or not known. */}
      <LossLine sp={sp} />
      {regional.map(({ e, k }) => (
        <RegionalEvent key={`rg${sp.gid}-${k}`} ev={e} k={k} open={touchAgo <= e.fromYa && touchAgo >= e.toYa} />
      ))}
      <details className="more" key={`more-${sp.gid}`}>
        <summary>Details</summary>
        <dl>
          <dt>
            <MethodLink to={sp.extinct ? METHOD_IDS.fossils : METHOD_IDS.ever}>Lived</MethodLink>
          </dt>
          <dd>{lived}</dd>
          <dt>
            <MethodLink to={WORD_IDS.generation}>Generation</MethodLink>
          </dt>
          <dd>
            about {Number(sp.genYears.toPrecision(2))} years <span className="dim">({GEN_HOW[sp.genSource] ?? sp.genSource})</span>
          </dd>
          <dt>
            <MethodLink to={METHOD_IDS.ever}>Ever lived</MethodLink>
          </dt>
          <dd>
            {unknown
              ? 'unknown: no count today to reckon it from'
              : domestic
              ? `${formatCount(sp.ever)} since domestication, ${plainAgo(domestic).replace(/ ago$/, '')} (the domestic stock's own births)`
              : `${formatCount(sp.ever)}, could be ${formatCount(sp.everLo, { tilde: false })} – ${formatCount(sp.everHi, { tilde: false })}, over ${plainAgo((sp.t0 - sp.t1) * 1e6).replace(/ ago$/, '')}`}
          </dd>
          <dt>
            <MethodLink to={METHOD_IDS.grades}>Data grade</MethodLink>
          </dt>
          <dd>
            {sp.grade}: {GRADE_MEANS[sp.grade] ?? 'unknown'}
          </dd>
          {nat && (
            <>
              <dt>
                <MethodLink to={sp.extinct ? METHOD_IDS.fossils : METHOD_IDS.past}>Natural level</MethodLink>
              </dt>
              <dd data-natural="">
                <NaturalLine sp={sp} nat={nat} />
              </dd>
            </>
          )}
          <dt>
            <MethodLink to={WORD_IDS.status}>Status</MethodLink>
          </dt>
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
                {sp.rangeExPe && <>. Its map codes the whole range Extinct or Possibly Extinct</>}
              </>
            ) : st?.kind === 'domestic' ? (
              'Domesticated: the IUCN Red List does not assess domestic forms (Not Evaluated).'
            ) : st?.kind === 'prehistoric' ? (
              'Known from fossils; died out before the Red List’s scope (extinctions since 1500 CE), so no IUCN category.'
            ) : (
              'No Red List category on file.'
            )}
          </dd>
          <dt>Method</dt>
          <dd>
            <MethodLink to={METHOD_IDS.alive}>How we count, step by step</MethodLink>
          </dd>
        </dl>
      </details>
    </CardShell>
  );
}

/** The data's generation sources in the methods page's words (step 4: COMBINE, else from body size). */
const GEN_HOW: Record<string, string> = { allometric: 'from body size' };

/**
 * The natural level in the card's details (a species with no chart to carry it): the level in 1500 from PHYLACINE's map
 * without people (step 2), or an extinct species' level while it lived (step 7). Since ToLaD#507 a map difference that
 * PHYLACINE puts down to something other than people draws no change: the level is today's, and the card says so.
 */
function NaturalLine({ sp, nat }: { sp: SpeciesRec; nat: NonNullable<SpeciesRec['natural']> }) {
  const flat = !sp.extinct && Math.abs(nat.n - sp.alive) <= 1e-6 * sp.alive;
  const maps = `${formatCount(nat.km2Natural)} km² without people${nat.km2Current > 0 ? `, ${formatCount(nat.km2Current)} km² today` : ''}`;
  const cite = NATURAL_META?.url ? (
    <a href={NATURAL_META.url} target="_blank" rel="noopener noreferrer">
      PHYLACINE
    </a>
  ) : (
    'PHYLACINE'
  );
  // (A loss the data dates before 1500 is left out of the level, ToLaD#507: the harp seal's Baltic. Its line says when.)
  if (flat && sp.loss?.basis === 'prehistoric')
    return (
      <>
        {formatCount(nat.n)}, the same as today: what it lost before 1500 is not counted ({maps}, {cite})
      </>
    );
  if (flat)
    return (
      <>
        {formatCount(nat.n)}, the same as today: {cite}’s maps differ ({maps}), but not by people’s doing, so no change is drawn
      </>
    );
  return (
    <>
      {formatCount(nat.n)} {sp.extinct ? 'while it lived' : 'in 1500'}{' '}
      <span className="dim">
        (could be {formatCount(nat.lo)} – {formatCount(nat.hi)})
      </span>
      , modelled from {cite}’s map without people: {maps}
    </>
  );
}

/** A parent column touched: the daughters' shared ancestors at that time, and their split. */
export function LineageCard({ lin, onClose, onUp }: { lin: Lineage; onClose: () => void; onUp?: (x: number, y: number) => void }) {
  const s = lin.node.split;
  const of = lin.of.length > 1 ? `${lin.of.slice(0, -1).join(', ')} and ${lin.of[lin.of.length - 1]}` : lin.of[0];
  const [lo, hi] = [approxMa(s.lo), approxMa(s.hi)];
  const range = s.lo === s.hi ? 'no range found' : lo === hi ? `range ~${lo} million` : `range ${lo}–${hi} million`;
  return (
    <CardShell
      onUp={onUp}
      onClose={onClose}
      head={
        <div className="t">
          <span>{lin.name}</span>
        </div>
      }
    >
      <div className="facts">
        <p className="lead">
          <span className="lane lineage" />
          <span>
            {lin.measure === 'mass' ? (
              <>
                <b>{formatMass(lin.alive)}</b> of them alive {plainAgo(lin.ageMa * 1e6)} <span className="dim">(model)</span>
              </>
            ) : (
              <>
                <b>{formatCount(lin.alive)}</b> alive {plainAgo(lin.ageMa * 1e6)} <span className="dim">(model)</span>
              </>
            )}
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

