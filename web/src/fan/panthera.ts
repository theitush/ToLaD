// The Panthera subtree of data/mammals, decoded at build time with the v1
// decoder (panthera-extract.ts, served by vite.config.ts as
// `virtual:panthera-data`): counts, ranges, grades, dates and the curated
// population histories (HIST, format v1.1) are the dataset's own values
// (EVER/ALIV are dequantized, so they are the numbers the river shows too).
// Internal nodes of the subtree are flattened: this slice shows Panthera as one
// polytomy, in the tree's left-to-right order so sisters stay adjacent.
//
// Added here (not in the tiles): common names, and generation lengths for
// species without a curated history. Living species use the IUCN Red List
// assessment values (≈ Pacifici et al. 2013); fossil species are derived from a
// body-mass estimate with GL ∝ mass^0.25, anchored on the lion (7 y at 160 kg).
// Species whose history drives their counts (`use = "counts"`) take the
// history's own generation length, which its segments are counted in.

import raw from 'virtual:panthera-data';
import { BirthCurve, procgenSegments, type GenSegment } from './history';
import type { Grade, HistoryRec, RawSpecies } from './panthera-extract';

export type { Grade, HistoryRec, HistPoint, HistSegment } from './panthera-extract';

export interface SpeciesRec {
  gid: number;
  sci: string;
  common: string;
  /** Individuals ever lived (central estimate) and its range. */
  ever: number;
  everLo: number;
  everHi: number;
  /** Individuals alive now. */
  alive: number;
  grade: Grade;
  /** First and last appearance, millions of years ago (t1 = 0: still alive). */
  t0: number;
  t1: number;
  extinct: boolean;
  dateSource: string;
  /** Generation length in years. */
  genYears: number;
  genSource: string;
  /** Sister group index, from the tree (species sharing it are sisters). */
  clade: number;
  /** Curated population history, if any (points with citations, compiled segments). */
  history: HistoryRec | null;
  /**
   * The births curve procgen and the layout follow when the history drives the
   * counts (`use = "counts"`): procgen segments and their integral. Null: births
   * are spread evenly over the species' span.
   */
  births: { segments: GenSegment[]; curve: BirthCurve; lifespan: number } | null;
}

export interface CladeRec {
  gid: number;
  sci: string;
  common: string;
  ever: number;
  everLo: number;
  everHi: number;
  alive: number;
  grade: Grade;
  t0: number;
  t1: number;
  species: SpeciesRec[];
}

const IUCN = 'IUCN generation length';
const mass = (kg: number) => `derived from ~${kg} kg body mass`;
const glFromMass = (kg: number) => Math.round(7 * Math.pow(kg / 160, 0.25) * 10) / 10;

/** Common names and generation lengths (years, source) by scientific name. */
const EXTRA: Record<string, { common: string; gen: number; src: string }> = {
  'Panthera tigris': { common: 'Tiger', gen: 7.7, src: IUCN },
  'Panthera uncia': { common: 'Snow leopard', gen: 8, src: IUCN },
  'Panthera pardus': { common: 'Leopard', gen: 7.3, src: IUCN },
  'Panthera leo': { common: 'Lion', gen: 7, src: IUCN },
  'Panthera onca': { common: 'Jaguar', gen: 7, src: IUCN },
  'Panthera spelaea': { common: 'Cave lion', gen: glFromMass(300), src: mass(300) },
  'Panthera balamoides': { common: 'Yucatán cave cat', gen: glFromMass(150), src: mass(150) },
  'Panthera zdanskyi': { common: 'Longdan tiger', gen: glFromMass(80), src: mass(80) },
  'Panthera gombaszoegensis': { common: 'European jaguar', gen: glFromMass(110), src: mass(110) },
};

export function speciesRec(r: RawSpecies, clade: number): SpeciesRec {
  const x = EXTRA[r.sci] ?? { common: r.sci, gen: 7, src: 'assumed' };
  const h = r.history;
  const counts = !!h && h.use === 'counts' && h.segments.length > 0 && !r.extinct;
  const genYears = counts ? Math.round(h!.G * 1000) / 1000 : x.gen;
  let births: SpeciesRec['births'] = null;
  if (counts) {
    const segments = procgenSegments(h!, r.ever);
    births = { segments, curve: new BirthCurve(segments, genYears), lifespan: h!.L };
  }
  return {
    gid: r.gid,
    sci: r.sci,
    common: h && 'common' in h ? String((h as { common?: string }).common ?? x.common) : x.common,
    ever: r.ever,
    everLo: r.everLo,
    everHi: r.everHi,
    alive: r.alive,
    grade: r.grade,
    t0: r.t0,
    t1: r.t1,
    extinct: r.extinct,
    dateSource: r.dateSource,
    genYears,
    genSource: counts ? 'curated history' : x.src,
    clade,
    history: h,
    births,
  };
}

/** Sister groups: species sharing a parent node; each child of the root on its own. */
function clades(species: RawSpecies[], rootGid: number): number[] {
  const ids = new Map<number, number>();
  let next = 0;
  return species.map((s) => {
    if (s.parentGid === rootGid) return next++;
    let c = ids.get(s.parentGid);
    if (c === undefined) ids.set(s.parentGid, (c = next++));
    return c;
  });
}

const cl = clades(raw.species, raw.gid);

export const PANTHERA: CladeRec = {
  gid: raw.gid,
  sci: raw.sci,
  common: 'Big cats',
  ever: raw.ever,
  everLo: raw.everLo,
  everHi: raw.everHi,
  alive: raw.alive,
  grade: raw.grade,
  t0: raw.t0,
  t1: raw.t1,
  species: raw.species.map((s, i) => speciesRec(s, cl[i])),
};
