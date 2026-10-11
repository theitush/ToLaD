// The fan's dated tree of splits, from the data (ToLaD#145): the pipeline's dated
// tree (pipeline/FORMAT.md, "Dated tree"; tolad_pipeline/dated.py) induced on the
// clade's species. Its topology and split dates are Upham et al. 2019's node-dated
// MCC tree, with every other dated species (fossils, living species Upham lacks)
// grafted on by a rule, and the few hand values in ONE table, pipeline/overrides.toml
// (Panthera's living five from Figueiró et al. 2017, the domestic cat at
// domestication, the placement of four Panthera fossils), each cited there. No split
// is typed here: pointing the fan at another clade needs no hand table.
//
// Each split is one date where a parent population divides into its daughters (a
// clean split: one date, a sharp Y; the gradual version is #50). Daughters are
// listed left to right; a daughter is a species (scientific name) or a nested split.
// A split may have more than two daughters (a polytomy: Upham dates them as one
// event, or fossils join it by taxonomy only).

import raw from 'virtual:panthera-data';
import type { DatedSplit } from './panthera-extract';

export type Confidence = 'high' | 'medium' | 'low';

export interface Split {
  /** Short name for the lineage below the split (the card's title). */
  name: string;
  /** Date of the split, Ma, and its range. */
  ageMa: number;
  lo: number;
  hi: number;
  cite: string;
  confidence: Confidence;
  /** Where the date comes from (DatedSplit.source): an interpolated or fossil date is not as solid as Upham's. */
  source?: string;
  note?: string;
  /** Daughters, left to right: species (scientific names) or splits. */
  kids: (string | Split)[];
}

/** The species under a dated split, left to right. */
function datedSpecies(t: DatedSplit): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : datedSpecies(k)));
}

/** Four significant digits (a domestication date is 0.0095 Ma). */
const r3 = (x: number) => Number(x.toPrecision(4));

/**
 * A dated split as the fan's Split. `common` names a species (its English name, or
 * null); `upham` is the Upham citation, `extinct` tells fossils apart.
 */
export function splitFrom(t: DatedSplit, common: (sci: string) => string | null, extinct: (sci: string) => boolean, upham: string): Split {
  const sp = datedSpecies(t);
  const label = (s: string) => common(s) ?? s;
  const living = sp.filter((s) => !extinct(s));
  const named = (living.length ? living : sp).map(label);
  const daughters = t.kids.map((k) => (typeof k === 'string' ? label(k) : `the ${k.name || 'lineage'} of ${datedSpecies(k).length} species`));
  // a title from the data: two or three species by name, else the clade's name, else its first two living species
  const name =
    sp.length <= 3
      ? `${sp.map(label).join(' + ')} ancestors`
      : t.name
        ? `${t.name} ancestors`
        : `${named.slice(0, 2).join(', ')} + ${sp.length - 2} more: ancestors`;
  let cite: string;
  let confidence: Confidence;
  const notes: string[] = [];
  switch (t.source) {
    case 'override':
      cite = t.override ? t.override.cite : 'pipeline/overrides.toml';
      confidence = 'medium';
      if (t.override) notes.push(t.override.reason);
      break;
    case 'upham':
      cite = upham;
      confidence = 'medium';
      break;
    case 'upham-imputed':
      cite = `${upham}. A daughter here was placed with no genetic data (imputed under taxonomic constraints), so the date is weak`;
      confidence = 'low';
      break;
    case 'fossil':
      cite = 'Fossil record (Paleobiology Database first appearance, or the fossils\' own range): a fossil lineage branches off at its first appearance, by rule, not a dated split';
      confidence = 'low';
      break;
    default:
      cite = 'No dated node: an Open Tree node, its age interpolated between the dated splits around it';
      confidence = 'low';
  }
  if (t.loose > 0)
    notes.push(`${t.loose} ${t.loose === 1 ? 'daughter here is a fossil lineage' : 'daughters here are fossil lineages'} placed in this clade by taxonomy only: where ${t.loose === 1 ? 'it branches' : 'they branch'} off inside it is not known`);
  if (t.kids.length > 2) notes.push(`${t.kids.length} daughters part at one date: ${daughters.join('; ')}`);
  return {
    name,
    ageMa: r3(t.age),
    lo: r3(Math.min(t.lo, t.age)),
    hi: r3(Math.max(t.hi, t.age)),
    cite,
    confidence,
    source: t.source,
    ...(notes.length ? { note: notes.join('. ') } : {}),
    kids: t.kids.map((k) => (typeof k === 'string' ? k : splitFrom(k, common, extinct, upham))),
  };
}

const bySci = new Map(raw.species.map((s) => [s.sci, s]));
if (!raw.dated) throw new Error('data/mammals has no dated tree (format 1.6): rebuild it with `make -C pipeline build`');

/** The cat family's dated tree, from the data. */
export const FELIDAE_TREE: Split = splitFrom(
  raw.dated,
  (s) => bySci.get(s)?.common ?? null,
  (s) => !!bySci.get(s)?.extinct,
  raw.datedMeta?.upham ?? 'Upham et al. 2019',
);

/** Every split in the tree, parents before their daughters. */
export function allSplits(t: Split = FELIDAE_TREE): Split[] {
  const out: Split[] = [t];
  for (const k of t.kids) if (typeof k !== 'string') out.push(...allSplits(k));
  return out;
}

/** The species under a split, left to right. */
export function speciesUnder(t: Split): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : speciesUnder(k)));
}
