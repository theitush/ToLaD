// "How we count" (ToLaD#508): the method in plain words, one step a section, walking one species (the northern quoll)
// through every step with its real numbers, and every word the species card shows. Opened from the Sources panel
// (SourcesPanel.tsx); a page over everything (a portal into the body), closed by its × or back (useAlone's history
// entry). Each step has a stable anchor id (METHOD_IDS, WORD_IDS) for the card to link to. The method is read from the
// pipeline (pipeline/tolad_pipeline/model.py, pipeline/FORMAT.md), not from research/02, which is older.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatCount } from '../data/count';
import type { GlobeData } from './globe-data';
import { loadGlobeCode } from './Globe';
import { GRADE_COLOR, GRADE_WORD } from './history';
import './methods.css';

/** The steps' anchor ids, in page order. Stable: the species card links to them. */
export const METHOD_IDS = {
  alive: 'm-alive',
  past: 'm-1500',
  histories: 'm-histories',
  ever: 'm-ever',
  descendants: 'm-descendants',
  grades: 'm-grades',
  fossils: 'm-fossils',
  unknown: 'm-unknown',
  words: 'm-words',
} as const;
export type MethodId = (typeof METHOD_IDS)[keyof typeof METHOD_IDS];

/** The card's words, each defined in the "Words on the card" list under its own id. */
export const WORD_IDS = {
  alive: 'w-alive',
  weighing: 'w-weighing',
  descendants: 'w-descendants',
  ever: 'w-ever',
  generation: 'w-generation',
  grade: 'w-grade',
  method: 'w-method',
  natural: 'w-natural',
  status: 'w-status',
  chart: 'w-chart',
} as const;

/** How far off a data grade can be: the card's words (FanApp GRADE_MEANS; model.grade_from_sd: the 95% range). */
export const GRADE_MEANS: Record<string, string> = {
  A: 'a census with stated error, within about 2–3×',
  B: 'a careful estimate, within about 10×',
  C: 'a rough figure, within about 100×',
  D: 'an illustrative model, could be off 1,000× or more',
};

/**
 * The species walked through: the northern quoll, from data/mammals (methods.test.tsx checks these against it).
 * Modelled (no census), its count Greenspoon's model and ours combined, and a range PHYLACINE says people cut.
 */
export const WALK = {
  sci: 'Dasyurus hallucatus',
  name: 'Northern quoll',
  /** Greenspoon et al. 2023's per-species model (their data release), and ours: density × range × share, moved by its Red List category. */
  greenspoon: 490_000,
  ours: 299_000,
  alive: 382_825,
  km2Now: 912_011,
  km2Nat: 2_488_857,
  nat: 1_042_317,
  natLo: 118_850,
  natHi: 9_141_132,
  genYears: 2.0,
  startMa: 8.18,
  ever: 8.51e12,
  everLo: 4.79e11,
  everHi: 1.51e14,
  grade: 'D',
  /** PHYLACINE 1.2.1 Spatial_metadata.csv, its "Motivation". */
  note: 'Disjunct range likely anthropogenic in cause.',
};

const c = (n: number) => formatCount(n);

/** A jump within the page (no hash: the address and back stay the page's). */
function Jump({ to, children }: { to: string; children: ReactNode }) {
  const go = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(to)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <a href={`#${to}`} onClick={go}>
      {children}
    </a>
  );
}

function Step({ id, n, title, children }: { id: string; n: number | string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="m-step">
      <h2>
        <span className="m-n">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The quoll's box in a step. */
function Quoll({ children }: { children: ReactNode }) {
  return (
    <div className="m-quoll">
      <div className="m-quoll-t">{WALK.name}</div>
      {children}
    </div>
  );
}

type Draw = Awaited<ReturnType<typeof loadGlobeCode>>;
const ZOOM = 1.8;

/** One globe of the two, drawn by the card's own globe code (globe-draw.ts), zoomed on the range. */
function MapCanvas({ m, d, sci }: { m: Draw; d: GlobeData; sci: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    const r = m.speciesRange(sci, d);
    const ctx = cv?.getContext('2d');
    if (!cv || !r || !ctx) return;
    const px = Math.round((cv.clientWidth || 160) * Math.min(2, window.devicePixelRatio || 1));
    cv.width = cv.height = px;
    // The natural range's centre for both, so the two match.
    const nat = m.speciesRange(WALK.sci) ?? r;
    const o = ((ZOOM - 1) * px) / 2;
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -o, -o);
    m.drawGlobe(ctx, d, r, px, [nat.centre[0], Math.max(-60, Math.min(60, nat.centre[1]))]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [m, d, sci]);
  return <canvas ref={ref} />;
}

/** Today's map and the map without people, side by side (PHYLACINE 1.2.1, from globe.json). */
function TwoMaps() {
  const [m, setM] = useState<Draw | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadGlobeCode().then(
      (x) => live && setM(x),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const d = m?.globeData() ?? null;
  const r = d?.ranges[WALK.sci];
  // Today alone: its current cells as both maps (nothing lost drawn).
  const today = d && r ? { ...d, ranges: { [WALK.sci]: [r[0], r[0]] as [number[], number[]] } } : null;
  return (
    <div className="m-maps" data-maps="">
      <figure>
        {m && today ? <MapCanvas m={m} d={today} sci={WALK.sci} /> : <div className="m-disc">{failed ? 'map not loaded' : ''}</div>}
        <figcaption>
          <b>Today</b>
          <span>{c(WALK.km2Now)} km²</span>
        </figcaption>
      </figure>
      <figure>
        {m && d ? <MapCanvas m={m} d={d} sci={WALK.sci} /> : <div className="m-disc" />}
        <figcaption>
          <b>Without people</b>
          <span>{c(WALK.km2Nat)} km²</span>
        </figcaption>
      </figure>
      <div className="m-key">
        <span>
          <i className="m-sw" style={{ background: '#3fd286' }} /> lives there today
        </span>
        <span>
          <i className="m-sw" style={{ background: '#8b938e' }} /> lost
        </span>
      </div>
    </div>
  );
}

/** A big sum: figures with their labels under them, joined by signs. */
function Sum({ parts }: { parts: (string | [string, string])[] }) {
  return (
    <div className="m-sum">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i} className="m-op">
            {p}
          </span>
        ) : (
          <span key={i} className="m-fig">
            <b>{p[0]}</b>
            <small>{p[1]}</small>
          </span>
        ),
      )}
    </div>
  );
}

/** The page itself (exported for the tests: no portal). */
export function MethodsView({ onClose, at }: { onClose: () => void; at?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (at) document.getElementById(at)?.scrollIntoView({ block: 'start' });
    else box.current?.scrollTo(0, 0);
  }, [at]);
  const steps: [string, string][] = [
    [METHOD_IDS.alive, 'Alive today'],
    [METHOD_IDS.past, 'In 1500'],
    [METHOD_IDS.histories, 'Histories'],
    [METHOD_IDS.ever, 'Ever lived'],
    [METHOD_IDS.descendants, 'Descendants'],
    [METHOD_IDS.grades, 'Grades'],
    [METHOD_IDS.fossils, 'Fossils'],
    [METHOD_IDS.unknown, 'Unknowns'],
  ];
  const ratio = WALK.km2Nat / WALK.km2Now;
  return (
    <div ref={box} className="app fan methods" role="dialog" aria-label="How we count">
      <div className="m-head">
        <div className="m-title">How we count</div>
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="m-body">
        <p className="m-lede">
          One species through every step: the <b>northern quoll</b>, a cat-sized marsupial hunter of northern Australia.
        </p>
        <nav className="m-steps">
          {steps.map(([id, t], i) => (
            <Jump key={id} to={id}>
              <span className="m-n">{i + 1}</span>
              {t}
            </Jump>
          ))}
        </nav>

        <Step id={METHOD_IDS.alive} n={1} title="Alive today">
          <ol className="m-ladder">
            <li>
              <b>Counted</b> <span className="dim">484 species</span>
              <br />A census: an IUCN population report (Greenspoon et al. 2023 collected them).
            </li>
            <li>
              <b>Two models, met in the middle</b> <span className="dim">4,381 species</span>
              <br />
              Greenspoon’s model of each species, and ours. Neither is a count, so we take their middle (the geometric mean).
              Over 10× apart: flagged (891).
            </li>
            <li>
              <b>Our model only</b> <span className="dim">the other ~2,100</span>
              <br />
              How many live per km² × the range’s km² × the share of its range it fills.
            </li>
          </ol>
          <p>
            <b>The share:</b> density is measured where an animal is common, and a range map is its outer edge, so density ×
            range counts far too many. We keep a share, typically <b>1–8%</b>, fitted per order (rodents, bats, …) and body size on
            the ~4,800 species that have a number (mostly Greenspoon’s model). For one species it can be off <b>10×</b> either way.
          </p>
          <Quoll>
            <Sum parts={[[c(WALK.greenspoon), 'Greenspoon’s model'], '&', [c(WALK.ours), 'ours'], '→', [c(WALK.alive), 'alive today']]} />
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.past} n={2} title="In 1500, and the change since">
          <p>
            PHYLACINE draws two maps of each species: where it lives <b>today</b>, and where it would live <b>without people</b>.
          </p>
          <TwoMaps />
          <Sum parts={[['today’s count', ''], '×', ['map without people', ''], '÷', ['map today', ''], '=', ['the level in 1500', '']]} />
          <p>From 1500 to today the tree draws a steady fall (or rise) between the two.</p>
          <p>
            <b>Only what people did counts.</b> When PHYLACINE’s own note says the maps differ for another reason (a name change, a
            map error, a placeholder where no range is known), no change is drawn. The Panamanian night monkey’s map without
            people leaves out Colombia only because that part now belongs to another species: that is not a loss, so its line
            stays flat.
          </p>
          <Quoll>
            <p className="m-note">PHYLACINE: “{WALK.note}” (people split its range)</p>
            <Sum parts={[[c(WALK.alive), 'today'], '×', [`${ratio.toFixed(1)}×`, 'range'], '=', [c(WALK.nat), 'in 1500']]} />
            <p className="dim">
              Could be {c(WALK.natLo)} – {c(WALK.natHi)}.
            </p>
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.histories} n={3} title="Histories">
          <p>
            For <b>62</b> well-known species (tiger, wolf, bison, …) the line is <b>real figures</b> from papers and agencies, each
            with its source, and named events (a crash, a bottleneck). They replace steps 1–2 for that species. Tap the card’s
            chart to see the sources.
          </p>
          <p>Some deep pasts come from genomes (Bergman et al. 2023): the curve’s shape, scaled to meet the counts.</p>
          <Quoll>
            <p>No history: its chart is the 1500 level, then the steady fall to today.</p>
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.ever} n={4} title="Births, generation, ever lived">
          <p>
            <b>Generation:</b> the average age of parents (Pacifici et al. 2013, via COMBINE; else from body size).
          </p>
          <p>
            Each animal is counted for <b>half a generation</b>, so:
          </p>
          <Sum parts={[['births a year', ''], '=', ['alive', ''], '÷', ['½ generation', '']]} />
          <Sum parts={[['ever lived', ''], '=', ['births a year', ''], '×', ['every year since the species began', '']]} />
          <p>Before 1500 the 1500 level is held, back to the species’ start in the dated tree.</p>
          <Quoll>
            <Sum parts={[[c(WALK.nat), 'alive before 1500'], '÷', [`${WALK.genYears / 2} yr`, '½ generation'], '×', [`${WALK.startMa} million yr`, 'since it began']]} />
            <Sum parts={['=', [c(WALK.ever), 'ever lived']]} />
            <p className="dim">
              Could be {c(WALK.everLo)} – {c(WALK.everHi)}.
            </p>
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.descendants} n={5} title="Descendants alive today">
          <div className="m-bar" aria-label="about 80% have descendants alive today">
            <span style={{ width: '80%' }}>80%</span>
          </div>
          <p>
            Of those alive at a past time, what share have descendants alive today? We count back one generation at a time in a
            family tree where every child has two parents picked at random from the generation before.
          </p>
          <p>
            A steady population: about <b>80%</b>. The rest left no line to today. A crash (a bottleneck) makes it smaller before
            it; a species that died out: 0%.
          </p>
          <Quoll>
            <p>A million years ago: about 80% (its number steady then).</p>
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.grades} n={6} title="Data grades">
          <p>Each number gets a letter for how far off it can be (its 95% range):</p>
          <ul className="m-grades" data-grades="">
            {['A', 'B', 'C', 'D'].map((g) => (
              <li key={g}>
                <span className="gdot" style={{ background: GRADE_COLOR[g] }} />
                <b>{g}</b> <span className="m-gw">{GRADE_WORD[g]}</span>
                <span className="dim"> {GRADE_MEANS[g]}</span>
              </li>
            ))}
          </ul>
          <p>Most species are D: no one has counted them.</p>
          <Quoll>
            <p>
              Grade <b>{WALK.grade}</b>: two models, no count.
            </p>
          </Quoll>
        </Step>

        <Step id={METHOD_IDS.fossils} n={7} title="Fossils and the deep past">
          <p>
            About 11,000 fossil species (Paleobiology Database) live from their first fossil to their last; their size and range
            are borrowed from relatives (grade D). Where no species is known, “ghost” lines fill in, so that all mammals together
            match a top-down total.
          </p>
        </Step>

        <Step id={METHOD_IDS.unknown} n={8} title="What we don’t know">
          <ul className="m-list">
            <li>Most species have never been counted: their numbers are models, often 10× off.</li>
            <li>The share of its range a species fills is the weakest step.</li>
            <li>Before 1500 the 1500 level is held flat for millions of years; real numbers rose and fell (ice ages, droughts).</li>
            <li>The maps are 1° squares (about 100 km): small ranges are rough.</li>
            <li>Many generation lengths are guessed from body size.</li>
            <li>“Ever lived” carries all of these: read it as a size (thousands? trillions?), not a figure.</li>
          </ul>
        </Step>

        <section id={METHOD_IDS.words} className="m-step">
          <h2>Words on the card</h2>
          <dl className="m-words">
            <dt id={WORD_IDS.alive}>alive today, alive … ago</dt>
            <dd>
              How many were alive at that moment. Today: <Jump to={METHOD_IDS.alive}>step 1</Jump>; the past:{' '}
              <Jump to={METHOD_IDS.past}>2</Jump>–<Jump to={METHOD_IDS.histories}>3</Jump>.
            </dd>
            <dt id={WORD_IDS.weighing}>Weighing</dt>
            <dd>Those alive × an adult’s body mass (PHYLACINE), when the tree is set to mass.</dd>
            <dt id={WORD_IDS.descendants}>have descendants alive today</dt>
            <dd>
              The share of them with a line to someone alive now: <Jump to={METHOD_IDS.descendants}>step 5</Jump>.
            </dd>
            <dt id={WORD_IDS.ever}>have ever lived, Ever lived</dt>
            <dd>
              Everyone ever born into the species, and its range (95%): <Jump to={METHOD_IDS.ever}>step 4</Jump>. “Rough estimate”: it
              carries every step’s error.
            </dd>
            <dt id={WORD_IDS.generation}>Generation</dt>
            <dd>The average age of parents, and its source in brackets: step 4.</dd>
            <dt id={WORD_IDS.grade}>Data grade</dt>
            <dd>
              A–D, how far off the number can be: <Jump to={METHOD_IDS.grades}>step 6</Jump>.
            </dd>
            <dt id={WORD_IDS.method}>Method</dt>
            <dd>
              “Modelled, not counted”: steps 1–4. Its “lifespan” is the half a generation each animal is counted for.
            </dd>
            <dt id={WORD_IDS.natural}>Natural level</dt>
            <dd>
              The level in 1500, from the map without people (“no human impact”), and the two maps’ areas:{' '}
              <Jump to={METHOD_IDS.past}>step 2</Jump>.
            </dd>
            <dt id={WORD_IDS.status}>Status</dt>
            <dd>The IUCN Red List category (Least Concern … Critically Endangered, Extinct) and its year. Not used in the count.</dd>
            <dt id={WORD_IDS.chart}>The chart</dt>
            <dd>
              The species’ number through time. Dot colours are grades:{' '}
              {['A', 'B', 'C', 'D'].map((g) => (
                <span key={g} className="m-chip">
                  <span className="gdot" style={{ background: GRADE_COLOR[g] }} /> {GRADE_WORD[g]}
                </span>
              ))}
              . Dashed: a reconstructed guess (from a genome, or our model). Faint “no data”: held flat where there are no figures.
              “Natural”: the 1500 level.
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

/** The page, over everything on the page (a portal into the body, above the tree, the card and the top bar). */
export function Methods(props: { onClose: () => void; at?: string }) {
  if (typeof document === 'undefined') return <MethodsView {...props} />;
  return createPortal(<MethodsView {...props} />, document.body);
}
