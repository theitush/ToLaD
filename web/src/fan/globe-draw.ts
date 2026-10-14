// The range globe's drawing (ToLaD#267), d3-geo on a 2D canvas, with the data it draws (globe-data.ts). Its own
// chunk (globe-draw.js beside the page, like globe.json), imported by Globe.tsx when a card first shows a range, so the
// default page carries none of it. It imports nothing the page has (no React), so the chunk stands alone.

import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import type { MultiPolygon } from 'geojson';
import { landShape, type GlobeData, type SpeciesRange } from './globe-data';

export { globeData, loadGlobe, speciesRange } from './globe-data';

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
