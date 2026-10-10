// The Panthera tree, dated: a small curated table (the dataset's tiles carry
// internal nodes, but their ages are interpolated and their topology puts the
// jaguar with the lion, which genome-scale trees do not). Each split is one
// date where a parent population divides into its daughters (a clean split:
// one date, a sharp Y; the gradual version is #50). Daughters are listed left
// to right as the fan draws them; a daughter is a species (scientific name) or
// a nested split.
//
// Living five: Figueiró et al. 2017, Sci. Adv. 3:e1700299, the genome-wide
// species tree {(tiger, snow leopard), [jaguar, (lion, leopard)]} (64% of
// windows; Fig. 1A gives node ages averaged over windows with 95% HPDs). Its
// node labels could not be read directly here; the values below are the ones
// quoted from it by secondary sources, named on each line, hence the
// confidence words.
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
  ageMa: 4.6,
  lo: 3.37,
  hi: 5.84,
  cite: `${FIGUEIRO} (crown age ~4.6 Ma per the authors' CRG press release, 2017; 95% HPD 3.37–5.84 Ma as reported by GenomeWeb)`,
  confidence: 'medium',
  note: 'tiger + snow leopard vs lion + leopard + jaguar',
  kids: [
    {
      name: 'Tiger + snow leopard ancestors',
      ageMa: 3.5,
      lo: 1.82,
      hi: 4.62,
      cite: `${FIGUEIRO} (3.5 Ma as summarised by J. Coyne, Why Evolution Is True, 2017-07-30; range 1.82–4.62 Ma as quoted on Wikipedia "Snow leopard")`,
      confidence: 'low',
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
      ageMa: 3.6,
      lo: 3.6,
      hi: 3.6,
      cite: `${FIGUEIRO} (jaguar off the lion–leopard ancestor ~3.6 Ma as summarised by J. Coyne, Why Evolution Is True, 2017-07-30; no interval found)`,
      confidence: 'low',
      kids: [
        {
          name: 'Jaguar ancestors',
          ageMa: 2.0,
          lo: 1.5,
          hi: 2.7,
          cite: 'Hemmer 1971 (P. gombaszoegensis as the jaguar\'s ancestor, "P. onca gombaszoegensis"); first appearance ~1.9–2.0 Ma (O\'Regan 2002, secondary; records from ~1.5 Ma to a doubtful >2.7 Ma)',
          confidence: 'low',
          note: 'contested: Chatar, Michaud & Fischer 2022 put it nearer the tiger. The dataset\'s first appearance (3.96 Ma) sits on the old crown date and is not used',
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
          cite: `${FIGUEIRO} (2.57 Ma, 95% CI 1.89–3.28, as quoted in "Unravelling the maternal evolutionary history of the African leopard", PeerJ 2024, 12:e17018)`,
          confidence: 'medium',
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
