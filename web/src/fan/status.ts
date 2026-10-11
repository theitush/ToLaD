// Conservation status of the fan's living species: the IUCN Red List category
// of each one's current global assessment. It comes from the data (format v1.4
// RLST, ToLaD#48: the Red List 2026-1 via GBIF, else PHYLACINE 1.2's IUCN
// 2016-3 status, else NE), which every living species has. Fossil species get
// no IUCN category (the Red List's EX is for extinctions since 1500 CE); the
// card calls them prehistoric extinctions.
//
// RED_LIST below is the hand-curated status of the five living Panthera,
// checked 2026-10-10 against the assessments' own citations (authors, year,
// assessment id) as given in each species' Wikipedia infobox (the IUCN site
// refuses automated reads, HTTP 403). It overrides the data only where it is
// the newer assessment, and stands in when the data carries no status.

import type { SpeciesRec } from './panthera';

export type RedListCategory = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX' | 'DD' | 'NE';

export const CATEGORY_NAME: Record<RedListCategory, string> = {
  LC: 'Least Concern',
  NT: 'Near Threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically Endangered',
  EW: 'Extinct in the Wild',
  EX: 'Extinct',
  DD: 'Data Deficient',
  NE: 'Not Evaluated',
};

export interface RedListStatus {
  category: RedListCategory;
  /** Year the current assessment was published. */
  year: number;
  /** The assessment's citation, short. */
  cite: string;
  /** The assessment's page ('' when there is none, e.g. NE). */
  url: string;
  /** Where it came from: 'curated' (RED_LIST) or the data's source key ('iucn-2026-1', ...). */
  source?: string;
}

export const RED_LIST: Record<string, RedListStatus> = {
  'Panthera leo': {
    category: 'VU',
    year: 2024,
    cite: 'Nicholson et al. 2024 (amended 2023 assessment), e.T15951A259030422',
    url: 'https://www.iucnredlist.org/species/15951/259030422',
  },
  'Panthera tigris': {
    category: 'EN',
    year: 2022,
    cite: 'Goodrich et al. 2022, e.T15955A214862019',
    url: 'https://www.iucnredlist.org/species/15955/214862019',
  },
  'Panthera pardus': {
    category: 'VU',
    year: 2025,
    cite: 'Stein et al. 2025, e.T15954A286153337',
    url: 'https://www.iucnredlist.org/species/15954/286153337',
  },
  'Panthera onca': {
    category: 'NT',
    year: 2017,
    cite: 'Quigley et al. 2017 (errata 2018), e.T15953A123791436',
    url: 'https://www.iucnredlist.org/species/15953/123791436',
  },
  'Panthera uncia': {
    category: 'VU',
    year: 2017,
    cite: 'McCarthy et al. 2017, e.T22732A50664030',
    url: 'https://www.iucnredlist.org/species/22732/50664030',
  },
};

/** The card's status chip: a Red List category, prehistoric extinction, or none known. */
export type StatusChip = { kind: 'iucn'; label: string; code: RedListCategory; status: RedListStatus } | { kind: 'prehistoric'; label: string } | null;

/** The status the card shows: the data's, unless the curated entry is a newer assessment. */
export function redListOf(sp: SpeciesRec): RedListStatus | null {
  const d = sp.redList;
  const fromData: RedListStatus | null =
    d && d.category in CATEGORY_NAME ? { category: d.category as RedListCategory, year: d.year, cite: d.cite, url: d.url, source: d.source } : null;
  const cur = RED_LIST[sp.sci];
  if (cur && (!fromData || cur.year > fromData.year)) return { ...cur, source: 'curated' };
  return fromData;
}

export function statusOf(sp: SpeciesRec): StatusChip {
  const s = redListOf(sp);
  // a fossil has no Red List status; one that ended since 1500 CE keeps the list's EX/EW
  if (sp.extinct && !(s && (s.category === 'EX' || s.category === 'EW'))) return { kind: 'prehistoric', label: 'Extinct (prehistoric)' };
  return s ? { kind: 'iucn', label: CATEGORY_NAME[s.category], code: s.category, status: s } : null;
}
