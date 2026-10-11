// The cat family Felidae, dated: a small curated table (the dataset's tiles
// carry internal nodes, but their ages are interpolated and their topology is
// not a dated phylogeny's). Each split is one date where a parent population
// divides into its daughters (a clean split: one date, a sharp Y; the gradual
// version is #50). Daughters are listed left to right; a daughter is a species
// (scientific name) or a nested split. A split may have more than two
// daughters where the source dates them as one event (a polytomy).
//
// The 38 living species of the IUCN/SSC Cat Specialist Group's 2017 revision
// that the dataset holds (the Sunda leopard cat, Chinese mountain cat and
// African wildcat are not separate leaves there, and its extra Leopardus /
// Prionailurus / Lynx rows are subspecies or synonyms, left out), plus the
// Panthera fossils.
//
// Outside Panthera: TimeTree 5 (Kumar et al. 2022, Mol. Biol. Evol.
// 39:msac174), the pairwise divergence time of a species on each side of the
// split from its synthesis tree (the "adjusted" age, consistent across the
// tree; the interval is that pair's 95% CI over the n studies it summarises).
// So the topology there is TimeTree's, which differs from Johnson et al. 2006 /
// Li et al. 2016 in a few places, named in the notes. Confidence: medium for
// n >= 5 studies, low below.
//
// Panthera's living five: Figueiró et al. 2017, Sci. Adv. 3:e1700299, the
// genome-wide species tree {(tiger, snow leopard), [jaguar, (lion, leopard)]}
// (64% of windows). Node ages and 95% HPDs are read from Fig. 1A's labels (the
// only place the paper gives them; the figure is 313 px wide, so the last digit
// is ±0.02; research/panthera-split-dates.md). The paper treats them as
// relative ages under two soft calibrations.
// Fossils: the cave lion from its nuclear genome; the three without genomes
// branch off the lineage the literature assigns them to, at their first
// appearance.

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
  note?: string;
  /** Daughters, left to right: species (scientific names) or splits. */
  kids: (string | Split)[];
}

const FIGUEIRO = 'Figueiró et al. 2017, Sci. Adv. 3:e1700299';

export const PANTHERA_TREE: Split = {
  name: 'Big cat ancestors',
  ageMa: 4.58,
  lo: 3.37,
  hi: 5.84,
  cite: `${FIGUEIRO}, Fig. 1A (node age averaged over species-tree windows, 95% HPD; read from the figure)`,
  confidence: 'high',
  note: 'tiger + snow leopard vs lion + leopard + jaguar',
  kids: [
    {
      name: 'Tiger + snow leopard ancestors',
      ageMa: 3.47,
      lo: 2.55,
      hi: 4.43,
      cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
      confidence: 'high',
      kids: [
        {
          name: 'Tiger ancestors',
          ageMa: 2.58,
          lo: 2.16,
          hi: 2.58,
          cite: 'Mazák, Christiansen & Kitchener 2011, PLoS ONE 6:e25483 (P. zdanskyi the most primitive member of the tiger lineage, 2.55–2.16 Ma); date = its first appearance in the dataset (PBDB)',
          confidence: 'medium',
          note: 'several later studies treat P. zdanskyi as a synonym of P. palaeosinensis',
          kids: ['Panthera tigris', 'Panthera zdanskyi'],
        },
        'Panthera uncia',
      ],
    },
    {
      name: 'Lion + leopard + jaguar ancestors',
      ageMa: 3.65,
      lo: 2.69,
      hi: 4.66,
      cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
      confidence: 'high',
      kids: [
        {
          name: 'Jaguar ancestors',
          ageMa: 2.0,
          lo: 1.5,
          hi: 2.7,
          cite: 'Hemmer 1971 (P. gombaszoegensis as the jaguar\'s ancestor, "P. onca gombaszoegensis"); first appearance ~1.9–2.0 Ma (O\'Regan 2002, secondary; records from ~1.5 Ma to a doubtful >2.7 Ma)',
          confidence: 'low',
          note: 'contested: Chatar, Michaud & Fischer 2022 (Pap. Palaeontol. 8:e1464), the first phylogenetic analysis of the species, "places this taxon closer to P. tigris than to P. onca". The dataset\'s first appearance (3.96 Ma) sits on the old crown date and is not used',
          kids: [
            {
              name: 'Jaguar ancestors',
              ageMa: 0.129,
              lo: 0.0117,
              hi: 0.129,
              cite: 'Stinnesbeck et al. 2020, Hist. Biol. 32:930–939 (P. balamoides, compared with P. onca); date = its first appearance in the dataset',
              confidence: 'low',
              note: 'contested: Blaine et al. 2019 and Ruiz-Ramoni et al. 2019 argue it is a short-faced bear (Arctotherium)',
              kids: ['Panthera onca', 'Panthera balamoides'],
            },
            'Panthera gombaszoegensis',
          ],
        },
        {
          name: 'Lion + leopard ancestors',
          ageMa: 2.57,
          lo: 1.89,
          hi: 3.28,
          cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
          confidence: 'high',
          kids: [
            {
              name: 'Lion ancestors',
              ageMa: 0.5,
              lo: 0.392,
              hi: 0.578,
              cite: 'de Manuel et al. 2020, PNAS 117:10927–10934 (nuclear genomes: 470 ka, 392–529 ka, SI Table S3; X-chromosome PSMC 495 ka, 460–578 ka); the mitogenomes give 1.89 Ma (Barnett et al. 2016, Open Quaternary 2:4)',
              confidence: 'high',
              kids: ['Panthera leo', 'Panthera spelaea'],
            },
            'Panthera pardus',
          ],
        },
      ],
    },
  ],
};

/** Every split in the tree, parents before their daughters. */
export function allSplits(t: Split = PANTHERA_TREE): Split[] {
  const out: Split[] = [t];
  for (const k of t.kids) if (typeof k !== 'string') out.push(...allSplits(k));
  return out;
}

/** The species under a split, left to right. */
export function speciesUnder(t: Split): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : speciesUnder(k)));
}
