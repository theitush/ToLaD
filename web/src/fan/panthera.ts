// The cat family (Felidae) subtree of data/mammals, decoded at build time with the v1
// decoder (panthera-extract.ts, served by vite.config.ts as
// `virtual:panthera-data`): counts, ranges, grades, dates and the curated
// population histories (HIST, format v1.1) are the dataset's own values
// (EVER/ALIV are dequantized, so they are the numbers the river shows too).
// The species are listed here flat; the fan's topology and split dates are the
// dataset's dated tree (splits.ts, format 1.6), and only the species it places
// are kept (the tiles also hold subspecies and synonyms as rows, ToLaD#116).
//
// Per species, from the data too (ToLaD#145): the English common name (IUCN Red
// List 2026-1's preferred English name; a few fossils' from pipeline/overrides.toml)
// and the generation length the model uses (COMBINE, Soria et al. 2021, reported or
// imputed; else the model's body-mass fit, for fossils). Species whose history
// drives their counts (`use = "counts"`) take the history's own generation length,
// which its segments are counted in.

import raw from 'virtual:panthera-data';
import carnivora from 'virtual:carnivora-data';
import { BirthCurve, procgenSegments, type GenSegment } from './history';
import { CARNIVORA_TREE, FELIDAE_TREE, sentenceCase, speciesUnder, type Split } from './splits';

export { sentenceCase };
import type { Grade, HistoryRec, NaturalMeta, NaturalRec, RawClade, RawSpecies, RedListRec } from './panthera-extract';

export type { Grade, HistEvent, HistoryRec, HistPoint, HistSegment, NaturalMeta, NaturalRec } from './panthera-extract';

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
  /** IUCN Red List status from the data (ToLaD#48); null for fossils. status.ts reads it. */
  redList?: RedListRec | null;
  /** The natural (pre-human) baseline from the data (format v1.2), always modelled; null if none. */
  natural?: NaturalRec | null;
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

export function speciesRec(r: RawSpecies, clade: number): SpeciesRec {
  // generation length: the model's (COMBINE, else its mass fit); a curated history's own wins below
  const x = { common: r.common ? sentenceCase(r.common) : r.sci, gen: r.gen?.years ?? 7, src: r.gen?.how ?? 'assumed' };
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
    redList: r.redList ?? null,
    natural: r.natural ?? null,
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

/** What every natural baseline is: label, grade, citation (skeleton META.natural). */
export const NATURAL_META: NaturalMeta | null = raw.naturalMeta ?? null;

/**
 * A clade as the fan shows it: the species its dated tree places, in the tiles' order; its totals are the sums over
 * them (the tiles' row also counts the fossil genera and synonym rows left out).
 */
export function cladeOf(r: RawClade, tree: Split, common: string): CladeRec {
  const placed = new Set(speciesUnder(tree));
  const kept = r.species.filter((s) => placed.has(s.sci));
  const cl = clades(kept, r.gid);
  const species = kept.map((s, i) => speciesRec(s, cl[i]));
  const sum = (f: (s: SpeciesRec) => number) => species.reduce((a, s) => a + f(s), 0);
  return {
    gid: r.gid,
    sci: r.sci,
    common,
    ever: sum((s) => s.ever),
    everLo: sum((s) => s.everLo),
    everHi: sum((s) => s.everHi),
    alive: sum((s) => s.alive),
    grade: r.grade,
    t0: r.t0,
    t1: r.t1,
    species,
  };
}

/** The cat family. */
export const FELIDAE: CladeRec = cladeOf(raw, FELIDAE_TREE, 'Cats');

/** The order the cats sit in (ToLaD#146): 284 living species and the dated fossils. */
export const CARNIVORA: CladeRec = cladeOf(carnivora, CARNIVORA_TREE, 'Carnivores');

