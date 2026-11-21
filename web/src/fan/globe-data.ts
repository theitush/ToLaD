// The card's globe data (ToLaD#267): every species' PHYLACINE 1.2.1 range cells (data/mammals/ranges.json, pipeline
// `make globe`) and the land (Natural Earth 1:110m, globe-land.json). Not in the page: vite.config.ts writes them as
// one sibling file (globe.json, next to index.html; /globe.json in dev), fetched the first time a card shows a map.
//
// The grid is PHYLACINE's: 360 columns of 1 degree from -180, 142 rows north to south between the latitudes in
// `grid.lat` (Behrmann equal-area). A species' cells are run-length coded over flat indices (row * 360 + col) as
// [gap, length, ...], each gap from the end of the run before: `ranges[sci] = [current, present_natural]`. A species
// PHYLACINE lacks under all its names borrows the range of the older species it was split from (ToLaD#486), named as a
// third element: `[current, present_natural, "Loxodonta africana"]`. A species' current cells are the map its count
// stands on (ToLaD#507: where PHYLACINE's note moves land between species or deletes bad records, the corrected one); an
// empty pair is a species PHYLACINE lists but draws no range for (no current map, its present-natural one a placeholder).
//
// The reptiles (ToLaD#601) are a sibling file of their own (globe-reptiles.json: data/amniotes/ranges.json, pipeline
// `make globe-amniotes`), fetched on the amniotes' page the first time a card's species has no range in globe.json, so
// a mammal's card never waits on them. Their cells are GARD 1.7's polygons on the same grid, and only today's: no map of
// where a reptile would live without people exists, so a reptile's range is one element, `[current]`, and nothing of it
// is drawn as lost.

import type { MultiPolygon } from 'geojson';

export interface GlobeData {
  grid: { rows: number; cols: number; lon0: number; lat: number[] };
  /** Natural Earth land: polygons of rings of flat [lon, lat, lon, lat, ...]. */
  land: number[][][];
  ranges: Record<string, GlobeRange>;
}

/**
 * One species' cells: `[current, present_natural]` (PHYLACINE), with the borrowed range's species third (ToLaD#486); or
 * `[current]`, today's range alone with no present-natural map (GARD 1.7's reptiles, ToLaD#601).
 */
export type GlobeRange = [number[]] | [number[], number[]] | [number[], number[], string];

/** The sibling file's name (vite.config.ts emits it; pages.yml stages it next to index.html). */
export const GLOBE_FILE = 'globe.json';
/** The reptiles' sibling file (ToLaD#601): `{ ranges }` alone, every range `[current]`, on globe.json's grid. */
export const REPTILES_FILE = 'globe-reptiles.json';

let data: GlobeData | null = null;
let pending: Promise<GlobeData> | null = null;

/** The loaded data, or null before loadGlobe() has resolved. */
export function globeData(): GlobeData | null {
  return data;
}

async function fetchGlobe(): Promise<GlobeData> {
  const r = await fetch(new URL(GLOBE_FILE, document.baseURI));
  if (!r.ok) throw new Error(`${GLOBE_FILE}: HTTP ${r.status}`);
  return (await r.json()) as GlobeData;
}

/** Load the globe data once (later calls share the first); `get` replaces the fetch (tests). */
export function loadGlobe(get: () => Promise<GlobeData> = fetchGlobe): Promise<GlobeData> {
  if (data) return Promise.resolve(data);
  pending ??= get().then(
    (d) => (data = reptiles ? { ...d, ranges: { ...reptiles, ...d.ranges } } : d),
    (e) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

type Ranges = GlobeData['ranges'];
let reptiles: Ranges | null = null;
let pendingReptiles: Promise<void> | null = null;

async function fetchReptiles(): Promise<{ ranges: Ranges }> {
  const r = await fetch(new URL(REPTILES_FILE, document.baseURI));
  if (!r.ok) throw new Error(`${REPTILES_FILE}: HTTP ${r.status}`);
  return (await r.json()) as { ranges: Ranges };
}

/** Whether the reptiles' cells are in (loadReptiles has resolved). */
export function reptilesIn(): boolean {
  return reptiles !== null;
}

/**
 * Load the reptiles' cells once (ToLaD#601; later calls share the first, a failure lets the next try again): once in,
 * globeData() is a new object holding them beside the mammals', so a card that had no range looks again. `get`
 * replaces the fetch (tests).
 */
export function loadReptiles(get: () => Promise<{ ranges: Ranges }> = fetchReptiles): Promise<void> {
  if (reptiles) return Promise.resolve();
  pendingReptiles ??= get().then(
    (f) => {
      reptiles = f.ranges;
      // (A name both had would stay the mammal's: globe.json's ranges are never changed.)
      if (data) data = { ...data, ranges: { ...reptiles, ...data.ranges } };
    },
    (e) => {
      pendingReptiles = null;
      throw e;
    },
  );
  return pendingReptiles;
}

/** Flat cell indices of a run list. */
export function unpackRuns(runs: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  for (let k = 0; k < runs.length; k += 2) {
    i += runs[k];
    for (let j = 0; j < runs[k + 1]; j++) out.push(i + j);
    i += runs[k + 1];
  }
  return out;
}

/** A species' range on the globe: where it lives now, and the present-natural range it has lost. */
export interface SpeciesRange {
  /** Current range cells. */
  cur: number;
  /** Present-natural cells outside the current range (the range lost); 0 with no present-natural map (`today`). */
  lost: number;
  curShape: MultiPolygon;
  lostShape: MultiPolygon;
  /** [lon, lat] to face: the centre of all its cells (current and natural). */
  centre: [number, number];
  /** A borrowed range (ToLaD#486): the older species it was split from, whose range this is. */
  from?: string;
  /** Today's range alone (ToLaD#601: GARD 1.7's reptiles): no map of where it would live without people, none drawn. */
  today?: true;
}

const STEP = 3; // degrees between vertices along a parallel (d3 joins vertices by great circles)
const MAX_RUN = 60; // a run is split into rectangles at most this wide (a full-row band is no ring)

/** Cells -> one rectangle per run of neighbours in a row, as d3 polygons (clockwise: d3's exterior). */
function shape(cells: Iterable<number>, g: GlobeData['grid']): MultiPolygon {
  const sorted = [...cells].sort((a, b) => a - b);
  const polys: number[][][][] = [];
  let k = 0;
  while (k < sorted.length) {
    const row = Math.floor(sorted[k] / g.cols);
    const c0 = sorted[k] % g.cols;
    let c1 = c0;
    while (k + 1 < sorted.length && sorted[k + 1] === sorted[k] + 1 && Math.floor(sorted[k + 1] / g.cols) === row && c1 - c0 + 1 < MAX_RUN) {
      k++;
      c1++;
    }
    k++;
    const w = g.lon0 + c0;
    const e = g.lon0 + c1 + 1;
    const n = g.lat[row];
    const s = g.lat[row + 1];
    const ring: number[][] = [];
    for (let x = w; x < e; x = Math.min(e, x + STEP)) ring.push([x, n]);
    ring.push([e, n]);
    for (let x = e; x > w; x = Math.max(w, x - STEP)) ring.push([x, s]);
    ring.push([w, s], [w, n]);
    polys.push([ring]);
  }
  return { type: 'MultiPolygon', coordinates: polys };
}

/** The species' range for the globe, or null when neither PHYLACINE nor GARD has a map of it (or the data is not loaded). */
export function speciesRange(sci: string, d: GlobeData | null = data): SpeciesRange | null {
  const r = d?.ranges[sci];
  if (!d || !r) return null;
  const cur = unpackRuns(r[0]);
  const curSet = new Set(cur);
  const nat = r.length === 1 ? [] : unpackRuns(r[1]);
  const lost = nat.filter((i) => !curSet.has(i));
  // The centre: the mean of the cells' unit vectors (equal-area cells, so a plain mean).
  let x = 0,
    y = 0,
    z = 0;
  const rad = Math.PI / 180;
  const all = new Set([...cur, ...nat]);
  for (const i of all) {
    const row = Math.floor(i / d.grid.cols);
    const lon = (d.grid.lon0 + (i % d.grid.cols) + 0.5) * rad;
    const lat = ((d.grid.lat[row] + d.grid.lat[row + 1]) / 2) * rad;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  const h = Math.hypot(x, y);
  // A range spread round the world (the whales: its cells' mean vector short) is faced from nearer the equator.
  const n = all.size;
  const spread = n ? Math.min(1, Math.hypot(x, y, z) / (0.4 * n)) : 1;
  const centre: [number, number] = h + Math.abs(z) < 1e-9 ? [0, 0] : [Math.atan2(y, x) / rad, (Math.atan2(z, h) / rad) * spread];
  const out: SpeciesRange = { cur: cur.length, lost: lost.length, curShape: shape(cur, d.grid), lostShape: shape(lost, d.grid), centre };
  if (r.length === 3) out.from = r[2];
  if (r.length === 1) out.today = true;
  return out;
}

/** The land as one d3 MultiPolygon. */
export function landShape(d: GlobeData): MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: d.land.map((p) =>
      p.map((ring) => {
        const out: number[][] = [];
        for (let j = 0; j < ring.length; j += 2) out.push([ring[j], ring[j + 1]]);
        return out;
      }),
    ),
  };
}
