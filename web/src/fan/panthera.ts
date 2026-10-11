// The cat family (Felidae) subtree of data/mammals, decoded at build time with the v1
// decoder (panthera-extract.ts, served by vite.config.ts as
// `virtual:panthera-data`): counts, ranges, grades, dates and the curated
// population histories (HIST, format v1.1) are the dataset's own values
// (EVER/ALIV are dequantized, so they are the numbers the river shows too).
// The species are listed here flat; the fan's topology and split dates are the
// curated dated tree of splits.ts (layout.ts), not the tiles' internal nodes,
// and only the species that tree places are kept (the tiles also hold
// subspecies and synonyms as rows, and fossil genera outside this view).
//
// Added here (not in the tiles): common names, and generation lengths for
// species without a curated history. Living species use the IUCN Red List
// assessment values (≈ Pacifici et al. 2013) for the big cats; the small cats
// and fossil species are derived from a typical adult body mass with
// GL ∝ mass^0.25, anchored on the lion (7 y at 160 kg).
// Species whose history drives their counts (`use = "counts"`) take the
// history's own generation length, which its segments are counted in.

import raw from 'virtual:panthera-data';
import { BirthCurve, procgenSegments, type GenSegment } from './history';
import { FELIDAE_TREE, speciesUnder } from './splits';
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
  'Acinonyx jubatus': { common: 'Cheetah', gen: glFromMass(50), src: mass(50) },
  'Neofelis nebulosa': { common: 'Clouded leopard', gen: glFromMass(18), src: mass(18) },
  'Neofelis diardi': { common: 'Sunda clouded leopard', gen: glFromMass(20), src: mass(20) },
  'Pardofelis marmorata': { common: 'Marbled cat', gen: glFromMass(3), src: mass(3) },
  'Catopuma badia': { common: 'Bay cat', gen: glFromMass(3), src: mass(3) },
  'Catopuma temminckii': { common: 'Asian golden cat', gen: glFromMass(12), src: mass(12) },
  'Leptailurus serval': { common: 'Serval', gen: glFromMass(12), src: mass(12) },
  'Caracal caracal': { common: 'Caracal', gen: glFromMass(13), src: mass(13) },
  'Profelis aurata': { common: 'African golden cat', gen: glFromMass(11), src: mass(11) },
  'Leopardus jacobita': { common: 'Andean mountain cat', gen: glFromMass(5.5), src: mass(5.5) },
  'Leopardus pardalis': { common: 'Ocelot', gen: glFromMass(11), src: mass(11) },
  'Leopardus wiedii': { common: 'Margay', gen: glFromMass(3.3), src: mass(3.3) },
  'Leopardus colocolo': { common: 'Pampas cat', gen: glFromMass(3.5), src: mass(3.5) },
  'Leopardus tigrinus': { common: 'Oncilla', gen: glFromMass(2.3), src: mass(2.3) },
  'Leopardus guttulus': { common: 'Southern tiger cat', gen: glFromMass(2), src: mass(2) },
  'Leopardus geoffroyi': { common: 'Geoffroy\'s cat', gen: glFromMass(4), src: mass(4) },
  'Leopardus guigna': { common: 'Kodkod', gen: glFromMass(2), src: mass(2) },
  'Lynx rufus': { common: 'Bobcat', gen: glFromMass(9), src: mass(9) },
  'Lynx pardinus': { common: 'Iberian lynx', gen: glFromMass(11), src: mass(11) },
  'Lynx lynx': { common: 'Eurasian lynx', gen: glFromMass(20), src: mass(20) },
  'Lynx canadensis': { common: 'Canada lynx', gen: glFromMass(10), src: mass(10) },
  'Puma concolor': { common: 'Cougar', gen: glFromMass(55), src: mass(55) },
  'Puma yagouaroundi': { common: 'Jaguarundi', gen: glFromMass(6), src: mass(6) },
  'Otocolobus manul': { common: 'Pallas\'s cat', gen: glFromMass(3.5), src: mass(3.5) },
  'Prionailurus rubiginosus': { common: 'Rusty-spotted cat', gen: glFromMass(1.3), src: mass(1.3) },
  'Prionailurus planiceps': { common: 'Flat-headed cat', gen: glFromMass(1.8), src: mass(1.8) },
  'Prionailurus bengalensis': { common: 'Leopard cat', gen: glFromMass(3), src: mass(3) },
  'Prionailurus viverrinus': { common: 'Fishing cat', gen: glFromMass(9), src: mass(9) },
  'Felis chaus': { common: 'Jungle cat', gen: glFromMass(8), src: mass(8) },
  'Felis nigripes': { common: 'Black-footed cat', gen: glFromMass(1.6), src: mass(1.6) },
  'Felis margarita': { common: 'Sand cat', gen: glFromMass(2.5), src: mass(2.5) },
  'Felis silvestris': { common: 'Wildcat', gen: glFromMass(5), src: mass(5) },
  'Felis catus': { common: 'Domestic cat', gen: glFromMass(4), src: mass(4) },
};

export function speciesRec(r: RawSpecies, clade: number): SpeciesRec {
  const x = EXTRA[r.sci] ?? { common: r.sci, gen: 7, src: 'assumed' };
  const h = r.history;
  const counts = !!h && h.use === 'counts' && h.segments.length > 0 && !r.extinct;
  const genYears = counts ? Math.round(h!.G * 1000) / 1000 : x.gen;
  let births: SpeciesRec['births'] = null;
  if (counts) {
    // (A domestic stock's segments cover its own span only; the leaf's EVER also holds its wild ancestors, so no rescale.)
    const segments = procgenSegments(h!, h!.component === 'domestic' ? undefined : r.ever);
    births = { segments, curve: new BirthCurve(segments, genYears), lifespan: h!.L };
  }
  // A domestic stock's own births since domestication (the model's segments), not the dataset's
  // total for the leaf, which also counts its wild ancestors back to the species' start.
  const own = births && h!.component === 'domestic' ? Math.round(births.curve.total) : null;
  return {
    gid: r.gid,
    sci: r.sci,
    common: h && 'common' in h ? String((h as { common?: string }).common ?? x.common) : x.common,
    ever: own ?? r.ever,
    everLo: own ?? r.everLo,
    everHi: own ?? r.everHi,
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

/** The species the dated tree places, in the tiles' order. */
const placed = new Set(speciesUnder(FELIDAE_TREE));
const kept = raw.species.filter((s) => placed.has(s.sci));
const cl = clades(kept, raw.gid);
const species = kept.map((s, i) => speciesRec(s, cl[i]));
const sum = (f: (s: SpeciesRec) => number) => species.reduce((a, s) => a + f(s), 0);

/** The family as the fan shows it: its totals are the sums over the species kept (the tiles' Felidae row also counts the fossil genera and synonym rows left out). */
export const FELIDAE: CladeRec = {
  gid: raw.gid,
  sci: raw.sci,
  common: 'Cats',
  ever: sum((s) => s.ever),
  everLo: sum((s) => s.everLo),
  everHi: sum((s) => s.everHi),
  alive: sum((s) => s.alive),
  grade: raw.grade,
  t0: raw.t0,
  t1: raw.t1,
  species,
};
