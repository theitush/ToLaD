// The species card's range globe (ToLaD#267): one orthographic globe, the same for every species, drawn on a 2D
// canvas with d3-geo (globe-draw.ts). Dark ocean, Natural Earth land, the current range green and the present-natural
// range the species has lost grey (PHYLACINE 1.2.1), turned to face the range's centre. Drag spins it (no auto-spin);
// a tap shows it alone, full screen, still turned by a drag (ToLaD#506, Alone.tsx), like the photo. A species split since PHYLACINE draws the range of the species it
// was split from, the same way, its credit saying so (ToLaD#486). A species PHYLACINE has no map of gets the Wikimedia map
// (ToLaD#196), and so does every card when the drawing code or globe.json cannot load (the artifact link, no network).
// With neither, or the map failing, the globe bare, captioned 'Range not known' (ToLaD#492), and so for a species PHYLACINE
// lists with no cells to draw (ToLaD#507: its present-natural map a placeholder). A reptile (ToLaD#601, the amniotes' page)
// draws GARD 1.7's map of where it lives today, green alone: no map of its range without people exists, so nothing is
// grey. Its cells are a file of their own (globe-reptiles.json), fetched the first time a card's species has none in
// globe.json, so a mammal's card never waits on them.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GlobeData, SpeciesRange } from './globe-data';
import { Alone, useAlone } from './Alone';
import { treeName, type TreeName } from './mammals-data';

// The drawing and the data (globe-draw.ts with d3-geo, ~25 kB; globe.json) load when a card first shows a range.
type Draw = typeof import('./globe-draw');
let draw: Draw | null = null;
let pendingDraw: Promise<Draw> | null = null;

/** The drawing code and globe.json, once (later calls share the first; after a failure the next card tries again). */
export function loadGlobeCode(): Promise<Draw> {
  if (draw) return Promise.resolve(draw);
  pendingDraw ??= import('./globe-draw')
    .then(async (m) => {
      await m.loadGlobe();
      return (draw = m);
    })
    .catch((e) => {
      pendingDraw = null;
      throw e;
    });
  return pendingDraw;
}

/** No range: nothing drawn on the land, faced the same for every species (ToLaD#492). */
const NO_RANGE: SpeciesRange = {
  cur: 0,
  lost: 0,
  curShape: { type: 'MultiPolygon', coordinates: [] },
  lostShape: { type: 'MultiPolygon', coordinates: [] },
  centre: [20, 10],
};

type Rot = [number, number];

/**
 * The globe canvas for a species PHYLACINE maps (or NO_RANGE, for one nothing maps), facing `start` if given (the card's
 * globe as turned, for the one alone), else the range's centre; `onTurn` told each turn. Drawn at its laid-out size,
 * again when the window's changes (the one alone fills the screen).
 */
function GlobeCanvas({ m, d, r, onTap, start, onTurn }: { m: Draw; d: GlobeData; r: SpeciesRange; onTap: () => void; start?: Rot | null; onTurn?: (rot: Rot) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rot = useRef<Rot>(start ? [start[0], start[1]] : [r.centre[0], Math.max(-60, Math.min(60, r.centre[1]))]);
  const frame = useRef(0);
  const paint = () => {
    frame.current = 0;
    const c = ref.current;
    if (!c) return;
    const css = c.clientWidth || 120;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (c.width !== px) c.width = c.height = px;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    m.drawGlobe(ctx, d, r, px, rot.current);
  };
  const ask = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  useLayoutEffect(paint, [m, d, r]);
  useEffect(() => {
    window.addEventListener('resize', ask);
    return () => {
      window.removeEventListener('resize', ask);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  return (
    <canvas
      ref={ref}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const g = drag.current;
        if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        g.x = e.clientX;
        g.y = e.clientY;
        g.moved += Math.abs(dx) + Math.abs(dy);
        // A drag across the globe turns it a third of the way round.
        const k = 120 / (ref.current?.clientWidth || 120);
        rot.current = [rot.current[0] - dx * k, Math.max(-90, Math.min(90, rot.current[1] + dy * k))];
        onTurn?.(rot.current);
        ask();
      }}
      onPointerUp={(e) => {
        const g = drag.current;
        drag.current = null;
        if (g && g.id === e.pointerId && g.moved < 6) onTap();
      }}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}

/**
 * The species' range in the card: the globe once its code and globe.json are in and PHYLACINE maps the species; a
 * dark disc with a spinner while they load, its credit line held hidden (ToLaD#479: the globe's loaded box, which the
 * Wikimedia map's box matches); `fallback` (the Wikimedia map) when PHYLACINE has no map or they cannot load, given
 * what to show if it fails; with no fallback, that: the bare globe saying the range is not known (ToLaD#492), in the same
 * box, so the card moves nothing from open to loaded and every card has a range box.
 */
export function RangeGlobe({ sci, fallback, tree = treeName }: { sci: string; fallback?: (none: ReactNode) => ReactNode; tree?: TreeName }) {
  const [m, setM] = useState<Draw | null | 'failed'>(draw);
  const [alone, show, close] = useAlone();
  // The reptiles' cells (ToLaD#601), asked for on the amniotes' page when globe.json has no range for the species.
  const [more, setMore] = useState<'in' | 'failed' | null>(null);
  // (The card's globe as turned: the one alone starts there.)
  const turned = useRef<Rot | null>(null);
  useEffect(() => {
    if (m) return;
    let live = true;
    loadGlobeCode().then(
      (x) => live && setM(x),
      () => live && setM('failed'),
    );
    return () => {
      live = false;
    };
  }, [m]);
  const ok = m && m !== 'failed' ? m : null;
  const d = ok?.globeData() ?? null;
  const r = useRangeOf(sci, ok, d);
  const asking = !!ok && !!d && !r && tree === 'amniotes' && !ok.reptilesIn() && more !== 'failed';
  useEffect(() => {
    if (!asking || !ok) return;
    let live = true;
    ok.loadReptiles().then(
      () => live && setMore('in'),
      () => live && setMore('failed'),
    );
    return () => {
      live = false;
    };
  }, [asking, ok]);
  // PHYLACINE lists the species but draws no range for it: no current map, and a present-natural map that is a
  // placeholder, not a range (ToLaD#507). Not known, whatever map Wikimedia has (Oryzomys curasoae's is the genus's).
  if (ok && r && !r.cur && !r.lost) return <NoRange m={ok} d={d} />;
  if (m === 'failed' || (ok && !r && !asking)) {
    const none = <NoRange m={ok} d={d} />;
    return <>{fallback ? fallback(none) : none}</>;
  }
  const credit = r?.today ? (
    // GARD 1.7 (Roll et al. 2017, Caetano et al. 2022): where it lives today, nothing drawn lost.
    <a href="https://doi.org/10.1038/s41559-017-0332-2" target="_blank" rel="noopener">
      Range today · GARD{'\u00a0'}1.7
    </a>
  ) : (
    <a href="https://doi.org/10.1002/ecy.2443" target="_blank" rel="noopener">
      {r?.from ? (
        <>
          Range of <i>{r.from}</i> before the split · PHYLACINE{'\u00a0'}1.2
        </>
      ) : (
        'Range · PHYLACINE 1.2'
      )}
    </a>
  );
  return (
    <figure className={`globe${ok && r ? '' : ' loading'}`}>
      {ok && d && r ? <GlobeCanvas key={sci} m={ok} d={d} r={r} onTap={show} onTurn={(x) => (turned.current = x)} /> : <div className="disc" />}
      {credit}
      {alone && ok && d && r && (
        <Alone credit={credit} onClose={close}>
          {/* (A tap here is the view's to close it, Alone.tsx: the canvas's own tap does nothing.) */}
          <GlobeCanvas m={ok} d={d} r={r} onTap={() => {}} start={turned.current} />
        </Alone>
      )}
    </figure>
  );
}

/** The bare globe, or (its code or data not loaded) its dark disc, captioned in the credit's line. */
function NoRange({ m, d }: { m: Draw | null; d: GlobeData | null }) {
  return (
    <figure className="globe none">
      {m && d ? <GlobeCanvas m={m} d={d} r={NO_RANGE} onTap={() => {}} /> : <div className="disc" />}
      <span className="cap">Range not known</span>
    </figure>
  );
}

function useRangeOf(sci: string, m: Draw | null, d: GlobeData | null): SpeciesRange | null {
  const memo = useRef<{ sci: string; d: GlobeData; r: SpeciesRange | null } | null>(null);
  if (!m || !d) return null;
  if (memo.current?.sci !== sci || memo.current.d !== d) memo.current = { sci, d, r: m.speciesRange(sci, d) };
  return memo.current.r;
}
