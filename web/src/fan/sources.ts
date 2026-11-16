// Every source the page's data comes from (ToLaD#429), one line each: a new source is a new line. Shown by SourcesPanel.
// What each one's files are and how they are pinned: pipeline/SOURCES.md.

export interface Source {
  /** The source's name. */
  name: string;
  /** Its authors or owner, where they are not the name. */
  by?: string;
  /** Its year or version. */
  when?: string;
  /** What we use it for, in a few words. */
  use: string;
  url: string;
}

const REPO = 'https://github.com/theitush/ToLaD/blob/main';

export const SOURCES: readonly Source[] = [
  { name: 'Open Tree of Life', when: 'synthesis v16.1, 2025', use: 'tree shape, taxon names', url: 'https://tree.opentreeoflife.org/about/synthesis-release' },
  { name: 'Open Tree Taxonomy', when: 'v3.7.3', use: 'ranks, extinct flags, synonyms', url: 'https://files.opentreeoflife.org/ott/ott3.7.3/' },
  { name: 'MamPhy', by: 'Upham, Esselstyn & Jetz', when: '2019', use: 'the dated mammal tree', url: 'https://doi.org/10.1371/journal.pbio.3000494' },
  { name: 'Mammal timetree', by: 'Álvarez-Carretero et al.', when: '2022', use: 'split dates', url: 'https://doi.org/10.1038/s41586-021-04341-1' },
  { name: 'Mammal Diversity Database', by: 'American Society of Mammalogists', when: 'v2.5, 2026', use: 'the current species list', url: 'https://doi.org/10.5281/zenodo.21654811' },
  { name: 'Paleobiology Database', when: 'read 2026-10-09', use: 'fossil species, their dates', url: 'https://paleobiodb.org/' },
  { name: 'PHYLACINE', by: 'Faurby et al.', when: 'v1.2.1, 2018', use: 'body mass, range maps', url: 'https://doi.org/10.1002/ecy.2443' },
  { name: 'PanTHERIA', by: 'Jones et al.', when: 'v1.0, 2009', use: 'density, range area', url: 'https://doi.org/10.1890/08-1494.1' },
  { name: 'COMBINE', by: 'Soria et al.', when: 'figshare v4, 2021', use: 'generation length, density', url: 'https://doi.org/10.1002/ecy.3344' },
  { name: 'Generation lengths', by: 'Pacifici et al.', when: '2013', use: 'read through COMBINE', url: 'https://doi.org/10.5061/dryad.gd0m3' },
  { name: 'IUCN Red List', by: 'IUCN, through GBIF', when: 'v2026-1', use: 'status, English names', url: 'https://doi.org/10.15468/0qnb58' },
  { name: 'Red List Criteria', by: 'IUCN', when: 'v3.1, 2012', use: 'a ceiling for the rarest', url: 'https://portals.iucn.org/library/node/10315' },
  { name: 'Mammal biomass', by: 'Greenspoon et al.', when: '2023', use: 'wild counts, pets', url: 'https://doi.org/10.1073/pnas.2204892120' },
  { name: 'Scaling laws', by: 'Damuth; Brook & Bowman; Hatton et al.', when: '1981, 2005, 2019', use: 'density, generation by mass', url: `${REPO}/research/02-population-estimates.md` },
  { name: 'Megafauna genomes', by: 'Bergman et al.', when: '2023', use: 'deep-past population curves', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10667484/' },
  { name: 'Germline mutation rates', by: 'Bergeron et al.', when: '2023', use: 'scaling those curves', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9995274/' },
  { name: 'Big cat mutation rates', by: 'Armstrong et al.', when: '2025', use: 'scaling those curves', url: 'https://doi.org/10.1093/gbe/evaf060' },
  { name: 'Effective population size', by: 'Frankham', when: '1995', use: 'genomes to head counts', url: 'https://doi.org/10.1017/S0016672300034455' },
  { name: 'Zoonomia', by: 'Wilder et al.', when: '2023', use: 'cross-checks the counts', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10184782/' },
  { name: 'World Population Prospects', by: 'United Nations', when: '2024', use: 'humans alive, births', url: 'https://population.un.org/wpp/' },
  { name: 'How Many People Have Ever Lived', by: 'Kaneda, Greenbaum & Haub, PRB', when: '2022', use: 'humans ever born', url: 'https://www.prb.org/articles/how-many-people-have-ever-lived-on-earth/' },
  { name: 'FAOSTAT', by: 'FAO', when: '2025, stocks of 2024', use: 'livestock numbers', url: 'https://www.fao.org/faostat/en/#data/QCL' },
  { name: 'Species histories', use: 'each species card names its own', url: `${REPO}/pipeline/history/README.md` },
  { name: 'Hand corrections', use: 'fossil dates, placements, each cited', url: `${REPO}/pipeline/overrides.toml` },
  { name: 'Wikidata', when: 'read 2026-10-12', use: 'finds pictures, articles', url: 'https://www.wikidata.org/' },
  { name: 'Wikipedia', use: 'species article links', url: 'https://en.wikipedia.org/' },
  { name: 'Wikimedia Commons', use: 'pictures; each card links its file', url: 'https://commons.wikimedia.org/' },
  { name: 'Chronostratigraphic Chart', by: 'ICS; Cohen, Finney, Gibbard & Fan', when: 'v2024/12', use: 'geologic periods', url: 'https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf' },
  { name: 'Macrostrat', when: 'read 2026-10-12', use: 'colours of the periods', url: 'https://macrostrat.org/' },
  { name: 'LR04 stack', by: 'Lisiecki & Raymo', when: '2005', use: 'the ice ages', url: 'https://doi.org/10.1029/2004PA001071' },
  { name: 'The Last Glacial Maximum', by: 'Clark et al.', when: '2009', use: 'its dates', url: 'https://doi.org/10.1126/science.1172873' },
  { name: 'Natural Earth', when: '1:110m, through world-atlas 2.0.2', use: 'land on the globe', url: 'https://www.naturalearthdata.com/' },
];

/** Where to ask for something to be taken down. */
export const ISSUES_URL = 'https://github.com/theitush/ToLaD/issues';
