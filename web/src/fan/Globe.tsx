// The species card's range globe (ToLaD#267): one orthographic globe, the same for every species, drawn on a 2D
// canvas with d3-geo. Dark ocean, Natural Earth land, the current range green and the present-natural range the
// species has lost grey (PHYLACINE 1.2.1), turned to face the range's centre. Drag spins it (no auto-spin); a tap
// enlarges it across the card like the photo. A species PHYLACINE has no map of gets the Wikimedia map (ToLaD#196).

import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import type { MultiPolygon } from 'geojson';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { globeData, landShape, loadGlobe, speciesRange, type GlobeData, type SpeciesRange } from './globe-data';

export const GLOBE_COLORS = {
  ocean: '#0b1a24',
  rim: 'rgba(160, 200, 220, 0.28)',
  graticule: 'rgba(150, 190, 210, 0.07)',
  land: '#34413b',
  coast: 'rgba(190, 210, 200, 0.22)',
  lost: '#8b938e',
  cur: '#3fd286',
};

let land: { d: GlobeData; shape: MultiPolygon } | null = null;
function landOf(d: GlobeData): MultiPolygon {
  if (land?.d !== d) land = { d, shape: landShape(d) };
  return land.shape;
}

/**
 * Draws the globe of `r` on `ctx`, `size` px square, the globe's centre turned to [lon, lat] = `rot`.
 * Exported for the tests (a recording context counts what is filled).
 */
export function drawGlobe(ctx: CanvasRenderingContext2D, d: GlobeData, r: SpeciesRange, size: number, rot: [number, number]): void {
  const proj = geoOrthographic()
    .scale(size / 2 - 1)
    .translate([size / 2, size / 2])
    .rotate([-rot[0], -rot[1]])
    .precision(0.5);
  const path = geoPath(proj, ctx);
  const fill = (o: GeoPermissibleObjects, color: string) => {
    ctx.beginPath();
    path(o);
    ctx.fillStyle = color;
    ctx.fill();
  };
  ctx.clearRect(0, 0, size, size);
  fill({ type: 'Sphere' }, GLOBE_COLORS.ocean);
  ctx.beginPath();
  path(geoGraticule10());
  ctx.strokeStyle = GLOBE_COLORS.graticule;
  ctx.lineWidth = 1;
  ctx.stroke();
  const ls = landOf(d);
  fill(ls, GLOBE_COLORS.land);
  if (r.lost) fill(r.lostShape, GLOBE_COLORS.lost);
  if (r.cur) fill(r.curShape, GLOBE_COLORS.cur);
  ctx.beginPath();
  path(ls);
  ctx.strokeStyle = GLOBE_COLORS.coast;
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.beginPath();
  path({ type: 'Sphere' });
  ctx.strokeStyle = GLOBE_COLORS.rim;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** The globe canvas for a species PHYLACINE maps. */
function GlobeCanvas({ d, r, big, onTap }: { d: GlobeData; r: SpeciesRange; big: boolean; onTap: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rot = useRef<[number, number]>([r.centre[0], Math.max(-60, Math.min(60, r.centre[1]))]);
  const frame = useRef(0);
  const draw = () => {
    frame.current = 0;
    const c = ref.current;
    if (!c) return;
    const css = c.clientWidth || 120;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (c.width !== px) c.width = c.height = px;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawGlobe(ctx, d, r, px, rot.current);
  };
  const ask = () => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  };
  useLayoutEffect(draw, [d, r, big]);
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
        // A drag across the globe turns it half way round.
        const k = 180 / (ref.current?.clientWidth || 120);
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
 * The species' range in the card: the globe once globe.json is in and PHYLACINE maps it; a dark disc while it
 * loads; the Wikimedia map (`fallback`) when PHYLACINE has no map or the file cannot load.
 */
export function RangeGlobe({ sci, fallback }: { sci: string; fallback: React.ReactNode }) {
  const [d, setD] = useState<GlobeData | null | 'failed'>(globeData);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (d) return;
    let live = true;
    loadGlobe().then(
      (g) => live && setD(g),
      () => live && setD('failed'),
    );
    return () => {
      live = false;
    };
  }, [d]);
  const r = useRangeOf(sci, d === 'failed' ? null : d);
  if (d === 'failed' || (d && !r)) return <>{fallback}</>;
  return (
    <figure className={`globe${d ? '' : ' loading'}${big ? ' big' : ''}`}>
      {d && r ? <GlobeCanvas key={sci} d={d} r={r} big={big} onTap={() => setBig((b) => !b)} /> : <div className="disc" />}
      {d && r && (
        <a href="https://doi.org/10.1002/ecy.2443" target="_blank" rel="noopener">
          Range · PHYLACINE 1.2
        </a>
      )}
    </figure>
  );
}

function useRangeOf(sci: string, d: GlobeData | null): SpeciesRange | null {
  const memo = useRef<{ sci: string; d: GlobeData; r: SpeciesRange | null } | null>(null);
  if (!d) return null;
  if (memo.current?.sci !== sci || memo.current.d !== d) memo.current = { sci, d, r: speciesRange(sci, d) };
  return memo.current.r;
}
