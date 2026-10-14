// The species card's range globe (ToLaD#267): one orthographic globe, the same for every species, drawn on a 2D
// canvas with d3-geo (globe-draw.ts). Dark ocean, Natural Earth land, the current range green and the present-natural
// range the species has lost grey (PHYLACINE 1.2.1), turned to face the range's centre. Drag spins it (no auto-spin);
// a tap enlarges it across the card like the photo. A species PHYLACINE has no map of gets the Wikimedia map
// (ToLaD#196), and so does every card when the drawing code or globe.json cannot load (the artifact link, no network).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GlobeData, SpeciesRange } from './globe-data';

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

/** The globe canvas for a species PHYLACINE maps. */
function GlobeCanvas({ m, d, r, big, onTap }: { m: Draw; d: GlobeData; r: SpeciesRange; big: boolean; onTap: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rot = useRef<[number, number]>([r.centre[0], Math.max(-60, Math.min(60, r.centre[1]))]);
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
  useLayoutEffect(paint, [m, d, r, big]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
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
 * dark disc while they load; `fallback` (the Wikimedia map) when PHYLACINE has no map or they cannot load.
 */
export function RangeGlobe({ sci, fallback }: { sci: string; fallback: ReactNode }) {
  const [m, setM] = useState<Draw | null | 'failed'>(draw);
  const [big, setBig] = useState(false);
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
  if (m === 'failed' || (ok && !r)) return <>{fallback}</>;
  return (
    <figure className={`globe${ok ? '' : ' loading'}${big ? ' big' : ''}`}>
      {ok && d && r ? <GlobeCanvas key={sci} m={ok} d={d} r={r} big={big} onTap={() => setBig((b) => !b)} /> : <div className="disc" />}
      {ok && r && (
        <a href="https://doi.org/10.1002/ecy.2443" target="_blank" rel="noopener">
          Range · PHYLACINE 1.2
        </a>
      )}
    </figure>
  );
}

function useRangeOf(sci: string, m: Draw | null, d: GlobeData | null): SpeciesRange | null {
  const memo = useRef<{ sci: string; d: GlobeData; r: SpeciesRange | null } | null>(null);
  if (!m || !d) return null;
  if (memo.current?.sci !== sci || memo.current.d !== d) memo.current = { sci, d, r: m.speciesRange(sci, d) };
  return memo.current.r;
}
