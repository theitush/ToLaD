// Conservation status of the fan's living species: the IUCN Red List category
// of each one's current global assessment, curated by hand (keyed by
// scientific name). Fossil species get no IUCN category (the Red List's EX is
// for extinctions since 1500 CE); the card calls them prehistoric extinctions.
//
// Checked 2026-10-10 against the assessments' own citations (authors, year,
// assessment id) as given in each species' Wikipedia infobox; the IUCN site
// itself refused automated reads (HTTP 403), so the ids below are the ones to
// open by hand. Pipeline-wide status is ToLaD#48.

import type { SpeciesRec } from './panthera';

export type RedListCategory = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX' | 'DD';

export const CATEGORY_NAME: Record<RedListCategory, string> = {
  LC: 'Least Concern',
  NT: 'Near Threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically Endangered',
  EW: 'Extinct in the Wild',
  EX: 'Extinct',
  DD: 'Data Deficient',
};

export interface RedListStatus {
  category: RedListCategory;
  /** Year the current assessment was published. */
  year: number;
  /** The assessment's citation, short. */
  cite: string;
  url: string;
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

export function statusOf(sp: SpeciesRec): StatusChip {
  if (sp.extinct) return { kind: 'prehistoric', label: 'Extinct (prehistoric)' };
  const s = RED_LIST[sp.sci];
  return s ? { kind: 'iucn', label: CATEGORY_NAME[s.category], code: s.category, status: s } : null;
}
